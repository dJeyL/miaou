// ── docs.js — les DOCUMENTS (lot V) ──────────────────────────────────────────
// Ce fichier porte le domaine « ouvrir un document pour en lire le contenu » :
// le sniff de type aux octets, les fonctions PURES de chaque format (PDF, Excel,
// Word, PowerPoint, listing d'archive), les lecteurs qui pilotent les
// bibliothèques lazy-loadées, la table de dispatch DOC_READERS et les
// descripteurs de bibliothèque.
//
// LA LIGNE DE PARTAGE AVEC utils.js (lot V-7, à tenir) :
//
//   docs.js  = le zip et les formats de bureautique comme DOCUMENTS — ce qu'on
//              ouvre pour en lire le contenu.
//   utils.js = le zip comme MÉCANIQUE DE CONTENEUR — parsing d'en-têtes
//              (parseZipCentralDirectory), gardes de sécurité
//              (isZipSlipPath, decideZipMemberExtraction), création d'archive
//              (buildZipMemberName, validateZipPlan), sniff de sauvegarde
//              (sniffBackupFormat). Des primitives dont le lot V est UN
//              consommateur parmi d'autres : V-2 écrit des archives, V-3 en
//              fait des sauvegardes, et ni l'un ni l'autre ne lit un document.
//
// Test décisif pour toute fonction future : « si le lot V n'existait pas, cette
// fonction aurait-elle encore une raison d'être ? » Oui → utils.js. Non → ici.
//
// L'INVARIANT DE DÉPENDANCE, formulé exactement (relecture 2026-08-29) :
// AUCUNE fonction restée dans utils.js n'appelle une fonction de docs.js.
// C'est CE sens-là qui est gardé, et c'est lui qui empêche le découpage bâclé
// que V-5-PLAN redoutait — deux fichiers en amont l'un de l'autre, pire que
// l'état d'avant. Vérifiable par grep, et vérifié : zéro occurrence.
//
// Ce n'est PAS « docs.js n'appelle que utils.js ». Le domaine s'appuie sur des
// fonctions déclarées PLUS BAS dans JS_ORDER, toutes depuis des corps de
// fonction (runtime, après chargement complet) — c'est légal et voulu :
//   - tools.js : toolFail, _pendingToolAcks, docsUnsupportedFormatMessage ;
//   - resources.js : humanSize ;
//   - ui.js : ensureFflate / ensurePdfJs / ensureSheetJs / ensureMammoth.
// Un grep « docs.js ne cite aucun symbole aval » sortirait donc rouge sans
// qu'il y ait la moindre régression : ne pas le lire comme tel.
//
// C'est aussi ce qui justifie que docsUnsupportedFormatMessage soit RESTÉE
// dans tools.js : elle lit le registre MCP (findDocsInflationTool), et répond
// à « quel outil serveur est branché ? », pas à « comment lire ce document ? ».
// La raison est le DOMAINE, pas un interdit d'appel — docs.js l'appelle bien.
//
// Position dans JS_ORDER : juste après utils.js, avant tous ses consommateurs
// (tools.js, ui.js, main.js). L'ordre n'a pas d'effet fonctionnel — tout est
// global et hoisté — mais il documente la couche : ce qui est EN AMONT de
// docs.js se limite à utils.js, et c'est ça que l'invariant protège.
//
// Ce que ce fichier ne porte PAS, délibérément :
//   - les schémas d'outils docs__* (registre TOOLS, tools.js — une liste unique
//     ne se fragmente pas par domaine) ;
//   - DOCS_DOCTRINE (tools.js, aux côtés des autres doctrines de
//     ROOT_SYSTEM_PROMPT) ;
//   - les lazy-loads CDN ensureFflate/ensurePdfJs/ensureSheetJs/ensureMammoth
//     (ui.js, où vivent TOUS les lazy-loads du projet — Mermaid, Prism,
//     QuickJS).

// Sniff Office : un .docx/.xlsx/.pptx EST un zip. Sert à ANNONCER la nature de
// l'archive dans le listing, JAMAIS à refuser l'ouverture (décision lot V).
function sniffZipOfficeKind(names) {
  const list = names || [];
  let hasWord = false, hasXl = false, hasPpt = false;
  for (const n of list) {
    const s = String(n || '');
    if (s.indexOf('word/') === 0) hasWord = true;
    else if (s.indexOf('xl/') === 0) hasXl = true;
    else if (s.indexOf('ppt/') === 0) hasPpt = true;
  }
  if (hasWord) return 'docx';
  if (hasXl) return 'xlsx';
  if (hasPpt) return 'pptx';
  return null;
}

// ── Lot V-4 — le pur du chemin « document natif » ───────────────────────────

// Type de document reconnu AUX OCTETS. Rend 'pdf' | 'zip' | 'docx' | 'xlsx' |
// 'pptx' | null. C'est le point d'unification annoncé par le PLAN V-4 §2.1 :
// docs__list ne peut plus se contenter de « parseZipCentralDirectory rend null
// donc ce n'est pas une archive » dès qu'il y a deux familles de format.
//
// Précédent suivi : sniffBackupFormat (V-3) — un conteneur se reconnaît à ses
// octets, un point unique par axe de variation, et le sniff ne fait qu'orienter
// (c'est le parseur en aval qui dit « c'en est vraiment un »).
//
// Ni le mime du record ni l'extension ne sont consultés : le mime d'un
// attachment vient du navigateur, celui d'un membre de zip d'une table
// d'extensions (ZIP_MEMBER_MIME_BY_EXT) — tous deux DÉCLARATIFS, donc
// falsifiables. `name` n'est accepté qu'en paramètre pour garder la signature
// stable si un départage à égalité devenait nécessaire ; il ne décide rien
// aujourd'hui, et ce silence est délibéré (même prudence que « jamais
// file_size seul » du central directory, V-1).
//
// Un zip Office rend son type Office ('docx'/'xlsx'/'pptx'), jamais 'zip' :
// c'est ce qui permettra à DOC_READERS de router un .docx vers son lecteur
// dédié en V-5, alors qu'il reste ouvrable comme archive aujourd'hui.
function sniffDocumentKind(u8, name) {
  if (!u8 || typeof u8.length !== 'number' || u8.length < 4) return null;
  if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return 'pdf';   // %PDF
  if (u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) {               // PK\x03\x04
    const entries = parseZipCentralDirectory(u8);
    if (!entries) return null;   // signature de zip mais central directory illisible
    const names = [];
    for (const e of entries) { if (e && e.name) names.push(e.name); }
    return sniffZipOfficeKind(names) || 'zip';
  }
  return null;
}

// Selector d'unité 'N' ou 'N-M', 1-indexé INCLUSIF, borné à [1, total].
// Portage de _parse_range (mcp_docs/formats.py) avec un seul écart de forme :
// le serveur LÈVE sur selector invalide, ici on rend { ok:false, message } —
// facture de decideZipMemberExtraction, et un pur qui ne jette pas reste
// testable en QuickJS sans harnais d'exception.
//
// La `notice` de clamp est le FMT4 déjà payé côté serveur : un '5-100' sur un
// document de 10 pages servait silencieusement 5-10, et le modèle concluait que
// le document s'arrêtait là. Le clamp reste (refuser serait pire), mais il se
// dit.
//
// Le format attendu est répété dans CHAQUE message d'erreur : le modèle écrit
// 'page 3' et se fait refuser (mémoire project_docs_read_selector_format) — un
// refus qui ne rappelle pas la forme attendue coûte un tour de plus.
function parsePageSelector(selector, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!n) return { ok: false, message: 'Document sans aucune unité lisible.' };
  const raw = String(selector == null ? '' : selector).trim();
  if (!raw) return { ok: false, message: "Selector manquant (attendu 'N' ou 'N-M', par exemple '3' ou '2-5')." };

  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(raw);
  if (!m) {
    return { ok: false, message: "Selector invalide : '" + raw +
      "' (attendu 'N' ou 'N-M', par exemple '3' ou '2-5' — pas de mot, pas de préfixe)." };
  }
  const wantStart = parseInt(m[1], 10);
  const wantEnd = m[2] === undefined ? wantStart : parseInt(m[2], 10);

  const start = Math.max(1, wantStart);
  const end = Math.min(n, wantEnd);
  if (start > end) {
    return { ok: false, message: "Selector invalide : '" + raw + "' (document de " + n +
      ' unité(s) — la plage demandée est hors document ou inversée).' };
  }
  const notice = (start !== wantStart || end !== wantEnd)
    ? '\n\n[Plage ramenée à ' + start + '-' + end + ' (demandé : ' + raw + ', document de ' + n + ' unité(s))]'
    : '';
  return { ok: true, start: start, end: end, notice: notice, total: n };
}

// Texte du listing PDF rendu au modèle. Calqué sur pdf_list (formats.py) mais
// homogène avec formatZipListing, qui est la référence de forme côté MIAOU :
// une ligne d'en-tête qui dit la nature et le volume, puis le détail.
//
// Les métadonnées sont un GAIN net sur le serveur (qui ne rend que le compte de
// pages et le sommaire) : le producteur en particulier oriente la lecture — un
// PDF sorti de PowerPoint ne se lit pas comme un rapport LaTeX. Elles ne sont
// annoncées que si elles portent quelque chose, jamais en champs vides.
//
// Le « (pas de sommaire) » du serveur est conservé : une absence dite vaut mieux
// qu'une absence silencieuse, que le modèle lirait comme un oubli de l'outil.
// Reconstitution du texte d'une page PDF depuis les items de getTextContent().
// PUR : prend le tableau d'items, rend une chaîne — pdf.js n'entre pas ici.
//
// LE PIÈGE, vérifié au spike : pdf.js ne met AUCUN séparateur entre les items.
// La sortie brute d'un `items.map(it => it.str).join('')` était « …ZEBRE0.Deuxieme
// ligne… », deux phrases collées. pymupdf, lui, rend des retours à la ligne :
// sans traitement, le texte natif serait MOINS lisible que celui du serveur —
// une régression de capacité, pas un détail cosmétique.
//
// `hasEOL` (présent en 3.x) porte l'information et a été confirmé sur un PDF
// réel de 8 pages. Le repli par comparaison d'ordonnée (`transform[5]`) reste
// là pour les items qui ne le portent pas : un changement de ligne se voit à un
// saut vertical, et le seuil se dérive de la hauteur de l'item plutôt que d'être
// une constante en dur (une police de 6 pt et une de 24 pt ne sautent pas de la
// même distance).
function joinPdfTextItems(items) {
  const list = items || [];
  let out = '';
  let prevY = null;
  for (const it of list) {
    if (!it) continue;
    const str = String(it.str == null ? '' : it.str);
    const tr = it.transform;
    const y = (tr && typeof tr[5] === 'number') ? tr[5] : null;
    const h = Math.abs(Number(it.height) || 0);

    if (it.hasEOL === undefined && prevY !== null && y !== null) {
      // Repli : saut vertical supérieur à la moitié de la hauteur de ligne.
      const seuil = (h || 10) * 0.5;
      if (Math.abs(prevY - y) > seuil) out += '\n';
    }
    out += str;
    if (it.hasEOL) out += '\n';
    if (y !== null) prevY = y;
  }
  return out;
}

// Texte rendu au modèle pour une lecture de pages PDF. PUR : reçoit les pages
// DÉJÀ extraites, jamais un objet pdf.js.
//
// Les en-têtes « --- Page N --- » sont ceux du serveur, et ils comptent :
// sans eux, un modèle qui lit une plage ne sait pas où passe la frontière et
// attribue une phrase à la mauvaise page.
//
// LES PAGES VIDES SONT SIGNALÉES, jamais rendues comme un blanc. Une page sans
// texte extractible est presque toujours une page SCANNÉE (image sans couche
// texte) : sans notice, le modèle reçoit du vide et conclut que le document ne
// dit rien — exactement le mode de défaillance du zip chiffré de V-1, du
// silence pris pour une réponse. La notice dit ce qui se passe ET ce qu'il
// reste possible de faire, sans promettre ce que MIAOU ne sait pas faire.
//
// DEPUIS V-8 elle porte une ISSUE, pas seulement un constat : le rendu image de
// la page (docs__render_page). Jusque-là le modèle apprenait qu'il n'y avait
// rien à lire sans qu'aucune suite ne lui soit offerte.
//
// FORMULÉE À L'INDICATIF, jamais « si tu as la vision » (corrigé après un test
// réel où un modèle À VISION a refusé l'outil) : un modèle n'a pas d'introspection
// fiable sur ses propres modalités, et une condition qu'il ne peut pas évaluer le
// pousse vers la branche prudente — l'inverse du but. Le repli reste offert, mais
// sur un fait VÉRIFIABLE APRÈS COUP (« si tu ne parviens pas à la lire »), pas sur
// une auto-évaluation préalable. Un modèle sans vision reçoit de toute façon un
// descripteur (visionDisabled, api.js) : il constate, il ne devine pas.
function formatPdfRead(pages, opts) {
  const o = opts || {};
  const list = pages || [];
  const parts = [];
  const empty = [];
  for (const p of list) {
    const num = Math.floor(Number(p && p.page) || 0);
    const text = String((p && p.text) || '').trim();
    if (!text) empty.push(num);
    parts.push('--- Page ' + num + ' ---\n' + text);
  }
  let out = parts.join('\n\n');
  if (empty.length) {
    const quoi = empty.length === list.length
      ? 'Aucune page de cette plage ne porte de texte extractible'
      : 'Page(s) sans texte extractible : ' + empty.join(', ');
    out += '\n\n[' + quoi + '. Ces pages sont probablement SCANNÉES (image sans ' +
      "couche texte) : MIAOU ne fait pas d'OCR. Appelle miaou__docs__render_page " +
      'pour te mettre la page sous les yeux et la lire toi-même. Si tu ne parviens ' +
      "pas à la lire, dis-le plutôt que de conclure que le document est vide.]";
  }
  if (o.notice) out += String(o.notice);
  return out;
}

// Libellés des acks docs__list / docs__read. PURS et sortis du registre d'acks
// (ui.js) pour une raison précise : chaque kind y duplique sa logique entre
// `label` (chaîne) et `renderLabel` (DOM), et c'est exactement là qu'un libellé
// dérive — la version texte et la version DOM finissent par ne plus dire la
// même chose. Une seule source, appelée deux fois.
//
// L'ack ne porte pas le TYPE du document (il n'a jamais eu à le porter) : on le
// déduit du nom du record, qui est ce que l'utilisateur voit de toute façon.
// C'est une heuristique d'AFFICHAGE, jamais de routage — le routage, lui, se
// fait aux octets (sniffDocumentKind). Se tromper ici coûte un mot inexact dans
// une trace, pas une mauvaise lecture.
// L'unité d'affichage, déduite du nom du record. Table plutôt que cascade de
// ternaires depuis V-5 : chaque format ajouté est UNE ligne, et le genre voyage
// avec l'unité au lieu d'être recalculé à chaque point d'usage — c'est ainsi
// qu'on a écrit « aucun page » en V-4.
const DOC_ACK_UNITS = [
  { test: /\.pdf$/i,           head: 'Document listé',   unit: 'page',    feminin: true,  read: 'Page' },
  { test: /\.xlsx?$/i,         head: 'Classeur listé',   unit: 'feuille', feminin: true,  read: 'Feuille' },
  { test: /\.docx?$/i,         head: 'Document listé',   unit: 'section', feminin: true,  read: 'Section' },
  { test: /\.pptx?$/i,         head: 'Présentation listée', unit: 'slide', feminin: true, read: 'Slide' },
];
const DOC_ACK_UNIT_DEFAULT = { head: 'Archive listée', unit: 'membre', feminin: false, read: 'Membre' };

function docAckUnit(name) {
  const n = String(name || '');
  for (const u of DOC_ACK_UNITS) { if (u.test.test(n)) return u; }
  return DOC_ACK_UNIT_DEFAULT;
}

function docsListAckHead(m) {
  return docAckUnit(m && m.resourceName).head;
}

function docsListAckCount(m) {
  const n = m ? m.count : null;
  // « page » et « feuille » sont féminins, « membre » masculin : l'accord de
  // « aucun/aucune » suit l'unité. Détail, mais un ack se lit à chaque appel.
  const u = docAckUnit(m && m.resourceName);
  if (n === 0) return (u.feminin ? 'aucune ' : 'aucun ') + u.unit;
  if (n === 1) return '1 ' + u.unit;
  return (n != null ? n : '?') + ' ' + u.unit + 's';
}

// « Pages 2-5 lues » / « Page 3 lue ». Le selector de l'ack est déjà normalisé
// par le handler (bornes effectivement servies, pas la demande brute) : ce qui
// s'affiche est ce qui a été lu, y compris après un clamp.
function docsReadAckHead(m) {
  const sel = String((m && m.selector) || '').trim();
  if (!sel) return 'Document lu';

  // Un selector d'unité NOMMÉE n'est pas numérique ('Synthèse!B2:E31' pour une
  // feuille, '2. Developer Portal' pour une section docx) : le distinguer sur
  // sa FORME, parce que c'est ce selector-là qui doit se relire dans l'ack.
  // Un selector de pages est un nombre ou une plage de nombres, tout le reste
  // désigne une unité nommée — dont le MOT vient de la table (V-5 étape 2 :
  // sans lui, une section docx s'annonçait « Feuille … lue », l'unité de
  // l'unique format nommé qui existait alors).
  // sourceName, PAS resourceName : en as_resource, resourceName est l'extrait
  // PRODUIT (« compta-Synthese.txt ») et non le document lu — il ne matche
  // alors aucune ligne de la table, et le mot tombait sur le défaut. Repli sur
  // resourceName pour la lecture directe, où les deux coïncident.
  const unit = docAckUnit(m && (m.sourceName || m.resourceName));
  const word = unit.read || 'Unité';

  if (!/^\d+(?:-\d+)?$/.test(sel)) return word + ' ' + sel + ' lue';

  // Selector NUMÉRIQUE : le mot vient de la table lui aussi (V-5 étape 3). Il
  // était en dur à « Page » depuis V-4, l'unique format à selector numérique
  // d'alors — la slide en est un second, et la ligne pptx de la table portait
  // déjà son mot sans que rien ne l'atteigne. Défaut PRÉEXISTANT révélé par le
  // troisième format, comme le sourceName l'a été par le deuxième.
  const parts = sel.split('-');
  const plural = parts.length > 1 && parts[0] !== parts[1];
  return word + (plural ? 's ' : ' ') + (plural ? sel : parts[0]) +
    (plural ? (unit.feminin ? ' lues' : ' lus') : (unit.feminin ? ' lue' : ' lu'));
}

// « Page 3 rendue en image » (lot V-8). Sœur de docsReadAckHead, et pour la même
// raison : le MOT d'unité et son accord viennent de DOC_ACK_UNITS, jamais d'un
// littéral. Le rendu image est PDF-only aujourd'hui, donc « Page » serait juste
// — et c'est exactement le piège déjà payé DEUX FOIS par docsReadAckHead
// (« Page » en dur révélé par la slide en V-5, sourceName révélé par le docx) :
// une valeur en dur survit jusqu'au deuxième occupant. La table porte déjà le
// mot et le genre, il n'y a qu'à les lire.
//
// « rendue » et pas « lue » : MIAOU REND la page, il n'en fait pas l'OCR — c'est
// le modèle qui lit. Et sans « en image », l'ack serait ambigu à côté du
// « Page 3 lue » de docs_read, son voisin immédiat dans le fil.
function docsRenderAckHead(m) {
  const unit = docAckUnit(m && (m.sourceName || m.resourceName));
  const word = unit.read || 'Unité';
  const sel = String((m && m.selector) || '').trim();
  return word + (sel ? ' ' + sel : '') + (unit.feminin ? ' rendue' : ' rendu') + ' en image';
}

function docsRenderAckLabel(m) {
  return docsRenderAckHead(m) + ' : ' + ((m && (m.sourceName || m.resourceName)) || '?');
}

function docsReadAckLabel(m) {
  return docsReadAckHead(m) + ' : ' + ((m && (m.resourceName || m.handle)) || '?');
}

// Nom du record produit par docs__read(as_resource: true) : « rapport.pdf » +
// pages 2-5 → « rapport-p2-5.txt ». Le nom est ce que l'utilisateur voit dans la
// bibliothèque et au téléchargement, et ce par quoi il reconnaît DE QUOI vient
// un extrait — d'où la plage dans le nom plutôt qu'un compteur anonyme.
// L'extension devient .txt : le record est du texte, quel que soit le format
// d'origine (même geste que zipMemberBaseName, qui nomme pour l'interface).
function pdfReadResourceName(sourceName, start, end) {
  const a = Math.floor(Number(start) || 0);
  const b = Math.floor(Number(end) || 0);
  const suffix = (a && b) ? (a === b ? '-p' + a : '-p' + a + '-' + b) : '';
  return docReadResourceName(sourceName, suffix);
}

// Facteur commun du nommage d'un extrait (lot V-5) : le basename sans extension,
// plus un suffixe DÉCIDÉ PAR L'APPELANT, plus .txt. Sorti de
// pdfReadResourceName parce qu'une feuille ne se nomme pas « -p2-5 » : le
// suffixe est la seule chose qui varie par format, et le reste (dernier segment
// de chemin, retrait d'extension, repli « document ») est identique partout.
// Le suffixe passe par slugifyResourceSuffix : un nom de feuille est saisi par
// un humain dans Excel et peut contenir n'importe quoi — espaces, accents,
// barres obliques — alors que ce nom-ci finit en nom de fichier téléchargeable.
function docReadResourceName(sourceName, suffix) {
  let base = String(sourceName == null ? '' : sourceName).replace(/\\/g, '/');
  const parts = base.split('/');
  base = '';
  for (let i = parts.length - 1; i >= 0; i--) { if (parts[i]) { base = parts[i]; break; } }
  base = base.replace(/\.[A-Za-z0-9]{1,8}$/, '') || 'document';
  return base + String(suffix == null ? '' : suffix) + '.txt';
}

// Rend un fragment saisi par un humain utilisable comme morceau de nom de
// fichier. Ni exhaustif ni réversible : c'est de l'étiquetage d'interface, pas
// de l'encodage — le nom exact de la feuille reste dans le TEXTE de l'extrait,
// qui est ce que le modèle lit.
function slugifyResourceSuffix(label) {
  const s = String(label == null ? '' : label).trim();
  if (!s) return '';
  const cleaned = s.replace(/[^A-Za-z0-9\u00C0-\u017F]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned ? '-' + cleaned.slice(0, 40) : '';
}

// Libellé des formats ouverts NATIVEMENT, rendu au modèle dans le message de
// refus. Dérivé de la table de dispatch (DOC_READERS, tools.js) et jamais d'une
// chaîne recopiée : la formule « ne gère à ce jour que le zip » était en dur
// depuis V-1 et aurait menti dès le premier format ajouté — or c'est le message
// sur lequel le modèle décide s'il doit chercher un outil serveur (mémoire
// project_help_md_confabulation_move_and_memory_read : une doctrine périmée est
// le mode de défaillance le plus cher du projet).
//
// Pur pour rester testable : docsUnsupportedFormatMessage, elle, lit
// _remoteTools et ne l'est pas.
function formatNativeDocKindsLabel(kinds) {
  const list = [];
  for (const k of (kinds || [])) {
    const s = String(k || '').trim();
    if (s && list.indexOf(s) < 0) list.push(s);
  }
  if (!list.length) return 'aucun format';
  if (list.length === 1) return 'le ' + list[0];
  return 'les ' + list.slice(0, -1).join(', ') + ' et ' + list[list.length - 1];
}

function formatPdfListing(info) {
  const o = info || {};
  const pages = Math.max(0, Math.floor(Number(o.pages) || 0));
  const title = String(o.title == null ? '' : o.title).trim();
  const author = String(o.author == null ? '' : o.author).trim();
  const producer = String(o.producer == null ? '' : o.producer).trim();
  const outline = o.outline || [];

  let head = 'PDF — ' + pages + (pages > 1 ? ' pages' : ' page');
  if (title) head += ', « ' + title + ' »';
  if (author) head += (title ? ' (' + author + ')' : ', ' + author);
  const out = [head];
  if (producer) out.push('Produit par : ' + producer);

  if (outline.length) {
    out.push('Sommaire :');
    for (const it of outline) {
      if (!it) continue;
      const lvl = Math.max(1, Math.floor(Number(it.level) || 1));
      const page = Math.floor(Number(it.page) || 0);
      const label = String(it.title == null ? '' : it.title).trim();
      if (!label) continue;
      out.push(new Array(lvl).join('  ') + '- ' + (page ? 'p.' + page + ' ' : '') + label);
    }
  } else {
    out.push('(pas de sommaire)');
  }
  return out.join('\n');
}

// ── Excel : le PUR du chemin xlsx (lot V-5, étape 1) ────────────────────────
// SheetJS fait l'ouverture et le rendu CSV ; ce qui vit ici est tout ce qui
// DÉCIDE — parsing du selector, arithmétique de plage, mise en forme — parce
// que c'est là que se logent les modes de défaillance, et que seul le pur est
// testable en QuickJS.

// Colonne Excel ↔ index 0-based. 'A' → 0, 'Z' → 25, 'AA' → 26. Base 26
// BIJECTIVE (il n'y a pas de « colonne zéro »), d'où le -1 à chaque digit :
// une base 26 ordinaire ferait de 'AA' le 27e au lieu du 26e, décalage qui ne
// se voit qu'au-delà de la colonne Z — donc jamais sur une fixture jouet.
function colLetterToIndex(letters) {
  const s = String(letters == null ? '' : letters).toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return -1;
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function colIndexToLetter(index) {
  let n = Math.floor(Number(index));
  if (!(n >= 0)) return '';
  let out = '';
  n += 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// 'B2:E31' → { s:{r,c}, e:{r,c} } en indices 0-based, ou null. Même convention
// que decode_range de SheetJS (vérifié au spike sur un classeur réel : B2:E31
// donne s={c:1,r:1}), pour que les deux se composent sans conversion.
// Les $ des références absolues ($B$2) sont tolérés : un humain qui copie une
// plage depuis Excel les emporte, et refuser là-dessus serait un refus de forme
// sur une intention parfaitement claire.
function parseA1Range(ref) {
  const raw = String(ref == null ? '' : ref).trim().replace(/\$/g, '').toUpperCase();
  if (!raw) return null;
  // Trois lettres au plus, et ce n'est pas de la coquetterie : sans borne,
  // 'FEUILLE1' est une référence de cellule syntaxiquement valide (colonne
  // « FEUILLE », ligne 1) et parseA1Range rendrait une plage à la colonne
  // 1 922 664 644 au lieu de null — restrictSheetRange en hériterait sans rien
  // pouvoir en faire. Excel s'arrête à XFD (16 384 colonnes), soit trois
  // lettres : la borne est celle du format, pas une valeur choisie.
  const m = /^([A-Z]{1,3})(\d{1,7})(?::([A-Z]{1,3})(\d{1,7}))?$/.exec(raw);
  if (!m) return null;
  const c1 = colLetterToIndex(m[1]);
  const r1 = parseInt(m[2], 10) - 1;
  const c2 = m[3] === undefined ? c1 : colLetterToIndex(m[3]);
  const r2 = m[4] === undefined ? r1 : parseInt(m[4], 10) - 1;
  if (c1 < 0 || c2 < 0 || !(r1 >= 0) || !(r2 >= 0)) return null;
  // Une plage écrite à l'envers (E31:B2) est normalisée plutôt que refusée :
  // elle désigne sans ambiguïté le même rectangle.
  return {
    s: { r: Math.min(r1, r2), c: Math.min(c1, c2) },
    e: { r: Math.max(r1, r2), c: Math.max(c1, c2) },
  };
}

function formatA1Range(range) {
  if (!range || !range.s || !range.e) return '';
  return colIndexToLetter(range.s.c) + (range.s.r + 1) + ':' +
         colIndexToLetter(range.e.c) + (range.e.r + 1);
}

// Le selector Excel : 'Feuille' ou 'Feuille!A1:C10'. Portage de xlsx_read
// (mcp_docs, formats.py:352), y compris son découpage au PREMIER '!' — un nom
// de feuille PEUT contenir un '!', et reproduire le split du serveur vaut mieux
// qu'inventer une règle qui diverge de lui pour un cas exotique.
//
// Feuille inconnue → message NOMMANT les feuilles disponibles : c'est ce qui
// permet au modèle de se re-cibler DANS LE TOUR plutôt que d'abandonner (même
// posture que decideZipMemberExtraction et parsePageSelector).
function parseSheetSelector(selector, sheetNames) {
  const names = [];
  for (const n of (sheetNames || [])) { const v = String(n == null ? '' : n); if (v) names.push(v); }
  if (!names.length) return { ok: false, message: 'Classeur sans aucune feuille lisible.' };

  const raw = String(selector == null ? '' : selector).trim();
  if (!raw) {
    return { ok: false, message: "Selector manquant (attendu le nom d'une feuille, " +
      "éventuellement suivi d'une plage : 'Feuille1' ou 'Feuille1!A1:C10'). Feuilles disponibles : " +
      names.map(n => '« ' + n + ' »').join(', ') + '.' };
  }

  // Le découpage au PREMIER '!' est celui du serveur (split("!", 1),
  // formats.py) et il est porté tel quel — SAUF qu'on regarde d'abord si le
  // selector entier EST un nom de feuille. Sans ce repli, une feuille nommée
  // « Alerte! » n'est adressable par AUCUN selector : le split cherche
  // « Alerte », qui n'existe pas. Le serveur a ce trou ; il coûte deux lignes
  // à fermer, et le fermer ne fait diverger aucun cas où le serveur répond.
  // La plage reste inaccessible sur une telle feuille (le '!' est ambigu par
  // construction), mais la feuille entière, elle, se lit.
  let wantSheet, wantRange;
  const exact = (sheetNames || []).some(n => String(n) === raw);
  if (exact) {
    wantSheet = raw; wantRange = '';
  } else {
    const cut = raw.indexOf('!');
    wantSheet = (cut < 0 ? raw : raw.slice(0, cut)).trim();
    wantRange = cut < 0 ? '' : raw.slice(cut + 1).trim();
  }

  // Correspondance exacte d'abord, puis insensible à la casse : le modèle
  // recopie un nom vu dans le listing, mais un modèle faible peut en changer la
  // casse. Accepter reste sans ambiguïté tant qu'une seule feuille correspond.
  let sheet = null;
  for (const n of names) { if (n === wantSheet) { sheet = n; break; } }
  if (sheet === null) {
    const low = wantSheet.toLowerCase();
    const hits = names.filter(n => n.toLowerCase() === low);
    if (hits.length === 1) sheet = hits[0];
  }
  if (sheet === null) {
    return { ok: false, message: "Feuille « " + wantSheet + " » introuvable. Feuilles disponibles : " +
      names.map(n => '« ' + n + ' »').join(', ') + '.' };
  }

  if (!wantRange) return { ok: true, sheet: sheet, range: null };

  const parsed = parseA1Range(wantRange);
  if (!parsed) {
    return { ok: false, message: "Plage invalide : '" + wantRange + "' (attendu une plage A1 " +
      "comme 'A1:C10', ou rien du tout pour lire la feuille entière)." };
  }
  return { ok: true, sheet: sheet, range: parsed, rangeText: formatA1Range(parsed) };
}

// LA garde du format, et elle vient d'une mesure : sur un classeur réel dont le
// !ref est 'B2:E31', poser un !ref de 'A1:Z999' fait rendre à SheetJS
// 999 LIGNES, dont ~970 vides. SheetJS ne borne pas — il déroule ce qu'on lui
// dit. Un selector 'Feuille!A1:Z999' noierait donc le modèle sous du vide en
// ayant l'air d'avoir servi la demande : « plausible et faux », le mode de
// défaillance que ce lot refuse depuis le zip chiffré de V-1.
//
// D'où l'intersection avec le !ref réel, et surtout la NOTICE quand elle mord :
// le modèle doit savoir que ce qu'il a demandé n'est pas exactement ce qu'il a
// reçu (même raison que le clamp de parsePageSelector).
//
// Rend { ref, notice } ou { fail } — l'intersection VIDE est un échec, pas un
// silence : demander D1:F9 sur une feuille A1:B3 ne rend aucune cellule, et
// rendre une chaîne vide ferait conclure « la feuille est vide » à tort.
function restrictSheetRange(sheetRef, wanted) {
  const full = parseA1Range(sheetRef);
  if (!full) return { fail: 'Feuille sans dimension exploitable (!ref illisible).' };
  if (!wanted) return { ref: formatA1Range(full), notice: '' };

  const inter = {
    s: { r: Math.max(full.s.r, wanted.s.r), c: Math.max(full.s.c, wanted.s.c) },
    e: { r: Math.min(full.e.r, wanted.e.r), c: Math.min(full.e.c, wanted.e.c) },
  };
  if (inter.s.r > inter.e.r || inter.s.c > inter.e.c) {
    return { fail: 'La plage demandée (' + formatA1Range(wanted) + ') est entièrement hors de la ' +
      'feuille, qui occupe ' + formatA1Range(full) + '. Demande une plage dans cette zone.' };
  }
  const clamped = formatA1Range(inter) !== formatA1Range(wanted);
  return {
    ref: formatA1Range(inter),
    notice: clamped
      ? '\n\n[Plage ramenée à ' + formatA1Range(inter) + ' (demandé : ' + formatA1Range(wanted) +
        ', la feuille occupe ' + formatA1Range(full) + ')]'
      : '',
  };
}

// Listing d'un classeur. Reçoit des feuilles DÉJÀ décrites ({ name, ref, rows,
// cols }) — SheetJS n'entre pas ici.
//
// La dimension est annoncée par feuille parce que c'est ce dont le modèle a
// besoin pour écrire son selector : sans elle il demande A1:Z100 au jugé, et
// tombe dans le cas que restrictSheetRange vient de rattraper.
function formatXlsxListing(sheets) {
  const list = sheets || [];
  const head = 'Classeur Excel — ' + list.length + (list.length > 1 ? ' feuilles' : ' feuille');
  const out = [head];
  for (const sh of list) {
    if (!sh) continue;
    const name = String(sh.name == null ? '' : sh.name);
    const ref = String(sh.ref == null ? '' : sh.ref).trim();
    const rows = Math.max(0, Math.floor(Number(sh.rows) || 0));
    const cols = Math.max(0, Math.floor(Number(sh.cols) || 0));
    if (!ref) { out.push('- « ' + name +' » (vide)'); continue; }
    out.push('- « ' + name + ' » : ' + ref + ' (' + rows + (rows > 1 ? ' lignes' : ' ligne') +
      ' × ' + cols + (cols > 1 ? ' colonnes' : ' colonne') + ')');
  }
  if (!list.length) out.push('(aucune feuille)');
  out.push("Pour lire : miaou__docs__read avec un selector « NomDeFeuille » ou « NomDeFeuille!A1:C10 ».");
  return out.join('\n');
}

// Mise en forme d'une feuille lue. Reçoit le CSV DÉJÀ produit par SheetJS.
//
// Le cap de lignes est un portage de MAX_XLSX_ROWS_DEFAULT (200) du serveur, et
// il ne s'applique QUE sans plage explicite : un modèle qui demande A1:C10000
// sait ce qu'il fait, alors qu'un modèle qui lit une feuille entière ne sait pas
// encore qu'elle fait 50 000 lignes. La troncature se DIT et propose la suite
// (une plage, ou as_resource), jamais un silence.
function formatXlsxRead(csv, opts) {
  const o = opts || {};
  const sheet = String(o.sheet == null ? '' : o.sheet);
  const ref = String(o.ref == null ? '' : o.ref).trim();
  const maxRows = Math.max(0, Math.floor(Number(o.maxRows) || 0));
  const text = String(csv == null ? '' : csv);

  // Le CSV de SheetJS se termine par un saut de ligne : le retirer avant de
  // compter, sinon une feuille de 3 lignes en annonce 4.
  const body = text.replace(/\n+$/, '');
  let lines = body === '' ? [] : body.split('\n');
  let truncated = 0;
  if (maxRows && lines.length > maxRows) {
    truncated = lines.length - maxRows;
    lines = lines.slice(0, maxRows);
  }

  const head = '--- Feuille « ' + sheet + ' »' + (ref ? ' (' + ref + ')' : '') + ' ---';
  let out = head + '\n' + lines.join('\n');
  if (!lines.length) {
    out += '\n[Cette plage ne contient aucune cellule remplie.]';
  }
  if (truncated) {
    out += '\n\n[Lecture limitée aux ' + maxRows + ' premières lignes : ' + truncated +
      ' ligne(s) non affichée(s). Demande une plage explicite (selector « ' + sheet +
      "!A" + (maxRows + 1) + ':…' + " ») ou relance avec as_resource: true pour tout obtenir " +
      'dans une ressource interrogeable par miaou__js__eval.]';
  }
  if (o.notice) out += String(o.notice);
  return out;
}

// ── Word : le PUR du chemin docx (lot V-5, étape 2) ─────────────────────────
// mammoth fait la conversion OOXML→HTML ; ce qui vit ici est la passe
// HTML→texte structuré et la découpe en sections. Deux raisons de ne pas
// laisser mammoth rendre directement du texte : extractRawText PERD les
// tableaux (mesuré au spike, et un docx professionnel est souvent
// MAJORITAIREMENT des tableaux — la fixture réelle en porte 10), et
// convertToMarkdown aplatit ces mêmes tableaux cellule par cellule tout en
// sur-échappant (« Sous\-section »). convertToHtml est la seule sortie qui
// garde la structure, et la passe vers le texte est pure donc testable.
//
// ⚠ CE HTML NE PASSE PAS PAR sanitizeHtml/DOMPurify, et c'est délibéré : il
// ne va JAMAIS au DOM. Il va dans un tool result, puis en texte. Le piège 21
// gouverne le chemin string→HTML AFFICHÉ ; il n'y en a pas ici. Le jour où un
// docx converti s'afficherait dans le fil, sanitizeHtml redeviendrait
// obligatoire — c'est exactement le troisième chemin de renderMarkdownDocBody
// (lot R), qui, lui, affiche.
//
// Le parsing est fait à la REGEX et non par DOMParser : le pur doit tourner
// sous QuickJS (tests), qui n'a pas de DOM. C'est acceptable ici et nulle part
// ailleurs, parce que l'entrée n'est pas du HTML arbitraire mais la sortie
// d'un générateur connu, au vocabulaire fermé (mesuré sur la fixture réelle :
// h1-h6, p, table/thead/tbody/tr/th/td, strong, em, ul/ol/li, a, br).

// Entités HTML → caractères. Volontairement limité au jeu que mammoth émet
// (mesuré : &lt; &gt; &amp; sur la fixture réelle, plus les numériques et
// &quot;/&#39; qu'il produit sur des apostrophes et guillemets droits).
//
// Ce décodage N'EST PAS COSMÉTIQUE, c'est une garde de round-trip : la fixture
// réelle porte un heading « 3. Gateway &amp; styles d'API ». Non décodé, son
// label de section sortirait au listing avec le &amp; visible, ou pire —
// décodé au listing mais pas à la comparaison — AUCUN selector ne pourrait
// jamais viser cette section. Un seul décodage, appliqué au texte comme aux
// labels, et la comparaison se fait donc sur des chaînes décodées des deux
// côtés.
function decodeHtmlEntities(s) {
  let out = String(s == null ? '' : s);
  if (out.indexOf('&') < 0) return out;   // cas majoritaire, sorti tôt
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
    const n = parseInt(h, 16);
    return (n >= 0 && n <= 0x10FFFF) ? String.fromCharCode(n) : m;
  });
  out = out.replace(/&#(\d+);/g, (m, d) => {
    const n = parseInt(d, 10);
    return (n >= 0 && n <= 0x10FFFF) ? String.fromCharCode(n) : m;
  });
  out = out.replace(/&(lt|gt|quot|apos|nbsp|amp);/g, (m, name) => {
    if (name === 'lt') return '<';
    if (name === 'gt') return '>';
    if (name === 'quot') return '"';
    if (name === 'apos') return "'";
    if (name === 'nbsp') return ' ';
    return '&';
  });
  return out;
}

// Retire les balises d'un fragment et rend son texte, sur UNE seule ligne.
// Utilisé pour le contenu d'une cellule de tableau et pour un titre : les deux
// sont des unités qui ne peuvent pas porter de saut de ligne sans casser ce qui
// les entoure (une ligne « a | b | c », un label de selector). Une cellule qui
// contient plusieurs <p> — cas mesuré sur la fixture réelle, majoritaire même —
// voit ses paragraphes joints par un espace plutôt que par un \n.
function htmlFragmentToInlineText(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeHtmlEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

// Un <table> → lignes « a | b | c ». Même rendu que le serveur (_table_text,
// formats.py) VOLONTAIREMENT : c'est la forme que le modèle a déjà vue passer,
// et changer de rendu tabulaire au passage au natif serait un écart gratuit.
// thead et tbody sont traversés sans distinction — <th> et <td> donnent tous
// deux une cellule ; une ligne d'en-tête reste la première ligne, ce qui est
// exactement ce qu'un rendu texte peut porter.
function htmlTableToText(tableHtml) {
  const src = String(tableHtml == null ? '' : tableHtml);
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(src)) !== null) {
    const cells = [];
    const cellRe = /<(t[dh])[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(m[1])) !== null) cells.push(htmlFragmentToInlineText(c[2]));
    if (cells.length) rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

// La passe HTML→texte structuré. Rend une LISTE DE BLOCS plutôt qu'une chaîne,
// parce que la découpe en sections a besoin de savoir lequel est un heading —
// refaire une passe de regex sur le texte rendu pour les retrouver serait
// deviner ce qu'on vient de savoir.
//
// Chaque bloc : { type: 'heading'|'para'|'table'|'list', level, text }.
// Le niveau n'a de sens que pour un heading (1-6) ; il gouverne le bornage des
// sections (« jusqu'au prochain heading de niveau ≤ »), règle portée telle
// quelle du serveur.
function docxHtmlToBlocks(html) {
  const src = String(html == null ? '' : html);
  const blocks = [];
  // Un seul balayage, alternant sur les quatre conteneurs de premier niveau que
  // mammoth émet. L'ordre du document est ainsi préservé — et c'est le gain
  // structurel sur le serveur : un <table> se trouve À SA PLACE, entre deux
  // headings, donc DANS sa section. python-docx, lui, expose paragraphes et
  // tables en deux collections séparées, d'où le label spécial « (tableaux) »
  // du serveur qui rassemblait à la fin ce que le document avait dispersé.
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<p[^>]*>([\s\S]*?)<\/p>|<table[^>]*>([\s\S]*?)<\/table>|<(ul|ol)[^>]*>([\s\S]*?)<\/\5>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) {
      const text = htmlFragmentToInlineText(m[2]);
      if (text) blocks.push({ type: 'heading', level: Number(m[1].charAt(1)), text: text });
    } else if (m[3] !== undefined) {
      const text = htmlFragmentToInlineText(m[3]);
      if (text) blocks.push({ type: 'para', level: 0, text: text });
    } else if (m[4] !== undefined) {
      const text = htmlTableToText(m[4]);
      if (text) blocks.push({ type: 'table', level: 0, text: text });
    } else if (m[6] !== undefined) {
      const items = [];
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(m[6])) !== null) {
        const t = htmlFragmentToInlineText(li[1]);
        if (t) items.push('- ' + t);
      }
      if (items.length) blocks.push({ type: 'list', level: 0, text: items.join('\n') });
    }
  }
  return blocks;
}

// Étiquettes des unités sans heading propre. Portées du serveur (_PREAMBLE_LABEL
// / _BODY_LABEL, formats.py) parce qu'elles sont des SELECTORS valides que le
// modèle recopie depuis le listing : les renommer romprait la parité pour rien.
// « (tableaux) », en revanche, N'EST PAS porté — il n'a plus d'objet, les
// tableaux étant désormais dans leur section (cf. docxHtmlToBlocks).
const DOCX_PREAMBLE_LABEL = '(préambule)';
const DOCX_BODY_LABEL = '(corps)';

// Découpe en sections : un heading et tout ce qui suit jusqu'au prochain heading
// de niveau INFÉRIEUR OU ÉGAL. Règle portée telle quelle de _docx_sections
// (formats.py) — un h2 ne ferme pas un h1, il s'y imbrique, donc lire « 1.
// Bloquants » rend aussi ses sous-parties. C'est ce qu'un humain attend d'un
// titre, et c'est ce que le modèle attend d'un selector.
//
// Rend [{ label, level, text }]. Le label est le titre DÉCODÉ : c'est lui que
// le listing affiche et lui que le selector doit matcher — les deux dérivent
// d'ici, jamais de deux chemins séparés (mémoire
// project_what_model_sees_equals_what_it_can_touch).
function docxSections(blocks) {
  const list = blocks || [];
  const heads = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].type === 'heading') heads.push(i);
  }

  const renderRange = (a, b) => {
    const parts = [];
    for (let i = a; i < b; i++) {
      const bl = list[i];
      if (!bl) continue;
      if (bl.type === 'heading') parts.push('#'.repeat(Math.max(1, Math.min(6, bl.level))) + ' ' + bl.text);
      else parts.push(bl.text);
    }
    return parts.join('\n\n');
  };

  if (!heads.length) {
    const body = renderRange(0, list.length);
    return body ? [{ label: DOCX_BODY_LABEL, level: 0, text: body }] : [];
  }

  const out = [];
  if (heads[0] > 0) {
    const pre = renderRange(0, heads[0]);
    if (pre.trim()) out.push({ label: DOCX_PREAMBLE_LABEL, level: 0, text: pre });
  }
  for (let p = 0; p < heads.length; p++) {
    const start = heads[p];
    const level = list[start].level;
    let end = list.length;
    for (let q = p + 1; q < heads.length; q++) {
      if (list[heads[q]].level <= level) { end = heads[q]; break; }
    }
    out.push({ label: list[start].text, level: level, text: renderRange(start, end) });
  }
  return out;
}

// Résolution d'un selector docx vers une section. Le selector est le TITRE
// EXACT d'un heading, tel que le listing l'a rendu (ou l'un des deux labels
// spéciaux). Rend { ok, section } ou { ok:false, message }.
//
// Trois tolérances, dans cet ordre — chacune répond à un mode d'échec observé
// et non à une élégance : (1) exact ; (2) insensible à la casse et aux espaces
// répétés, parce qu'un titre recopié depuis un listing traverse une
// tokenisation ; (3) préfixe non ambigu, parce qu'un titre long (« 8. Pour
// produire le rapport final (côté Claude) ») se recopie tronqué. Le repêchage
// par préfixe n'agit QUE s'il désigne une seule section : deux candidats, c'est
// une ambiguïté qu'il faut rendre au modèle, pas trancher à sa place.
//
// L'échec NOMME les sections disponibles — même posture que parseSheetSelector
// et decideZipMemberExtraction : c'est ce qui permet au modèle de se re-cibler
// DANS le tour, au lieu d'abandonner ou d'inventer.
function resolveDocxSection(selector, sections) {
  const list = sections || [];
  const raw = String(selector == null ? '' : selector).trim();
  const names = list.map(s => s.label);
  if (!list.length) {
    return { ok: false, message: 'Ce document ne contient aucune section lisible.' };
  }
  if (!raw) {
    return { ok: false, message: 'Selector manquant. Sections disponibles : ' + names.join(' | ') + '.' };
  }

  for (const s of list) { if (s.label === raw) return { ok: true, section: s }; }

  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
  const target = norm(raw);
  for (const s of list) { if (norm(s.label) === target) return { ok: true, section: s }; }

  const starts = list.filter(s => norm(s.label).indexOf(target) === 0);
  if (starts.length === 1) return { ok: true, section: starts[0] };
  if (starts.length > 1) {
    return { ok: false, message: 'Selector ambigu : « ' + raw + ' » désigne ' + starts.length +
      ' sections (' + starts.map(s => s.label).join(' | ') + '). Donne le titre complet.' };
  }

  return { ok: false, message: 'Section introuvable : « ' + raw + ' ». Sections disponibles : ' +
    names.join(' | ') + '. Reprends un titre exactement tel que miaou__docs__list le rend.' };
}

// Listing d'un docx. Une ligne par section, indentée par niveau — la même forme
// que le sommaire de formatPdfListing, pour que deux documents de formats
// différents ne se lisent pas de deux façons.
//
// Les tableaux sont comptés SÉPARÉMENT et annoncés en fin : ils sont désormais
// dans leurs sections (donc lisibles par selector), mais un document dont la
// substance est tabulaire — la fixture réelle en est une — doit le dire, sinon
// un listing de dix titres laisse croire à dix paragraphes.
function formatDocxListing(sections, opts) {
  const o = opts || {};
  const list = sections || [];
  const tables = Math.max(0, Math.floor(Number(o.tables) || 0));
  const head = 'Document Word — ' + list.length + (list.length > 1 ? ' sections' : ' section');
  const out = [head];
  for (const s of list) {
    if (!s) continue;
    const lvl = Math.max(1, Math.floor(Number(s.level) || 1));
    out.push(new Array(lvl).join('  ') + '- ' + s.label);
  }
  if (!list.length) out.push('(document vide ou sans texte extractible)');
  if (tables) out.push('Tableaux : ' + tables + (tables > 1 ? ' tableaux' : ' tableau') +
    ', rendus en lignes « a | b | c » dans la section qui les porte.');
  if (list.length) {
    out.push("Pour lire : miaou__docs__read avec un selector reprenant EXACTEMENT un titre ci-dessus.");
  }
  return out.join('\n');
}

// Mise en forme d'une section lue. Même squelette que formatXlsxRead : un
// en-tête qui nomme l'unité servie, le corps, et une notice de cap qui propose
// la suite au lieu de tronquer en silence.
function formatDocxRead(section, opts) {
  const o = opts || {};
  const s = section || {};
  const label = String(s.label == null ? '' : s.label);
  const body = String(s.text == null ? '' : s.text).replace(/\n{3,}/g, '\n\n').trim();
  const maxChars = Math.max(0, Math.floor(Number(o.maxChars) || 0));

  let text = body;
  let truncated = 0;
  if (maxChars && text.length > maxChars) {
    truncated = text.length - maxChars;
    text = text.slice(0, maxChars);
  }

  let out = '--- Section « ' + label + ' » ---\n' + text;
  if (!body) out += '[Cette section ne contient aucun texte.]';
  if (truncated) {
    out += '\n\n[Lecture limitée aux ' + maxChars + ' premiers caractères : ' + truncated +
      ' caractère(s) non affiché(s). Vise une sous-section plus étroite, ou relance avec ' +
      'as_resource: true pour tout obtenir dans une ressource interrogeable par miaou__js__eval.]';
  }
  if (o.notice) out += String(o.notice);
  return out;
}

// ── PowerPoint : le PUR du chemin pptx (lot V-5, étape 3) ───────────────────
// Seul format du lot sans bibliothèque : aucune n'existe côté JS pour lire un
// .pptx (décision de cadrage), on décortique le zip avec fflate — déjà chargé
// pour le zip — et on parse le XML. Ce qui vit ici est tout ce qui DÉCIDE :
// l'ordre réel des slides, la liaison aux notes, la mise en forme.
//
// Le parsing XML lui-même reste dans tools.js (DOMParser, absent de QuickJS) et
// n'entre PAS dans ces fonctions : elles reçoivent des structures déjà parsées
// (décision 3). L'ordre des slides fait EXCEPTION et travaille sur le XML brut,
// par regex — c'est la garde critique du format, elle devait être testable.

// Ordre RÉEL des slides. `slide1.xml`, `slide2.xml` sont des noms de PIÈCES
// OOXML : l'ordre de présentation vit dans ppt/presentation.xml (<p:sldIdLst>),
// dont chaque <p:sldId r:id="rIdN"/> se résout via ppt/_rels/presentation.xml.rels.
//
// Trier par numéro de fichier marcherait sur une présentation jamais réordonnée
// — et casserait EN SILENCE dès qu'on déplace une slide dans PowerPoint : le
// modèle lirait « slide 3 » en croyant lire la troisième. Silence + plausible
// est le mode de défaillance que ce lot refuse depuis V-1 (le zip chiffré).
// Le deck réel du spike a l'ordre naturel sur ses 71 slides ; un cas qui passe
// ne prouve rien sur le cas qui casse, la résolution reste obligatoire.
//
// L'ordre des ATTRIBUTS n'est pas garanti dans un fichier .rels (mesuré : le
// deck réel écrit Id, Type, Target, un autre outil peut écrire autrement). On
// lit donc chaque <Relationship> en bloc et on y cherche chaque attribut
// séparément, plutôt que de supposer une séquence.
//
// Rend la liste des chemins de pièces, dans l'ordre de présentation. Repli sur
// `fallback` (les noms de pièces triés numériquement) si l'une des deux sources
// manque ou ne résout rien : mieux vaut un ordre probable qu'aucune slide.
function pptxRelationshipMap(relsXml) {
  const map = {};
  const src = String(relsXml == null ? '' : relsXml);
  const re = /<Relationship\b([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    const id = /\bId\s*=\s*"([^"]*)"/.exec(attrs);
    const target = /\bTarget\s*=\s*"([^"]*)"/.exec(attrs);
    const type = /\bType\s*=\s*"([^"]*)"/.exec(attrs);
    if (id && target) {
      map[id[1]] = { target: target[1], type: type ? type[1] : '' };
    }
  }
  return map;
}

// Résout un Target de .rels (relatif à la pièce qui le porte) en chemin de
// pièce absolu dans le zip. `base` est le répertoire du fichier source
// (ex. 'ppt' pour presentation.xml, 'ppt/slides' pour slideN.xml).
function pptxResolveTarget(base, target) {
  const raw = String(target == null ? '' : target);
  if (!raw) return '';
  // Un Target commençant par '/' est absolu AU PACKAGE, pas relatif à la pièce
  // porteuse : le résoudre contre `base` produirait « ppt/ppt/slides/… ».
  const absolute = raw.charAt(0) === '/';
  const t = absolute ? raw.replace(/^\/+/, '') : raw;
  const parts = absolute ? [] : String(base || '').split('/').filter(Boolean);
  for (const seg of t.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function pptxSlideOrder(presentationXml, relsXml, fallback) {
  const fb = (fallback || []).slice();
  const map = pptxRelationshipMap(relsXml);
  const out = [];
  const seen = {};
  const src = String(presentationXml == null ? '' : presentationXml);
  const re = /<p:sldId\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(src))) {
    const rid = /\br:id\s*=\s*"([^"]*)"/.exec(m[1]);
    if (!rid) continue;
    const rel = map[rid[1]];
    if (!rel) continue;
    const path = pptxResolveTarget('ppt', rel.target);
    if (path && !seen[path]) { seen[path] = true; out.push(path); }
  }
  if (!out.length) return fb;

  // Une pièce présente dans le zip mais absente du sldIdLst existe (une slide
  // supprimée dont la pièce survit) : elle n'est PAS de la présentation, on ne
  // l'ajoute pas. L'inverse — un sldId pointant une pièce absente — est filtré
  // par l'appelant, qui seul connaît le contenu du zip.
  return out;
}

// Chemin de la pièce de notes d'une slide, ou ''. La liaison passe par les rels
// de la SLIDE (ppt/slides/_rels/slideN.xml.rels, relation de type notesSlide),
// jamais par le numéro : notesSlide3.xml n'est pas nécessairement la note de la
// troisième slide affichée. Même piège que l'ordre, même garde — il serait
// absurde de résoudre soigneusement l'ordre des slides pour apparier les notes
// au jugé.
function pptxNotesTarget(slideRelsXml) {
  const map = pptxRelationshipMap(slideRelsXml);
  for (const id in map) {
    if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
    if (/\/notesSlide$/.test(map[id].type)) {
      return pptxResolveTarget('ppt/slides', map[id].target);
    }
  }
  return '';
}

// Un titre de slide vaut mieux qu'un extrait, mais 6 slides sur 71 en portent
// un dans le deck réel (mesuré) : un listing qui répond « (sans titre) »
// soixante-cinq fois ne permet pas au modèle de choisir une slide, il le force
// à lire au hasard. D'où le repli sur un extrait BORNÉ du texte de la slide
// (décision 6) — l'information est dans le XML déjà décompressé, elle ne coûte
// aucun appel de plus.
//
// L'extrait vient des BLOCS (shape → a:p → runs), jamais du balayage plat des
// runs : à plat, la même slide donne « Centre », « », « de  », « Cyberdéfense »
// — du bruit à la place d'un repère.
const PPTX_EXCERPT_CHARS = 90;

function pptxSlideExcerpt(blocks, maxChars) {
  const cap = Math.max(10, Math.floor(Number(maxChars) || PPTX_EXCERPT_CHARS));
  const flat = [];
  for (const b of (blocks || [])) {
    const s = String(b == null ? '' : b).replace(/\s+/g, ' ').trim();
    if (s) flat.push(s);
  }
  if (!flat.length) return '';
  let out = flat.join(' · ');
  if (out.length > cap) out = out.slice(0, cap).replace(/\s+\S*$/, '') + '…';
  return out;
}

// Libellé d'une slide au listing : son titre s'il en a un, sinon son extrait,
// sinon la mention de vide. Un seul endroit, parce que le listing l'affiche et
// que rien d'autre ne doit le recalculer.
function pptxSlideLabel(slide) {
  const s = slide || {};
  const title = String(s.title == null ? '' : s.title).replace(/\s+/g, ' ').trim();
  if (title) return title;
  const ex = pptxSlideExcerpt(s.blocks, PPTX_EXCERPT_CHARS);
  if (ex) return ex;
  return '(slide sans texte)';
}

// Listing d'une présentation. Une ligne par slide, NUMÉROTÉE dans l'ordre de
// présentation : c'est le numéro que le modèle recopiera en selector, et le
// selector d'un pptx est un numéro (parsePageSelector, le même 'N'/'N-M' que le
// PDF) — une slide n'a pas de nom stable à viser, contrairement à une feuille
// Excel ou à une section Word.
//
// Les slides porteuses de notes sont marquées : la note porte le propos là où
// la slide porte des mots-clés, et le modèle doit savoir qu'il y a plus à lire
// avant de conclure sur une slide laconique.
function formatPptxListing(slides, opts) {
  const o = opts || {};
  const list = slides || [];
  const head = 'Présentation PowerPoint — ' + list.length +
    (list.length > 1 ? ' slides' : ' slide');
  const out = [head];
  let withNotes = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {};
    if (s.hasNotes) withNotes++;
    out.push((i + 1) + '. ' + pptxSlideLabel(s) + (s.hasNotes ? '  [notes]' : ''));
  }
  if (!list.length) out.push('(présentation vide ou sans texte extractible)');
  if (withNotes) {
    out.push('Notes de présentateur : ' + withNotes + ' slide' + (withNotes > 1 ? 's' : '') +
      ' en porte' + (withNotes > 1 ? 'nt' : '') + ', servies avec la slide par miaou__docs__read.');
  }
  if (o.untitled) {
    out.push('Slides sans titre : ' + o.untitled + ' — la ligne montre alors un extrait de leur texte.');
  }
  if (list.length) {
    out.push("Pour lire : miaou__docs__read avec le NUMÉRO d'une slide (ex. '3') ou une plage (ex. '2-5').");
  }
  return out.join('\n');
}

// Mise en forme d'une ou plusieurs slides lues. Même squelette que
// formatPdfRead (dont le selector est le même 'N'/'N-M') : un en-tête par
// unité, la notice de vide, et rien d'inventé entre les deux.
//
// Les NOTES sont séparées du corps par un intertitre explicite. Sans lui, le
// modèle attribue au public ce qui était destiné au présentateur — c'est le
// point de conception de la décision 5, pas une coquetterie de mise en page.
function formatPptxRead(slides, opts) {
  const o = opts || {};
  const list = slides || [];
  const parts = [];
  const empty = [];
  for (const s of list) {
    const num = Math.floor(Number(s && s.number) || 0);
    const title = String((s && s.title) || '').replace(/\s+/g, ' ').trim();
    const body = String((s && s.text) || '').trim();
    const notes = String((s && s.notes) || '').trim();
    if (!body && !notes) empty.push(num);
    let block = '--- Slide ' + num + (title ? ' — ' + title : '') + ' ---\n' + body;
    if (notes) block += '\n\n--- Notes de présentateur (slide ' + num + ') ---\n' + notes;
    parts.push(block);
  }
  let out = parts.join('\n\n');
  if (empty.length) {
    const quoi = empty.length === list.length
      ? 'Aucune slide de cette plage ne porte de texte'
      : 'Slide(s) sans texte : ' + empty.join(', ');
    out += '\n\n[' + quoi + '. Une slide peut être entièrement composée d\'images ou de ' +
      "diagrammes non textuels : MIAOU ne fait pas d'OCR. Dis-le plutôt que de conclure " +
      'que la présentation est vide.]';
  }
  if (o.notice) out += String(o.notice);
  return out;
}

// Nom du record produit par docs__read(as_resource) sur un pptx : « deck.pptx »
// + slides 2-5 → « deck-s2-5.txt ». Dérive de docReadResourceName comme
// pdfReadResourceName, dont il ne diffère que par la lettre du suffixe — une
// slide n'est pas une page, et deux extraits du même deck ne doivent pas se
// recouvrir dans la bibliothèque.
function pptxReadResourceName(sourceName, start, end) {
  const a = Math.floor(Number(start) || 0);
  const b = Math.floor(Number(end) || 0);
  const suffix = (a && b) ? (a === b ? '-s' + a : '-s' + a + '-' + b) : '';
  return docReadResourceName(sourceName, suffix);
}

// Texte du listing rendu au modèle. `opts.maxBytes` (cap d'inline) sert
// uniquement à ANNONCER qu'un membre dépasse : le listing ne refuse rien, il
// décrit — c'est docs__extract qui refuse. Un total décompressé au-delà du cap
// est signalé sans empêcher l'extraction membre par membre.
function formatZipListing(entries, opts) {
  const o = opts || {};
  const list = entries || [];
  const maxBytes = Number(o.maxBytes) || 0;
  const lines = [];
  const rejected = [];
  let total = 0, files = 0, dirs = 0;

  for (const e of list) {
    if (e.directory) { dirs++; continue; }
    files++;
    total += Number(e.size) || 0;
    if (e.encrypted) {
      rejected.push(e.name + ' — chiffré (protégé par mot de passe), non extractible');
      continue;
    }
    if (isZipSlipPath(e.name)) {
      rejected.push(e.name + ' — chemin non sûr (absolu ou remontant), refusé');
      continue;
    }
    let line = e.name + '  ' + humanSize(e.size);
    if (maxBytes && Number(e.size) > maxBytes) {
      line += '  [au-delà du cap d\'extraction]';
    }
    lines.push(line);
  }

  const out = [];
  const kind = sniffZipOfficeKind(list.map(function(e) { return e.name; }));
  out.push('Archive zip' + (kind ? ' — document Office (' + kind + '), membres XML bruts' : '') +
    ' : ' + files + (files > 1 ? ' membres' : ' membre') +
    (dirs ? ', ' + dirs + (dirs > 1 ? ' répertoires' : ' répertoire') : '') +
    ', ' + humanSize(total) + ' décompressés au total.');
  if (maxBytes && total > maxBytes) {
    out.push('Le total dépasse le cap d\'extraction, mais chaque membre reste extractible individuellement s\'il tient sous le cap.');
  }
  out.push('');
  if (lines.length) out.push(lines.join('\n'));
  else out.push('(aucun membre extractible)');
  if (rejected.length) {
    out.push('');
    out.push('Membres écartés :');
    out.push(rejected.join('\n'));
  }
  return out.join('\n');
}
// Portage de MAX_XLSX_ROWS_DEFAULT (mcp_docs, formats.py) — lot V-5. Ne
// s'applique QU'À une feuille lue SANS plage explicite : un modèle qui écrit
// 'Feuille!A1:C10000' a exprimé une intention, un modèle qui écrit 'Feuille' ne
// sait pas encore qu'elle fait 50 000 lignes. Le cap de CONTEXTE reste
// JS_EVAL_OUTPUT_CAP, appliqué après coup par docs__read : celui-ci est une
// borne de LECTURE, pas de sortie.
const MAX_XLSX_ROWS_DEFAULT = 200;

// Cap de la lecture d'UNE section docx (lot V-5, étape 2). Volontairement SOUS
// JS_EVAL_OUTPUT_CAP, et la marge est fonctionnelle : le texte tronqué emporte
// une notice qui explique la troncature, et la somme doit rester sous le cap du
// handler, sinon celui-ci refuserait la sortie que la troncature venait de
// rendre acceptable.
const MAX_DOCX_SECTION_CHARS = 18000;

// Table de dispatch des lecteurs de documents NATIFS (lot V-4). La STRUCTURE est
// le sujet, pas le contenu : docs__list ne peut plus se contenter de « le parsing
// zip a rendu null, donc ce n'est pas une archive » dès qu'il y a deux familles
// de format. Chaque clé est un type rendu par sniffDocumentKind (pur).
//
// Elle est aussi la SOURCE UNIQUE de « quels formats MIAOU ouvre-t-il seul ? » :
// docsUnsupportedFormatMessage en dérive son libellé au lieu de le recopier —
// sinon le message ment au premier format ajouté, et c'est lui que le modèle lit
// pour décider s'il doit se rabattre sur un serveur.
//
// LE ZIP Y FIGURE, comme tous les autres. Il n'a l'air d'une exception que
// vu du listing, qui parse le central directory à la main sans rien charger —
// mais son extraction, elle, lazy-load fflate exactement comme un PDF chargera
// pdf.js. C'est donc `list` et `read` qui ont des besoins différents, pas le
// zip qui serait d'une autre nature : le sortir de la table réintroduirait
// l'exception que la table existe pour supprimer.
//
// Les trois types Office ont désormais leur lecteur (V-5 : xlsx à l'étape 1,
// docx à l'étape 2, pptx à l'étape 3) : plus aucun ne retombe sur le lecteur
// zip. Chacun reste inscrit EXPLICITEMENT plutôt que laissé en retombée — sinon
// nativeDocKinds() ne l'annoncerait pas, et le message de refus mentirait par
// omission.
//
// Noter que le listing zip d'un Office ne DISPARAÎT pas quand son lecteur
// arrive : il reste accessible par docs__extract, et c'est voulu (inspecter
// word/document.xml, sortir une image embarquée). C'est l'ORIENTATION qui change
// — le lecteur devient le chemin nominal — pas la capacité (V-5-PLAN §4.2).
const DOC_READERS = {
  zip:  { list: listZipDocument },
  docx: { list: listDocxDocument, read: readDocxDocument },
  xlsx: { list: listXlsxDocument, read: readXlsxDocument },
  pptx: { list: listPptxDocument, read: readPptxDocument },
  pdf:  { list: listPdfDocument, read: readPdfDocument },
};

// Les formats que MIAOU ouvre sans serveur, dans l'ordre de déclaration de la
// table — aucune liste tenue en parallèle, sinon elle dérive (c'est tout
// l'objet de la dérivation du message de refus).
function nativeDocKinds() {
  return Object.keys(DOC_READERS);
}
// Lecteur `list` du conteneur zip — entrée zip de DOC_READERS. Il ne sert plus
// qu'au zip depuis V-5 étape 3 : les trois formats Office qui l'empruntaient en
// attendant leur lecteur les ont tous reçus.
// Extrait du handler docs__list lors de l'homogénéisation de la table : le
// chemin est celui de V-1, inchangé, il a seulement changé d'adresse.
//
// Ne charge RIEN : le central directory suffit à nommer et dimensionner les
// membres (AUDIT §2). C'est docs__extract qui lazy-load fflate, au moment où on
// décompresse vraiment.
//
// Pousse son ack lui-même : chaque lecteur est responsable de la trace qu'il
// laisse, parce que ce qu'il y a d'intéressant à tracer dépend du format (un
// nombre de membres ici, un nombre de pages pour un PDF).
function listZipDocument(u8, record, ref) {
  const entries = parseZipCentralDirectory(u8);   // utils.js, pur
  if (!entries) return toolFail('docs__list', docsUnsupportedFormatMessage(record));
  _pendingToolAcks.push({
    kind: 'docs_list', handle: ref, resourceName: record.name,
    count: entries.filter(e => !e.directory).length,
  });
  return formatZipListing(entries, { maxBytes: MAX_INLINE_BYTES });   // pur, plus haut dans ce fichier
}

// Ouverture d'un PDF par pdf.js. Facteur commun de listPdfDocument et
// readPdfDocument : le lazy-load, l'ouverture, et le seul refus MÉTIER du
// format — le mot de passe.
//
// Contrairement à fflate sur un zip chiffré (qui rend des octets bruts en
// prétendant avoir extrait, AUDIT §3 — le piège majeur de V-1), pdf.js DIT
// qu'un document est protégé : il rejette avec `name === 'PasswordException'`.
// Le piège de V-1 ne se reproduit donc pas ici, et c'est pdf.js qui nous
// l'épargne, pas notre vigilance.
//
// Rend { doc } ou { fail } — jamais d'exception : les appelants sont des
// lecteurs de DOC_READERS, et un throw y remonterait en « erreur outil »
// technique alors qu'un PDF protégé est un refus métier ordinaire.
async function openPdfDocument(u8, record, toolName) {
  let lib;
  try {
    lib = await ensurePdfJs();   // ui.js — résout « pdf.js prêt, worker compris »
  } catch (e) {
    return { fail: toolFail(toolName, 'Moteur de lecture PDF indisponible : ' +
      ((e && e.message) || 'chargement impossible') + '. Le chargement se fait depuis un CDN : ' +
      'sans réseau, MIAOU ne peut pas ouvrir de PDF.') };
  }
  try {
    // `data` est consommé (transféré) par pdf.js : on lui passe une COPIE, sinon
    // le record du cache session ressortirait détaché pour tout appel ultérieur.
    const doc = await lib.getDocument({ data: u8.slice() }).promise;
    return { doc };
  } catch (e) {
    if (e && e.name === 'PasswordException') {
      // Refus MÉTIER : result texte non-isError (le modèle doit pouvoir le dire
      // à l'utilisateur sans que la boucle d'outils soit coupée), ack rouge via
      // ok:false — même posture que decideZipMemberExtraction (piège 25).
      _pendingToolAcks.push({ kind: 'docs_list', handle: record && record.id, ok: false,
        resourceName: record && record.name,
        message: 'PDF protégé par mot de passe' });
      return { fail: 'PDF protégé par mot de passe : MIAOU ne peut pas l\'ouvrir. ' +
        'Demande à l\'utilisateur une version non protégée.' };
    }
    return { fail: toolFail(toolName, 'PDF illisible : ' +
      ((e && e.message) || 'structure invalide') + '.') };
  }
}

// Résout UNE destination d'entrée de sommaire en numéro de page 1-based, ou 0
// si elle n'est pas résoluble (lot V-8). Jamais d'exception : le sommaire est
// facultatif et sa résolution l'est encore plus — une entrée qui échoue garde
// son titre et perd son numéro, elle ne fait pas tomber les autres ni le
// listing (posture du lot depuis V-4, où le sommaire entier est déjà enveloppé).
//
// DEUX FORMES DE `dest`, et la seconde n'est pas une hypothèse : elle est
// exercée par la fixture named-dest-toc.pdf (spike V-8).
//   - un TABLEAU [ref, /XYZ, …] déjà résolu — le cas de la plupart des
//     producteurs (vérifié : 372/372 entrées de big-toc.pdf) ;
//   - une CHAÎNE, destination NOMMÉE, qu'il faut passer par getDestination()
//     pour obtenir le tableau. Un nom absent de l'arbre /Names rend null → 0.
// getPageIndex prend la RÉFÉRENCE (dest[0]), jamais le tableau entier.
async function resolveOutlinePage(doc, dest) {
  try {
    const d = (typeof dest === 'string') ? await doc.getDestination(dest) : dest;
    if (!destIsResolvable(d)) return 0;   // pur, juste en dessous
    return outlinePageFromIndex(await doc.getPageIndex(d[0]));   // pur, juste en dessous
  } catch (e) {
    return 0;   // lien externe, destination absente, structure inattendue
  }
}

// Les deux décisions de resolveOutlinePage, sorties en PURES pour être testables
// (le runner QuickJS n'exécute pas d'async, et un stub de `doc` ne prouverait
// que le stub — mémoire project_extract_pure_helper_over_idb_stub). Ce qui reste
// dans la fonction async ci-dessus est le seul enchaînement d'awaits, sans
// arithmétique ni cas limite.

// Une destination exploitable est un TABLEAU non vide dont le premier élément
// est la référence de page. Tout le reste (null d'un nom absent, chaîne non
// résolue, tableau vide d'un lien externe) n'en est pas une.
function destIsResolvable(d) {
  return Array.isArray(d) && d.length > 0 && d[0] != null;
}

// getPageIndex rend un index 0-based ; formatPdfListing veut un numéro 1-based
// et traite 0 comme « pas de numéro ». Un index non numérique ou négatif
// (producteur exotique) retombe donc sur 0 plutôt que de produire « p.NaN ».
//
// LE TEST DE TYPE EST EN PREMIER, ET IL EST OBLIGATOIRE : Number(null) vaut 0
// (comme Number(''), Number(false), Number([])), donc un simple Math.floor(Number(idx))
// laisse passer null en 0 → l'entrée non résoluble ressortirait « p.1 », un
// numéro FAUX là où on voulait pas de numéro. Piège attrapé par le test dédié
// au premier lancement — c'est précisément pourquoi ces cas limites sont sortis
// en fonction pure.
function outlinePageFromIndex(idx) {
  if (typeof idx !== 'number' || !isFinite(idx)) return 0;
  const n = Math.floor(idx);
  return n >= 0 ? n + 1 : 0;
}

// Lecteur `list` du PDF — entrée pdf de DOC_READERS (lot V-4).
// Rend le compte de pages, les métadonnées et le sommaire. Les métadonnées sont
// un GAIN (le serveur n'en rend aucune) — le producteur en particulier oriente
// la lecture, un PDF sorti de PowerPoint ne se lit pas comme un rapport LaTeX.
//
// LE SOMMAIRE PORTE SES NUMÉROS DE PAGE (lot V-8, parité rétablie). getOutline()
// rend un arbre dont chaque nœud porte une DESTINATION (`dest`), pas un numéro :
// c'est resolveOutlinePage (ci-dessous) qui le résout. Jusqu'à V-8 le champ
// `page` était posé à 0 et formatPdfListing omettait le préfixe — le sommaire
// donnait la hiérarchie et les titres mais PAS les pages, là où get_toc() de
// pymupdf rend des triplets (level, title, page) et où le serveur imprime
// « - p.42 Titre » (mcp_docs/formats.py, pdf_list). C'était le seul écart de
// parité du lot V, et il avait survécu à V-4 parce qu'un commentaire ici
// affirmait l'équivalence exacte avec get_toc().
//
// AUCUNE BORNE, et c'est MESURÉ, pas supposé (spike-v8-pdf.mjs, 2026-08-29) :
// les résolutions partent en UN Promise.all, ce qui coûte 1,4 ms pour 372
// entrées sur trois niveaux (fixture big-toc.pdf). Le repli séquentiel mesuré à
// 6,5 ms serait lui aussi indolore — l'ouverture du document et le lazy-load
// CDN de pdf.js dominent de plusieurs ordres de grandeur. Une borne
// (« résoudre les N premières ») avait été envisagée puis abandonnée : elle
// aurait coûté un message de troncature et un sommaire hétérogène pour
// économiser une milliseconde.
async function listPdfDocument(u8, record, ref) {
  const opened = await openPdfDocument(u8, record, 'docs__list');
  if (opened.fail) return opened.fail;
  const doc = opened.doc;
  try {
    const pages = doc.numPages;
    let meta = null, outline = null;
    // Métadonnées et sommaire sont FACULTATIFS : un PDF sans l'un ni l'autre est
    // parfaitement valide. Leur échec ne doit jamais faire échouer le listing —
    // le compte de pages, lui, est toujours là.
    try { meta = await doc.getMetadata(); } catch (e) { meta = null; }
    try { outline = await doc.getOutline(); } catch (e) { outline = null; }
    const info = (meta && meta.info) || {};
    const flat = [];
    // getOutline() rend un arbre (chaque entrée a ses `items`) là où
    // formatPdfListing attend une liste plate portant son niveau. L'aplatissage
    // est ITÉRATIF : un sommaire profond ne doit pas faire sauter la pile.
    const stack = [];
    for (let i = (outline || []).length - 1; i >= 0; i--) stack.push({ node: outline[i], level: 1 });
    while (stack.length) {
      const cur = stack.pop();
      const n = cur.node;
      if (!n) continue;
      // `dest` est gardée telle quelle ici : la résolution en numéro de page se
      // fait APRÈS l'aplatissage, en un seul Promise.all (cf. en-tête).
      flat.push({ level: cur.level, title: n.title, page: 0, dest: n.dest });
      const kids = n.items || [];
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], level: cur.level + 1 });
    }
    // Résolution des numéros de page, toutes entrées en parallèle. Chaque
    // entrée est indépendante : une destination non résoluble laisse SON page à
    // 0 (titre conservé, préfixe omis) sans affecter les autres — cf.
    // resolveOutlinePage.
    const resolved = await Promise.all(flat.map(function (e) {
      return resolveOutlinePage(doc, e.dest);
    }));
    for (let i = 0; i < flat.length; i++) {
      flat[i].page = resolved[i];
      delete flat[i].dest;   // formatPdfListing ne lit que level/title/page
    }
    _pendingToolAcks.push({
      kind: 'docs_list', handle: ref, resourceName: record.name, count: pages,
    });
    return formatPdfListing({          // pur, plus haut dans ce fichier
      pages, outline: flat,
      title: info.Title, author: info.Author, producer: info.Producer,
    });
  } finally {
    // pdf.js garde un worker et des buffers vivants tant que le document ne l'est
    // plus : le libérer est obligatoire, et dans un finally pour que l'échec
    // d'une des lectures facultatives ne fuie pas le document.
    try { doc.destroy(); } catch (e) { /* rien à rattraper */ }
  }
}

// ── Rendu image d'une page PDF (lot V-8) ─────────────────────────────────────
// Paramètres du rendu, TOUS mesurés au spike (spike-v8-pdf.mjs, 2026-08-29) et
// non estimés.
//
// PDF_RENDER_SCALES : le viewport pdf.js est à 72 dpi, donc scale 2 ≈ 144 dpi —
// l'ordre de grandeur visé (« 150 dpi », décision Julien). Les deux échelles
// suivantes sont un FILET pour les pages hors normes (plan A0, poster scanné) :
// une page moins définie reste lisible là où un abandon sec fermerait la porte.
// Aucune fixture ne les déclenche : le pire cas mesuré (A4 scannée pleine page)
// pèse 1,50 Mo, soit 37 % du cap.
//
// PDF_RENDER_MAX_B64 : le cap porte sur la dataUrl BASE64, parce que c'est elle
// qui part dans le contexte du modèle — pas les octets bruts (~×1,33 de moins).
// Il est très en dessous de MAX_INLINE_BYTES (64 Mo) et de JS_EVAL_MEM_BYTES
// (256 Mo) : aucune contradiction garde d'entrée / capacité aval (mémoire
// feedback_entry_guard_vs_downstream_capacity). La borne réelle n'est pas la
// mémoire, c'est le contexte — d'où sa petitesse.
//
// PNG et pas JPEG, CONFIRMÉ par la mesure : le ratio est de ×3,6 à ×4,7 en
// faveur du JPEG, mais ses artefacts de compression dégradent exactement le
// matériau qu'on demande au modèle de déchiffrer (texte fin d'un scan). La
// condition qui aurait fait basculer (« PNG déborde régulièrement le cap ») ne
// se réalise pas.
const PDF_RENDER_SCALES = [2, 1.5, 1];
const PDF_RENDER_MAX_B64 = 4 * 1024 * 1024;

// Nom du record d'une page rendue : « rapport.pdf » + page 3 → « rapport-p3.png ».
// Même esprit que pdfReadResourceName (extension remplacée, pas accolée), pour
// que l'utilisateur reconnaisse le document dans la vignette et le lightbox.
function pdfRenderResourceName(sourceName, pageNum) {
  const base = String(sourceName || 'document').replace(/\.[^.]*$/, '');
  return base + '-p' + Math.floor(Number(pageNum) || 0) + '.png';
}

// Extrait la charge base64 d'une dataUrl (« data:image/png;base64,AAA… » → « AAA… »).
// PUR. Rend '' si la chaîne n'est pas une dataUrl base64 — l'appelant traite ce
// cas comme un échec plutôt que de stocker un record vide.
//
// Séparé de base64ToArrayBuffer (resources.js), qui attend du base64 NU : lui
// passer la dataUrl entière « marcherait » en apparence, son filtre de
// caractères mangeant le préfixe — mais « data:image/png;base64 » contient des
// lettres valides en base64 (« dataimagepngbase »), qui décaleraient tout le
// flux d'octets. Un octet de décalage sur un PNG, et l'image est illisible.
function dataUrlBase64Payload(dataUrl) {
  const s = String(dataUrl || '');
  const i = s.indexOf(';base64,');
  return i < 0 ? '' : s.slice(i + 8);
}

// Rend UNE page en PNG. Rend { dataUrl, w, h, scale } ou { fail } — jamais
// d'exception, même forme que les lecteurs de DOC_READERS.
//
// Le <canvas> est DÉTACHÉ (document.createElement, jamais inséré) et non un
// OffscreenCanvas : les deux marchent avec pdf.js 3.11.174 (vérifié au spike),
// mais OffscreenCanvas n'a pas toDataURL — il faut convertToBlob() + FileReader,
// soit un await de plus pour rien.
//
// La dégradation d'échelle re-rend sur un canvas NEUF à chaque tour : réutiliser
// le précédent laisserait les pixels de l'échelle supérieure sous une page
// transparente.
async function renderPdfPageImage(u8, record, pageNum) {
  const opened = await openPdfDocument(u8, record, 'docs__render_page');
  if (opened.fail) return { fail: opened.fail };
  const doc = opened.doc;
  try {
    const total = doc.numPages;
    const n = Math.floor(Number(pageNum) || 0);
    if (!(n >= 1 && n <= total)) {
      return { fail: toolFail('docs__render_page', 'Page ' + (pageNum == null ? '?' : pageNum) +
        ' hors document (' + total + (total > 1 ? ' pages).' : ' page).')) };
    }
    const page = await doc.getPage(n);
    try {
      let last = null;
      for (const scale of PDF_RENDER_SCALES) {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        last = { dataUrl, w: canvas.width, h: canvas.height, scale };
        if (dataUrl.length <= PDF_RENDER_MAX_B64) return last;
      }
      // Toutes les échelles débordent : REFUS explicite plutôt que de pousser
      // 4 Mo+ dans le contexte (doctrine du cap js__eval, piège 25 — refuser,
      // jamais tronquer). Le message dit le poids ET la sortie.
      return { fail: toolFail('docs__render_page', 'Page ' + n + ' trop lourde à rendre : ' +
        Math.round(last.dataUrl.length / 1024 / 1024) + ' Mo même à la plus basse résolution, ' +
        'au-delà de la limite de ' + Math.round(PDF_RENDER_MAX_B64 / 1024 / 1024) + ' Mo. ' +
        'Essaie une autre page, ou lis son texte avec miaou__docs__read.') };
    } finally {
      try { page.cleanup(); } catch (e) { /* rien à rattraper */ }
    }
  } catch (e) {
    return { fail: toolFail('docs__render_page', 'Rendu impossible : ' +
      ((e && e.message) || 'erreur de rendu') + '.') };
  } finally {
    try { doc.destroy(); } catch (e) { /* rien à rattraper */ }
  }
}

// Lecteur `read` du PDF — la lecture paginée (V-4 décision 2, option (c)).
// Le selector est parsé AVANT l'ouverture ? Non : il faut le total de pages pour
// le borner, donc l'ouverture précède. C'est le seul ordre possible, et il fait
// qu'un selector invalide coûte un chargement de pdf.js — accepté, parce que
// l'inverse (refuser sans connaître le document) empêcherait le clamp.
async function readPdfDocument(u8, record, ref, selector) {
  const opened = await openPdfDocument(u8, record, 'docs__read');
  if (opened.fail) return opened.fail;
  const doc = opened.doc;
  try {
    const range = parsePageSelector(selector, doc.numPages);   // pur, plus haut dans ce fichier
    if (!range.ok) return toolFail('docs__read', range.message);
    const pages = [];
    for (let n = range.start; n <= range.end; n++) {
      const page = await doc.getPage(n);
      try {
        const tc = await page.getTextContent();
        pages.push({ page: n, text: joinPdfTextItems(tc && tc.items) });   // pur, plus haut dans ce fichier
      } finally {
        try { page.cleanup(); } catch (e) { /* rien à rattraper */ }
      }
    }
    // `label` (selector normalisé, ce qui a EFFECTIVEMENT été servi après clamp)
    // et `resourceName` sont fournis PAR LE LECTEUR depuis V-5 : le handler ne
    // sait pas ce qu'est une unité de ce format-ci, et une feuille Excel ne se
    // nomme ni ne se dénombre comme une page. Un lecteur qui ne les fournirait
    // pas laisserait le handler inventer un libellé faux.
    return {   // purs, plus haut dans ce fichier
      text: formatPdfRead(pages, { notice: range.notice }),
      label: range.start + '-' + range.end,
      resourceName: pdfReadResourceName(record.name, range.start, range.end),
    };
  } finally {
    try { doc.destroy(); } catch (e) { /* rien à rattraper */ }
  }
}

// Ouverture d'un classeur par SheetJS. Facteur commun de listXlsxDocument et
// readXlsxDocument — même forme qu'openPdfDocument : rend { wb } ou { fail },
// JAMAIS d'exception (un throw remonterait en erreur technique là où un fichier
// illisible est un refus ordinaire dont le modèle doit pouvoir parler).
//
// Différence avec pdf.js, mesurée et non supposée : SheetJS ne détache pas le
// buffer (spike V-5), donc pas de u8.slice() ici. Et il n'a rien à libérer — pas
// de worker, pas de handle natif : aucun équivalent de doc.destroy() n'existe,
// vérifié avant de conclure plutôt que déduit de l'absence de doc.
//
// Un classeur protégé n'a PAS l'équivalent du PasswordException de pdf.js :
// SheetJS lève une erreur ordinaire. On la reconnaît sur son message pour rendre
// un refus métier lisible, avec repli sur l'erreur générique — reconnaître un
// message est fragile, d'où le repli, mais le silence serait pire.
async function openXlsxDocument(u8, record, toolName) {
  let lib;
  try {
    lib = await ensureSheetJs();   // ui.js
  } catch (e) {
    return { fail: toolFail(toolName, 'Moteur de lecture Excel indisponible : ' +
      ((e && e.message) || 'chargement impossible') + '. Le chargement se fait depuis un CDN : ' +
      'sans réseau, MIAOU ne peut pas ouvrir de classeur.') };
  }
  try {
    const wb = lib.read(u8, { type: 'array' });
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
      return { fail: toolFail(toolName, 'Classeur sans aucune feuille lisible.') };
    }
    return { wb: wb, lib: lib };
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/password|encrypt/i.test(msg)) {
      _pendingToolAcks.push({ kind: 'docs_list', handle: record && record.id, ok: false,
        resourceName: record && record.name,
        message: 'Classeur protégé par mot de passe' });
      return { fail: 'Classeur Excel protégé par mot de passe : MIAOU ne peut pas l\'ouvrir. ' +
        'Demande à l\'utilisateur une version non protégée.' };
    }
    return { fail: toolFail(toolName, 'Classeur illisible : ' + (msg || 'structure invalide') + '.') };
  }
}

// Lecteur `list` du xlsx — entrée xlsx de DOC_READERS (lot V-5).
// Rend une feuille par ligne AVEC sa dimension : c'est ce dont le modèle a
// besoin pour écrire son selector. Sans la dimension il demande 'A1:Z100' au
// jugé, et tombe dans le cas que restrictSheetRange doit rattraper.
async function listXlsxDocument(u8, record, ref) {
  const opened = await openXlsxDocument(u8, record, 'docs__list');
  if (opened.fail) return opened.fail;
  const wb = opened.wb;
  const sheets = [];
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    const refA1 = (sh && sh['!ref']) ? String(sh['!ref']) : '';
    const r = refA1 ? parseA1Range(refA1) : null;   // pur, plus haut dans ce fichier
    sheets.push({
      name: name,
      ref: refA1,
      rows: r ? (r.e.r - r.s.r + 1) : 0,
      cols: r ? (r.e.c - r.s.c + 1) : 0,
    });
  }
  _pendingToolAcks.push({
    kind: 'docs_list', handle: ref, resourceName: record.name, count: sheets.length,
  });
  return formatXlsxListing(sheets);   // pur, plus haut dans ce fichier
}

// Lecteur `read` du xlsx (lot V-5). Le selector est 'Feuille' ou
// 'Feuille!A1:C10' — PAS le 'N'/'N-M' du PDF : une feuille se désigne par son
// nom, et forcer un index serait demander au modèle de compter des feuilles
// qu'il a sous les yeux nommées.
//
// Le rendu passe par le CLONE À !ref RESTREINT et jamais par l'option `range` de
// sheet_to_csv, qui est SILENCIEUSEMENT IGNORÉE en 0.18.5 (spike V-5, figé par
// un contrôle) : elle rendrait la feuille entière en ayant l'air d'avoir servi
// la plage. Ne pas « simplifier » vers l'option native sans rejouer le spike.
async function readXlsxDocument(u8, record, ref, selector) {
  const opened = await openXlsxDocument(u8, record, 'docs__read');
  if (opened.fail) return opened.fail;
  const wb = opened.wb, lib = opened.lib;

  const sel = parseSheetSelector(selector, wb.SheetNames);   // pur, plus haut dans ce fichier
  if (!sel.ok) return toolFail('docs__read', sel.message);

  const sheet = wb.Sheets[sel.sheet];
  const sheetRef = (sheet && sheet['!ref']) ? String(sheet['!ref']) : '';
  if (!sheetRef) {
    // Feuille présente mais vide : ce n'est pas une erreur, et le dire vaut
    // mieux que rendre une chaîne vide dont le modèle conclurait n'importe quoi.
    return {
      text: formatXlsxRead('', { sheet: sel.sheet, ref: '' }),
      label: sel.sheet,
      resourceName: docReadResourceName(record.name, slugifyResourceSuffix(sel.sheet)),
    };
  }

  const restricted = restrictSheetRange(sheetRef, sel.range);   // pur, plus haut dans ce fichier
  if (restricted.fail) return toolFail('docs__read', restricted.fail);

  // Le clone est SUPERFICIEL et volontairement : les cellules sont partagées,
  // seule la clé '!ref' est réécrite. Copier les cellules d'une feuille de
  // 50 000 lignes pour n'en lire que dix serait absurde.
  const view = Object.assign({}, sheet, { '!ref': restricted.ref });
  const csv = lib.utils.sheet_to_csv(view);

  return {
    text: formatXlsxRead(csv, {          // pur, plus haut dans ce fichier
      sheet: sel.sheet, ref: restricted.ref,
      // Le cap de lignes ne mord QUE sans plage explicite (cf. la constante).
      maxRows: sel.range ? 0 : MAX_XLSX_ROWS_DEFAULT,
      notice: restricted.notice,
    }),
    // Le label porte la plage EFFECTIVEMENT servie, pas celle demandée : c'est
    // ce qui s'affiche dans l'ack, et un ack qui annonce la demande plutôt que
    // le service ment dès qu'un clamp a mordu.
    label: sel.sheet + '!' + restricted.ref,
    resourceName: docReadResourceName(record.name,
      slugifyResourceSuffix(sel.sheet + ' ' + restricted.ref)),
  };
}

// Ouverture d'un .docx par mammoth. Même forme qu'openPdfDocument et
// openXlsxDocument : rend { blocks, sections, tables } ou { fail }, JAMAIS
// d'exception.
//
// Le facteur commun va PLUS LOIN ici que pour les deux autres formats : il ne
// s'arrête pas à l'objet de la bibliothèque mais va jusqu'aux sections. La
// raison est que `list` et `read` ont besoin EXACTEMENT de la même chose — la
// découpe — et que les faire diverger ferait afficher au listing des titres que
// le selector ne saurait pas viser. Le listing montre ce que le read sait
// atteindre parce que les deux dérivent d'un seul appel (mémoire
// project_what_model_sees_equals_what_it_can_touch).
//
// mammoth ne connaît pas de document « protégé » à la façon d'un PDF ou d'un
// classeur : un .docx chiffré n'est plus un zip OOXML lisible, et il échoue à
// l'ouverture. Le message le dit sans promettre de distinguer les deux cas.
async function openDocxDocument(u8, record, toolName) {
  let lib;
  try {
    lib = await ensureMammoth();   // ui.js
  } catch (e) {
    return { fail: toolFail(toolName, 'Moteur de lecture Word indisponible : ' +
      ((e && e.message) || 'chargement impossible') + '. Le chargement se fait depuis un CDN : ' +
      'sans réseau, MIAOU ne peut pas ouvrir de document Word.') };
  }

  let html;
  try {
    // mammoth veut un ArrayBuffer. u8.buffer est passé TEL QUEL (pas de slice) :
    // mesuré au spike, mammoth ne détache pas. Mais u8 peut être une VUE
    // partielle d'un buffer plus grand — d'où byteOffset/byteLength, qui coûtent
    // une copie seulement dans ce cas-là.
    const ab = (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength)
      ? u8.buffer
      : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const res = await lib.convertToHtml({ arrayBuffer: ab });
    html = (res && res.value) || '';
  } catch (e) {
    return { fail: toolFail(toolName, 'Document Word illisible : ' +
      ((e && e.message) || 'structure invalide') + '. Un .docx protégé par mot de passe ' +
      "n'est plus une archive OOXML lisible et échoue ici : demande à l'utilisateur " +
      'une version non protégée si c\'est le cas.') };
  }

  const blocks = docxHtmlToBlocks(html);        // pur, plus haut dans ce fichier
  const sections = docxSections(blocks);        // pur, plus haut dans ce fichier
  let tables = 0;
  for (const b of blocks) { if (b && b.type === 'table') tables++; }
  return { blocks: blocks, sections: sections, tables: tables };
}

// Lecteur `list` du docx — entrée docx de DOC_READERS (lot V-5, étape 2).
// Remplace listZipDocument, qui rendait jusqu'ici la mécanique interne du
// conteneur OOXML (word/document.xml, [Content_Types].xml…) : exact, et sans
// aucun intérêt pour qui veut lire le document. Le listing d'un .docx par ses
// membres zip reste atteignable, mais il n'est plus ce qu'on sert par défaut.
async function listDocxDocument(u8, record, ref) {
  const opened = await openDocxDocument(u8, record, 'docs__list');
  if (opened.fail) return opened.fail;
  _pendingToolAcks.push({
    kind: 'docs_list', handle: ref, resourceName: record.name, count: opened.sections.length,
  });
  return formatDocxListing(opened.sections, { tables: opened.tables });   // pur, plus haut dans ce fichier
}

// Lecteur `read` du docx (lot V-5, étape 2). Le selector est le TITRE d'une
// section, tel que le listing l'a rendu — ni un numéro (le modèle aurait à
// compter des titres qu'il a sous les yeux nommés), ni un chemin.
//
// Le cap de sortie est appliqué ICI plutôt que laissé au handler, et c'est le
// seul lecteur du lot dans ce cas. Le handler REFUSE au-delà de
// JS_EVAL_OUTPUT_CAP, ce qui est juste pour une plage de pages ou de cellules
// demandée explicitement — le modèle n'a qu'à en demander moins. Mais une
// section est la plus PETITE unité qu'un docx offre : un document dont une
// section dépasse à elle seule le cap n'aurait alors aucun selector lisible, et
// le refus serait un cul-de-sac. On tronque donc en le disant, et la notice
// propose as_resource, qui n'a pas de cap.
//
// La marge (MAX_DOCX_SECTION_CHARS < JS_EVAL_OUTPUT_CAP) est ce qui rend cette
// troncature effective : sans elle, le texte tronqué PLUS sa notice repasserait
// au-dessus du cap et le handler refuserait quand même — la garde se serait
// annulée elle-même.
async function readDocxDocument(u8, record, ref, selector) {
  const opened = await openDocxDocument(u8, record, 'docs__read');
  if (opened.fail) return opened.fail;

  const res = resolveDocxSection(selector, opened.sections);   // pur, plus haut dans ce fichier
  if (!res.ok) return toolFail('docs__read', res.message);

  return {
    text: formatDocxRead(res.section, { maxChars: MAX_DOCX_SECTION_CHARS }),   // pur, plus haut dans ce fichier
    // Le label est le titre CANONIQUE de la section (celui du listing), pas le
    // selector brut : un modèle qui a visé par préfixe ou à la casse près doit
    // lire dans l'ack ce qui a RÉELLEMENT été servi.
    label: res.section.label,
    resourceName: docReadResourceName(record.name, slugifyResourceSuffix(res.section.label)),
  };
}

// Ouverture d'une présentation PowerPoint (lot V-5, étape 3). Même forme
// qu'openPdfDocument / openXlsxDocument / openDocxDocument : rend
// { slides, untitled } ou { fail }, JAMAIS d'exception.
//
// SEUL FORMAT DU LOT SANS BIBLIOTHÈQUE : aucune n'existe côté JS pour lire un
// .pptx (décision de cadrage), on décortique le zip avec fflate — déjà chargé
// pour le chemin zip, donc AUCUN artefact nouveau — et on parse le XML avec
// DOMParser, présent nativement dans le navigateur.
//
// Le facteur commun va jusqu'aux slides complètes, comme openDocxDocument va
// jusqu'aux sections, et pour la même raison : `list` et `read` ont besoin de
// la MÊME découpe. Les faire diverger ferait afficher au listing un extrait que
// la lecture ne rendrait pas (mémoire project_what_model_sees_equals_what_it_can_touch).
//
// unzipSync est FILTRÉ : on ne décompresse que les slides, leurs rels, les
// notes et presentation.xml — pas les médias, qui sont l'essentiel du poids
// d'un deck (551 ko pour 71 slides dans la fixture réelle, dont presque tout en
// images et objets OLE).
async function openPptxDocument(u8, record, toolName) {
  let lib;
  try {
    lib = await ensureFflate();   // ui.js — AUCUN artefact nouveau, cf. supra
  } catch (e) {
    return { fail: toolFail(toolName, 'Moteur de décompression indisponible : ' +
      ((e && e.message) || 'chargement impossible') + '. Le chargement se fait depuis un CDN : ' +
      'sans réseau, MIAOU ne peut pas ouvrir de présentation.') };
  }

  let files;
  try {
    files = lib.unzipSync(u8, {
      filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name)
        || /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(f.name)
        || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f.name)
        || f.name === 'ppt/presentation.xml'
        || f.name === 'ppt/_rels/presentation.xml.rels',
    });
  } catch (e) {
    // Un .pptx protégé n'est plus une archive OOXML lisible (même situation que
    // le .docx chiffré) : fflate échoue à l'ouverture. Le message le dit sans
    // promettre de distinguer les deux cas.
    return { fail: toolFail(toolName, 'Présentation illisible : ' +
      ((e && e.message) || 'structure invalide') + '. Un .pptx protégé par mot de passe ' +
      "n'est plus une archive OOXML lisible et échoue ici : demande à l'utilisateur " +
      'une version non protégée si c\'est le cas.') };
  }

  const dec = new TextDecoder();
  const txt = (name) => (files[name] ? dec.decode(files[name]) : '');

  // Ordre RÉEL, jamais l'ordre des fichiers (pptxSlideOrder, pur et
  // testé) — la garde critique du format. Le fallback est le tri NUMÉRIQUE des
  // pièces : 'slide10.xml' < 'slide9.xml' en tri lexical, et un deck de plus de
  // neuf slides sortirait mélangé sans que rien ne le signale.
  const present = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  present.sort((a, b) => (parseInt(a.replace(/\D+/g, ''), 10) || 0) - (parseInt(b.replace(/\D+/g, ''), 10) || 0));
  const ordered = pptxSlideOrder(txt('ppt/presentation.xml'),   // pur, plus haut dans ce fichier
    txt('ppt/_rels/presentation.xml.rels'), present)
    .filter((n) => !!files[n]);   // un sldId pointant une pièce absente du zip

  let parser;
  try {
    parser = new DOMParser();
  } catch (e) {
    return { fail: toolFail(toolName, 'Analyseur XML indisponible dans ce navigateur.') };
  }

  const slides = [];
  let untitled = 0;
  for (const name of ordered) {
    const doc = parser.parseFromString(txt(name), 'application/xml');
    const blocks = pptxShapeBlocks(doc);
    const title = pptxSlideTitle(doc);
    if (!title) untitled++;

    // La note se trouve par les RELS de la slide, jamais par son numéro
    // (pptxNotesTarget, pur) : notesSlide3.xml n'est pas
    // nécessairement la note de la troisième slide affichée.
    const relsName = name.replace(/^(.*)\/([^/]+)$/, '$1/_rels/$2.rels');
    const notesPath = pptxNotesTarget(txt(relsName));   // pur, plus haut dans ce fichier
    let notes = '';
    if (notesPath && files[notesPath]) {
      const nd = parser.parseFromString(txt(notesPath), 'application/xml');
      notes = pptxShapeBlocks(nd, { skipPlaceholders: PPTX_NOTES_SKIP_PH }).join('\n').trim();
    }

    slides.push({ name: name, title: title, blocks: blocks, notes: notes, hasNotes: !!notes });
  }
  return { slides: slides, untitled: untitled };
}

// Placeholders d'une pièce de notes qui ne PORTENT PAS de propos : l'image de
// la diapositive et le numéro de slide. Ce dernier est le piège concret —
// mesuré sur la fixture réelle, dont les quatre notesSlides sont VIDES mais
// contiennent un champ `a:fld` de numérotation : un balayage naïf rendrait « 1 »
// comme note de présentateur, ce qui est du bruit présenté comme du propos.
const PPTX_NOTES_SKIP_PH = ['sldNum', 'sldImg', 'ftr', 'dt'];

// Découpe d'une slide en blocs de texte : shape → paragraphe (a:p) → runs.
// C'EST la décision d'implémentation du format, et elle a été MESURÉE sur le
// deck réel (V-5-PLAN §3.1 bis), pas devinée :
//   - balayage plat des a:t  → 160 fragments « Centre », « », « de  »… illisible,
//     les runs étant coupés par les changements de mise en forme ;
//   - par shape, runs collés  → « Risques ITMarc GUIDAT », libellé et personne collés ;
//   - shape → a:p → runs      → « Risques IT\nMarc GUIDAT », le bon niveau.
// Un balayage plat produirait la bouillie de fragments qu'on reproche au
// serveur, à l'envers : lui perd du texte, elle en rend trop peu structuré.
//
// Le parcours descend DANS les p:grpSp (shapes groupées), et c'est le gain net
// du format : python-pptx n'itère pas dans les groupes, donc le serveur perd
// 83 des 160 fragments de l'organigramme de la fixture — soit exactement les
// noms et rattachements pour lesquels on ouvre ce fichier.
//
// Les tableaux (a:tbl d'un p:graphicFrame) sont rendus en lignes « a | b | c »,
// même forme que htmlTableToText côté docx : un deck de format différent ne doit
// pas se lire d'une autre façon.
function pptxShapeBlocks(doc, opts) {
  const o = opts || {};
  const skip = o.skipPlaceholders || null;
  const out = [];
  const root = doc && doc.documentElement;
  if (!root) return out;

  const paragraphsOf = (el) => {
    const paras = [];
    const ps = el.getElementsByTagName('a:p');
    for (let i = 0; i < ps.length; i++) {
      const ts = ps[i].getElementsByTagName('a:t');
      let line = '';
      for (let j = 0; j < ts.length; j++) line += (ts[j].textContent || '');
      if (line.trim()) paras.push(line);
    }
    return paras;
  };

  const walk = (el) => {
    for (let i = 0; i < el.childNodes.length; i++) {
      const ch = el.childNodes[i];
      if (!ch || ch.nodeType !== 1) continue;
      const tag = ch.nodeName;
      if (tag === 'p:sp') {
        if (skip) {
          const ph = ch.getElementsByTagName('p:ph')[0];
          const ty = ph && ph.getAttribute('type');
          if (ty && skip.indexOf(ty) >= 0) continue;
        }
        const paras = paragraphsOf(ch);
        if (paras.length) out.push(paras.join('\n'));
      } else if (tag === 'p:grpSp') {
        walk(ch);   // le sous-arbre d'un groupe porte des p:sp ordinaires
      } else if (tag === 'p:graphicFrame') {
        const tbls = ch.getElementsByTagName('a:tbl');
        for (let t = 0; t < tbls.length; t++) {
          const rows = [];
          const trs = tbls[t].getElementsByTagName('a:tr');
          for (let r = 0; r < trs.length; r++) {
            const cells = [];
            const tcs = trs[r].getElementsByTagName('a:tc');
            for (let c = 0; c < tcs.length; c++) cells.push(paragraphsOf(tcs[c]).join(' ').trim());
            rows.push(cells.join(' | '));
          }
          if (rows.length) out.push(rows.join('\n'));
        }
      } else {
        walk(ch);
      }
    }
  };
  walk(root);
  return out;
}

// Titre d'une slide : le p:sp dont le p:ph porte type="title" ou "ctrTitle" —
// la règle EXACTE de slide.shapes.title de python-pptx, donc la parité stricte
// avec le serveur sur ce point. Rend '' quand la slide n'en a pas, et c'est le
// cas le plus fréquent : 6 slides titrées sur 71 dans la fixture réelle, d'où
// le repli sur un extrait au listing (décision 6).
function pptxSlideTitle(doc) {
  const root = doc && doc.documentElement;
  if (!root) return '';
  const sps = root.getElementsByTagName('p:sp');
  for (let i = 0; i < sps.length; i++) {
    const ph = sps[i].getElementsByTagName('p:ph')[0];
    const ty = ph && ph.getAttribute('type');
    if (ph && (ty === 'title' || ty === 'ctrTitle')) {
      const ts = sps[i].getElementsByTagName('a:t');
      let s = '';
      for (let j = 0; j < ts.length; j++) s += (ts[j].textContent || '');
      if (s.trim()) return s.trim();
    }
  }
  return '';
}

// Lecteur `list` du pptx — entrée pptx de DOC_READERS (lot V-5, étape 3).
// Remplace listZipDocument, qui rendait la mécanique interne du conteneur
// OOXML. Le listing zip d'un .pptx reste atteignable par docs__extract, il
// n'est simplement plus ce qu'on sert par défaut (V-5-PLAN §4.2).
async function listPptxDocument(u8, record, ref) {
  const opened = await openPptxDocument(u8, record, 'docs__list');
  if (opened.fail) return opened.fail;
  _pendingToolAcks.push({
    kind: 'docs_list', handle: ref, resourceName: record.name, count: opened.slides.length,
  });
  return formatPptxListing(opened.slides, { untitled: opened.untitled });   // pur, plus haut dans ce fichier
}

// Lecteur `read` du pptx (lot V-5, étape 3). Le selector est le NUMÉRO d'une
// slide ('3') ou une plage ('2-5') — le même parsePageSelector que le PDF, et
// réutilisé tel quel : une slide n'a pas de nom stable à viser (six sur
// soixante-onze portent un titre), contrairement à une feuille Excel ou à une
// section Word. Le numéro est celui de l'ORDRE DE PRÉSENTATION, résolu à
// l'ouverture.
//
// Les notes de présentateur partent AVEC la slide (décision 5) : dans une
// présentation, les slides portent des mots-clés et les notes portent le propos
// — servir les slides seules donnerait au modèle le squelette en lui cachant le
// contenu. formatPptxRead les sépare par un intertitre explicite, sans quoi le
// modèle attribuerait au public ce qui était destiné au présentateur.
async function readPptxDocument(u8, record, ref, selector) {
  const opened = await openPptxDocument(u8, record, 'docs__read');
  if (opened.fail) return opened.fail;
  const all = opened.slides;
  if (!all.length) return toolFail('docs__read', 'Cette présentation ne contient aucune slide lisible.');

  const sel = parsePageSelector(selector, all.length);   // pur, plus haut dans ce fichier
  if (!sel.ok) return toolFail('docs__read', sel.message);

  const picked = [];
  for (let n = sel.start; n <= sel.end; n++) {
    const s = all[n - 1];
    picked.push({
      number: n, title: s.title,
      text: (s.blocks || []).join('\n\n').trim(),
      notes: s.notes,
    });
  }

  return {
    // La notice de clamp part AVEC le texte (comme pour le PDF) : une plage
    // ramenée en silence ferait conclure au modèle que le deck s'arrête là.
    text: formatPptxRead(picked, { notice: sel.notice }),   // pur, plus haut dans ce fichier
    // Le label porte les bornes EFFECTIVEMENT servies (parsePageSelector clampe),
    // pas la demande brute : un ack qui annonce la demande ment dès qu'un clamp
    // a mordu — même règle que pour la plage de cellules d'une feuille.
    label: sel.start + '-' + sel.end,
    resourceName: pptxReadResourceName(record.name, sel.start, sel.end),   // pur, plus haut dans ce fichier
  };
}
// Description d'un classeur Excel pour la bibliothèque (lot V-5, étape 1).
// Même raisonnement que describePdfForLibrary, et il vaut ici encore plus fort :
// décrire un .xlsx par son listing de MEMBRES ZIP donnerait
// « [Content_Types].xml, xl/workbook.xml, xl/worksheets/sheet1.xml… », soit une
// description qui ne dit rien du classeur. Les noms des feuilles et leurs
// dimensions, eux, disent de quoi il s'agit.
//
// BORNÉE par construction : le listing des feuilles, plus les premières lignes
// de la PREMIÈRE feuille seulement. C'est une description, pas une lecture.
//
// Rend null sur échec, JAMAIS d'exception (l'appelant retombe sur le chemin
// serveur, puis sur une description vide : un fichier doit toujours pouvoir
// être déposé). Pas de console.warn — leçon U-1.
async function describeXlsxForLibrary(u8, maxChars) {
  try {
    const lib = await ensureSheetJs();   // ui.js
    const wb = lib.read(u8, { type: 'array' });
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) return null;

    const sheets = [];
    for (const name of wb.SheetNames) {
      const sh = wb.Sheets[name];
      const refA1 = (sh && sh['!ref']) ? String(sh['!ref']) : '';
      const r = refA1 ? parseA1Range(refA1) : null;   // pur, plus haut dans ce fichier
      sheets.push({ name: name, ref: refA1,
        rows: r ? (r.e.r - r.s.r + 1) : 0, cols: r ? (r.e.c - r.s.c + 1) : 0 });
    }
    const head = formatXlsxListing(sheets);   // pur, plus haut dans ce fichier

    // Aperçu : les premières lignes de la première feuille NON VIDE. Le clone à
    // !ref restreint est le même geste que readXlsxDocument — et pour la même
    // raison : l'option `range` de sheet_to_csv est silencieusement ignorée.
    let preview = '';
    for (const sh of sheets) {
      if (!sh.ref) continue;
      const full = parseA1Range(sh.ref);
      if (!full) continue;
      const end = Math.min(full.e.r, full.s.r + 9);   // 10 lignes au plus
      const view = Object.assign({}, wb.Sheets[sh.name], {
        '!ref': formatA1Range({ s: full.s, e: { r: end, c: full.e.c } }),   // pur, plus haut dans ce fichier
      });
      const csv = String(lib.utils.sheet_to_csv(view) || '').replace(/\n+$/, '');
      if (csv) { preview = 'Aperçu de « ' + sh.name + ' » :\n' + csv; }
      break;
    }
    const out = preview ? head + '\n\n' + preview : head;
    return out.slice(0, maxChars);
  } catch (e) {
    return null;
  }
}

// Description d'un PDF pour la bibliothèque (lot V-4, décision 3). BORNÉE par
// construction : métadonnées + sommaire + PREMIÈRE PAGE, rien de plus. C'est une
// description, pas une lecture — ouvrir un rapport de 400 pages pour décrire une
// entrée de bibliothèque serait absurde.
//
// Rend null sur échec, JAMAIS d'exception : l'appelant retombe alors sur le
// chemin serveur, et en dernier ressort sur une description vide. Un fichier
// doit toujours pouvoir être déposé, même si on n'arrive pas à le décrire.
//
// Pas de console.warn ici (leçon U-1) : un warn sur un chemin d'infrastructure
// achète du silence, pas de la robustesse. L'échec se voit à la description
// absente, qui est l'information utile.
async function describePdfForLibrary(u8, maxChars) {
  let doc = null;
  try {
    const lib = await ensurePdfJs();   // ui.js
    doc = await lib.getDocument({ data: u8.slice() }).promise;
    let meta = null, outline = null;
    try { meta = await doc.getMetadata(); } catch (e) { meta = null; }
    try { outline = await doc.getOutline(); } catch (e) { outline = null; }
    const info = (meta && meta.info) || {};
    const flat = [];
    for (const n of (outline || [])) {
      if (n && n.title) flat.push({ level: 1, title: n.title, page: 0 });
    }
    const head = formatPdfListing({          // pur, plus haut dans ce fichier
      pages: doc.numPages, outline: flat,
      title: info.Title, author: info.Author, producer: info.Producer,
    });

    let first = '';
    if (doc.numPages > 0) {
      const page = await doc.getPage(1);
      try {
        const tc = await page.getTextContent();
        first = joinPdfTextItems(tc && tc.items).trim();   // pur, plus haut dans ce fichier
      } finally {
        try { page.cleanup(); } catch (e) { /* rien à rattraper */ }
      }
    }
    const out = first ? head + '\n\nPremière page :\n' + first : head;
    return out.slice(0, maxChars);
  } catch (e) {
    return null;   // dégradé, jamais bloquant
  } finally {
    if (doc) { try { doc.destroy(); } catch (e) { /* rien à rattraper */ } }
  }
}

// Description d'un document Word pour la bibliothèque (lot V-5, étape 2).
// Même raisonnement que pour le PDF et le classeur : le listing zip d'un .docx
// ne montrerait que word/document.xml et [Content_Types].xml.
//
// BORNÉE par construction : la liste des sections, plus le début de la première
// qui porte du texte. C'est une description, pas une lecture.
async function describeDocxForLibrary(u8, maxChars) {
  try {
    const opened = await openDocxDocument(u8, { name: '' }, 'library');
    if (opened.fail || !opened.sections.length) return null;
    const head = formatDocxListing(opened.sections, { tables: opened.tables });   // pur, plus haut dans ce fichier
    let preview = '';
    for (const sec of opened.sections) {
      const body = String(sec.text || '').trim();
      if (!body) continue;
      preview = 'Début de « ' + sec.label + ' » :\n' + body.slice(0, 600);
      break;
    }
    const out = preview ? head + '\n\n' + preview : head;
    return out.slice(0, maxChars);
  } catch (e) {
    return null;   // dégradé, jamais bloquant
  }
}

// Description d'une présentation pour la bibliothèque (lot V-5, étape 3). Même
// raisonnement que pour les trois autres formats : le listing zip d'un .pptx ne
// montrerait que ppt/slides/slide1.xml et [Content_Types].xml.
//
// BORNÉE par construction : le listing des slides (donc leurs titres ou leurs
// extraits, qui sont déjà une description en soi) et rien de plus. Contrairement
// au PDF et au docx, aucun aperçu supplémentaire n'est ajouté : le listing d'une
// présentation PORTE déjà le texte, puisque le repli d'extrait (décision 6) le
// met dans chaque ligne. En rajouter ferait de la description une lecture.
async function describePptxForLibrary(u8, maxChars) {
  try {
    const opened = await openPptxDocument(u8, { name: '' }, 'library');
    if (opened.fail || !opened.slides.length) return null;
    return formatPptxListing(opened.slides, { untitled: opened.untitled }).slice(0, maxChars);   // pur, plus haut dans ce fichier
  } catch (e) {
    return null;   // dégradé, jamais bloquant
  }
}

// Quel format se décrit par son CONTENU, et par quelle fonction. Source unique,
// dérivée d'aucune autre : un format peut être lisible sans être descriptible
// (le zip l'est — sa description EST son listing de membres), donc cette table
// n'est pas DOC_READERS et ne doit pas s'y adosser.
const DOC_DESCRIBERS = {
  pdf:  describePdfForLibrary,
  xlsx: describeXlsxForLibrary,
  docx: describeDocxForLibrary,
  pptx: describePptxForLibrary,
};
