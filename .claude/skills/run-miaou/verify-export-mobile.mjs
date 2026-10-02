// Vérifie la mise en page des pages exportées, mobile et grand écran :
//  - <meta viewport> présent (sans lui, aucune media query mobile ne se
//    déclenche et le texte paraît minuscule)
//  - zoom neutralisé sous 767px, conservé au-dessus
//  - taille de texte effectivement plus grande sur mobile qu'avant le correctif
//  - pas de scroll horizontal du body
//  - titre jamais chevauché par la bascule de thème (constaté sur iPhone)
//  - largeur de colonne réglable sans JavaScript (radios .col-w, contrôle
//    « – + ») : cran d'ouverture = celui de l'application, largeur = base x
//    COL_WIDTH_STEPS lu dans l'application (jamais recopié), un clic sur le
//    label visible change de cran, les flèches du clavier aussi, butées
//    éteintes, cran retenu au rechargement (EXPORT_SCRIPT) ;
//  - cartouche collé en haut à toutes les largeurs, commandes (en flux dans
//    sa barre) alignées sur le bord droit de son CONTENU et centrées sur sa
//    hauteur, avant ET après défilement (le cartouche se resserre), empreinte
//    dans le flux constante ;
//  - Markdown converti SANS titre : pas de cartouche, les boutons flottent hors
//    de la colonne, comme la bascule l'a toujours fait ;
//  - palette : pastille de la couleur ACTIVE (son disque est var(--accent)),
//    un clic passe à la suivante dans l'ordre de PALETTES (lu dans
//    l'application), l'accent résolu change à chaque palette et en clair,
//    retour à la première après un tour, palette retenue au rechargement ;
//  - mobile : contrôle de largeur masqué, mêmes alignements que sur grand écran
//    pour la seule bascule, avant et après défilement.
// Le bord du contenu est lu sur un élément en flux (premier enfant du corps),
// pas déduit d'un padding : le zoom 0.9 de l'export rendrait ce calcul faux.
import { devices } from 'playwright';
import { launchIsolated } from './stub-backend.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const outDir = path.resolve(dir, 'tmp-export-mobile');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Assez de texte pour défiler bien au-delà de la plage de resserrement (80px).
const FILLER = Array.from({ length: 40 }, (_, i) =>
  'Paragraphe ' + (i + 1) + ' : un texte courant qui occupe plusieurs lignes, ' +
  'pour que la page défile nettement au-delà du cartouche.').join('\n\n');

const TABLE_AND_CODE = `| Colonne A | Colonne B | Colonne C |
| --- | --- | --- |
| valeur assez longue | autre valeur | troisième |

\`\`\`python
def une_fonction_au_nom_plutot_long(parametre):
    return parametre * 2
\`\`\`
`;

const MD_TITLED = `# Document de test au titre assez long pour se rapprocher des boutons

Un paragraphe de texte courant pour mesurer la taille de rendu effective sur
mobile, avec suffisamment de mots pour occuper plusieurs lignes.

${TABLE_AND_CODE}
${FILLER}
`;
const MD_UNTITLED = `Un document sans titre de niveau 1 : aucun cartouche.

${TABLE_AND_CODE}
${FILLER}
`;

// Cran d'ouverture choisi ≠ 0 : un export qui ignorerait le réglage ouvrirait
// au cran 0 et serait vu.
const OPEN_STEP = 1;

const browser = await launchIsolated();
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => typeof convertMarkdownToHtmlFile === 'function');
const { titled, untitled, steps, palettes, appPalette } = await page.evaluate(async ({ a, b, step }) => {
  const s = loadSettings();
  saveSettings({ ...s, exportInteractive: true, colWidth: step });
  return {
    titled: await convertMarkdownToHtmlFile(a, 'test-titled.md'),
    untitled: await convertMarkdownToHtmlFile(b, 'test-untitled.md'),
    steps: COL_WIDTH_STEPS.slice(),
    palettes: PALETTES.slice(),
    appPalette: loadSettings().palette,
  };
}, { a: MD_TITLED, b: MD_UNTITLED, step: OPEN_STEP });
await page.close();

const fileTitled = path.join(outDir, 'export.html');
const fileUntitled = path.join(outDir, 'export-untitled.html');
fs.writeFileSync(fileTitled, titled);
fs.writeFileSync(fileUntitled, untitled);

const results = [];
const check = (n, ok, info) => results.push({ n, ok, info });
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

check('<meta viewport> présent', /<meta name="viewport"[^>]*width=device-width/.test(titled));
check('media query mobile présente', /@media \(max-width: 767px\)/.test(titled));
check('prémisse : l\'application a au moins deux crans', steps.length >= 2, 'steps=' + JSON.stringify(steps));

// Géométrie de la page à l'instant : boutons, cartouche, bord du contenu.
async function geom(p) {
  return p.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    // offsetParent est null pour tout élément en position: fixed : on lit les boîtes.
    const visible = (el) => !!el && el.getClientRects().length > 0;
    const theme = document.querySelector('.theme-switch-label');
    const swatch = [...document.querySelectorAll('.pal-swatch')].find(visible) || null;
    const ctl = document.querySelector('.col-width-ctl');
    const wrap = document.querySelector('.export-topbar-wrap');
    const content = document.querySelector('.export-body > *');
    const pairs = [...document.querySelectorAll('.col-w-pair')].filter(visible);
    const checked = document.querySelector('.col-w:checked');
    return {
      zoom: getComputedStyle(document.documentElement).zoom,
      fontPx: parseFloat(getComputedStyle(document.querySelector('.export-body p')).fontSize),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      scrollY: window.scrollY,
      theme: r(theme), swatch: r(swatch), ctl: visible(ctl) ? r(ctl) : null, ctlShown: visible(ctl),
      wrap: r(wrap), wrapPos: wrap ? getComputedStyle(wrap).position : null,
      title: r(document.querySelector('.export-title')),
      content: r(content),
      contentDocTop: content ? content.getBoundingClientRect().top + window.scrollY : null,
      bodyW: r(document.querySelector('.export-body')).w,
      step: checked ? Number(checked.value) : null,
      visiblePairs: pairs.length,
      offDec: pairs[0] ? !!pairs[0].firstElementChild.classList.contains('is-off') : null,
      offInc: pairs[0] ? !!pairs[0].lastElementChild.classList.contains('is-off') : null,
      offOpacity: (() => { const o = document.querySelector('.col-w-pair .is-off'); return o ? parseFloat(getComputedStyle(o).opacity) : null; })(),
    };
  });
}

// Visible pair → clic sur son « – » (premier) ou son « + » (dernier) : c'est
// le pointage qui est le sujet ici, d'où un vrai clic.
async function clickStep(p, which) {
  const pair = p.locator('.col-w-pair:visible');
  await pair.locator(which === 'inc' ? '.col-width-btn >> nth=1' : '.col-width-btn >> nth=0').click();
  await p.waitForTimeout(300);   // transition de largeur (180ms)
}

// Alignements attendus quand le cartouche est collé.
function checkDocked(g, label) {
  check(label + ' : bascule au bord droit du contenu', near(g.theme.r, g.content.r, 1.5),
    'theme.r=' + g.theme.r.toFixed(1) + ' content.r=' + g.content.r.toFixed(1));
  const wc0 = (g.wrap.t + g.wrap.b) / 2;
  check(label + ' : bascule centrée sur la hauteur du cartouche', near((g.theme.t + g.theme.b) / 2, wc0, 2),
    'theme.c=' + ((g.theme.t + g.theme.b) / 2).toFixed(1) + ' wrap.c=' + wc0.toFixed(1));
  check(label + ' : bascule contenue dans le cartouche', g.theme.t >= g.wrap.t && g.theme.b <= g.wrap.b,
    'wrap=[' + g.wrap.t.toFixed(1) + ',' + g.wrap.b.toFixed(1) + '] theme=[' + g.theme.t.toFixed(1) + ',' + g.theme.b.toFixed(1) + ']');
  check(label + ' : titre non chevauché', g.title.r < (g.ctl ? g.ctl.l : g.theme.l),
    'title.r=' + g.title.r.toFixed(1) + ' cmd.l=' + (g.ctl ? g.ctl.l : g.theme.l).toFixed(1));
  check(label + ' : pas de scroll horizontal', g.scrollW <= g.clientW + 1, g.scrollW + '/' + g.clientW);
  const gapS = g.theme.l - g.swatch.r;
  check(label + ' : pastille de palette à gauche de la bascule, écart 6 à 9px', gapS >= 6 && gapS <= 9, 'gap=' + gapS.toFixed(1));
  if (!g.ctl) return;
  const gap = g.swatch.l - g.ctl.r;
  check(label + ' : contrôle de largeur à gauche de la pastille, écart 6 à 9px', gap >= 6 && gap <= 9, 'gap=' + gap.toFixed(1));
  const wc = wc0;
  check(label + ' : contrôle centré sur la hauteur du cartouche', near((g.ctl.t + g.ctl.b) / 2, wc, 2),
    'ctl.c=' + ((g.ctl.t + g.ctl.b) / 2).toFixed(1) + ' wrap.c=' + wc.toFixed(1));
  check(label + ' : contrôle contenu dans le cartouche', g.ctl.t >= g.wrap.t && g.ctl.b <= g.wrap.b,
    'ctl=[' + g.ctl.t.toFixed(1) + ',' + g.ctl.b.toFixed(1) + ']');
}

// ── Mobile ───────────────────────────────────────────────────────────────────
const mctx = await browser.newContext(devices['iPhone 13']);
const mp = await mctx.newPage();
await mp.goto('file://' + fileTitled);
const mobile = await geom(mp);
await mp.screenshot({ path: path.join(outDir, 'mobile.png'), fullPage: true });
check('zoom neutralisé sur mobile', String(mobile.zoom) === '1', mobile.zoom);
check('texte au moins aussi grand sur mobile qu\'en CSS nominal', mobile.fontPx >= 14, mobile.fontPx);
check('contrôle de largeur masqué sur mobile', mobile.ctlShown === false);
check('cartouche collé sur mobile', mobile.wrapPos === 'sticky', mobile.wrapPos);
checkDocked(mobile, 'mobile');
await mp.evaluate(() => window.scrollTo(0, 600));
await mp.waitForTimeout(200);
const mScrolled = await geom(mp);
check('mobile défilé : cartouche collé en haut et resserré', near(mScrolled.wrap.t, 0, 0.5) && mScrolled.wrap.h < mobile.wrap.h,
  'wrap.t=' + mScrolled.wrap.t + ' h ' + mobile.wrap.h.toFixed(1) + ' → ' + mScrolled.wrap.h.toFixed(1));
checkDocked(mScrolled, 'mobile défilé');
await mctx.close();

// ── Grand écran, document avec cartouche ─────────────────────────────────────
const dctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const dp = await dctx.newPage();
await dp.goto('file://' + fileTitled);
await dp.waitForTimeout(300);
let g = await geom(dp);
await dp.screenshot({ path: path.join(outDir, 'desktop.png') });
check('zoom 0.9 conservé sur desktop', String(g.zoom).startsWith('0.9'), g.zoom);
check('cartouche collé (sticky) sur grand écran', g.wrapPos === 'sticky', g.wrapPos);
check('ouverture au cran de l\'application', g.step === OPEN_STEP, 'step=' + g.step);
check('une seule paire de boutons affichée', g.visiblePairs === 1, g.visiblePairs);

// Largeurs par cran, rapportées au cran 0 : ratio = COL_WIDTH_STEPS.
const widths = {};
await clickStep(dp, 'dec');
g = await geom(dp);
check('clic sur « – » : cran ' + (OPEN_STEP - 1), g.step === OPEN_STEP - 1, 'step=' + g.step);
widths[g.step] = g.bodyW;
check('cran 0 : « – » éteint, « + » actif', g.offDec === true && g.offInc === false, 'offDec=' + g.offDec + ' offInc=' + g.offInc);
check('bouton éteint encore lisible (opacité ≥ 0.6)', g.offOpacity >= 0.6, g.offOpacity);
checkDocked(g, 'cran 0');
for (let i = 1; i < steps.length; i++) {
  await clickStep(dp, 'inc');
  g = await geom(dp);
  check('clic sur « + » : cran ' + i, g.step === i, 'step=' + g.step);
  widths[i] = g.bodyW;
  check('cran ' + i + ' : largeur = base x ' + steps[i], near(widths[i] / widths[0], steps[i] / steps[0], 0.01),
    'ratio=' + (widths[i] / widths[0]).toFixed(3));
  checkDocked(g, 'cran ' + i);
}
const last = steps.length - 1;
check('dernier cran : « + » éteint, « – » actif', g.offInc === true && g.offDec === false, 'offDec=' + g.offDec + ' offInc=' + g.offInc);

// Défilement : cartouche toujours en haut, resserré, boutons recentrés,
// empreinte du cartouche dans le flux inchangée.
const before = g;
await dp.evaluate(() => window.scrollTo(0, 600));
await dp.waitForTimeout(200);
g = await geom(dp);
check('prémisse : la page a défilé', g.scrollY >= 500, 'scrollY=' + g.scrollY);
check('défilé : cartouche collé en haut', near(g.wrap.t, 0, 0.5), 'wrap.t=' + g.wrap.t);
check('défilé : cartouche resserré (au moins 15px de moins)', before.wrap.h - g.wrap.h >= 15,
  'avant=' + before.wrap.h.toFixed(1) + ' après=' + g.wrap.h.toFixed(1));
check('défilé : empreinte dans le flux inchangée', near(g.contentDocTop, before.contentDocTop, 1),
  'avant=' + before.contentDocTop.toFixed(1) + ' après=' + g.contentDocTop.toFixed(1));
checkDocked(g, 'défilé');

// Clavier : les radios portent l'accès, les flèches changent de cran.
await dp.evaluate(() => document.querySelector('.col-w:checked').focus());
await dp.keyboard.press('ArrowLeft');
await dp.waitForTimeout(250);
g = await geom(dp);
check('flèche gauche sur le radio : cran ' + (last - 1), g.step === last - 1, 'step=' + g.step);

// Persistance (export interactif) : le cran choisi survit au rechargement.
await dp.reload();
await dp.waitForTimeout(300);
g = await geom(dp);
check('cran retenu au rechargement', g.step === last - 1, 'step=' + g.step);

// Palette. Couleurs RÉSOLUES par le moteur (la déclaration d'un token est une
// chaîne hsl(), cf. docs/palettes.md) : disque de la pastille et accent lu sur
// une sonde. Une seule pastille visible, celle de la palette cochée.
async function pal(p) {
  return p.evaluate(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0;
    const sw = [...document.querySelectorAll('.pal-swatch')].filter(visible);
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const c = document.querySelector('.pal-r:checked');
    return { checked: c ? c.value : null, visible: sw.length,
      disc: sw[0] ? getComputedStyle(sw[0], '::before').backgroundColor : null, accent };
  });
}
check('prémisse : au moins deux palettes', palettes.length >= 2, JSON.stringify(palettes));
let pv = await pal(dp);
check('palette d\'ouverture = celle de l\'application', pv.checked === (appPalette || palettes[0]), pv.checked + ' / app ' + appPalette);
check('une seule pastille de palette visible', pv.visible === 1, pv.visible);
const startPal = pv.checked;
const seen = [pv.accent];
for (let k = 1; k <= palettes.length; k++) {
  check('pastille de la couleur active (' + pv.checked + ')', pv.disc === pv.accent, pv.disc + ' / ' + pv.accent);
  await dp.locator('.pal-swatch:visible').click();
  await dp.waitForTimeout(150);
  const prev = pv;
  pv = await pal(dp);
  const expected = palettes[(palettes.indexOf(prev.checked) + 1) % palettes.length];
  check('clic sur la pastille : ' + prev.checked + ' → ' + expected, pv.checked === expected, pv.checked);
  if (k < palettes.length) {
    check('accent changé (' + pv.checked + ')', !seen.includes(pv.accent), pv.accent + ' déjà vu parmi ' + seen.join(' | '));
    seen.push(pv.accent);
  }
}
check('un tour complet ramène à la palette de départ', pv.checked === startPal && pv.accent === seen[0], pv.checked + ' ' + pv.accent);
// Autre luminosité : même palette, autre accent (combinaison palette x
// luminosité). Le sens dépend du thème de l'application au moment de l'export.
await dp.click('.theme-switch-label');
await dp.waitForTimeout(150);
const lightPv = await pal(dp);
check('autre luminosité : accent différent pour la même palette', lightPv.checked === startPal && lightPv.accent !== pv.accent, lightPv.accent + ' vs ' + pv.accent);
check('autre luminosité : pastille toujours de la couleur active', lightPv.disc === lightPv.accent, lightPv.disc + ' / ' + lightPv.accent);
// Mémoire : on quitte la palette de départ, on recharge.
await dp.locator('.pal-swatch:visible').click();
await dp.waitForTimeout(150);
const chosen = (await pal(dp)).checked;
await dp.reload();
await dp.waitForTimeout(300);
pv = await pal(dp);
check('palette retenue au rechargement', pv.checked === chosen && chosen !== startPal, pv.checked + ' / choisie ' + chosen);
await dctx.close();

// ── Grand écran, document sans cartouche ─────────────────────────────────────
const uctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const up = await uctx.newPage();
await up.goto('file://' + fileUntitled);
await up.waitForTimeout(300);
g = await geom(up);
check('sans titre : aucun cartouche', g.wrap === null);
check('sans titre : bascule hors du contenu (flottante)', g.theme.l >= g.content.r, 'theme.l=' + g.theme.l.toFixed(1) + ' content.r=' + g.content.r.toFixed(1));
check('sans titre : contrôle présent, à gauche de la bascule', g.ctlShown && g.ctl.r <= g.theme.l, g.ctl && ('ctl.r=' + g.ctl.r.toFixed(1)));
check('sans titre : pas de scroll horizontal', g.scrollW <= g.clientW + 1, g.scrollW + '/' + g.clientW);
await uctx.close();

await browser.close();

let ok = true;
for (const r of results) {
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.info !== undefined ? '  [' + r.info + ']' : ''));
  if (!r.ok) ok = false;
}
console.log(ok ? '\nOK' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
