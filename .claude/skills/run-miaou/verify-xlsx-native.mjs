#!/usr/bin/env node
// Vérif e2e du lot V-5 étape 1 (MIAOU) : ouverture NATIVE d'un classeur Excel,
// sans aucun serveur MCP. Complément indispensable des tests QuickJS, qui
// couvrent le pur mais JAMAIS le câblage (mémoire
// project_quickjs_tests_dont_cover_orchestration_scope) ni la COMPOSITION de
// deux purs corrects (project_pure_functions_compose_unguarded_contract).
//
// Ce que les tests QuickJS ne peuvent pas voir, et que ce script exerce :
//   - ensureSheetJs : lazy-load CDN réel (réseau)
//   - le routage sniffDocumentKind → DOC_READERS.xlsx dans les handlers
//   - la COMPOSITION parseSheetSelector → restrictSheetRange → clone à !ref →
//     sheet_to_csv : c'est le joint entre purs corrects que rien d'autre ne garde
//   - LE piège du format : sheet_to_csv IGNORE son option `range`. Le clone à
//     !ref est ce qui le contourne, et seul un appel réel le prouve.
//   - le buffer NON détaché par SheetJS (contrairement à pdf.js) : deux appels
//     enchaînés sur le même handle
//   - as_resource → _storeBlock → formatInlineHandleForModel → js__eval
//
// Modèle STUBÉ (SSE tool_calls déterministes), classeur RÉEL attaché par le
// chemin d'attachment normal. Aucun MCP : c'est le sujet.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - docs__list sur un .xlsx rend les FEUILLES et leurs dimensions, pas un
//     listing de membres zip (xl/workbook.xml…)
//   - l'ack dit « Classeur listé … 2 feuilles », jamais « Archive listée »
//   - docs__read('Synthèse') rend la feuille, en-tête compris
//   - docs__read('Synthèse!B2:C5') rend UNIQUEMENT la plage — LE test du clone
//     à !ref : si l'option `range` était utilisée, toute la feuille sortirait
//   - docs__read('Synthèse!A1:Z999') est RAMENÉ à B2:E31 avec notice, et ne
//     déroule pas 999 lignes de vide
//   - docs__read('Synthèse!ZZ1:ZZ9') (hors feuille) : échec explicite, pas un vide
//   - docs__read('Feuil1') : refus NOMMANT les feuilles disponibles
//   - DEUXIÈME lecture du même handle : buffer non détaché
//   - une feuille lue sans plage est bornée à 200 lignes, et le DIT
//   - as_resource : res_… inline nommé d'après la feuille, exploitable en js__eval
//   - un .xlsx déposé en bibliothèque est décrit par ses feuilles, pas par son XML
//   - non-régression : PDF et zip continuent de router vers leurs lecteurs
//   - PDF SCANNÉ (fixture réelle, 2026-08-28) : constaté OCÉRISÉ (couche texte
//     bruitée mais présente) — la garde des pages vides ne se déclenche donc PAS,
//     et c'est correct. Le cas « aucune couche texte » reste sans fixture (V-8).
//   - le même scan DANS un zip : extract → res_… → docs__read route aux OCTETS,
//     la source du handle (attachment vs ressource) ne change rien
//   - SCAN SANS COUCHE TEXTE (scanned2.pdf, fabriqué) : la garde des pages vides
//     de V-4, jamais exercée sur du réel jusqu'ici, se déclenche enfin
//   - DOCUMENT MIXTE (scanned-mixed.pdf) : la notice ÉNUMÈRE les pages vides —
//     le cas le plus dangereux, un document dont une partie se lit inspire
//     confiance et le modèle peut ne pas remarquer ce qui manque
//
// Usage : node verify-xlsx-native.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN SheetJS).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const xlsxPath = path.join(repoRoot, 'untracked/test-files/test.xlsx');
const pdfPath = path.join(repoRoot, 'untracked/test-files/test.pdf');
const scanPath = path.join(repoRoot, 'untracked/test-files/scanned.pdf');
const scanZipPath = path.join(repoRoot, 'untracked/test-files/scanned.zip');
const scan2Path = path.join(repoRoot, 'untracked/test-files/scanned2.pdf');
const mixedPath = path.join(repoRoot, 'untracked/test-files/scanned-mixed.pdf');
const zipPath = path.join(repoRoot, 'untracked/test-files/test-extract.zip');
const bigZipPath = path.join(repoRoot, 'untracked/test-files/tests.zip');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-xlsx-native');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(xlsxPath)) { console.error('oracle manquant : ' + xlsxPath); process.exit(2); }
const xlsxBytes = fs.readFileSync(xlsxPath);
const pdfBytes = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : null;
const scanBytes = fs.existsSync(scanPath) ? fs.readFileSync(scanPath) : null;
const scanZipBytes = fs.existsSync(scanZipPath) ? fs.readFileSync(scanZipPath) : null;
const scan2Bytes = fs.existsSync(scan2Path) ? fs.readFileSync(scan2Path) : null;
const mixedBytes = fs.existsSync(mixedPath) ? fs.readFileSync(mixedPath) : null;
const zipBytes = fs.existsSync(zipPath) ? fs.readFileSync(zipPath) : null;
const bigZipBytes = fs.existsSync(bigZipPath) ? fs.readFileSync(bigZipPath) : null;

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
    return realFetch(input, opts);   // CDN SheetJS réel
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

  // Appel d'outil direct : on exerce le HANDLER, pas l'UI de conversation.
  const callTool = async (name, args) => page.evaluate(async ([n, a]) => {
    const r = await callInternalTool(n, a, { convId: (typeof currentConvId !== 'undefined' ? currentConvId : null) });
    const txt = (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    return { text: txt, isError: !!(r && r.isError) };
  }, [name, args]);

  // L'indice att-N n'est PAS déductible du nombre d'envois (l'input est
  // `multiple`, les chips s'accumulent) : on résout par le NOM du record.
  const attachAndResolve = async (name, mime, buffer, prompt) => {
    await page.setInputFiles('#attach-file-input', { name, mimeType: mime, buffer });
    await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
    await page.fill('#composer-text', prompt);
    await page.evaluate(() => { window.__scriptedToolCalls = []; onSendBtn(); });
    return page.waitForFunction((wanted) => {
      for (let i = 1; i <= 8; i++) {
        try {
          const r = resolveHandleRecord('att-' + i, { convId: currentConvId });
          if (r && r.name === wanted) return 'att-' + i;
        } catch (e) { /* handle non encore résoluble */ }
      }
      return null;
    }, name, { timeout: 25000 }).then(h => h.jsonValue());
  };

  const xref = await attachAndResolve('test.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsxBytes, 'voici un classeur');

  // ── 1. docs__list : des FEUILLES, pas des membres zip ──────────────────────
  const listed = await callTool('docs__list', { ref: xref });
  check('docs__list ouvre le classeur sans erreur', !listed.isError, listed.text.slice(0, 80));
  check('le listing annonce un classeur et ses 2 feuilles',
    /Classeur Excel — 2 feuilles/.test(listed.text), listed.text.split('\n')[0]);
  check('les feuilles sont nommées (Synthèse, Tri 75 correctifs)',
    /Synthèse/.test(listed.text) && /Tri 75 correctifs/.test(listed.text));
  check('chaque feuille porte sa DIMENSION (sans elle le modèle demande A1:Z100 au jugé)',
    /B2:E31/.test(listed.text) && /lignes/.test(listed.text) && /colonnes/.test(listed.text),
    (listed.text.match(/- «[^\n]*/) || [''])[0].slice(0, 70));
  check('le listing rappelle la forme du selector',
    /NomDeFeuille!A1:C10/.test(listed.text));
  check('ce n\'est PAS un listing zip : aucun membre XML n\'apparaît',
    !/xl\/workbook\.xml/.test(listed.text) && !/Content_Types/.test(listed.text));

  // ── 2. L'ack dit « Classeur listé … feuilles » ─────────────────────────────
  const ackLabel = await page.evaluate(() => {
    // Un appel direct à callInternalTool n'exerce PAS la boucle d'outils
    // d'api.js : l'ack reste dans _pendingToolAcks (jamais currentThread).
    const acks = (typeof getPendingToolAcks === 'function' ? getPendingToolAcks() : [])
      .filter(m => m && m.kind === 'docs_list');
    const last = acks[acks.length - 1];
    if (!last) return 'aucun ack docs_list';
    return (typeof docsListAckHead === 'function')
      ? docsListAckHead(last) + ' — ' + docsListAckCount(last) : 'helpers absents';
  });
  check('l\'ack dit « Classeur listé … 2 feuilles », pas « Archive listée »',
    /Classeur listé/.test(ackLabel) && /2 feuilles/.test(ackLabel), ackLabel);

  // ── 3. Lecture d'une feuille entière ───────────────────────────────────────
  const whole = await callTool('docs__read', { ref: xref, selector: 'Synthèse' });
  check('docs__read(\'Synthèse\') rend la feuille', !whole.isError && /Feuille « Synthèse »/.test(whole.text),
    whole.text.split('\n')[0]);
  check('la plage servie est annoncée dans l\'en-tête', /\(B2:E31\)/.test(whole.text));

  // ── 4. LE test du clone à !ref : sheet_to_csv IGNORE son option `range` ────
  // Si le code utilisait l'option native, TOUTE la feuille sortirait ici, en
  // ayant l'air d'avoir servi la plage — « plausible et faux ».
  const ranged = await callTool('docs__read', { ref: xref, selector: 'Synthèse!B2:C5' });
  check('docs__read avec plage rend la plage', !ranged.isError && /\(B2:C5\)/.test(ranged.text));
  const rangedRows = ranged.text.split('\n').filter(l => l && !/^---/.test(l) && !/^\[/.test(l)).length;
  // Borne HAUTE : un refus de lecture (texte court, monoligne, non-isError) la
  // satisfait par le bas. On exige donc aussi le plancher d'une vraie plage.
  check('LA PREUVE du clone à !ref : 4 lignes servies, pas les 30 de la feuille',
    rangedRows >= 3 && rangedRows <= 5, rangedRows + ' lignes rendues');
  check('la plage restreinte est bien un SOUS-ensemble de la feuille entière',
    ranged.text.length < whole.text.length,
    ranged.text.length + ' vs ' + whole.text.length + ' caractères');

  // ── 5. Le second piège : un !ref élargi DÉROULE du vide ───────────────────
  const over = await callTool('docs__read', { ref: xref, selector: 'Synthèse!A1:Z999' });
  // !isError ne discrimine pas : le refus de lecture par pages est lui aussi
  // un result non-isError délibéré. On exige la forme d'une lecture.
  check('une plage débordante est servie, pas refusée',
    !over.isError && /^--- /.test(over.text), over.text.split('\n')[0].slice(0, 70));
  check('elle est RAMENÉE au !ref réel (sans ça : 999 lignes dont ~970 vides)',
    /\(B2:E31\)/.test(over.text), (over.text.match(/--- [^\n]*/) || [''])[0]);
  check('le clamp est SIGNALÉ par une notice',
    /Plage ramenée à B2:E31/.test(over.text),
    (over.text.match(/\[Plage[^\]]*\]/) || ['pas de notice'])[0].slice(0, 90));
  const overRows = over.text.split('\n').length;
  check('la sortie ne déroule pas des centaines de lignes vides',
    overRows >= 5 && overRows < 60, overRows + ' lignes');

  // ── 6. Plage entièrement hors feuille : échec explicite, pas un vide ───────
  const outside = await callTool('docs__read', { ref: xref, selector: 'Synthèse!ZZ1:ZZ9' });
  check('une plage hors feuille ÉCHOUE au lieu de rendre un blanc',
    outside.isError || /hors de la/.test(outside.text), outside.text.slice(0, 90));
  check('et l\'échec dit où est la feuille (le modèle peut se re-cibler)',
    /B2:E31/.test(outside.text));

  // ── 7. Feuille inconnue : le refus NOMME les feuilles disponibles ─────────
  const nosheet = await callTool('docs__read', { ref: xref, selector: 'Feuil1' });
  check('une feuille inconnue est refusée', nosheet.isError || /introuvable/.test(nosheet.text));
  check('le refus NOMME les feuilles disponibles (sinon le modèle rejoue faux)',
    /Synthèse/.test(nosheet.text) && /Tri 75 correctifs/.test(nosheet.text),
    nosheet.text.slice(0, 110));

  // ── 8. Buffer non détaché : deuxième lecture du même handle ───────────────
  // pdf.js TRANSFÈRE son buffer (d'où u8.slice) ; SheetJS non — mesuré au spike.
  // Ce contrôle garde la mesure : si SheetJS changeait, il tomberait ici.
  const second = await callTool('docs__read', { ref: xref, selector: 'Tri 75 correctifs!A1:C5' });
  check('DEUXIÈME lecture du même handle : le buffer n\'a pas été détaché',
    !second.isError && /Tri 75 correctifs/.test(second.text),
    second.isError ? second.text.slice(0, 90) : 'ok');
  const relist = await callTool('docs__list', { ref: xref });
  check('re-listing après deux lectures : toujours opérationnel',
    !relist.isError && /2 feuilles/.test(relist.text));

  // ── 9. Le cap de lignes sans plage explicite ──────────────────────────────
  const bigSheet = await callTool('docs__read', { ref: xref, selector: 'Tri 75 correctifs' });
  check('une feuille lue sans plage passe',
    !bigSheet.isError && /^--- /.test(bigSheet.text),
    bigSheet.text.split('\n')[0].slice(0, 70));
  const bigRows = bigSheet.text.split('\n').filter(l => l && !/^---/.test(l) && !/^\[/.test(l)).length;
  check('le cap de 200 lignes borne la lecture sans plage',
    bigRows > 10 && bigRows <= 201, bigRows + ' lignes');
  // 76 lignes ici : le cap ne mord pas sur cette fixture, et c'est correct.
  check('la feuille de 76 lignes passe entière (le cap ne mord qu\'au-delà)',
    bigRows > 10, bigRows + ' lignes');

  // ── 10. as_resource → res_… → js__eval ────────────────────────────────────
  const asRes = await callTool('docs__read', { ref: xref, selector: 'Tri 75 correctifs', as_resource: true });
  check('as_resource rend un handle res_…', /res_/.test(asRes.text), asRes.text.slice(0, 80));
  const resId = (asRes.text.match(/res_[A-Za-z0-9_-]+/) || [null])[0];
  const rec = resId ? await page.evaluate((id) => {
    const r = (typeof _resourceCache !== 'undefined') ? _resourceCache[id] : null;
    return r ? { class: r.class, mime: r.mime, size: r.size, name: r.name } : null;
  }, resId) : null;
  check('la ressource est de classe inline et textuelle',
    !!rec && rec.class === 'inline' && /text/.test(rec.mime || ''),
    rec ? rec.class + ' / ' + rec.mime : 'introuvable');
  check('le nom porte la FEUILLE, pas un « -p2-5 » de PDF',
    !!rec && /Tri/.test(rec.name || '') && /\.txt$/.test(rec.name || ''), rec && rec.name);
  if (resId) {
    const ev = await callTool('js__eval', { handle: resId, code: 'lines().length' });
    check('js__eval exploite la ressource',
      !ev.isError && /\d/.test(ev.text), ev.text.slice(0, 60).replace(/\n/g, ' '));
  }

  // ── 11. L'ack de lecture dit « Feuille … lue », pas « Page » ──────────────
  const readAck = await page.evaluate(() => {
    const acks = (typeof getPendingToolAcks === 'function' ? getPendingToolAcks() : [])
      .filter(m => m && m.kind === 'docs_read');
    const last = acks[acks.length - 1];
    return last && typeof docsReadAckHead === 'function' ? docsReadAckHead(last) : 'aucun ack docs_read';
  });
  check('l\'ack de lecture dit « Feuille … lue », jamais « Page … lue »',
    /^Feuille /.test(readAck), readAck);

  // ── 12. Description de bibliothèque : par les feuilles, pas par le XML ────
  const libDesc = await page.evaluate(async () => {
    try {
      const r = resolveHandleRecord('att-1', { convId: currentConvId });
      if (!r) return 'record introuvable';
      return await extractBinaryFileTextForDescription(r, 2000);
    } catch (e) { return 'ERREUR ' + (e && e.message); }
  });
  check('un classeur est décrit par ses FEUILLES, pas par ses membres XML',
    typeof libDesc === 'string' && /Classeur Excel/.test(libDesc) && !/xl\/workbook/.test(libDesc),
    (libDesc || '').split('\n')[0]);
  check('la description porte un aperçu du contenu',
    typeof libDesc === 'string' && /Aperçu de/.test(libDesc));

  // ── 13. Non-régression : le PDF route toujours vers son lecteur ───────────
  if (pdfBytes) {
    const pref = await attachAndResolve('test.pdf', 'application/pdf', pdfBytes, 'et un PDF');
    const plist = await callTool('docs__list', { ref: pref });
    check('non-régression V-4 : un PDF est toujours listé comme document',
      !plist.isError && /PDF — 8 pages/.test(plist.text), plist.text.split('\n')[0]);
    const pread = await callTool('docs__read', { ref: pref, selector: '3' });
    check('non-régression V-4 : docs__read(\'3\') rend toujours la page 3',
      !pread.isError && /--- Page 3 ---/.test(pread.text));
  } else {
    console.log('  ..  test.pdf absent : non-régression PDF non vérifiée.');
  }

  // ── 14. PDF SCANNÉ : la garde des pages vides, enfin exercée sur du réel ──
  // Ajoutée le 2026-08-28, quand Julien a fourni la fixture. Jusque-là cette
  // garde n'avait JAMAIS tourné sur un vrai scan (le brief V-8 le signale comme
  // un préalable manquant) : elle était écrite, testée en pur sur des pages
  // fabriquées, et jamais confrontée à un document sans couche texte.
  // Ce que ça vérifie : le silence n'est pas pris pour une réponse — le mode de
  // défaillance que le lot refuse depuis le zip chiffré de V-1.
  if (scanBytes) {
    const sref = await attachAndResolve('scanned.pdf', 'application/pdf', scanBytes, 'un scan');
    const slist = await callTool('docs__list', { ref: sref });
    check('un PDF scanné se LISTE normalement (la structure existe, c\'est le texte qui manque)',
      !slist.isError && /PDF — \d+ page/.test(slist.text), slist.text.split('\n')[0]);

    // CE QUE LA FIXTURE EST RÉELLEMENT (constaté le 2026-08-28, pas supposé) :
    // scanned.pdf est un scan DÉJÀ OCÉRISÉ — 376 items, 1928 caractères de
    // couche texte, bruitée (« CrNTRE HOSPIT AUER UNl'l RSITAIR[ ») mais bien
    // présente. Ce n'est donc PAS le cas « page sans texte » : la garde des
    // pages vides n'a pas à se déclencher ici, et c'est correct qu'elle ne le
    // fasse pas. Les premières assertions écrites pour ce bloc supposaient un
    // scan brut ; elles décrivaient un document que cette fixture n'est pas.
    //
    // Ce qui reste vérifiable — et qui compte pour V-8 : un scan océrisé produit
    // du texte EXPLOITABLE MAIS BRUITÉ, que MIAOU sert sans le maquiller. Le cas
    // « aucune couche texte » demande une autre fixture (préalable V-8).
    const sread = await callTool('docs__read', { ref: sref, selector: '1' });
    check('lire une page scannée ne plante pas', !sread.isError, sread.text.slice(0, 70).replace(/\n/g, ' '));
    const sbody = sread.text.replace(/--- Page 1 ---/, '').replace(/\[[^\]]*\]/g, '').trim();
    check('ce scan est OCÉRISÉ : sa couche texte est lue (≠ page vide)',
      sbody.length > 500, sbody.length + ' caractères extraits');
    check('la notice de page vide ne se déclenche PAS sur une page qui a du texte',
      !/extractible/.test(sread.text),
      /extractible/.test(sread.text) ? 'notice à tort' : 'pas de notice, correct');
    // Le texte océrisé est bruité et MIAOU ne le corrige pas : c'est la matière
    // réelle que le modèle recevra, et la connaître vaut mieux que la supposer.
    check('le texte servi est brut, jamais maquillé', /[A-Za-z]/.test(sbody), sbody.slice(0, 60));
  } else {
    console.log('  ..  scanned.pdf absent : garde des pages scannées non vérifiée.');
  }

  // ── 15. Le même scan DANS un zip : la chaîne extract → res_… → docs__read ──
  // Cas jamais exercé : un document ouvert depuis une RESSOURCE et non depuis un
  // attachment. Le routage se fait aux octets, donc il ne devrait rien changer —
  // « ne devrait pas » n'est pas « ne change pas », et c'est un chemin réel
  // (l'archive de documents est exactement l'usage visé par le lot).
  if (scanZipBytes) {
    const zref = await attachAndResolve('scanned.zip', 'application/zip', scanZipBytes, 'un scan zippé');
    const zlist = await callTool('docs__list', { ref: zref });
    check('non-régression V-1 : le zip est listé comme archive',
      !zlist.isError && /Archive zip/.test(zlist.text), zlist.text.split('\n')[0]);

    const member = (zlist.text.match(/([^\s]+\.pdf)/i) || [null, null])[1];
    check('le membre PDF est visible dans le listing', !!member, member || 'aucun .pdf listé');

    if (member) {
      const ext = await callTool('docs__extract', { ref: zref, path: member });
      check('docs__extract matérialise le membre en ressource',
        /res_/.test(ext.text), ext.text.slice(0, 70));
      const mid = (ext.text.match(/res_[A-Za-z0-9_-]+/) || [null])[0];
      if (mid) {
        // LE point du contrôle : un PDF extrait d'un zip est un handle res_…,
        // et sniffDocumentKind doit le reconnaître aux octets comme n'importe
        // quel attachment — la source du handle ne doit rien changer au routage.
        const mlist = await callTool('docs__list', { ref: mid });
        check('un PDF extrait d\'un zip se liste comme un PDF (le routage est aux OCTETS)',
          !mlist.isError && /PDF — \d+ page/.test(mlist.text), mlist.text.split('\n')[0]);
        const mread = await callTool('docs__read', { ref: mid, selector: '1' });
        // Le VRAI point : la sortie doit être identique à celle obtenue par
        // attachment. Le routage est aux octets, la source du handle ne doit
        // rien changer — et c'est ce qu'on compare, pas une notice.
        check('la lecture par ressource rend le MÊME texte que par attachment',
          !mread.isError && mread.text.length > 500, mread.text.length + ' caractères');
      }
    }
  } else {
    console.log('  ..  scanned.zip absent : chaîne extract → docs__read non vérifiée.');
  }

  // ── 16. SCAN SANS COUCHE TEXTE : la garde de V-4, exercée pour de vrai ────
  // Fixture fabriquée le 2026-08-28 (scanned.pdf rendu en image à 150 dpi par
  // Ghostscript, réencapsulé par ImageMagick) parce que scanned.pdf s'est révélé
  // DÉJÀ océrisé. Vérifié par pdf.js avant usage : 0 item texte, 0 caractère.
  //
  // C'est le préalable que le brief V-8 signalait comme manquant : jusqu'ici la
  // notice de page scannée n'avait JAMAIS tourné sur un document réel. Sans
  // elle, le modèle reçoit du vide et conclut que le document ne dit rien — le
  // « silence pris pour une réponse » que ce lot refuse depuis V-1.
  if (scan2Bytes) {
    const s2ref = await attachAndResolve('scanned2.pdf', 'application/pdf', scan2Bytes, 'un scan brut');
    const s2list = await callTool('docs__list', { ref: s2ref });
    check('un scan sans texte se LISTE normalement (la structure existe)',
      !s2list.isError && /PDF — 1 page/.test(s2list.text), s2list.text.split('\n')[0]);

    const s2read = await callTool('docs__read', { ref: s2ref, selector: '1' });
    check('lire une page sans couche texte ne plante pas', !s2read.isError);
    check('LA GARDE V-4, ENFIN EXERCÉE : la page vide est SIGNALÉE, jamais rendue comme un blanc',
      /Aucune page de cette plage ne porte de texte extractible/.test(s2read.text),
      (s2read.text.match(/\[[^\]]*\]/) || ['PAS DE NOTICE'])[0].slice(0, 130));
    check('la notice pose l\'hypothèse du scan et dit que MIAOU ne fait pas d\'OCR',
      /SCANN/i.test(s2read.text) && /OCR/.test(s2read.text));
    check('et elle demande au modèle de le DIRE plutôt que de conclure au vide',
      /Dis-le/.test(s2read.text));
  } else {
    console.log('  ..  scanned2.pdf absent : garde des pages vides non exercée.');
  }

  // ── 17. DOCUMENT MIXTE : la branche « quelles pages » de formatPdfRead ────
  // Page 1 avec texte, page 2 sans. Exerce l'autre branche de la notice — celle
  // qui ÉNUMÈRE les pages vides au lieu de dire « aucune page de cette plage ».
  // Le cas mixte est le plus dangereux des deux : un document dont une partie
  // se lit inspire confiance, et le modèle peut ne pas remarquer ce qui manque.
  if (mixedBytes) {
    const mxref = await attachAndResolve('scanned-mixed.pdf', 'application/pdf', mixedBytes, 'un mixte');
    const mx = await callTool('docs__read', { ref: mxref, selector: '1-2' });
    check('le document mixte se lit', !mx.isError && /--- Page 1 ---/.test(mx.text) && /--- Page 2 ---/.test(mx.text));
    check('la page 1 porte bien son texte', mx.text.split('--- Page 2 ---')[0].length > 500);
    check('la notice ÉNUMÈRE la page vide (pas « aucune page », qui serait faux ici)',
      /Page\(s\) sans texte extractible : 2/.test(mx.text),
      (mx.text.match(/\[Page\(s\)[^\]]*/) || ['PAS DE NOTICE'])[0].slice(0, 90));
    check('lire la seule page pleine ne déclenche AUCUNE notice',
      !/extractible/.test((await callTool('docs__read', { ref: mxref, selector: '1' })).text));
  } else {
    console.log('  ..  scanned-mixed.pdf absent : branche « pages vides énumérées » non exercée.');
  }

  await page.screenshot({ path: path.join(outDir, 'xlsx-native.png'), fullPage: false });
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
