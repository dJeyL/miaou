#!/usr/bin/env node
// Campagne AB-5 — signalement d'une autorisation MCP requise AVANT tout échec.
//
// Ce que QuickJS couvre déjà, et que ce script ne refait donc pas : les
// prédicats purs (`unauthorizedUpstreamsFromList`, `composeAuthorizationUrl`,
// `mcpStatusPill`, `resolveAuthorizationPending`), testés dans les deux sens.
// Ce qu'il ne peut PAS couvrir, et qui est l'objet d'ici : que le `_meta` d'un
// `tools/list` réel traverse `connectMcpServer` sans rien casser, que la
// pastille et la carte se peignent, que le bouton porte l'URL composée, et que
// le retour de focus efface l'état sans intervention.
//
// MONTAGE : entièrement stubé, aucun proxy lancé, aucun port ouvert. Le point de
// contact avec le proxy est le `_meta` de `tools/list`, que le stub sert
// littéralement dans la forme du contrat publié par miaou-mcp-servers (AB-4) —
// le reproduire ici, c'est reproduire le contrat.
//
// Le stub sert le handshake complet et n'intercepte rien d'autre : remplacer
// `mcpRpc` en bloc suspendrait la connexion elle-même, les outils ne seraient
// jamais enregistrés, et rien de ce qu'on mesure ne pourrait se produire
// (piège documenté dans SKILL.md).
//
// Usage : node verify-authorization-pending.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-authorization-pending');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};
const shot = async (page, name, opts) => {
  await page.screenshot(Object.assign({ path: path.join(outDir, name + '.png') }, opts || {}));
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForFunction(() => typeof connectMcpServer === 'function', { timeout: 10000 });
// L'écran de démarrage (logotype) recouvre l'application le temps de son
// animation. Les mesures DOM sont justes avant sa disparition — les noeuds
// existent — mais toute capture prise à ce moment ne montre que le logo. Payé
// une fois : trois captures de topbar vides et un clip accusé à tort.
await page.waitForFunction(() => {
  const o = document.getElementById('boot-overlay');
  // `.boot-done` est posé par init() : c'est le signal de l'application, pas
  // une durée devinée. Le délai qui suit couvre la transition d'opacité.
  return !o || o.classList.contains('boot-done') || getComputedStyle(o).opacity === '0';
}, { timeout: 10000 });
await page.waitForTimeout(900);

// ── Stub MCP ────────────────────────────────────────────────────────────────
// `window.__meta` pilote ce que `tools/list` renvoie : c'est la seule variable
// du scénario, et la changer puis reconnecter reproduit exactement ce qui se
// passe quand une autorisation est accordée côté proxy.
await page.evaluate(() => {
  // Thème sombre EXPLICITE : le défaut suit l'OS, donc les captures varieraient
  // d'une machine à l'autre. Elles servent aussi d'illustration.
  selectTheme('dark');
  localStorage.removeItem('miaou-api-servers');
  localStorage.removeItem('miaou-active-api-server');

  window.__meta = {
    'miaou/unauthorized_upstreams': [
      { name: 'jira', authorize_path: '/authorize/jira' },
    ],
  };
  window.__listCalls = 0;

  // Le stub DISCRIMINE par serveur. Servir le même _meta à tout le monde ferait
  // du « serveur sain » un second serveur dégradé, et le témoin qui doit prouver
  // que la carte verte reste verte prouverait le contraire de ce qu'il annonce.
  mcpRpc = async function (server, method) {
    if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: {} };
    if (method === 'notifications/initialized') return {};
    if (method === 'tools/list') {
      if (server && server.name === 'miaou-proxy') window.__listCalls++;
      if (server && server.name !== 'miaou-proxy') {
        return { tools: [{ name: 'ping', description: 'Répond', inputSchema: { type: 'object', properties: {} } }] };
      }
      const res = {
        tools: [
          { name: 'bench_ping', description: 'Renvoie sa charge utile', inputSchema: { type: 'object', properties: {} } },
          { name: 'jira_search', description: 'Cherche un ticket', inputSchema: { type: 'object', properties: {} } },
          { name: 'jira_create', description: 'Crée un ticket', inputSchema: { type: 'object', properties: {} } },
        ],
      };
      // Posé seulement s'il y a quelque chose à signaler : le contrat dit
      // « clé absente », jamais tableau vide, et le stub doit être fidèle
      // là-dessus sous peine de rendre le cas sain intestable.
      if (window.__meta) res._meta = window.__meta;
      return res;
    }
    return {};
  };

  // Deux serveurs : un proxy qui attend, un serveur sain. Sans le second, on ne
  // saurait pas si la carte dégradée est une carte dégradée ou simplement la
  // seule carte peinte.
  saveMcpServers([
    { name: 'miaou-proxy', url: 'http://127.0.0.1:8765/mcp', enabled: true },
    { name: 'bench-local', url: 'http://127.0.0.1:8766/mcp', enabled: true },
  ]);
});

// ── 1. Connexion : le _meta traverse ────────────────────────────────────────
const afterConnect = await page.evaluate(async () => {
  for (const s of loadMcpServers()) await connectMcpServer(s);
  const st = getMcpStatus('miaou-proxy');
  return {
    state: st && st.state,
    count: st && st.count,
    pending: st && st.unauthorizedUpstreams,
    tools: remoteToolDefs().map((t) => t.name),
  };
});

check('prémisse : les outils sont enregistrés malgré le _meta',
  afterConnect.tools.indexOf('miaou-proxy__jira_search') >= 0);
check('la connexion RÉUSSIT — une surface facultative ne dégrade pas le serveur',
  afterConnect.state === 'ok');
check('le compte d\'outils reste exact (les outils non autorisés SONT listés)',
  afterConnect.count === 3);
check('l\'upstream en attente est porté par _remoteStatus',
  !!afterConnect.pending && afterConnect.pending.length === 1
    && afterConnect.pending[0].name === 'jira'
    && afterConnect.pending[0].authorizePath === '/authorize/jira');

// ── 2. Pastille de topbar ───────────────────────────────────────────────────
await page.evaluate(() => { syncAuthorizationPending(); });
await page.waitForTimeout(200);

const pill = await page.evaluate(() => {
  const el = document.getElementById('auth-pending');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    hidden: el.hidden,
    label: (document.getElementById('auth-pending-label') || {}).textContent || '',
    color: cs.color,
    // Mesuré, pas déduit : une pastille présente dans le DOM mais à zéro pixel
    // passerait toutes les assertions textuelles.
    box: el.getBoundingClientRect().width,
  };
});
check('la pastille est VISIBLE sans qu\'aucun message n\'ait été envoyé',
  !!pill && pill.hidden === false && pill.box > 0);
check('son libellé compte des SERVEURS, pas des upstreams',
  !!pill && pill.label === '1 serveur à autoriser');

// Clip MESURÉ sur le noeud, jamais des coordonnées devinées : la topbar bouge
// avec la largeur de fenêtre et un clip en dur cadre du vide sans rien casser.
const topbarBox = await page.evaluate(() => {
  const r = document.querySelector('.topbar-right').getBoundingClientRect();
  return { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 12),
    width: r.width + 48, height: r.height + 24 };
});
// Capturée à deviceScaleFactor élevé : un clip de 375x56 px est illisible dans
// un support de communication, et réagrandir une image basse résolution après
// coup donne un rendu flou. C'est la seule capture zoomée du lot.
await page.evaluate(() => { document.body.style.zoom = '2'; });
await page.waitForTimeout(200);
const zoomed = await page.evaluate(() => {
  const r = document.querySelector('.topbar-right').getBoundingClientRect();
  return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 14),
    width: r.width + 40, height: r.height + 28 };
});
await shot(page, 'ab5-1-topbar-pastille', { clip: zoomed });
await page.evaluate(() => { document.body.style.zoom = ''; });
await page.waitForTimeout(200);

// ── 3. Le clic ouvre le drawer MCP ──────────────────────────────────────────
await page.click('#auth-pending');
await page.waitForTimeout(400);
const drawerOpen = await page.evaluate(() =>
  document.getElementById('mcp-drawer').classList.contains('show'));
check('le clic ouvre le drawer des serveurs MCP', drawerOpen);

// ── 4. Carte dégradée ───────────────────────────────────────────────────────
const cards = await page.evaluate(() => {
  const out = [];
  for (const card of document.querySelectorAll('#mcp-list .mcp-card')) {
    const name = (card.querySelector('.cfg-view-name') || {}).textContent || '';
    const st = card.querySelector('.mcp-status');
    const rows = Array.from(card.querySelectorAll('.mcp-upstream-row')).map((r) => ({
      name: (r.querySelector('.mcp-upstream-name') || {}).textContent || '',
      hasButton: !!r.querySelector('.mcp-authorize-btn'),
    }));
    out.push({
      name: name,
      statusText: st ? st.textContent : '',
      statusClass: st ? st.className : '',
      statusColor: st ? getComputedStyle(st).color : '',
      rows: rows,
    });
  }
  return out;
});

const degraded = cards.find((c) => c.name === 'miaou-proxy');
const healthy = cards.find((c) => c.name === 'bench-local');

check('la carte du proxy n\'est ni « ok » ni « injoignable »',
  !!degraded && degraded.statusClass.indexOf('pending') >= 0
    && degraded.statusClass.indexOf('err') < 0);
// « service » sur la carte, « serveur » sur la pastille : les deux comptes ne
// portent pas sur la même chose (upstreams d'une carte vs cartes à ouvrir), et
// le même mot aux deux endroits désignerait deux niveaux à quelques pixels l'un
// de l'autre. Cette paire d'assertions est ce qui empêche l'un de dériver vers
// l'autre.
check('sa pill compte des SERVICES (les upstreams de cette carte)',
  !!degraded && degraded.statusText === '● Connecté — 3 outils, 1 service à autoriser');
check('une ligne par upstream, avec son bouton',
  !!degraded && degraded.rows.length === 1
    && degraded.rows[0].name === 'jira' && degraded.rows[0].hasButton === true);
check('témoin : le serveur sain reste vert et sans ligne',
  !!healthy && healthy.statusClass.indexOf('ok') >= 0 && healthy.rows.length === 0);
check('les deux teintes diffèrent réellement (mesuré, pas déduit)',
  !!degraded && !!healthy && degraded.statusColor !== healthy.statusColor);

await shot(page, 'ab5-2-carte-degradee', { fullPage: false });
// Le drawer recouvre la topbar : sans cette capture, aucune ne montre la
// pastille ET la carte dans le même état d'application.
await page.evaluate(() => closeMcpServers());
await page.waitForTimeout(350);
await shot(page, 'ab5-2b-pastille-en-situation', { fullPage: false });
await page.evaluate(() => openMcpServers());
await page.waitForTimeout(350);

// ── 5. L'URL composée ───────────────────────────────────────────────────────
// Le bouton ouvre un onglet : on n'y clique pas (rien à y voir, et un
// window.open en headless brouille la suite). On vérifie ce qu'il porte.
const composed = await page.evaluate(() => {
  const srv = loadMcpServers().find((s) => s.name === 'miaou-proxy');
  const st = getMcpStatus('miaou-proxy');
  return composeAuthorizationUrl(srv.url, st.unauthorizedUpstreams[0].authorizePath);
});
check('l\'URL est composée sur l\'origine du serveur CONFIGURÉ, sans son /mcp',
  composed === 'http://127.0.0.1:8765/authorize/jira');

// Le cas qui ne se voit que là : un hôte non-loopback. Le proxy ne connaît que
// son loopback d'écoute, donc une composition qui prendrait l'origine du proxy
// au lieu de celle de la config passerait inaperçue en montage 127.0.0.1.
const composedRemote = await page.evaluate(() =>
  composeAuthorizationUrl('https://proxy.home.djeyl.net/mcp', '/authorize/jira'));
check('derrière un reverse proxy, l\'origine reste celle que l\'utilisateur a saisie',
  composedRemote === 'https://proxy.home.djeyl.net/authorize/jira');

// ── 6. Plusieurs upstreams ──────────────────────────────────────────────────
const multi = await page.evaluate(async () => {
  window.__meta = {
    'miaou/unauthorized_upstreams': [
      { name: 'jira', authorize_path: '/authorize/jira' },
      { name: 'confluence', authorize_path: '/authorize/confluence' },
    ],
  };
  await connectMcpServer(loadMcpServers()[0]);
  renderMcpServers();
  const card = Array.from(document.querySelectorAll('#mcp-list .mcp-card'))
    .find((c) => (c.querySelector('.cfg-view-name') || {}).textContent === 'miaou-proxy');
  return {
    rows: card.querySelectorAll('.mcp-upstream-row').length,
    status: card.querySelector('.mcp-status').textContent,
    pillLabel: (document.getElementById('auth-pending-label') || {}).textContent,
  };
});
check('deux upstreams → deux lignes sous la MÊME carte', multi.rows === 2);
check('la pill de carte compte les SERVICES',
  multi.status === '● Connecté — 3 outils, 2 services à autoriser');
check('...tandis que la pastille de topbar compte toujours des SERVEURS',
  multi.pillLabel === '1 serveur à autoriser');

await shot(page, 'ab5-3-plusieurs-upstreams', { fullPage: false });

// ── 7. Retour de focus : l'état se répare seul ──────────────────────────────
// Le scénario réel : l'utilisateur autorise dans l'autre onglet (donc le proxy
// cesse de publier le _meta), puis revient. Rien ne prévient MIAOU — c'est le
// retour de focus qui déclenche la revérification.
await page.evaluate(() => { window.__meta = null; });
const listsBefore = await page.evaluate(() => window.__listCalls);

await page.evaluate(() => {
  // `visibilitychange` ne se déclenche pas tout seul en headless : on rejoue
  // exactement ce que le listener de main.js appelle, pour vérifier la CHAÎNE
  // (revérification → reconnexion → rendu → pastille), pas l'événement du
  // navigateur, qui n'est pas de notre ressort.
  return recheckPendingAuthorizations();
});
await page.waitForTimeout(600);

const afterFocus = await page.evaluate(() => {
  const st = getMcpStatus('miaou-proxy');
  const el = document.getElementById('auth-pending');
  const card = Array.from(document.querySelectorAll('#mcp-list .mcp-card'))
    .find((c) => (c.querySelector('.cfg-view-name') || {}).textContent === 'miaou-proxy');
  return {
    lists: window.__listCalls,
    pending: st && st.unauthorizedUpstreams,
    pillHidden: el.hidden,
    status: card.querySelector('.mcp-status').textContent,
    rows: card.querySelectorAll('.mcp-upstream-row').length,
  };
});
check('la revérification a bien reconnecté (le stub a été resollicité)',
  afterFocus.lists > listsBefore);
check('l\'état d\'attente a disparu', afterFocus.pending.length === 0);
check('la pastille de topbar se masque d\'elle-même', afterFocus.pillHidden === true);
check('la carte repasse à l\'état sain, sans ligne de service',
  afterFocus.status === '● Connecté — 3 outils' && afterFocus.rows === 0);

await shot(page, 'ab5-4-apres-autorisation', { fullPage: false });

// ── 8. Le cas sain ne coûte rien ────────────────────────────────────────────
// Prémisse inverse de tout ce qui précède : sans _meta, RIEN ne doit apparaître.
// Sans ce cas, les assertions ci-dessus passeraient aussi si la pastille était
// simplement toujours masquée.
const noPendingCalls = await page.evaluate(async () => {
  const before = window.__listCalls;
  await recheckPendingAuthorizations();
  return window.__listCalls - before;
});
check('sans serveur en attente, la revérification ne reconnecte RIEN',
  noPendingCalls === 0);

// ── 9. Robustesse : un _meta hostile ne casse pas la connexion ──────────────
const hostile = await page.evaluate(async () => {
  const cases_out = [];
  const cases = [
    { label: 'meta non-objet', meta: 'nope' },
    { label: 'clé de mauvais type', meta: { 'miaou/unauthorized_upstreams': 'x' } },
    { label: 'entrées incomplètes', meta: { 'miaou/unauthorized_upstreams': [{}, { name: '' }, null] } },
    { label: 'chemin protocol-relative', meta: { 'miaou/unauthorized_upstreams': [{ name: 'evil', authorize_path: '//evil.test/x' }] } },
  ];
  for (const c of cases) {
    window.__meta = c.meta;
    const ok = await connectMcpServer(loadMcpServers()[0]);
    const st = getMcpStatus('miaou-proxy');
    cases_out.push({ label: c.label, ok: ok, state: st.state, count: st.count,
      pending: (st.unauthorizedUpstreams || []).length });
  }
  renderMcpServers();
  const card = Array.from(document.querySelectorAll('#mcp-list .mcp-card'))
    .find((c) => (c.querySelector('.cfg-view-name') || {}).textContent === 'miaou-proxy');
  // Objet et non propriétés posées sur le tableau : celles-ci survivraient en
  // JS mais pas à la sérialisation de page.evaluate, qui rend un tableau nu.
  return {
    cases: cases_out,
    buttonForEvilPath: !!card.querySelector('.mcp-authorize-btn'),
    rowForEvilPath: card.querySelectorAll('.mcp-upstream-row').length,
  };
});
for (const c of hostile.cases) {
  check('_meta hostile (' + c.label + ') : le serveur reste connecté avec ses 3 outils',
    c.ok === true && c.state === 'ok' && c.count === 3);
}
check('un chemin protocol-relative garde sa LIGNE mais perd son bouton',
  hostile.rowForEvilPath === 1 && hostile.buttonForEvilPath === false);

await shot(page, 'ab5-5-chemin-refuse', { fullPage: false });

// ── 10. Aucune erreur console ───────────────────────────────────────────────
check('aucune erreur console sur tout le parcours',
  consoleErrors.length === 0);
if (consoleErrors.length) console.log('    ' + consoleErrors.join('\n    '));

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log('ÉCHEC — ' + failures.length + ' contrôle(s) :');
  for (const f of failures) console.log('  · ' + f);
} else {
  console.log('OK — tous les contrôles passent.');
}
console.log('Captures : ' + outDir);
await browser.close();
process.exit(failures.length ? 1 : 0);
