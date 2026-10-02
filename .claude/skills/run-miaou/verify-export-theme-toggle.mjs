// Vérifie la bascule de thème dans l'export HTML (points 1+2) :
//  - serializeThemeTokens émet les DEUX jeux (:root + html[data-theme=light])
//  - la mesure du thème inactif ne laisse PAS l'app sur le mauvais thème
//  - le bouton n'existe qu'en export interactif
//  - la bascule change réellement les couleurs calculées dans le fichier exporté
//  - l'override est persisté et re-appliqué au rechargement
//  - les diagrammes Mermaid suivent la bascule, avec et sans JS (section 6) :
//    deux variantes par diagramme, une seule visible, celle du thème affiché
import { launchIsolated } from './stub-backend.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const outDir = path.resolve(dir, 'tmp-export-theme');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await launchIsolated();
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
  return { before, after, css, firstPalette: PALETTES[0] };
});
check('data-theme de l\'app inchangé après sérialisation', probe.before === probe.after);
check('bloc body (tokens sombres) présent', probe.css.includes('body{'));
// Depuis la pastille de palette, chaque jeu est porté par (palette, case) :
// `body:has(#pal-P:checked)` en sombre, `…:has(#theme-switch:checked)` en
// clair. On lit celui de la première palette, lue dans l'application.
check('surcharge claire pilotée par la case (unique source de vérité)',
      probe.css.includes('body:has(#pal-' + probe.firstPalette + ':checked):has(#theme-switch:checked){'));
check('AUCUN sélecteur data-theme dans les tokens (il gagnerait sur la case)',
      !probe.css.includes('data-theme'));
check('pas de @media prefers-color-scheme (doctrine theme-light.css)',
      !probe.css.includes('prefers-color-scheme'));
// Les deux blocs doivent porter des valeurs DIFFÉRENTES (sinon un seul thème).
const palSel = 'body:has\\(#pal-' + probe.firstPalette + ':checked\\)';
const rootBg = new RegExp(palSel + '\\{[^}]*--bg:([^;]+);').exec(probe.css);
const lightBg = new RegExp(palSel + ':has\\(#theme-switch:checked\\)\\{[^}]*--bg:([^;]+);').exec(probe.css);
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
// Depuis `493799d`, le mot « MIAOU » du footer porte le lien vers le dépôt : le
// libellé est SCINDÉ (EXPORT_VERBS.footerPrefix + exportBrandHtml), donc la
// chaîne « Généré par MIAOU » n'existe plus d'un bloc dans le HTML. On teste la
// structure réelle — préfixe, nom lié, date — plutôt qu'un littéral qui
// re-casserait au prochain habillage du nom.
check('export de conv : footer « Généré par » + nom lié',
  /Généré par <a class="export-brand"[^>]*>MIAOU<\/a>/.test(htmlInteractive));
check('export de conv : footer « Généré par MIAOU le … »',
  /Généré par <a class="export-brand"[^>]*>MIAOU<\/a> le /.test(htmlInteractive));
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

// ── 6. Diagrammes Mermaid : deux variantes qui suivent la case ──────────────
// Passe par le VRAI chemin de production (convertMarkdownToHtmlFile, qui
// compose lui-même styleCss et appelle embedExportMermaid) plutôt qu'une
// composition recopiée ici : un oubli d'exportMermaidThemeCss au point de
// composition doit rougir ce bloc. Exige le CDN Mermaid (réseau).
// Trois blocs : un invalide (aucune vue), un diagramme nu (deux variantes
// attendues), un diagramme qui fixe son thème (une seule vue, sans classe de
// variante, toujours visible). L'ORDRE compte pour le contrôle de fuite : le
// dernier rendu forcé doit être la variante claire du diagramme nu — placé
// après, l'invalide (rendu sombre puis échec) remettrait une config globale
// sombre par accident et masquerait une fuite (mesuré en injectant un forçage
// par mermaidInit).
// Un bloc JavaScript s'y ajoute en témoin Prism : ses couleurs viennent de
// PRISM_THEME_CSS, dont prismThemeCssForExport réécrit les surcharges claires
// sur la case — il doit suivre la bascule lui aussi (bug historique « l'icône
// change mais pas les couleurs »), ce qu'aucun autre contrôle ne mesurait.
// Prémisse du contrôle de fuite : la session est en SOMBRE, et la dernière
// variante rendue à l'export est la CLAIRE — une directive qui fuirait dans la
// config globale ferait donc sortir le rendu de sonde en clair.
// Le profil headless est en clair (thème « système ») : on émule un OS sombre,
// que le suivi matchMedia de l'app répercute sur data-theme.
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark',
  null, { timeout: 5000 }).catch(() => {});
const sessionTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
check('prémisse : la session est en thème sombre', sessionTheme === 'dark');
const md = [
  '# Diagrammes',
  '',
  '```mermaid',
  'graph TD',
  '  E[Cassé --> F]]]',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A[Nu] --> B[Suit le thème]',
  '```',
  '',
  '```mermaid',
  "%%{init: {'theme': 'forest'}}%%",
  'graph TD',
  '  C[Épinglé] --> D[Forest]',
  '```',
  '',
  '```javascript',
  'const f = function () { return 1; };',
  '```',
  // Remplissage : de quoi défiler, pour le contrôle de position ci-dessous.
  ...Array.from({ length: 80 }, (_, i) => '\nParagraphe de remplissage ' + (i + 1) + '.'),
].join('\n');
const mdHtml = await page.evaluate(async (src) => {
  const s = loadSettings();
  saveSettings({ ...s, exportInteractive: true });
  return await convertMarkdownToHtmlFile(src, 'diagrammes.md');
}, md);
const fileMermaid = path.join(outDir, 'mermaid.html');
fs.writeFileSync(fileMermaid, mdHtml);

// Fuite de thème vers l'écran : un rendu SANS directive, après l'export, doit
// sortir dans le thème de session (fond de nœud sombre).
const probeFill = await page.evaluate(async () => {
  const out = await mermaid.render('xprobe' + Date.now(), 'graph TD\n  P[Sonde] --> Q[Ecran]');
  const host = document.createElement('div');
  host.innerHTML = out.svg;
  document.body.appendChild(host);
  const rect = host.querySelector('.node rect, .node polygon');
  const fill = rect ? getComputedStyle(rect).fill : null;
  host.remove();
  return fill;
});

// Luminance relative d'une couleur calculée « rgb(r, g, b) » (0 noir → 1 blanc).
const lum = (c) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
  if (!m) return NaN;
  return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
};
check('après export, un rendu à l\'écran reste dans le thème de session (pas de fuite)',
      lum(probeFill) < 0.3);

// État du fichier exporté : vues présentes, visibles, et fond du premier nœud
// de chaque vue VISIBLE. Lu par locator (fonctionne JS désactivé : le script
// injecté par Playwright tourne dans son propre monde).
async function mermaidState(p) {
  const views = p.locator('.mermaid-view');
  const n = await views.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = views.nth(i);
    const cls = (await v.getAttribute('class')) || '';
    const visible = await v.isVisible();
    const fill = await v.locator('.node rect, .node polygon').first()
      .evaluate(el => getComputedStyle(el).fill).catch(() => null);
    out.push({ cls, visible, fill });
  }
  return out;
}
const variantOf = (st, name) => st.find(v => v.cls.includes(name));
const pinned = (st) => st.find(v => !/mermaid-for-/.test(v.cls));

for (const js of [true, false]) {
  const tag = js ? 'avec JS' : 'sans JS';
  const ctx = await browser.newContext({ javaScriptEnabled: js });
  const p = await ctx.newPage();
  await p.goto('file://' + fileMermaid);
  if (js) await p.evaluate(() => localStorage.removeItem('miaou-export-theme'));
  if (js) await p.reload();
  const a = await mermaidState(p);
  const dark = variantOf(a, 'mermaid-for-dark');
  const light = variantOf(a, 'mermaid-for-light');
  const pin = pinned(a);
  check(tag + ' : trois vues (deux variantes + l\'épinglé, rien pour l\'invalide)', a.length === 3);
  check(tag + ' : la variante sombre est rendue en sombre', !!dark && lum(dark.fill) < 0.3);
  check(tag + ' : ouverture en sombre → seule la variante sombre visible',
        !!dark && !!light && dark.visible === true && light.visible === false);
  check(tag + ' : l\'épinglé est visible', !!pin && pin.visible === true);
  const kw = p.locator('.export-body .token.keyword').first();
  const kwCount = await p.locator('.export-body .token.keyword').count();
  const kwColor = () => kw.evaluate(el => getComputedStyle(el).color).catch(() => null);
  const kw1 = await kwColor();
  // Le clic sur le label ne doit pas faire défiler : le label donne le focus à
  // la case, et le navigateur amène à l'écran l'élément qui le reçoit — la case
  // étant en tête de body, la page remontait tout en haut. Mesuré en bas du
  // document, là où un retour en haut se voit.
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(100);
  const y1 = await p.evaluate(() => window.scrollY);
  // Clic SOURIS aux coordonnées, pas locator.click : celui-ci fait d'abord
  // défiler jusqu'à l'élément, et sur un porteur collé (le cartouche est
  // sticky) il ramène la page vers sa position d'origine — 368px mesurés,
  // alors qu'un vrai clic, de même que le seul focus de la case, ne bouge
  // rien. C'est le geste de l'utilisateur qui est le sujet ici.
  const lb = await p.evaluate(() => { const r = document.querySelector('.theme-switch-label').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.click(lb.x, lb.y);
  await p.waitForTimeout(150);
  const y2 = await p.evaluate(() => window.scrollY);
  check(tag + ' : prémisse — la page est défilée avant le clic (y=' + y1 + ')', y1 > 500);
  check(tag + ' : la bascule ne fait pas défiler la page (' + y1 + ' → ' + y2 + ')',
        Math.abs(y2 - y1) <= 2);
  const kw2 = await kwColor();
  check(tag + ' : Prism a tokenisé le bloc (prémisse)', kwCount > 0);
  check(tag + ' : la couleur d\'un mot-clé Prism suit la bascule',
        !!kw1 && !!kw2 && kw1 !== kw2);
  const b = await mermaidState(p);
  const dark2 = variantOf(b, 'mermaid-for-dark');
  const light2 = variantOf(b, 'mermaid-for-light');
  const pin2 = pinned(b);
  check(tag + ' : après bascule → seule la variante claire visible',
        !!dark2 && !!light2 && dark2.visible === false && light2.visible === true);
  check(tag + ' : la variante claire est rendue en clair', !!light2 && lum(light2.fill) > 0.7);
  check(tag + ' : l\'épinglé reste visible et garde son thème',
        !!pin2 && pin2.visible === true && pin2.fill === pin.fill);
  await ctx.close();
}

await browser.close();

let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log(ok ? '\nOK' : '\nÉCHEC');
console.log('exports de test : ' + outDir);
process.exit(ok ? 0 : 1);
