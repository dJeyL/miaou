// Spike V-4/V-5 : les trois bibliothèques d'ouverture de documents tournent-elles
// dans les conditions de MIAOU ? (un seul <script src>, pas de module ES, pas de
// bundler, page file://, aucun worker séparé à héberger)
//
// Ce script ne teste PAS MIAOU : il teste les ARTEFACTS candidats, avant qu'on
// écrive une ligne de V-4/V-5. Il charge chaque lib depuis son CDN dans une page
// vierge et lui fait extraire du texte d'une fixture réelle produite par les
// mêmes libs Python que mcp_docs.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => Array.from(readFileSync(join(here, 'spike-v45-fixtures', n)));

const PDF_CDN    = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFW_CDN   = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const MAMMOTH_CDN= 'https://cdn.jsdelivr.net/npm/mammoth@1.11.0/mammoth.browser.min.js';
const XLSX_CDN   = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const FFLATE_CDN = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) fails++;
};

// Fixtures RÉELLES (untracked/test-files/, jeu de Julien) — non versionnées avec
// ce script, d'où la garde : le spike tourne sans elles, en signalant ce qu'il
// n'a pas pu vérifier. Les fixtures fabriquées ci-dessus testent la MÉCANIQUE ;
// celles-ci testent ce que la mécanique rencontre vraiment (organigramme à
// shapes groupées, checklist à 10 tableaux, classeur à 76 lignes, deck exporté
// en PDF). Le §Fichiers réels ci-dessous est ce qui a fait bouger V-5.
const REAL_DIR = '/Users/julien/llm-playground/miaou/untracked/test-files/';
const realOr = (n) => { try { return Array.from(readFileSync(REAL_DIR + n)); } catch { return null; } };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('   [console.error] ' + m.text()); });
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));
await page.goto('about:blank');
await page.evaluate((b) => { window.realOrPdf = b; }, realOr('test.pdf') || []);

// ── 1. pdf.js 3.11.174 UMD, SANS worker séparé (fake worker) ─────────────────
const realOrPdfOuter = realOr('test.pdf');
const pdfRes = await page.evaluate(async ({ cdn, bytes }) => {
  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
  const t0 = performance.now();
  try { await load(cdn); } catch (e) { return { err: 'script: ' + e.message }; }
  const lib = window.pdfjsLib;
  if (!lib) return { err: 'pdfjsLib absent' };
  // Fake worker : pas de workerSrc → pdf.js charge le worker en main thread.
  lib.GlobalWorkerOptions.workerSrc = '';
  try {
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      pages.push(tc.items.map(it => it.str).join(''));
    }
    const outline = await doc.getOutline();
    return { ok: true, numPages: doc.numPages, pages, outline: (outline || []).map(o => o.title), ms: Math.round(performance.now() - t0) };
  } catch (e) { return { err: 'getDocument: ' + e.message }; }
}, { cdn: PDF_CDN, bytes: fx('spike.pdf') });

if (pdfRes.err) { check('pdf.js sans worker', false, pdfRes.err); }
else {
  check('pdf.js : 3 pages lues', pdfRes.numPages === 3, `numPages=${pdfRes.numPages}, ${pdfRes.ms} ms`);
  check('pdf.js : texte page 1', /ZEBRE0/.test(pdfRes.pages[0] || ''), JSON.stringify((pdfRes.pages[0] || '').slice(0, 70)));
  check('pdf.js : accents préservés', /éàü/.test(pdfRes.pages[0] || ''), '');
  check('pdf.js : sommaire (getOutline)', (pdfRes.outline || []).length === 2, JSON.stringify(pdfRes.outline));
}

// ── 1bis. Le worker RÉEL est-il chargeable en blob: depuis un CDN ? ──────────
// Alternative au fake worker si celui-ci bloque l'UI : fetch du .js puis
// URL.createObjectURL. Testé parce qu'un PDF de 400 pages en main thread gèlerait.
const workerRes = await page.evaluate(async ({ wsrc }) => {
  try {
    const r = await fetch(wsrc);
    if (!r.ok) return { err: 'fetch ' + r.status };
    const txt = await r.text();
    const url = URL.createObjectURL(new Blob([txt], { type: 'application/javascript' }));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array([37,80,68,70]) }).promise.catch(e => e);
    // On ne veut PAS un PDF valide ici : seul compte que le worker démarre.
    // Un worker qui ne démarre pas donne « Setting up fake worker failed ».
    const msg = String(doc && doc.message || '');
    return { ok: true, msg, bytes: txt.length };
  } catch (e) { return { err: e.message }; }
}, { wsrc: PDFW_CDN });
check('pdf.js : worker réel via blob: URL',
  !!workerRes.ok && !/fake worker failed/i.test(workerRes.msg || ''),
  workerRes.err || `worker ${workerRes.bytes} o, erreur PDF attendue: ${JSON.stringify((workerRes.msg||'').slice(0,60))}`);

// ── 2. mammoth (docx → HTML / texte brut) ────────────────────────────────────
const mamRes = await page.evaluate(async ({ cdn, bytes }) => {
  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = () => rej(new Error('load')); document.head.appendChild(s);
  });
  try { await load(cdn); } catch (e) { return { err: 'script' }; }
  if (!window.mammoth) return { err: 'global mammoth absent' };
  const buf = new Uint8Array(bytes).buffer;
  try {
    const html = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    const raw  = await window.mammoth.extractRawText({ arrayBuffer: buf.slice(0) });
    return { ok: true, html: html.value, msgs: html.messages.length, raw: raw.value };
  } catch (e) { return { err: e.message }; }
}, { cdn: MAMMOTH_CDN, bytes: fx('spike.docx') });

if (mamRes.err) check('mammoth', false, mamRes.err);
else {
  check('mammoth : headings en <h1>/<h2>', /<h1>Titre principal<\/h1>/.test(mamRes.html) && /<h2>Sous-section<\/h2>/.test(mamRes.html), JSON.stringify(mamRes.html.slice(0, 90)));
  check('mammoth : tableau converti en <table>', /<table>/.test(mamRes.html), '');
  check('mammoth : texte brut + accents', /DOCXZEBRE/.test(mamRes.raw) && /éàü/.test(mamRes.raw), JSON.stringify(mamRes.raw.slice(0, 60)));
}

// ── 3. SheetJS (xlsx) ────────────────────────────────────────────────────────
const xlsxRes = await page.evaluate(async ({ cdn, bytes }) => {
  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = () => rej(new Error('load')); document.head.appendChild(s);
  });
  try { await load(cdn); } catch (e) { return { err: 'script' }; }
  if (!window.XLSX) return { err: 'global XLSX absent' };
  try {
    const wb = window.XLSX.read(new Uint8Array(bytes), { type: 'array' });
    const s1 = wb.Sheets[wb.SheetNames[0]];
    return {
      ok: true, names: wb.SheetNames, ref: s1['!ref'],
      csv: window.XLSX.utils.sheet_to_csv(s1),
      json: window.XLSX.utils.sheet_to_json(s1, { header: 1 }),
      // PIÈGE VÉRIFIÉ : sheet_to_csv IGNORE l'option `range` en 0.18.5 (les trois
    // formes — chaîne, objet decode_range, entier — rendent la feuille ENTIÈRE).
    // Deux voies qui marchent, à choisir en V-5 pour porter le selector
    // 'Feuille!A1:C10' : sheet_to_json({range}), ou un clone à !ref restreint.
    subCsvBuggy: window.XLSX.utils.sheet_to_csv(s1, { range: 'A1:B2' }),
    subJson: window.XLSX.utils.sheet_to_json(s1, { header: 1, range: 'A2:B3' }),
    subClone: window.XLSX.utils.sheet_to_csv(Object.assign({}, s1, { '!ref': 'A1:B2' })),
    };
  } catch (e) { return { err: e.message }; }
}, { cdn: XLSX_CDN, bytes: fx('spike.xlsx') });

if (xlsxRes.err) check('SheetJS', false, xlsxRes.err);
else {
  check('SheetJS : deux feuilles nommées', JSON.stringify(xlsxRes.names) === '["Feuille1","Deuxieme"]', JSON.stringify(xlsxRes.names));
  check('SheetJS : dimension (!ref)', xlsxRes.ref === 'A1:B3', xlsxRes.ref);
  check('SheetJS : CSV + accents', /bêta/.test(xlsxRes.csv) && /3\.14/.test(xlsxRes.csv), JSON.stringify(xlsxRes.csv));
  check('SheetJS : sheet_to_csv IGNORE `range` (piège figé)',
    xlsxRes.subCsvBuggy.trim().split('\n').length === 3, JSON.stringify(xlsxRes.subCsvBuggy));
  check('SheetJS : sheet_to_json({range}) honore la plage',
    JSON.stringify(xlsxRes.subJson) === '[["alpha",42],["b\u00eata",3.14]]', JSON.stringify(xlsxRes.subJson));
  check('SheetJS : clone \u00e0 !ref restreint honore la plage',
    xlsxRes.subClone.trim().split('\n').length === 2, JSON.stringify(xlsxRes.subClone));
}

// ── 4. PPTX maison : fflate + DOMParser sur ppt/slides/slideN.xml ────────────
// C'est le portage à écrire (aucune lib satisfaisante). Le spike vérifie que le
// chemin brut donne bien le texte, avec l'ORDRE des slides et le titre.
const pptxRes = await page.evaluate(async ({ cdn, bytes }) => {
  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = () => rej(new Error('load')); document.head.appendChild(s);
  });
  try { await load(cdn); } catch (e) { return { err: 'script fflate' }; }
  try {
    const files = window.fflate.unzipSync(new Uint8Array(bytes), {
      filter: f => /^ppt\/slides\/slide\d+\.xml$/.test(f.name)
                || f.name === 'ppt/_rels/presentation.xml.rels'
                || f.name === 'ppt/presentation.xml',
    });
    const dec = new TextDecoder();
    const names = Object.keys(files).filter(n => /slide\d+\.xml$/.test(n))
      .sort((a, b) => (+a.match(/(\d+)\.xml/)[1]) - (+b.match(/(\d+)\.xml/)[1]));
    const parser = new DOMParser();
    const slides = names.map(n => {
      const doc = parser.parseFromString(dec.decode(files[n]), 'application/xml');
      // a:t = run de texte ; le titre est dans le shape dont ph type="title"/"ctrTitle"
      const texts = Array.from(doc.getElementsByTagName('a:t')).map(e => e.textContent);
      const shapes = Array.from(doc.getElementsByTagName('p:sp'));
      let title = null;
      for (const sp of shapes) {
        const ph = sp.getElementsByTagName('p:ph')[0];
        const ty = ph && ph.getAttribute('type');
        if (ph && (ty === 'title' || ty === 'ctrTitle')) {
          title = Array.from(sp.getElementsByTagName('a:t')).map(e => e.textContent).join('');
          break;
        }
      }
      return { name: n, title, texts };
    });
    // L'ordre RÉEL des slides est dans presentation.xml (sldIdLst), pas dans le
    // numéro du fichier : le spike vérifie que la source existe.
    const presXml = files['ppt/presentation.xml'] ? dec.decode(files['ppt/presentation.xml']) : '';
    const sldIds = (presXml.match(/<p:sldId /g) || []).length;
    return { ok: true, slides, sldIds, hasRels: !!files['ppt/_rels/presentation.xml.rels'] };
  } catch (e) { return { err: e.message }; }
}, { cdn: FFLATE_CDN, bytes: fx('spike.pptx') });

if (pptxRes.err) check('PPTX maison', false, pptxRes.err);
else {
  check('PPTX : 2 slides trouvées', pptxRes.slides.length === 2, JSON.stringify(pptxRes.slides.map(s => s.name)));
  check('PPTX : titre de slide extrait', pptxRes.slides[0] && pptxRes.slides[0].title === 'Slide un', JSON.stringify(pptxRes.slides.map(s => s.title)));
  check('PPTX : texte de corps + accents', JSON.stringify(pptxRes.slides[0].texts).includes('PPTXZEBRE'), JSON.stringify(pptxRes.slides[0].texts));
  check('PPTX : textbox libre (sans placeholder)', JSON.stringify(pptxRes.slides[1].texts).includes('4242'), JSON.stringify(pptxRes.slides[1].texts));
  check('PPTX : ordre réel disponible (sldIdLst)', pptxRes.sldIds === 2 && pptxRes.hasRels, `sldId=${pptxRes.sldIds}, rels=${pptxRes.hasRels}`);
}

// ── 5. Coexistence : les quatre libs chargées dans la MÊME page ─────────────
const coex = await page.evaluate(() => ({
  pdfjsLib: !!window.pdfjsLib, mammoth: !!window.mammoth,
  XLSX: !!window.XLSX, fflate: !!window.fflate,
  fflateStillWorks: (() => { try { return window.fflate.strToU8('x').length === 1; } catch { return false; } })(),
}));
check('coexistence des 4 globals dans une page', Object.values(coex).every(Boolean), JSON.stringify(coex));

// ── 6. FICHIERS RÉELS — la parité se juge ici, pas sur des fixtures jouets ────
const realPptx = realOr('test.pptx');
if (!realPptx) {
  console.log('SKIP  fichiers réels absents (untracked/test-files/) — mécanique seule vérifiée');
} else {
  const real = await page.evaluate(async ({ pptx, docx, xlsx }) => {
    const dec = new TextDecoder();
    const P = new DOMParser();

    // -- PPTX : le cas qui a changé V-5 --
    const all = window.fflate.unzipSync(new Uint8Array(pptx), {
      filter: f => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(f.name)
                || f.name === 'ppt/presentation.xml'
                || f.name === 'ppt/_rels/presentation.xml.rels',
    });
    const slideNames = Object.keys(all).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const notesNames = Object.keys(all).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    const rels = dec.decode(all['ppt/_rels/presentation.xml.rels']);
    const relMap = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) relMap[m[1]] = m[2];
    for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) relMap[m[2]] = m[1];
    const order = [];
    for (const m of dec.decode(all['ppt/presentation.xml']).matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) {
      const t = relMap[m[1]];
      if (t) order.push('ppt/' + t.replace(/^\.\.\//, ''));
    }
    // Slide 2 = l'organigramme à shapes groupées
    const d2 = P.parseFromString(dec.decode(all['ppt/slides/slide2.xml']), 'application/xml');
    const allT = Array.from(d2.getElementsByTagName('a:t'));
    const inGrp = allT.filter(t => { let n = t.parentNode; while (n) { if (n.nodeName === 'p:grpSp') return true; n = n.parentNode; } return false; });
    const titled = slideNames.filter(n => {
      const doc = P.parseFromString(dec.decode(all[n]), 'application/xml');
      for (const sp of Array.from(doc.getElementsByTagName('p:sp'))) {
        const ph = sp.getElementsByTagName('p:ph')[0];
        const ty = ph && ph.getAttribute('type');
        if (ph && (ty === 'title' || ty === 'ctrTitle')
            && Array.from(sp.getElementsByTagName('a:t')).map(e => e.textContent).join('').trim()) return true;
      }
      return false;
    }).length;

    // -- PDF : hasEOL, le piège des lignes collées --
    const r = await fetch('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await r.text()], { type: 'application/javascript' }));
    const pdfDoc = await window.pdfjsLib.getDocument({ data: new Uint8Array(realOrPdf) }).promise;
    const tc = await (await pdfDoc.getPage(1)).getTextContent();
    const joined = tc.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('');
    const outline = await pdfDoc.getOutline().catch(() => null);

    // -- DOCX / XLSX --
    const h = await window.mammoth.convertToHtml({ arrayBuffer: new Uint8Array(docx).buffer });
    const wb = window.XLSX.read(new Uint8Array(xlsx), { type: 'array' });
    const sh = wb.Sheets[wb.SheetNames[1]];

    return {
      slideCount: slideNames.length, notesCount: notesNames.length,
      orderCount: order.length, titled,
      s2total: allT.length, s2inGroup: inGrp.length,
      pdfPages: pdfDoc.numPages, pdfHasEOL: joined.includes('\n'), pdfOutline: (outline || []).length,
      docxTables: (h.value.match(/<table>/g) || []).length,
      docxHeads: (h.value.match(/<h[12]>/g) || []).length,
      docxMsgs: h.messages.length,
      xlsxSheets: wb.SheetNames.length,
      xlsxClone: window.XLSX.utils.sheet_to_csv(Object.assign({}, sh, { '!ref': 'A1:C4' })).trim().split('\n').length,
      // Buffer transféré ? pdf.js DÉTACHE le buffer qu'on lui passe (d'où le
      // u8.slice() d'openPdfDocument). La même question se pose pour SheetJS et
      // mammoth, et elle est invisible en test unitaire : il faut DEUX appels
      // enchaînés sur le MÊME buffer pour la voir. On mesure byteLength après
      // coup (0 = détaché) et on refait l'appel.
      xlsxDetach: (() => {
        const u = new Uint8Array(xlsx);
        window.XLSX.read(u, { type: 'array' });
        const after = u.buffer.byteLength;
        let second = 0;
        try { second = window.XLSX.read(u, { type: 'array' }).SheetNames.length; } catch (e) { second = -1; }
        return { after, second };
      })(),
      docxDetach: await (async () => {
        const u = new Uint8Array(docx);
        await window.mammoth.convertToHtml({ arrayBuffer: u.buffer });
        const after = u.buffer.byteLength;
        let second = -1;
        try { second = (await window.mammoth.convertToHtml({ arrayBuffer: u.buffer })).value.length; } catch (e) { second = -1; }
        return { after, second };
      })(),
    };
  }, { pptx: realPptx, docx: realOr('test.docx'), xlsx: realOr('test.xlsx') });

  check('RÉEL pptx : 71 slides, ordre résolu par rels', real.slideCount === 71 && real.orderCount === 71, `slides=${real.slideCount}, ordre=${real.orderCount}`);
  check('RÉEL pptx : 4 notesSlides présentes', real.notesCount === 4, `notes=${real.notesCount}`);
  check('RÉEL pptx : 6 slides titrées sur 71 (le listing par titre est FAIBLE)', real.titled === 6, `titrées=${real.titled}/71`);
  check('RÉEL pptx : slide 2 — 83/160 fragments DANS des groupes (le serveur les perd)',
    real.s2total === 160 && real.s2inGroup === 83, `total=${real.s2total}, en groupe=${real.s2inGroup}`);
  check('RÉEL pdf : 8 pages, sommaire, hasEOL fonctionne', real.pdfPages === 8 && real.pdfOutline === 8 && real.pdfHasEOL, JSON.stringify({ p: real.pdfPages, o: real.pdfOutline, eol: real.pdfHasEOL }));
  check('RÉEL docx : 10 tableaux + 10 headings, aucun message mammoth', real.docxTables === 10 && real.docxHeads === 10 && real.docxMsgs === 0, JSON.stringify({ t: real.docxTables, h: real.docxHeads, m: real.docxMsgs }));
  check('RÉEL xlsx : 2 feuilles, clone !ref honoré', real.xlsxSheets === 2 && real.xlsxClone === 4, JSON.stringify({ s: real.xlsxSheets, rows: real.xlsxClone }));
  check('RÉEL xlsx : SheetJS ne détache PAS le buffer (deux lectures enchaînées)',
    real.xlsxDetach.after > 0 && real.xlsxDetach.second === 2, JSON.stringify(real.xlsxDetach));
  check('RÉEL docx : mammoth ne détache PAS le buffer (deux conversions enchaînées)',
    real.docxDetach.after > 0 && real.docxDetach.second > 0, JSON.stringify(real.docxDetach));
}

await browser.close();
console.log(fails === 0 ? '\nOK — tous les contrôles passent.' : `\n${fails} contrôle(s) en échec.`);
process.exit(fails === 0 ? 0 : 1);
