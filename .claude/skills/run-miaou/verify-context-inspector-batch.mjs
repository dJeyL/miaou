#!/usr/bin/env node
// Vérification du lot « inspecteur de contexte » (brief B, fixes post-B1/B2/B3,
// un seul lancement) :
//   A. compteur pilule + drawer synchronisés au DÉBUT d'un tour (dispatchSend
//      pose _lastContextManifest avant l'appel réseau ; syncContextCounter()
//      doit suivre immédiatement, pas seulement en fin de tour — bug payé :
//      la pilule restait au total du tour précédent pendant tout le streaming),
//   B. manifest RECALCULÉ en fin de tour (recomputeLastContextManifest) : les
//      tool-acks + la réponse assistant ajoutés pendant runConversation doivent
//      apparaître dans le total, pas seulement ce qui existait avant l'appel
//      réseau (bug payé : écart ~50% entre conversation fraîche et rechargée),
//   C. hint à trois états dans le drawer (dernier envoi réel / simulation
//      sans envoi depuis rechargement / simulation conversation vide) — plus
//      seulement une dichotomie trompeuse ("aucun message envoyé encore" sur
//      une conversation rechargée non vide),
//   D. label 'Images jointes' non dupliqué avec la note « très approximatif »
//      (portée une seule fois, par renderContextInspector, pas par le manifest),
//   E. fenêtre de contexte par défaut de build (config.json → BUILD_CONFIG.
//      default_context_window) utilisée par contextWindowFor() quand le
//      réglage utilisateur est vide.
// Ce script pilote directement les fonctions globales du manifest (pas de vrai
// stream réseau — cf. verify-attachments-batch.mjs section D pour le même
// principe) : plus robuste qu'un mock SSE pour vérifier cette logique-là.
// Usage : node verify-context-inspector-batch.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-context-inspector');
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
await page.waitForFunction(() => document.getElementById('log').textContent.includes('pièce(s) jointe(s)'), { timeout: 5000 });
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);   // loadSkillsCache + rendus initiaux

// ── A/B. Simulation d'un tour complet SANS réseau : on peuple currentThread
// comme le ferait dispatchSend, on appelle les points de câblage exacts. ────
await page.click('.conv-title:text("Multi-outils : mémoire + historique")');
await page.waitForTimeout(300);

const roundTrip = await page.evaluate(() => {
  const results = {};

  // Étape 1 : « début de tour » — un message user est ajouté, le manifest est
  // posé comme le fait dispatchSend juste avant l'appel réseau (ligne ~1289),
  // PUIS syncContextCounter() (le fix : cet appel manquait).
  currentThread.push({ role: 'user', content: 'Question de test assez longue pour peser sur le total de tokens.' });
  const sysParts = systemMessageParts();
  const dynParts = contextBlockParts([]);
  const threadMsgsBefore = expandThread(resolveRecallImages(resolveResourceRefs(currentThread)));
  _lastContextManifest = buildContextManifest(sysParts, dynParts, threadMsgsBefore, JSON.stringify(toolDefinitions()), null);
  syncContextCounter();
  results.pillAfterCaptureStart = document.getElementById('ctx-counter-label').textContent;
  results.manifestTokensAtStart = _lastContextManifest.totalTokens;

  // Étape 2 : la « boucle d'outils » ajoute un tool-ack enrichi + la réponse
  // assistant — exactement ce qu'une vraie boucle runConversation persiste sur
  // currentThread, mais sans round-trip réseau.
  currentThread.push({
    role: 'tool-ack', name: 'get_weather', args: { city: 'Brest' },
    result: 'x'.repeat(4000),   // gros résultat d'outil, pèse largement sur le total
    ts: Date.now(), group: 'gtest',
  });
  currentThread.push({ role: 'assistant', content: 'Réponse de synthèse après outil.', model: 'test-model', ts: Date.now() });

  // Étape 3 : recapture de fin de tour (le fix onFinal/onHalt).
  recomputeLastContextManifest([]);
  syncContextCounter();
  results.pillAfterFinal = document.getElementById('ctx-counter-label').textContent;
  results.manifestTokensAfterFinal = _lastContextManifest.totalTokens;

  return results;
});

check('A : pilule mise à jour dès la capture de début de tour (pas figée sur l\'ancien total)',
  roundTrip.pillAfterCaptureStart !== '≈ 0 tok');
check('B : manifest de fin de tour > manifest de début de tour (tool-ack + réponse assistant comptés)',
  roundTrip.manifestTokensAfterFinal > roundTrip.manifestTokensAtStart);
check('B : pilule de fin de tour reflète le total recalculé',
  roundTrip.pillAfterFinal.startsWith(`≈ ${roundTrip.manifestTokensAfterFinal} tok`));
console.log(`  info  tokens début=${roundTrip.manifestTokensAtStart} fin=${roundTrip.manifestTokensAfterFinal}`);

// ── C. Hint à trois états ────────────────────────────────────────────────────
await page.evaluate(() => openContextInspector());
await page.waitForSelector('#ctx-drawer.show');
await page.waitForTimeout(200);
const hintRealSend = await page.evaluate(() => document.getElementById('ctx-source-hint').textContent);
// Depuis Bbis (usage API réel), le hint distingue « tokens rapportés par
// l'API » (m.real) de « estimation, pas d'info backend » (apiUsage absent) —
// ici la simulation n'a pas d'usage, donc c'est la seconde variante attendue.
check('C : hint "dernier envoi réel" quand _lastContextManifest existe',
  hintRealSend === 'Dernier envoi réel — estimation (pas d\'info backend).');
await shot('01-hint-real-send.png');

// Simule un rechargement d'historique (openConversation remet _lastContextManifest à null)
// sur une conversation NON VIDE.
await page.evaluate(() => { closeContextInspector(); });
await page.click('.conv-title:text("Météo Brest via outil MCP")');
await page.waitForTimeout(300);
await page.evaluate(() => openContextInspector());
await page.waitForSelector('#ctx-drawer.show');
await page.waitForTimeout(200);
const hintReloadedNonEmpty = await page.evaluate(() => document.getElementById('ctx-source-hint').textContent);
check('C : hint distingue "pas d\'envoi depuis rechargement" (conversation non vide)',
  hintReloadedNonEmpty === 'Simulation du prochain envoi (aucun envoi depuis le rechargement de cette conversation).');
await shot('02-hint-reloaded-nonempty.png');

// Conversation réellement vide (nouvelle conversation, jamais envoyée).
await page.evaluate(() => { closeContextInspector(); newConversation(); });
await page.waitForTimeout(200);
await page.evaluate(() => openContextInspector());
await page.waitForSelector('#ctx-drawer.show');
await page.waitForTimeout(200);
const hintEmpty = await page.evaluate(() => document.getElementById('ctx-source-hint').textContent);
check('C : hint distingue "conversation vide" (aucun message du tout)',
  hintEmpty === 'Simulation du prochain envoi (aucun message dans cette conversation).');
await shot('03-hint-empty-conv.png');
await page.evaluate(() => closeContextInspector());

// ── D. Label 'Images jointes' non dupliqué ──────────────────────────────────
// Une image ne repart en content-parts `image_url` QUE pendant le tour
// d'attache (piège #17 CLAUDE.md — collapsée en descripteur texte juste
// après) : aucune conversation persistée/seedée n'exerce donc plus cette
// ligne. On simule directement ce tour-en-cours sur currentThread, comme le
// ferait buildAttachedMessageContent avant collapse.
await page.evaluate(() => { closeContextInspector(); newConversation(); });
await page.waitForTimeout(200);
const imgRow = await page.evaluate(() => {
  currentThread.push({
    role: 'user',
    content: [
      { type: 'text', text: 'Voici une image.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ],
  });
  _lastContextManifest = null;   // force la simulation (computeContextManifestNow)
  openContextInspector();
  const rows = Array.from(document.querySelectorAll('#ctx-table-body tr'));
  const row = rows.find(r => r.textContent.includes('Images jointes'));
  return row ? row.textContent : null;
});
await page.waitForTimeout(150);
check('D : ligne "Images jointes" présente dans la table', !!imgRow);
check('D : note "très approximatif" apparaît UNE seule fois (pas de doublon)',
  !!imgRow && (imgRow.match(/très approximatif/g) || []).length === 1);
await shot('04-images-row-no-duplicate.png');
await page.evaluate(() => closeContextInspector());

// ── E. Fenêtre de contexte par défaut de build (BUILD_DEFAULT_CONTEXT_WINDOW) ──
const buildDefault = await page.evaluate(() => ({
  buildDefaultConst: typeof BUILD_DEFAULT_CONTEXT_WINDOW,
  contextWindowForNoSetting: contextWindowFor('any-model'),
}));
check('E : BUILD_DEFAULT_CONTEXT_WINDOW existe (storage.js)', buildDefault.buildDefaultConst === 'number');
console.log(`  info  contextWindowFor() sans réglage utilisateur = ${buildDefault.contextWindowForNoSetting} (0/null si config.json n'a pas default_context_window)`);

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
