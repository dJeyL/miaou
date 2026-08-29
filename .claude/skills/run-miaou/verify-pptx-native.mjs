#!/usr/bin/env node
// Vérif e2e du lot V-5 étape 3 (MIAOU) : ouverture NATIVE d'une présentation
// PowerPoint, sans aucun serveur MCP et SANS AUCUNE BIBLIOTHÈQUE nouvelle — le
// pptx réutilise fflate, déjà chargé pour le zip. C'est le seul vrai portage du
// lot : aucune lib JS satisfaisante n'existe pour lire un .pptx, on décortique
// le zip et on parse le XML.
//
// Complément indispensable des tests QuickJS, qui couvrent le pur mais JAMAIS
// le câblage (mémoire project_quickjs_tests_dont_cover_orchestration_scope) ni
// la COMPOSITION de deux purs corrects
// (project_pure_functions_compose_unguarded_contract). Ici le trou est plus
// large encore : QuickJS n'a pas de DOMParser, donc TOUT le parsing XML
// (pptxShapeBlocks, pptxSlideTitle) n'est exercé QUE par ce script.
//
// Ce que les tests QuickJS ne peuvent pas voir, et que ce script exerce :
//   - le routage sniffDocumentKind → DOC_READERS.pptx dans les deux handlers
//   - pptxShapeBlocks : la découpe shape → a:p → runs sur du XML réel, dont la
//     descente DANS les p:grpSp (le gain net sur le serveur)
//   - la COMPOSITION pptxSlideOrder → openPptxDocument → formatPptxListing :
//     l'ordre résolu doit gouverner la NUMÉROTATION du listing ET l'index du
//     selector, sur deux chemins qui ne sont gardés ensemble nulle part ailleurs
//   - pptxNotesTarget → chargement de la pièce de notes → filtre des
//     placeholders : trois maillons dont le joint décide si une « note » est du
//     propos ou du chrome de mise en page
//   - as_resource → _storeBlock → formatInlineHandleForModel → js__eval
//
// Modèle STUBÉ (SSE tool_calls déterministes), fichiers RÉELS attachés par le
// chemin d'attachment normal. Aucun MCP : c'est le sujet.
//
// DEUX FIXTURES, et chacune prouve ce que l'autre ne peut pas :
//   - untracked/test-files/test.pptx — le deck RÉEL (71 slides, organigramme à
//     shapes groupées). Il porte les deux mesures du plan : 6 slides titrées sur
//     71, et 83 des 160 fragments de la slide 2 dans des groupes. Mais son
//     sldIdLst est dans l'ordre naturel et ses 4 notes sont VIDES : il ne peut
//     prouver ni la garde d'ordre, ni la lecture d'une note.
//   - untracked/test-files/deck-notes.pptx — fixture fabriquée POUR ces deux
//     trous : son sldIdLst est INVERSÉ (la pièce slide4.xml est la slide 1 de
//     présentation) et deux slides portent des notes rédigées. Sur elle,
//     notesSlide2.xml est la note de la slide 1 AFFICHÉE : un appariement par
//     numéro se tromperait deux fois, et le contrôle échouerait.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - docs__list sur un .pptx rend les SLIDES, pas un listing de membres zip
//     (ppt/slides/slide1.xml…) — c'est le changement d'orientation de l'étape 3
//   - l'ack dit « Présentation listée … N slides », jamais « Archive listée »
//   - LE test de la garde d'ordre : sur la fixture au sldIdLst inversé, la
//     slide 1 du listing est celle de la pièce slide4.xml. Trier par numéro de
//     fichier donnerait l'inverse, en silence.
//   - le repli d'extrait (décision 6) : sur le deck réel, 65 slides sans titre
//     montrent un EXTRAIT de leur texte, jamais « (sans titre) »
//   - LE gain sur le serveur : la slide 2 du deck réel rend le texte des shapes
//     GROUPÉES (83 fragments que python-pptx n'itère pas)
//   - la découpe shape → a:p → runs : « Risques IT\nMarc GUIDAT », ni la
//     bouillie plate (« Centre », « », « de  ») ni les mots collés
//   - les notes de présentateur sont LUES et SÉPARÉES par un intertitre
//   - le filtre de placeholders : une note vide ne rend pas « Notes view: 17 »
//     (le numéro de slide du gabarit, présenté comme du propos)
//   - un tableau (a:tbl d'un graphicFrame) sort en lignes « a | b | c »
//   - une plage '2-5' rend quatre slides ; un selector hors bornes est clampé
//     ET la notice le dit
//   - un selector non numérique échoue en NOMMANT la forme attendue
//   - DEUXIÈME lecture du même handle (fflate ne détache pas)
//   - as_resource : res_… nommé -sN, exploitable en js__eval
//   - un .pptx déposé en bibliothèque est décrit par ses slides, pas par son XML
//   - non-régression : Word, Excel, PDF et zip continuent de router
//   - l'ack d'une lecture pptx dit « Slide … lue », le PDF toujours « Page … »
//
// Usage : node verify-pptx-native.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN fflate).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const pptxPath = path.join(repoRoot, 'untracked/test-files/test.pptx');
const notesPath = path.join(repoRoot, 'untracked/test-files/deck-notes.pptx');
const docxPath = path.join(repoRoot, 'untracked/test-files/test.docx');
const xlsxPath = path.join(repoRoot, 'untracked/test-files/test.xlsx');
const pdfPath = path.join(repoRoot, 'untracked/test-files/test.pdf');
const zipPath = path.join(repoRoot, 'untracked/test-files/test-extract.zip');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-pptx-native');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(pptxPath)) { console.error('oracle manquant : ' + pptxPath); process.exit(2); }
if (!fs.existsSync(notesPath)) { console.error('fixture manquante : ' + notesPath); process.exit(2); }
const pptxBytes = fs.readFileSync(pptxPath);
const notesBytes = fs.readFileSync(notesPath);
const docxBytes = fs.existsSync(docxPath) ? fs.readFileSync(docxPath) : null;
const xlsxBytes = fs.existsSync(xlsxPath) ? fs.readFileSync(xlsxPath) : null;
const pdfBytes = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : null;
const zipBytes = fs.existsSync(zipPath) ? fs.readFileSync(zipPath) : null;

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── Stub SSE modèle : aucun MCP déclaré, le natif doit suffire ───────────────
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([]));
  } catch (e) {}
  window.__scriptedToolCalls = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      const tcs = Array.isArray(window.__scriptedToolCalls) ? window.__scriptedToolCalls : [];
      const lines = [];
      if (tcs.length) {
        tcs.forEach((tc, i) => {
          lines.push('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [
            { index: i, id: 'call_' + i, type: 'function',
              function: { name: tc.name, arguments: tc.arguments } },
          ] } }] }) + '\n\n');
        });
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n');
      } else {
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Terminé.' } }] }) + '\n\n');
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      }
      lines.push('data: [DONE]\n\n');
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          let i = 0;
          const push = () => {
            if (i < lines.length) { controller.enqueue(enc.encode(lines[i++])); setTimeout(push, 20); }
            else controller.close();
          };
          push();
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    }
    if (url.indexOf('/models') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, opts);   // CDN fflate réel
  };
};

const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(initScript);
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error] ' + m.text()); });

let exitCode = 0;
try {
  await page.goto('file://' + distPath);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  // Overlay de boot : jamais retiré du DOM, plancher 1,8 s
  // (mémoire project_boot_overlay_hides_playwright_shots).
  await page.waitForSelector('.boot-done', { timeout: 15000 }).catch(() => {});

  const callTool = async (name, args) => page.evaluate(async ([n, a]) => {
    const r = await callInternalTool(n, a, { convId: (typeof currentConvId !== 'undefined' ? currentConvId : null) });
    const txt = (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    return { text: txt, isError: !!(r && r.isError) };
  }, [name, args]);

  const lastAck = async (kind) => page.evaluate((k) => {
    const acks = (typeof getPendingToolAcks === 'function' ? getPendingToolAcks() : [])
      .filter(m => m && m.kind === k);
    const last = acks[acks.length - 1];
    if (!last) return { head: 'aucun ack ' + k, count: '', name: '' };
    return {
      head: k === 'docs_list' ? docsListAckHead(last) : docsReadAckHead(last),
      count: k === 'docs_list' ? docsListAckCount(last) : '',
      name: last.resourceName || '',
    };
  }, kind);

  // L'indice att-N n'est PAS déductible du nombre d'envois (l'input est
  // `multiple`, les chips s'accumulent) : on résout par le NOM du record.
  const attachAndResolve = async (name, mime, buffer, prompt) => {
    await page.setInputFiles('#attach-file-input', { name, mimeType: mime, buffer });
    await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
    await page.fill('#composer-text', prompt);
    await page.evaluate(() => { window.__scriptedToolCalls = []; onSendBtn(); });
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

  const pref = await attachAndResolve('test.pptx', PPTX_MIME, pptxBytes, 'voici une présentation');

  // ── 1. docs__list : des SLIDES, pas des membres zip ────────────────────────
  const listed = await callTool('docs__list', { ref: pref });
  check('docs__list ouvre la présentation sans erreur', !listed.isError, listed.text.slice(0, 90));
  check('le listing annonce une présentation et ses 71 slides',
    /Présentation PowerPoint — 71 slides/.test(listed.text), listed.text.split('\n')[0]);
  check('ce n\'est PAS un listing zip : aucune pièce XML n\'apparaît',
    !/ppt\/slides\/slide1\.xml/.test(listed.text) && !/Content_Types/.test(listed.text));
  check('le listing rappelle que le selector est un NUMÉRO',
    /miaou__docs__read/.test(listed.text) && /NUMÉRO/.test(listed.text));

  // ── 2. L'ack dit « Présentation listée … 71 slides » ───────────────────────
  const la = await lastAck('docs_list');
  check('l\'ack dit « Présentation listée … 71 slides », pas « Archive listée »',
    /Présentation listée/.test(la.head) && /71 slides/.test(la.count), la.head + ' — ' + la.count);

  // ── 3. Le repli d'extrait (décision 6) ────────────────────────────────────
  // 6 slides titrées sur 71 : porter pptx_list à l'identique produirait
  // soixante-cinq lignes « (sans titre) », qui ne permettent pas de choisir.
  const lines = listed.text.split('\n').filter(l => /^\d+\. /.test(l));
  const untitledMarkers = lines.filter(l => /\(sans titre\)/.test(l)).length;
  check('AUCUNE ligne « (sans titre) » : le repli d\'extrait a remplacé le défaut du serveur',
    untitledMarkers === 0, untitledMarkers + ' ligne(s) « (sans titre) »');
  const emptyish = lines.filter(l => l.replace(/^\d+\.\s*/, '').trim().length < 3).length;
  check('chaque ligne du listing porte un repère lisible (titre ou extrait)',
    emptyish === 0, emptyish + ' ligne(s) sans repère sur ' + lines.length);
  check('le listing annonce combien de slides sont sans titre',
    /Slides sans titre : \d+/.test(listed.text),
    (listed.text.match(/Slides sans titre[^\n]*/) || ['non annoncé'])[0]);

  // ── 4. LE gain net : le texte des shapes GROUPÉES ─────────────────────────
  // Slide 2 = l'organigramme. 160 fragments a:t au total, dont 83 imbriqués
  // dans des p:grpSp que slide.shapes de python-pptx n'itère PAS : le serveur
  // en perd la moitié, et ce sont les noms et rattachements — exactement
  // l'information pour laquelle on ouvre ce fichier.
  const s2 = await callTool('docs__read', { ref: pref, selector: '2' });
  check('docs__read d\'une slide rend son texte', !s2.isError, s2.text.split('\n')[0].slice(0, 80));
  check('l\'en-tête nomme la slide servie', /--- Slide 2/.test(s2.text), s2.text.split('\n')[0]);
  check('LE GAIN : le texte des shapes GROUPÉES est là (le serveur le perd)',
    /GUIDAT/.test(s2.text) && /MARTINEZ/.test(s2.text),
    'GUIDAT=' + /GUIDAT/.test(s2.text) + ' MARTINEZ=' + /MARTINEZ/.test(s2.text));
  // La découpe : « Risques IT\nMarc GUIDAT » et non « Risques ITMarc GUIDAT »
  // (par shape, runs collés) ni « Risques », « IT », « » (balayage plat).
  check('la découpe est shape → a:p → runs : le libellé et la personne sont sur DEUX lignes',
    /Risques IT\nMarc GUIDAT/.test(s2.text),
    (s2.text.match(/Risques IT.{0,20}/s) || ['motif absent'])[0].replace(/\n/g, '⏎'));
  check('ce n\'est pas un balayage plat : aucun fragment isolé d\'un seul espace',
    !/\n \n/.test(s2.text));

  // ── 5. Plage, clamp et refus ──────────────────────────────────────────────
  const range = await callTool('docs__read', { ref: pref, selector: '2-5' });
  check('une plage rend TOUTES ses slides, dans l\'ordre',
    !range.isError && (range.text.match(/--- Slide \d+/g) || []).length === 4,
    (range.text.match(/--- Slide \d+/g) || []).join(' '));
  const clamped = await callTool('docs__read', { ref: pref, selector: '70-999' });
  check('une plage hors bornes est CLAMPÉE, pas refusée',
    !clamped.isError && /--- Slide 71/.test(clamped.text));
  check('le clamp est DIT, jamais silencieux (sinon le modèle croit le deck fini)',
    /Plage ramenée à 70-71/.test(clamped.text),
    (clamped.text.match(/\[Plage[^\]]*\]/) || ['pas de notice'])[0]);
  const bad = await callTool('docs__read', { ref: pref, selector: 'slide trois' });
  check('un selector non numérique échoue en NOMMANT la forme attendue',
    (bad.isError || /invalide/.test(bad.text)) && /'N-M'/.test(bad.text), bad.text.slice(0, 100));

  // ── 6. L'ack d'une lecture pptx dit « Slide » ─────────────────────────────
  const ra = await lastAck('docs_read');
  const rangeAck = await page.evaluate(() => docsReadAckHead({ selector: '2-5', sourceName: 'test.pptx' }));
  check('l\'ack d\'une lecture pptx dit « Slides … lues », PAS « Pages »',
    /^Slides 2-5 lues$/.test(rangeAck), rangeAck);

  // ── 7. Buffer non détaché : deuxième lecture du même handle ───────────────
  const second = await callTool('docs__read', { ref: pref, selector: '2' });
  check('DEUXIÈME lecture du même handle : fflate ne détache pas le buffer',
    !second.isError && second.text.length === s2.text.length,
    second.text.length + ' vs ' + s2.text.length + ' caractères');

  // ── 8. as_resource → js__eval ─────────────────────────────────────────────
  const asRes = await callTool('docs__read', { ref: pref, selector: '1-10', as_resource: true });
  const resId = (asRes.text.match(/res_[A-Za-z0-9_-]+/) || [])[0];
  check('as_resource rend un handle res_…', !!resId, asRes.text.slice(0, 100));
  const resAck = await lastAck('docs_read');
  check('la ressource est nommée d\'après le deck ET la plage de SLIDES (-sN)',
    /^test-s1-10\.txt$/.test(resAck.name), resAck.name);
  check('l\'ack en as_resource dit toujours « Slides … lues » (le mot vient de sourceName)',
    /^Slides 1-10 lues$/.test(resAck.head), resAck.head);
  if (resId) {
    // `lines` est une FONCTION du prélude : `lines.length` rendrait son arité (0)
    // et le contrôle passerait sans rien prouver (leçon de l'étape 2). On compte
    // les en-têtes de slide effectivement retrouvés dans le texte stocké.
    const evaled = await callTool('js__eval', { handle: resId,
      code: 'lines().filter(function(l){ return l.indexOf("--- Slide ") === 0; }).length' });
    check('la ressource est exploitable par js__eval et porte les 10 en-têtes de slide',
      !evaled.isError && /\b10\b/.test(evaled.text), evaled.text.slice(0, 60));
  }

  // ── 9. Description de bibliothèque ────────────────────────────────────────
  const desc = await page.evaluate(async ([b64, mime]) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const rec = { name: 'biblio.pptx', mime: mime, data: u8.buffer };
    return await extractBinaryFileTextForDescription(rec, 1200);
  }, [pptxBytes.toString('base64'), PPTX_MIME]);
  check('un .pptx de bibliothèque est décrit par ses SLIDES',
    !!desc && /Présentation PowerPoint —/.test(desc), (desc || 'null').slice(0, 70));
  check('sa description n\'est PAS son listing de pièces XML',
    !!desc && !/ppt\/slides/.test(desc));

  // ── 10. LA GARDE D'ORDRE et les NOTES — deuxième fixture ──────────────────
  // deck-notes.pptx a un sldIdLst INVERSÉ : la pièce slide4.xml est la slide 1
  // de la présentation. Trier par numéro de fichier rendrait exactement
  // l'inverse, en silence — le modèle lirait « slide 1 » en croyant lire la
  // première. C'est LE mode de défaillance que ce lot refuse depuis V-1.
  const nref = await attachAndResolve('deck-notes.pptx', PPTX_MIME, notesBytes, 'et ce deck-ci');
  const nlist = await callTool('docs__list', { ref: nref });
  check('la deuxième fixture s\'ouvre', !nlist.isError, nlist.text.split('\n')[0]);
  const nLines = nlist.text.split('\n').filter(l => /^\d+\. /.test(l));
  check('LA GARDE D\'ORDRE : la slide 1 du listing est la pièce slide4.xml (sldIdLst inversé)',
    /^1\. /.test(nLines[0] || '') && !/Ouverture/.test(nLines[0] || ''),
    'slide 1 = ' + (nLines[0] || 'aucune'));
  check('… et la slide TITRÉE, pièce slide1.xml, est rendue en DERNIÈRE position',
    /Ouverture/.test(nLines[nLines.length - 1] || ''),
    'slide ' + nLines.length + ' = ' + (nLines[nLines.length - 1] || 'aucune'));

  // Les notes : leur liaison passe par les rels de la slide, jamais par le
  // numéro — notesSlide2.xml est ici la note de la slide 1 AFFICHÉE.
  check('les slides porteuses de notes sont MARQUÉES au listing',
    /\[notes\]/.test(nlist.text) && /Notes de présentateur : \d+ slide/.test(nlist.text),
    (nlist.text.match(/Notes de présentateur[^\n]*/) || ['non annoncées'])[0]);
  const n1 = await callTool('docs__read', { ref: nref, selector: '1' });
  check('LA LIAISON NOTES : la note de la slide 1 affichée est bien la sienne',
    !n1.isError && /le propos est ici/.test(n1.text),
    (n1.text.match(/Notes de présentateur[^\n]*\n[^\n]*/) || ['aucune note'])[0].replace(/\n/g, ' ⏎ '));
  check('les notes sont SÉPARÉES du corps par un intertitre explicite',
    /--- Notes de présentateur \(slide 1\) ---/.test(n1.text),
    'sinon le modèle attribue au public ce qui visait le présentateur');
  const n4 = await callTool('docs__read', { ref: nref, selector: '4' });
  check('la slide titrée (dernière) porte sa propre note, pas celle d\'une autre',
    !n4.isError && /chiffre de 2025/.test(n4.text) && !/le propos est ici/.test(n4.text),
    n4.text.slice(-90).replace(/\n/g, ' ⏎ '));
  check('… et son TITRE est repris dans l\'en-tête de lecture',
    /--- Slide 4 — Ouverture ---/.test(n4.text), n4.text.split('\n')[0]);

  // Le filtre de placeholders : sans lui, une note VIDE rendrait « Notes view: 17 »
  // ou le numéro de slide du gabarit — du chrome présenté comme du propos.
  const allNotes = (n1.text + n4.text);
  check('le filtre de placeholders tient : aucun « Notes view: » ni numéro nu en guise de note',
    !/Notes view:/.test(allNotes), 'chrome de gabarit absent');
  const n2 = await callTool('docs__read', { ref: nref, selector: '2' });
  check('une slide SANS note ne se voit pas inventer d\'intertitre de notes',
    !n2.isError && !/Notes de présentateur/.test(n2.text));

  // Le tableau (a:tbl d'un p:graphicFrame) : même forme que côté docx.
  const nTable = await callTool('docs__read', { ref: nref, selector: '2' });
  const anyTable = [n1.text, n2.text, n4.text, nTable.text,
    (await callTool('docs__read', { ref: nref, selector: '3' })).text].join('\n');
  check('un tableau de slide sort en lignes « a | b | c », comme côté Word',
    /Service \| Responsable/.test(anyTable) && /Finance \| Liliane COJAN/.test(anyTable),
    (anyTable.match(/[^\n]*\| Responsable[^\n]*/) || ['aucune ligne tabulaire'])[0]);

  // ── 11. Non-régression des quatre autres formats ──────────────────────────
  if (docxBytes) {
    const dref = await attachAndResolve('test.docx', DOCX_MIME, docxBytes, 'et un word');
    const dl = await callTool('docs__list', { ref: dref });
    check('NON-RÉGRESSION Word : le document route toujours vers son lecteur',
      !dl.isError && /Document Word —/.test(dl.text), dl.text.split('\n')[0]);
  } else {
    console.log('  ..  test.docx absent : non-régression Word non exercée.');
  }

  if (xlsxBytes) {
    const xref = await attachAndResolve('test.xlsx', XLSX_MIME, xlsxBytes, 'et un classeur');
    const xl = await callTool('docs__list', { ref: xref });
    check('NON-RÉGRESSION Excel : le classeur route toujours vers son lecteur',
      !xl.isError && /Classeur Excel —/.test(xl.text), xl.text.split('\n')[0]);
    await callTool('docs__read', { ref: xref, selector: 'Synthèse' });
    const xAck = await lastAck('docs_read');
    check('NON-RÉGRESSION d\'ack : une feuille se dit toujours « Feuille … lue »',
      /^Feuille /.test(xAck.head), xAck.head);
  } else {
    console.log('  ..  test.xlsx absent : non-régression Excel non exercée.');
  }

  if (pdfBytes) {
    const pdfRef = await attachAndResolve('test.pdf', 'application/pdf', pdfBytes, 'et un pdf');
    const pl = await callTool('docs__list', { ref: pdfRef });
    check('NON-RÉGRESSION PDF : le PDF route toujours vers son lecteur',
      !pl.isError && /^PDF — /.test(pl.text), pl.text.split('\n')[0]);
    await callTool('docs__read', { ref: pdfRef, selector: '1' });
    const pAck = await lastAck('docs_read');
    // Même branche numérique que la slide depuis l'étape 3 : le mot vient
    // désormais de la table pour LES DEUX. Le PDF ne doit pas régresser.
    check('NON-RÉGRESSION d\'ack : un PDF se dit toujours « Page … lue »',
      /^Page 1-1 lue$|^Page 1 lue$/.test(pAck.head), pAck.head);
  } else {
    console.log('  ..  test.pdf absent : non-régression PDF non exercée.');
  }

  if (zipBytes) {
    const zref = await attachAndResolve('test-extract.zip', 'application/zip', zipBytes, 'et un zip');
    const zl = await callTool('docs__list', { ref: zref });
    check('NON-RÉGRESSION zip : l\'archive route toujours vers le lecteur zip',
      !zl.isError && /Archive zip/.test(zl.text), zl.text.split('\n')[0]);
    const zr = await callTool('docs__read', { ref: zref, selector: '1' });
    check('un zip refuse docs__read en ORIENTANT vers list+extract',
      /docs__extract/.test(zr.text), zr.text.slice(0, 90));
  } else {
    console.log('  ..  test-extract.zip absent : non-régression zip non exercée.');
  }

  // ── 12. Le listing zip d'un Office reste ATTEIGNABLE (V-5-PLAN §4.2) ──────
  // Ce n'est plus le chemin nominal, mais la capacité n'a pas été retirée :
  // docs__extract sait toujours sortir une pièce XML d'un .pptx.
  const ex = await callTool('docs__extract', { ref: pref, path: 'ppt/presentation.xml' });
  check('le .pptx reste extractible comme archive : la capacité zip n\'est pas perdue',
    !ex.isError && /res_/.test(ex.text), ex.text.slice(0, 80));

  await page.screenshot({ path: path.join(outDir, 'pptx-native.png'), fullPage: false });
} catch (e) {
  console.error('ERREUR: ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await browser.close();
}

console.log('');
if (failures.length) {
  console.log('ÉCHEC — ' + failures.length + ' contrôle(s) : ' + failures.join(' | '));
  process.exit(exitCode || 1);
}
console.log(exitCode ? 'INTERROMPU' : 'OK — tous les contrôles passent.');
process.exit(exitCode);
