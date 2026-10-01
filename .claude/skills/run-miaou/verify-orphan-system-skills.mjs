// Vérifie la purge des skills système orphelines au démarrage
// (ensureSystemSkills → orphanSystemSkillSlugs → deleteSkillDb, skills.js).
// Zone non couverte par QuickJS : IndexedDB et chaîne de boot.
//
// Montage : on écrit en base une skill système que le bundle ne connaît pas et
// une skill utilisateur, on recharge, et on relit la base. Le cas limite d'un
// bundle SANS skill système (purge placée avant le retour sur liste vide) n'est
// pas couvert ici : il faudrait un build dédié.
import { launchIsolated } from './stub-backend.js';
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const browser = await launchIsolated();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const results = [];
const check = (n, ok, info) => results.push({ n, ok, info });

const ORPHAN = 'zz-orphan-system';
const USER = 'zz-user-skill';

async function boot() {
  await page.waitForSelector('#composer-text');
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null);
  // Le cache est chargé APRÈS ensureSystemSkills (main.js) : une skill système
  // connue présente au cache prouve que la purge a eu son tour.
  await page.waitForFunction(() => {
    const known = Object.keys(SYSTEM_SKILLS_CONTENT);
    return known.length > 0 && !!getSkillMeta(known[0]);
  });
}

await page.goto(appUrl);
await boot();

const known = await page.evaluate(() => Object.keys(SYSTEM_SKILLS_CONTENT));
check('prémisse : le bundle porte des skills système', known.length > 0, known.join(','));

await page.evaluate(async ({ ORPHAN, USER }) => {
  await putSkill({ slug: ORPHAN, name: 'Orpheline', description: 'test', content: 'x', system: true, enabled: true, autotrigger: true });
  await putSkill({ slug: USER, name: 'Utilisateur', description: 'test', content: 'y', system: false, enabled: true });
}, { ORPHAN, USER });

const before = await page.evaluate(async () => (await getAllSkillRecords()).map(r => r.slug));
check('prémisse : la skill système inconnue est en base avant rechargement', before.includes(ORPHAN));
check('prémisse : la skill utilisateur est en base avant rechargement', before.includes(USER));

await page.reload();
await boot();

const after = await page.evaluate(async ({ ORPHAN, USER }) => {
  const recs = await getAllSkillRecords();
  return {
    slugs: recs.map(r => r.slug),
    orphanCached: !!getSkillMeta(ORPHAN),
    userCached: !!getSkillMeta(USER),
  };
}, { ORPHAN, USER });

check('la skill système inconnue du bundle est supprimée de la base', !after.slugs.includes(ORPHAN), after.slugs.join(','));
check('… et absente du cache mémoire', after.orphanCached === false);
check('la skill utilisateur est conservée', after.slugs.includes(USER));
check('… et présente au cache mémoire', after.userCached === true);
const missing = known.filter(s => !after.slugs.includes(s));
check('toutes les skills système du bundle restent en base', missing.length === 0, missing.join(','));
check('aucune erreur console', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.n + (r.info ? '  [' + r.info + ']' : ''));
}
console.log(fail ? `\n${fail} échec(s)` : '\nOK');
process.exit(fail ? 1 : 0);
