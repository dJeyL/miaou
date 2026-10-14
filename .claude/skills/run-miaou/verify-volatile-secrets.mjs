// Secrets volatils (mcp-secrets.js), contre un VRAI proxy de miaou-mcp-servers.
//
// Montage : un proxy de test lancé depuis le dépôt voisin (MIAOU_MCP_REPO), sur
// VERIFY_PROXY_PORT (18765), avec une chaîne de config jetable qui REMPLACE
// celle de l'installation (`--config config.defaults.json --config <tmp>/
// test.json`, jamais le config.json de Julien) : serveur de démonstration
// `secret_demo` activé, valeur attendue propre au script (VALUE, introuvable
// ailleurs dans la page), MIAOU servi depuis dist/. L'état du proxy (cache des
// outils) vit sous le dossier temporaire : premier démarrage = cache vide.
// Le redémarrage vise le pid qui écoute sur le port, jamais un motif.
//
// Scénarios :
//   A. page servie par ce proxy, carte à la même adresse : pilule « 1 mot de
//      passe requis », toast de saisie ; un second onglet voit le même toast ;
//   B. valeur fausse depuis le toast : « incorrect », champ vidé et focalisé,
//      rien gardé en session ; valeur « injoignable » : non vérifié, cause dite ;
//   C. bonne valeur : toast retiré (ici ET dans l'onglet voisin), pilule
//      éteinte, valeur gardée en session, serveur reconnecté (outils du
//      service, absents au premier démarrage, désormais listés) ;
//   D. carte : section « Mots de passe », frappe en cours conservée à travers
//      un re-rendu ;
//   E. redémarrage du proxy : nouvelle instance, valeur RENVOYÉE sans geste,
//      aucun toast ;
//   F. « Oublier » depuis la carte : valeur retirée de la session, service en
//      attente, pas de toast dans cet onglet (geste délibéré) ;
//   G. la valeur n'apparaît ni dans la console, ni dans localStorage, ni dans
//      IndexedDB, ni dans le DOM ;
//   H. hors du cas servi : file:// et 127.0.0.1 contre localhost — aucun appel
//      aux méthodes de l'extension, la carte dit où ouvrir MIAOU ;
//   I. appel d'outil par un modèle stubé (vrai proxy) : sans valeur, ligne
//      d'appel rouge avec « Saisir le mot de passe » (ouvre la carte), texte au
//      modèle qui lui interdit de demander le mot de passe ; avec une valeur
//      acceptée puis un redémarrage du proxy, renvoi puis rejeu sur la même
//      ligne — le modèle reçoit le résultat, aucune trace d'échec.
//
// Usage : node verify-volatile-secrets.mjs [--headed] [--keep]

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, openSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchIsolated } from './stub-backend.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DIST = path.join(ROOT, 'dist');
const MCP_REPO = process.env.MIAOU_MCP_REPO || path.resolve(ROOT, '../miaou-mcp-servers');
const PORT = Number(process.env.VERIFY_PROXY_PORT || 18765);
const headed = process.argv.includes('--headed');
const keep = process.argv.includes('--keep');
const BASE = `http://127.0.0.1:${PORT}`;
const CARD = 'sec';
const KEY = 'Mot de passe de démonstration';
const VALUE = 'Zq7-volatil-' + Math.random().toString(36).slice(2, 8);
const WRONG = 'faux-' + VALUE.slice(-6);
const TOAST = `volatile-secret:${CARD}:${KEY}`;

const failures = [];
let passed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failures.push(label); console.log('  FAIL  ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'miaou-au2-'));
const cfg = path.join(tmp, 'test.json');
const logPath = path.join(tmp, 'proxy.log');
writeFileSync(cfg, JSON.stringify({ miaou_dist: DIST, mcpServers: { secret_demo: { disabled: false, config: { expected: VALUE } } } }));

function listeningPid() {
  try { return execFileSync('lsof', ['-tiTCP:' + PORT, '-sTCP:LISTEN'], { encoding: 'utf-8' }).trim().split('\n')[0] || ''; } catch (e) { return ''; }
}

let proxy = null;
async function startProxy() {
  const out = openSync(logPath, 'a');
  proxy = spawn('uv', ['run', 'mcp_proxy', '--config', 'config.defaults.json', '--config', cfg, '--port', String(PORT)],
    { cwd: MCP_REPO, detached: true, stdio: ['ignore', out, out], env: Object.assign({}, process.env, { VIRTUAL_ENV: '' }) });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE + '/app/version.json')).ok) return true; } catch (e) { /* pas encore */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function stopProxy() {
  const pid = listeningPid();
  if (pid) { try { process.kill(Number(pid), 'SIGTERM'); } catch (e) { /* déjà parti */ } }
  if (proxy) { try { process.kill(-proxy.pid, 'SIGTERM'); } catch (e) { /* déjà parti */ } }
  const deadline = Date.now() + 20000;
  while (listeningPid() && Date.now() < deadline) await new Promise(r => setTimeout(r, 300));
  proxy = null;
}

async function bootWait(page) {
  await page.waitForSelector('#composer-text', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 30000 });
}

async function configure(page, url) {
  await page.evaluate(({ name, url }) => {
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([{ name, url, enabled: true, authorization_token: '', timeout_s: 30, toolAllowlist: [], toolDenylist: [] }]));
  }, { name: CARD, url });
  await page.reload();
  await bootWait(page);
}

// Journal des méthodes de l'extension appelées par la page (jamais les
// paramètres : la valeur n'a rien à faire dans le journal du script non plus).
async function spyRpc(page) {
  await page.evaluate(() => {
    window.__secretCalls = [];
    const real = mcpRpc;
    mcpRpc = function (server, method, params, opts) {
      if (String(method).indexOf('miaou/secrets/') === 0) window.__secretCalls.push(method);
      return real(server, method, params, opts);
    };
  });
}

const toastSel = `.toast[data-key="${TOAST}"]`;
const toastText = (page) => page.evaluate((s) => { const t = document.querySelector(s); return t ? t.querySelector('.toast-text').textContent : null; }, toastSel);

async function submitInToast(page, value) {
  const pw = page.locator(`${toastSel} input.volatile-secret-pw`);
  await pw.fill(value);
  await pw.press('Enter');
}

async function waitConsumer(page, pred, label) {
  try {
    await page.waitForFunction(({ name, pred }) => {
      const e = volatileSecretsEntry(name);
      const c = e && e.status && e.status.secrets[0] && e.status.secrets[0].consumers[0];
      return !!c && new Function('c', 'return ' + pred)(c) && !volatileSecretBusy(name, e.status.secrets[0].key);
    }, { name: CARD, pred }, { timeout: 30000 });
    return true;
  } catch (e) { console.log('  (attente expirée : ' + label + ')'); return false; }
}

const consoleLines = [];
let browser;
try {
  console.log('Montage : ' + tmp + '  (valeur attendue propre à ce run)');
  const up = await startProxy();
  check('montage : le proxy de test répond et sert MIAOU sous /app/', up);
  if (!up) throw new Error('proxy de test injoignable, journal : ' + logPath);

  browser = await launchIsolated({ headless: !headed });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', m => consoleLines.push(m.text()));
  page.on('pageerror', e => consoleLines.push(String(e)));

  // ── A ─────────────────────────────────────────────────────────────────────
  console.log('\nA. page servie, carte à la même adresse');
  await page.goto(BASE + '/app/');
  await bootWait(page);
  await configure(page, BASE + '/mcp');
  await page.waitForSelector(toastSel, { timeout: 30000 });
  check('A : extension déclarée par le serveur', await page.evaluate((n) => getMcpStatus(n).secretsDeclared === true, CARD));
  check('A : premier démarrage, cache vide : aucun outil du service', await page.evaluate(() => !Object.keys(_remoteTools).some(k => _remoteTools[k].some(t => t.name.indexOf('secret_demo__') >= 0))));
  check('A : pilule « 1 mot de passe requis »', await page.evaluate(() => !document.getElementById('auth-pending').hidden && document.getElementById('auth-pending-label').textContent === '1 mot de passe requis'));
  const tA = await toastText(page);
  check('A : toast de saisie, texte « requis »', tA === `Mot de passe « ${KEY} » requis : 1 service en attente.`, tA);
  check('A : formulaire du toast : identifiant caché = clef, champ current-password', await page.evaluate((s) => {
    const f = document.querySelector(s + ' form.volatile-secret-form');
    const u = f && f.querySelector('input.volatile-secret-user');
    const p = f && f.querySelector('input.volatile-secret-pw');
    return !!(u && p && u.value === 'Mot de passe de démonstration' && u.autocomplete === 'username' && u.tabIndex === -1
      && p.type === 'password' && p.autocomplete === 'current-password' && u.getClientRects().length > 0 && u.getBoundingClientRect().width <= 1);
  }, toastSel));
  check('A : le toast ne vole pas le focus', await page.evaluate(() => !document.activeElement || !document.activeElement.closest('#toasts')));
  const page2 = await ctx.newPage();
  page2.on('console', m => consoleLines.push(m.text()));
  await page2.goto(BASE + '/app/');
  await bootWait(page2);
  await page2.waitForSelector(toastSel, { timeout: 30000 });
  check('A : le second onglet affiche le même toast', !!(await toastText(page2)));
  await spyRpc(page);

  // ── B ─────────────────────────────────────────────────────────────────────
  console.log('\nB. valeur fausse, puis annuaire en panne');
  await submitInToast(page, WRONG);
  await waitConsumer(page, "c.verdict === 'rejected'", 'refus');
  await page.waitForFunction((s) => { const t = document.querySelector(s); return t && /incorrect/.test(t.textContent); }, toastSel, { timeout: 10000 }).catch(() => {});
  check('B : refus dit « incorrect »', /incorrect/.test(await toastText(page) || ''), await toastText(page));
  check('B : champ vidé et focalisé dans le toast ré-émis', await page.evaluate((s) => {
    const p = document.querySelector(s + ' input.volatile-secret-pw');
    return !!p && p.value === '' && document.activeElement === p;
  }, toastSel));
  check('B : rien gardé en session', await page.evaluate(() => Object.keys(sessionStorage).every(k => k.indexOf('miaou-volatile-secret:') !== 0)));
  await submitInToast(page, 'injoignable');
  await waitConsumer(page, "c.verdict === 'indeterminate'", 'indéterminé');
  await page.waitForFunction((s) => { const t = document.querySelector(s); return t && /non vérifié/.test(t.textContent); }, toastSel, { timeout: 10000 }).catch(() => {});
  const tB = await toastText(page) || '';
  check('B : panne : « non vérifié », jamais « incorrect », cause dite', /non vérifié/.test(tB) && !/incorrect/.test(tB) && /Cause/.test(tB), tB);

  // ── C ─────────────────────────────────────────────────────────────────────
  console.log('\nC. bonne valeur');
  await submitInToast(page, VALUE);
  await waitConsumer(page, "c.verdict === 'accepted' && c.state === 'ready'", 'acceptation');
  await page.waitForFunction((s) => !document.querySelector(s), toastSel, { timeout: 10000 }).catch(() => {});
  check('C : toast retiré', !(await page.$(toastSel)));
  check('C : pilule éteinte', await page.evaluate(() => document.getElementById('auth-pending').hidden));
  check('C : valeur gardée en session, acceptée par l\'instance courante', await page.evaluate((v) => {
    const k = Object.keys(sessionStorage).find(x => x.indexOf('miaou-volatile-secret:') === 0);
    const kept = k && JSON.parse(sessionStorage.getItem(k));
    return !!kept && kept.value === v && kept.acceptedInstance === volatileSecretsEntry('sec').status.instance;
  }, VALUE));
  const toolsC = await page.waitForFunction(() => Object.keys(_remoteTools).some(k => (_remoteTools[k] || []).some(t => t.name.indexOf('secret_demo__') >= 0)), null, { timeout: 20000 }).then(() => true, () => false);
  check('C : serveur reconnecté, outils du service désormais listés', toolsC);
  const gone2 = await page2.waitForFunction((s) => !document.querySelector(s), toastSel, { timeout: 15000 }).then(() => true, () => false);
  check('C : toast retiré aussi dans l\'onglet voisin (signal sans valeur)', gone2);
  check('C : l\'onglet voisin n\'a rien en session (garde propre à l\'onglet)', await page2.evaluate(() => Object.keys(sessionStorage).every(k => k.indexOf('miaou-volatile-secret:') !== 0)));

  // ── D ─────────────────────────────────────────────────────────────────────
  console.log('\nD. carte du serveur');
  await page.evaluate(() => openMcpServers());
  await page.waitForSelector('#mcp-list .mcp-secret-row', { timeout: 10000 });
  const rowD = await page.evaluate(() => document.querySelector('#mcp-list .mcp-secret-row').textContent);
  check('D : rangée de la clef, état « en service », service nommé, « Oublier »', rowD.includes(KEY) && rowD.includes('en service') && rowD.includes('secret_demo') && rowD.includes('Oublier'), rowD);
  await page.locator('#mcp-list input.volatile-secret-pw').fill('abc');
  await page.locator('#mcp-list input.volatile-secret-pw').focus();
  await page.evaluate(() => renderMcpServers());
  check('D : frappe conservée à travers un re-rendu, focus compris', await page.evaluate(() => {
    const p = document.querySelector('#mcp-list input.volatile-secret-pw');
    return !!p && p.value === 'abc' && document.activeElement === p;
  }));
  await page.locator('#mcp-list input.volatile-secret-pw').fill('');
  check('D : pilule de la carte sans mot de passe requis', await page.evaluate(() => !/mot de passe/.test(document.querySelector('#mcp-list .mcp-status').textContent)));

  // ── E ─────────────────────────────────────────────────────────────────────
  console.log('\nE. redémarrage du proxy');
  const instBefore = await page.evaluate(() => volatileSecretsEntry('sec').status.instance);
  await stopProxy();
  check('E : proxy arrêté', !listeningPid());
  check('E : redémarré', await startProxy());
  await page.evaluate((s) => {
    window.__secretCalls = [];
    window.__toastSeen = false;
    new MutationObserver(() => { if (document.querySelector(s)) window.__toastSeen = true; })
      .observe(document.getElementById('toasts'), { childList: true, subtree: true });
  }, toastSel);
  // Ce que fait le retour de focus : reconnexion du serveur, puis lecture.
  await page.evaluate(() => connectMcpServer(getMcpServer('sec')));
  const resent = await page.waitForFunction((b) => {
    const e = volatileSecretsEntry('sec');
    const c = e && e.status && e.status.secrets[0] && e.status.secrets[0].consumers[0];
    return !!c && e.status.instance !== b && c.state === 'ready' && c.verdict === 'accepted';
  }, instBefore, { timeout: 30000 }).then(() => true, () => false);
  check('E : nouvelle instance, valeur renvoyée sans geste, service prêt', resent);
  check('E : un seul dépôt', await page.evaluate(() => window.__secretCalls.filter(m => m === 'miaou/secrets/submit').length === 1), await page.evaluate(() => window.__secretCalls));
  check('E : aucun toast de saisie, à aucun moment (pas d\'annonce avant le renvoi)', await page.evaluate(() => !window.__toastSeen));

  // ── F ─────────────────────────────────────────────────────────────────────
  console.log('\nF. Oublier');
  await page.evaluate(() => openMcpServers());
  await page.waitForSelector('#mcp-list .volatile-secret-forget', { timeout: 10000 });
  await page.locator('#mcp-list .volatile-secret-forget').click();
  await waitConsumer(page, "c.state === 'pending' && c.verdict === null", 'oubli');
  check('F : valeur retirée de la session', await page.evaluate(() => Object.keys(sessionStorage).every(k => k.indexOf('miaou-volatile-secret:') !== 0)));
  check('F : pilule « 1 mot de passe requis »', await page.evaluate(() => document.getElementById('auth-pending-label').textContent === '1 mot de passe requis'));
  await page.waitForTimeout(500);
  check('F : pas de toast dans l\'onglet qui a oublié', !(await page.$(toastSel)));

  // ── G ─────────────────────────────────────────────────────────────────────
  console.log('\nG. la valeur ne fuit pas');
  const dumps = await page.evaluate(async () => {
    const ls = JSON.stringify(Object.assign({}, localStorage));
    let idb = '';
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((res, rej) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      for (const store of db.objectStoreNames) {
        const all = await new Promise((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
        try { idb += JSON.stringify(all); } catch (e) { idb += String(all.length); }
      }
      db.close();
    }
    return { ls, idb, dom: document.documentElement.outerHTML };
  });
  check('G : absente de localStorage', !dumps.ls.includes(VALUE));
  check('G : absente d\'IndexedDB', !dumps.idb.includes(VALUE));
  check('G : absente du DOM sérialisé', !dumps.dom.includes(VALUE));
  check('G : absente de la console des deux onglets', !consoleLines.some(l => l.includes(VALUE)));
  check('G : absente du journal du proxy', !readFileSync(logPath, 'utf-8').includes(VALUE));

  // ── H ─────────────────────────────────────────────────────────────────────
  console.log('\nH. hors du cas servi');
  const pf = await ctx.newPage();
  await pf.goto(pathToFileURL(path.join(DIST, 'miaou.html')).href);
  await bootWait(pf);
  await configure(pf, BASE + '/mcp');
  await spyRpc(pf);
  await pf.waitForFunction(() => { const s = getMcpStatus('sec'); return s && s.state === 'ok'; }, null, { timeout: 30000 });
  await pf.evaluate(() => readVolatileSecretsStatus(getMcpServer('sec')));
  await pf.evaluate(() => openMcpServers());
  await pf.waitForSelector('#mcp-list .mcp-secrets', { timeout: 10000 });
  const fileText = await pf.evaluate(() => document.querySelector('#mcp-list .mcp-secrets').textContent);
  check('H : file:// : la carte dit d\'ouvrir MIAOU à l\'adresse du proxy', fileText.includes(BASE + '/app/'), fileText);
  check('H : file:// : aucun appel aux méthodes de l\'extension', await pf.evaluate(() => window.__secretCalls.length === 0));
  check('H : file:// : pilule sans mot de passe compté', await pf.evaluate(() => !/mot de passe/.test(document.getElementById('auth-pending-label').textContent)));
  check('H : file:// : aucun toast de saisie', !(await pf.$(toastSel)));
  const pl = await ctx.newPage();
  await pl.goto(`http://localhost:${PORT}/app/`);
  await bootWait(pl);
  await configure(pl, BASE + '/mcp');
  await pl.waitForFunction(() => { const s = getMcpStatus('sec'); return s && s.state === 'ok'; }, null, { timeout: 30000 });
  await pl.evaluate(() => readVolatileSecretsStatus(getMcpServer('sec')));
  await pl.evaluate(() => openMcpServers());
  await pl.waitForSelector('#mcp-list .mcp-secrets', { timeout: 10000 });
  const lhText = await pl.evaluate(() => document.querySelector('#mcp-list .mcp-secrets').textContent);
  check('H : localhost contre carte 127.0.0.1 : deux adresses, le dire', lhText.includes('127.0.0.1 et localhost') && lhText.includes(BASE + '/app/'), lhText);

  // ── I ─────────────────────────────────────────────────────────────────────
  // Navigateur à part, modèle stubé par page.route (serve: false) : le tour
  // sans résultat d'outil appelle `whoami`, le suivant conclut. Une
  // conversation neuve par envoi (limite du montage, cf. SKILL.md).
  console.log('\nI. appel d\'outil refusé, puis rejoué');
  await page.close(); await page2.close(); await pf.close(); await pl.close();
  const bI = await launchIsolated({ headless: !headed }, { serve: false });
  try {
    const pi = await bI.newPage();
    pi.on('console', m => consoleLines.push(m.text()));
    const toolMsgs = [];
    let toolName = '';
    await pi.route('**/chat/completions', async (route) => {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* illisible */ }
      const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
      if (!body.stream) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' } }] }) });
        return;
      }
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      const tool = msgs.find(m => m && m.role === 'tool');
      let out;
      if (!tool) {
        out = sse({ choices: [{ delta: { role: 'assistant', content: 'Je regarde.' } }] })
          + sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: toolName, arguments: '{}' } }] } }] })
          + sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n';
      } else {
        toolMsgs.push(typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content));
        out = sse({ choices: [{ delta: { role: 'assistant', content: 'Voilà.' } }] })
          + sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
      }
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: out });
    });
    await pi.route('**/models', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'stub-model' }] }) }));
    await pi.goto(BASE + '/app/');
    await bootWait(pi);
    await configure(pi, BASE + '/mcp');
    await pi.waitForFunction(() => { const s = getMcpStatus('sec'); return s && s.state === 'ok'; }, null, { timeout: 30000 });
    toolName = await pi.evaluate(() => (remoteToolDefs().map(t => t.name).find(n => /secret_demo__whoami$/.test(n))) || '');
    check('I : prémisse : l\'outil du service est au registre (servi du cache pendant l\'attente)', !!toolName, toolName);
    await spyRpc(pi);
    async function send(prompt) {
      await pi.evaluate(() => newConversation());
      await pi.waitForTimeout(300);
      await pi.fill('#composer-text', prompt);
      await pi.click('#send-btn');
      await pi.waitForFunction(() => document.querySelector('#thread .tool-ack') !== null, null, { timeout: 30000 });
      await pi.waitForFunction(() => typeof sending !== 'undefined' && sending === false, null, { timeout: 30000 });
      await pi.waitForTimeout(400);
    }
    const ackI = () => pi.evaluate(() => {
      const n = document.querySelector('#thread .tool-ack.ack-mcp_call') || document.querySelector('#thread .tool-ack');
      return n ? { error: n.classList.contains('ack-error'), btn: !!n.querySelector('.ack-secret-btn'), text: n.textContent } : null;
    });
    await send('Qui suis-je ?');
    const a1 = await ackI();
    check('I : sans valeur : ligne d\'appel rouge, « Saisir le mot de passe »', !!a1 && a1.error && a1.btn, a1);
    const t1 = toolMsgs[toolMsgs.length - 1] || '';
    check('I : texte au modèle : seul l\'utilisateur, jamais dans la conversation', /seul l'utilisateur/.test(t1) && /JAMAIS ce mot de passe dans la conversation/.test(t1), t1.slice(0, 200));
    await pi.locator('#thread .ack-secret-btn').click();
    const opened = await pi.waitForFunction(() => {
      const d = document.getElementById('mcp-drawer');
      return !!d && d.classList.contains('show') && !!document.querySelector('#mcp-list .mcp-secret-row form');
    }, null, { timeout: 10000 }).then(() => true, () => false);
    check('I : le bouton ouvre la carte, formulaire présent', opened);
    await pi.locator('#mcp-list .mcp-secret-row input.volatile-secret-pw').fill(VALUE);
    await pi.locator('#mcp-list .mcp-secret-row input.volatile-secret-pw').press('Enter');
    await waitConsumer(pi, "c.verdict === 'accepted' && c.state === 'ready'", 'acceptation depuis la carte');
    check('I : acceptée depuis la carte, gardée en session', await pi.evaluate((v) => Object.keys(sessionStorage).some(k => k.indexOf('miaou-volatile-secret:') === 0 && JSON.parse(sessionStorage.getItem(k)).value === v), VALUE));
    await pi.evaluate(() => closeMcpServers && closeMcpServers());
    await stopProxy();
    check('I : proxy redémarré', await startProxy());
    await pi.evaluate(() => { window.__secretCalls = []; });
    // Aucune relecture entre-temps : c'est l'appel d'outil qui découvre l'oubli.
    await send('Et maintenant ?');
    const a2 = await ackI();
    check('I : après redémarrage : appel réussi sur la même ligne, sans trace d\'échec', !!a2 && !a2.error && !a2.btn, a2);
    check('I : une seule ligne d\'appel', await pi.evaluate(() => document.querySelectorAll('#thread .tool-ack.ack-mcp_call').length === 1));
    const t2 = toolMsgs[toolMsgs.length - 1] || '';
    check('I : le modèle reçoit le résultat de l\'outil, rien du refus', !/SECRET_REQUIRED|mot de passe/.test(t2) && t2.length > 0, t2.slice(0, 200));
    const calls = await pi.evaluate(() => window.__secretCalls);
    check('I : un seul dépôt (le renvoi), pas de reconnexion requise', calls.filter(m => m === 'miaou/secrets/submit').length === 1, calls);
    const idbI = await pi.evaluate(async () => {
      let idb = '';
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((res, rej) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        for (const store of db.objectStoreNames) {
          const all = await new Promise((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
          try { idb += JSON.stringify(all); } catch (e) { idb += String(all.length); }
        }
        db.close();
      }
      return idb + JSON.stringify(Object.assign({}, localStorage));
    });
    check('I : la valeur absente des conversations persistées (IndexedDB, localStorage)', !idbI.includes(VALUE));
  } finally {
    await bI.close().catch(() => {});
  }

  check('aucune erreur de page', !consoleLines.some(l => /TypeError|ReferenceError|SyntaxError/.test(l)), consoleLines.filter(l => /Error/.test(l)));
  check('la valeur absente de la console, de bout en bout', !consoleLines.some(l => l.includes(VALUE)));
} catch (e) {
  failures.push('exception : ' + (e && e.message));
  console.log('EXCEPTION ' + (e && e.stack));
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopProxy();
  if (!keep) { try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tant pis */ } }
  else console.log('Dossier gardé : ' + tmp);
}

console.log(`\n${passed} PASS, ${failures.length} FAIL`);
process.exit(failures.length ? 1 : 0);
