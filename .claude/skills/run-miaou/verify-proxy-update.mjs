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
// Cycle de vie (extension miaou/lifecycle), sur la même page file://, en
// éditant le config.json du clone (jamais celui de Julien) :
//   E. config inchangée (un commentaire seul modifié ne compte pas), bouton
//      « Redémarrer » dans Réglages › Application ET sur la carte du drawer ;
//   F. config modifiée : ligne et toast, une fois par modification (fermé, il
//      ne revient pas ; une AUTRE modification le ramène) ;
//   G. port changé : avertissement de coupure AVANT tout redémarrage, rien
//      n'est demandé au proxy tant qu'il n'est pas confirmé ;
//   H. config invalide (JSON tronqué) : toast d'erreur avec la cause, redémarrage
//      refusé par le proxy (RESTART_CONFIG_INVALID), proxy toujours en marche ;
//   I. appel d'outil en vol : refus, confirmation avec le compte du refus,
//      « Couper et redémarrer » (force) depuis la carte → retour reconnu à
//      l'instance, config relue inchangée, toast retiré ;
//   J. redémarrage volontaire sans aucune modification, depuis Application ;
//   K. port changé, « Redémarrer quand même » : le proxy relancé ailleurs n'est
//      jamais revu, l'attente va à son terme (PROXY_RESTART_WAIT_MS, trois
//      minutes réelles), toast « pas revenu » avec l'action « Serveurs MCP ».
// Les phases A et C attendent elles aussi le retour par `instance`.
// Santé pendant les redémarrages (C, I, J, K) : l'attente reconnecte la carte en
// boucle, et chaque échec la passe en erreur. Ces échecs-là ne doivent produire
// AUCUN toast de santé (« ne répond plus » / « rétabli », clé `mcp:upd`) : le
// workflow raconte déjà le redémarrage. Prémisse vérifiée à chaque phase — la
// carte est bien passée en erreur pendant l'attente —, sans quoi l'absence de
// toast ne prouverait rien. K couvre le cas où l'attente échoue : la fin du geste
// enregistre l'état atteint sans front, et une synchro ultérieure n'en fait pas
// un non plus.
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

function rebootCount() {
  try { return (readFileSync(logPath, 'utf-8').match(/^supervise: redémarrage demandé/gm) || []).length; } catch (e) { return 0; }
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

// Boucle côté Node, pas un prédicat async dans waitForFunction : en phase F, un
// tel prédicat est passé au vert sans que sa condition soit vraie.
async function waitUpToDate(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(async (name) => {
      const st = getMcpStatus(name);
      if (!st || st.state !== 'ok' || !st.updateDeclared) return false;
      const e = proxyUpdateEntry(name);
      if (e && e.status && e.status.state === 'up_to_date') return true;
      await readProxyUpdateStatus(getMcpServer(name), true);
      return false;
    }, SERVER);
    if (ok) return;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('waitUpToDate : le proxy n\'est pas revenu à up_to_date');
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

// Enregistre, sur la page, les toasts de santé du serveur de test et les
// passages de sa carte en erreur pendant que CET onglet attend son retour.
// Posé après le chargement (fonctions déclarées : un addInitScript serait
// réécrasé), relu et remis à zéro par phase via `healthSince`.
// La boucle d'attente ne synchronise pas la santé elle-même : ce sont les
// autres écrivains de statut (sonde du backend, échec ou succès d'appel,
// reprise, drawer) qui appellent `syncHealthToasts`, au gré de l'activité. Une
// attente sans aucun d'eux ne produit donc aucun front, code corrigé ou non
// (premier rejeu : prémisse fausse en C). D'où une synchro forcée toutes les
// 300 ms, qui tient lieu de cette activité et rend le scénario déterministe.
async function recordHealth(p) {
  await p.evaluate((name) => {
    window.__health = { toasts: [], heldErrors: 0, states: [] };
    setInterval(() => syncHealthToasts(), 300);
    const realShow = showToast;
    window.showToast = function (opts) {
      if (opts && opts.key === 'mcp:' + name) window.__health.toasts.push(opts.level + ': ' + opts.text);
      return realShow.apply(this, arguments);
    };
    const realSync = syncHealthToasts;
    window.syncHealthToasts = function () {
      const st = getMcpStatus(name);
      const awaited = proxyRestartAwaitedNames().indexOf(name) >= 0;
      if (st && st.state === 'error' && awaited) window.__health.heldErrors++;
      // Trace des états vus (doublons consécutifs fusionnés), pour le diagnostic.
      const tag = (awaited ? 'held:' : '') + (st ? st.state : 'none');
      const seen = window.__health.states;
      if (seen[seen.length - 1] !== tag) seen.push(tag);
      return realSync.apply(this, arguments);
    };
  }, SERVER);
}
async function healthSince(p) {
  return p.evaluate(() => { const h = window.__health; window.__health = { toasts: [], heldErrors: 0, states: [] }; return h; });
}
// `premise` : la carte doit être passée en erreur pendant l'attente, sans quoi
// l'absence de toast ne prouve rien. Assertée seulement là où le montage la
// garantit — I (coupure forcée) et K (proxy jamais revu). En C et J, le proxy
// relancé répond souvent dès la première reconnexion (2 s) : états mesurés
// `ok → held:ok → ok`, aucun échec à masquer ; la trace est alors seulement
// imprimée.
function checkHealthQuiet(phase, h, premise) {
  if (premise) check(phase + ' : prémisse, la carte est passée en erreur pendant l\'attente', h.heldErrors > 0, h);
  else console.log('  (' + phase + ' : états vus pendant l\'attente ' + JSON.stringify(h.states) + ', erreurs tenues : ' + h.heldErrors + ')');
  check(phase + ' : aucun toast de santé pendant le redémarrage', h.toasts.length === 0, h.toasts);
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
  await recordHealth(fpage);
  await page.close();   // la page servie ne doit pas interférer (toasts, lectures)
  const shaC = publish('feat: phase C', () => appendFileSync(path.join(pub, 'README.md'), '\nphase C\n'));
  await checkNow(fpage, 'Mise à jour des serveurs MCP disponible');
  check('C : toast au libellé du genre « proxy »',
    (await toastText(fpage, 'proxy-update:upd') || '').startsWith('Mise à jour des serveurs MCP disponible.'), await toastText(fpage, 'proxy-update:upd'));
  const relaunchBeforeC = relaunchCount();
  await fpage.evaluate(() => { window.__verifyMarker = 'C'; });
  await healthSince(fpage);
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
  checkHealthQuiet('C', await healthSince(fpage), false);

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

  // ── Cycle de vie ───────────────────────────────────────────────────────────
  const cfgPath = path.join(work, 'config.json');
  const baseCfg = { port: PORT, self_update: true, miaou_dist: 'miaou_dist' };
  const writeCfg = (extra) => writeFileSync(cfgPath, JSON.stringify(Object.assign({}, baseCfg, extra || {})));
  const lc = (p) => p.evaluate(() => { const e = proxyLifecycleEntry('upd'); return e && e.status ? JSON.parse(JSON.stringify(e.status)) : null; });
  const appText = (p) => p.evaluate(() => document.getElementById('proxy-update-list').textContent || '');
  // « Vérifier maintenant » jusqu'à ce que la ligne de config dise `expect`.
  async function checkLifecycle(p, expect) {
    await p.evaluate(() => openSettingsCategory('application'));
    await p.waitForFunction((t) => {
      const l = document.getElementById('proxy-update-list');
      if ((l.textContent || '').includes(t)) return true;
      const b = [...l.querySelectorAll('button')].find(x => x.textContent === 'Vérifier maintenant');
      if (b && !b.disabled) b.click();
      return false;
    }, expect, { timeout: 60000, polling: 1500 });
  }
  const closeToast = (p, key) => p.evaluate((s) => { const t = document.querySelector(s + ' .toast-x'); if (t) t.click(); }, toastSel(key));
  async function clickAppRestart(p) {
    await p.evaluate(() => openSettingsCategory('application'));
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('#proxy-update-list button')].find(x => x.textContent === 'Redémarrer');
      if (!b) throw new Error('pas de bouton Redémarrer dans Application');
      b.click();
    });
  }

  console.log('\nE. cycle de vie : config inchangée');
  // D a laissé l'arbre sale ; sans effet sur la config.
  await fpage.waitForFunction(() => { const st = getMcpStatus('upd'); return !!(st && st.state === 'ok' && st.lifecycleDeclared); }, null, { timeout: 30000 });
  check('E : prémisse, la carte déclare miaou/lifecycle', true);
  writeCfg({ _comment: 'note ajoutée, sans effet' });
  await checkLifecycle(fpage, 'Configuration inchangée depuis le démarrage du proxy');
  const e0 = await lc(fpage);
  check('E : un commentaire seul modifié laisse la config inchangée, proxy relançable',
    !!e0 && e0.config.state === 'unchanged' && e0.restartable === true, e0);
  check('E : bouton « Redémarrer » dans Réglages › Application',
    await fpage.evaluate(() => [...document.querySelectorAll('#proxy-update-list button')].some(b => b.textContent === 'Redémarrer')));
  await fpage.evaluate(() => { closeSettings(); openMcpServers(); });
  await fpage.waitForSelector('.mcp-card[data-server-name="upd"] .mcp-restart', { timeout: 10000 }).catch(() => {});
  check('E : bouton « Redémarrer » sur la carte du serveur',
    await fpage.evaluate(() => { const b = document.querySelector('.mcp-card[data-server-name="upd"] .mcp-restart'); return !!b && b.getClientRects().length > 0; }));
  await fpage.evaluate(() => closeMcpServers());
  check('E : aucun toast de config', (await toastText(fpage, 'proxy-lifecycle:upd')) === null);

  console.log('\nF. config modifiée, un toast par modification');
  writeCfg({ mcpServers: { weather: { disabled: true } } });
  await checkLifecycle(fpage, 'Configuration modifiée');
  check('F : la ligne nomme le chemin changé', (await appText(fpage)).includes('mcpServers.weather'), await appText(fpage));
  await fpage.evaluate(() => closeSettings());
  await fpage.waitForSelector(toastSel('proxy-lifecycle:upd'), { timeout: 10000 }).catch(() => {});
  const tF = await toastText(fpage, 'proxy-lifecycle:upd') || '';
  check('F : toast « Configuration du proxy MCP modifiée », action « Redémarrer »',
    tF.startsWith('Configuration du proxy MCP modifiée.') && tF.includes('Redémarrer'), tF);
  await closeToast(fpage, 'proxy-lifecycle:upd');
  await fpage.waitForFunction((s) => !document.querySelector(s), toastSel('proxy-lifecycle:upd'), { timeout: 5000 });
  await fpage.evaluate(() => readProxyLifecycleStatus(getMcpServer('upd')));
  await fpage.evaluate(() => readProxyLifecycleStatus(getMcpServer('upd')));
  check('F : fermé, le toast ne revient pas pour la même modification', (await toastText(fpage, 'proxy-lifecycle:upd')) === null);
  // `bench` est actif par défaut (duckduckgo, lui, est déjà désactivé dans
  // config.defaults.json : le désactiver ne change rien à la config fusionnée).
  writeCfg({ mcpServers: { weather: { disabled: true }, bench: { disabled: true } } });
  // Boucle côté Node : un prédicat async de waitForFunction n'a pas été attendu
  // ici (passé au vert sans que la condition soit vraie).
  for (let i = 0; i < 20; i++) {
    const st = await fpage.evaluate(() => readProxyLifecycleStatus(getMcpServer('upd')).then(s => s && s.config.changed));
    if (st && st.indexOf('mcpServers.bench') >= 0) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  await fpage.waitForSelector(toastSel('proxy-lifecycle:upd'), { timeout: 5000 }).catch(() => {});
  check('F : une autre modification ramène le toast', !!(await toastText(fpage, 'proxy-lifecycle:upd')),
    await fpage.evaluate(() => ({ announced: _proxyLifecycleAnnounced.upd, sig: proxyLifecycleSignature(proxyLifecycleEntry('upd').status), busy: _proxyUpdateBusy.upd || '' })));

  console.log('\nG. port changé : avertissement avant le redémarrage');
  writeCfg({ port: PORT + 1 });
  await checkLifecycle(fpage, 'port');
  const instG = (await lc(fpage)).instance;
  const rebootsG = rebootCount();
  await clickAppRestart(fpage);
  await fpage.waitForSelector(toastSel('proxy-restart:upd:confirm'), { timeout: 10000 }).catch(() => {});
  const tG = await toastText(fpage, 'proxy-restart:upd:confirm') || '';
  check('G : avertissement qui nomme port et dit quoi faire', tG.includes('touche port') && tG.includes('URL de sa carte'), tG);
  check('G : action « Redémarrer quand même »', tG.includes('Redémarrer quand même'), tG);
  await new Promise(r => setTimeout(r, 3000));
  check('G : rien n\'est demandé au proxy sans confirmation',
    rebootCount() === rebootsG && (await fpage.evaluate(() => readProxyLifecycleStatus(getMcpServer('upd')).then(s => s && s.instance))) === instG);
  await closeToast(fpage, 'proxy-restart:upd:confirm');
  await fpage.evaluate(() => closeSettings());

  console.log('\nH. config invalide');
  writeFileSync(cfgPath, '{ "port": ' + PORT + ', "self_update": tr');
  await checkLifecycle(fpage, 'invalide');
  const tH = await toastText(fpage, 'proxy-lifecycle:upd') || '';
  const lH = await lc(fpage);
  check('H : toast d\'erreur « invalide » avec la cause du proxy',
    tH.startsWith('Configuration du proxy MCP invalide') && !!lH.config.detail && tH.includes(lH.config.detail.slice(0, 20)), { tH, detail: lH.config.detail });
  check('H : toast sans action', !(await fpage.evaluate((s) => document.querySelector(s).classList.contains('has-action'), toastSel('proxy-lifecycle:upd'))));
  const rebootsH = rebootCount();
  await clickAppRestart(fpage);
  await fpage.waitForFunction(() => { const t = document.querySelector('.toast[data-key="proxy-restart:upd:result"]'); return t && t.textContent.includes('refusé'); }, null, { timeout: 20000 }).catch(() => {});
  const rH = await toastText(fpage, 'proxy-restart:upd:result') || '';
  check('H : redémarrage refusé, configuration invalide, cause gardée', rH.startsWith('Redémarrage refusé, configuration invalide'), rH);
  check('H : le proxy n\'a pas redémarré', rebootCount() === rebootsH && (await lc(fpage)).instance === lH.instance);
  await fpage.evaluate(() => closeSettings());

  console.log('\nI. appel d\'outil en vol : forçage depuis la carte');
  writeCfg({ mcpServers: { weather: { disabled: true } } });
  await checkLifecycle(fpage, 'Configuration modifiée');
  await fpage.evaluate(() => closeSettings());
  const instI = (await lc(fpage)).instance;
  const sleepTool = await fpage.evaluate(() => {
    const t = (_remoteTools.upd || []).find(d => /sleep$/.test(d.name));
    return t ? t.name.slice('upd__'.length) : null;
  });
  check('I : prémisse, l\'outil sleep du bench est exposé', !!sleepTool, sleepTool);
  await fpage.evaluate((tool) => {
    window.__sleepCall = 'pending';
    const s = Object.assign({}, getMcpServer('upd'), { timeout_s: 60 });
    mcpRpc(s, 'tools/call', { name: tool, arguments: { seconds: 40 } })
      .then(() => { window.__sleepCall = 'done'; }, () => { window.__sleepCall = 'cut'; });
  }, sleepTool);
  await new Promise(r => setTimeout(r, 1500));
  const rebootsI = rebootCount();
  await fpage.evaluate(() => openMcpServers());
  await fpage.waitForSelector('.mcp-card[data-server-name="upd"] .mcp-restart', { timeout: 10000 });
  await fpage.click('.mcp-card[data-server-name="upd"] .mcp-restart');
  await fpage.waitForFunction(() => { const t = document.querySelector('.toast[data-key="proxy-restart:upd:confirm"]'); return t && t.textContent.includes('coupé'); }, null, { timeout: 20000 }).catch(() => {});
  const cI = await toastText(fpage, 'proxy-restart:upd:confirm') || '';
  check('I : confirmation avec le compte lu dans le refus', cI.startsWith('1 appel d’outil en cours sera coupé'), cI);
  check('I : action « Couper et redémarrer », rien de redémarré avant', cI.includes('Couper et redémarrer') && rebootCount() === rebootsI, cI);
  await healthSince(fpage);
  await fpage.click(toastSel('proxy-restart:upd:confirm') + ' .toast-body');
  await fpage.waitForFunction(() => { const t = document.querySelector('.toast[data-key="proxy-restart:upd:result"]'); return t && /redémarré\.|pas revenu/.test(t.textContent); }, null, { timeout: 240000, polling: 500 });
  checkHealthQuiet('I', await healthSince(fpage), true);
  const rI = await toastText(fpage, 'proxy-restart:upd:result') || '';
  check('I : « Proxy MCP redémarré. »', rI.startsWith('Proxy MCP redémarré.'), rI);
  const lI = await lc(fpage);
  check('I : un autre processus (instance), relancé une fois par le superviseur',
    !!lI && lI.instance !== instI && rebootCount() === rebootsI + 1, { before: instI, after: lI && lI.instance, reboots: rebootCount() - rebootsI });
  check('I : config relue inchangée par le nouveau processus, toast retiré',
    lI.config.state === 'unchanged' && (await toastText(fpage, 'proxy-lifecycle:upd')) === null, lI.config);
  check('I : l\'appel en vol a été coupé', await fpage.evaluate(() => window.__sleepCall === 'cut'), await fpage.evaluate(() => window.__sleepCall));
  await fpage.evaluate(() => closeMcpServers());

  console.log('\nJ. redémarrage volontaire, config inchangée');
  const instJ = lI.instance;
  const rebootsJ = rebootCount();
  await healthSince(fpage);
  await clickAppRestart(fpage);
  await fpage.waitForFunction(() => { const t = document.querySelector('.toast[data-key="proxy-restart:upd:result"]'); return t && /redémarré\.|pas revenu|refusé/.test(t.textContent) && !document.querySelector('#proxy-update-list .proxy-busy'); }, null, { timeout: 240000, polling: 500 });
  checkHealthQuiet('J', await healthSince(fpage), false);
  const lJ = await lc(fpage);
  check('J : aucun avertissement (config inchangée), proxy revenu sous une autre instance',
    (await toastText(fpage, 'proxy-restart:upd:confirm')) === null && !!lJ && lJ.instance !== instJ && rebootCount() === rebootsJ + 1,
    { toast: await toastText(fpage, 'proxy-restart:upd:result'), reboots: rebootCount() - rebootsJ });
  check('J : la carte est reconnectée', await fpage.evaluate(() => getMcpStatus('upd') && getMcpStatus('upd').state === 'ok'));

  console.log('\nK. port changé, redémarrage confirmé : le proxy n\'est jamais revu (trois minutes)');
  await fpage.evaluate(() => closeSettings());
  writeCfg({ port: PORT + 1 });
  await checkLifecycle(fpage, 'port');
  await clickAppRestart(fpage);
  await fpage.waitForSelector(toastSel('proxy-restart:upd:confirm'), { timeout: 10000 });
  await fpage.evaluate(() => closeSettings());
  await healthSince(fpage);
  // Le « Proxy MCP redémarré. » de J peut être encore affiché, sous la même
  // clé : l'attendre tel quel ferait conclure K aussitôt (payé au premier rejeu).
  await fpage.evaluate(() => dismissToast('proxy-restart:upd:result'));
  await fpage.click(toastSel('proxy-restart:upd:confirm') + ' .toast-body');
  await fpage.waitForFunction(() => !!_proxyUpdateBusy.upd, null, { timeout: 20000 });
  await fpage.waitForFunction(() => {
    const t = document.querySelector('.toast[data-key="proxy-restart:upd:result"]');
    return !_proxyUpdateBusy.upd && t && /redémarré\.|pas revenu/.test(t.textContent);
  }, null, { timeout: 300000, polling: 1000 });
  const rK = await toastText(fpage, 'proxy-restart:upd:result') || '';
  check('K : « pas revenu », avec l\'action « Serveurs MCP »', rK.startsWith('Le proxy MCP n’est pas revenu') && rK.includes('Serveurs MCP'), rK);
  check('K : la carte est en erreur une fois l\'attente finie', await fpage.evaluate(() => getMcpStatus('upd') && getMcpStatus('upd').state === 'error'));
  // Une synchro APRÈS la fin du geste (l'appli en refait à chaque changement de
  // santé) : sans l'absorption, c'est elle qui ferait le front ok → erreur.
  await fpage.evaluate(() => syncHealthToasts());
  checkHealthQuiet('K', await healthSince(fpage), true);
  check('K : aucun toast de santé affiché', (await toastText(fpage, 'mcp:upd')) === null);

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
