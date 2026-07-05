#!/usr/bin/env node
// Vérification du brief H (descripteur binaire générique + doctrine docs
// conditionnelle), un seul lancement :
//   A. chip visuelle de l'attachment binaire dans la bulle envoyée (seed-10c,
//      fallback icône, pas de vignette — pas de blob IDB seedé pour att-1 ici,
//      comportement attendu, cf. commentaire du seed),
//   B. formatBinaryAttachmentDescriptor : format exact, byte-stable, câblé
//      dans buildAttachedMessageContent (retourne bien une string, pas un
//      tableau, pour un binaire seul),
//   C. docsDoctrinePrompt : vide sans serveur qualifiant, non vide dès qu'un
//      outil du registre déclare ref+content_b64, mentionne le critère et
//      l'exemple docs__read sans nommer le serveur en dur,
//   D. ATTACHMENT_DOCTRINE nuancée (phrase binaire renvoie vers la doctrine
//      docs, jamais catégorique).
// Round-trip réseau complet avec un vrai serveur mcp_docs : manuel
// (docs/manual-tests.md test 65).
// Usage : node verify-brief-h-batch.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-brief-h');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed ──────────────────────────────────────────────────────────────────
const seedHtml = fs.readFileSync(seedPath, 'utf8');
const seedScript = seedHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1];
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'log'; d.hidden = true;
  document.body.appendChild(d);
});
await page.evaluate(seedScript);
await page.waitForFunction(() => document.getElementById('log').textContent.includes('skill(s)'), { timeout: 5000 });
await page.waitForFunction(() => document.getElementById('log').textContent.includes('pièce(s) jointe(s)'), { timeout: 5000 });
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

// ── A. Chip visuelle de l'attachment binaire (seed-10c) ─────────────────────
await page.click('.conv-title:text("Document Word joint")');
await page.waitForTimeout(300);
const chips = await page.evaluate(() => {
  const chipEls = Array.from(document.querySelectorAll('#thread .msg.user .att-chip'));
  return chipEls.map(c => ({
    name: c.querySelector('.att-name').textContent,
    hasImg: !!c.querySelector('.att-thumb'),
    hasIcon: !!c.querySelector('.att-icon'),
  }));
});
check('A : 1 chip rendue pour le .docx joint', chips.length === 1);
check('A : chip binaire tombe sur l\'icône, jamais de vignette (kind !== image)',
  chips.some(c => c.name === 'compte-rendu-sprint12.docx' && c.hasIcon && !c.hasImg));
await shot('01-binary-attachment-chip.png');

// ── B. formatBinaryAttachmentDescriptor + câblage ───────────────────────────
const descriptor = await page.evaluate(() => {
  const att = { attId: 'att-1', name: 'compte-rendu-sprint12.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 48200 };
  const d1 = formatBinaryAttachmentDescriptor(att);
  const d2 = formatBinaryAttachmentDescriptor(att);
  const content = buildAttachedMessageContent('Regarde ce fichier', [], [], [att]);
  return { d1, d2, byteStable: d1 === d2, content, isString: typeof content === 'string' };
});
check('B : descripteur mentionne attId, mime, taille, note neutre',
  descriptor.d1.indexOf('att-1') >= 0 && descriptor.d1.indexOf('wordprocessingml') >= 0 &&
  descriptor.d1.indexOf('binary content, not inlined') >= 0);
check('B : byte-stable entre deux appels identiques', descriptor.byteStable);
check('B : buildAttachedMessageContent avec binaire seul → string (pas de content parts)', descriptor.isString);
check('B : le descripteur est bien inclus dans le contenu construit', descriptor.content.indexOf(descriptor.d1) >= 0);

// ── C. docsDoctrinePrompt conditionnel ──────────────────────────────────────
const docsPromptBefore = await page.evaluate(() => docsDoctrinePrompt());
check('C : docsDoctrinePrompt vide sans serveur qualifiant', docsPromptBefore === '');

const docsPromptAfter = await page.evaluate(() => {
  _remoteTools['docs'] = [{
    name: 'docs__read', description: '',
    inputSchema: { type: 'object', properties: { ref: {}, content_b64: {} } },
  }];
  const p = docsDoctrinePrompt();
  const sysMsg = buildSystemMessage();
  delete _remoteTools['docs'];
  return { p, inSystemMessage: sysMsg.content.indexOf(p) >= 0 && p.length > 0 };
});
check('C : non vide dès qu\'un outil déclare ref+content_b64', docsPromptAfter.p.length > 0);
check('C : mentionne content_b64 (critère) et docs__read (exemple)',
  docsPromptAfter.p.indexOf('content_b64') >= 0 && docsPromptAfter.p.indexOf('docs__read') >= 0);
check('C : docsDoctrinePrompt bien inclus dans buildSystemMessage() quand qualifiant', docsPromptAfter.inSystemMessage);

// ── D. ATTACHMENT_DOCTRINE nuancée ──────────────────────────────────────────
const attDoctrine = await page.evaluate(() => ({
  nuanced: ATTACHMENT_DOCTRINE.indexOf('sauf si un outil') >= 0,
  notCategorical: ATTACHMENT_DOCTRINE.indexOf('le résultat renvoie le') < 0,
}));
check('D : phrase binaire nuancée (renvoie vers la doctrine docs conditionnelle)', attDoctrine.nuanced);
check('D : ancienne formulation catégorique disparue', attDoctrine.notCategorical);

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
