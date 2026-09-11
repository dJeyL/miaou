#!/usr/bin/env node
// Vérif e2e du lot AC-2 (MIAOU) : les ancres d'images Word. Le texte extrait
// d'un .docx porte désormais, à sa place dans le flux du document, le CHEMIN de
// chaque image dans le conteneur zip — de quoi raccrocher une image extraite à
// l'endroit où elle sert.
//
// Complément indispensable des tests QuickJS, et le trou qu'il comble est plus
// large qu'en AC-1 : les pures (fnv1aBytes, mediaMatchKey, docxExtractImages,
// la branche image de docxHtmlToBlocks) sont couvertes par le runner, mais
// NI mammoth NI fflate n'y tournent. Donc docxMediaIndex, convertImage, et
// surtout leur COMPOSITION — le hash des octets émis par mammoth retrouve-t-il
// vraiment la pièce du zip ? — ne sont exercés QUE par ce script. C'est le
// cœur du lot : si l'appariement par hash échoue, les ancres sortent sans
// chemin et aucun test unitaire ne le voit.
//
// CONFIDENTIALITÉ DES FIXTURES : les fichiers d'untracked/test-files/ sont des
// documents à ne pas divulguer. Aucune assertion de ce script ne porte sur leur
// CONTENU — ni libellé d'image, ni titre de section, ni mot du document. Tout
// ce qui est vérifié est une FORME (syntaxe de l'ancre, préfixe word/media/,
// position relative) ou un COMPTE. Les `detail` passés à check() sont filtrés
// de la même façon : jamais une ligne d'ancre brute ni un label de section,
// seulement des nombres et des motifs. Ne pas relâcher cette règle en ajoutant
// un contrôle : un `detail` est aussi divulgant qu'une assertion.
//
// Aucune capture d'écran : les assertions prouvent tout ce qu'il y a à prouver,
// et une image de fixture confidentielle n'a rien à faire dans shots-*/.
//
// MESURES (2026-09-11, relevées sur les fixtures via mammoth 1.11.0 réellement
// exécuté, et sur l'annuaire zip) :
//
//   formulaire-tt.docx — 893 ko
//     CORPS (word/document.xml) : 4 w:drawing, TOUS wp:anchor (flottants),
//       0 wp:inline, 0 w:pict ; 4/4 portent un descr informatif
//     EN-TÊTES ET PIEDS : 8 w:drawing et 6 w:pict de PLUS (header1/2/3,
//       footer2/3) — mammoth n'extrait QUE le corps, donc ils ne traversent
//       jamais convertToHtml. Mesuré en traçant le callback sans filtre :
//       4 images vues, zéro message mammoth. Attention au contresens que
//       cette fixture invite : « 4 images » veut dire « 4 dans ce que MIAOU
//       lit », pas « 4 dans le document ».
//     word/media/ : 12 pièces — 7 png, 4 svg, 1 emf de 836 ko
//       dont SEULEMENT 4 correspondent à une image émise par mammoth ;
//       les 4 svg sont les jumeaux vectoriels, et les 4 autres pièces sont
//       référencées par header1/2/3.xml.rels et footer3.xml.rels.
//     les 4 <img> sont SEULES dans leur <p> (<p><strong><img/></strong></p>)
//     HTML intermédiaire : 51 487 caractères par défaut → 4 727 avec le
//       convertImage du lot (facteur 11 : mammoth encode sinon chaque image
//       en base64 dans un HTML qui est ensuite jeté)
//
//   test.docx, spike.docx, spike-fr.docx : ZÉRO image → non-régression.
//
// CE QUE CE SCRIPT NE COUVRE PAS, et pourquoi :
//   - LE CAP (DOCX_MAX_IMAGE_ANCHORS) n'est exerçable par AUCUNE fixture : la
//     seule illustrée porte 4 images. Un contrôle qui lirait un document réel
//     en espérant voir le cap mordre passerait par VACUITÉ — il compterait 4
//     ancres, moins que le cap, et serait vert sans rien prouver. Il est donc
//     vérifié ici sur une ENTRÉE CONSTRUITE passée à docxHtmlToBlocks en page
//     (le pur, mais appelé dans le bundle réel). Ne pas « rétablir » un
//     contrôle sur fixture sans un document qui porte plus de 24 images.
//   - w:pict (VML legacy) et wp:inline DANS LE CORPS. Piège à ne pas
//     retomber dedans : la fixture porte bel et bien 6 w:pict, mais TOUS dans
//     ses en-têtes et pieds de page, que mammoth n'extrait pas. Ils ne
//     couvrent donc RIEN — les compter comme une couverture du VML serait le
//     contresens exact que cette note existe pour empêcher. Le corps n'a que
//     des wp:anchor. Ne pas ajouter d'assertion sur ces 6 w:pict : elle
//     porterait sur du contenu inatteignable et passerait par vacuité.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - LE HASH RETROUVE LA PIÈCE : les 4 ancres portent un chemin word/media/,
//     pas une ancre nue — c'est la preuve que l'appariement par octets marche
//   - les chemins servis sont DISTINCTS (4 images, 4 pièces différentes)
//   - les ancres sont LIBELLÉES (les 4 descr de la fixture sont informatifs)
//   - AUCUN .svg ni .emf annoncé : mammoth ne rend que le raster, et le hash ne
//     matche que lui — la preuve que l'annuaire n'a pas apparié un jumeau
//   - L'ANCRE EST À SA PLACE : elle vit DANS la section qui la porte, pas
//     rassemblée en fin de document
//   - NON-RÉGRESSION : un docx sans image ne porte aucune ancre, et son
//     découpage en sections est inchangé (convertImage change la sortie de
//     mammoth pour TOUS les documents, y compris ceux sans image)
//   - le cap et sa notice, sur entrée construite (cf. supra)
//
// Usage : node verify-docx-image-anchors.mjs [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN mammoth + fflate).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const picsPath = path.join(repoRoot, 'untracked/test-files/formulaire-tt.docx');
const cleanPath = path.join(repoRoot, 'untracked/test-files/test.docx');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(picsPath)) { console.error('fixture manquante : ' + picsPath); process.exit(2); }
if (!fs.existsSync(cleanPath)) { console.error('fixture manquante : ' + cleanPath); process.exit(2); }
const picsBytes = fs.readFileSync(picsPath);
const cleanBytes = fs.readFileSync(cleanPath);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Mesuré sur la fixture. Le compte d'IMAGES ÉMISES par mammoth (4), à ne pas
// confondre avec le compte de pièces de word/media/ (12) : c'est précisément la
// confusion que le lot écarte.
const EXPECTED_IMAGES = 4;

// Compte les ancres d'une sortie de lecture, sans jamais exposer leur contenu.
const anchorsOf = (text) => (text.match(/\[image: [^\]]+\]/g) || []);
// Une ancre SANS chemin (pièce non retrouvée) a une autre forme : c'est le
// témoin d'un appariement raté, qu'on veut distinguer d'une absence d'image.
const pathlessOf = (text) => (text.match(/\[image (?:: « [^»]* »|sans référence retrouvée)\]/g) || []);
const omittedOf = (text) => {
  const m = text.match(/\[(\d+) autres? images? dans ce document, non listées?\.\]/);
  return m ? Number(m[1]) : null;
};

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
    return realFetch(input, opts);
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
  await page.waitForSelector('.boot-done', { timeout: 15000 }).catch(() => {});

  const callTool = async (name, args) => page.evaluate(async ([n, a]) => {
    const r = await callInternalTool(n, a, { convId: (typeof currentConvId !== 'undefined' ? currentConvId : null) });
    const txt = (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    return { text: txt, isError: !!(r && r.isError) };
  }, [name, args]);

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

  // ── 0. Le cap est lu depuis la constante VIVANTE ──────────────────────────
  const cap = await page.evaluate(() => (typeof DOCX_MAX_IMAGE_ANCHORS !== 'undefined'
    ? DOCX_MAX_IMAGE_ANCHORS : null));
  check('le cap par document existe et est lisible depuis le code',
    typeof cap === 'number' && cap > 0, 'DOCX_MAX_IMAGE_ANCHORS=' + cap);

  const pref = await attachAndResolve('formulaire-tt.docx', DOCX_MIME, picsBytes,
    'un document Word avec des images');

  // ── 1. LE CŒUR DU LOT : le hash retrouve la pièce ─────────────────────────
  // Si l'appariement par octets échoue, les ancres sortent SANS chemin. Les
  // deux formes sont distinguées exprès : « 0 ancre avec chemin » et « 4 ancres
  // sans chemin » sont deux échecs différents, et un compte global les
  // confondrait.
  const listed = await callTool('docs__list', { ref: pref });
  check('le document s\'ouvre et se découpe en sections',
    !listed.isError && /Document Word/.test(listed.text),
    listed.isError ? 'ERREUR' : 'listing rendu');

  // Le corps entier, section par section : les ancres sont dispersées dans le
  // document, donc on lit tout pour les compter.
  const sectionLabels = await page.evaluate(async ([ref]) => {
    const r = await callInternalTool('docs__list', { ref }, { convId: currentConvId });
    const txt = (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    // On ne rend QUE le nombre de lignes de section, jamais les libellés :
    // ce sont des titres du document confidentiel.
    return txt.split('\n').filter(l => /^\s*-\s/.test(l)).length;
  }, [pref]);
  check('le listing énumère des sections', sectionLabels > 0, sectionLabels + ' section(s)');

  // Lecture de TOUTES les sections, concaténée, pour ramasser chaque ancre.
  const whole = await page.evaluate(async ([ref]) => {
    const list = await callInternalTool('docs__list', { ref }, { convId: currentConvId });
    const lt = (list && list.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    const labels = lt.split('\n')
      .map(l => (/^\s*-\s(.+?)(?:\s{2,}|$)/.exec(l) || [])[1])
      .filter(Boolean);
    let out = '';
    for (const label of labels) {
      const r = await callInternalTool('docs__read', { ref, selector: label }, { convId: currentConvId });
      out += (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n') + '\n';
    }
    return out;
  }, [pref]);

  const anchors = anchorsOf(whole);
  const pathless = pathlessOf(whole);
  check('LE HASH RETROUVE LA PIÈCE : chaque image est ancrée AVEC son chemin',
    anchors.length === EXPECTED_IMAGES,
    anchors.length + ' ancre(s) avec chemin, attendu ' + EXPECTED_IMAGES);
  check('aucune ancre ne retombe sur le repli « sans chemin »',
    pathless.length === 0, pathless.length + ' ancre(s) sans chemin');

  // ── 2. La forme du chemin, et l'absence de jumeau ─────────────────────────
  const wellFormed = anchors.filter(a => /^\[image: word\/media\/[^\s\]]+( — « [^»]* »)?\]$/.test(a)).length;
  check('l\'ancre porte le CHEMIN de la pièce dans le conteneur',
    wellFormed === anchors.length && anchors.length > 0,
    wellFormed + ' conforme(s) sur ' + anchors.length);

  const paths = anchors.map(a => (/\[image: ([^\s—\]]+)/.exec(a) || [])[1]).filter(Boolean);
  check('les pièces servies sont DISTINCTES : 4 images, 4 pièces',
    new Set(paths).size === EXPECTED_IMAGES,
    new Set(paths).size + ' chemin(s) distinct(s)');

  // word/media/ porte 4 SVG et 1 EMF que mammoth n'émet JAMAIS. En voir un
  // sortir signifierait que l'annuaire a apparié autre chose que le raster.
  const vector = paths.filter(p => /\.(svg|emf)$/i.test(p)).length;
  check('AUCUN jumeau SVG ni EMF annoncé : seul le raster émis est apparié',
    vector === 0, vector + ' chemin(s) vectoriel(s)');

  // ── 3. Les libellés (les 4 descr de la fixture sont informatifs) ──────────
  // On compte les ancres LIBELLÉES sans jamais imprimer un libellé.
  const labelled = anchors.filter(a => / — « /.test(a)).length;
  check('les ancres portent leur libellé quand le document en fournit un',
    labelled === EXPECTED_IMAGES, labelled + ' ancre(s) libellée(s) sur ' + anchors.length);
  check('aucun libellé auto-généré ne fuite',
    !/générée automatiquement/i.test(whole));

  // ── 4. L'ANCRE EST À SA PLACE, pas rassemblée en fin de document ──────────
  // Le gain revendiqué de l'étape est la POSITION. La mesurer par SECTION est
  // impossible sur cette fixture : elle ne porte AUCUN heading (36 blocs, 0
  // heading), donc une seule section « (corps) » par construction — une
  // assertion « réparties sur plusieurs sections » y serait fausse par
  // construction, pas par défaut du code. On mesure donc à l'échelle du BLOC,
  // qui est le grain où la position se décide.
  //
  // Deux propriétés, distinctes exprès : les ancres ne sont ni toutes en tête
  // ni toutes en queue (elles sont ENTRELACÉES avec le texte), et elles sont
  // séparées les unes des autres par du texte. Un rassemblement en fin de
  // document — le défaut que l'étape corrige — échouerait aux deux.
  const layout = await page.evaluate(async ([ref]) => {
    const list = await callInternalTool('docs__list', { ref }, { convId: currentConvId });
    const lt = (list && list.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    const label = (lt.split('\n').map(l => (/^\s*-\s(.+?)(?:\s{2,}|$)/.exec(l) || [])[1]).filter(Boolean))[0];
    const r = await callInternalTool('docs__read', { ref, selector: label }, { convId: currentConvId });
    const t = (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    // Position de chaque ancre dans la suite des lignes non vides : on ne rend
    // que des INDICES et des comptes, jamais une ligne du document.
    const lines = t.split('\n').filter(l => l.trim());
    const at = [];
    lines.forEach((l, i) => { if (/^\[image: word\/media\//.test(l.trim())) at.push(i); });
    return { at: at, total: lines.length };
  }, [pref]);
  const spread = layout.at.length > 1
    && layout.at[0] > 0                                   // pas toutes en tête
    && layout.at[layout.at.length - 1] < layout.total - 1  // pas toutes en queue
    && layout.at.some((v, i) => i > 0 && v - layout.at[i - 1] > 1);  // séparées par du texte
  check('LA POSITION : les ancres sont ENTRELACÉES avec le texte, pas groupées',
    spread, layout.at.length + ' ancre(s) réparties sur ' + layout.total + ' lignes');

  // ── 5. NON-RÉGRESSION : un docx sans image ────────────────────────────────
  // convertImage change la sortie de mammoth pour TOUS les documents, pas
  // seulement les illustrés : c'est le chemin partagé qu'il faut prouver intact.
  const cref = await attachAndResolve('test.docx', DOCX_MIME, cleanBytes, 'un document Word sans image');
  const cleanList = await callTool('docs__list', { ref: cref });
  const cleanSections = cleanList.text.split('\n').filter(l => /^\s*-\s/.test(l)).length;
  check('NON-RÉGRESSION : un document sans image se découpe toujours en sections',
    !cleanList.isError && cleanSections > 0, cleanSections + ' section(s)');
  check('… et son listing ne porte AUCUNE ancre',
    anchorsOf(cleanList.text).length === 0 && pathlessOf(cleanList.text).length === 0,
    anchorsOf(cleanList.text).length + ' ancre(s)');

  const cleanWhole = await page.evaluate(async ([ref]) => {
    const list = await callInternalTool('docs__list', { ref }, { convId: currentConvId });
    const lt = (list && list.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    const labels = lt.split('\n')
      .map(l => (/^\s*-\s(.+?)(?:\s{2,}|$)/.exec(l) || [])[1])
      .filter(Boolean);
    let out = '';
    for (const label of labels) {
      const r = await callInternalTool('docs__read', { ref, selector: label }, { convId: currentConvId });
      out += (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n') + '\n';
    }
    return out;
  }, [cref]);
  check('… et son TEXTE ne porte aucune ancre ni notice d\'omission',
    anchorsOf(cleanWhole).length === 0 && pathlessOf(cleanWhole).length === 0
      && omittedOf(cleanWhole) === null,
    anchorsOf(cleanWhole).length + ' ancre(s)');
  check('… et son texte reste non vide (sinon les comptes ci-dessus sont vacants)',
    cleanWhole.trim().length > 200, cleanWhole.trim().length + ' caractères');

  // ── 6. LE CAP, sur entrée CONSTRUITE ──────────────────────────────────────
  // Aucune fixture ne porte plus de 24 images : un contrôle sur document réel
  // passerait par vacuité. On appelle donc le pur DANS LE BUNDLE RÉEL avec un
  // HTML construit — ce n'est pas la fixture, et c'est délibéré.
  const capped = await page.evaluate((n) => {
    let html = '';
    for (let i = 0; i < n; i++) html += '<p><img alt="" src="word/media/image' + i + '.png" /></p>';
    const blocks = docxHtmlToBlocks(html);
    const imgs = blocks.filter(b => b && b.type === 'image');
    return { total: imgs.length, last: imgs.length ? imgs[imgs.length - 1].text : '' };
  }, cap + 6);
  check('LE CAP mord au-delà de la borne (entrée construite, aucune fixture ne l\'exerce)',
    capped.total === cap + 1, capped.total + ' bloc(s) image pour ' + (cap + 6) + ' images');
  check('la troncature est ANNONCÉE avec son compte, jamais muette',
    omittedOf(capped.last) === 6, 'annoncé ' + omittedOf(capped.last) + ', attendu 6');

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
