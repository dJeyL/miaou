// Verify — MIAOU servi en http(s) : lien du manifeste, theme-color, service
// worker (cf. docs/pwa.md).
//
// Montage : un serveur local sert dist/ sous /app/ (no-cache, comme le proxy
// MCP), sur 127.0.0.1. Le service worker est celui de l'APPLI (enregistré par
// init), pas un prototype.
//
// Phases :
//   0. file:// : ni lien de manifeste, ni service worker ;
//   1. servi : manifeste lié et lisible, theme-color qui suit thème ET palette,
//      SW qui prend la main ; chargements au besoin faits une fois (mise en
//      cache au premier usage) ;
//   2. proxy qui PEND sur la navigation : la page démarre quand même depuis le
//      cache, passé le délai du SW ;
//   3. proxy coupé + hors ligne : MIAOU démarre, bibliothèques et fontes servies
//      par le cache ; version.json n'est PAS servi par le cache (le SW le laisse
//      passer) ; témoin : une grammaire Prism jamais chargée échoue.
//
// PIÈGE D'INSTRUMENT (mesuré au prototype) : le cache HTTP est désactivé par CDP
// pour les phases 2 et 3. Sans ça, le cache mémoire du moteur sert les <script>
// déjà vus sans passer par le SW, et la phase hors ligne passe sans rien prouver.
//
// Usage : node verify-pwa-sw.mjs [--headed]

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchIsolated } from './stub-backend.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../../..', 'dist');
const headed = process.argv.includes('--headed');
const PORT = 8797;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

let mode = 'serve';   // 'serve' | 'hang-nav'
const hits = [];
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  hits.push(p);
  if (!p.startsWith('/app/')) { res.writeHead(404); res.end(); return; }
  if (mode === 'hang-nav' && (p === '/app/' || p === '/app/miaou.html')) return;   // ne répond jamais
  const name = p === '/app/' ? 'miaou.html' : p.slice('/app/'.length);
  const file = path.join(distDir, name);
  if (name.includes('/') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const results = [];
const check = (label, cond, extra) => {
  results.push({ label, ok: !!cond });
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? '  — ' + extra : ''));
};

const browser = await launchIsolated({ headless: !headed });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

async function waitBoot() {
  await page.waitForSelector('#composer-text', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 30000 });
}

// ── Phase 0 : file:// ────────────────────────────────────────────────────────
await page.goto(pathToFileURL(path.join(distDir, 'miaou.html')).href);
await waitBoot();
check('file:// : aucun lien de manifeste', await page.evaluate(() => !document.querySelector('link[rel="manifest"]')));
// Chromium expose l'API en file:// mais la refuse (InvalidStateError) : c'est
// la preuve qu'aucun enregistrement n'a pu avoir lieu, au même titre qu'une
// liste vide.
check('file:// : aucun service worker', await page.evaluate(async () => {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return true;
  try { return (await navigator.serviceWorker.getRegistrations()).length === 0; }
  catch (e) { return e.name === 'InvalidStateError'; }
}));
consoleErrors.length = 0;

// ── Phase 1 : servi ──────────────────────────────────────────────────────────
await page.goto(ORIGIN + '/app/');
await waitBoot();
const man = await page.evaluate(async () => {
  const l = document.querySelector('link[rel="manifest"]');
  if (!l) return null;
  const r = await fetch(l.href);
  const j = r.ok ? await r.json() : null;
  return { href: l.href, ok: r.ok, start: j && j.start_url, display: j && j.display };
});
check('servi : lien de manifeste posé, relatif au dossier servi', man && man.href === ORIGIN + '/app/manifest.webmanifest', man && man.href);
check('servi : manifeste lisible et installable (standalone)', man && man.ok && man.display === 'standalone');

// theme-color : comparée à un instrument INDÉPENDANT, le fond calculé de la
// topbar composé sur celui du body, une fois les transitions terminées.
async function themeColorState() {
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g).map(Number);
    const t = rgb(getComputedStyle(document.querySelector('.topbar')).backgroundColor);
    const b = rgb(getComputedStyle(document.body).backgroundColor);
    const a = t.length > 3 ? t[3] : 1;
    const hex = '#' + [0, 1, 2].map((i) => Math.round(t[i] * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
    return { meta: document.getElementById('theme-color').getAttribute('content'), expected: hex };
  });
}
const near = (x, y) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return /^#[0-9a-f]{6}$/.test(x) && p(x).every((v, i) => Math.abs(v - p(y)[i]) <= 1);
};
await page.evaluate(() => { selectTheme('dark'); selectPalette('ambre'); });
const tcDark = await themeColorState();
check('theme-color : sombre/ambre = topbar composée sur le fond', near(tcDark.meta, tcDark.expected), JSON.stringify(tcDark));
await page.evaluate(() => selectPalette('foret'));
const tcForet = await themeColorState();
check('theme-color : suit la palette (forêt)', near(tcForet.meta, tcForet.expected) && tcForet.meta !== tcDark.meta, JSON.stringify(tcForet));
await page.evaluate(() => selectTheme('light'));
const tcLight = await themeColorState();
check('theme-color : suit la luminosité (clair/forêt)', near(tcLight.meta, tcLight.expected) && tcLight.meta !== tcForet.meta, JSON.stringify(tcLight));
await page.evaluate(() => { selectTheme('dark'); selectPalette('ambre'); });

// SW de l'appli : enregistré par init, prise de main par clients.claim.
await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 15000 });
const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
check('SW : enregistré par l\'appli, portée = dossier servi', scope === ORIGIN + '/app/', scope);
// Recharger sous contrôle : le HTML et les CDN du <head> passent par le SW.
await page.reload();
await waitBoot();

async function exerciseLibs(grammar) {
  return page.evaluate(async (grammar) => {
    const out = {};
    const run = async (k, fn) => { try { await fn(); out[k] = 'ok'; } catch (e) { out[k] = 'ERR ' + ((e && e.message) || e); } };
    await run('mermaid', () => ensureMermaid());
    await run('quickjs', () => ensureQuickJs());
    await run('fflate', () => ensureFflate());
    await run('pdfjs', () => ensurePdfJs());
    await run('sheetjs-worker', () => parseXlsxInWorker(new Uint8Array([1, 2, 3, 4]), 'list', {}));
    await run('prism-' + grammar, () => new Promise((res, rej) => {
      Prism.plugins.autoloader.loadLanguages([grammar], res, rej);
      setTimeout(() => rej(new Error('timeout')), 15000);
    }));
    return out;
  }, grammar);
}
// Une erreur de PARSING sur des octets bidons prouve que importScripts a réussi.
const importOk = (v) => typeof v === 'string' && (v === 'ok' || (v.startsWith('ERR') && !/importScripts|erreur du worker de parsing|délai/i.test(v)));
const p1 = await exerciseLibs('rust');
check('phase 1 : chargements au besoin réussis', Object.entries(p1).every(([k, v]) => k.startsWith('prism') ? v === 'ok' : importOk(v)), JSON.stringify(p1));
await page.waitForTimeout(1500);   // laisse les mises en cache (waitUntil) aboutir

const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

// ── Phase 2 : proxy qui pend sur la navigation ───────────────────────────────
mode = 'hang-nav';
const t0 = Date.now();
let hangBooted = true;
try { await page.goto(ORIGIN + '/app/', { timeout: 20000 }); await waitBoot(); } catch (e) { hangBooted = false; console.log('  ', e.message.split('\n')[0]); }
const hangMs = Date.now() - t0;
check('phase 2 : navigation pendue → démarrage depuis le cache après le délai', hangBooted && hangMs >= 3500, `${hangMs} ms`);

// ── Phase 3 : proxy coupé + hors ligne ───────────────────────────────────────
server.closeAllConnections(); await new Promise((r) => server.close(r));
await ctx.setOffline(true);
let booted = true;
try { await page.goto(ORIGIN + '/app/'); await waitBoot(); } catch (e) { booted = false; console.log('  ', e.message.split('\n')[0]); }
check('phase 3 : MIAOU démarre proxy coupé et hors ligne', booted);
if (booted) {
  check('phase 3 : marked/DOMPurify/Prism présents', await page.evaluate(() =>
    typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined' && typeof Prism !== 'undefined'));
  check('phase 3 : fonte Hanken Grotesk disponible', await page.evaluate(async () => {
    await document.fonts.ready; return document.fonts.check('16px "Hanken Grotesk"');
  }));
  const p2 = await exerciseLibs('haskell');
  for (const k of ['mermaid', 'quickjs', 'fflate', 'pdfjs']) check(`phase 3 : ${k} rechargé depuis le cache`, p2[k] === 'ok', p2[k]);
  check('phase 3 : SheetJS importé dans le worker depuis le cache', importOk(p2['sheetjs-worker']), p2['sheetjs-worker']);
  check('TÉMOIN : grammaire jamais chargée (haskell) échoue hors ligne', p2['prism-haskell'] !== 'ok', p2['prism-haskell']);
  const v = await page.evaluate(async () => {
    try { const r = await fetch('version.json', { cache: 'no-store' }); return 'servi ' + r.status; } catch (e) { return 'rejeté'; }
  });
  check('phase 3 : version.json non servi par le cache du SW (laissé au réseau)', v === 'rejeté', v);
}

check('le serveur a bien été sollicité (navigation, manifeste, sw.js)',
  ['/app/', '/app/manifest.webmanifest', '/app/sw.js'].every((p) => hits.includes(p)), [...new Set(hits)].join(' '));
console.log('Erreurs console (phases servies) :', consoleErrors.length ? '\n  ' + consoleErrors.slice(0, 15).join('\n  ') : 'aucune');
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
