// Vérifie la résolution des jetons {{…}} de l'aide (miaou__about) contre les
// valeurs VIVANTES du build : c'est la chaîne config.json → constante →
// substitution qu'on éprouve, pas une phrase particulière de help.md.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Chemin résolu depuis l'emplacement DU SCRIPT, jamais process.cwd() : lancé
// depuis le dossier de la skill (le cas normal), un cwd relatif pointe sur
// .claude/skills/run-miaou/dist/ et échoue en ERR_FILE_NOT_FOUND.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../..', 'dist/miaou.html');

const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + distPath);
await p.waitForFunction(() => typeof helpPlaceholderValues === 'function');

let failed = 0;
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failed++;
};

const vals = await p.evaluate(() => helpPlaceholderValues());
console.log('valeurs résolues :', JSON.stringify(vals));

// Aucun jeton ne doit survivre dans l'aide RÉSOLUE — ni pour about (section par
// section) ni pour about_search, qui doivent partager la même source.
const leftover = await p.evaluate(() => {
  const out = [];
  const all = helpContentResolved();
  for (const [slug, txt] of Object.entries(all)) {
    const m = String(txt).match(/\{\{[A-Z0-9_]+\}\}/g);
    if (m) out.push(slug + ': ' + m.join(','));
  }
  return out;
});
check('aucun jeton non résolu dans l\'aide servie' + (leftover.length ? ' (' + leftover.join(' | ') + ')' : ''),
      leftover.length === 0);

// Les valeurs servies sont celles du BUILD (config.json), pas les défauts du
// code : on les compare aux constantes vivantes plutôt qu'à des littéraux.
const live = await p.evaluate(() => ({
  images: String(ATTACHMENT_MAX_IMAGES),
  inputs: String(JS_EVAL_MAX_INPUTS),
  perConv: String(MAX_AGENTS_PER_CONV),
}));
check('les jetons portent les constantes vivantes du build',
      vals.ATTACHMENT_MAX_IMAGES === live.images
      && vals.JS_EVAL_MAX_INPUTS === live.inputs
      && vals.MAX_AGENTS_PER_CONV === live.perConv);

// about et about_search doivent voir le MÊME texte : substituer d'un seul côté
// laisserait la recherche porter sur des jetons.
const both = await p.evaluate(() => {
  const needle = String(JS_EVAL_MAX_INPUTS) + ' fichiers';
  const all = helpContentResolved();
  const hits = searchHelpContent(all, needle);
  // La section qui porte la valeur est trouvée par le contenu, pas nommée en
  // dur : un redécoupage de help.md déplace le passage sans invalider le test.
  const inSome = Object.values(all).some(t => String(t).indexOf(needle) >= 0);
  return { hits: hits.length, inSome };
});
check('about_search trouve une valeur substituée, comme about la sert',
      both.hits >= 1 && both.inSome);

// La liste des sujets est composée, pas rédigée : elle doit nommer CHAQUE
// section présente (hors apercu), sans quoi un sujet existe sans être annoncé.
const topics = await p.evaluate(() => {
  const slugs = Object.keys(helpContentResolved()).filter(s => s !== 'apercu');
  const line = helpPlaceholderValues().TOPIC_LIST;
  return { missing: slugs.filter(s => line.indexOf('`' + s + '`') < 0), count: slugs.length };
});
check('la liste des sujets nomme les ' + topics.count + ' sections'
      + (topics.missing.length ? ' (manquantes : ' + topics.missing.join(', ') + ')' : ''),
      topics.missing.length === 0);

await b.close();
console.log(failed ? `\nÉCHEC — ${failed} contrôle(s)` : '\nOK');
process.exit(failed ? 1 : 0);
