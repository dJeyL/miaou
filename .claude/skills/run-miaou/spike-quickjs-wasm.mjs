#!/usr/bin/env node
// SPIKE L0 (lot L, js__eval) — faisabilité de charger et exécuter quickjs-emscripten
// dans le contexte MIAOU (un seul <script> NON-module, no bundler, no ES modules
// au niveau source). NE fait pas partie du produit : investigation jetable qui
// tranche l'artefact CDN à retenir (AL1) et valide les trois guards du brief.
//
// Teste DEUX pistes en browser réel (Chromium Playwright), page servie en http
// local pour un contexte représentatif (pas file://) :
//   Piste A — dist/index.global.js (IIFE global `QJS`) chargé par <script src>.
//             WASM fetché SÉPARÉMENT par le glue emscripten → on observe si/comment
//             il résout l'URL du .wasm (le point de friction attendu).
//   Piste B — variant SINGLEFILE (@jitl/quickjs-singlefile-browser-release-sync,
//             .mjs, WASM inliné, AUCUN fetch .wasm séparé) chargé par import()
//             DYNAMIQUE depuis un <script> non-module. Model 2 (RELEASE_SYNC).
//
// Pour chaque piste qui charge : évalue `lines().length` sur un texte injecté
// (marshaling host→guest→host), puis valide les guards :
//   (1) setInterruptHandler tue une boucle infinie dans le timeout,
//   (2) setMemoryLimit fait échouer un while(true)a.push() en exception catchable,
//   (3) une sortie mesurée pour la garde de cap.
//
// Usage : node spike-quickjs-wasm.mjs [--headed]
// Sortie : rapport texte sur stdout + code de sortie 0 si AU MOINS une piste
// est pleinement viable (charge + eval + 3 guards).

import { chromium } from 'playwright';
import http from 'node:http';

const headed = process.argv.includes('--headed');
const VER = '0.32.0';

// Page hôte minimale reproduisant la contrainte MIAOU : un SEUL <script> NON-module.
// Tout le code de test vit dedans, exactement comme le bundle MIAOU.
const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/quickjs-emscripten@${VER}/dist/index.global.js"></script>
</head><body><script>
'use strict';
// Résultats posés ici, lus par Playwright.
window.__spike = { pisteA: null, pisteB: null };

// Guards + eval trivial, factorisés : reçoivent un module WASM déjà obtenu.
async function exerciseModule(QuickJS, label) {
  const out = { label, loaded: true, evalOk: false, evalVal: null,
                guardTimeout: false, guardMemory: false, capMeasured: null, err: null };
  try {
    const ctx = QuickJS.newContext();
    // Injecte un texte + une primitive lines() fermant sur lui (host newFunction),
    // façon Model 2. Marshaling explicite + dispose discipliné.
    const TEXT = 'a\\nbb\\nccc\\ndddd';
    const linesFn = ctx.newFunction('lines', () => {
      const arr = ctx.newArray();
      const parts = TEXT.split('\\n');
      for (let i = 0; i < parts.length; i++) {
        const s = ctx.newString(parts[i]);
        ctx.setProp(arr, i, s); s.dispose();
      }
      return arr;
    });
    ctx.setProp(ctx.global, 'lines', linesFn); linesFn.dispose();
    const res = ctx.evalCode('lines().length');
    if (res.error) { out.err = 'eval error: ' + ctx.dump(res.error); res.error.dispose(); }
    else { out.evalVal = ctx.dump(res.value); res.value.dispose(); out.evalOk = (out.evalVal === 4); }

    // Guard (1) timeout : boucle infinie, interrupt handler à ~500ms de wall-time.
    const rt = QuickJS.runtime || (ctx.runtime);
    try {
      const rt2 = ctx.runtime;
      const start = Date.now();
      rt2.setInterruptHandler(() => Date.now() - start > 500);
      const r = ctx.evalCode('while(true){}');
      out.guardTimeout = !!r.error;   // interrompu → error posé
      if (r.error) r.error.dispose(); else r.value.dispose();
      rt2.removeInterruptHandler && rt2.removeInterruptHandler();
    } catch (e) { out.guardTimeout = true; /* thrown = tué */ }

    // Guard (2) mémoire : plafond bas, while(true)a.push → OOM catchable.
    try {
      const ctx2 = QuickJS.newContext();
      ctx2.runtime.setMemoryLimit(1024 * 1024);   // 1 Mo
      const start2 = Date.now();
      ctx2.runtime.setInterruptHandler(() => Date.now() - start2 > 3000);  // filet
      const r2 = ctx2.evalCode('var a=[]; while(true){ a.push(new Array(1000).fill(0)); }');
      out.guardMemory = !!r2.error;   // OOM → error posé, pas un crash
      if (r2.error) r2.error.dispose(); else r2.value.dispose();
      ctx2.dispose();
    } catch (e) { out.guardMemory = true; }

    // Cap : mesure la longueur d'une sortie string (la garde applicative est côté MIAOU).
    const r3 = ctx.evalCode('"x".repeat(100)');
    if (!r3.error) { out.capMeasured = ctx.dump(r3.value).length; r3.value.dispose(); }
    else r3.error.dispose();

    ctx.dispose();
  } catch (e) { out.err = String(e && e.stack || e); }
  return out;
}

(async () => {
  // Piste A : IIFE global QJS, WASM fetché séparément par le glue.
  try {
    if (!window.QJS) throw new Error('global QJS absent après <script src>');
    // getQuickJS() charge le variant WASM par défaut (fetch du .wasm).
    const QuickJS = await window.QJS.getQuickJS();
    window.__spike.pisteA = await exerciseModule(QuickJS, 'A: index.global.js (IIFE, wasm fetché)');
  } catch (e) {
    window.__spike.pisteA = { label: 'A', loaded: false, err: String(e && e.stack || e) };
  }

  // Piste B : singlefile variant .mjs (wasm inliné), import() dynamique + variant sync.
  try {
    const core = 'https://cdn.jsdelivr.net/npm/quickjs-emscripten-core@${VER}/dist/index.mjs';
    const sf = 'https://cdn.jsdelivr.net/npm/@jitl/quickjs-singlefile-browser-release-sync@${VER}/dist/index.mjs';
    const [{ newQuickJSWASMModuleFromVariant }, variantMod] = await Promise.all([
      import(core), import(sf),
    ]);
    const variant = variantMod.default || variantMod;
    const QuickJS = await newQuickJSWASMModuleFromVariant(variant);
    window.__spike.pisteB = await exerciseModule(QuickJS, 'B: singlefile .mjs (wasm inliné, import dynamique)');
  } catch (e) {
    window.__spike.pisteB = { label: 'B', loaded: false, err: String(e && e.stack || e) };
  }

  window.__spikeDone = true;
})();
</script></body></html>`;

// Sert la page en http local (contexte représentatif, CSP par défaut permissive).
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(HOST_HTML);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage();
const consoleLines = [];
page.on('console', m => consoleLines.push('[console] ' + m.text()));
page.on('pageerror', e => consoleLines.push('[pageerror] ' + e.message));
page.on('requestfailed', r => consoleLines.push('[reqfailed] ' + r.url() + ' :: ' + (r.failure() && r.failure().errorText)));

await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction('window.__spikeDone === true', { timeout: 60000 });
} catch (e) {
  console.log('TIMEOUT en attente de __spikeDone');
}
const spike = await page.evaluate('window.__spike');

console.log('\n===== SPIKE L0 — quickjs-emscripten @' + VER + ' =====\n');
for (const key of ['pisteA', 'pisteB']) {
  const r = spike && spike[key];
  console.log('--- ' + key + ' ---');
  if (!r) { console.log('  (aucun résultat)\n'); continue; }
  console.log('  label       :', r.label);
  console.log('  loaded      :', r.loaded);
  console.log('  evalOk      :', r.evalOk, '(val=' + JSON.stringify(r.evalVal) + ', attendu 4)');
  console.log('  guardTimeout:', r.guardTimeout);
  console.log('  guardMemory :', r.guardMemory);
  console.log('  capMeasured :', r.capMeasured);
  if (r.err) console.log('  ERR         :', r.err.split('\n').slice(0, 4).join('\n                '));
  console.log('');
}
if (consoleLines.length) {
  console.log('--- console / erreurs page ---');
  for (const l of consoleLines.slice(0, 30)) console.log('  ' + l);
}

const viable = (r) => r && r.loaded && r.evalOk && r.guardTimeout && r.guardMemory;
const ok = viable(spike && spike.pisteA) || viable(spike && spike.pisteB);
console.log('\n===== VERDICT : ' + (ok ? 'AU MOINS UNE PISTE VIABLE' : 'AUCUNE PISTE PLEINEMENT VIABLE') + ' =====\n');

await browser.close();
server.close();
process.exit(ok ? 0 : 1);
