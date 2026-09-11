#!/usr/bin/env node
// Vérif e2e du lot AC-5 (MIAOU) : les ANCRES D'IMAGES d'un PDF — une image
// signalée en fin de page, avec sa taille et la part de page qu'elle occupe.
//
// Complément indispensable des tests QuickJS, et le trou qu'il comble est
// précis : les purs (pdfAnchorBand, formatPdfImageAnchor,
// formatPdfPageAnchorNote) sont couverts par le runner, mais PDF.JS N'Y TOURNE
// PAS. Donc collectPdfPageImages — la fonction qui parcourt la liste
// d'opérateurs et SUIT LA MATRICE DE TRANSFORMATION pour en dériver position et
// taille — n'est exercée QUE par ce script. C'est elle qui produit TOUS les
// nombres que les purs se contentent de mettre en forme : si la pile
// save/restore ou la multiplication matricielle étaient fausses, les dix tests
// QuickJS resteraient verts et la sortie serait fausse. Le joint entre deux
// purs n'est vérifié nulle part ailleurs.
//
// CE QUI DISTINGUE CE LOT DES ANCRES OFFICE (AC-1/2/4), et qui est la raison
// d'être de sa forme : un .docx/.xlsx/.pptx est un zip, donc l'ancre y porte un
// CHEMIN de pièce que le modèle recopie pour extraire les octets. UN PDF N'A
// AUCUN MEMBRE ADRESSABLE : l'ancre signale une PRÉSENCE, sans cible. C'est
// « signaler sans extraire » (arbitrage Julien, 2026-09-11), et non une
// extraction restée en chemin. Aucune assertion de ce script ne doit donc
// exiger un chemin de pièce : ce serait exiger ce que le format ne permet pas.
//
// TROIS PRÉMISSES QUE CE SCRIPT REMESURE PLUTÔT QUE DE LES SUPPOSER.
// Elles viennent d'une sonde Node hors dépôt (pdfjs-dist 3.11.174 en module),
// que personne ne peut rejouer en lisant ce code. Un rendu vert sur une
// prémisse fausse serait le pire cas — et ces trois-là ont chacune renversé une
// décision du lot.
//   1. LES NOMS D'OBJET pdf.js SONT INSTABLES. `img_p2_1`, `g_d0_img_p2_1` :
//      une seconde ouverture du même document incrémente le préfixe de cache
//      global, l'ordre de visite inverse change le suffixe ET la page citée,
//      et visiter une page seule supprime le préfixe. D'où l'adressage par
//      (page, RANG), mesuré stable sur ces trois axes. Un script qui
//      vérifierait un nom d'objet serait rouge au hasard.
//   2. LE RANG PAR PAGE, LUI, EST STABLE : deux ouvertures successives et une
//      visite isolée rendent la même liste d'images pour une page donnée.
//      C'est ce qui autorise « page 3, image 2 » comme désignation.
//   3. LA COUVERTURE SÉPARE LE DÉCOR DE L'INFORMATION. Sur la fixture, les
//      bandeaux et pastilles tombent entre 0 et 2 % quand le schéma de la
//      première page occupe ~32 %. C'est la grandeur qui justifie tout le lot :
//      sans elle le modèle ne peut que tout rendre ou tout ignorer.
//
// CONFIDENTIALITÉ DES FIXTURES : les fichiers d'untracked/test-files/ sont des
// documents à ne pas divulguer. Aucune assertion ni aucun `detail` de ce script
// ne porte sur leur CONTENU — ni phrase extraite, ni titre de section, ni
// libellé. Tout ce qui est vérifié est une FORME (syntaxe de l'ancre), une
// GÉOMÉTRIE (taille en points, part de page, bande) ou un COMPTE. Une taille
// d'image est une coordonnée de mise en page, pas du contenu. Ne pas relâcher
// cette règle en ajoutant un contrôle : un `detail` est aussi divulgant qu'une
// assertion. Aucune capture d'écran.
//
// MESURES (2026-09-11, relevées sur les fixtures réelles) :
//
//   test.pdf — 8 pages, viewport 960x540 (format présentation)
//     p1 : 3 images, dont une de 407x407 à ~32 % de la page (la seule « grande »
//          du document), les deux autres à 3 % et 4 %
//     p2 : 3 images (196x40 à 2 %, 112x92 à 2 %, 36x29 sous le demi-point)
//     p7 : 3 images, dont une de 23x17 — la plus petite mesurée
//     Le BANDEAU de 196x40 reparaît sur 7 des 8 pages, à y=464 (haut de page).
//
//     ⚠ CETTE RÉPÉTITION N'EST PAS DÉDUPLIQUÉE, et c'est un arbitrage explicite
//     (Julien, 2026-09-11). Dédupliquer exigerait une identité d'image : les
//     noms pdf.js sont instables (prémisse 1) et le substitut position+taille
//     échoue précisément sur ce cas, le bandeau se déplaçant de quelques points
//     entre pages (795,464 en p3 contre 802,464 en p4). Une déduplication à
//     demi juste effacerait des images RÉELLES. Le bruit est préféré à
//     l'omission — une assertion exigeant « le bandeau n'apparaît qu'une fois »
//     serait donc à contre-sens du lot.
//
//   scanned-mixed.pdf — 2 pages
//     p1 : du texte ET une image qui couvre ~100 % de la page
//     p2 : AUCUN texte, une image à 100 % — la page scannée type
//
//     ⚠ LE CAS QUI GOUVERNE UN CONTRÔLE DE NON-RÉGRESSION : une page scannée
//     porte désormais une ancre. Sa détection de « page vide » doit rester
//     fondée sur le TEXTE SEUL, sans quoi l'ancre la ferait passer pour
//     non-vide et le renvoi vers docs__render_page — la seule issue offerte au
//     modèle sur un scan — disparaîtrait. C'est une régression que ce lot
//     pouvait introduire silencieusement.
//
// CE QUE CE SCRIPT NE COUVRE PAS SUR FIXTURE, et pourquoi — vacuités assumées,
// couvertes sur ENTRÉE CONSTRUITE dans les tests QuickJS :
//   - LE CAP (PDF_MAX_IMAGE_ANCHORS = 24) : la page la plus chargée du dépôt
//     porte 3 images. Une assertion de déclenchement serait une vacuité
//     inversée, accusant le code d'un défaut que la fixture ne porte pas.
//     Ne pas « rétablir » un tel contrôle sans un PDF à 25 images sur une page.
//   - LA BANDE « milieu de page » : les images mesurées sont en haut ou en bas.
//   - paintInlineImageXObject et paintImageMaskXObject : ZÉRO occurrence
//     mesurée (les deux fixtures n'émettent que paintImageXObject). Les deux
//     opérateurs sont traités dans le code, et NON revendiqués comme mesurés.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - LES TROIS PRÉMISSES mesurées directement sur la fixture (cf. supra)
//   - une page illustrée porte ses ancres, en FIN de page, après le texte
//   - l'ancre porte (page, rang), la taille et la couverture — jamais un nom
//     d'objet pdf.js
//   - le rang repart de 1 à chaque page (c'est une coordonnée locale)
//   - une page SANS image ne produit AUCUNE note
//   - NON-RÉGRESSION : une page scannée reste signalée « sans texte
//     extractible » et garde son renvoi vers docs__render_page
//   - NON-RÉGRESSION : le texte extrait est inchangé par l'ajout des ancres
//   - LA DESCRIPTION DE BIBLIOTHÈQUE N'EN HÉRITE PAS (arbitrage utilisateur) :
//     exclusion structurelle, donc contrôle de non-régression
//
// Usage : node verify-pdf-anchors.mjs [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN pdf.js).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const mixedPath = path.join(repoRoot, 'untracked/test-files/test.pdf');
const scannedPath = path.join(repoRoot, 'untracked/test-files/scanned-mixed.pdf');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
for (const p of [mixedPath, scannedPath]) {
  if (!fs.existsSync(p)) { console.error('fixture manquante : ' + p); process.exit(2); }
}
const mixedBytes = fs.readFileSync(mixedPath);
const scannedBytes = fs.readFileSync(scannedPath);

const PDF_MIME = 'application/pdf';

// Une ligne d'ancre PDF. La forme EST le contrat servi au modèle :
// « [image: page N, image R — LxH, P % de la page, bande] », la bande optionnelle.
const ANCHOR_RE = /\[image: page (\d+), image (\d+) — (\d+)×(\d+), (\d+) % de la page(?:, ([^\]]+))?\]/g;
const anchorsOf = (text) => {
  const out = [];
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(text)) !== null) {
    out.push({ page: Number(m[1]), rank: Number(m[2]), w: Number(m[3]),
      h: Number(m[4]), pct: Number(m[5]), band: m[6] || '' });
  }
  return out;
};
// Le corps d'une page, ancres retirées : sert aux contrôles de non-régression
// du texte, qui ne doivent PAS voir les lignes ajoutées par ce lot.
//
// LA NOTICE DE PAGE VIDE EST RETIRÉE AUSSI, et c'est indispensable au contrôle
// qui s'en sert : formatPdfRead ajoute « [Aucune page … sans texte extractible
// … ] » APRÈS le corps, donc un corps « vide » ne l'est jamais littéralement.
// Sans ce retrait, l'assertion « la détection de vide porte sur le TEXTE »
// tombait en rouge en mesurant la notice elle-même — l'instrument lisait ce
// qu'il était censé ignorer (payé sur la première exécution).
const NOTICE_RE = /\[(?:Aucune page de cette plage|Page\(s\) sans texte extractible)[\s\S]*?\]/g;
const pageBodyOf = (text, n) => {
  const parts = text.split(/^--- Page (\d+) ---$/m);
  for (let i = 1; i < parts.length; i += 2) {
    if (Number(parts[i]) === n) {
      ANCHOR_RE.lastIndex = 0;
      NOTICE_RE.lastIndex = 0;
      return parts[i + 1].replace(ANCHOR_RE, '').replace(NOTICE_RE, '').trim();
    }
  }
  return null;
};

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

  const mixedRef = await attachAndResolve('test.pdf', PDF_MIME, mixedBytes, 'un PDF illustré');

  // ── 1. LES TROIS PRÉMISSES, mesurées avant toute assertion de rendu ───────
  // On appelle collectPdfPageImages DIRECTEMENT, sur le document réel, dans les
  // conditions de MIAOU (pdf.js chargé par ensurePdfJs, un seul <script>).
  const facts = await page.evaluate(async ([ref]) => {
    const rec = resolveHandleRecord(ref, { convId: currentConvId });
    const lib = await ensurePdfJs();
    const u8 = new Uint8Array(rec.data);

    // (a) Deux ouvertures successives du MÊME document, même ordre de visite.
    const readAll = async (order) => {
      const doc = await lib.getDocument({ data: u8.slice() }).promise;
      const out = {};
      try {
        for (const n of order) {
          const pg = await doc.getPage(n);
          try {
            const imgs = await collectPdfPageImages(pg);
            // Signature géométrique : indépendante des noms d'objet pdf.js.
            out[n] = imgs.map(i => Math.round(i.w) + 'x' + Math.round(i.h));
          } finally { try { pg.cleanup(); } catch (e) {} }
        }
      } finally { try { doc.destroy(); } catch (e) {} }
      return out;
    };
    const fwd = [1, 2, 3, 4, 5, 6, 7, 8];
    const a1 = await readAll(fwd);
    const a2 = await readAll(fwd);
    const rev = await readAll(fwd.slice().reverse());
    const solo = await readAll([3]);

    // (b) Les noms d'objet, pour DÉMONTRER leur instabilité (prémisse 1).
    //
    // LA MESURE DOIT PARCOURIR LES PAGES 1..3, jamais la page 3 SEULE — et
    // c'est un piège que ce script a d'abord payé en rouge. L'instabilité se
    // manifeste sur le préfixe de cache global `g_dN_`, qui n'est posé que sur
    // les objets PROMUS au cache partagé, donc seulement si les pages
    // précédentes ont été visitées. Lire la page 3 isolément rend des
    // `img_p2_*` nus, identiques d'une ouverture à l'autre : l'assertion
    // tombait en FAUX NÉGATIF, sur un chemin où le défaut n'existe pas.
    const namesOf = async () => {
      const doc = await lib.getDocument({ data: u8.slice() }).promise;
      const names = [];
      try {
        const OPS = lib.OPS;
        for (const n of [1, 2, 3]) {
          const pg = await doc.getPage(n);
          const ol = await pg.getOperatorList();
          if (n !== 3) { try { pg.cleanup(); } catch (e) {} continue; }
          for (let i = 0; i < ol.fnArray.length; i++) {
            const fn = ol.fnArray[i];
            if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject ||
                fn === OPS.paintImageMaskXObject) names.push(String(ol.argsArray[i][0]));
          }
        }
      } finally { try { doc.destroy(); } catch (e) {} }
      return names;
    };
    const n1 = await namesOf();
    const n2 = await namesOf();

    // (c) Couverture : la grandeur qui sépare décor et information.
    const doc = await lib.getDocument({ data: u8.slice() }).promise;
    let p1imgs = [], p2imgs = [];
    try {
      const pg1 = await doc.getPage(1);
      p1imgs = (await collectPdfPageImages(pg1)).map(i => Math.round(i.covPct));
      const pg2 = await doc.getPage(2);
      p2imgs = (await collectPdfPageImages(pg2)).map(i => Math.round(i.covPct));
    } finally { try { doc.destroy(); } catch (e) {} }

    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    return {
      stableAcrossOpens: same(a1, a2),
      stableAcrossOrder: fwd.every(n => same(a1[n], rev[n])),
      stableAlone: same(a1[3], solo[3]),
      perPage: fwd.map(n => a1[n].length),
      namesDiffer: !same(n1, n2),
      namesSample: n1.length + ' nom(s), 1re ouverture vs 2e : ' + (same(n1, n2) ? 'identiques' : 'DIFFÉRENTS'),
      p1cov: p1imgs, p2cov: p2imgs,
    };
  }, [mixedRef]);

  check('PRÉMISSE 2 : le rang par page est STABLE entre deux ouvertures',
    facts.stableAcrossOpens, 'images par page : ' + facts.perPage.join(', '));
  check('… stable aussi quand les pages sont visitées en ordre INVERSE',
    facts.stableAcrossOrder);
  check('… et quand une page est visitée SEULE, sans les précédentes',
    facts.stableAlone);
  check('PRÉMISSE 1 : les noms d\'objet pdf.js, eux, sont INSTABLES',
    facts.namesDiffer, facts.namesSample + ' — d\'où l\'adressage par (page, rang)');
  check('PRÉMISSE 3 : la couverture sépare le décor de l\'information',
    Math.max(...facts.p1cov) >= 25 && Math.max(...facts.p2cov) <= 5,
    'p1 max ' + Math.max(...facts.p1cov) + ' %, p2 max ' + Math.max(...facts.p2cov) + ' %');

  // ── 2. Le rendu : l'ancre en fin de page, après le texte ──────────────────
  const read1 = await callTool('docs__read', { ref: mixedRef, selector: '1' });
  check('la page illustrée se lit', !read1.isError && /--- Page 1 ---/.test(read1.text),
    read1.text.split('\n')[0]);

  const a1 = anchorsOf(read1.text);
  check('LES ANCRES SONT PRÉSENTES sur une page illustrée',
    a1.length === 3, a1.length + ' ancre(s) attendues : 3');
  check('… elles portent le numéro de la page lue',
    a1.every(a => a.page === 1));
  check('… le rang repart de 1 et se suit (coordonnée LOCALE à la page)',
    a1.map(a => a.rank).join(',') === '1,2,3', a1.map(a => a.rank).join(','));
  check('… la couverture du schéma est annoncée, et elle est grande',
    a1.some(a => a.pct >= 25), 'max ' + Math.max(...a1.map(a => a.pct)) + ' %');
  check('… aucune ancre n\'annonce 0 % (plancher à 1 %)',
    a1.every(a => a.pct >= 1), 'min ' + Math.min(...a1.map(a => a.pct)) + ' %');
  check('… aucune ancre ne cite un nom d\'objet pdf.js',
    !/img_p\d|g_d\d/.test(read1.text));

  // Les ancres viennent APRÈS le texte : le texte est ce qu'on lit, l'ancre est
  // un index de ce qu'on peut aller voir.
  const firstAnchorAt = read1.text.search(/\[image: page/);
  const body1 = pageBodyOf(read1.text, 1);
  const lastTextAt = body1 ? read1.text.indexOf(body1.slice(-20)) : -1;
  check('LES ANCRES SUIVENT LE TEXTE de la page, jamais l\'inverse',
    firstAnchorAt > 0 && lastTextAt > 0 && firstAnchorAt > lastTextAt);

  // ── 3. Le rang est LOCAL : une plage multi-pages le fait repartir de 1 ────
  const read12 = await callTool('docs__read', { ref: mixedRef, selector: '1-2' });
  const a12 = anchorsOf(read12.text);
  const ranksP1 = a12.filter(a => a.page === 1).map(a => a.rank).join(',');
  const ranksP2 = a12.filter(a => a.page === 2).map(a => a.rank).join(',');
  check('sur une plage, chaque page a ses propres rangs repartant de 1',
    ranksP1 === '1,2,3' && ranksP2 === '1,2,3', 'p1: ' + ranksP1 + ' | p2: ' + ranksP2);
  check('… et chaque ancre cite SA page, jamais celle de la plage',
    a12.filter(a => a.page === 1).length === 3 && a12.filter(a => a.page === 2).length === 3);

  // LA RÉPÉTITION DU BANDEAU EST ATTENDUE, pas un défaut (cf. en-tête).
  //
  // LA PLAGE EST 2-3, PAS 1-2, et ce n'est pas un détail de confort : la page 1
  // est une page de TITRE, qui ne porte pas le bandeau (ses trois images sont
  // 188x94, 407x407 et 194x118). Exiger deux occurrences sur 1-2 accusait le
  // code d'une omission que la fixture ne porte pas — vacuité inversée, payée
  // en rouge sur la première exécution de ce script.
  const read23 = await callTool('docs__read', { ref: mixedRef, selector: '2-3' });
  const banner23 = anchorsOf(read23.text).filter(a => a.w === 196 && a.h === 40);
  check('le bandeau répété est annoncé sur CHAQUE page (non déduplication assumée)',
    banner23.length === 2, banner23.length + ' occurrence(s) sur les pages 2 et 3');

  // ── 4. NON-RÉGRESSION : la page scannée garde son renvoi ──────────────────
  const scannedRef = await attachAndResolve('scanned-mixed.pdf', PDF_MIME, scannedBytes, 'un PDF scanné');
  const readScan = await callTool('docs__read', { ref: scannedRef, selector: '2' });
  const aScan = anchorsOf(readScan.text);
  check('la page scannée porte bien une ancre (image pleine page)',
    aScan.length === 1 && aScan[0].pct >= 90,
    aScan.length ? aScan[0].pct + ' % de la page' : 'aucune ancre');
  check('NON-RÉGRESSION : elle reste signalée « sans texte extractible »',
    /sans texte extractible|Aucune page de cette plage/.test(readScan.text));
  check('… et garde son renvoi vers docs__render_page (seule issue sur un scan)',
    readScan.text.indexOf('miaou__docs__render_page') >= 0);

  // La détection de page vide doit se faire sur le TEXTE SEUL : si l'ancre
  // comptait comme du contenu, la page cesserait d'être signalée vide.
  const bodyScan = pageBodyOf(readScan.text, 2);
  check('… la détection de vide porte sur le TEXTE, pas sur le texte + ancres',
    bodyScan !== null && bodyScan === '', 'corps hors ancres : ' + JSON.stringify(bodyScan));

  // ── 5. NON-RÉGRESSION : le texte extrait est inchangé ─────────────────────
  // Une page SANS image ne doit produire AUCUNE note — et le texte d'une page
  // illustrée doit être exactement celui d'avant le lot.
  const textOnly = await page.evaluate(async ([ref]) => {
    const rec = resolveHandleRecord(ref, { convId: currentConvId });
    const lib = await ensurePdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(rec.data).slice() }).promise;
    try {
      const pg = await doc.getPage(1);
      const tc = await pg.getTextContent();
      return joinPdfTextItems(tc && tc.items).trim();
    } finally { try { doc.destroy(); } catch (e) {} }
  }, [mixedRef]);
  check('NON-RÉGRESSION : le texte de la page est celui de joinPdfTextItems, intact',
    body1 === textOnly, body1 === textOnly ? 'identique' : 'DIVERGENT');

  // ── 6. L'exclusion de la description de bibliothèque, structurelle ────────
  // describePdfForLibrary lit métadonnées et sommaire par son propre chemin :
  // elle n'appelle NI readPdfDocument NI collectPdfPageImages. L'exclusion est
  // donc gratuite — ce contrôle la fige en non-régression.
  const desc = await page.evaluate(async ([ref]) => {
    const rec = resolveHandleRecord(ref, { convId: currentConvId });
    const out = await describePdfForLibrary(new Uint8Array(rec.data), 2000, {});
    return typeof out === 'string' ? out : (out && out.text) || '';
  }, [mixedRef]).catch(() => '');
  check('LA DESCRIPTION DE BIBLIOTHÈQUE N\'HÉRITE PAS des ancres (exclusion structurelle)',
    !/\[image: page/.test(desc), desc ? 'description produite, sans ancre' : 'description vide');

  console.log('');
  console.log(failures.length
    ? '  ÉCHECS : ' + failures.length + '\n    - ' + failures.join('\n    - ')
    : '  OK — toutes les vérifications passent');
  exitCode = failures.length ? 1 : 0;
} catch (e) {
  console.error('ERREUR : ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await browser.close();
}
process.exit(exitCode);
