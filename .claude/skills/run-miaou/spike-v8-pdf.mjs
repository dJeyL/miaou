// Spike V-8 : les trois mesures du PLAN §5, avant toute ligne de production.
//
// Ce script ne teste PAS MIAOU : il teste ce que pdf.js 3.11.174 fait vraiment
// dans les conditions de MIAOU (un seul <script src>, pas de module ES, page
// vierge), sur les fixtures réelles de untracked/test-files/.
//
// Les trois questions, telles que le PLAN les pose :
//   1. getPageIndex sur un vrai sommaire — combien d'entrées, Promise.all tient,
//      combien de ms, et la branche `dest` NOMMÉE est-elle exercée ?
//   2. Le poids réel d'une page rendue à scale 2 en PNG (et en JPEG, pour
//      trancher la question ouverte Q1 du PLAN).
//   3. Le rendu hors DOM : OffscreenCanvas suffit-il, ou faut-il un <canvas>
//      détaché ?
//
// La raison d'être du spike est écrite dans le PLAN : la relecture du
// 2026-08-29 reproche exactement de ne pas avoir mesuré le coût du sommaire
// avant de conclure que le fix était petit.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const PDF_CDN  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFW_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const REAL_DIR = '/Users/julien/llm-playground/miaou/untracked/test-files/';
const realOr = (n) => { try { return Array.from(readFileSync(REAL_DIR + n)); } catch { return null; } };

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) fails++;
};
const info = (label, detail) => console.log(`  ..  ${label}${detail ? '  — ' + detail : ''}`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));
await page.goto('about:blank');

// pdf.js chargé UNE fois, avec un vrai worker (comme ensurePdfJs le fait).
await page.evaluate(async ({ cdn, workerCdn }) => {
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = cdn; s.onload = res; s.onerror = () => rej(new Error('load pdf.js'));
    document.head.appendChild(s);
  });
  const blob = await fetch(workerCdn).then(r => r.blob());
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
}, { cdn: PDF_CDN, workerCdn: PDFW_CDN });
check('pdf.js 3.11.174 chargé (worker en blob:)', await page.evaluate(() => !!window.pdfjsLib));

// ── Mesure 1 : le sommaire et ses getPageIndex ───────────────────────────────
// Le PLAN §3.1 identifie deux pièges d'API : `dest` peut être une CHAÎNE
// (destination nommée → getDestination() préalable), et getPageIndex prend
// dest[0], pas le tableau. On mesure les deux, plus le coût.
// `expectResolved` : nombre d'entrées qui DOIVENT porter un numéro. Omis = toutes.
// La fixture named-dest-toc.pdf en a délibérément deux qui ne se résolvent pas
// (destination nommée absente de l'arbre /Names) : c'est le cas de dégradation
// par entrée du PLAN §3.2, et il doit être exercé, pas contourné.
async function measureOutline(name, bytes, label, expectResolved) {
  if (!bytes) { info(`${label} : fixture absente, mesure sautée`); return null; }
  const r = await page.evaluate(async ({ bytes }) => {
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const outline = await doc.getOutline();

    // Aplatissage itératif, identique à listPdfDocument (docs.js).
    const flat = [];
    const stack = [];
    for (let i = (outline || []).length - 1; i >= 0; i--) stack.push({ node: outline[i], level: 1 });
    while (stack.length) {
      const cur = stack.pop();
      const n = cur.node;
      if (!n) continue;
      flat.push({ level: cur.level, title: n.title, dest: n.dest });
      const kids = n.items || [];
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], level: cur.level + 1 });
    }

    const named = flat.filter(e => typeof e.dest === 'string').length;
    const arrayDest = flat.filter(e => Array.isArray(e.dest)).length;
    const nullDest = flat.filter(e => e.dest == null).length;

    // Résolution d'UNE entrée, telle que le PLAN §3.1 la décrit.
    const resolveOne = async (e) => {
      try {
        const dest = typeof e.dest === 'string' ? await doc.getDestination(e.dest) : e.dest;
        if (!Array.isArray(dest) || !dest.length) return 0;
        const idx = await doc.getPageIndex(dest[0]);
        return idx + 1;
      } catch (err) { return 0; }
    };

    // (a) Promise.all sur TOUT — l'hypothèse du PLAN.
    const tAll0 = performance.now();
    const pagesAll = await Promise.all(flat.map(resolveOne));
    const tAll = performance.now() - tAll0;

    // (b) séquentiel — le repli, pour connaître le facteur réel.
    const tSeq0 = performance.now();
    const pagesSeq = [];
    for (const e of flat) pagesSeq.push(await resolveOne(e));
    const tSeq = performance.now() - tSeq0;

    // (c) par lots de 50 — le repli du repli (PLAN §3.3).
    const tBatch0 = performance.now();
    const pagesBatch = [];
    for (let i = 0; i < flat.length; i += 50) {
      pagesBatch.push(...await Promise.all(flat.slice(i, i + 50).map(resolveOne)));
    }
    const tBatch = performance.now() - tBatch0;

    const resolved = pagesAll.filter(p => p > 0).length;
    const same = pagesAll.every((p, i) => p === pagesSeq[i]) &&
                 pagesAll.every((p, i) => p === pagesBatch[i]);
    const monotone = (() => {
      const lvl1 = pagesAll.filter((p, i) => flat[i].level === 1 && p > 0);
      for (let i = 1; i < lvl1.length; i++) if (lvl1[i] < lvl1[i - 1]) return false;
      return true;
    })();

    const titlesAllPresent = flat.every(e => typeof e.title === 'string' && e.title.length > 0);
    const sample = flat.slice(0, 3).map((e, i) => `${'  '.repeat(e.level - 1)}${pagesAll[i] ? 'p.' + pagesAll[i] + ' ' : '(sans numéro) '}${e.title}`);
    doc.destroy();
    return { entries: flat.length, pages: doc.numPages, named, arrayDest, nullDest,
             resolved, same, monotone, tAll, tSeq, tBatch, sample, titlesAllPresent,
             maxLevel: Math.max(...flat.map(e => e.level)) };
  }, { bytes });

  if (!r) return null;
  console.log(`\n  [${label}] ${r.entries} entrées d'outline, profondeur ${r.maxLevel}`);
  info('formes de dest', `nommée(chaîne)=${r.named}  tableau=${r.arrayDest}  absente=${r.nullDest}`);
  const want = expectResolved == null ? r.entries : expectResolved;
  check(`${label} : ${want}/${r.entries} entrées résolues comme attendu`, r.resolved === want,
        `${r.resolved} avec un numéro de page`);
  if (expectResolved != null) {
    // Le vrai contrôle de la dégradation : l'entrée non résoluble garde son
    // TITRE et perd seulement son numéro — jamais le sommaire entier.
    check(`${label} : les entrées non résolubles gardent leur titre`,
          r.titlesAllPresent, `${r.entries} titres présents`);
  }
  check(`${label} : les trois stratégies donnent le MÊME résultat`, r.same);
  check(`${label} : numéros de niveau 1 monotones croissants`, r.monotone);
  info('coût Promise.all (tout)', `${r.tAll.toFixed(1)} ms`);
  info('coût séquentiel', `${r.tSeq.toFixed(1)} ms  (×${(r.tSeq / r.tAll).toFixed(1)})`);
  info('coût par lots de 50', `${r.tBatch.toFixed(1)} ms`);
  info('extrait', '\n      ' + r.sample.join('\n      '));
  return r;
}

const big = await measureOutline('big-toc.pdf', realOr('big-toc.pdf'), 'big-toc.pdf');
const test = await measureOutline('test.pdf', realOr('test.pdf'), 'test.pdf');
// Destinations NOMMÉES + deux entrées volontairement non résolubles (4/6).
const named = await measureOutline('named-dest-toc.pdf', realOr('named-dest-toc.pdf'),
                                   'named-dest-toc.pdf', 4);

// ── Mesure 2 : le poids d'une page rendue ────────────────────────────────────
// PLAN §4.1 : scale 2 (~144 dpi), cap 4 Mo, dégradation d'échelle avant abandon.
// La question ouverte Q1 (PNG vs JPEG) se tranche sur ces chiffres.
async function measureRender(bytes, label, pageNum) {
  if (!bytes) { info(`${label} : fixture absente, mesure sautée`); return null; }
  const r = await page.evaluate(async ({ bytes, pageNum }) => {
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pg = await doc.getPage(pageNum);
    const out = [];
    for (const scale of [2, 1.5, 1]) {
      const viewport = pg.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const t0 = performance.now();
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const tRender = performance.now() - t0;
      const png = canvas.toDataURL('image/png');
      const jpg = canvas.toDataURL('image/jpeg', 0.92);
      // Le poids qui compte est celui du base64 (ce qui part dans le contexte).
      out.push({ scale, w: canvas.width, h: canvas.height, tRender,
                 pngB64: png.length, jpgB64: jpg.length });
    }
    pg.cleanup(); doc.destroy();
    return out;
  }, { bytes, pageNum });

  console.log(`\n  [${label} p.${pageNum}]`);
  for (const m of r) {
    const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
    info(`scale ${m.scale}`, `${m.w}×${m.h}px  rendu ${m.tRender.toFixed(0)} ms  ` +
         `PNG(b64) ${mb(m.pngB64)}  JPEG92(b64) ${mb(m.jpgB64)}  ` +
         `ratio ×${(m.pngB64 / m.jpgB64).toFixed(1)}`);
  }
  return r;
}

const CAP = 4 * 1024 * 1024;
const rScan = await measureRender(realOr('scanned2.pdf'), 'scanned2.pdf (scan pur)', 1);
const rTest = await measureRender(realOr('test.pdf'), 'test.pdf (PDF texte)', 1);
const rMixed = await measureRender(realOr('scanned-mixed.pdf'), 'scanned-mixed.pdf', 2);

for (const [label, r] of [['scanned2', rScan], ['test', rTest], ['scanned-mixed', rMixed]]) {
  if (!r) continue;
  const s2 = r.find(m => m.scale === 2);
  check(`${label} : PNG à scale 2 sous le cap de 4 Mo`, s2.pngB64 <= CAP,
        `${(s2.pngB64 / 1024 / 1024).toFixed(2)} Mo`);
}

// ── Mesure 3 : le rendu hors DOM ─────────────────────────────────────────────
// Le PLAN suppose OffscreenCanvas « à vérifier plutôt qu'à supposer ».
const off = await page.evaluate(async ({ bytes }) => {
  if (typeof OffscreenCanvas === 'undefined') return { supported: false };
  try {
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pg = await doc.getPage(1);
    const viewport = pg.getViewport({ scale: 2 });
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    // OffscreenCanvas n'a PAS toDataURL : il faut convertBlob() + FileReader.
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const dataUrl = await new Promise((res) => {
      const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob);
    });
    pg.cleanup(); doc.destroy();
    return { supported: true, hasToDataURL: typeof canvas.toDataURL === 'function',
             b64: dataUrl.length, prefix: dataUrl.slice(0, 20) };
  } catch (e) { return { supported: true, err: e.message }; }
}, { bytes: realOr('test.pdf') || [] });

console.log('\n  [rendu hors DOM]');
check('OffscreenCanvas disponible', !!off.supported);
check('pdf.js rend dans un OffscreenCanvas', !off.err, off.err || '');
if (off.supported && !off.err) {
  info('toDataURL sur OffscreenCanvas', off.hasToDataURL ? 'présent' : 'ABSENT → convertToBlob + FileReader');
  info('dataUrl obtenue', `${off.prefix}…  ${(off.b64 / 1024 / 1024).toFixed(2)} Mo`);
}

// ── Bonus : la couche texte des fixtures de scan, pour la notice prolongée ───
// Le PLAN §4.4 prolonge la notice de formatPdfRead. On revérifie ici l'état des
// trois fixtures, parce que la notice ne doit se déclencher que là où il faut.
const scans = await page.evaluate(async ({ files }) => {
  const out = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (!bytes || !bytes.length) { out[name] = null; continue; }
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const per = [];
    for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
      const pg = await doc.getPage(n);
      const tc = await pg.getTextContent();
      per.push({ page: n, items: tc.items.length,
                 chars: tc.items.map(i => i.str).join('').length });
      pg.cleanup();
    }
    out[name] = { pages: doc.numPages, per };
    doc.destroy();
  }
  return out;
}, { files: { 'scanned.pdf': realOr('scanned.pdf'), 'scanned2.pdf': realOr('scanned2.pdf'),
              'scanned-mixed.pdf': realOr('scanned-mixed.pdf') } });

console.log('\n  [couche texte des fixtures de scan]');
for (const [name, r] of Object.entries(scans)) {
  if (!r) { info(name, 'absente'); continue; }
  info(name, `${r.pages} page(s) — ` + r.per.map(p => `p${p.page}:${p.items}it/${p.chars}car`).join('  '));
}

await browser.close();
console.log(`\n${fails === 0 ? 'OK' : fails + ' ÉCHEC(S)'}`);
process.exit(fails === 0 ? 0 : 1);
