#!/usr/bin/env node
// Vérification du brief H (descripteur binaire générique + doctrine docs
// conditionnelle), un seul lancement :
//   A. chip visuelle de l'attachment binaire dans la bulle envoyée (seed-10c,
//      fallback icône, pas de vignette — pas de blob IDB seedé pour att-1 ici,
//      comportement attendu, cf. commentaire du seed),
//   B. formatBinaryAttachmentDescriptor : format exact, byte-stable, câblé
//      dans buildAttachedMessageContent (retourne bien une string, pas un
//      tableau, pour un binaire seul),
//   C. DOCS_DOCTRINE v2 (lot V-1) : STATIQUE et inconditionnelle, incluse dans
//      ROOT_SYSTEM_PROMPT donc dans buildSystemMessage(), byte-identique avec
//      ou sans serveur qualifiant branché (piège 16). La v1 conditionnelle
//      (docsDoctrinePrompt / anyToolDeclaresAttachmentInflation) a disparu.
//   D. ATTACHMENT_DOCTRINE nuancée (phrase binaire renvoie vers la doctrine
//      docs, jamais catégorique).
// Round-trip réseau complet avec un vrai serveur mcp_docs : manuel
// (docs/manual-tests.md test 65).
// Usage : node verify-brief-h-batch.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedAll } from './seed-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
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

// ── Seed : fixtures du module seed-fixtures.js écrites dans la page dist ──
await seedAll(page);
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

// ── C. DOCS_DOCTRINE v2 statique ────────────────────────────────────────────
const docsDoc = await page.evaluate(() => {
  const sysBefore = buildSystemMessage().content;
  _remoteTools['docs'] = [{
    name: 'docs__read', description: '',
    inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, char_start: {} } },
  }];
  const sysAfter = buildSystemMessage().content;
  delete _remoteTools['docs'];
  return {
    doctrine: DOCS_DOCTRINE,
    inRoot: ROOT_SYSTEM_PROMPT.indexOf(DOCS_DOCTRINE) >= 0,
    inSystemMessage: sysBefore.indexOf(DOCS_DOCTRINE) >= 0,
    stable: sysBefore === sysAfter,
    gone: typeof docsDoctrinePrompt === 'undefined' &&
          typeof anyToolDeclaresAttachmentInflation === 'undefined',
  };
});
check('C : DOCS_DOCTRINE incluse dans ROOT_SYSTEM_PROMPT', docsDoc.inRoot);
check('C : présente dans buildSystemMessage() SANS aucun serveur branché', docsDoc.inSystemMessage);
check('C : message système byte-identique avec/sans serveur qualifiant (piège 16)', docsDoc.stable);
check('C : deux blocs balisés (motif WEB_DOCTRINE)',
  docsDoc.doctrine.indexOf('<OUVERTURE_DE_DOCUMENTS>') >= 0 &&
  docsDoc.doctrine.indexOf('<SANS_OUVERTURE_DE_DOCUMENTS>') >= 0);
check('C : aiguillage zip natif + critère ref/content_b64 (exemple docs__read)',
  docsDoc.doctrine.indexOf('miaou__docs__list') >= 0 &&
  docsDoc.doctrine.indexOf('content_b64') >= 0 &&
  docsDoc.doctrine.indexOf('docs__read') >= 0);
check('C : helpers conditionnels v1 supprimés du bundle', docsDoc.gone);

// ── D. ATTACHMENT_DOCTRINE nuancée ──────────────────────────────────────────
const attDoctrine = await page.evaluate(() => ({
  nuanced: ATTACHMENT_DOCTRINE.indexOf('sauf si un outil') >= 0,
  notCategorical: ATTACHMENT_DOCTRINE.indexOf('le résultat renvoie le') < 0,
}));
check('D : phrase binaire nuancée (renvoie vers DOCS_DOCTRINE)', attDoctrine.nuanced);
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
