#!/usr/bin/env node
// Vérifie la réorganisation du drawer « Voir les outils exposés » (lot P) :
// les outils internes plats de la section MIAOU sont regroupés en sous-namespaces
// memory__ / conv__ / resource__ via groupByNamespace (préfixage des noms dans
// TOOLS, aucun stockage). Confirme aussi que le routage callTool reste correct
// pour les noms sous-namespacés (résolus en interne, pas vers un serveur MCP).
//
// Usage : node verify-tool-namespaces.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-tool-namespaces');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
// L'overlay de boot masque les captures (plancher 1,8 s, jamais retiré du DOM).
// Attendre la CLASSE, pas la visibilité : `waitForSelector` exige par défaut un
// élément visible, or l'overlay porte `boot-done` précisément parce qu'il vient
// d'être estompé — il est donc `hidden` au moment même où la condition est
// remplie, et l'attente expire alors que le boot est terminé.
await page.waitForFunction(
  () => document.getElementById('boot-overlay').classList.contains('boot-done'),
  null, { timeout: 10000 },
);

// Simule des serveurs MCP distants (comme l'env réel de Julien : miaou-proxy avec
// plusieurs outils) pour vérifier que le tri ne les ENTRELACE pas avec l'interne.
await page.evaluate(() => {
  _remoteTools = {
    'miaou-proxy': [
      { name: 'miaou-proxy__brave', description: 'd', inputSchema: { type: 'object', properties: {} } },
      { name: 'miaou-proxy__bench', description: 'd', inputSchema: { type: 'object', properties: {} } },
      { name: 'miaou-proxy__web', description: 'd', inputSchema: { type: 'object', properties: {} } },
    ],
    'weather': [
      { name: 'weather__now', description: 'd', inputSchema: { type: 'object', properties: {} } },
    ],
  };
});

// Ouvre le drawer outils et déplie tous les namespaces pour la capture.
await page.evaluate(() => {
  openTools();
  document.querySelectorAll('.tool-ns:not(.open)').forEach(h => h.click());
});
await page.waitForTimeout(300);

// Énumère les namespaces rendus + le nombre d'outils dans chacun.
const groups = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#tools-list .tool-ns-group')).map(g => ({
    label: g.querySelector('.tool-ns span:first-child').textContent.trim(),
    count: g.querySelectorAll('.tool-item').length,
    names: Array.from(g.querySelectorAll('.tool-item .tool-name')).map(n => n.textContent.trim()),
  }));
});
console.log('  info  namespaces :', JSON.stringify(groups.map(g => g.label + '(' + g.count + ')')));

// Label court = dernier segment après « › » (le rendu affiche « miaou › memory »).
const short = l => l.split('›').map(s => s.trim()).pop();
const byLabel = Object.fromEntries(groups.map(g => [short(g.label), g]));

// Ordre en trois familles : « MIAOU » nu en tête, puis internes (miaou › …) triés
// alpha, puis distants (autre préfixe) triés alpha — SANS entrelacement.
const isInternal = l => l === 'miaou' || l.startsWith('miaou ›') || l.startsWith('MIAOU ›') || /^miaou\b/i.test(l);
const labels = groups.map(g => g.label);
const family = l => l.toLowerCase() === 'miaou' ? 0 : (/^miaou\s*›/i.test(l) ? 1 : 2);
console.log('  info  ordre :', JSON.stringify(labels));
check('« MIAOU » (outils plats) est le premier namespace', labels[0].toLowerCase() === 'miaou');
// Familles monotones : 0 puis 1 puis 2, jamais de retour en arrière (pas d'entrelacement).
const fams = labels.map(family);
check('familles non entrelacées (miaou < internes < distants)',
  fams.every((f, i) => i === 0 || f >= fams[i - 1]));
// Alpha à l'intérieur de chaque famille.
const internes = labels.filter(l => family(l) === 1);
const distants = labels.filter(l => family(l) === 2);
const alpha = a => JSON.stringify(a) === JSON.stringify(a.slice().sort((x, y) => x.localeCompare(y)));
check('sous-namespaces internes triés alpha', alpha(internes));
check('serveurs distants triés alpha', alpha(distants));

// Sous-namespaces internes attendus (le libellé affiche « a › b » via split('__')).
check('namespace « memory » présent', !!byLabel['memory']);
// Asserté par NOMS, jamais par cardinal : un compte nu périme au premier outil
// ajouté au namespace (`resource__append` l'a fait passer de 3 à 4) et, pire,
// ne dit pas LEQUEL manque quand il tombe. La liste attendue échoue en nommant
// l'écart. Un outil ajouté ici doit être ajouté là — c'est le point.
const nsLeaf = g => (g ? g.names.map(n => n.split('__').pop().trim()).sort() : []);
const sameSet = (a, b) => JSON.stringify(a) === JSON.stringify(b.slice().sort());
check('namespace « memory » : create/update/delete',
  sameSet(nsLeaf(byLabel['memory']), ['create', 'update', 'delete']));
check('namespace « conv » présent', !!byLabel['conv']);
check('namespace « conv » : list/get', sameSet(nsLeaf(byLabel['conv']), ['list', 'get']));
check('namespace « resource » présent', !!byLabel['resource']);
check('namespace « resource » : create/from_result/present/append',
  sameSet(nsLeaf(byLabel['resource']), ['create', 'from_result', 'present', 'append']));

// La section MIAOU ne contient plus que les outils réellement plats.
check('namespace « miaou » présent', !!byLabel['miaou']);
if (byLabel['miaou']) {
  const flat = byLabel['miaou'].names.join('|');
  check('MIAOU ne contient plus create_memory (déplacé sous memory)', !/create.*memory|memory.*create/i.test(flat) || byLabel['miaou'].names.every(n => !n.includes('memory')));
  check('MIAOU contient about', byLabel['miaou'].names.some(n => /about/i.test(n)));
}

// Routage : un nom sous-namespacé doit résoudre en interne, jamais vers un serveur MCP.
const routing = await page.evaluate(() => ({
  memoryUpdate: resolveInternalToolName('memory__update', TOOLS),
  convGet: resolveInternalToolName('miaou__conv__get', TOOLS),
  present: resolveInternalToolName('resource__present', TOOLS),
  remote: resolveInternalToolName('jira__search', TOOLS),
}));
check('memory__update résout en interne (pas MCP)', routing.memoryUpdate === 'memory__update');
check('miaou__conv__get résout en interne (préfixe strippé)', routing.convGet === 'conv__get');
check('resource__present résout en interne', routing.present === 'resource__present');
check('jira__search NON résolu en interne (→ serveur MCP)', routing.remote === null);

await page.screenshot({ path: path.join(outDir, 'tool-namespaces.png') });
console.log('  shot  tool-namespaces.png');

check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log('\nErreurs console :\n' + consoleErrors.join('\n'));

console.log('\n' + '─'.repeat(60));
console.log(failures.length ? `  ÉCHEC — ${failures.length} :\n   - ` + failures.join('\n   - ')
                            : '  OK — toutes les vérifications passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
