#!/usr/bin/env node
// Vérif e2e — santé du backend API : la pastille de la pilule modèle repasse
// VERTE dès que le backend redevient joignable, sans envoi utilisateur.
//
// Le défaut corrigé : `setConnDot('ok')` n'était appelé que depuis les fins
// d'échange (`onFinal`/`onHalt`, main.js), donc après une panne la pastille
// restait rouge indéfiniment tant qu'on n'envoyait pas de message. Le signal
// disait « le dernier échange a échoué » là où sa forme — une pastille d'état
// permanente — promet « le backend est joignable ».
//
// Montage : un VRAI serveur HTTP local sert /models, qu'on éteint et rallume.
// Rien n'est stubé côté app : la sonde (`probeBackend` → `loadServerModels` →
// `fetchModels`) part réellement sur le réseau local. C'est le point — un stub
// de fetch prouverait que le code appelle quelque chose, pas qu'un backend
// réellement mort puis réellement revenu fait bouger la pastille.
//
// Conditions dont dépendent les assertions (cf. SKILL.md, « une vérif est aussi
// un ensemble de CONDITIONS ») :
//   - `miaou-api-servers` ET `miaou-active-api-server` sont écrits pour pointer
//     sur le faux backend. Écrire `miaou-settings` seul ne suffirait PAS : une
//     carte de serveur enregistrée l'emporte, et l'app irait taper le vrai
//     Ollama pendant que le faux backend attend (piège documenté).
//   - Le compteur `hits` du serveur prouve qu'il a été SOLLICITÉ : un run vert
//     avec un serveur froid serait indiscernable d'une vraie réussite.
//   - Le rouge est POSÉ et vérifié avant de tester le retour au vert : une
//     garde qui nettoie ne se teste que sur un état réellement sale.
//
// Usage : node verify-backend-health.mjs [--headed]
//   Prérequis : `python3 build.py` fait.
import { launchIsolated } from './stub-backend.js';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');
const PORT = 8791;   // hors du 8765 du proxy MCP et du 8799 de archives/verify-res-docs-wiring

const failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); failures.push(label); }
}

// ── Faux backend OpenAI-compatible ───────────────────────────────────────────
// `hits` compte les requêtes RÉELLEMENT reçues : c'est le témoin de
// sollicitation. Sans lui, un scénario où la sonde ne part jamais produirait
// exactement les mêmes assertions vertes.
let hits = 0;
let server = null;

function startBackend() {
  return new Promise((resolve) => {
    hits = 0;
    server = http.createServer((req, res) => {
      // Preflight CORS : la page est chargée en file:// (origine « null »), et
      // `fetchModels` envoie un en-tête Authorization — ce qui rend la requête
      // « non simple » et déclenche un OPTIONS préalable. Sans cette branche le
      // navigateur bloque TOUT avant d'émettre la vraie requête : le serveur
      // paraît injoignable alors qu'il tourne, et la vérif accuse l'app d'un
      // défaut de montage.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
      }
      hits++;
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
        return;
      }
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('{}');
    });
    server.listen(PORT, '127.0.0.1', () => resolve());
  });
}

function stopBackend() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    // closeAllConnections : sans ça, un keep-alive maintient le port ouvert et
    // la « panne » n'en est pas une — la sonde suivante réussirait.
    if (server.closeAllConnections) server.closeAllConnections();
    server.close(() => { server = null; resolve(); });
  });
}

// ── Seed : carte de serveur API pointant sur le faux backend ─────────────────
const initScript = ({ apiUrl }) => {
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srv-fake', name: 'fake', url: apiUrl, key: 'k', model: 'fake-model' },
  ]));
  localStorage.setItem('miaou-active-api-server', 'srv-fake');
  localStorage.setItem('miaou-settings', JSON.stringify({ url: apiUrl, key: 'k', model: 'fake-model' }));
};

const dotState = () => {
  const el = document.getElementById('conn-dot');
  return el ? el.className : '(absent)';
};

await startBackend();

const browser = await launchIsolated({ headless: !headed });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(initScript, { apiUrl: 'http://127.0.0.1:' + PORT + '/v1' });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error] ' + m.text()); });

let exitCode = 0;
try {
  await page.goto('file://' + distPath);
  await page.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });

  // ── 1. État initial : configuré et joignable ───────────────────────────────
  await page.waitForFunction(
    () => document.getElementById('conn-dot') && document.getElementById('conn-dot').className.indexOf('ok') >= 0,
    null, { timeout: 10000 },
  ).catch(() => {});
  const initial = await page.evaluate(dotState);
  check('au démarrage, backend joignable : pastille verte', initial.indexOf('ok') >= 0, initial);
  check('témoin : le faux backend a RÉELLEMENT été sollicité', hits > 0, hits + ' requête(s)');

  // Premise du reste du script : le prédicat voit bien un backend configuré.
  const health0 = await page.evaluate(() => resolveBackendHealth(activeApiConfig(), REQUIRE_API_KEY, null));
  check('prémisse : la config est complète (pas unconfigured)', health0 === 'ok', health0);

  // ── 2. Panne : le backend s'arrête, une sonde le constate ─────────────────
  // C'est l'état SALE qu'exige le test du retour au vert. Sans lui, l'assertion
  // finale vaudrait pour un `ok` qui n'a jamais eu à être rétabli.
  await stopBackend();
  await page.evaluate(() => probeBackend());
  await page.waitForFunction(
    () => document.getElementById('conn-dot').className.indexOf('err') >= 0,
    null, { timeout: 15000 },
  ).catch(() => {});
  const downDot = await page.evaluate(dotState);
  check('backend arrêté : la pastille passe au ROUGE', downDot.indexOf('err') >= 0, downDot);
  const downTitle = await page.evaluate(() => document.getElementById('conn-dot').title);
  check('le titre dit « injoignable », pas « non configurée »',
    downTitle.indexOf('injoignable') >= 0, downTitle);

  // ── 3. Reprise : le backend revient, SANS aucun envoi utilisateur ─────────
  // Le cœur du lot. On ne touche pas au composer : seul le retour de focus
  // (maybeProbeBackend) doit suffire.
  await startBackend();
  const threadBefore = await page.evaluate(() => currentThread.length);
  await page.evaluate(() => maybeProbeBackend());
  await page.waitForFunction(
    () => document.getElementById('conn-dot').className.indexOf('ok') >= 0,
    null, { timeout: 15000 },
  ).catch(() => {});
  const backDot = await page.evaluate(dotState);
  check('backend revenu : la pastille REDEVIENT VERTE sans envoi', backDot.indexOf('ok') >= 0, backDot);
  check('témoin : la reprise a bien sollicité le backend', hits > 0, hits + ' requête(s)');
  const threadAfter = await page.evaluate(() => currentThread.length);
  check('aucun message n\'a été envoyé pour obtenir ce vert',
    threadAfter === threadBefore, threadBefore + ' → ' + threadAfter);

  // ── 4. Le throttle n'empêche pas la reprise d'un backend EN DÉFAUT ────────
  // Un backend sain est throttlé ; un backend down doit être re-sondé sans
  // délai — sinon la pastille resterait rouge deux minutes après réparation.
  await stopBackend();
  await page.evaluate(() => probeBackend());
  await page.waitForFunction(
    () => document.getElementById('conn-dot').className.indexOf('err') >= 0,
    null, { timeout: 15000 },
  ).catch(() => {});
  const due = await page.evaluate(() => backendProbeDue(Date.now()));
  check('un backend en défaut est sondable IMMÉDIATEMENT (pas de throttle)', due === true, String(due));

  // ── 5. Non configuré ≠ injoignable ────────────────────────────────────────
  // Le cas signalé par Julien : URL absente, ou clef absente alors que le build
  // l'exige. Les deux sont rouges, mais mènent à des gestes différents — le
  // titre doit envoyer aux réglages, pas faire attendre un serveur.
  await startBackend();
  await page.evaluate(() => {
    localStorage.setItem('miaou-api-servers', JSON.stringify([
      { id: 'srv-fake', name: 'fake', url: '', key: '', model: '' },
    ]));
  });
  await page.evaluate(() => { syncConfigured(); });
  const unconfDot = await page.evaluate(dotState);
  const unconfTitle = await page.evaluate(() => document.getElementById('conn-dot').title);
  check('sans URL : pastille rouge', unconfDot.indexOf('err') >= 0, unconfDot);
  check('sans URL : le titre envoie aux PARAMÈTRES, pas vers un serveur à attendre',
    unconfTitle.indexOf('configur') >= 0, unconfTitle);

  // Et surtout : on ne sonde PAS un backend non configuré (une clef vide
  // produirait une rafale de 401 lus comme des pannes).
  const hitsBefore = hits;
  await page.evaluate(() => maybeProbeBackend());
  await page.waitForTimeout(500);
  check('non configuré : AUCUNE sonde n\'est émise', hits === hitsBefore,
    hitsBefore + ' → ' + hits);

  // ── 6. Backend DÉJÀ mort au démarrage : rouge sans attendre un focus ──────
  // Scénario distinct du §2, et c'est le point : là-bas la panne survient sur
  // une app déjà chargée (une sonde la constate), ici elle PRÉCÈDE l'ouverture.
  // Le chargement initial de la liste de modèles est alors le premier contact
  // avec le backend, et son verdict doit compter — sinon la pastille reste au
  // vert optimiste (`probe: null`) jusqu'au premier retour de focus.
  // Signalé à l'usage : la condition du §1 était trop PROPRE (backend allumé au
  // démarrage), donc l'assertion y était vraie sans rien prouver de ce cas.
  await stopBackend();
  const page2 = await ctx.newPage();
  await page2.addInitScript(initScript, { apiUrl: 'http://127.0.0.1:' + PORT + '/v1' });
  await page2.goto('file://' + distPath);
  await page2.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  await page2.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });
  await page2.waitForFunction(
    () => document.getElementById('conn-dot').className.indexOf('err') >= 0,
    null, { timeout: 15000 },
  ).catch(() => {});
  const bootDot = await page2.evaluate(dotState);
  check('backend mort AVANT l\'ouverture : pastille rouge sans focus préalable',
    bootDot.indexOf('err') >= 0, bootDot);
  const bootTitle = await page2.evaluate(() => document.getElementById('conn-dot').title);
  check('et le titre dit « injoignable » (le serveur est configuré, il ne répond pas)',
    bootTitle.indexOf('injoignable') >= 0, bootTitle);
  await page2.close();

} catch (e) {
  console.log('  ERREUR  ' + (e && e.message ? e.message : String(e)));
  exitCode = 1;
} finally {
  await browser.close();
  await stopBackend();
}

console.log('');
if (failures.length) {
  console.log('ÉCHECS (' + failures.length + ') :');
  failures.forEach((f) => console.log('  - ' + f));
  exitCode = 1;
} else if (exitCode === 0) {
  console.log('OK — tous les contrôles passent.');
}
process.exit(exitCode);
