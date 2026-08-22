#!/usr/bin/env node
// Lot S-a — vérification de l'axe « palette » (Garde-robe).
// Un seul lancement, checklist :
//   1. NON-RÉGRESSION : les tokens résolus d'Ambre (défaut) sont identiques
//      aux hex d'avant le refactor HSL, en sombre ET en clair (tolérance 1/255,
//      la dérivation ayant été mesurée à 1/255 sombre et 3/255 clair).
//   2. Les trois palettes changent bien les fonds ET l'accent, dans les deux thèmes.
//   3. Orthogonalité : changer de palette ne touche pas data-theme, et
//      inversement (les deux axes sont indépendants).
//   4. Persistance + rechargement sans flash (data-palette posé par le boot).
//   5. EXPORT : THEME_TOKENS reste couvert — aucun token résolu vide, et
//      serializeThemeTokens capture la palette active (byte-neutralité prouvée
//      au RUNTIME, pas par lecture).
// Usage : node verify-palettes.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-palettes');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// Valeurs AVANT refactor (git show HEAD:src/css/base.css / theme-light.css).
const BEFORE_DARK = {
  '--bg': '#0b0c0e', '--surface': '#111316', '--surface-2': '#16181c',
  '--surface-3': '#1c1f24', '--surface-4': '#262b33', '--border': '#232730',
  '--border-2': '#2c313b', '--text': '#e7e8ea', '--text-2': '#9a9ea8',
  '--text-3': '#5e636e', '--accent': '#ff7a45', '--code-bg': '#0e1013',
  '--scrollbar-thumb-hover': '#3a4049', '--code-inline-color': '#ffb894',
};
const BEFORE_LIGHT = {
  '--bg': '#f4efe5', '--surface': '#ede8de', '--surface-2': '#e5dfd4',
  '--surface-3': '#dbd4c7', '--surface-4': '#dbd4c7', '--border': '#cdc7b8',
  '--border-2': '#c1baa8', '--text': '#1e1b18', '--text-2': '#5a5248',
  '--text-3': '#968a7a', '--accent': '#e05f1c', '--code-bg': '#eee8d8',
  '--code-head-bg': '#e6dfc9', '--code-inline-color': '#c45010',
};

const rgbToHex = (s) => {
  const m = String(s).match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return String(s).trim();
  return '#' + m.slice(0, 3).map(v => Math.round(+v).toString(16).padStart(2, '0')).join('');
};
const chanDist = (a, b) => {
  const pa = a.match(/[\da-f]{2}/gi), pb = b.match(/[\da-f]{2}/gi);
  if (!pa || !pb) return 999;
  return Math.max(...[0, 1, 2].map(i => Math.abs(parseInt(pa[i], 16) - parseInt(pb[i], 16))));
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
const shot = async (n) => { await page.screenshot({ path: path.join(outDir, n) }); console.log('  shot  ' + n); };

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-overlay.boot-done', { timeout: 8000 }).catch(() => {});

// getPropertyValue('--x') rend la DÉCLARATION (« hsl(219 12% 4.9%) »), pas la
// couleur calculée : on la fait résoudre par le moteur en la posant sur la
// `color` d'une sonde, dont le computed style est toujours en rgb().
// (L'export, lui, sérialise ces déclarations telles quelles — c'est valide,
// le navigateur qui ouvre la page exportée les interprète.)
const readTokens = (names) => page.evaluate((ns) => {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.documentElement.appendChild(probe);
  const out = {};
  for (const n of ns) {
    probe.style.color = '';
    probe.style.color = `var(${n})`;
    out[n] = getComputedStyle(probe).color;
  }
  probe.remove();
  return out;
}, names);

const setState = async (theme, palette) => {
  await page.evaluate(([t, p]) => { selectTheme(t); selectPalette(p); }, [theme, palette]);
  await page.waitForTimeout(120);
};

// ── 1. Non-régression d'Ambre ───────────────────────────────────────────────
console.log('\n── 1. Ambre : parité avec les hex d\'avant le refactor ──');
// Tolérance par thème : la dérivation HSL a été mesurée à 1/255 en sombre et
// 3/255 en clair (arrondis d'arrondis sur les paliers de saturation).
for (const [mode, ref, tol] of [['dark', BEFORE_DARK, 1], ['light', BEFORE_LIGHT, 3]]) {
  await setState(mode, 'ambre');
  const got = await readTokens(Object.keys(ref));
  let worst = 0, worstTok = '';
  for (const k of Object.keys(ref)) {
    const d = chanDist(rgbToHex(got[k]), ref[k]);
    if (d > worst) { worst = d; worstTok = k; }
  }
  check(`${mode} : tous les tokens à ≤${tol}/255 de l'original (max ${worst} sur ${worstTok})`, worst <= tol);
}

// ── 2. Les palettes changent fonds ET accent ────────────────────────────────
console.log('\n── 2. Les trois palettes se distinguent ──');
const snap = {};
for (const mode of ['dark', 'light']) {
  for (const p of ['ambre', 'foret', 'encre']) {
    await setState(mode, p);
    snap[mode + '/' + p] = await readTokens(['--bg', '--surface-2', '--accent', '--border']);
  }
  for (const [a, b] of [['ambre', 'foret'], ['ambre', 'encre'], ['foret', 'encre']]) {
    const A = snap[mode + '/' + a], B = snap[mode + '/' + b];
    // PAS --bg : à 4.9% de luminosité, 6° de teinte s'arrondissent au même
    // rgb 8 bits (ambre h219 et encre h225 donnent tous deux #0b0c0e). Ce n'est
    // pas un défaut de palette, c'est la profondeur de bits — on compare donc
    // sur --surface-2, assez clair pour que la teinte se matérialise.
    check(`${mode} : ${a} ≠ ${b} sur --surface-2`, rgbToHex(A['--surface-2']) !== rgbToHex(B['--surface-2']));
    check(`${mode} : ${a} ≠ ${b} sur --accent`, rgbToHex(A['--accent']) !== rgbToHex(B['--accent']));
  }
}
// L'accent d'Encre est celui arbitré (h216), pas l'ancien cyan h213.
await setState('dark', 'encre');
const encreDark = rgbToHex((await readTokens(['--accent']))['--accent']);
check(`encre sombre : accent = #4f92f8 (arbitré h216), pas l'ancien #4d9dff (got ${encreDark})`,
      chanDist(encreDark, '#4f92f8') <= 1);

// ── 2bis. Le logotype MIAOU est HORS palette ────────────────────────────────
// Deux emplacements selon que la sidebar est déployée ou repliée : .sidebar-brand
// et .topbar-brand-name. Les deux doivent garder la couleur d'origine quelle que
// soit la palette, mais suivre le thème clair/sombre.
console.log('\n── 2bis. Logotype MIAOU constant d\'une palette à l\'autre ──');
const brandColors = async (mode) => {
  const out = {};
  for (const p of ['ambre', 'encre', 'foret']) {
    await setState(mode, p);
    out[p] = await page.evaluate(() => {
      const pick = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null; };
      return { sidebar: pick('.sidebar-brand'), topbar: pick('.topbar-brand-name') };
    });
  }
  return out;
};
for (const mode of ['dark', 'light']) {
  const b = await brandColors(mode);
  const ref = mode === 'dark' ? '#ff7a45' : '#e05f1c';
  for (const where of ['sidebar', 'topbar']) {
    const vals = ['ambre', 'encre', 'foret'].map(p => b[p][where]);
    check(`${mode}/${where} : présent dans le DOM`, vals.every(v => v !== null));
    check(`${mode}/${where} : identique pour les 3 palettes`, new Set(vals).size === 1);
    check(`${mode}/${where} : couleur d'origine ${ref}`, chanDist(rgbToHex(vals[0] || ''), ref) <= 1);
  }
}

// ── 3. Orthogonalité des deux axes ──────────────────────────────────────────
console.log('\n── 3. Orthogonalité palette × thème ──');
await setState('dark', 'foret');
const themeAfterPalette = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
check('changer de palette ne touche pas data-theme', themeAfterPalette === 'dark');
await page.evaluate(() => selectTheme('light'));
await page.waitForTimeout(120);
const palAfterTheme = await page.evaluate(() => document.documentElement.getAttribute('data-palette'));
check('changer de thème ne touche pas data-palette', palAfterTheme === 'foret');
// Ambre = défaut → aucun attribut (pas de data-palette orphelin).
await page.evaluate(() => selectPalette('ambre'));
await page.waitForTimeout(120);
const ambreAttr = await page.evaluate(() => document.documentElement.getAttribute('data-palette'));
check('ambre (défaut) ne pose aucun attribut data-palette', ambreAttr === null);
// Valeur inconnue → repli sur ambre, pas d'attribut orphelin.
await page.evaluate(() => applyPalette('nawak'));
await page.waitForTimeout(60);
const bogus = await page.evaluate(() => document.documentElement.getAttribute('data-palette'));
check('palette inconnue → repli ambre (aucun attribut)', bogus === null);

// ── 4. Persistance + boot sans flash ────────────────────────────────────────
console.log('\n── 4. Persistance et rechargement ──');
await setState('dark', 'encre');
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
const bootAttr = await page.evaluate(() => document.documentElement.getAttribute('data-palette'));
check('après reload, data-palette=encre est posé', bootAttr === 'encre');
const persisted = await page.evaluate(() => (JSON.parse(localStorage.getItem('miaou-settings') || '{}')).palette);
check('palette persistée dans miaou-settings', persisted === 'encre');
await page.waitForSelector('.boot-overlay.boot-done', { timeout: 8000 }).catch(() => {});
await shot('01-encre-sombre.png');
await page.evaluate(() => selectTheme('light'));
await page.waitForTimeout(150);
await shot('02-encre-clair.png');
await page.evaluate(() => { selectTheme('dark'); selectPalette('foret'); });
await page.waitForTimeout(150);
await shot('03-foret-sombre.png');

// ── 5. Export : couverture de THEME_TOKENS au runtime ───────────────────────
console.log('\n── 5. Export (byte-neutralité prouvée au runtime) ──');
const tokenCoverage = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const empty = THEME_TOKENS.filter(n => !cs.getPropertyValue(n).trim());
  return { total: THEME_TOKENS.length, empty };
});
check(`aucun THEME_TOKENS vide (${tokenCoverage.total} tokens)`, tokenCoverage.empty.length === 0);
if (tokenCoverage.empty.length) console.log('        vides : ' + tokenCoverage.empty.join(', '));

// serializeThemeTokens doit refléter la palette ACTIVE, et porter les deux thèmes.
const ser = await page.evaluate(() => {
  const before = document.documentElement.getAttribute('data-theme');
  const out = { foret: serializeThemeTokens() };
  selectPalette('encre');
  out.encre = serializeThemeTokens();
  selectPalette('foret');
  out.themeRestored = document.documentElement.getAttribute('data-theme') === before;
  return out;
});
check('serializeThemeTokens change avec la palette', ser.foret !== ser.encre);
check('serializeThemeTokens porte les deux thèmes (body{…} + sélecteur clair)',
      /body\{/.test(ser.encre) && /theme-switch:checked/.test(ser.encre));
check('serializeThemeTokens restaure data-theme (try/finally)', ser.themeRestored === true);
// Le CSS sérialisé ne doit contenir aucune var() non résolue.
check('aucun var(--…) non résolu dans le CSS exporté', !/var\(--/.test(ser.encre));


// ── 6. Synchro multi-onglets : rendu ET boutons du drawer ──────────────────
// Régression payée : le récepteur `apply-settings` ré-appliquait le RENDU
// (applyTheme/applyPalette/applyFonts/applyMotion) sans rafraîchir les
// segments du drawer (setXxxUI). Un onglet avec les réglages ouverts affichait
// donc l'ancien choix alors que son écran avait changé.
console.log('\n── 6. Propagation multi-onglets (rendu + drawer) ──');
{
  const ctx2 = await browser.newContext();
  const tabA = await ctx2.newPage();
  const tabB = await ctx2.newPage();
  await tabA.goto('file://' + distPath); await tabA.waitForSelector('#composer-text');
  await tabB.goto('file://' + distPath); await tabB.waitForSelector('#composer-text');
  await tabA.evaluate(() => { selectTheme('dark'); selectPalette('ambre'); selectFonts('graphite'); });
  await tabA.waitForTimeout(400);
  await tabB.evaluate(() => { if (typeof openSettings === 'function') openSettings(); });
  await tabB.waitForTimeout(350);
  await tabA.evaluate(() => { selectTheme('light'); selectPalette('encre'); selectFonts('atelier'); });
  await tabA.waitForTimeout(800);
  const seen = await tabB.evaluate(() => {
    const root = document.documentElement;
    const seg = id => { const e = document.querySelector('#' + id + ' .seg.active'); return e ? e.getAttribute('data-mode') : null; };
    return {
      theme: root.getAttribute('data-theme'), palette: root.getAttribute('data-palette'),
      fonts: root.getAttribute('data-fonts'),
      segTheme: seg('theme-mode'), segPalette: seg('palette-mode'), segFonts: seg('fonts-mode'),
    };
  });
  check('le rendu du pair suit (thème, palette, fontes)',
        seen.theme === 'light' && seen.palette === 'encre' && seen.fonts === 'atelier');
  check('les segments du drawer du pair suivent aussi',
        seen.segTheme === 'light' && seen.segPalette === 'encre' && seen.segFonts === 'atelier');
  await ctx2.close();
}

console.log('\n── Erreurs console ──');
check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) consoleErrors.slice(0, 5).forEach(e => console.log('        ' + e));

console.log('\n────────────────────────────────────────────');
if (failures.length) {
  console.log(`  ÉCHEC — ${failures.length} assertion(s) :`);
  failures.forEach(f => console.log('   - ' + f));
} else {
  console.log('  OK — toutes les assertions passent');
}
await browser.close();
process.exit(failures.length ? 1 : 0);
