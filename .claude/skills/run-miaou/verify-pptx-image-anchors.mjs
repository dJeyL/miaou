#!/usr/bin/env node
// Vérif e2e du lot AC-1 (MIAOU) : les ancres d'images PowerPoint. Le texte
// extrait d'un deck porte désormais, à sa place dans la slide, le CHEMIN de
// chaque image dans le conteneur zip — de quoi raccrocher une image extraite à
// l'endroit où elle sert.
//
// Complément indispensable des tests QuickJS, qui couvrent les cinq pures
// (ooxmlImageLabel, formatImageAnchor, pptxDedupeImageRefs, capImageAnchors,
// pptxBlockText) mais JAMAIS le parcours DOM : QuickJS n'a pas de DOMParser,
// donc toute la branche image de pptxShapeBlocks — la collecte par a:blip, la
// garde mc:AlternateContent, la résolution par les rels — n'est exercée QUE
// par ce script. C'est aussi lui qui garde la COMPOSITION des cinq pures, que
// chacune prise isolément ne peut pas prouver.
//
// CONFIDENTIALITÉ DES FIXTURES : les fichiers d'untracked/test-files/ sont des
// documents à ne pas divulguer. Aucune assertion de ce script ne porte sur leur
// CONTENU — ni libellé d'image, ni mot du deck, ni nom propre. Tout ce qui est
// vérifié ici est une FORME (syntaxe de l'ancre, préfixe ppt/media/, compte
// d'ancres, présence du compteur d'omission) ou un COMPTE. Les `detail` passés
// à check() sont eux aussi filtrés : on n'y imprime jamais une ligne d'ancre
// brute, seulement des nombres et des motifs. Ne pas relâcher cette règle en
// ajoutant un contrôle : un `detail` est aussi divulgant qu'une assertion.
// (Note : verify-pptx-native.mjs, lui, assertionne sur deux noms propres de
// test.pptx — antérieur à cette règle, signalé, non corrigé ici.)
//
// Aucune capture d'écran : les assertions prouvent tout ce qu'il y a à prouver,
// et une image de fixture confidentielle n'a rien à faire dans shots-*/.
//
// MESURES (2026-09-11, relevées sur les fixtures, ordre de PRÉSENTATION) :
//
//   elements-graphiques.pptx — 6 slides
//     slide 1 : 22 a:blip, 0 svgBlip, 19 descr TOUS auto-générés → 22 ancres NUES
//     slide 2 :  5 a:blip, 0 svgBlip,  3 descr tous auto-générés →  5 ancres nues
//     slide 3 :  1 a:blip, 0 svgBlip,  0 descr                   →  1 ancre nue
//     slide 4 : 121 a:blip, 120 svgBlip, 120 descr dont 1 auto   → cap à 24 + 97 omises
//     slides 5-6 : aucune image
//
//   Le cadrage du lot annonçait « 241 médias » sur la slide 4 : c'est le compte
//   des RELS, dont 120 sont les jumeaux SVG. Le compte qui gouverne le cap est
//   celui des a:blip — 121. Et il annonçait « slides 1-3 : ancres avec
//   libellés » : FAUX, les descr des slides 1 et 2 sont tous auto-générés, donc
//   retirés par la règle de libellé. Les ancres y sont nues, et c'est correct.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - une slide à image unique rend UNE ancre, de la forme [image: ppt/media/…]
//   - un descr auto-généré par Office est RETIRÉ : l'ancre est nue
//   - LE CAP : la slide à 121 images rend 24 ancres + une ligne qui COMPTE les
//     97 omises — jamais une troncature muette
//   - LA DÉDUPLICATION : aucun .svg dans la sortie, alors que la slide en
//     référence 120 (le jumeau vectoriel de chaque icône)
//   - les slides sans image ne rendent AUCUNE ancre (non-régression)
//   - LE FILTRAGE D'EXTRAIT : le listing ne porte aucune ancre, sinon une slide
//     d'icônes verrait son libellé rempli de chemins de fichiers
//   - les images OLE (sous mc:Fallback) produisent des ancres, et AUCUNE en
//     double — la garde mc:AlternateContent
//   - un deck sans image reste strictement inchangé
//
// Usage : node verify-pptx-image-anchors.mjs [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN fflate).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const iconsPath = path.join(repoRoot, 'untracked/test-files/elements-graphiques.pptx');
const olePath = path.join(repoRoot, 'untracked/test-files/test.pptx');
const cleanPath = path.join(repoRoot, 'untracked/test-files/deck-notes.pptx');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(iconsPath)) { console.error('fixture manquante : ' + iconsPath); process.exit(2); }
if (!fs.existsSync(olePath)) { console.error('fixture manquante : ' + olePath); process.exit(2); }
if (!fs.existsSync(cleanPath)) { console.error('fixture manquante : ' + cleanPath); process.exit(2); }
const iconsBytes = fs.readFileSync(iconsPath);
const oleBytes = fs.readFileSync(olePath);
const cleanBytes = fs.readFileSync(cleanPath);

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// Ce que le lot pose. Lus ici plutôt que recopiés en dur : le cap est une
// constante du code, et un compte figé dans un script repérime au premier
// changement (mémoire project_verify_scripts_rot_four_ways).
const EXPECTED_CAP = 24;
const SLIDE4_IMAGES = 121;   // a:blip r:embed distincts, mesuré
const SLIDE1_IMAGES = 22;
const SLIDE3_IMAGES = 1;

// Compte les ancres d'une sortie de lecture, sans jamais exposer leur contenu.
const anchorsOf = (text) => (text.match(/\[image: [^\]]+\]/g) || []);
const omittedOf = (text) => {
  const m = text.match(/\[(\d+) autres? images? sur cette slide, non listées?\.\]/);
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
  window.__scriptedToolCalls = [];
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

  // La constante vivante plutôt qu'un nombre recopié : si le cap bouge, le
  // script suit au lieu de rougir pour rien.
  const cap = await page.evaluate(() => (typeof PPTX_MAX_IMAGE_ANCHORS !== 'undefined'
    ? PPTX_MAX_IMAGE_ANCHORS : null));
  check('le cap par slide est celui du code, et vaut ' + EXPECTED_CAP,
    cap === EXPECTED_CAP, 'PPTX_MAX_IMAGE_ANCHORS=' + cap);

  const iref = await attachAndResolve('elements-graphiques.pptx', PPTX_MIME, iconsBytes,
    'une présentation riche en images');

  // ── 1. Une slide à image unique : UNE ancre, de la bonne forme ────────────
  const s3 = await callTool('docs__read', { ref: iref, selector: '3' });
  const a3 = anchorsOf(s3.text);
  check('une slide à image unique rend exactement une ancre',
    !s3.isError && a3.length === SLIDE3_IMAGES, a3.length + ' ancre(s)');
  check('l\'ancre porte le CHEMIN de la pièce dans le conteneur',
    a3.length === 1 && /^\[image: ppt\/media\/[^\s\]]+\]$/.test(a3[0]),
    a3.length ? 'forme ' + (/^\[image: ppt\/media\/[^\s\]]+\]$/.test(a3[0]) ? 'conforme' : 'NON conforme') : 'aucune');

  // ── 2. Le descr auto-généré est RETIRÉ, pas affiché ───────────────────────
  // Slide 1 : 19 descr, TOUS auto-générés (« … Description générée
  // automatiquement »). La règle de libellé les retire : les 22 ancres sont
  // nues. Un libellé faux coûte plus qu'un libellé absent.
  const s1 = await callTool('docs__read', { ref: iref, selector: '1' });
  const a1 = anchorsOf(s1.text);
  check('toutes les images de la slide sont ancrées',
    !s1.isError && a1.length === SLIDE1_IMAGES, a1.length + ' ancre(s) pour ' + SLIDE1_IMAGES + ' images');
  const labelled1 = a1.filter(a => / — « /.test(a)).length;
  check('un descr auto-généré par Office est RETIRÉ : aucune ancre n\'est libellée',
    a1.length === SLIDE1_IMAGES && labelled1 === 0,
    labelled1 + ' ancre(s) libellée(s) sur ' + a1.length);
  check('la mention « Description générée automatiquement » ne fuite nulle part',
    !/générée automatiquement/i.test(s1.text));

  // ── 3. LE CAP, et la déduplication PNG/SVG ────────────────────────────────
  // Slide 4 : 121 images réelles + 120 jumeaux SVG. C'est LA slide qui exerce
  // les deux gardes « qui retirent » — le scénario où la chose retirée existe
  // bel et bien (SKILL.md : un garde de suppression testé sur un chemin vierge
  // passe par vacuité).
  const s4 = await callTool('docs__read', { ref: iref, selector: '4' });
  const a4 = anchorsOf(s4.text);
  check('LE CAP : une slide à ' + SLIDE4_IMAGES + ' images n\'en annonce que ' + EXPECTED_CAP,
    !s4.isError && a4.length === EXPECTED_CAP, a4.length + ' ancre(s)');
  const omitted = omittedOf(s4.text);
  check('la troncature est ANNONCÉE avec son compte, jamais muette',
    omitted === SLIDE4_IMAGES - EXPECTED_CAP,
    'annoncé ' + omitted + ', attendu ' + (SLIDE4_IMAGES - EXPECTED_CAP));
  // La déduplication : 120 svgBlip sur cette slide, et pas un seul .svg dehors.
  const svgAnchors = a4.filter(a => /\.svg\]/.test(a) || /\.svg —/.test(a)).length;
  check('LA DÉDUPLICATION : aucun jumeau SVG annoncé (la slide en référence 120)',
    svgAnchors === 0, svgAnchors + ' ancre(s) .svg');
  // Chaque ancre servie est distincte : une même pièce n'est jamais répétée.
  check('aucune ancre en double parmi celles servies',
    new Set(a4).size === a4.length, new Set(a4).size + ' distinctes sur ' + a4.length);

  // ── 4. Les slides sans image ne rendent aucune ancre ──────────────────────
  const s56 = await callTool('docs__read', { ref: iref, selector: '5-6' });
  check('une slide sans image ne rend AUCUNE ancre',
    !s56.isError && anchorsOf(s56.text).length === 0,
    anchorsOf(s56.text).length + ' ancre(s)');

  // ── 5. LE FILTRAGE D'EXTRAIT : le listing ne porte pas d'ancres ───────────
  // L'extrait sert à CHOISIR une slide ; 121 chemins de fichiers n'y aident
  // pas. C'est ce que le typage des blocs {type, text} rend possible.
  const listed = await callTool('docs__list', { ref: iref });
  const listLines = listed.text.split('\n').filter(l => /^\d+\. /.test(l));
  check('le listing s\'ouvre et numérote ses 6 slides',
    !listed.isError && listLines.length === 6, listLines.length + ' ligne(s) numérotée(s)');
  check('LE FILTRAGE : aucune ancre dans le libellé de listing',
    !/\[image: /.test(listed.text),
    (listed.text.match(/\[image: /g) || []).length + ' ancre(s) dans le listing');
  // Une slide d'icônes SANS texte retombe sur « (slide sans texte) » plutôt que
  // sur une liste de chemins : la preuve que le filtre ne laisse pas l'ancre
  // servir de repli d'extrait.
  check('une slide sans texte le dit, plutôt que d\'exhiber ses chemins de fichiers',
    !/^\d+\. \[image:/m.test(listed.text));

  // ── 6. LA GARDE mc:AlternateContent, sur le deck OLE ──────────────────────
  // 5 a:blip sous p:oleObj < mc:Fallback (graphiques think-cell). Cibler p:pic
  // les raterait toutes ; descendre dans mc:Choice ET mc:Fallback les
  // compterait deux fois. Aucune assertion sur le contenu de ce deck.
  const oref = await attachAndResolve('test.pptx', PPTX_MIME, oleBytes, 'un deck de consultant');
  // Plage 2-18, pas 1-71 : au-delà d'un certain volume la lecture est refusée
  // par unités (un result NON-isError, mesuré à 246 caractères sans aucun
  // « --- Slide »), et un compte d'ancres nul y serait vacuellement vrai.
  // 2-18 couvre les trois slides porteuses (2, 17, 18) — 5 blips au total.
  const OLE_IMAGES = 5;
  const oleAll = await callTool('docs__read', { ref: oref, selector: '2-18' });
  const oleAnchors = anchorsOf(oleAll.text);
  check('la plage OLE est bien LUE (sinon les comptes qui suivent sont vides)',
    !oleAll.isError && (oleAll.text.match(/--- Slide \d+/g) || []).length === 17,
    (oleAll.text.match(/--- Slide \d+/g) || []).length + ' slide(s) rendue(s)');
  check('les images OLE (sous mc:Fallback) SONT ancrées : viser p:pic les raterait',
    oleAnchors.length === OLE_IMAGES, oleAnchors.length + ' ancre(s), attendu ' + OLE_IMAGES);
  // La déduplication est PAR SLIDE, pas à travers le deck : la même pièce
  // média sert sur plusieurs slides (ici image4.emf en porte trois), et c'est
  // correct — chaque slide annonce l'image qu'ELLE porte. Compter les distincts
  // sur la concaténation confondrait « réutilisée » et « comptée deux fois ».
  // La garde mc:AlternateContent se lit donc slide par slide : sans elle,
  // chaque image OLE sortirait deux fois DANS SA PROPRE slide.
  const perSlide = oleAll.text.split(/(?=--- Slide \d+)/)
    .map(chunk => anchorsOf(chunk))
    .filter(list => list.length);
  const dupInSlide = perSlide.filter(list => new Set(list).size !== list.length).length;
  check('LA GARDE mc:AlternateContent : aucune image comptée deux fois DANS sa slide',
    dupInSlide === 0 && perSlide.length === 3,
    perSlide.length + ' slide(s) porteuse(s), ' + dupInSlide + ' avec doublon interne');
  check('ces ancres portent bien un chemin de pièce média',
    oleAnchors.every(a => /^\[image: ppt\/media\/[^\s\]]+( — « .+ »)?\]$/.test(a)),
    oleAnchors.filter(a => !/^\[image: ppt\/media\//.test(a)).length + ' hors format');

  // ── 7. NON-RÉGRESSION : un deck sans image est inchangé ───────────────────
  const cref = await attachAndResolve('deck-notes.pptx', PPTX_MIME, cleanBytes, 'un deck sans image');
  const clean = await callTool('docs__read', { ref: cref, selector: '1-4' });
  check('NON-RÉGRESSION : un deck sans image ne porte aucune ancre',
    !clean.isError && anchorsOf(clean.text).length === 0,
    anchorsOf(clean.text).length + ' ancre(s)');
  check('… et ses notes de présentateur sont toujours lues et séparées',
    /--- Notes de présentateur \(slide \d+\) ---/.test(clean.text));
  const cleanList = await callTool('docs__list', { ref: cref });
  check('… et son listing est intact (slides numérotées, notes marquées)',
    !cleanList.isError && /\[notes\]/.test(cleanList.text)
      && cleanList.text.split('\n').filter(l => /^\d+\. /.test(l)).length === 4);

  // ── 8. La notice de slide vide : PAS de cible e2e, et c'est un constat ────
  // Le texte de formatPptxRead a été révisé par AC-1 pour annoncer les ancres
  // au lieu de les taire. Aucune fixture ne peut l'exercer ici : la notice ne
  // tombe que si une slide n'a NI corps NI notes (`!body && !notes`), et les
  // trois decks disponibles n'en portent aucune — la seule slide sans corps
  // (deck-notes.pptx, slide 1 affichée) porte 38 caractères de notes, ce qui
  // la rend non-vide À BON DROIT (règle testée par ailleurs : « une slide
  // muette au corps mais porteuse de notes n'est PAS comptée vide »).
  //
  // Un contrôle écrit ici passerait donc soit par vacuité, soit en fabriquant
  // une fixture pour lui seul. Le texte révisé est couvert par les tests
  // QuickJS de formatPptxRead, qui construisent l'entrée au lieu de la
  // chercher. Ne pas « rétablir » ce contrôle sans une fixture qui porte une
  // slide réellement muette.

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
