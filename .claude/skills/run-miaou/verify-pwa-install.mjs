// Verify — Réglages › Application et sonde de la version servie depuis file://
// (cf. docs/pwa.md, « Installer, ou passer à la version servie »).
//
// Montage : un serveur local sert dist/ sous /app/ (version.json compris). En
// file://, MIAOU cherche la version servie sur l'origine de ses serveurs MCP :
// on y pose un serveur DÉSACTIVÉ (enabled: false) — la sonde lit la liste
// configurée, pas les seuls serveurs actifs, et aucun handshake MCP ne part.
//
// L'installation réelle n'est pas automatisable (dialogue du navigateur) :
// `beforeinstallprompt` et `appinstalled` sont SIMULÉS par des événements
// synthétiques. Ce qui est vérifié est le câblage des écouteurs et l'état de
// la catégorie ; l'installation elle-même est dans docs/manual-tests.md.
//
// Usage : node verify-pwa-install.mjs [--headed]

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchIsolated } from './stub-backend.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../../..', 'dist');
const headed = process.argv.includes('--headed');
const PORT = 8795;
const CLOSED_PORT = 8794;   // rien n'y écoute : proxy arrêté
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

let versionHits = 0;
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/app/version.json') versionHits++;
  if (!p.startsWith('/app/')) { res.writeHead(404); res.end(); return; }
  const name = p === '/app/' ? 'miaou.html' : p.slice('/app/'.length);
  const file = path.join(distDir, name);
  if (name.includes('/') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream',
    'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
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
const visible = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && !el.hidden && el.getClientRects().length > 0;
}, sel);
const toastShown = () => page.evaluate(() => {
  const el = document.querySelector('.toast[data-key="served-app"]');
  return !!el && el.getClientRects().length > 0;
});
async function openAppCategory() {
  await page.evaluate(() => openSettingsCategory('application'));
  await page.waitForSelector('#drawer.show');
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    hint: document.getElementById('install-hint').textContent,
    install: !document.getElementById('install-btn').hidden,
    openServed: !document.getElementById('served-app-btn').hidden,
  }));
}
async function closeSettingsDrawer() { await page.evaluate(() => closeSettings()); await page.waitForTimeout(300); }
async function setServersAndReload(servers) {
  await page.evaluate((s) => localStorage.setItem('miaou-mcp-servers', JSON.stringify(s)), servers);
  await page.reload();
  await waitBoot();
  await page.waitForTimeout(1500);   // sonde : lecture bornée à 3 s, locale ici
}

// ── file:// sans serveur MCP ─────────────────────────────────────────────────
await page.goto(pathToFileURL(path.join(distDir, 'miaou.html')).href);
await waitBoot();
await page.waitForTimeout(1000);
check('file://, aucun serveur MCP : pas de toast', !(await toastShown()));
let st = await openAppCategory();
check('file://, aucun serveur MCP : explique, aucun bouton', !st.install && !st.openServed && st.hint.includes('miaou_dist'), st.hint);
await closeSettingsDrawer();

// ── file:// avec un serveur MCP dont le proxy est arrêté ─────────────────────
await setServersAndReload([{ name: 'arrete', url: `http://127.0.0.1:${CLOSED_PORT}/mcp`, enabled: false }]);
check('file://, proxy arrêté : pas de toast', !(await toastShown()));
st = await openAppCategory();
check('file://, proxy arrêté : pas de bouton « Ouvrir la version servie »', !st.openServed, st.hint);
await closeSettingsDrawer();

// ── file:// avec un proxy qui sert MIAOU ─────────────────────────────────────
const hitsBefore = versionHits;
await setServersAndReload([
  { name: 'arrete', url: `http://127.0.0.1:${CLOSED_PORT}/mcp`, enabled: false },
  { name: 'proxy', url: `${ORIGIN}/mcp`, enabled: false }]);
check('file://, proxy actif : la sonde a lu version.json (après le candidat mort)', versionHits > hitsBefore, `hits=${versionHits - hitsBefore}`);
check('file://, proxy actif : toast qui signale la version servie', await toastShown());
st = await openAppCategory();
check('file://, proxy actif : la catégorie nomme l\'adresse', st.hint.includes(`${ORIGIN}/app/`), st.hint);
check('file://, proxy actif : « Ouvrir la version servie » visible, pas « Installer »', st.openServed && !st.install);
await closeSettingsDrawer();
await page.evaluate(() => dismissToast('served-app'));
await page.reload();
await waitBoot();
await page.waitForTimeout(1500);
check('file://, même session : pas de second toast', !(await toastShown()));
st = await openAppCategory();
check('file://, même session : le bouton reste proposé', st.openServed);
await closeSettingsDrawer();

// ── page servie ──────────────────────────────────────────────────────────────
await page.goto(ORIGIN + '/app/');
await waitBoot();
await page.waitForTimeout(800);
// Chromium headless peut ou non émettre l'invite : l'attendu se déduit de
// l'état réel, lu avant de regarder la catégorie.
const nativePrompt = await page.evaluate(() => !!_installPrompt);
st = await openAppCategory();
check('servi : bouton « Installer » si et seulement si une invite est gardée', st.install === nativePrompt, `invite native=${nativePrompt}`);
check('servi : jamais « Ouvrir la version servie »', !st.openServed);
if (!nativePrompt) check('servi sans invite : ligne qui dit comment faire', st.hint.includes('Ajouter au Dock'), st.hint);
await page.evaluate(() => {
  window.__prompted = 0;
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompted++; };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
  window.__defaultPrevented = e.defaultPrevented;
});
check('beforeinstallprompt : comportement par défaut empêché (invite différée)', await page.evaluate(() => window.__defaultPrevented));
check('beforeinstallprompt : le bouton « Installer » apparaît, catégorie ouverte', await visible('#install-btn'));
await page.click('#install-btn');
await page.waitForTimeout(300);
check('clic : l\'invite gardée est déclenchée une fois', await page.evaluate(() => window.__prompted === 1));
check('clic : l\'invite est consommée, plus de bouton', !(await visible('#install-btn')));
await page.evaluate(() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' });
  window.dispatchEvent(e);
});
check('nouvelle invite : bouton de retour', await visible('#install-btn'));
await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
await page.waitForTimeout(200);
check('appinstalled : bouton masqué', !(await visible('#install-btn')));
check('appinstalled : la ligne dit que MIAOU est installé', (await page.evaluate(() =>
  document.getElementById('install-hint').textContent)).includes('installé'));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
