#!/usr/bin/env node
// Skills servies par un serveur MCP, de bout en bout : approbation dans la
// fiche, lecture par miaou__skills__read, garde distante dans callTool.
//
// Ce que QuickJS couvre déjà (tests/test-mcp-skills.js) : SHA-256, frontmatter
// strict, catalogue, états d'approbation, résolution du serveur, garde pure, et
// le handler de lecture contre un `mcpRpc` stubé. Ce qui ne se voit qu'ici :
// le fil réel (sonde, en-têtes, `skills/get`, `resources/read` sous `Mcp-Name`),
// le repli absent du payload envoyé au modèle, la fiche et ses gestes, le
// lecteur, les toasts, et l'enchaînement « refus → approbation → lecture →
// appel » dans de vraies conversations.
//
// MONTAGE : modèle stubé, MCP RÉEL. Le proxy de miaou-mcp-servers doit tourner,
// avec l'upstream `bench` et sa skill obligatoire (lot qui l'a livrée dans ce
// dépôt-là). Port par `MCP_PROXY_URL` (défaut http://127.0.0.1:8765/mcp). Une
// carte nommée `proxy` pointe dessus, posée AVANT le chargement (premier
// chargement seulement) pour que la vague de connexions du démarrage — et donc
// son toast — porte sur elle.
//
// Le stub du modèle déroule un SCRIPT d'appels par conversation, indexé sur le
// nombre de messages `role:'tool'` déjà présents dans la requête (contenu, pas
// compteur d'appels : titrage et résumé passent aussi par ici). Chaque scénario
// part d'une conversation neuve.
//
// Rejeu contre le code d'avant le lot : `VERIFY_DIST=<chemin>/dist/miaou.html`.
//
// Usage : node verify-mcp-skills.mjs [dossier-captures] [--headed]
import { launchIsolated, seededMcpSentinel } from './stub-backend.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const proxyUrl = process.env.MCP_PROXY_URL || 'http://127.0.0.1:8765/mcp';
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-mcp-skills');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const SKILL_URI = 'skill://bench/bench/SKILL.md';

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// Le proxy doit répondre AVANT tout : sinon chaque check rougirait en accusant
// l'appli d'un serveur absent.
try {
  await fetch(proxyUrl, { method: 'OPTIONS' });
} catch (e) {
  console.error('Le proxy MCP ne répond pas sur ' + proxyUrl + ' (MCP_PROXY_URL pour un autre port).');
  process.exit(3);
}

const browser = await launchIsolated({ headless: !headed }, { serve: false, mcp: false });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.addInitScript(([url, seeded]) => {
  if (localStorage.getItem('miaou-mcp-seeded') !== null) return;
  localStorage.setItem('miaou-mcp-servers', JSON.stringify([{ name: 'proxy', url: url, enabled: true }]));
  localStorage.setItem('miaou-mcp-seeded', seeded);
  localStorage.setItem('miaou-settings', JSON.stringify({ theme: 'dark' }));
}, [proxyUrl, seededMcpSentinel()]);

// ── Modèle stubé ────────────────────────────────────────────────────────────
// `script` : un tableau de tours ; un tour est un appel d'outil `{ name, args }`
// ou `null` (réponse finale). Toutes les requêtes de chat sont gardées, pour
// lire ce que le modèle a reçu (outils déclarés, résultats d'outils, système).
let script = [];
const chatBodies = [];
await page.route('**/chat/completions', async (route) => {
  let body = {};
  try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* illisible */ }
  if (!body.stream) {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' } }] }) });
    return;
  }
  chatBodies.push(body);
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const turn = msgs.filter((m) => m && m.role === 'tool').length;
  const step = script[turn] || null;
  const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';
  let out;
  if (step) {
    out = sse({ choices: [{ delta: { role: 'assistant', content: '' } }] })
      + sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' + turn, type: 'function',
          function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n';
  } else {
    out = sse({ choices: [{ delta: { role: 'assistant', content: 'Fini.' } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
  }
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body: out });
});
await page.route('**/models', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'stub-model' }] }) }));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 15000 });
// Fin de la première vague de connexions : la carte est sortie de `connecting`.
await page.waitForFunction(() => {
  const st = getMcpStatus('proxy');
  return !!st && st.state !== 'connecting';
}, { timeout: 20000 });
await page.waitForTimeout(300);

// ── 1. Connexion : catalogue, _meta, repli ──────────────────────────────────
const conn = await page.evaluate(() => {
  const st = getMcpStatus('proxy') || {};
  const tools = (typeof remoteToolDefs === 'function' ? remoteToolDefs() : []);
  return {
    state: st.state, era: st.era, declared: st.skillsDeclared,
    catalogue: Array.isArray(st.skillCatalogue) ? st.skillCatalogue.map((e) => e.name + ' ' + e.uri) : null,
    echo: tools.find((t) => t.name === 'proxy__bench__echo') || null,
    fallback: tools.filter((t) => /read_skill/.test(t.name)).map((t) => t.name),
  };
});
check('prémisse : le proxy est connecté en ère moderne', conn.state === 'ok' && conn.era === 'modern');
check('prémisse : l\'outil proxy__bench__echo est au registre', !!conn.echo);
check('l\'extension Skills est lue dans le DiscoverResult', conn.declared === true);
check('le catalogue porte la skill bench', !!conn.catalogue && conn.catalogue.indexOf('bench ' + SKILL_URI) >= 0);
check('requiresSkill est gardé sur l\'outil distant', !!conn.echo && conn.echo.requiresSkill === SKILL_URI);
check('le repli read_skill n\'est plus exposé', conn.fallback.length === 0);

// ── 2. Toast de démarrage ───────────────────────────────────────────────────
const startToast = await page.evaluate(() => {
  const t = document.querySelector('.toast[data-key="mcp-skill-approval"]');
  return t ? t.textContent : null;
});
check('toast de démarrage : une skill à approuver, nommée', !!startToast && startToast.indexOf('bench') >= 0);

// Conversation neuve, script armé AVANT l'envoi (le stub lit son état à
// l'entrée de la requête). On attend côté Node que toutes les requêtes du
// script soient parties, puis la fin de génération côté page.
async function runConversation(prompt, steps) {
  script = steps;
  const before = chatBodies.length;
  await page.evaluate(() => newConversation());
  await page.waitForTimeout(200);
  await page.fill('#composer-text', prompt);
  await page.click('#send-btn');
  const deadline = Date.now() + 20000;
  while (chatBodies.length < before + steps.length && Date.now() < deadline) await page.waitForTimeout(100);
  await page.waitForFunction(() => typeof sending !== 'undefined' && sending === false, { timeout: 20000 });
  await page.waitForTimeout(400);
  return chatBodies.slice(before);
}

const toolResults = (bodies) => {
  const last = bodies[bodies.length - 1];
  return last ? last.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)) : [];
};

// ── 3. Skill non approuvée : appel refusé, lecture refusée ──────────────────
const A = await runConversation('Scénario A : appelle bench.', [
  { name: 'proxy__bench__echo', args: { text: 'avant lecture' } },
  { name: 'miaou__skills__read', args: { server: 'proxy', uri: SKILL_URI } },
  null,
]);
const resA = toolResults(A);
check('A : trois requêtes de chat (deux tours d\'outils puis la fin)', A.length === 3);
check('A : l\'appel distant est refusé, avec les arguments de lecture',
  !!resA[0] && resA[0].indexOf('lis d\'abord la skill MCP « bench »') >= 0
  && resA[0].indexOf('uri « ' + SKILL_URI + ' »') >= 0);
check('A : l\'appel n\'a pas atteint le serveur (aucun écho)', !!resA[0] && resA[0].indexOf('avant lecture') < 0);
check('A : la lecture d\'une skill non approuvée est refusée, en nommant la skill (pas le serveur)',
  !!resA[1] && resA[1].indexOf('n\'est pas approuvée') >= 0 && resA[1].indexOf('C\'est la SKILL que l\'utilisateur doit approuver') >= 0);
check('A : aucun contenu de skill n\'est entré en contexte', !!resA[1] && resA[1].indexOf('non contractuel') < 0);
const toolsSent = (A[0] && A[0].tools) || [];
const readDef = toolsSent.find((t) => t.function && t.function.name === 'miaou__skills__read');
check('payload : aucun outil de repli envoyé au modèle',
  toolsSent.every((t) => !/read_skill/.test(t.function.name)));
check('payload : miaou__skills__read porte server et uri',
  !!readDef && !!readDef.function.parameters.properties.server && !!readDef.function.parameters.properties.uri);
const sys = A[0] && A[0].messages[0] && A[0].messages[0].role === 'system' ? String(A[0].messages[0].content) : '';
check('système : le bloc des skills nomme les outils sous leur préfixe réel',
  sys.indexOf('outil `proxy__bench__…`') >= 0 && sys.indexOf('outil `bench__…`') < 0);
const refusedToast = await page.evaluate(() => !!document.querySelector('.toast[data-key="mcp-skill-refused:proxy:bench"]'));
check('A : toast de refus de lecture', refusedToast);

// ── 4. Drawer Skills : mention des skills MCP, lien vers les serveurs ───────
await page.evaluate(() => openSkills());
await page.waitForSelector('#skills-drawer.show');
await page.waitForTimeout(300);
const skillsNote = await page.evaluate(() => {
  const n = document.querySelector('#skill-list .skills-mcp-note');
  return n ? n.textContent : null;
});
check('drawer Skills : mention au singulier, accordée de bout en bout', !!skillsNote
  && skillsNote.indexOf('Une skill est servie par un serveur MCP. Elle n\u2019apparaît pas ici\u00a0: elle se consulte et s\u2019approuve sur la carte de son serveur.') === 0);
await page.click('#skill-list .skills-mcp-link');
await page.waitForSelector('#mcp-drawer.show');
await page.waitForTimeout(400);
const mcpOnTop = await page.evaluate(() => {
  const d = document.getElementById('mcp-drawer').getBoundingClientRect();
  const hit = document.elementFromPoint(d.left + d.width / 2, d.top + 40);
  return !!hit && !!hit.closest('#mcp-drawer') && !document.getElementById('skills-drawer').classList.contains('show');
});
check('lien : les serveurs MCP s\'affichent au premier plan, drawer Skills refermé', mcpOnTop);

// ── 5. Fiche serveur : rangée, lecteur, approbation ─────────────────────────
const rowBefore = await page.evaluate(() => {
  const r = document.querySelector('.mcp-skill-row[data-skill="bench"]');
  return r ? { state: r.dataset.state, text: r.textContent } : null;
});
check('fiche : rangée bench « à approuver »', !!rowBefore && rowBefore.state === 'pending');
await page.click('.mcp-skill-row[data-skill="bench"] .mcp-skill-read');
await page.waitForSelector('#mcp-skill-drawer.show');
await page.waitForFunction(() => /conforme|échec|impossible/.test(
  (document.querySelector('#mcp-skill-body .mcp-skill-viewer-meta') || {}).textContent || ''), { timeout: 10000 });
await page.waitForFunction(() => !!document.querySelector('#mcp-skill-body .mcp-skill-rendered'), { timeout: 10000 })
  .catch(() => {});
const viewer = await page.evaluate(() => {
  const b = document.getElementById('mcp-skill-body');
  const head = b.querySelector('.mcp-skill-viewer-head');
  const btn = b.querySelector('.mcp-skill-approve');
  const rendered = b.querySelector('.mcp-skill-rendered');
  return {
    meta: (b.querySelector('.mcp-skill-viewer-meta') || {}).textContent || '',
    state: (b.querySelector('.mcp-skill-viewer-state') || {}).textContent || '',
    html: rendered ? rendered.innerHTML : '',
    text: rendered ? rendered.textContent : '',
    btnW: btn ? btn.getBoundingClientRect().width : 0,
    headW: head ? head.getBoundingClientRect().width : 0,
  };
});
check('lecteur : SKILL.md vérifié contre l\'entrée', viewer.meta.indexOf('conforme à l\u2019entrée') >= 0);
check('lecteur : état « à approuver » en badge', viewer.state === 'à approuver');
check('lecteur : contenu RENDU en HTML (titre, emphase)', /<h1[ >]/.test(viewer.html) && /<strong>/.test(viewer.html)
  && viewer.text.indexOf('non contractuel') >= 0);
check('lecteur : frontmatter absent de l\'affichage', viewer.text.indexOf('name: bench') < 0);
check('lecteur : « Approuver » à sa largeur, pas celle du drawer (' + Math.round(viewer.btnW) + ' / ' + Math.round(viewer.headW) + ' px)',
  viewer.btnW > 0 && viewer.btnW < viewer.headW / 3);
// Annexes : une ligne par fichier du manifeste hors SKILL.md, lue à la demande.
// L'ensemble attendu vient du CATALOGUE vivant, jamais d'un compte écrit ici.
const expectedAnnexes = await page.evaluate((u) => {
  const e = (getMcpStatus('proxy').skillCatalogue || []).find((x) => x.uri === u);
  return e && e.resources ? e.resources.map((r) => r.uri.slice(e.dir.length)).filter((n) => n !== 'SKILL.md').sort() : [];
}, SKILL_URI);
const annexLines = await page.evaluate(() => Array.from(document.querySelectorAll('#mcp-skill-body .mcp-skill-annex-uri'))
  .map((el) => el.textContent.replace(/ \(\d+ octets\)$/, '')).sort());
check('lecteur : une ligne par annexe du manifeste (' + expectedAnnexes.join(', ') + ')',
  JSON.stringify(annexLines) === JSON.stringify(expectedAnnexes));
if (expectedAnnexes.length) {
  await page.click('#mcp-skill-body .mcp-skill-annex .drawer-btn');
  await page.waitForFunction(() => /conforme|échec/.test(
    (document.querySelector('#mcp-skill-body .mcp-skill-annex-body .mcp-skill-viewer-meta') || {}).textContent || ''),
    { timeout: 10000 });
  const annex = await page.evaluate(() => {
    const b = document.querySelector('#mcp-skill-body .mcp-skill-annex-body');
    return { meta: b.querySelector('.mcp-skill-viewer-meta').textContent,
      rendered: !!b.querySelector('.mcp-skill-rendered'), end: !!b.querySelector('.mcp-skill-annex-end') };
  });
  check('lecteur : annexe vérifiée contre le manifeste, rendue, close par un filet',
    annex.meta.indexOf('conforme') >= 0 && annex.rendered && annex.end);
}
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(outDir, 'lecteur.png') });
await page.click('#mcp-skill-body .mcp-skill-approve');
await page.waitForTimeout(300);
const afterApprove = await page.evaluate(() => ({
  stored: (loadMcpSkillApprovals().proxy || {}).bench || null,
  row: (document.querySelector('.mcp-skill-row[data-skill="bench"]') || {}).dataset,
  startToast: !!document.querySelector('.toast[data-key="mcp-skill-approval"]'),
}));
check('approbation : persistée, liée au manifeste complet', !!afterApprove.stored
  && afterApprove.stored.uri === SKILL_URI && afterApprove.stored.manifest.length === expectedAnnexes.length + 1);
check('approbation : la rangée passe à « approuvée »', !!afterApprove.row && afterApprove.row.state === 'approved');
check('approbation : le toast de démarrage est retiré', afterApprove.startToast === false);
await page.evaluate(() => closeMcpSkillViewer());
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'fiche.png') });
await page.evaluate(() => closeMcpServers());
await page.waitForTimeout(300);

// ── 6. Skill approuvée : lecture puis appel ─────────────────────────────────
const ANNEX_URI = expectedAnnexes.length ? SKILL_URI.replace('SKILL.md', expectedAnnexes[0]) : null;
const B = await runConversation('Scénario B : lis puis appelle.', [
  { name: 'miaou__skills__read', args: { server: 'proxy__bench', uri: SKILL_URI } },
  { name: 'proxy__bench__echo', args: { text: 'apres lecture' } },
].concat(ANNEX_URI ? [{ name: 'miaou__skills__read', args: { server: 'proxy', uri: ANNEX_URI } }] : []).concat([null]));
const resB = toolResults(B);
if (ANNEX_URI) {
  check('B : la lecture du SKILL.md liste l\'annexe en URI absolue', !!resB[0] && resB[0].indexOf('- ' + ANNEX_URI) >= 0);
  check('B : annexe lue après le SKILL.md, étiquetée comme annexe',
    !!resB[2] && resB[2].indexOf('[Fichier annexe de la skill MCP « bench », servi par le serveur MCP « proxy »') === 0);
  const fileAck = await page.evaluate(() => {
    const m = currentThread.find((x) => x && x.kind === 'skill_file_read');
    return m ? { server: m.server, uri: m.uri, skillUri: m.skillUri } : null;
  });
  check('B : ack skill_file_read distinct, rattaché à sa skill', !!fileAck && fileAck.server === 'proxy'
    && fileAck.uri === ANNEX_URI && fileAck.skillUri === SKILL_URI);
}
check('B : contenu étiqueté de son serveur d\'origine',
  !!resB[0] && resB[0].indexOf('[Skill MCP « bench », servie par le serveur MCP « proxy »') === 0);
check('B : la règle de la skill est en contexte', !!resB[0] && resB[0].indexOf('non contractuel') >= 0);
check('B : l\'appel distant passe après lecture', !!resB[1] && resB[1].indexOf('apres lecture') >= 0);
// En mode compact, le DOM ne porte qu'UN nœud .tool-ack (le dernier) : on lit
// l'ack dans le fil, et son libellé par le registre des kinds, celui que le
// rendu emploie.
const ackB = await page.evaluate(() => {
  const m = currentThread.find((x) => x && x.kind === 'skill_read');
  return m ? { server: m.server, uri: m.uri, slug: m.slug, label: ackLabel('skill_read', m) } : null;
});
check('B : l\'ack de lecture porte server et uri, sans slug',
  !!ackB && ackB.server === 'proxy' && ackB.uri === SKILL_URI && ackB.slug === undefined);
check('B : son libellé montre l\'origine', !!ackB && /^Skill MCP consultée/.test(ackB.label) && /\(proxy\)/.test(ackB.label));

// ── 7. Skill locale homonyme : le slug lit la locale, jamais la MCP ─────────
const C = await runConversation('Scénario C : slug.', [
  { name: 'miaou__skills__read', args: { slug: 'bench' } },
  null,
]);
const resC = toolResults(C);
const D = await runConversation('Scénario D : liste.', [
  { name: 'miaou__skills__list', args: {} },
  null,
]);
const listed = (() => { try { return JSON.parse(toolResults(D)[0]); } catch (e) { return []; } })();
check('D : miaou__skills__list montre la skill MCP, sans slug, avec server et uri',
  listed.some((x) => x.source === 'mcp' && x.name === 'bench' && x.server === 'proxy' && x.uri === SKILL_URI && !x.slug));
check('C : un slug sans skill locale oriente vers la lecture distante',
  !!resC[0] && resC[0].indexOf('Aucune skill locale « bench »') >= 0
  && resC[0].indexOf('server « proxy » et uri « ' + SKILL_URI + ' »') >= 0);

check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log(consoleErrors.join('\n'));

await browser.close();
console.log(failures.length ? '\n' + failures.length + ' échec(s)' : '\nOK');
process.exit(failures.length ? 1 : 0);
