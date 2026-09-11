#!/usr/bin/env node
// Vérif e2e du lot AC-3 (MIAOU) : le rendu STRUCTURÉ d'une feuille Excel —
// tableau pipe, formules annotées, cellules fusionnées signalées.
//
// Complément indispensable des tests QuickJS, et le trou qu'il comble est précis :
// les purs (formatSheetCell, formatMergeRanges, formatXlsxSheet) sont couverts
// par le runner, mais SheetJS N'Y TOURNE PAS. Donc sheetToMatrix — la fonction
// qui lit les cellules, dérive le masque depuis '!merges' et honore la plage —
// n'est exercée QUE par ce script, ainsi que sa COMPOSITION avec les purs.
// C'est le cœur du lot : si le masque ou l'origine du !ref sont faux, les purs
// restent verts et la sortie est décalée.
//
// TROIS FAITS MESURÉS QUE CE SCRIPT REVÉRIFIE PLUTÔT QUE DE LES SUPPOSER.
// Le brief les donnait comme acquis ; ils viennent d'une exécution de SheetJS
// que je ne pouvais pas rejouer en lisant le code. Le plus coûteux s'il était
// faux est le deuxième : tout le traitement des fusions en dépend.
//   1. le !ref de « Synthèse » ne commence PAS en A1 (B2:E31 mesuré) ;
//   2. dans une zone fusionnée, seule la cellule haut-gauche EXISTE — les
//      autres sont `undefined`, pas vides ;
//   3. '!merges' peut être absent d'une feuille sans fusion.
// Le scénario 1 les mesure DIRECTEMENT sur la fixture, avant toute assertion de
// rendu. Un rendu vert sur une prémisse fausse serait le pire des cas.
//
// CONFIDENTIALITÉ DES FIXTURES : les fichiers d'untracked/test-files/ sont des
// documents à ne pas divulguer. Aucune assertion ni aucun `detail` de ce script
// ne porte sur leur CONTENU — ni valeur de cellule, ni libellé, ni nom propre.
// Tout ce qui est vérifié est une FORME (syntaxe d'annotation, marqueur de
// fusion, séparateur) ou un COMPTE. Les formules elles-mêmes ne sont jamais
// affichées : on n'en vérifie que la présence et la syntaxe. Ne pas relâcher
// cette règle en ajoutant un contrôle — un `detail` est aussi divulgant qu'une
// assertion. Aucune capture d'écran.
//
// MESURES (2026-09-11, relevées via SheetJS 0.18.5 réellement exécuté) :
//
//   test.xlsx — 2 feuilles
//     « Synthèse » : !ref = B2:E31 (30 lignes × 4 colonnes, origine NON-A1)
//       8 formules en C7..C14, toutes des COUNTIF vers l'autre feuille
//       8 plages fusionnées, dont une de 4×4
//     « Tri 75 correctifs » : 459 cellules, 0 fusion, 0 formule
//       → le témoin de non-régression : pour elle, RIEN ne doit changer
//
//   test-with-dates.xlsx — mêmes feuilles, colonne E de « Synthèse » en plus :
//     4 formats de date distincts (mois, jour, jour+heure, durée), dont un
//     issu d'une formule. C'est la NON-RÉGRESSION du lot : sheet_to_csv rendait
//     déjà ces dates correctement (il utilisait `w`), donc un rendu maison qui
//     prendrait `v` serait une RÉGRESSION, pas un bug préexistant.
//
//   test-with-pics.xlsx — mêmes feuilles que test.xlsx (fixture d'AC-4).
//
// CE QUE CE SCRIPT NE COUVRE PAS, et pourquoi :
//   - LE CAP DE FORMULE (MAX_XLSX_FORMULA_CHARS) : les 8 formules de la fixture
//     font ~42 caractères, loin sous les 120. Une assertion de cap sur document
//     réel passerait par VACUITÉ. Il est vérifié sur ENTRÉE CONSTRUITE passée
//     au pur dans le bundle réel. Ne pas « rétablir » un contrôle sur fixture
//     sans un classeur portant une formule de plus de 120 caractères.
//   - LE CAP DE NOTES DE FUSION (MAX_XLSX_MERGE_NOTES = 12) : la fixture en
//     porte 8. Même raisonnement, même traitement.
//   - LE CAP DE LIGNES (MAX_XLSX_ROWS_DEFAULT = 200) : la plus grande feuille
//     du dépôt fait 76 lignes. Une assertion de déclenchement sur fixture
//     serait une vacuité INVERSÉE — elle exigerait qu'un cap de 200 morde sur
//     76, et tomberait en accusant le code. Piège réellement payé en écrivant
//     ce script (cf. le commentaire du §7).
//   - cellules d'erreur, commentaires, validations, formats conditionnels,
//     colonnes masquées : HORS PÉRIMÈTRE ASSUMÉ du lot (cf. docs/documents.md),
//     pas des oublis.
//   - pourcentages, monnaies, arrondis d'affichage : non mesurés, donc non
//     revendiqués. Même mécanisme v/w que les dates, donc couverts par
//     construction — mais ne pas prétendre les avoir vérifiés.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - LES TROIS PRÉMISSES mesurées directement sur la fixture (cf. supra)
//   - le rendu est un TABLEAU PIPE, plus un CSV
//   - les 8 formules sont ANNOTÉES, avec leur valeur ET leur formule
//   - les fusions sont SIGNALÉES (marqueur ↳ + note énumérant les plages)
//   - « Tri 75 correctifs » (0 fusion, 0 formule) : AUCUNE annotation, aucune
//     note — la non-régression de la feuille ordinaire
//   - LA PLAGE EST HONORÉE : c'est la garde de V-5 sous sa nouvelle forme (le
//     clone à !ref a disparu avec sheet_to_csv ; la plage est désormais tenue
//     par restriction du balayage). Si elle cédait, toute la feuille sortirait.
//   - une feuille SOUS le cap passe entière, sans troncature parasite (le
//     DÉCLENCHEMENT du cap est en §11, sur entrée construite — cf. §7)
//   - NON-RÉGRESSION DES DATES : Jun-26 et consorts, JAMAIS 46174 ni 0.708…
//   - l'aperçu de bibliothèque partage le rendu (formules visibles à la dépose)
//   - as_resource : la feuille structurée part en ressource interrogeable
//
// Usage : node verify-xlsx-structured.mjs [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN SheetJS).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const xlsxPath = path.join(repoRoot, 'untracked/test-files/test.xlsx');
const datesPath = path.join(repoRoot, 'untracked/test-files/test-with-dates.xlsx');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(xlsxPath)) { console.error('fixture manquante : ' + xlsxPath); process.exit(2); }
if (!fs.existsSync(datesPath)) { console.error('fixture manquante : ' + datesPath); process.exit(2); }
const xlsxBytes = fs.readFileSync(xlsxPath);
const datesBytes = fs.readFileSync(datesPath);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Mesurés sur la fixture. Les comptes, jamais les contenus.
const EXPECTED_FORMULAS = 8;
const EXPECTED_MERGES = 8;
const SHEET_REF = 'B2:E31';

// Une cellule annotée d'une formule : « valeur [=FORMULE] ». On ne capture que
// la FORME, jamais la formule elle-même.
const formulaCellsOf = (text) => (text.match(/\[=[^\]]+\]/g) || []);
// Le marqueur de fusion.
const maskedOf = (text) => (text.match(/↳/g) || []);
// La note de fin. On en extrait le COMPTE annoncé, pas les plages.
const mergeNoteCountOf = (text) => {
  const m = text.match(/\[(\d+) plages? fusionnées?\s*:/);
  return m ? Number(m[1]) : null;
};
// Les lignes de DONNÉES : ni en-tête, ni notice/note entre crochets.
const dataLinesOf = (text) =>
  text.split('\n').filter(l => l && !/^---/.test(l) && !/^\[/.test(l));

// ── Stub SSE modèle : aucun MCP déclaré, le natif doit suffire ───────────────
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
  // Attendre `window.currentConvId` expire donc toujours — nom nu obligatoire.
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  await page.waitForSelector('.boot-done', { timeout: 15000 }).catch(() => {});

  // Attache un fichier par le CHEMIN D'ATTACHMENT NORMAL (input + envoi), seul
  // chemin qui alloue un att-N résoluble : appeler storeAttachment directement
  // stocke le record sans lui donner d'ordinal dans la conversation.
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

  const xref = await attachAndResolve('test.xlsx', XLSX_MIME, xlsxBytes, 'un classeur Excel');

  // ── 1. LES TROIS PRÉMISSES, mesurées avant toute assertion de rendu ────────
  // Le brief les donnait pour acquises. Un rendu vert sur une prémisse fausse
  // serait le pire cas possible : c'est donc le premier contrôle, pas le dernier.
  const facts = await page.evaluate(async ([ref]) => {
    const rec = resolveHandleRecord(ref, { convId: currentConvId });
    const u8 = new Uint8Array(rec.data);
    const lib = await ensureSheetJs();
    const wb = lib.read(u8, { type: 'array' });
    const sh = wb.Sheets['Synthèse'];
    const other = wb.Sheets['Tri 75 correctifs'];
    const merges = sh['!merges'] || [];
    // La 1re fusion de la feuille, et la cellule à sa droite immédiate.
    let neighbourExists = null, masterExists = null;
    if (merges.length) {
      const m = merges[0];
      const colL = (i) => { let n = i + 1, s = ''; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };
      masterExists = !!sh[colL(m.s.c) + (m.s.r + 1)];
      if (m.e.c > m.s.c) neighbourExists = !!sh[colL(m.s.c + 1) + (m.s.r + 1)];
    }
    let formulas = 0;
    for (const k of Object.keys(sh)) { if (k[0] !== '!' && sh[k] && sh[k].f) formulas++; }
    return {
      ref: String(sh['!ref'] || ''),
      merges: merges.length,
      formulas: formulas,
      masterExists: masterExists,
      neighbourExists: neighbourExists,
      otherHasMergesKey: Object.prototype.hasOwnProperty.call(other, '!merges'),
    };
  }, [xref]);

  check('PRÉMISSE 1 : le !ref ne commence pas en A1 (un rendu qui suppose A1 décale tout)',
    facts.ref === SHEET_REF, '!ref = ' + facts.ref);
  check('PRÉMISSE 2 : dans une fusion, la maîtresse EXISTE et sa voisine est ABSENTE',
    facts.masterExists === true && facts.neighbourExists === false,
    'maîtresse ' + facts.masterExists + ', voisine ' + facts.neighbourExists);
  check('PRÉMISSE 3 : une feuille sans fusion peut n\'avoir aucune clé !merges',
    facts.otherHasMergesKey === false, 'clé présente : ' + facts.otherHasMergesKey);
  check('la fixture porte bien ' + EXPECTED_FORMULAS + ' formules et ' + EXPECTED_MERGES + ' fusions',
    facts.formulas === EXPECTED_FORMULAS && facts.merges === EXPECTED_MERGES,
    facts.formulas + ' formules, ' + facts.merges + ' fusions');

  // ── 2. Le rendu : tableau pipe, plus un CSV ───────────────────────────────
  const whole = await callTool('docs__read', { ref: xref, selector: 'Synthèse' });
  check('la feuille se lit', !whole.isError && /Feuille « Synthèse »/.test(whole.text),
    whole.text.split('\n')[0]);
  check('la plage servie est annoncée dans l\'en-tête', new RegExp('\\(' + SHEET_REF + '\\)').test(whole.text));
  const piped = dataLinesOf(whole.text).filter(l => l.indexOf(' | ') >= 0).length;
  check('LE FORMAT : les colonnes sont séparées par des pipes, plus par des virgules',
    piped > 0, piped + ' ligne(s) au format pipe');

  // ── 3. Les formules sont ANNOTÉES ─────────────────────────────────────────
  const annotated = formulaCellsOf(whole.text);
  check('LES ' + EXPECTED_FORMULAS + ' FORMULES sont annotées (le modèle voit que la valeur est dérivée)',
    annotated.length === EXPECTED_FORMULAS, annotated.length + ' cellule(s) annotée(s)');
  check('… et l\'annotation porte la valeur ET la formule, pas l\'une sans l\'autre',
    /\S+ \[=[^\]]+\]/.test(whole.text));

  // ── 4. Les fusions sont SIGNALÉES, jamais propagées ───────────────────────
  const masked = maskedOf(whole.text);
  check('LES FUSIONS sont signalées par un marqueur (avant : des colonnes vides)',
    masked.length > 0, masked.length + ' cellule(s) marquée(s)');
  check('… et la note de fin annonce le compte exact de plages',
    mergeNoteCountOf(whole.text) === EXPECTED_MERGES,
    'annoncé ' + mergeNoteCountOf(whole.text) + ', attendu ' + EXPECTED_MERGES);
  check('… et elle explique le marqueur (sinon le modèle lit un caractère opaque)',
    /↳[^\n]*couvertes|couvertes[^\n]*↳/.test(whole.text));

  // ── 5. NON-RÉGRESSION : la feuille ordinaire ne change PAS ────────────────
  // 0 fusion, 0 formule : rien du lot ne doit s'y voir. C'est le contrôle qui
  // prouve que les annotations sont conditionnelles et non systématiques.
  const plain = await callTool('docs__read', { ref: xref, selector: 'Tri 75 correctifs' });
  check('NON-RÉGRESSION : une feuille sans formule ni fusion se lit toujours',
    !plain.isError && dataLinesOf(plain.text).length > 0,
    dataLinesOf(plain.text).length + ' ligne(s)');
  check('… et ne porte AUCUNE annotation de formule',
    formulaCellsOf(plain.text).length === 0, formulaCellsOf(plain.text).length + ' annotation(s)');
  check('… AUCUN marqueur de fusion, AUCUNE note',
    maskedOf(plain.text).length === 0 && mergeNoteCountOf(plain.text) === null);

  // ── 6. LA PLAGE EST HONORÉE — la garde de V-5 sous sa nouvelle forme ──────
  // Le clone à !ref a disparu avec sheet_to_csv. La plage est désormais tenue
  // par restriction du balayage dans sheetToMatrix. Si elle cédait, toute la
  // feuille sortirait ici — exactement le « plausible et faux » de V-5.
  const ranged = await callTool('docs__read', { ref: xref, selector: 'Synthèse!B2:C5' });
  check('une plage explicite est servie', !ranged.isError && /\(B2:C5\)/.test(ranged.text));
  const rangedRows = dataLinesOf(ranged.text).length;
  check('LA PREUVE que la plage est honorée : 4 lignes, pas les 30 de la feuille',
    rangedRows >= 3 && rangedRows <= 5, rangedRows + ' ligne(s) rendues');
  const rangedCols = (dataLinesOf(ranged.text)[0] || '').split(' | ').length;
  check('… et 2 colonnes (B et C), pas les 4 de la feuille',
    rangedCols === 2, rangedCols + ' colonne(s)');

  // ── 7. Le cap de lignes ────────────────────────────────────────────────────
  // ATTENTION, PIÈGE PAYÉ EN ÉCRIVANT CE SCRIPT : la première version exigeait
  // ici la notice de troncature. Elle est tombée en FAIL, et le FAIL accusait
  // l'ASSERTION, pas le code — « Tri 75 correctifs » fait 76 lignes, donc elle
  // demandait à un cap de 200 de mordre sur 76. verify-xlsx-native.mjs le savait
  // déjà : il assertionne une borne HAUTE (<= 201) et porte le commentaire « le
  // cap ne mord pas sur cette fixture, et c'est correct ».
  //
  // AUCUNE fixture du dépôt ne dépasse 200 lignes. Un contrôle de déclenchement
  // sur document réel est donc impossible sans vacuité inversée. On vérifie ici
  // ce qui EST vérifiable — la feuille passe entière, sans troncature parasite —
  // et le déclenchement l'est sur entrée construite (§11), comme les deux autres
  // caps du lot. Ne pas « rétablir » une assertion de troncature sans un
  // classeur de plus de 200 lignes.
  const capped = await callTool('docs__read', { ref: xref, selector: 'Tri 75 correctifs' });
  const cappedRows = dataLinesOf(capped.text).length;
  check('une feuille SOUS le cap passe entière, sans troncature parasite',
    !capped.isError && cappedRows > 10 && cappedRows <= 201
      && !/non affichée/.test(capped.text), cappedRows + ' ligne(s), aucune notice');

  // ── 8. NON-RÉGRESSION DES DATES — le cœur du §2.4 ────────────────────────
  // sheet_to_csv rendait DÉJÀ ces dates correctement (il utilisait `w`). Un
  // rendu maison qui prendrait `v` afficherait des numéros de série Excel :
  // ce serait une RÉGRESSION introduite par ce lot, pas un bug préexistant.
  const dref = await attachAndResolve('test-with-dates.xlsx', XLSX_MIME, datesBytes, 'un classeur à dates');
  const dated = await callTool('docs__read', { ref: dref, selector: 'Synthèse' });
  check('le classeur à dates se lit', !dated.isError, dated.text.split('\n')[0]);
  // Les numéros de série Excel de la colonne E, mesurés. Leur PRÉSENCE serait
  // la régression ; on ne cite aucune valeur de date lisible (confidentialité).
  const serials = ['46174', '46176', '0.7083333333357587'];
  const leaked = serials.filter(s => dated.text.indexOf(s) >= 0);
  check('LA NON-RÉGRESSION : aucun numéro de série Excel dans la sortie (w, jamais v)',
    leaked.length === 0, leaked.length ? 'fuite : ' + leaked.length + ' valeur(s) brute(s)' : 'aucune');
  check('… et la colonne de dates porte bien des valeurs formatées non vides',
    dataLinesOf(dated.text).some(l => l.split(' | ').length >= 4
      && l.split(' | ')[3].trim().length > 0));
  // Le cas où les deux annotations se croisent : une date issue d'une formule.
  check('LE CAS CROISÉ : une cellule porte À LA FOIS une date formatée et sa formule',
    formulaCellsOf(dated.text).length > EXPECTED_FORMULAS,
    formulaCellsOf(dated.text).length + ' annotations (dont celles de la colonne E)');

  // ── 9. L'aperçu de bibliothèque partage le rendu ──────────────────────────
  // Décrire un classeur autrement qu'on le lit ferait diverger deux vues du
  // même contenu (arbitrage utilisateur, AC-3).
  const described = await page.evaluate(async ([ref]) => {
    const rec = await resolveHandleRecord(ref, { convId: currentConvId });
    return await describeXlsxForLibrary(new Uint8Array(rec.data), 4000);
  }, [xref]);
  check('l\'aperçu de bibliothèque est produit', !!described && described.length > 50,
    described ? described.length + ' caractères' : 'null');
  check('… et il partage le rendu de la lecture (pipes, et non des virgules)',
    !!described && described.indexOf(' | ') >= 0);
  check('… formules annotées comprises : la description ne ment pas sur le contenu',
    !!described && formulaCellsOf(described).length > 0,
    described ? formulaCellsOf(described).length + ' annotation(s)' : '—');

  // ── 10. as_resource : la feuille structurée part en ressource ─────────────
  const asRes = await callTool('docs__read', { ref: xref, selector: 'Synthèse', as_resource: true });
  check('as_resource rend un handle res_… et non le texte',
    !asRes.isError && /res_[A-Za-z0-9]/.test(asRes.text), asRes.text.slice(0, 80));

  // ── 11. LES DEUX CAPS, sur entrée construite ─────────────────────────────
  // Aucune fixture ne les exerce (formules ~42 caractères, 8 fusions) : un
  // contrôle sur document réel passerait par VACUITÉ. On appelle donc les purs
  // DANS LE BUNDLE RÉEL avec une entrée construite — ce n'est pas la fixture,
  // et c'est délibéré.
  const caps = await page.evaluate(() => {
    const longF = 'IF(' + new Array(300).join('X') + ')';
    const cell = formatSheetCell({ v: 1, w: '1', f: longF });
    const many = [];
    for (let i = 1; i <= 30; i++) many.push('A' + i + ':C' + i);
    // Le cap de LIGNES, lui aussi sur entrée construite : aucune fixture du
    // dépôt ne dépasse 200 lignes (cf. §7).
    const rows = [];
    for (let i = 0; i < 250; i++) rows.push([{ w: 'x' }]);
    const over = formatXlsxSheet({ rows: rows }, { sheet: 'S', maxRows: 200 });
    return {
      truncated: cell.indexOf('…]') >= 0,
      shorter: cell.length < longF.length,
      note: formatMergeRanges(many),
      rowsNotice: /50 ligne\(s\) non affichée\(s\)/.test(over),
      rowsProposes: over.indexOf('as_resource') >= 0,
    };
  });
  check('LE CAP DE FORMULE tronque et l\'ANNONCE (entrée construite)',
    caps.truncated && caps.shorter);
  check('LE CAP DE NOTES bascule sur le COMPTE seul au-delà de la borne',
    /30 plages fusionnées/.test(caps.note) && /trop nombreuses/.test(caps.note));
  check('… sans jamais taire qu\'il y a des fusions',
    caps.note.indexOf('fusionnée') >= 0);
  check('LE CAP DE LIGNES tronque, l\'ANNONCE avec son compte et propose la suite',
    caps.rowsNotice && caps.rowsProposes);

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
