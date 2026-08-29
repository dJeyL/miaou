#!/usr/bin/env node
// Vérif e2e du lot V-5 étape 2 (MIAOU) : ouverture NATIVE d'un document Word,
// sans aucun serveur MCP. Complément indispensable des tests QuickJS, qui
// couvrent le pur mais JAMAIS le câblage (mémoire
// project_quickjs_tests_dont_cover_orchestration_scope) ni la COMPOSITION de
// deux purs corrects (project_pure_functions_compose_unguarded_contract).
//
// Ce que les tests QuickJS ne peuvent pas voir, et que ce script exerce :
//   - ensureMammoth : lazy-load CDN réel (réseau)
//   - le routage sniffDocumentKind → DOC_READERS.docx dans les handlers
//   - la COMPOSITION convertToHtml → docxHtmlToBlocks → docxSections →
//     resolveDocxSection : quatre purs corrects dont le JOINT n'est gardé nulle
//     part ailleurs, et dont dépend le fait qu'un titre affiché soit visable
//   - le buffer NON détaché par mammoth (contrairement à pdf.js) : deux appels
//     enchaînés sur le même handle
//   - as_resource → _storeBlock → formatInlineHandleForModel → js__eval
//
// Modèle STUBÉ (SSE tool_calls déterministes), document RÉEL attaché par le
// chemin d'attachment normal. Aucun MCP : c'est le sujet.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - docs__list sur un .docx rend les SECTIONS, pas un listing de membres zip
//     (word/document.xml…) — c'est le changement d'orientation de l'étape 2
//   - l'ack dit « Document listé … N sections », jamais « Archive listée »
//   - les 10 tableaux de la fixture sont ANNONCÉS au listing (un document dont
//     la substance est tabulaire ne doit pas passer pour dix paragraphes)
//   - LE test du round-trip : le titre « 3. Gateway & styles d'API » est rendu
//     DÉCODÉ au listing, et le selector qui le recopie RÉSOUT. C'est le joint
//     que rien d'autre ne garde : décoder d'un côté seulement rendrait cette
//     section inatteignable tout en l'affichant.
//   - docs__read d'une section rend son texte AVEC ses tableaux en « a | b | c »
//     (ce que extractRawText aurait perdu, cf. décision 2)
//   - lire un h1 rend aussi ses sous-sections (bornage au niveau ≤)
//   - un selector par PRÉFIXE non ambigu résout ; l'ack annonce le titre
//     CANONIQUE, pas le préfixe tapé
//   - un selector inconnu : refus NOMMANT les sections disponibles
//   - DEUXIÈME lecture du même handle : buffer non détaché
//   - as_resource : res_… inline nommé d'après la section, exploitable en js__eval
//   - un .docx déposé en bibliothèque est décrit par ses sections, pas par son XML
//   - non-régression : Excel, PDF et zip continuent de router vers leurs lecteurs
//   - non-régression d'ack : une lecture Excel dit toujours « Feuille … lue »
//     (le mot vient désormais de la table, pas de la seule forme du selector)
//
// Usage : node verify-docx-native.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN mammoth).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const docxPath = path.join(repoRoot, 'untracked/test-files/test.docx');
const xlsxPath = path.join(repoRoot, 'untracked/test-files/test.xlsx');
const pdfPath = path.join(repoRoot, 'untracked/test-files/test.pdf');
const zipPath = path.join(repoRoot, 'untracked/test-files/test-extract.zip');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-docx-native');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(docxPath)) { console.error('oracle manquant : ' + docxPath); process.exit(2); }
const docxBytes = fs.readFileSync(docxPath);
const xlsxBytes = fs.existsSync(xlsxPath) ? fs.readFileSync(xlsxPath) : null;
const pdfBytes = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : null;
const zipBytes = fs.existsSync(zipPath) ? fs.readFileSync(zipPath) : null;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
    return realFetch(input, opts);   // CDN mammoth réel
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

  const dref = await attachAndResolve('test.docx', DOCX_MIME, docxBytes, 'voici un document');

  // ── 1. docs__list : des SECTIONS, pas des membres zip ──────────────────────
  const listed = await callTool('docs__list', { ref: dref });
  check('docs__list ouvre le document sans erreur', !listed.isError, listed.text.slice(0, 90));
  check('le listing annonce un document Word et ses sections',
    /Document Word — \d+ sections/.test(listed.text), listed.text.split('\n')[0]);
  check('ce n\'est PAS un listing zip : aucun membre XML n\'apparaît',
    !/word\/document\.xml/.test(listed.text) && !/Content_Types/.test(listed.text));
  check('les 10 tableaux de la fixture sont ANNONCÉS',
    /Tableaux : 10 tableaux/.test(listed.text),
    (listed.text.match(/Tableaux[^\n]*/) || ['pas annoncés'])[0]);
  check('le listing rappelle comment écrire le selector',
    /miaou__docs__read/.test(listed.text));
  check('la hiérarchie est visible : le h1 en tête, les h2 indentés',
    /\n- Checklist/.test(listed.text) && /\n  - 0\./.test(listed.text),
    listed.text.split('\n').slice(1, 3).join(' ⏎ '));

  // ── 2. L'ack dit « Document listé … sections » ─────────────────────────────
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
  check('l\'ack dit « Document listé … N sections », pas « Archive listée »',
    /Document listé/.test(ackLabel) && /\d+ sections/.test(ackLabel), ackLabel);

  // ── 3. LE test du round-trip listing → selector ────────────────────────────
  // La fixture porte « 3. Gateway & styles d'API », qui vaut « &amp; » dans le
  // HTML de mammoth. Décoder au listing SANS décoder à la comparaison (ou
  // l'inverse) rendrait cette section affichée mais inatteignable.
  const gatewayTitle = (listed.text.match(/- (3\.[^\n]*)/) || [])[1] || '';
  check('le titre est rendu DÉCODÉ au listing (« & », pas « &amp; »)',
    gatewayTitle.indexOf('&') >= 0 && gatewayTitle.indexOf('&amp;') < 0, gatewayTitle);
  const gw = await callTool('docs__read', { ref: dref, selector: gatewayTitle });
  check('LE ROUND-TRIP : le titre recopié du listing RÉSOUT',
    !gw.isError && /--- Section/.test(gw.text), gw.text.split('\n')[0].slice(0, 80));

  // ── 4. Une section rend son texte AVEC ses tableaux ────────────────────────
  // C'est ce que extractRawText aurait perdu (décision 2) — et les tableaux
  // sont la substance de cette fixture.
  const sec0 = await callTool('docs__read', { ref: dref, selector: '0. Déjà établi — à confirmer' });
  check('docs__read d\'une section rend son texte', !sec0.isError, sec0.text.split('\n')[0].slice(0, 80));
  check('les TABLEAUX sont préservés, en lignes « a | b | c »',
    /\|/.test(sec0.text) && / \| /.test(sec0.text),
    (sec0.text.split('\n').find(l => / \| /.test(l)) || 'AUCUNE LIGNE TABULAIRE').slice(0, 90));
  check('le heading est repris en tête de sa section, en markdown',
    /^## 0\./m.test(sec0.text));

  // ── 5. Bornage : un h2 ne ferme pas un h1 ─────────────────────────────────
  const whole = await callTool('docs__read', { ref: dref, selector: 'Checklist — Cadrage de l’upgrade IBM API Connect' });
  check('lire le h1 rend AUSSI ses sous-sections (bornage au niveau ≤)',
    !whole.isError && /## 0\./.test(whole.text) && /## 8\./.test(whole.text),
    whole.text.length + ' caractères');
  check('la lecture du h1 est plus longue que celle d\'une seule sous-section',
    whole.text.length > sec0.text.length);

  // ── 6. Tolérances de selector ─────────────────────────────────────────────
  const byPrefix = await callTool('docs__read', { ref: dref, selector: '2. Developer' });
  check('un préfixe NON AMBIGU résout (un titre long se recopie tronqué)',
    !byPrefix.isError && /--- Section/.test(byPrefix.text),
    byPrefix.text.split('\n')[0].slice(0, 80));
  check('l\'en-tête annonce le titre CANONIQUE, pas le préfixe tapé',
    !/« 2\. Developer »/.test(byPrefix.text), byPrefix.text.split('\n')[0].slice(0, 80));

  const unknown = await callTool('docs__read', { ref: dref, selector: 'Chapitre inexistant' });
  check('un selector inconnu échoue explicitement', unknown.isError || /introuvable/.test(unknown.text));
  check('l\'échec NOMME les sections disponibles (re-ciblage DANS le tour)',
    /0\. Déjà établi/.test(unknown.text), unknown.text.slice(0, 110));

  // ── 7. Buffer non détaché : deuxième lecture du même handle ────────────────
  const second = await callTool('docs__read', { ref: dref, selector: '0. Déjà établi — à confirmer' });
  check('DEUXIÈME lecture du même handle : mammoth ne détache pas le buffer',
    !second.isError && second.text.length === sec0.text.length,
    second.text.length + ' vs ' + sec0.text.length + ' caractères');

  // ── 8. as_resource → js__eval ─────────────────────────────────────────────
  const asRes = await callTool('docs__read', { ref: dref, selector: '1. Bloquants d’upgrade — à vérifier en premier', as_resource: true });
  const resId = (asRes.text.match(/res_[A-Za-z0-9_-]+/) || [])[0];
  check('as_resource rend un handle res_…', !!resId, asRes.text.slice(0, 100));
  const resAck = await page.evaluate(() => {
    const acks = (typeof getPendingToolAcks === 'function' ? getPendingToolAcks() : [])
      .filter(m => m && m.kind === 'docs_read');
    const last = acks[acks.length - 1];
    if (!last) return { name: '', head: 'aucun ack' };
    return { name: last.resourceName || '', head: docsReadAckHead(last) };
  });
  check('la ressource est nommée d\'après le document ET la section',
    /^test-/.test(resAck.name) && /\.txt$/.test(resAck.name), resAck.name);
  check('l\'ack dit « Section … lue » — PAS « Feuille », le mot vient de la table',
    /^Section /.test(resAck.head), resAck.head);
  if (resId) {
    // `lines` est une FONCTION du prélude, pas une variable : `lines.length`
    // rendrait son arité (0) et le contrôle passerait sans rien prouver.
    // On compte les lignes ET on cherche un motif du document, pour vérifier
    // que le texte a bien traversé _storeBlock → utf8 → guest.
    const evaled = await callTool('js__eval', { handle: resId,
      code: 'lines().filter(function(l){ return l.indexOf("|") >= 0; }).length' });
    check('la ressource est exploitable par js__eval, et porte les lignes tabulaires',
      !evaled.isError && /[1-9]/.test(evaled.text), evaled.text.slice(0, 60));
  }

  // ── 9. Description de bibliothèque ────────────────────────────────────────
  const desc = await page.evaluate(async ([b64, mime]) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const rec = { name: 'biblio.docx', mime: mime, data: u8.buffer };
    return await extractBinaryFileTextForDescription(rec, 1200);
  }, [docxBytes.toString('base64'), DOCX_MIME]);
  check('un .docx de bibliothèque est décrit par ses SECTIONS',
    !!desc && /Document Word —/.test(desc), (desc || 'null').slice(0, 70));
  check('sa description n\'est PAS son listing de membres XML',
    !!desc && !/word\/document\.xml/.test(desc));
  check('la description porte un aperçu du début du document',
    !!desc && /Début de «/.test(desc), (desc || '').split('\n').find(l => /Début de/.test(l)) || 'pas d\'aperçu');

  // ── 10. Non-régression des trois autres formats ───────────────────────────
  if (xlsxBytes) {
    const xref = await attachAndResolve('test.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsxBytes, 'et un classeur');
    const xl = await callTool('docs__list', { ref: xref });
    check('NON-RÉGRESSION Excel : le classeur route toujours vers son lecteur',
      !xl.isError && /Classeur Excel —/.test(xl.text), xl.text.split('\n')[0]);
    const xr = await callTool('docs__read', { ref: xref, selector: 'Synthèse' });
    const xAck = await page.evaluate(() => {
      const acks = (typeof getPendingToolAcks === 'function' ? getPendingToolAcks() : [])
        .filter(m => m && m.kind === 'docs_read');
      const last = acks[acks.length - 1];
      return last ? docsReadAckHead(last) : 'aucun ack';
    });
    check('NON-RÉGRESSION d\'ack : une feuille se dit toujours « Feuille … lue »',
      /^Feuille /.test(xAck), xAck);
    check('NON-RÉGRESSION Excel : la lecture rend bien la feuille', !xr.isError);
  } else {
    console.log('  ..  test.xlsx absent : non-régression Excel non exercée.');
  }

  if (pdfBytes) {
    const pref = await attachAndResolve('test.pdf', 'application/pdf', pdfBytes, 'et un pdf');
    const pl = await callTool('docs__list', { ref: pref });
    check('NON-RÉGRESSION PDF : le PDF route toujours vers son lecteur',
      !pl.isError && /^PDF — /.test(pl.text), pl.text.split('\n')[0]);
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

  await page.screenshot({ path: path.join(outDir, 'docx-native.png'), fullPage: false });
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
