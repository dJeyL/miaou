#!/usr/bin/env node
// verify-docs-worker — le parsing lourd reste-t-il hors du thread principal ?
//
// NON-RÉGRESSION du lot AD. Il rougit si quelqu'un remet un chemin de parsing en
// main thread, ce qui est le seul critère qui compte ici : la capacité n'est pas
// visible (aucun bouton, aucun texte), elle est entièrement dans le fait que
// l'UI reste vivante pendant qu'un classeur de 38 Mo se parse.
//
// LES TESTS QUICKJS NE PEUVENT PAS COUVRIR ÇA, et ce n'est pas un manque de
// zèle : il n'y a ni Worker, ni SheetJS, ni mammoth sous QuickJS. Les purs y
// sont testés, leur EXÉCUTION DANS LE WORKER ne l'est que par ce script.
//
// ── Ce qui est asserté, et pourquoi chaque contrôle peut rougir ─────────────
//
//  0. LA SONDE ELLE-MÊME, sur un blocage synthétique de 3 000 ms.
//     Ce contrôle passe en PREMIER parce que la première version du banc du
//     spike annonçait 18 ms de gel pour 5 872 ms de parsing — un chiffre
//     cohérent avec ce qu'on espérait, donc prêt à être rapporté comme une
//     bonne nouvelle. La sonde était coupée avant que le tick en retard ne
//     s'exécute : elle n'avait JAMAIS tourné pendant ce qu'elle prétendait
//     mesurer. Une sonde de gel se valide sur un blocage connu avant qu'on
//     croie ce qu'elle dit du reste.
//     Le COMPTE DE TICKS est le second filet, et c'est lui qui démasque le cas :
//     une sonde qui n'a pas tourné se reconnaît à son nombre de ticks, jamais à
//     la valeur qu'elle rapporte.
//
//  1. LE GEL, sur les trois formats, par les VRAIES entrées de MIAOU.
//     xlsx et docx doivent rester sous le seuil ; pptx doit rester MESURABLE en
//     main thread — c'est la garde contre un portage « par symétrie », le
//     raisonnement que le commentaire d'openPptxDocument existe pour arrêter.
//
//  2. LE GRAPHE CLOS DES PURS INJECTÉS.
//     DOC_WORKER_PURES est injecté par Function.prototype.toString(). Le
//     mécanisme impose que ces fonctions n'appellent QUE leurs pairs : une
//     seule référence extérieure ajoutée à l'une d'elles (une constante de
//     module, un global applicatif) casserait le worker SILENCIEUSEMENT à
//     l'exécution, en ReferenceError loin de sa cause. On l'attrape en
//     comparant le résultat du worker à celui du main thread sur une entrée
//     construite.
//
//  3. LE PAYLOAD N'EST PAS LE WORKBOOK.
//     Renvoyer wb transformerait 5,7 s de gel en 1,3 s — un worker à moitié
//     raté, dont personne ne verrait qu'il l'est (l'UI répond, le symptôme
//     passe de « le navigateur s'inquiète » à « ça rame »). On assert la FORME
//     de ce qui traverse, pas seulement le temps.
//
// ── Fixtures ────────────────────────────────────────────────────────────────
// ~60 Mo, non versionnées. Le script les GÉNÈRE s'il ne les trouve pas — jamais
// il ne passe au vert en les sautant, ce qui serait la vacuité parfaite : un
// verify de performance sans fichier lourd mesure le vide.
//
// Usage : node verify-docs-worker.mjs [--headed]   (depuis .claude/skills/run-miaou/)
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const fixDir = path.join(repoRoot, 'untracked/test-files/heavy');
const genScript = path.join(fixDir, 'generate.py');
const headed = process.argv.includes('--headed');

// Seuils. Le gel mesuré en worker est de ~18 ms ; 150 ms laisse la marge d'une
// machine chargée tout en restant DEUX ORDRES DE GRANDEUR sous les 5 731 ms du
// chemin main-thread. Un portage annulé se verrait immédiatement.
const FREEZE_MAX_MS = 150;
// Le pptx doit rester mesurable en main thread. Le seuil est BAS (10 ms) parce
// que l'assertion ne dit pas « c'est lent », elle dit « ça tourne encore ici » :
// un pptx passé en worker donnerait un gel proche de zéro.
const PPTX_MAIN_MIN_MS = 10;

const FIXTURES = [
  { fmt: 'xlsx', file: 'heavy-cells.xlsx' },
  { fmt: 'docx', file: 'heavy-text.docx' },
  { fmt: 'pptx', file: 'heavy-deck.pptx' },
];

const failures = [];
const check = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else { console.log('  FAIL  ' + label + (detail ? '  → ' + detail : '')); failures.push(label); }
};

// ── Fixtures : présentes, ou générées, ou échec explicite ───────────────────
const missing = FIXTURES.filter((f) => !fs.existsSync(path.join(fixDir, f.file)));
if (missing.length) {
  console.log('Fixtures manquantes (' + missing.map((f) => f.file).join(', ') + ') — génération…');
  if (!fs.existsSync(genScript)) {
    console.error('ÉCHEC : ' + genScript + ' est introuvable, impossible de régénérer.');
    process.exit(1);
  }
  try {
    execFileSync('uv', ['run', '--with', 'openpyxl', '--with', 'python-docx',
      '--with', 'python-pptx', '--with', 'pillow', 'python', genScript],
      { cwd: repoRoot, stdio: 'inherit' });
  } catch (e) {
    console.error('ÉCHEC de la génération des fixtures. À lancer à la main :\n' +
      '  uv run --with openpyxl --with python-docx --with python-pptx --with pillow \\\n' +
      '      python untracked/test-files/heavy/generate.py');
    process.exit(1);
  }
  const still = FIXTURES.filter((f) => !fs.existsSync(path.join(fixDir, f.file)));
  if (still.length) {
    console.error('ÉCHEC : fixtures toujours absentes après génération : ' +
      still.map((f) => f.file).join(', '));
    process.exit(1);
  }
}
for (const f of FIXTURES) {
  const p = path.join(fixDir, f.file);
  f.bytes = fs.readFileSync(p);
  f.size = f.bytes.length;
}

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 20000 });

// La sonde de gel : le plus long intervalle entre deux ticks, plus le COMPTE de
// ticks. stop() est ASYNC et laisse la sonde vivre 300 ms — le tick qui mesure
// le long intervalle ne s'exécute qu'APRÈS que le thread a rendu la main.
await page.evaluate(() => {
  window.__probe = {
    start() { this.worst = 0; this.ticks = 0; this.last = performance.now(); this.on = true;
      const tick = () => {
        if (!this.on) return;
        const now = performance.now();
        const gap = now - this.last;
        if (gap > this.worst) this.worst = gap;
        this.last = now; this.ticks++;
        setTimeout(tick, 16);
      };
      setTimeout(tick, 16);
    },
    async stop() {
      await new Promise((r) => setTimeout(r, 300));
      this.on = false;
      return { worst: Math.round(this.worst), ticks: this.ticks };
    },
  };
});

// ── 0. La sonde, sur blocage synthétique ────────────────────────────────────
console.log('\n── 0. Validation de la sonde (blocage synthétique de 3 000 ms)');
const probeCheck = await page.evaluate(async () => {
  window.__probe.start();
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) { /* blocage dur, non préemptible */ }
  const r = await window.__probe.stop();
  return r;
});
check('la sonde voit le blocage synthétique (~3 000 ms)',
  probeCheck.worst >= 2500 && probeCheck.worst <= 4000, `worst=${probeCheck.worst} ms`);
check('la sonde a réellement tourné (compte de ticks non nul)',
  probeCheck.ticks > 0, `ticks=${probeCheck.ticks}`);

// Les octets passent en base64 (evaluate ne transporte pas de Uint8Array).
for (const f of FIXTURES) {
  await page.evaluate(({ fmt, b64 }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    window.__fix = window.__fix || {};
    window.__fix[fmt] = u8;
  }, { fmt: f.fmt, b64: f.bytes.toString('base64') });
}

// ── 1. Le gel, par les VRAIES entrées de MIAOU ──────────────────────────────
// On appelle describeXlsxForLibrary / openDocxDocument / openPptxDocument,
// c'est-à-dire ce que MIAOU exécute réellement — jamais une réimplémentation du
// chemin, qui mesurerait un code que personne n'emprunte.
console.log('\n── 1. Gel mesuré sur les vraies entrées');
const timings = {};

// xlsx : describeXlsxForLibrary est le chemin du DÉPÔT de fichier, celui qui a
// produit le rapport d'origine, et celui qui appelait lib.read directement.
timings.xlsx = await page.evaluate(async () => {
  const u8 = window.__fix.xlsx;
  window.__probe.start();
  const t0 = performance.now();
  const out = await describeXlsxForLibrary(u8, 4000);
  const wall = Math.round(performance.now() - t0);
  const p = await window.__probe.stop();
  return { wall, worst: p.worst, ticks: p.ticks, chars: (out || '').length, ok: !!out };
});
check('xlsx : la description de bibliothèque produit bien du texte (prémisse)',
  timings.xlsx.ok && timings.xlsx.chars > 0, `chars=${timings.xlsx.chars}`);
check(`xlsx : gel < ${FREEZE_MAX_MS} ms au dépôt du fichier`,
  timings.xlsx.worst < FREEZE_MAX_MS,
  `gel=${timings.xlsx.worst} ms (mur ${timings.xlsx.wall} ms, ticks ${timings.xlsx.ticks})`);

// docx : openDocxDocument, partagé par list / read / describe.
timings.docx = await page.evaluate(async () => {
  const u8 = window.__fix.docx;
  window.__probe.start();
  const t0 = performance.now();
  const out = await openDocxDocument(u8, { name: 'heavy-text.docx' }, 'docs__list');
  const wall = Math.round(performance.now() - t0);
  const p = await window.__probe.stop();
  return { wall, worst: p.worst, ticks: p.ticks,
    sections: (out && out.sections && out.sections.length) || 0, fail: !!(out && out.fail) };
});
check('docx : le document est bien ouvert et découpé (prémisse)',
  !timings.docx.fail && timings.docx.sections > 0, `sections=${timings.docx.sections}`);
check(`docx : gel < ${FREEZE_MAX_MS} ms`,
  timings.docx.worst < FREEZE_MAX_MS,
  `gel=${timings.docx.worst} ms (mur ${timings.docx.wall} ms, ticks ${timings.docx.ticks})`);

// pptx : CONTRÔLE INVERSE. Il doit rester en main thread, donc son gel doit
// rester MESURABLE. Un vert ici sur un gel quasi nul signifierait qu'on l'a
// porté en worker « par symétrie » — ce que le lot a explicitement refusé.
timings.pptx = await page.evaluate(async () => {
  const u8 = window.__fix.pptx;
  window.__probe.start();
  const t0 = performance.now();
  const out = await openPptxDocument(u8, { name: 'heavy-deck.pptx' }, 'docs__list');
  const wall = Math.round(performance.now() - t0);
  const p = await window.__probe.stop();
  return { wall, worst: p.worst, ticks: p.ticks,
    slides: (out && out.slides && out.slides.length) || 0, fail: !!(out && out.fail) };
});
check('pptx : le deck est bien ouvert (prémisse)',
  !timings.pptx.fail && timings.pptx.slides > 0, `slides=${timings.pptx.slides}`);
check(`pptx : TÉMOIN — reste en main thread, gel >= ${PPTX_MAIN_MIN_MS} ms`,
  timings.pptx.worst >= PPTX_MAIN_MIN_MS,
  `gel=${timings.pptx.worst} ms — un gel quasi nul signalerait un portage en worker, ` +
  `que le lot refuse (cf. le commentaire d'openPptxDocument)`);

// ── 2. Le graphe clos des purs injectés ─────────────────────────────────────
// Une entrée CONSTRUITE, pas une fixture : elle doit exercer les trois faits
// mesurés qui gouvernent sheetToMatrix, sinon l'égalité passerait par vacuité.
console.log('\n── 2. Purs injectés : le worker rend-il la même chose que le main thread ?');
const parity = await page.evaluate(async () => {
  const sheet = {
    '!ref': 'B2:D4',                                        // origine NON-A1
    '!merges': [{ s: { r: 1, c: 1 }, e: { r: 1, c: 2 } }],  // une fusion
    B2: { v: 'titre', w: 'titre' },
    D2: { v: 7, w: '7' },
    B3: { v: 27, w: '27', f: 'COUNTIF(A:A,B1)' },           // une formule
    C3: { v: 1, w: '1' },
    D4: { v: 0.5, w: '50%' },
  };
  const expected = sheetToMatrix(sheet, 'B2:D4');

  // Le MÊME mécanisme d'injection que l'application : on compose la source par
  // docWorkerSource(), jamais une copie locale des purs — un banc qui
  // réimplémente ce qu'il mesure ne mesure rien.
  let source;
  try { source = docWorkerSource(); }
  catch (e) { return { sourceError: String((e && e.message) || e) }; }

  const body = "\nself.onmessage = (e) => {\n" +
    "  try { self.postMessage({ ok: true, value: sheetToMatrix(e.data.sheet, e.data.ref) }); }\n" +
    "  catch (err) { self.postMessage({ ok: false, error: String((err && err.message) || err) }); }\n" +
    "};\n";
  const url = URL.createObjectURL(new Blob([source + body], { type: 'text/javascript' }));
  const w = new Worker(url);
  const got = await new Promise((resolve) => {
    const to = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 10000);
    w.onmessage = (ev) => { clearTimeout(to); resolve(ev.data); };
    w.onerror = (ev) => { clearTimeout(to); resolve({ ok: false, error: 'onerror: ' + (ev.message || '?') }); };
    w.postMessage({ sheet, ref: 'B2:D4' });
  });
  w.terminate();
  URL.revokeObjectURL(url);

  return {
    pureCount: DOC_WORKER_PURES.length,
    sourceLen: source.length,
    got, expected,
    equal: JSON.stringify(got.value) === JSON.stringify(expected),
    // Témoins de non-vacuité : l'entrée exerce-t-elle ce qu'on croit ?
    maskedPresent: JSON.stringify(expected).includes('"masked":true'),
    formulaPresent: JSON.stringify(expected).includes('COUNTIF'),
  };
});
check('la source du worker se compose (tous les purs sont atteignables)',
  !parity.sourceError, parity.sourceError);
check('prémisse : l\'entrée produit bien une cellule masquée', parity.maskedPresent === true);
check('prémisse : l\'entrée produit bien une formule', parity.formulaPresent === true);
check('le worker exécute les purs sans ReferenceError',
  parity.got && parity.got.ok === true,
  parity.got && parity.got.error ? parity.got.error +
    ' — un pur du graphe référence sans doute un symbole extérieur (constante de module, global applicatif)' : '');
check('worker et main thread rendent un résultat IDENTIQUE',
  parity.equal === true,
  parity.equal ? '' : 'attendu ' + JSON.stringify(parity.expected) +
    ' / obtenu ' + JSON.stringify(parity.got && parity.got.value));

// ── 3. Le payload n'est pas le workbook ─────────────────────────────────────
console.log('\n── 3. Ce qui traverse le postMessage');
const payload = await page.evaluate(async () => {
  const u8 = window.__fix.xlsx;
  // Le nom de feuille est LU depuis le classeur, jamais figé en dur : un nom
  // écrit à la main ici deviendrait faux au premier changement du générateur, et
  // le rouge accuserait le code au lieu de la fixture.
  const listed = await parseXlsxInWorker(u8, 'list');
  const firstSheet = (listed && listed.sheets && listed.sheets[0] && listed.sheets[0].name) || '';
  const res = await parseXlsxInWorker(u8, 'read', { selector: firstSheet });
  const keys = Object.keys(res || {}).sort();
  return {
    keys,
    hasWorkbook: !!(res && (res.wb || res.Sheets || res.SheetNames)),
    rows: (res && res.matrix && res.matrix.rows && res.matrix.rows.length) || 0,
    sheets: (res && res.sheets && res.sheets.length) || 0,
  };
});
check('le worker rend des feuilles ET une matrice (prémisse : la lecture a eu lieu)',
  payload.sheets > 0 && payload.rows > 0, `sheets=${payload.sheets} rows=${payload.rows}`);
check('le workbook SheetJS ne traverse JAMAIS le postMessage',
  payload.hasWorkbook === false, `clés reçues : ${payload.keys.join(', ')}`);
// La matrice est BORNÉE : sans plage explicite, le cap de lecture s'applique en
// aval, mais ce qui traverse ne doit déjà pas être la feuille de 40 000 lignes.
check('la matrice qui traverse est bornée, pas la feuille entière',
  payload.rows > 0 && payload.rows <= 40000, `rows=${payload.rows}`);

// ── Erreurs console ─────────────────────────────────────────────────────────
console.log('\n── Console');
check('aucune erreur de page', pageErrors.length === 0, pageErrors.join(' | '));

console.log('\n──────── MESURES ────────');
for (const f of FIXTURES) {
  const t = timings[f.fmt];
  console.log(`${f.fmt.padEnd(5)} ${(f.size / 1048576).toFixed(1).padStart(5)} Mo | ` +
    `gel ${String(t.worst).padStart(5)} ms | mur ${String(t.wall).padStart(6)} ms | ticks ${t.ticks}`);
}
console.log(`purs injectés : ${parity.pureCount} fonctions, ${parity.sourceLen} caractères`);

await browser.close();
console.log('\n' + (failures.length
  ? `ÉCHEC — ${failures.length} contrôle(s) rouge(s) :\n  - ` + failures.join('\n  - ')
  : 'OK — tous les contrôles verts'));
process.exit(failures.length ? 1 : 0);
