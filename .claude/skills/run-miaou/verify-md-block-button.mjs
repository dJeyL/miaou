// Vérifie le bouton « Convertir en page HTML » sur un bloc de code markdown
// affiché à l'écran (lot R, point 4) : présence conditionnée au langage,
// téléchargement produit, nom de fichier dérivé du titre h1 ou du data-filename.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');

const browser = await chromium.launch();
const page = await browser.newPage();
const downloads = [];
page.on('download', d => downloads.push(d.suggestedFilename()));
await page.goto(appUrl);
await page.waitForFunction(() => typeof decoratePre === 'function');

const results = [];
const check = (n, ok) => results.push({ n, ok });

// Décore un fragment hors thread : decoratePre est la seule chose testée ici.
const present = await page.evaluate(() => {
  const mk = (lang, filename) => {
    const d = document.createElement('div');
    const attr = filename ? ` data-filename="${filename}"` : '';
    d.innerHTML = `<pre class="language-${lang}"><code class="language-${lang}"${attr}># Titre du doc\n\ntexte</code></pre>`;
    document.body.appendChild(d);
    decoratePre(d);
    return d;
  };
  const md = mk('markdown');
  const py = mk('python');
  const mdNamed = mk('md', 'rapport.md');
  const r = {
    onMarkdown: !!md.querySelector('.code-md-html'),
    onPython: !!py.querySelector('.code-md-html'),
    onMdShort: !!mdNamed.querySelector('.code-md-html'),
    // Le bouton coexiste avec copier/télécharger, il ne les remplace pas.
    stillHasCopy: !!md.querySelector('.code-copy'),
    stillHasDl: !!md.querySelector('.code-dl'),
    title: (md.querySelector('.code-md-html') || {}).title || '',
  };
  md.remove(); py.remove(); mdNamed.remove();
  return r;
});

check('bouton présent sur un bloc markdown', present.onMarkdown);
check('bouton présent sur un bloc md', present.onMdShort);
check('bouton ABSENT sur un bloc python', !present.onPython);
check('copier toujours là', present.stillHasCopy);
check('télécharger toujours là', present.stillHasDl);
check('infobulle explicite', /HTML/.test(present.title));

// Clic réel : le téléchargement doit partir, nommé d'après le titre h1.
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'probe-md';
  d.innerHTML = '<pre class="language-markdown"><code class="language-markdown"># Mon rapport\n\nDu **texte**.</code></pre>';
  document.body.appendChild(d);
  decoratePre(d);
});
await page.click('#probe-md .code-md-html');
for (let i = 0; i < 100 && !downloads.length; i++) await page.waitForTimeout(50);
check('un téléchargement est produit', downloads.length === 1);
check('nom dérivé du titre h1 du markdown', downloads[0] === 'Mon rapport.html');

// data-filename prioritaire sur le titre h1.
await page.evaluate(() => {
  document.getElementById('probe-md').remove();
  const d = document.createElement('div');
  d.id = 'probe-named';
  d.innerHTML = '<pre class="language-markdown"><code class="language-markdown" data-filename="notes.md"># Autre titre\n\ntexte</code></pre>';
  document.body.appendChild(d);
  decoratePre(d);
});
await page.click('#probe-named .code-md-html');
for (let i = 0; i < 100 && downloads.length < 2; i++) await page.waitForTimeout(50);
check('data-filename prioritaire sur le titre', downloads[1] === 'notes.html');

await browser.close();

let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log('\ntéléchargements observés : ' + JSON.stringify(downloads));
console.log(ok ? 'OK' : 'ÉCHEC');
process.exit(ok ? 0 : 1);
