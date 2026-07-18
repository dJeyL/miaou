// Vérifie la bascule de thème dans l'export HTML (points 1+2) :
//  - serializeThemeTokens émet les DEUX jeux (:root + html[data-theme=light])
//  - la mesure du thème inactif ne laisse PAS l'app sur le mauvais thème
//  - le bouton n'existe qu'en export interactif
//  - la bascule change réellement les couleurs calculées dans le fichier exporté
//  - l'override est persisté et re-appliqué au rechargement
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const outDir = path.resolve(dir, 'tmp-export-theme');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => typeof serializeThemeTokens === 'function');

const results = [];
const check = (n, ok) => results.push({ n, ok });

// ── 1. Les deux jeux de tokens, et pas d'effet de bord sur l'app ────────────
const probe = await page.evaluate(() => {
  const before = document.documentElement.getAttribute('data-theme');
  const css = serializeThemeTokens();
  const after = document.documentElement.getAttribute('data-theme');
  return { before, after, css };
});
check('data-theme de l\'app inchangé après sérialisation', probe.before === probe.after);
check('bloc body (tokens sombres) présent', probe.css.includes('body{'));
check('surcharge claire pilotée par la case (unique source de vérité)',
      probe.css.includes('body:has(#theme-switch:checked)'));
check('AUCUN sélecteur data-theme dans les tokens (il gagnerait sur la case)',
      !probe.css.includes('data-theme'));
check('pas de @media prefers-color-scheme (doctrine theme-light.css)',
      !probe.css.includes('prefers-color-scheme'));
// Les deux blocs doivent porter des valeurs DIFFÉRENTES (sinon un seul thème).
const rootBg = /body\{[^}]*--bg:([^;]+);/.exec(probe.css);
const lightBg = /body:has\(#theme-switch:checked\)\{[^}]*--bg:([^;]+);/.exec(probe.css);
check('--bg sombre et clair diffèrent',
      !!rootBg && !!lightBg && rootBg[1].trim() !== lightBg[1].trim());

// ── 2. Export réel, en interactif puis en statique ──────────────────────────
async function buildExport(interactive) {
  return page.evaluate((inter) => {
    const s = loadSettings();
    saveSettings({ ...s, exportInteractive: inter });
    const styleCss = serializeThemeTokens() + EXPORT_CSS + PRISM_THEME_CSS;
    const scriptTag = inter
      ? '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>\n'
      : '';
    return buildExportHtml({
      title: 'Conv de test', dateDisplay: '18 juillet 2026',
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
      styleCss,
      bodyHtml: '<div class="msg assistant"><div class="body"><p>Bonjour</p></div></div>',
      scriptTag,
      kind: 'export',
    });
  }, interactive);
}

const htmlInteractive = await buildExport(true);
const htmlStatic = await buildExport(false);
const fileInteractive = path.join(outDir, 'interactif.html');
const fileStatic = path.join(outDir, 'statique.html');
fs.writeFileSync(fileInteractive, htmlInteractive);
fs.writeFileSync(fileStatic, htmlStatic);

// ── 3. Comportement du fichier exporté interactif ───────────────────────────
const ex = await browser.newPage();
await ex.goto('file://' + fileInteractive);
await ex.waitForSelector('.theme-switch-label');
const readState = () => ex.evaluate(() => ({
  theme: document.getElementById('theme-switch').checked ? 'light' : 'dark',
  bg: getComputedStyle(document.body).backgroundColor,
  color: getComputedStyle(document.body).color,
}));
const s1 = await readState();
await ex.click('.theme-switch-label');
const s2 = await readState();
// L'export de CONVERSATION garde « Exporté / Généré par MIAOU » : le lot R a
// rendu ces libellés variables (kind), une régression y serait silencieuse.
check('export de conv : footer « Généré par MIAOU »', htmlInteractive.includes('Généré par MIAOU'));
check('export de conv : footer « Généré par MIAOU le … »', /Généré par MIAOU le /.test(htmlInteractive));
check('export de conv : pas de vocabulaire de conversion', !/Converti/.test(htmlInteractive));
check('bouton présent en export interactif', true);
check('la bascule change l\'état de la case', s1.theme !== s2.theme);
check('la bascule change le fond réellement calculé', s1.bg !== s2.bg);
check('la bascule change la couleur de texte', s1.color !== s2.color);

// Persistance : rechargement du même fichier.
await ex.reload();
await ex.waitForSelector('.theme-switch-label');
const s3 = await readState();
check('override persisté au rechargement', s3.theme === s2.theme);
await ex.close();

// ── 4. Export statique : aucun bouton, thème figé ───────────────────────────
const st = await browser.newPage();
await st.goto('file://' + fileStatic);
const hasBtn = await st.evaluate(() => !!document.querySelector('.theme-switch-label'));
const staticTheme = await st.evaluate(() => document.getElementById('theme-switch').checked ? 'light' : 'dark');
check('bouton PRÉSENT même en export statique (bascule sans JS)', hasBtn);
check('export statique ouvre sur le thème d\'export', staticTheme === probe.before);
check('export statique sans <script>', !htmlStatic.includes('<script>'));
await st.close();

// ── 5. LE cas du lot R révisé : bascule SANS JavaScript ─────────────────────
// Motif du changement : les visionneuses de pièces jointes (Quick Look iOS)
// n'exécutent aucun script — un bouton construit en JS y est simplement absent
// (constaté par Julien sur iPhone). La case + label doit marcher sans JS.
for (const [label, file] of [['interactif', fileInteractive], ['statique', fileStatic]]) {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  await p.goto('file://' + file);
  const has = await p.locator('.theme-switch-label').count();
  check('sans JS (' + label + ') : le bouton est dans le DOM', has === 1);
  // Sans JS on ne peut pas evaluate() : on compare deux captures du même coin.
  const shotBefore = await p.screenshot({ clip: { x: 0, y: 0, width: 300, height: 60 } });
  await p.click('.theme-switch-label');
  const shotAfter = await p.screenshot({ clip: { x: 0, y: 0, width: 300, height: 60 } });
  check('sans JS (' + label + ') : le clic change le rendu',
        Buffer.compare(shotBefore, shotAfter) !== 0);
  await ctx.close();
}

await browser.close();

let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log(ok ? '\nOK' : '\nÉCHEC');
console.log('exports de test : ' + outDir);
process.exit(ok ? 0 : 1);
