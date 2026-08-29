#!/usr/bin/env node
// Vérif e2e du lot V-4 (MIAOU) : ouverture NATIVE d'un PDF, sans aucun serveur
// MCP. C'est le complément indispensable des tests QuickJS, qui couvrent le pur
// mais JAMAIS le câblage (mémoire project_quickjs_tests_dont_cover_orchestration_scope)
// ni la COMPOSITION de deux purs corrects (project_pure_functions_compose_unguarded_contract).
//
// Ce que les tests QuickJS ne peuvent pas voir, et que ce script exerce :
//   - ensurePdfJs : lazy-load CDN + fetch du worker + blob: (réseau réel)
//   - le routage sniffDocumentKind → DOC_READERS dans les handlers
//   - le passage de docs__list en ASYNC (callInternalTool mappe le thenable)
//   - u8.slice() : pdf.js TRANSFÈRE le buffer — sans copie, le 2e appel sur le
//     même handle verrait un ArrayBuffer détaché. C'est LE bug que seul un
//     enchaînement de deux appels révèle.
//   - as_resource → _storeBlock → formatInlineHandleForModel → js__eval
//
// Modèle STUBÉ (SSE tool_calls déterministes, var de page pilotée en 2 temps),
// PDF RÉEL attaché par le chemin d'attachment normal. Aucun MCP : c'est le sujet.
//
// Checklist (mémoire feedback_no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - docs__list sur un PDF rend pages + sommaire + métadonnées (pas un listing zip)
//   - l'ack docs_list dit « Document listé … N pages », JAMAIS « Archive listée »
//   - docs__read('3') rend le texte de la page 3 avec son en-tête
//   - DEUXIÈME appel sur le MÊME handle : le buffer n'a pas été détaché (u8.slice)
//   - docs__read('5-100') sur 8 pages : clampé À 5-8 AVEC notice (FMT4)
//   - docs__read('page 3') : refusé EN RAPPELANT la forme attendue
//   - docs__read(as_resource) : res_… inline, exploitable par js__eval
//   - un zip reste listé comme archive (non-régression V-1)
//   - docs__read sur un zip : refus qui RENVOIE vers list+extract, pas un refus nu
//
// Usage : node verify-pdf-native.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait. Réseau requis (CDN pdf.js).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const pdfPath = path.join(repoRoot, 'untracked/test-files/test.pdf');
const zipPath = path.join(repoRoot, 'untracked/test-files/test-extract.zip');
const bigZipPath = path.join(repoRoot, 'untracked/test-files/tests.zip');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-pdf-native');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(pdfPath)) { console.error('oracle manquant : ' + pdfPath); process.exit(2); }
const pdfBytes = fs.readFileSync(pdfPath);
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
    return realFetch(input, opts);   // CDN pdf.js réel
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
  // callInternalTool est le point d'entrée réel (il mappe les thenables — c'est
  // précisément ce que le passage en async de docs__list met à l'épreuve).
  const callTool = async (name, args) => page.evaluate(async ([n, a]) => {
    const r = await callInternalTool(n, a, { convId: (typeof currentConvId !== 'undefined' ? currentConvId : null) });
    const txt = (r && r.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    return { text: txt, isError: !!(r && r.isError) };
  }, [name, args]);

  // ── Attacher le PDF réel (att-1, binaire, chemin d'attachment normal) ──────
  await page.setInputFiles('#attach-file-input', {
    name: 'test.pdf', mimeType: 'application/pdf', buffer: pdfBytes,
  });
  await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
  // L'attachment ne devient un handle résoluble qu'une fois le message envoyé.
  await page.fill('#composer-text', 'voici un PDF');
  await page.evaluate(() => { window.__scriptedToolCalls = []; onSendBtn(); });
  await page.waitForFunction(() => typeof currentThread !== 'undefined'
    && currentThread.some(m => m && m.role === 'assistant' && !m.streaming), null, { timeout: 20000 });

  // ── 1. docs__list sur un PDF ───────────────────────────────────────────────
  const listed = await callTool('docs__list', { ref: 'att-1' });
  check('docs__list ouvre le PDF sans erreur', !listed.isError, listed.text.slice(0, 80));
  check('le listing annonce un PDF et ses 8 pages',
    /PDF — 8 pages/.test(listed.text), listed.text.split('\n')[0]);
  check('le sommaire est rendu (getOutline, 8 entrées au spike)',
    /Sommaire :/.test(listed.text) && /- /.test(listed.text));
  check('les métadonnées enrichissent le listing (gain net sur le serveur)',
    /Produit par :/.test(listed.text) || /«/.test(listed.text),
    (listed.text.match(/Produit par : .*/) || [''])[0].slice(0, 60));
  check('ce n\'est PAS un listing zip (pas de « Archive zip »)',
    !/Archive zip/.test(listed.text));

  // ── 2. L'ack dit « Document listé », jamais « Archive listée » ─────────────
  const ackLabel = await page.evaluate(() => {
    // Un appel direct à callInternalTool n'exerce PAS la boucle d'outils
    // d'api.js : l'ack reste dans _pendingToolAcks et ne rejoint jamais
    // currentThread. C'est donc là qu'on le lit.
    const acks = (typeof getPendingToolAcks === 'function' ? getPendingToolAcks() : [])
      .filter(m => m && m.kind === 'docs_list');
    const last = acks[acks.length - 1];
    if (!last) return 'aucun ack docs_list';
    return (typeof docsListAckHead === 'function')
      ? docsListAckHead(last) + ' — ' + docsListAckCount(last) : 'helpers absents';
  });
  check('l\'ack dit « Document listé … pages », pas « Archive listée »',
    /Document listé/.test(ackLabel) && /pages/.test(ackLabel), ackLabel);

  // ── 3. docs__read simple ───────────────────────────────────────────────────
  const p3 = await callTool('docs__read', { ref: 'att-1', selector: '3' });
  check('docs__read(\'3\') rend la page 3', !p3.isError && /--- Page 3 ---/.test(p3.text),
    p3.text.slice(0, 60).replace(/\n/g, ' '));
  check('le texte de la page n\'est pas vide (hasEOL a fait son travail)',
    p3.text.replace(/--- Page 3 ---/, '').trim().length > 20);
  check('le texte porte des sauts de ligne (pas de phrases collées)',
    p3.text.split('\n').length > 3, p3.text.split('\n').length + ' lignes');

  // ── 4. LE test du buffer détaché : deuxième appel sur le même handle ───────
  // pdf.js TRANSFÈRE le buffer qu'on lui passe. Sans u8.slice(), ce second
  // appel échouerait sur un ArrayBuffer détaché — invisible en test unitaire.
  const p4 = await callTool('docs__read', { ref: 'att-1', selector: '4' });
  check('DEUXIÈME lecture du même handle : le buffer n\'a pas été détaché',
    !p4.isError && /--- Page 4 ---/.test(p4.text),
    p4.isError ? p4.text.slice(0, 90) : 'ok');
  const relist = await callTool('docs__list', { ref: 'att-1' });
  check('re-listing après deux lectures : toujours opérationnel',
    !relist.isError && /PDF — 8 pages/.test(relist.text));

  // ── 5. Clamp FMT4 : '5-100' sur 8 pages ────────────────────────────────────
  const clamped = await callTool('docs__read', { ref: 'att-1', selector: '5-100' });
  check('une plage débordante est servie, pas refusée', !clamped.isError);
  check('le clamp est SIGNALÉ (FMT4 : le silence faisait croire à la fin du doc)',
    /Plage ramenée à 5-8/.test(clamped.text),
    (clamped.text.match(/\[Plage[^\]]*\]/) || ['pas de notice'])[0]);

  // ── 6. Selector invalide : le refus doit ENSEIGNER la forme ────────────────
  const bad = await callTool('docs__read', { ref: 'att-1', selector: 'page 3' });
  check('\'page 3\' est refusé', bad.isError || /invalide/i.test(bad.text));
  check('le refus RAPPELLE la forme attendue (sinon le modèle rejoue faux)',
    /'N' ou 'N-M'/.test(bad.text), bad.text.slice(0, 100));

  // ── 7. as_resource → res_… inline → js__eval ──────────────────────────────
  const asRes = await callTool('docs__read', { ref: 'att-1', selector: '1-8', as_resource: true });
  check('as_resource rend un handle res_…', /res_/.test(asRes.text), asRes.text.slice(0, 80));
  const resId = (asRes.text.match(/res_[A-Za-z0-9_-]+/) || [null])[0];
  const rec = resId ? await page.evaluate((id) => {
    const r = (typeof _resourceCache !== 'undefined') ? _resourceCache[id] : null;
    return r ? { class: r.class, mime: r.mime, size: r.size, name: r.name } : null;
  }, resId) : null;
  check('la ressource est de classe inline et textuelle',
    !!rec && rec.class === 'inline' && /text/.test(rec.mime || ''),
    rec ? rec.class + ' / ' + rec.mime : 'introuvable');
  check('le nom porte la plage lue (pdfReadResourceName)',
    !!rec && /-p1-8\.txt$/.test(rec.name || ''), rec && rec.name);

  if (resId) {
    const ev = await callTool('js__eval', { handle: resId, code: 'text().split("--- Page").length - 1' });
    check('js__eval exploite la ressource : 8 en-têtes de page retrouvés',
      !ev.isError && /\b8\b/.test(ev.text), ev.text.slice(0, 60).replace(/\n/g, ' '));
  }

  // ── 8. Non-régression V-1 + refus orienté sur un zip ───────────────────────
  if (zipBytes) {
    await page.setInputFiles('#attach-file-input', {
      name: 'test-extract.zip', mimeType: 'application/zip', buffer: zipBytes,
    });
    await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
    await page.fill('#composer-text', 'et une archive');
    await page.evaluate(() => { window.__scriptedToolCalls = []; onSendBtn(); });
    await page.waitForFunction(() => (typeof currentThread !== 'undefined'
      ? currentThread.filter(m => m && m.role === 'user').length : 0) >= 2, null, { timeout: 20000 });

    const zlist = await callTool('docs__list', { ref: 'att-2' });
    check('non-régression V-1 : un zip est toujours listé comme archive',
      !zlist.isError && /Archive zip/.test(zlist.text), zlist.text.split('\n')[0]);

    const zread = await callTool('docs__read', { ref: 'att-2', selector: '1' });
    // Wording : « par unités » depuis V-5 étape 2 (12982ba), qui a généralisé
    // docs__read au-delà des pages PDF. Le test disait encore « par pages » et
    // échouait sur un progrès, pas sur une régression.
    check('docs__read sur un zip est refusé', zread.isError || /ne se lit pas par unités/.test(zread.text));
    check('et le refus ORIENTE vers list+extract (pas un refus nu)',
      /docs__list/.test(zread.text) && /docs__extract/.test(zread.text),
      zread.text.slice(0, 110));
  } else {
    console.log('  ..  test-extract.zip absent : non-régression zip non vérifiée.');
  }

  // ── 9. Grosse archive réelle (tests.zip, 849 ko) : le sniff ne s'y perd pas ─
  // Cas resté non instruit jusqu'ici. Ce qui est vérifié n'est pas la
  // performance mais que le ROUTAGE tient sur un volume réel : un zip de 849 ko
  // doit rester un zip (le sniff lit le central directory entier), et le
  // listing doit décrire sans refuser (il ne refuse jamais rien — c'est
  // docs__extract qui refuse).
  if (bigZipBytes) {
    await page.setInputFiles('#attach-file-input', {
      name: 'tests.zip', mimeType: 'application/zip', buffer: bigZipBytes,
    });
    await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
    await page.fill('#composer-text', 'une grosse archive');
    await page.evaluate(() => { window.__scriptedToolCalls = []; onSendBtn(); });
    // L'indice att-N n'est pas déductible du nombre d'envois (l'input est
    // `multiple`, les chips s'accumulent). On attend que le handle soit
    // RÉSOLUBLE et on le retrouve par le nom du record.
    const bigRef = await page.waitForFunction(() => {
      for (let i = 1; i <= 8; i++) {
        try {
          const r = resolveHandleRecord('att-' + i, { convId: currentConvId });
          if (r && r.name === 'tests.zip') return 'att-' + i;
        } catch (e) { /* handle non encore résoluble */ }
      }
      return null;
    }, null, { timeout: 25000 }).then(h => h.jsonValue());

    const big = await callTool('docs__list', { ref: bigRef });
    check('grosse archive (849 ko) : sniffée comme zip, listée sans erreur',
      !big.isError && /Archive zip/.test(big.text), big.text.split('\n')[0]);
    const memberCount = (big.text.match(/(\d+) membres/) || [null, '0'])[1];
    check('le listing énumère ses membres', Number(memberCount) > 1, memberCount + ' membres');
  } else {
    console.log('  ..  tests.zip absent : cas grosse archive non vérifié.');
  }

  await page.screenshot({ path: path.join(outDir, 'pdf-native.png'), fullPage: false });
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
