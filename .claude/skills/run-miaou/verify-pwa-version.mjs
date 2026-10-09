// Verify — détection de nouvelle version de la page servie (cf. docs/pwa.md,
// « Détection de nouvelle version »).
//
// Montage : un serveur local sert dist/ sous /app/ ; version.json est servi
// depuis une variable (`served`) pour simuler un build plus récent, ou coupé
// (`down` : connexion détruite) pour simuler un proxy arrêté. Le délai minimal
// entre deux lectures (2 min) est court-circuité en remettant à zéro
// `_lastVersionCheck` (pwa.js) ; le signal, lui, est le vrai : un événement
// `focus` sur la fenêtre, câblé dans main.js.
//
// La génération en cours est SIMULÉE par une entrée posée au registre
// `_activeGenerations` : ce qui est vérifié ici est que le refus lit le
// registre, pas le cycle d'une génération (couvert ailleurs).
//
// Usage : node verify-pwa-version.mjs [--headed]

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchIsolated } from './stub-backend.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../../..', 'dist');
const headed = process.argv.includes('--headed');
const PORT = 8796;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const realBuild = JSON.parse(readFileSync(path.join(distDir, 'version.json'), 'utf8')).build;
let served = realBuild;
let down = false;
let versionHits = 0;
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/app/version.json') {
    versionHits++;
    if (down) { req.socket.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ build: served }));
    return;
  }
  if (!p.startsWith('/app/')) { res.writeHead(404); res.end(); return; }
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

async function waitBoot() {
  await page.waitForSelector('#composer-text', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 30000 });
}
const toastShown = (key) => page.evaluate((k) => {
  const el = document.querySelector(`.toast[data-key="${k}"]`);
  return !!el && el.getClientRects().length > 0;
}, key);
const toastText = (key) => page.evaluate((k) => {
  const el = document.querySelector(`.toast[data-key="${k}"] .toast-text`);
  return el ? el.textContent : null;
}, key);
// Relecture sur le vrai signal, délai minimal court-circuité ; attend que la
// requête soit arrivée ET traitée (une passe d'event loop de marge).
async function refocus() {
  const before = versionHits;
  await page.evaluate(() => { _lastVersionCheck = 0; window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => true);
  const t = Date.now();
  while (versionHits === before && Date.now() - t < 5000) await new Promise((r) => setTimeout(r, 50));
  await page.waitForTimeout(400);
  return versionHits - before;
}

await page.goto(ORIGIN + '/app/');
await waitBoot();
await page.waitForTimeout(800);
check('démarrage : version.json relu', versionHits >= 1, `hits=${versionHits}`);
check('démarrage : empreinte identique → aucun toast', !(await toastShown('app-update')));
check('prémisse : la page porte l\'empreinte de dist/version.json', await page.evaluate(() => BUILD_ID) === realBuild);

check('retour de focus : relecture', (await refocus()) === 1);
check('retour de focus, empreinte identique → aucun toast', !(await toastShown('app-update')));

const beforeThrottle = versionHits;
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(600);
check('délai minimal : un second focus rapproché ne relit pas', versionHits === beforeThrottle);

down = true; served = 'ffffffffffffffff';
// >= 1 et non === 1 : sur une connexion détruite, Chromium rejoue d'office une
// fois un GET idempotent — deux arrivées pour une seule lecture de l'appli.
const downHits = await refocus();
check('proxy coupé : la relecture part', downHits >= 1, `arrivées=${downHits}`);
check('proxy coupé : silence, aucun toast', !(await toastShown('app-update')));
down = false;

check('nouvelle empreinte servie : relecture', (await refocus()) === 1);
check('nouvelle empreinte → toast « Nouvelle version »', await toastShown('app-update'), await toastText('app-update'));
check('le toast propose « Recharger »', await page.evaluate(() =>
  (document.querySelector('.toast[data-key="app-update"] .toast-action') || {}).textContent === 'Recharger'));
await page.waitForTimeout(6000);
check('toast persistant : toujours là après 6 s', await toastShown('app-update'));

await page.evaluate(() => { window.__notReloaded = true; });
const clickUpdate = () => page.click('.toast[data-key="app-update"] .toast-body');

// Refus 1 : brouillon dans le composer.
await page.fill('#composer-text', 'brouillon en cours');
await clickUpdate();
await page.waitForTimeout(400);
check('brouillon : pas de rechargement', await page.evaluate(() => window.__notReloaded === true));
check('brouillon : le toast de mise à jour reste', await toastShown('app-update'));
check('brouillon : toast d\'attente qui le dit', (await toastText('app-update-wait') || '').includes('rédaction'), await toastText('app-update-wait'));
await page.fill('#composer-text', '');

// Refus 2 : génération au registre.
await page.evaluate(() => { _activeGenerations.set('__verify-fake__', {}); });
await clickUpdate();
await page.waitForTimeout(400);
check('génération : pas de rechargement', await page.evaluate(() => window.__notReloaded === true));
check('génération : le toast de mise à jour reste', await toastShown('app-update'));
check('génération : toast d\'attente qui le dit', (await toastText('app-update-wait') || '').includes('Génération'), await toastText('app-update-wait'));
await page.evaluate(() => { _activeGenerations.delete('__verify-fake__'); });

// Libre : rechargement effectif.
await Promise.all([page.waitForEvent('load', { timeout: 15000 }), clickUpdate()]);
await waitBoot();
check('libre : la page a été rechargée', await page.evaluate(() => window.__notReloaded === undefined));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
