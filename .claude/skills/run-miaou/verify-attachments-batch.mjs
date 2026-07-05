#!/usr/bin/env node
// Vérification du lot « pièces jointes » (brief A, un seul lancement) :
//   A. chip d'attachment dans une bulle envoyée : vignette réelle pour l'image
//      (blob IDB seedé, seed-10b/att-1), fallback icône pour le texte (att-2,
//      kind !== 'image' — jamais de vignette, par design),
//   B. outil miaou__recall_attachment (lot 3, D4) appelé directement (pas de
//      LLM dans ce script) via callTool : image → ack attachment_recalled +
//      bloc <img> rendu par placeToolAck (même chemin que present_resource) ;
//      texte → contenu en clair retourné, pas de bloc visuel ; ref inconnu →
//      erreur textuelle propre,
//   C. doctrine ATTACHMENT_DOCTRINE présente dans ROOT_SYSTEM_PROMPT (statique,
//      vérifiable sans appel réseau),
//   D. hook D6 (lot 4) : toolDeclaresAttachmentInflation détecte la capability
//      SANS nom de serveur en dur (schéma ref+content_b64 déclaré), et
//      callDocsInflatedRemoteTool laisse un outil non-capable inchangé — le
//      round-trip réseau complet avec un vrai serveur mcp_docs reste manuel
//      (lot D pas livré, cf. docs/manual-tests.md test 57).
// Usage : node verify-attachments-batch.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-attachments');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// ERR_CONNECTION_REFUSED est ATTENDU pour le test D (port fermé volontaire,
// cf. section D ci-dessous) — pas un signal de bug, filtré explicitement pour
// ne pas polluer le check générique de console propre.
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && m.text().indexOf('ERR_CONNECTION_REFUSED') < 0) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed : script de dev-seed.html évalué dans la page dist (même origine) ──
const seedHtml = fs.readFileSync(seedPath, 'utf8');
const seedScript = seedHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1];
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'log'; d.hidden = true;
  document.body.appendChild(d);
});
await page.evaluate(seedScript);
await page.waitForFunction(() => document.getElementById('log').textContent.includes('skill(s)'), { timeout: 5000 });
// seedAttachmentResources() écrit en IDB APRÈS seedSkills() dans le même tick :
// attendre spécifiquement sa ligne de log avant de recharger.
await page.waitForFunction(() => document.getElementById('log').textContent.includes('pièce(s) jointe(s)'), { timeout: 5000 });
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);   // loadSkillsCache + rendus initiaux

// ── A. Chip d'attachment dans une bulle envoyée (seed-10b) ──────────────────
await page.click('.conv-title:text("Debug capture réseau")');
await page.waitForTimeout(300);   // openConversation → loadConversationResources (async) → renderThread
const chips = await page.evaluate(() => {
  const chipEls = Array.from(document.querySelectorAll('#thread .msg.user .att-chip'));
  return chipEls.map(c => ({
    name: c.querySelector('.att-name').textContent,
    hasImg: !!c.querySelector('.att-thumb'),
    hasIcon: !!c.querySelector('.att-icon'),
  }));
});
check('A : 2 chips rendues (image + texte)', chips.length === 2);
check('A : chip image (att-1) a une vraie vignette <img> (blob IDB seedé)',
  chips.some(c => c.name === 'erreur-503.png' && c.hasImg && !c.hasIcon));
check('A : chip texte (att-2) tombe sur l\'icône, jamais de vignette (kind !== image)',
  chips.some(c => c.name === 'nginx-access.log' && c.hasIcon && !c.hasImg));
await shot('01-attachment-chips.png');

// ── B. recall_attachment (lot 3, D4) — appelé directement, sans LLM ──────────
const recallImage = await page.evaluate(() => {
  clearPendingToolAcks();
  const r = callTool('recall_attachment', { ref: 'att-1' });
  return { text: flattenToolResult(r), isError: r.isError, acks: getPendingToolAcks() };
});
check('B : recall image → pas d\'erreur, texte informatif (pas de base64)',
  !recallImage.isError && recallImage.text.indexOf('présentée') >= 0 && recallImage.text.indexOf('base64') < 0);
check('B : ack attachment_recalled poussé avec attId=att-1',
  recallImage.acks.length === 1 && recallImage.acks[0].kind === 'attachment_recalled' && recallImage.acks[0].attId === 'att-1');

// Rend l'ack dans une bulle assistant réelle (même chemin que le rendu live/reload,
// placeToolAck) pour vérifier le bloc image affiché.
const renderedImage = await page.evaluate((ack) => {
  const wrap = buildMsg('assistant', 'Voici le contenu rappelé.', null, null, Date.now());
  document.getElementById('thread').appendChild(wrap);
  placeToolAck(wrap, ack);
  return {
    ackLabel: (wrap.querySelector('.tool-ack .ack-label') || {}).textContent || '',
    hasImgBlock: !!wrap.querySelector('img'),
  };
}, recallImage.acks[0]);
check('B : ack rendu avec le libellé « Pièce jointe rappelée »', renderedImage.ackLabel.indexOf('Pièce jointe rappelée') >= 0);
check('B : bloc <img> affiché pour l\'image rappelée (lookup par attId, cf. placeToolAck)', renderedImage.hasImgBlock);
await page.evaluate(() => document.getElementById('thread').lastElementChild.scrollIntoView());
await shot('02-recall-attachment-image.png');

const recallText = await page.evaluate(() => {
  clearPendingToolAcks();
  const r = callTool('recall_attachment', { ref: 'att-2' });
  return { text: flattenToolResult(r), isError: r.isError, acks: getPendingToolAcks() };
});
check('B : recall texte → contenu en clair retourné (pas de bloc image attendu)',
  !recallText.isError && recallText.text.indexOf('upstream timed out') >= 0);
check('B : ack attachment_recalled pour le texte aussi (attId=att-2)',
  recallText.acks.length === 1 && recallText.acks[0].attId === 'att-2');

const recallUnknown = await page.evaluate(() => {
  clearPendingToolAcks();
  const r = callTool('recall_attachment', { ref: 'att-999' });
  return { text: flattenToolResult(r), isError: r.isError, acks: getPendingToolAcks() };
});
// Même posture que present_resource : message textuel clair, PAS isError
// (le handler ne lève pas — cohérent avec le registre TOOLS existant).
check('B : ref inconnu → message textuel clair, aucun ack poussé',
  !recallUnknown.isError && recallUnknown.text.indexOf('introuvable') >= 0 && recallUnknown.acks.length === 0);

// ── C. ATTACHMENT_DOCTRINE dans ROOT_SYSTEM_PROMPT (statique) ────────────────
const doctrine = await page.evaluate(() => ({
  mentionsRecall: ATTACHMENT_DOCTRINE.indexOf('recall_attachment') >= 0,
  includedInRoot: ROOT_SYSTEM_PROMPT.indexOf(ATTACHMENT_DOCTRINE) >= 0,
}));
check('C : ATTACHMENT_DOCTRINE mentionne recall_attachment', doctrine.mentionsRecall);
check('C : ATTACHMENT_DOCTRINE incluse dans ROOT_SYSTEM_PROMPT', doctrine.includedInRoot);

// ── D. Hook d'inflation dispatcher (lot 4, D6) — détection de capability ─────
const hook = await page.evaluate(() => {
  _remoteTools['docstest'] = [{
    name: 'docstest__read',
    description: '',
    inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, session_id: {} } },
  }];
  const capableDetected = toolDeclaresAttachmentInflation({ name: 'docstest' }, 'read');
  delete _remoteTools['docstest'];
  const refPattern = ATTACHMENT_REF_RE.test('att-3') && !ATTACHMENT_REF_RE.test('res_abc');
  return { capableDetected, refPattern };
});
check('D : capability détectée via ref+content_b64 déclarés (sans nom de serveur en dur)', hook.capableDetected);
check('D : ATTACHMENT_REF_RE reconnaît att-N, rejette res_…', hook.refPattern);

// Outil non-capable (serveur inconnu/désactivé) → callDocsInflatedRemoteTool
// délègue tel quel, aucune mutation de l'état poussé/non-poussé.
await page.evaluate(() => { localStorage.removeItem('miaou-mcp-servers'); });
const nonCapable = await page.evaluate(async () => {
  const before = isAttachmentPushed(null, 'att-1');
  // URL bidon mais définie : évite un "Fetch API cannot load .../undefined"
  // en console (faux positif du check consoleErrors), fetch échoue quand même
  // vite (domaine inexistant), capturé proprement par callRemoteTool.
  const r = await callDocsInflatedRemoteTool({ name: 'inconnu', enabled: true, url: 'http://127.0.0.1:18888/mcp', timeout: 500 }, 'search', { ref: 'att-1' }, undefined);
  const after = isAttachmentPushed(null, 'att-1');
  return { isError: r.isError, before, after };
});
check('D : outil non-capable → erreur propre (serveur inconnu), pas de throw', nonCapable.isError);
check('D : aucune mutation de l\'état poussé sur un chemin non-capable', nonCapable.before === false && nonCapable.after === false);

await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log('Console errors:', JSON.stringify(consoleErrors, null, 2));
  failures.push('console errors');
} else {
  console.log('No console errors.');
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
