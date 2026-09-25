#!/usr/bin/env node
// Vérif e2e — le chat soucieux est VU pendant le boot, y compris quand le
// verdict de santé tombe juste après le plancher nominal.
//
// Le défaut corrigé (signalé par Julien sur son poste de travail) : un serveur
// MCP injoignable ne faisait froncer le chat qu'APRÈS l'estompage de l'overlay,
// alors qu'un backend mort le faisait dès le boot. Deux causes cumulées :
//   1. `finishBoot` lisait `body.miaou-worried` UNE fois, au moment d'armer son
//      timer — donc avant que `prefetchModels` et `reconnectMcpServers`, lancées
//      sans être attendues quelques lignes plus haut, aient conclu. Le plancher
//      était figé sur un état encore vierge (piège 24(b) du projet : relire
//      APRÈS l'attente, jamais un instantané pris avant).
//   2. Même relu, le plancher nominal (1.8 s) expirait AVANT le verdict : un
//      MCP dont la connexion est refusée par l'OS conclut vers 2 s
//      (`ERR_CONNECTION_REFUSED` mesuré au Network). Il manquait 200 ms.
//
// Montage : un port FERMÉ comme URL de serveur MCP. C'est ce qui reproduit le
// refus de connexion du poste de travail sans dépendre de lui — rien n'est
// stubé, le handshake part réellement et se fait réellement refuser.
//
// Conditions dont dépendent les assertions :
//   - `miaou-mcp-servers` est seedé AVANT le premier paint (addInitScript), sans
//     quoi l'app démarre sans serveur et ne tente aucune connexion : toutes les
//     assertions seraient vertes sur un scénario vide.
//   - La sentinelle `miaou-mcp-seeded` est posée pour que le seed de build
//     n'écrase pas la fixture.
//   - Le boot est chronométré depuis `_bootReadyAt` (horloge de l'app), pas
//     depuis `page.goto` : le temps de chargement du fichier n'appartient pas
//     au plancher qu'on mesure.
//   - `.boot-done` s'observe par `waitForFunction` sur la CLASSE, jamais par
//     `waitForSelector` : l'overlay n'est jamais retiré du DOM et devient
//     invisible en recevant la classe, donc un waitForSelector ne pourrait que
//     temporiser (piège documenté dans SKILL.md).
//
// Usage : node verify-boot-worried.mjs [--headed]
//   Prérequis : `python3 build.py` fait.
import { launchIsolated } from './stub-backend.js';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const SLOW_PORT = 8793;    // refuse APRÈS un délai (cf. startSlowFailServer)
const HANG_PORT = 8794;    // accepte la connexion et ne répond JAMAIS

// Délai avant l'échec, calé pour tomber JUSTE APRÈS le plancher nominal
// (BOOT_MIN_AFTER_READY_MS = 1800 ms). C'est toute la fenêtre du défaut : un
// verdict plus rapide arrive à temps même sur le code cassé, un verdict plus
// lent dépasse la borne dure et n'est légitimement plus attendu.
const SLOW_FAIL_MS = 2000;

const failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); failures.push(label); }
}

// ── Serveur qui échoue TARD ──────────────────────────────────────────────────
// Reproduit la FENÊTRE TEMPORELLE du cas signalé en usage réel : un
// `ERR_CONNECTION_REFUSED` qui arrive ~2 s après le démarrage, soit juste après
// le plancher nominal.
//
// Un port simplement fermé ne la reproduit pas SUR CETTE MACHINE : le refus y
// est tranché en ~266 ms (mesuré), donc avant le plancher, donc dans la zone où
// même le code défectueux affichait le fronçage — le scénario aurait vérifié le
// cas qui marchait déjà. Ce n'est pas une affirmation sur la machine où le
// défaut a été observé : la latence d'un refus dépend de la pile réseau, de la
// résolution de nom et du chemin emprunté, et rien de ce qui est mesuré ici
// n'en dit quoi que ce soit. On fabrique donc le délai plutôt que de compter
// sur l'environnement pour le produire.
//
// On accepte donc la connexion puis on détruit la socket après SLOW_FAIL_MS :
// côté navigateur c'est un échec réseau, arrivé au moment voulu.
let slowServer = null;
let slowHits = 0;
function startSlowFailServer() {
  return new Promise((resolve) => {
    slowHits = 0;
    slowServer = http.createServer((req, res) => {
      slowHits++;
      setTimeout(() => { res.socket && res.socket.destroy(); }, SLOW_FAIL_MS);
    });
    slowServer.listen(SLOW_PORT, '127.0.0.1', resolve);
  });
}
function stopSlowFailServer() {
  return new Promise((resolve) => {
    if (!slowServer) return resolve();
    slowServer.closeAllConnections?.();
    slowServer.close(() => { slowServer = null; resolve(); });
  });
}

// ── Serveur qui PEND : accepte la connexion, ne répond jamais ────────────────
// Sert le cas où aucun verdict n'arrive. Sans lui, la borne dure
// (BOOT_MAX_WAIT_MS) ne serait exercée par aucun scénario — et une borne jamais
// atteinte est exactement le genre de garde qui survit à sa propre suppression.
let hangServer = null;
let hangHits = 0;
function startHangServer() {
  return new Promise((resolve) => {
    hangHits = 0;
    hangServer = http.createServer(() => { hangHits++; /* jamais de res.end() */ });
    hangServer.listen(HANG_PORT, '127.0.0.1', resolve);
  });
}
function stopHangServer() {
  return new Promise((resolve) => {
    if (!hangServer) return resolve();
    hangServer.closeAllConnections?.();
    hangServer.close(() => { hangServer = null; resolve(); });
  });
}

function mcpFixture(url) {
  return JSON.stringify([{
    name: 'bidon', url, transport: 'http', enabled: true,
    authorization_token: '', timeout_s: 130, toolAllowlist: [], toolDenylist: [],
  }]);
}

// Un boot complet, chronométré depuis l'horloge interne de l'app.
async function bootAndMeasure(browser, mcpUrl) {
  const page = await browser.newPage();
  await page.addInitScript((servers) => {
    localStorage.setItem('miaou-mcp-servers', servers);
    localStorage.setItem('miaou-mcp-seeded', '1');   // le seed de build n'écrase pas la fixture
  }, mcpFixture(mcpUrl));

  // Observateur posé AVANT le premier paint : il enregistre si le fronçage est
  // arrivé pendant que l'overlay était encore VISIBLE. Lire la classe après coup
  // ne répondrait pas à la question — à cet instant le verdict est tombé de
  // toute façon, donc l'assertion passerait aussi sur le code cassé (constaté au
  // rejeu : elle ne discriminait rien).
  await page.addInitScript(() => {
    window.__worriedWhileBooting = false;
    const tick = () => {
      const o = document.getElementById('boot-overlay');
      const visible = o && !o.classList.contains('boot-done');
      if (visible && document.body && document.body.classList.contains('miaou-worried')) {
        window.__worriedWhileBooting = true;
      }
      if (visible || !o) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto('file://' + distPath);
  // État TERMINAL, pas un délai : la classe arrive sur un overlay qui devient
  // invisible en la recevant.
  await page.waitForFunction(
    () => document.querySelector('.boot-done') !== null,
    { timeout: 15000 });

  const m = await page.evaluate(() => ({
    // Durée réelle du plancher, mesurée sur l'horloge que finishBoot utilise.
    bootMs: Date.now() - _bootReadyAt,
    worried: document.body.classList.contains('miaou-worried'),
    worriedWhileBooting: window.__worriedWhileBooting,
    mcpState: (mcpStatusSnapshot().bidon || {}).state || null,
  }));
  return { page, ...m };
}

(async () => {
  const browser = await launchIsolated({ headless: !headed });
  console.log('\n=== Chat soucieux au boot ===\n');

  // ── 1. MCP injoignable : le chat fronce PENDANT le boot ───────────────────
  console.log(`[1] serveur MCP qui échoue après ${SLOW_FAIL_MS} ms (cas du poste de travail)`);
  await startSlowFailServer();
  {
    const r = await bootAndMeasure(browser, `http://127.0.0.1:${SLOW_PORT}/mcp`);
    check('le serveur a bien été sollicité', slowHits > 0, slowHits + ' requête(s)');
    // Prémisse : sans elle, les deux assertions suivantes seraient vraies sur
    // un scénario où rien n'a été tenté.
    check('le serveur MCP est bien en erreur', r.mcpState === 'error',
          'state=' + r.mcpState);
    // LE contrôle du lot, et il porte sur la FENÊTRE, pas sur l'état final :
    // « le fronçage a-t-il été visible pendant que l'overlay l'était ? ».
    check('le chat a froncé pendant que l\'overlay était visible',
          r.worriedWhileBooting === true,
          'observé en vol=' + r.worriedWhileBooting + ', état final=' + r.worried);
    // Le plancher allongé a bien été retenu. Borné des DEUX côtés : un
    // `>= 2900` seul passerait aussi sur un boot qui traîne une minute.
    check('le boot a tenu le plancher allongé', r.bootMs >= 2900 && r.bootMs < 4200,
          r.bootMs + ' ms (attendu ~3000)');
    await r.page.close();
  }
  await stopSlowFailServer();

  // ── 2. Serveur qui pend : la borne dure libère le boot ────────────────────
  console.log('\n[2] serveur MCP qui accepte puis ne répond jamais');
  await startHangServer();
  {
    const r = await bootAndMeasure(browser, `http://127.0.0.1:${HANG_PORT}/mcp`);
    // Le timeout applicatif de la fixture est à 130 s : sans borne dure, le boot
    // l'attendrait. C'est le scénario qui rend la garde non vacuously verte.
    check('le serveur a bien été sollicité', hangHits > 0, hangHits + ' requête(s)');
    check('le boot ne reste PAS en otage', r.bootMs < 4200,
          r.bootMs + ' ms (timeout applicatif de la carte : 130000 ms)');
    check('aucun verdict ⇒ le chat ne fronce pas', r.worried === false,
          'miaou-worried=' + r.worried);
    await r.page.close();
  }
  await stopHangServer();

  // ── 3. Non-régression : un boot sain n'est pas ralenti ────────────────────
  console.log('\n[3] aucun serveur MCP configuré');
  {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('miaou-mcp-servers', '[]');
      localStorage.setItem('miaou-mcp-seeded', '1');
    });
    await page.goto('file://' + distPath);
    await page.waitForFunction(
      () => document.querySelector('.boot-done') !== null, { timeout: 15000 });
    const m = await page.evaluate(() => ({
      bootMs: Date.now() - _bootReadyAt,
      worried: document.body.classList.contains('miaou-worried'),
    }));
    // Le sursis ne doit pas se payer quand tout va bien : c'est la contrepartie
    // à surveiller, un démarrage nominal qui s'allongerait serait une
    // régression pour tout le monde plutôt qu'un gain pour les cas en panne.
    check('le boot sain reste au plancher nominal', m.bootMs < 2600,
          m.bootMs + ' ms (attendu ~1800)');
    check('le chat ne fronce pas sans panne', m.worried === false,
          'miaou-worried=' + m.worried);
    await page.close();
  }

  await browser.close();

  console.log('\n' + (failures.length
    ? `ÉCHEC — ${failures.length} contrôle(s) rouge(s) :\n  - ` + failures.join('\n  - ')
    : 'OK — tous les contrôles passent'));
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  await stopHangServer();
  console.error('Erreur:', e);
  process.exit(1);
});
