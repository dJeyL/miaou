#!/usr/bin/env node
// Vérif e2e du lot AC-4 (MIAOU) : les ANCRES D'IMAGES d'un classeur Excel —
// une image annoncée avec la plage de cellules qu'elle recouvre.
//
// Complément indispensable des tests QuickJS, et le trou qu'il comble est
// précis : les purs (parseXlsxDrawingAnchors, xlsxAnchorRange,
// partitionXlsxAnchors, formatXlsxAnchorNote) sont couverts par le runner, mais
// NI fflate NI SheetJS n'y tournent. Donc xlsxImageAnchors — la fonction qui
// décortique le zip et résout workbook → rels → sheet → drawing → media — n'est
// exercée QUE par ce script, ainsi que sa COMPOSITION avec les purs et avec le
// rendu structuré d'AC-3.
//
// DEUX PRÉMISSES QUE CE SCRIPT REMESURE PLUTÔT QUE DE LES SUPPOSER.
// Elles viennent du brief, d'une exécution que je ne pouvais pas rejouer en
// lisant le code. Un rendu vert sur une prémisse fausse serait le pire cas.
//   1. la chaîne de résolution aboutit : les deux ancres de la fixture illustrée
//      pointent bien deux pièces distinctes de xl/media/ ;
//   2. LE RATTACHEMENT NE SUIT PAS LA NUMÉROTATION. Sur la fixture SANS image,
//      `drawing1.xml` est rattaché à la DEUXIÈME feuille (la première n'a aucun
//      .rels). Un code qui apparierait drawing1 ↔ sheet1 attacherait donc les
//      ancres à la mauvaise feuille — sur une fixture du dépôt, pas sur un cas
//      théorique. C'est le piège central du format, et il est mesuré ici.
//
// CONFIDENTIALITÉ DES FIXTURES : les fichiers d'untracked/test-files/ sont des
// documents à ne pas divulguer. Aucune assertion ni aucun `detail` de ce script
// ne porte sur leur CONTENU — ni valeur de cellule, ni nom de feuille au-delà de
// ce que le selector exige, ni libellé d'image. Tout ce qui est vérifié est une
// FORME (syntaxe de l'ancre, chemin de pièce interne au zip) ou un COMPTE. Un
// chemin `xl/media/imageN.png` est une coordonnée de conteneur, pas du contenu.
// Ne pas relâcher cette règle en ajoutant un contrôle : un `detail` est aussi
// divulgant qu'une assertion. Aucune capture d'écran.
//
// MESURES (2026-09-11, relevées sur les fixtures réelles) :
//
//   test-with-pics.xlsx — 2 feuilles
//     « Synthèse » : !ref = B2:E31 (lignes 2 à 31), et 2 twoCellAnchor dans
//       xl/drawings/drawing1.xml
//       rId1 → ../media/image1.png   sur E4:E15   (col 4 row 3 → col 4 row 14)
//       rId2 → ../media/image2.jpeg  sur C33:E42  (col 2 row 32 → col 4 row 41)
//       descr VIDE sur les deux (name = « Image 1 »/« Image 2 », jamais retenu)
//
//       ⚠ LA SECONDE IMAGE EST ANCRÉE SOUS LA ZONE DE DONNÉES : C33 commence
//       deux lignes après la fin du !ref. Une image Excel FLOTTE au-dessus de la
//       grille — rien ne l'oblige à recouvrir des cellules remplies. Donc lire
//       « toute la feuille » sert B2:E31 et n'annonce QU'UNE ancre, l'autre
//       étant comptée hors plage. Le brief §5 annonçait « 2 ancres » ici : c'est
//       faux, et une assertion qui l'exigerait serait une VACUITÉ INVERSÉE
//       accusant le code d'un défaut que la fixture ne porte pas.
//     « Tri 75 correctifs » : aucun .rels, donc aucun drawing, donc aucune ancre
//
//   test.xlsx — LE CAS DÉGÉNÉRÉ, et il est double :
//     xl/drawings/drawing1.xml existe (299 octets) mais est VIDE
//     (<xdr:wsDr></xdr:wsDr> sans enfant), et xl/media/ est ABSENT.
//     Un drawing présent ne prouve donc PAS qu'il y a des images.
//     De plus ce drawing est rattaché à sheet2, pas à sheet1 (cf. prémisse 2).
//
// CE QUE CE SCRIPT NE COUVRE PAS SUR FIXTURE, et pourquoi — quatre vacuités
// assumées, toutes couvertes sur ENTRÉE CONSTRUITE dans les tests QuickJS :
//   - LE LIBELLÉ : les deux images mesurées ont un `descr` VIDE, donc leurs
//     ancres sortent nues et c'est le comportement attendu. Une assertion
//     « le libellé apparaît » sur cette fixture passerait par VACUITÉ INVERSÉE
//     (elle exigerait un libellé qui n'existe pas, et accuserait le code).
//     Ne pas « rétablir » un tel contrôle sans un classeur portant un descr.
//   - LE CAP (XLSX_MAX_IMAGE_ANCHORS = 24) : la fixture porte 2 images.
//     Une assertion de déclenchement serait vacuité inversée, même motif que le
//     cap de 200 lignes qui a été payé en écrivant verify-xlsx-structured.mjs.
//   - oneCellAnchor et absoluteAnchor : ZÉRO occurrence dans le dépôt. Traités
//     défensivement dans le code, vérifiés sur entrée construite, et NON
//     revendiqués comme mesurés.
//   - le doublon PNG/SVG (asvg:svgBlip) : non observé sur cette fixture.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - LES DEUX PRÉMISSES mesurées directement sur les fixtures (cf. supra)
//   - la chaîne résout bien 2 ancres (E4:E15 et C33:E42), mais la LECTURE de la
//     feuille n'en annonce qu'une : l'autre flotte sous le !ref (cf. supra)
//   - l'ancre porte le CHEMIN de la pièce, recopiable tel quel par le modèle
//   - « Tri 75 correctifs » (sans drawing) : AUCUNE ancre, AUCUNE note
//   - FILTRAGE PAR PLAGE : une lecture A1:C10 annonce l'image qu'elle recouvre
//     et COMPTE l'autre, sans l'annoncer
//   - le compte hors plage est dit même quand AUCUNE ancre n'est dans la plage
//   - test.xlsx : sortie STRICTEMENT identique à AC-3 (drawing vide → rien)
//   - LA DESCRIPTION DE BIBLIOTHÈQUE N'EN HÉRITE PAS (arbitrage utilisateur) :
//     c'est une exclusion structurelle, et donc un contrôle de non-régression
//   - non-régression AC-3 : formules et fusions toujours là, sur la même feuille
//
// Usage : node verify-xlsx-anchors.mjs [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN SheetJS + fflate).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const picsPath = path.join(repoRoot, 'untracked/test-files/test-with-pics.xlsx');
const plainPath = path.join(repoRoot, 'untracked/test-files/test.xlsx');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
for (const p of [picsPath, plainPath]) {
  if (!fs.existsSync(p)) { console.error('fixture manquante : ' + p); process.exit(2); }
}
const picsBytes = fs.readFileSync(picsPath);
const plainBytes = fs.readFileSync(plainPath);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Mesurés sur la fixture. Les plages et les chemins de pièces sont des
// coordonnées DANS LE CONTENEUR, jamais du contenu du document.
const RANGE_1 = 'E4:E15';
const RANGE_2 = 'C33:E42';

// Une ligne d'ancre : « [image: chemin] » éventuellement suivi de sa plage.
const anchorsOf = (text) => (text.match(/\[image: [^\]]+\]( — ancrée sur [A-Z]+\d+(?::[A-Z]+\d+)?)?/g) || []);
// Le compte annoncé des images hors de la plage lue.
const outsideCountOf = (text) => {
  const m = text.match(/\[(\d+) images? de cette feuille (?:est ancrée|sont ancrées) hors de la plage lue/);
  return m ? Number(m[1]) : null;
};
const formulaCellsOf = (text) => (text.match(/\[=[^\]]+\]/g) || []);
const maskedOf = (text) => (text.match(/↳/g) || []);
const dataLinesOf = (text) =>
  text.split('\n').filter(l => l && !/^---/.test(l) && !/^\[/.test(l));

const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([]));
  } catch (e) {}
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      const lines = [];
      lines.push('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Terminé.' } }] }) + '\n\n');
      lines.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      lines.push('data: [DONE]\n\n');
      return Promise.resolve(new Response(lines.join(''), {
        status: 200, headers: { 'Content-Type': 'text/event-stream' },
      }));
    }
    return realFetch(input, opts);
  };
};

const browser = await chromium.launch({ headless: !headed });
let exitCode = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.log('  PAGEERROR  ' + e.message); });
  await page.addInitScript(initScript);
  await page.goto('file://' + distPath);
  // Les globals de MIAOU sont des `let`/`function` de portée script : ils ne
  // sont JAMAIS posés sur `window` (mémoire project_globals_not_on_window).
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  await page.waitForSelector('.boot-done', { timeout: 15000 }).catch(() => {});

  // Chemin d'attachment NORMAL (input + envoi), seul chemin qui alloue un att-N
  // résoluble : appeler storeAttachment directement stocke le record sans lui
  // donner d'ordinal dans la conversation.
  const attachAndResolve = async (name, mime, buffer, prompt) => {
    await page.setInputFiles('#attach-file-input', { name, mimeType: mime, buffer });
    await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
    await page.fill('#composer-text', prompt);
    await page.evaluate(() => { onSendBtn(); });
    return page.waitForFunction((wanted) => {
      for (let i = 1; i <= 10; i++) {
        try {
          const r = resolveHandleRecord('att-' + i, { convId: currentConvId });
          if (r && r.name === wanted) return 'att-' + i;
        } catch (e) { /* handle non encore résoluble */ }
      }
      return null;
    }, name, { timeout: 25000 }).then(h => h.jsonValue());
  };

  const callTool = async (tool, args) => await page.evaluate(async ([t, a]) => {
    const r = await callInternalTool(t, a, { convId: currentConvId });
    const text = (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    return { isError: !!(r && r.isError), text: text };
  }, [tool, args]);

  const picsRef = await attachAndResolve('test-with-pics.xlsx', XLSX_MIME, picsBytes, 'un classeur illustré');

  // ── 1. LES DEUX PRÉMISSES, mesurées avant toute assertion de rendu ────────
  const facts = await page.evaluate(async ([ref]) => {
    const rec = resolveHandleRecord(ref, { convId: currentConvId });
    const u8 = new Uint8Array(rec.data);
    const byName = await xlsxImageAnchors(u8);
    const sheets = Object.keys(byName);
    const first = sheets.length ? byName[sheets[0]] : [];
    return {
      sheetsWithAnchors: sheets.length,
      count: first.length,
      // Les CHEMINS de pièces (coordonnées de conteneur), et les plages.
      paths: first.map(a => a.path),
      ranges: first.map(a => a.range),
      labels: first.map(a => a.label),
      distinctPaths: new Set(first.map(a => a.path)).size,
    };
  }, [picsRef]);

  check('PRÉMISSE 1 : la chaîne workbook → rels → sheet → drawing → media aboutit',
    facts.count === 2 && facts.distinctPaths === 2,
    facts.count + ' ancre(s), ' + facts.distinctPaths + ' pièce(s) distincte(s)');
  check('… et une seule feuille porte des ancres (l\'autre n\'a aucun drawing)',
    facts.sheetsWithAnchors === 1, facts.sheetsWithAnchors + ' feuille(s)');
  check('… les deux pièces vivent sous xl/media/ (le chemin, jamais les octets)',
    facts.paths.every(p => /^xl\/media\//.test(p)), facts.paths.join(', '));
  check('… et les plages converties sont exactes (col/row en BASE 0)',
    facts.ranges.indexOf(RANGE_1) >= 0 && facts.ranges.indexOf(RANGE_2) >= 0,
    facts.ranges.join(', '));
  check('VACUITÉ NOMMÉE : les descr de cette fixture sont vides, ancres nues attendues',
    facts.labels.every(l => l === ''), 'aucun libellé — couvert sur entrée construite');

  // ── 2. Le rendu : l'ancre apparaît en note de fin, avec sa plage ──────────
  const whole = await callTool('docs__read', { ref: picsRef, selector: 'Synthèse' });
  check('la feuille illustrée se lit', !whole.isError && /Feuille « Synthèse »/.test(whole.text),
    whole.text.split('\n')[0]);
  // ATTENDU CORRIGÉ PAR LA MESURE — le brief §5 annonçait « 2 ancres » ici, et
  // c'est FAUX. Le !ref de la feuille est B2:E31 (lignes 2 à 31 mesurées), or la
  // seconde image est ancrée sur C33:E42 : elle flotte SOUS la dernière cellule
  // remplie. Une image Excel n'est pas posée sur des cellules — rien ne l'oblige
  // à recouvrir la zone de données.
  //
  // Lire la feuille « entière » sert donc B2:E31, et une seule des deux images y
  // est. Exiger les deux serait une VACUITÉ INVERSÉE : l'assertion accuserait le
  // code d'un défaut que la fixture ne porte pas. Le filtrage §2.2 fait ici
  // exactement son travail, y compris quand la plage servie est la feuille.
  const anchors = anchorsOf(whole.text);
  check('L\'ANCRE DANS LA ZONE DE DONNÉES est annoncée (l\'autre flotte sous le !ref)',
    anchors.length === 1, anchors.length + ' ancre(s) pour un !ref de B2:E31');
  check('… elle porte le CHEMIN de sa pièce, recopiable tel quel',
    anchors.every(a => /\[image: xl\/media\/\S+\]/.test(a)));
  check('… et la PLAGE qu\'elle recouvre',
    whole.text.indexOf('ancrée sur ' + RANGE_1) >= 0);
  check('… tandis que celle ancrée SOUS la zone de données est comptée, pas tue',
    outsideCountOf(whole.text) === 1, 'compte annoncé : ' + outsideCountOf(whole.text));

  // ── 3. NON-RÉGRESSION AC-3 sur la MÊME feuille ───────────────────────────
  // Les ancres s'ajoutent au rendu structuré, elles ne le remplacent pas.
  check('NON-RÉGRESSION AC-3 : les formules restent annotées',
    formulaCellsOf(whole.text).length > 0, formulaCellsOf(whole.text).length + ' annotation(s)');
  check('NON-RÉGRESSION AC-3 : les fusions restent signalées',
    maskedOf(whole.text).length > 0, maskedOf(whole.text).length + ' cellule(s) marquée(s)');
  check('… et la note de fusion précède la note d\'ancres (géométrie avant flottant)',
    whole.text.indexOf('fusionnée') < whole.text.indexOf('[image:'));

  // ── 4. Une feuille SANS drawing ne porte aucune ancre ────────────────────
  const other = await callTool('docs__read', { ref: picsRef, selector: 'Tri 75 correctifs' });
  check('une feuille sans drawing se lit normalement',
    !other.isError && dataLinesOf(other.text).length > 0,
    dataLinesOf(other.text).length + ' ligne(s)');
  check('… et ne porte AUCUNE ancre, AUCUNE note de compte',
    anchorsOf(other.text).length === 0 && outsideCountOf(other.text) === null);

  // ── 5. LE FILTRAGE PAR PLAGE — la décision §2.2 ──────────────────────────
  // Annoncer une image non lue serait incohérent (le label porte déjà la plage
  // SERVIE). Mais taire son existence ferait conclure « il n'y a pas d'image ».
  const ranged = await callTool('docs__read', { ref: picsRef, selector: 'Synthèse!A1:C10' });
  check('une plage explicite est servie', !ranged.isError, ranged.text.split('\n')[0]);
  const rangedAnchors = anchorsOf(ranged.text);
  check('L\'IMAGE HORS PLAGE n\'est PAS annoncée',
    rangedAnchors.every(a => a.indexOf(RANGE_2) < 0),
    rangedAnchors.length + ' ancre(s) annoncée(s)');
  check('… mais elle est COMPTÉE : le silence ferait conclure « aucune image »',
    outsideCountOf(ranged.text) !== null && outsideCountOf(ranged.text) >= 1,
    'compte annoncé : ' + outsideCountOf(ranged.text));

  // Une plage qui ne recouvre AUCUNE image : le compte doit quand même être dit,
  // et c'est le cas où le silence trompe le plus.
  const empty = await callTool('docs__read', { ref: picsRef, selector: 'Synthèse!B2:C3' });
  check('une plage sans aucune image : le compte est DIT malgré tout',
    anchorsOf(empty.text).length === 0 && outsideCountOf(empty.text) === 2,
    'compte annoncé : ' + outsideCountOf(empty.text));
  check('… et la formulation dit qu\'aucune ne recouvre ce qui précède',
    /aucune ne recouvre ce qui précède/.test(empty.text));

  // ── 6. LE CAS DÉGÉNÉRÉ : drawing présent mais VIDE ───────────────────────
  // Et le rattachement qui ne suit pas la numérotation (prémisse 2) : ici le
  // drawing1.xml est accroché à la DEUXIÈME feuille.
  const plainRef = await attachAndResolve('test.xlsx', XLSX_MIME, plainBytes, 'un classeur sans image');
  const degenerate = await page.evaluate(async ([ref]) => {
    const rec = resolveHandleRecord(ref, { convId: currentConvId });
    const byName = await xlsxImageAnchors(new Uint8Array(rec.data));
    return { sheets: Object.keys(byName).length };
  }, [plainRef]);
  check('PRÉMISSE 2 / CAS DÉGÉNÉRÉ : un drawing présent mais VIDE ne rend aucune ancre',
    degenerate.sheets === 0, degenerate.sheets + ' feuille(s) avec ancre');

  const plainRead = await callTool('docs__read', { ref: plainRef, selector: 'Synthèse' });
  check('le classeur sans image se lit', !plainRead.isError, plainRead.text.split('\n')[0]);
  check('… et sa sortie ne porte AUCUNE trace du lot (identique à AC-3)',
    anchorsOf(plainRead.text).length === 0 && outsideCountOf(plainRead.text) === null);
  check('… tout en gardant formules et fusions d\'AC-3',
    formulaCellsOf(plainRead.text).length > 0 && maskedOf(plainRead.text).length > 0,
    formulaCellsOf(plainRead.text).length + ' formule(s), '
      + maskedOf(plainRead.text).length + ' fusion(s)');

  // ── 7. LA DESCRIPTION DE BIBLIOTHÈQUE N'EN HÉRITE PAS ───────────────────
  // Arbitrage utilisateur : elle partage le rendu d'AC-3 mais PAS les ancres.
  // C'est une exclusion STRUCTURELLE (seul readXlsxDocument passe opts.anchors),
  // donc ce contrôle garde une décision, il ne constate pas un hasard.
  const described = await page.evaluate(async ([ref]) => {
    const rec = resolveHandleRecord(ref, { convId: currentConvId });
    return await describeXlsxForLibrary(new Uint8Array(rec.data), 4000);
  }, [picsRef]);
  check('l\'aperçu de bibliothèque est produit', !!described && described.length > 50,
    described ? described.length + ' caractères' : 'null');
  check('… et il ne porte AUCUNE ancre (décision : décrire n\'est pas indexer)',
    !!described && anchorsOf(described).length === 0 && outsideCountOf(described) === null);
  check('… tout en gardant le rendu structuré d\'AC-3 (pipes et formules)',
    !!described && described.indexOf(' | ') >= 0 && formulaCellsOf(described).length > 0,
    described ? formulaCellsOf(described).length + ' annotation(s)' : '—');

  // ── 8. LES FORMES NON MESURÉES, sur entrée construite ────────────────────
  // ZÉRO occurrence dans le dépôt : elles sont traitées défensivement et
  // vérifiées ici DANS LE BUNDLE RÉEL, jamais revendiquées comme mesurées.
  const shapes = await page.evaluate(() => {
    const one = '<xdr:oneCellAnchor>'
      + '<xdr:from><xdr:col>3</xdr:col><xdr:row>7</xdr:row></xdr:from>'
      + '<xdr:ext cx="914400" cy="914400"/>'
      + '<xdr:pic><xdr:blipFill><a:blip r:embed="rId4"/></xdr:blipFill></xdr:pic>'
      + '</xdr:oneCellAnchor>';
    const abs = '<xdr:absoluteAnchor><xdr:pos x="1" y="2"/>'
      + '<xdr:pic><xdr:blipFill><a:blip r:embed="rId5"/></xdr:blipFill></xdr:pic>'
      + '</xdr:absoluteAnchor>';
    const many = [];
    for (let i = 1; i <= 30; i++) {
      many.push({ path: 'xl/media/image' + i + '.png', range: 'A' + i, label: '' });
    }
    return {
      one: parseXlsxDrawingAnchors(one)[0],
      abs: parseXlsxDrawingAnchors(abs)[0],
      capped: formatXlsxAnchorNote({ inside: many, outside: 0 }, 24),
      labelled: formatXlsxAnchorNote({
        inside: [{ path: 'xl/media/image1.png', range: 'B2:C3', label: 'Courbe de charge' }],
        outside: 0,
      }),
    };
  });
  check('FORME NON MESURÉE : oneCellAnchor rend sa cellule d\'ancrage, pas une plage inventée',
    shapes.one && shapes.one.range === 'D8', shapes.one ? shapes.one.range : 'aucune');
  check('FORME NON MESURÉE : absoluteAnchor est rendu SANS position',
    shapes.abs && shapes.abs.range === '', shapes.abs ? '"' + shapes.abs.range + '"' : 'aucune');
  check('VACUITÉ NOMMÉE : le cap borne l\'énumération et annonce le reste (entrée construite)',
    /6 autres images sur cette feuille, non listées/.test(shapes.capped));
  check('VACUITÉ NOMMÉE : un libellé, quand il existe, est repris (entrée construite)',
    shapes.labelled.indexOf('« Courbe de charge »') >= 0);

} catch (e) {
  console.error('\nERREUR : ' + (e && e.message ? e.message : e));
  exitCode = 2;
} finally {
  await browser.close();
}

if (failures.length) {
  console.log('\nÉCHECS (' + failures.length + ') :');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
if (exitCode) process.exit(exitCode);
console.log('\nOK — tous les contrôles passent.');
