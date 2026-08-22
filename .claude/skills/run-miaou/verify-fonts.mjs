#!/usr/bin/env node
// Lot S-b — vérification de l'axe « lots de fontes » (Garde-robe).
// Checklist :
//   1. Les trois lots appliquent bien leur PAIRE (sans + mono) sur le DOM réel.
//   2. Les familles sont RÉELLEMENT chargées (document.fonts), pas juste
//      déclarées : une famille absente retomberait en silence sur system-ui.
//   3. Orthogonalité : fontes × palette × thème sont trois axes indépendants.
//   4. Persistance + boot sans flash (data-fonts posé avant le premier paint).
//   5. Export : --sans/--mono restent capturés par THEME_TOKENS.
//   6. Chiffres tabulaires : l'inspecteur de contexte doit garder ses colonnes
//      alignées quelle que soit la mono (font-variant-numeric).
// Usage : node verify-fonts.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-fonts');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const LOTS = {
  graphite: { sans: 'Hanken Grotesk', mono: 'JetBrains Mono' },
  atelier:  { sans: 'Source Sans 3',  mono: 'Source Code Pro' },
  chaleur:  { sans: 'Figtree',        mono: 'Fira Code' },
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-overlay.boot-done', { timeout: 8000 }).catch(() => {});
// Les fontes viennent du réseau (Google Fonts) : laisser le temps au chargement.
await page.evaluate(() => document.fonts.ready).catch(() => {});

// ── 1. Chaque lot applique sa paire ─────────────────────────────────────────
console.log('\n── 1. Les trois lots appliquent leur paire sans+mono ──');
for (const [lot, want] of Object.entries(LOTS)) {
  await page.evaluate(l => selectFonts(l), lot);
  await page.waitForTimeout(120);
  const got = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { sans: cs.getPropertyValue('--sans').trim(), mono: cs.getPropertyValue('--mono').trim() };
  });
  check(`${lot} : --sans porte « ${want.sans} »`, got.sans.includes(want.sans));
  check(`${lot} : --mono porte « ${want.mono} »`, got.mono.includes(want.mono));
  // Appliqué sur le DOM réel, pas seulement déclaré dans :root.
  const applied = await page.evaluate(() => {
    const b = getComputedStyle(document.body).fontFamily;
    const el = document.querySelector('.composer-hint kbd, kbd, code');
    return { body: b, mono: el ? getComputedStyle(el).fontFamily : null };
  });
  check(`${lot} : body hérite bien de la sans`, applied.body.includes(want.sans));
}

// ── 2. Les familles sont réellement chargées ────────────────────────────────
console.log('\n── 2. Familles réellement chargées (pas de repli silencieux) ──');
const loaded = await page.evaluate(async (lots) => {
  await document.fonts.ready;
  const out = {};
  for (const [lot, w] of Object.entries(lots)) {
    // check() interroge le font set : true si la famille est disponible.
    out[lot] = {
      sans: document.fonts.check(`16px "${w.sans}"`),
      mono: document.fonts.check(`16px "${w.mono}"`),
    };
  }
  out._families = [...new Set([...document.fonts].map(f => f.family))].sort();
  return out;
}, LOTS);
for (const [lot, w] of Object.entries(LOTS)) {
  check(`${lot} : « ${w.sans} » chargée`, loaded[lot].sans === true);
  check(`${lot} : « ${w.mono} » chargée`, loaded[lot].mono === true);
}
console.log('        familles présentes : ' + loaded._families.join(', '));

// ── 2bis. Préchargement : basculer ne doit RIEN télécharger ─────────────────
// Régression payée : le <link> déclare les six @font-face, mais un navigateur
// ne télécharge un .woff2 que lorsqu'un glyphe le réclame. Sans
// prefetchFontLots(), changer de lot déclenchait 2 fetchs et un saut visuel.
console.log('\n── 2bis. Bascule de lot sans fetch réseau ──');
const fontReqs = [];
page.on('request', r => { if (/gstatic\.com/.test(r.url())) fontReqs.push(r.url()); });
await page.evaluate(() => selectFonts('graphite'));
await page.waitForTimeout(200);
const before = fontReqs.length;
for (const lot of ['atelier', 'chaleur', 'graphite']) {
  await page.evaluate(l => selectFonts(l), lot);
  await page.waitForTimeout(300);
}
check(`aucun .woff2 téléchargé en basculant de lot (${fontReqs.length - before} requête(s))`,
      fontReqs.length === before);

// ── 3. Orthogonalité des trois axes ─────────────────────────────────────────
console.log('\n── 3. Orthogonalité fontes × palette × thème ──');
await page.evaluate(() => { selectTheme('dark'); selectPalette('encre'); selectFonts('atelier'); });
await page.waitForTimeout(150);
let attrs = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  palette: document.documentElement.getAttribute('data-palette'),
  fonts: document.documentElement.getAttribute('data-fonts'),
}));
check('les trois axes coexistent', attrs.theme === 'dark' && attrs.palette === 'encre' && attrs.fonts === 'atelier');
await page.evaluate(() => selectFonts('chaleur'));
await page.waitForTimeout(120);
attrs = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  palette: document.documentElement.getAttribute('data-palette'),
}));
check('changer de fontes ne touche ni thème ni palette', attrs.theme === 'dark' && attrs.palette === 'encre');
await page.evaluate(() => selectPalette('foret'));
await page.waitForTimeout(120);
const fontsAfter = await page.evaluate(() => document.documentElement.getAttribute('data-fonts'));
check('changer de palette ne touche pas les fontes', fontsAfter === 'chaleur');
// Défaut : aucun attribut, et valeur inconnue → repli.
await page.evaluate(() => selectFonts('graphite'));
await page.waitForTimeout(100);
check('graphite (défaut) ne pose aucun attribut data-fonts',
      (await page.evaluate(() => document.documentElement.getAttribute('data-fonts'))) === null);
await page.evaluate(() => applyFonts('nawak'));
await page.waitForTimeout(60);
check('lot inconnu → repli graphite (aucun attribut)',
      (await page.evaluate(() => document.documentElement.getAttribute('data-fonts'))) === null);

// ── 4. Persistance et boot ──────────────────────────────────────────────────
console.log('\n── 4. Persistance et rechargement ──');
await page.evaluate(() => { selectFonts('atelier'); selectPalette('encre'); });
await page.waitForTimeout(150);
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
const bootAttr = await page.evaluate(() => document.documentElement.getAttribute('data-fonts'));
check('après reload, data-fonts=atelier posé par le boot', bootAttr === 'atelier');
check('fontes persistées dans miaou-settings',
      (await page.evaluate(() => (JSON.parse(localStorage.getItem('miaou-settings') || '{}')).fonts)) === 'atelier');
await page.waitForSelector('.boot-overlay.boot-done', { timeout: 8000 }).catch(() => {});
await page.evaluate(() => document.fonts.ready).catch(() => {});
for (const lot of ['graphite', 'atelier', 'chaleur']) {
  await page.evaluate(l => selectFonts(l), lot);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, `0${Object.keys(LOTS).indexOf(lot) + 1}-${lot}.png`) });
  console.log('  shot  ' + `0${Object.keys(LOTS).indexOf(lot) + 1}-${lot}.png`);
}

// ── 5. Export : --sans/--mono toujours couverts ─────────────────────────────
console.log('\n── 5. Export ──');
const exp = await page.evaluate(() => {
  selectFonts('atelier');
  const css = serializeThemeTokens();
  return { css, hasSans: THEME_TOKENS.includes('--sans'), hasMono: THEME_TOKENS.includes('--mono') };
});
check('--sans et --mono sont dans THEME_TOKENS', exp.hasSans && exp.hasMono);
check('le CSS exporté porte la sans du lot actif', /Source Sans 3/.test(exp.css));
check('le CSS exporté porte la mono du lot actif', /Source Code Pro/.test(exp.css));

// ── 6. Chiffres tabulaires (inspecteur de contexte) ─────────────────────────
console.log('\n── 6. Chiffres tabulaires ──');
const tabular = await page.evaluate(() => {
  // Sonde : deux chaînes de même longueur, chiffres différents, en mono +
  // tabular-nums. Si la mono est bien à chasse fixe et tabular actif, elles
  // doivent mesurer exactement pareil.
  const mk = (txt) => {
    const el = document.createElement('span');
    el.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;'
      + 'font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:14px';
    el.textContent = txt;
    document.body.appendChild(el);
    const w = el.getBoundingClientRect().width;
    el.remove();
    return w;
  };
  return { a: mk('1111111111'), b: mk('8888888888') };
});
check(`chiffres de même largeur en mono (${tabular.a.toFixed(2)} vs ${tabular.b.toFixed(2)})`,
      Math.abs(tabular.a - tabular.b) < 0.5);


// ── 7. Synchro multi-onglets : rendu ET boutons du drawer ──────────────────
// Régression payée : le récepteur `apply-settings` ré-appliquait le RENDU
// (applyTheme/applyPalette/applyFonts/applyMotion) sans rafraîchir les
// segments du drawer (setXxxUI). Un onglet avec les réglages ouverts affichait
// donc l'ancien choix alors que son écran avait changé.
console.log('\n── 7. Propagation multi-onglets (rendu + drawer) ──');
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
