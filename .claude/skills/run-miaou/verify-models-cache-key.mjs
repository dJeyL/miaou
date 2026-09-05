#!/usr/bin/env node
// Vérifie que le cache des listes de modèles est indexé par ID DE SERVEUR et non
// par URL : deux serveurs partageant une URL et ne différant que par la clef
// d'API doivent voir leur propre liste. Vérifie aussi l'invalidation par `stamp`
// (édition d'une carte : même id, autre clef) et l'absence de refetch en boucle.
//
// Pas de serveur réel : `fetchModels` est stubé et répond SELON LA CLEF, ce qui
// est précisément la distinction que l'ancien cache par URL effaçait.
// Usage: node verify-models-cache-key.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Deux serveurs, MÊME URL, clefs différentes — la configuration de Julien au
// boulot. Le modèle par défaut diffère pour que le libellé soit discriminant.
await page.addInitScript(() => {
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srv-a', name: 'Boulot (clef A)', url: 'https://api.corp.local/v1', key: 'KEY-A', model: 'alpha-1', vision: {} },
    { id: 'srv-b', name: 'Boulot (clef B)', url: 'https://api.corp.local/v1', key: 'KEY-B', model: 'beta-1', vision: {} },
  ]));
  localStorage.setItem('miaou-active-space', 'default');
  localStorage.setItem('miaou-conversations', JSON.stringify([]));
});

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-done', { timeout: 10000 }).catch(() => {});

// Stub de fetchModels : la liste dépend de la CLEF. Compte les appels par
// (url, key) pour prouver l'absence de refetch en boucle.
await page.evaluate(() => {
  globalThis.__calls = [];
  globalThis.fetchModels = async ({ url, key }) => {
    globalThis.__calls.push(url + '|' + key);
    if (key === 'KEY-A') return ['alpha-1', 'alpha-2'];
    if (key === 'KEY-B') return ['beta-1', 'beta-2', 'beta-3'];
    return ['inconnu'];
  };
  // Le cache a pu être amorcé par le prefetch de démarrage avec le vrai
  // fetchModels (qui a échoué : URL bidon). On repart d'une ardoise propre.
  for (const k of Object.keys(_modelsById)) delete _modelsById[k];
});

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

// 1. Deux serveurs même URL, clefs différentes → deux listes distinctes.
const lists = await page.evaluate(async () => {
  await loadAllServerModels(true);
  const srv = listSelectableApiServers();
  return srv.map(s => ({ id: s.id, models: (_modelsEntryOf(s).models || []).slice() }));
});
const a = lists.find(x => x.id === 'srv-a');
const b = lists.find(x => x.id === 'srv-b');
check('srv-a garde sa propre liste (clef A)',
  JSON.stringify(a?.models) === JSON.stringify(['alpha-1', 'alpha-2']),
  JSON.stringify(a?.models));
check('srv-b garde sa propre liste (clef B), pas celle de srv-a',
  JSON.stringify(b?.models) === JSON.stringify(['beta-1', 'beta-2', 'beta-3']),
  JSON.stringify(b?.models));

// 2. Le menu du composer affiche bien les deux groupes avec leurs modèles.
await page.evaluate(() => { renderComposerModelOptionsInner(); });
const menu = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('#composer-model-menu > div').forEach(d => {
    out.push({ cls: d.className, txt: (d.textContent || '').trim() });
  });
  return out;
});
const menuTxt = menu.map(m => m.cls + ':' + m.txt).join(' | ');
check('le menu liste alpha-2 ET beta-3 (les deux serveurs, pas un seul)',
  menuTxt.includes('alpha-2') && menuTxt.includes('beta-3'), menuTxt);

// 3. Pas de refetch en boucle : un second loadAllServerModels sans `force`
//    ne redéclenche aucun appel (le filtre lit _modelsEntryOf, qui renvoie {}
//    pour une entrée absente — le risque était qu'il le fasse aussi pour une
//    entrée valide et refetche indéfiniment).
const callsBefore = await page.evaluate(() => globalThis.__calls.length);
await page.evaluate(async () => { await loadAllServerModels(); await loadAllServerModels(); });
const callsAfter = await page.evaluate(() => globalThis.__calls.length);
check('aucun refetch quand les listes sont déjà en cache',
  callsAfter === callsBefore, `avant=${callsBefore} après=${callsAfter}`);

// 4. Invalidation par stamp : on édite la clef de srv-a (même id) → l'entrée
//    doit être considérée périmée, et le refetch rendre la liste de la clef B.
const afterEdit = await page.evaluate(async () => {
  const arr = loadApiServers();
  const s = arr.find(x => x.id === 'srv-a');
  s.key = 'KEY-B';                 // même id, endpoint effectif différent
  saveApiServers(arr);
  const fresh = getApiServer('srv-a');
  const stale = _modelsEntryOf(fresh).models;   // doit être undefined (périmé)
  await loadServerModels(fresh);
  return { stale: stale || null, models: _modelsEntryOf(getApiServer('srv-a')).models || [] };
});
check('changer la clef d\'une carte périme son entrée de cache',
  afterEdit.stale === null, JSON.stringify(afterEdit.stale));
check('après refetch, srv-a expose la liste de sa NOUVELLE clef',
  JSON.stringify(afterEdit.models) === JSON.stringify(['beta-1', 'beta-2', 'beta-3']),
  JSON.stringify(afterEdit.models));

check('aucune erreur console', consoleErrors.length === 0, consoleErrors.join(' / '));

console.log('');
for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'ÉCHEC'}  ${c.name}${c.ok ? '' : '\n          → ' + c.detail}`);
}
const failed = checks.filter(c => !c.ok).length;
console.log(`\n  ${failed ? failed + ' échec(s)' : 'tout vert'} sur ${checks.length} assertions\n`);
await browser.close();
process.exit(failed ? 1 : 0);
