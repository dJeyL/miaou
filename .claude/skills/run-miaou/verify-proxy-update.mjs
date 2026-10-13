// Mise à jour à la demande du proxy MCP (mcp-update.js), contre un VRAI proxy.
//
// Montage, tout sous un dossier temporaire :
//   remote.git — dépôt nu cloné depuis miaou-mcp-servers (MIAOU_MCP_REPO, par
//                défaut le dépôt voisin), le « remote » que le proxy suit ;
//   pub/       — clone qui publie les commits des scénarios sur remote.git ;
//   work/      — clone d'où tourne le proxy, lancé par scripts/supervise.sh
//                (MIAOU_PROXY_SUPERVISED=1), config.json local non suivi :
//                self_update à true, port VERIFY_PROXY_PORT (18793), miaou_dist
//                versionné dans le clone. Jamais le clone de travail de Julien.
// Deux builds de MIAOU servis tour à tour : B1 = dist/ tel que buildé, B2 = la
// même page avec une autre empreinte (BUILD_ID réécrit dans miaou.html ET dans
// version.json, pour que « servi par ce proxy » reste vrai après rechargement).
//
// Scénarios :
//   A. page servie par ce proxy, mise à jour `both` : toast, Réglages ›
//      Application (libellé, sujets), « Mettre à jour » du toast → redémarrage
//      suivi → rechargement AUTOMATIQUE sur B2 ;
//   B. mise à jour `miaou` avec un brouillon : pas de redémarrage, pas de
//      rechargement (brouillon gardé), repli sur le toast « Recharger », qui
//      recharge une fois le brouillon effacé ;
//   C. page en file://, mise à jour `proxy` : redémarrage suivi, confirmation
//      « proxy MCP revenu », jamais de rechargement ;
//   D. fichier suivi modifié dans le clone du proxy : mise à jour bloquée,
//      toast « à faire à la main » vers Réglages, aucun bouton « Mettre à jour ».
//
// Usage : node verify-proxy-update.mjs [--headed] [--keep]
// --keep laisse le dossier temporaire (journal du superviseur compris).
// Durée : une à quelques minutes ; le premier `uv run` du clone installe son
// environnement.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, readdirSync, statSync, mkdirSync, rmSync, appendFileSync, openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchIsolated } from './stub-backend.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DIST = path.join(ROOT, 'dist');
const MCP_REPO = process.env.MIAOU_MCP_REPO || path.resolve(ROOT, '../miaou-mcp-servers');
const PORT = Number(process.env.VERIFY_PROXY_PORT || 18793);
const headed = process.argv.includes('--headed');
const keep = process.argv.includes('--keep');
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = 'upd';

const failures = [];
let passed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failures.push(label); console.log('  FAIL  ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'miaou-at2-'));
const remote = path.join(tmp, 'remote.git');
const pub = path.join(tmp, 'pub');
const work = path.join(tmp, 'work');
const logPath = path.join(tmp, 'supervise.log');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();

// ── Builds B1 / B2 ────────────────────────────────────────────────────────────
const B1 = JSON.parse(readFileSync(path.join(DIST, 'version.json'), 'utf-8')).build;
const B2 = (B1.slice(0, -4) + 'b2b2').slice(0, B1.length);
const html1 = readFileSync(path.join(DIST, 'miaou.html'), 'utf-8');
const occurrences = html1.split(B1).length - 1;
const html2 = html1.split(B1).join(B2);

function writeDist(dir, which) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(DIST)) {
    const src = path.join(DIST, name);
    if (statSync(src).isFile()) copyFileSync(src, path.join(dir, name));
  }
  const id = which === 'B2' ? B2 : B1;
  writeFileSync(path.join(dir, 'miaou.html'), which === 'B2' ? html2 : html1);
  const v = JSON.parse(readFileSync(path.join(DIST, 'version.json'), 'utf-8'));
  v.build = id;
  writeFileSync(path.join(dir, 'version.json'), JSON.stringify(v));
}

function publish(subject, fn) {
  fn();
  git(pub, 'add', '-A');
  git(pub, 'commit', '-q', '-m', subject);
  git(pub, 'push', '-q', 'origin', 'HEAD');
  return git(pub, 'rev-parse', 'HEAD');
}

function relaunchCount() {
  try { return (readFileSync(logPath, 'utf-8').match(/relance du proxy/g) || []).length; } catch (e) { return 0; }
}

// ── Montage des dépôts et du proxy ──────────────────────────────────────────
let supervisor = null;
async function setup() {
  execFileSync('git', ['clone', '--bare', '-q', MCP_REPO, remote]);
  execFileSync('git', ['clone', '-q', remote, pub]);
  git(pub, 'config', 'user.email', 'verify@example.invalid');
  git(pub, 'config', 'user.name', 'verify');
  publish('build: miaou B1', () => writeDist(path.join(pub, 'miaou_dist'), 'B1'));
  execFileSync('git', ['clone', '-q', remote, work]);
  writeFileSync(path.join(work, 'config.json'), JSON.stringify({ port: PORT, self_update: true, miaou_dist: 'miaou_dist' }));
  const out = openSync(logPath, 'a');
  supervisor = spawn('bash', [path.join(work, 'scripts', 'supervise.sh')], { cwd: work, detached: true, stdio: ['ignore', out, out] });
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/app/version.json');
      if (r.ok && (await r.json()).build === B1) return true;
    } catch (e) { /* pas encore */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

function teardown() {
  if (supervisor) { try { process.kill(-supervisor.pid, 'SIGTERM'); } catch (e) { /* déjà parti */ } }
  if (!keep) { try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tant pis */ } }
  else console.log('Dossier gardé : ' + tmp);
}

// ── Page ─────────────────────────────────────────────────────────────────────
async function bootWait(page) {
  await page.waitForSelector('#composer-text', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 30000 });
}

// Pose la carte du proxy de test, recharge, attend un état lisible « à jour ».
async function configureServer(page) {
  await page.evaluate(({ name, url }) => {
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([{ name, url, enabled: true, authorization_token: '', timeout_s: 30, toolAllowlist: [], toolDenylist: [] }]));
  }, { name: SERVER, url: BASE + '/mcp' });
  await page.reload();
  await bootWait(page);
  await waitUpToDate(page);
}

async function waitUpToDate(page) {
  await page.waitForFunction(async (name) => {
    const st = getMcpStatus(name);
    if (!st || st.state !== 'ok' || !st.updateDeclared) return false;
    const e = proxyUpdateEntry(name);
    if (e && e.status && e.status.state === 'up_to_date') return true;
    await readProxyUpdateStatus(getMcpServer(name), true);
    return false;
  }, SERVER, { timeout: 90000, polling: 2000 });
}

// « Vérifier maintenant » par la surface, puis attente du texte attendu.
async function checkNow(page, expect) {
  await page.evaluate(() => openSettingsCategory('application'));
  await page.waitForFunction(() => !!document.querySelector('#proxy-update-list button'));
  // Le proxy reprend telle quelle une sonde de moins de 30 s (contrat) : un
  // clic juste après la précédente lecture rend l'état d'avant la publication.
  // On reclique donc jusqu'au texte attendu, comme le ferait l'utilisateur.
  await page.waitForFunction((t) => {
    if ((document.getElementById('proxy-update-list').textContent || '').includes(t)) return true;
    const b = [...document.querySelectorAll('#proxy-update-list button')].find(x => x.textContent === 'Vérifier maintenant');
    if (b && !b.disabled) b.click();
    return false;
  }, expect, { timeout: 90000, polling: 5000 });
  await page.evaluate(() => closeSettings());
}

const toastSel = (key) => `.toast[data-key="${key}"]`;
async function toastText(page, key) {
  return page.evaluate((s) => { const t = document.querySelector(s); return t ? t.textContent : null; }, toastSel(key));
}

let browser;
const pageErrors = [];
try {
  console.log('Montage : ' + tmp);
  check('montage : B1 apparaît une seule fois dans miaou.html (empreinte réécrite proprement)', occurrences === 1, occurrences);
  const up = await setup();
  check('montage : le proxy de test sert MIAOU B1 sous /app/', up);
  if (!up) throw new Error('proxy de test injoignable, journal : ' + logPath);

  browser = await launchIsolated({ headless: !headed });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));

  // ── A : servi par ce proxy, genre both → rechargement automatique ─────────
  console.log('\nA. page servie par ce proxy, mise à jour des deux');
  await page.goto(BASE + '/app/');
  await bootWait(page);
  await configureServer(page);
  check('A : la page tourne sur B1 et le proxy publie served_build = B1',
    await page.evaluate((b) => BUILD_ID === b && proxyUpdateEntry('upd').status.servedBuild === b, B1));
  const shaA = publish('feat: phase A', () => {
    writeDist(path.join(pub, 'miaou_dist'), 'B2');
    appendFileSync(path.join(pub, 'README.md'), '\nphase A\n');
  });
  await checkNow(page, 'Nouvelle version de MIAOU et mise à jour des serveurs MCP disponible');
  const surfA = await page.evaluate(() => document.getElementById('proxy-update-list').textContent);
  check('A : Réglages › Application montre le sujet du commit', surfA.includes('feat: phase A'), surfA);
  check('A : toast de proposition, libellé du genre « both »',
    (await toastText(page, 'proxy-update:upd') || '').startsWith('Nouvelle version de MIAOU et mise à jour des serveurs MCP disponible.'),
    await toastText(page, 'proxy-update:upd'));
  check('A : action « Mettre à jour »', (await toastText(page, 'proxy-update:upd') || '').includes('Mettre à jour'));
  const relaunchBeforeA = relaunchCount();
  await page.evaluate(() => { window.__verifyMarker = 'A'; });
  await page.click(toastSel('proxy-update:upd') + ' .toast-body');
  await page.waitForFunction(() => {
    const t = document.querySelector('.toast[data-key="proxy-update:upd:result"]');
    return t && t.textContent.includes('redémarrage du proxy MCP');
  }, null, { timeout: 60000 });
  check('A : le redémarrage est annoncé pendant l\'attente', true);
  await page.waitForFunction(() => typeof window.__verifyMarker === 'undefined' && document.querySelector('.boot-done') !== null,
    null, { timeout: 240000, polling: 500 });
  check('A : la page s\'est rechargée seule', true);
  check('A : elle tourne maintenant sur B2', await page.evaluate((b) => BUILD_ID === b, B2));
  check('A : le clone du proxy est à la cible', git(work, 'rev-parse', 'HEAD') === shaA);
  check('A : le superviseur a relancé le proxy une fois', relaunchCount() === relaunchBeforeA + 1, relaunchCount());

  // ── B : genre miaou, brouillon en cours → pas de rechargement, toast ──────
  console.log('\nB. mise à jour de MIAOU seul, brouillon en cours');
  await waitUpToDate(page);
  check('B : prémisse, « servi par ce proxy » vrai sur B2',
    await page.evaluate((b) => BUILD_ID === b && proxyUpdateEntry('upd').status.servedBuild === b, B2));
  const shaB = publish('fix: phase B', () => writeDist(path.join(pub, 'miaou_dist'), 'B1'));
  await page.fill('#composer-text', 'brouillon à garder');
  await checkNow(page, 'Nouvelle version de MIAOU disponible');
  check('B : toast au libellé du genre « miaou »',
    (await toastText(page, 'proxy-update:upd') || '').startsWith('Nouvelle version de MIAOU disponible.'), await toastText(page, 'proxy-update:upd'));
  const relaunchBeforeB = relaunchCount();
  await page.evaluate(() => { window.__verifyMarker = 'B'; });
  await page.click(toastSel('proxy-update:upd') + ' .toast-body');
  await page.waitForFunction(() => !!document.querySelector('.toast[data-key="app-update"]'), null, { timeout: 60000 });
  const resB = await toastText(page, 'proxy-update:upd:result');
  check('B : l\'issue dit que le rechargement est différé, avec la raison',
    !!resB && resB.includes('Rechargement différé') && resB.includes('rédaction'), resB);
  check('B : pas de rechargement, brouillon gardé',
    await page.evaluate(() => window.__verifyMarker === 'B' && document.getElementById('composer-text').value === 'brouillon à garder'));
  check('B : le clone est à la cible, sans redémarrage',
    git(work, 'rev-parse', 'HEAD') === shaB && relaunchCount() === relaunchBeforeB, { head: git(work, 'rev-parse', 'HEAD'), relaunch: relaunchCount() });
  await page.fill('#composer-text', '');
  await page.click(toastSel('app-update') + ' .toast-body');
  await page.waitForFunction(() => typeof window.__verifyMarker === 'undefined' && document.querySelector('.boot-done') !== null,
    null, { timeout: 60000, polling: 500 });
  check('B : « Recharger » recharge une fois le brouillon effacé, sur B1', await page.evaluate((b) => BUILD_ID === b, B1));

  // ── C : file://, genre proxy → confirmation sans rechargement ─────────────
  console.log('\nC. page ouverte depuis un fichier, mise à jour du proxy seul');
  const fpage = await ctx.newPage();
  fpage.on('pageerror', e => pageErrors.push(String(e)));
  await fpage.goto(pathToFileURL(path.join(DIST, 'miaou.html')).href);
  await bootWait(fpage);
  await configureServer(fpage);
  await page.close();   // la page servie ne doit pas interférer (toasts, lectures)
  const shaC = publish('feat: phase C', () => appendFileSync(path.join(pub, 'README.md'), '\nphase C\n'));
  await checkNow(fpage, 'Mise à jour des serveurs MCP disponible');
  check('C : toast au libellé du genre « proxy »',
    (await toastText(fpage, 'proxy-update:upd') || '').startsWith('Mise à jour des serveurs MCP disponible.'), await toastText(fpage, 'proxy-update:upd'));
  const relaunchBeforeC = relaunchCount();
  await fpage.evaluate(() => { window.__verifyMarker = 'C'; });
  await fpage.click(toastSel('proxy-update:upd') + ' .toast-body');
  await fpage.waitForFunction(() => {
    const t = document.querySelector('.toast[data-key="proxy-update:upd:result"]');
    return t && t.textContent.includes('proxy MCP revenu');
  }, null, { timeout: 240000, polling: 500 });
  check('C : confirmation « proxy MCP revenu »', true);
  check('C : aucun rechargement', await fpage.evaluate(() => window.__verifyMarker === 'C'));
  check('C : le superviseur a relancé le proxy, le clone est à la cible',
    relaunchCount() === relaunchBeforeC + 1 && git(work, 'rev-parse', 'HEAD') === shaC, { relaunch: relaunchCount() });
  check('C : le serveur est reconnecté', await fpage.evaluate(() => getMcpStatus('upd') && getMcpStatus('upd').state === 'ok'));

  // ── D : arbre sale → bloquée, à faire à la main ────────────────────────────
  console.log('\nD. fichier suivi modifié dans le clone du proxy');
  await waitUpToDate(fpage);
  appendFileSync(path.join(work, 'README.md'), '\nmodification locale\n');
  publish('feat: phase D', () => appendFileSync(path.join(pub, 'README.md'), '\nphase D\n'));
  await checkNow(fpage, 'bloquée');
  const surfD = await fpage.evaluate(() => {
    const l = document.getElementById('proxy-update-list');
    return { text: l.textContent, apply: [...l.querySelectorAll('button')].some(b => b.textContent === 'Mettre à jour') };
  });
  check('D : la surface nomme le fichier modifié', surfD.text.includes('README.md'), surfD.text);
  check('D : aucun bouton « Mettre à jour »', !surfD.apply);
  const tD = await toastText(fpage, 'proxy-update:upd') || '';
  check('D : toast « à faire à la main », action vers les réglages',
    tD.includes('à faire à la main') && tD.includes('Réglages › Application') && !tD.includes('Mettre à jour'), tD);

  check('aucune exception non rattrapée dans les pages', pageErrors.length === 0, pageErrors);
} catch (e) {
  failures.push('exception : ' + (e && e.message));
  console.log('  FAIL  exception : ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close();
  teardown();
}

console.log(`\n${passed} PASS, ${failures.length} FAIL`);
process.exit(failures.length ? 1 : 0);
