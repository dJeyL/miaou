#!/usr/bin/env node
// Graphe des statistiques d'usage (lot AJ, étape 4). Les purs (bacs, repères,
// agrégation par bac, axes, libellés, infobulle) sont couverts par
// tests/test-usage-stats.js ; ce script vérifie ce que QuickJS ne voit pas :
// ce que le drawer DESSINE à partir d'un store seedé.
//
// Les valeurs attendues sont lues depuis les purs VIVANTS de la page
// (usageScaleWindow, usageBins, calendarMarkers, usageBinTotals…), recalculées
// depuis l'échelle cliquée et « aujourd'hui » — jamais depuis l'état du
// drawer (`_usageChartArgs`), qui serait juge et partie.
//
// Scénario, sur 250 jours de statistiques seedées relatives à aujourd'hui
// (Maison : cache toujours renseigné, quelques appels non mesurés ; Bureau :
// même nom de modèle, cache jamais renseigné, aucun non mesuré) :
//   1. Chaque échelle (repères à 1 px près, filet calé au pixel) : un graphe `role="img"` nommé, sans arrêt de tabulation ;
//      autant de colonnes de survol que de bacs ; repères aux jours et aux
//      positions attendus ; filets dans les panneaux aux échelles au jour et à
//      la semaine, coche d'axe seule au mois ; « 1 semaine » étiquette ses bacs
//      et pas ses repères ; libellés de repères sans chevauchement.
//   2. Hauteur de la pile d'entrée du dernier bac conforme à son total.
//   3. Segment et légende « cache non renseigné » présents si et seulement si
//      la sélection en contient (tous serveurs / Bureau : oui ; Maison : non) ;
//      légende « non mesurées » idem, dans l'autre sens.
//   4. Infobulle d'un bac au survol : titre et détail du pur.
//   5. Couleurs : entrée hors cache = accent ; cache non renseigné = palier de
//      surface en sombre, gris de texte atténué en clair ; captures clair et sombre.
//   6. Largeur suivie quand le corps rétrécit sans que la fenêtre bouge (barre
//      de défilement) ; « aujourd'hui » figé au 29 septembre 2026 pour que la
//      priorité mois avant semaine des libellés soit exercée.
//   7. Aucune erreur console.
//
// Usage : node verify-usage-stats-chart.mjs [--headed]
// Captures dans shots-usage-chart/ (ignoré par git).
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(path.resolve(__dirname, '../../..'), 'dist/miaou.html');
const shotsDir = path.join(__dirname, 'shots-usage-chart');
fs.mkdirSync(shotsDir, { recursive: true });
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  if (!cond) failures.push(label);
};

const initScript = () => {
  if (localStorage.getItem('__aj_chart_seeded') !== null) return;
  localStorage.setItem('__aj_chart_seeded', '1');
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srv-a', name: 'Maison', url: 'http://stub.local/v1', key: 'k', model: 'stub-model' },
    { id: 'srv-b', name: 'Bureau', url: 'http://stub.local/v1', key: 'k', model: 'stub-model' },
  ]));
  localStorage.setItem('miaou-active-api-server', 'srv-a');
  localStorage.setItem('miaou-settings', JSON.stringify({ summaryInjectionMode: 'never', didYouKnow: false, theme: 'dark' }));
};

const browser = await launchIsolated({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
// « Aujourd'hui » figé : les repères dépendent de la date, et la priorité mois
// avant semaine n'est exercée que si un lundi touche un 1er dans la fenêtre —
// le 29 septembre 2026, « 1 mois » contient le lundi 31 août et le 1er
// septembre, voisins d'un jour. Les minuteries restent réelles. Figé APRÈS le
// démarrage : le plancher d'affichage de l'écran d'accueil se mesure sur
// Date.now, et une horloge arrêtée dès le chargement ne le laisse jamais finir.
await context.addInitScript(initScript);
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
await context.clock.setFixedTime(new Date(2026, 8, 29, 12, 0, 0));

const today = await page.evaluate(() => localDayKey(Date.now()));
const seeded = await page.evaluate((t) => {
  const recs = [];
  for (let d = 0; d < 250; d++) {
    const calls = 3 + (d % 5);
    const unmeasured = d % 9 === 0 ? 1 : 0;
    const inTokens = 20000 + ((250 - d) * 1300) + (d % 7) * 9000;
    recs.push({ day: usageAddDays(t, -d), serverId: 'srv-a', model: 'qwen', purpose: 'chat', serverName: 'Maison',
      calls, unmeasured, inTokens, cachedTokens: Math.round(inTokens * 0.6), cachedKnownCalls: calls - unmeasured,
      outTokens: Math.round(inTokens * 0.03) });
    if (d <= 60 && d % 2 === 0) {
      recs.push({ day: usageAddDays(t, -d), serverId: 'srv-b', model: 'qwen', purpose: 'chat', serverName: 'Bureau',
        calls: 2, unmeasured: 0, inTokens: 90000, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 3000 });
    }
  }
  return replaceUsageStatsFromImport(recs);
}, today);
check('prémisse : statistiques seedées', seeded > 250, seeded);
check('prémisse : « aujourd\'hui » figé au 29 septembre 2026', today === '2026-09-29', today);

const waitRendered = () => page.waitForFunction(() => {
  const b = document.getElementById('usage-body');
  return b && !/^Lecture/.test(b.textContent) && !!b.querySelector('.usage-chart');
}, null, { timeout: 8000 });
const pick = async (pillIndex, label) => {
  await page.locator('#usage-filters .pill-select-btn').nth(pillIndex).click();
  await page.locator('#usage-filters .pill-select').nth(pillIndex)
    .locator('.model-opt', { hasText: label }).first().click();   // libellés tous uniques comme sous-chaînes
  await waitRendered();
};

await page.evaluate(() => openUsageStats());
await waitRendered();
await page.waitForTimeout(300);   // glissement du drawer

// ── 1. Chaque échelle ───────────────────────────────────────────────────────
const SCALES = await page.evaluate(() => USAGE_SCALES.map(s => ({ id: s.id, label: s.label, granularity: s.granularity })));
for (const s of SCALES) {
  console.log('\n— 1. Échelle « ' + s.label + ' »');
  await pick(2, s.label);
  const r = await page.evaluate(({ id, gran, t }) => {
    const chart = document.querySelector('#usage-body .usage-chart');
    const svg = chart.querySelector('svg');
    const left = Number(svg.getAttribute('data-plot-left'));
    const w = Number(svg.getAttribute('data-plot-width'));
    const win = usageScaleWindow(id, t);
    const bins = usageBins(win, id);
    const expected = calendarMarkers(bins, gran);
    const ticks = [...svg.querySelectorAll('.usage-mark-tick')];
    const byDay = new Map(ticks.map(l => [l.getAttribute('data-day'), Number(l.getAttribute('x1'))]));
    let maxDelta = 0;
    for (const m of expected) {
      const x = byDay.get(m.day);
      maxDelta = Math.max(maxDelta, x === undefined ? Infinity : Math.abs(x - (left + m.pos * w)));
    }
    const labels = [...svg.querySelectorAll('.usage-mark-label')].map(e => e.getBoundingClientRect());
    let overlap = false;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      if (labels[i].left < labels[j].right && labels[j].left < labels[i].right) overlap = true;
    }
    const svgBox = svg.getBoundingClientRect();
    const hits = [...chart.querySelectorAll('.usage-chart-hit')];
    return {
      role: chart.getAttribute('role'),
      aria: chart.getAttribute('aria-label') || '',
      winStart: formatUsageDay(win.start),
      tabStops: chart.querySelectorAll('[tabindex], a, button, input').length,
      hits: hits.length, bins: bins.length,
      firstTitle: getTip(hits[0]).label || getTip(hits[0]), firstExpected: usageBinTitle(bins[0]),
      tickDays: ticks.map(l => l.getAttribute('data-day')).sort(),
      expectedDays: expected.map(m => m.day).sort(),
      maxDelta,
      fullLines: svg.querySelectorAll('.usage-mark-week:not(.usage-mark-tick), .usage-mark-month:not(.usage-mark-tick)').length,
      markers: expected.length,
      binLabels: svg.querySelectorAll('.usage-bin-label').length,
      markLabels: labels.length,
      overlap,
      labelsInside: labels.every(b => b.left >= svgBox.left - 1 && b.right <= svgBox.right + 1),
    };
  }, { id: s.id, gran: s.granularity, t: today });
  check('graphe role="img", nommé avec sa période', r.role === 'img' && r.aria.indexOf('du ' + r.winStart) >= 0, r.aria);
  check('aucun arrêt de tabulation dans le graphe', r.tabStops === 0, r.tabStops);
  check('une colonne de survol par bac (' + r.bins + ')', r.hits === r.bins, r.hits);
  check('infobulle du premier bac = son titre', r.firstTitle === r.firstExpected, [r.firstTitle, r.firstExpected]);
  check('repères aux jours attendus', JSON.stringify(r.tickDays) === JSON.stringify(r.expectedDays) && r.markers > 0,
    { got: r.tickDays, expected: r.expectedDays });
  // Filet calé au pixel (arrondi puis +0,5 px pour un trait net) : 1 px d'écart au plus.
  check('repères à leur position (écart max ≤ 1 px)', r.maxDelta <= 1.001, r.maxDelta);
  if (s.granularity === 'month') check('échelle au mois : coche d\'axe seule, aucun filet dans les panneaux', r.fullLines === 0, r.fullLines);
  else check('filet de repère dans chacun des trois panneaux', r.fullLines === 3 * r.markers, [r.fullLines, r.markers]);
  if (s.id === 'week') {
    check('« 1 semaine » : chaque bac étiqueté, repères sans libellé', r.binLabels === r.bins && r.markLabels === 0, [r.binLabels, r.markLabels]);
  } else {
    check('libellés de repères présents, sans chevauchement, dans le graphe', r.markLabels > 0 && !r.overlap && r.labelsInside,
      { n: r.markLabels, overlap: r.overlap, inside: r.labelsInside });
  }
  const shotName = { week: '03-sombre-1semaine', month: '01-sombre-1mois', quarter: '04-sombre-3mois', half: '05-sombre-6mois', year: '06-sombre-1an' }[s.id];
  await page.mouse.move(5, 5);   // pas de lavis de survol laissé par le clic du menu
  await page.locator('#usage-drawer').screenshot({ path: path.join(shotsDir, shotName + '.png') });
}

// ── 1b. Priorité des libellés : mois avant semaine ─────────────────────────
console.log('\n— 1b. Libellés en conflit');
await pick(2, '1 mois');
const lab = await page.evaluate(() => [...document.querySelectorAll('#usage-body .usage-mark-label')].map(e => e.getAttribute('data-day')));
check('« sept. » (1er, mois) gagne sur « 31 août » (lundi voisin), retiré', lab.indexOf('2026-09-01') >= 0 && lab.indexOf('2026-08-31') < 0, lab);

// ── 2. Hauteur de la pile d'entrée ──────────────────────────────────────────
console.log('\n— 2. Géométrie');
const geo = await page.evaluate((t) => {
  const bins = usageBins(usageScaleWindow('month', t), 'month');
  const tot = usageBinTotals(filterUsageRecords(_usageRecords, { serverId: null, model: null }), bins);
  const axis = usageChartAxis(Math.max(...tot.map(b => b.inTokens)), 3);
  const last = bins.length - 1;
  const segs = [...document.querySelectorAll('#usage-body .usage-panel[data-panel="in"] .usage-seg[data-bin="' + last + '"]')];
  const h = segs.reduce((a, p) => a + p.getBBox().height, 0) + 2 * (segs.length - 1);
  return { h, expected: tot[last].inTokens / axis.max * 132, n: segs.length };
}, today);
const inside = await page.evaluate(() => {
  const g = document.querySelector('#usage-body .usage-panel[data-panel="in"]');
  const top = Math.min(...[...g.querySelectorAll('.usage-chart-grid, .usage-chart-base')].map(l => Number(l.getAttribute('y1'))));
  const minY = Math.min(...[...g.querySelectorAll('.usage-seg')].map(p => p.getBBox().y));
  return { top, minY };
});
// Un segment fin qui déborderait par le haut du panneau n'est atteignable que si
// un bac touche le maximum de l'axe : couvert par tests/test-usage-stats.js
// (usageStackGeometry), pas ici, où aucun bac seedé ne le touche — d'où un
// relevé affiché, et non un contrôle qui ne pourrait pas échouer.
console.log('  info  sommet de pile / graduation haute : ' + JSON.stringify(inside));
check('pile d\'entrée du dernier bac à la hauteur de son total (espaces de 2 px compris)',
  geo.n >= 2 && Math.abs(geo.h - geo.expected) <= geo.n, geo);

// ── 3. « Cache non renseigné » si et seulement si la sélection en contient ──
console.log('\n— 3. Segments conditionnels');
const segState = () => page.evaluate(() => {
  const heads = [...document.querySelectorAll('#usage-body .usage-chart-head')].map(h => h.textContent);
  return {
    unknownSegs: document.querySelectorAll('#usage-body .usage-seg.usage-seg-unknown').length,
    unknownLegend: heads.some(h => h.indexOf('cache non renseigné') >= 0),
    unmeasuredSegs: document.querySelectorAll('#usage-body .usage-seg.usage-seg-unmeasured').length,
    unmeasuredLegend: heads.some(h => h.indexOf('non mesurées') >= 0),
    freshLegend: heads.some(h => h.indexOf('hors cache') >= 0),
    cachedLegend: heads.some(h => h.indexOf('servie par le cache') >= 0),
    freshSegs: document.querySelectorAll('#usage-body .usage-seg.usage-seg-fresh').length,
    cachedSegs: document.querySelectorAll('#usage-body .usage-seg.usage-seg-cached').length,
  };
});
let st = await segState();
check('tous serveurs (Bureau ne renseigne pas le cache) : segment et légende « non renseigné »', st.unknownSegs > 0 && st.unknownLegend, st);
check('tous serveurs : segment et légende « non mesurées »', st.unmeasuredSegs > 0 && st.unmeasuredLegend, st);
await pick(0, 'Maison');
st = await segState();
check('Maison (cache toujours renseigné) : ni segment ni légende « non renseigné »', st.unknownSegs === 0 && !st.unknownLegend, st);
check('Maison : « non mesurées » présent', st.unmeasuredSegs > 0 && st.unmeasuredLegend, st);
await pick(0, 'Bureau');
st = await segState();
check('Bureau : « non renseigné » présent, « non mesurées » absent',
  st.unknownSegs > 0 && st.unknownLegend && st.unmeasuredSegs === 0 && !st.unmeasuredLegend, st);
check('Bureau : légende sans « hors cache » ni « servie par le cache » (aucun segment)',
  !st.freshLegend && !st.cachedLegend && st.freshSegs === 0 && st.cachedSegs === 0, st);
await page.mouse.move(5, 5);
await page.locator('#usage-drawer').screenshot({ path: path.join(shotsDir, '07-sombre-1mois-bureau.png') });
await pick(0, 'Tous les serveurs');

// ── 4. Infobulle d'un bac ───────────────────────────────────────────────────
console.log('\n— 4. Infobulle');
const expectedTip = await page.evaluate((t) => {
  const bins = usageBins(usageScaleWindow('month', t), 'month');
  const tot = usageBinTotals(filterUsageRecords(_usageRecords, { serverId: null, model: null }), bins);
  const i = bins.length - 2;
  return { i, label: usageBinTitle(bins[i]), detail: usageBinTipDetail(tot[i]) };
}, today);
await page.locator('#usage-body .usage-chart-hit').nth(expectedTip.i).hover();
await page.waitForSelector('.tip.tip-shown', { timeout: 3000 }).catch(() => {});
const tipText = await page.evaluate(() => {
  const t = document.querySelector('.tip.tip-shown');
  return t ? t.textContent : null;
});
check('infobulle affichée au survol de la colonne', tipText !== null);
check('infobulle : titre et détail du bac', !!tipText && tipText.indexOf(expectedTip.label) >= 0 &&
  expectedTip.detail.split('\n').every(l => tipText.indexOf(l) >= 0), { tipText, expected: expectedTip });
check('lavis de survol sur la colonne', await page.evaluate((i) =>
  getComputedStyle(document.querySelectorAll('#usage-body .usage-chart-hit')[i]).backgroundColor !== 'rgba(0, 0, 0, 0)', expectedTip.i));
await page.locator('#usage-drawer').screenshot({ path: path.join(shotsDir, '08-sombre-infobulle.png') });
await page.mouse.move(5, 5);

// ── 5. Couleurs, clair et sombre ────────────────────────────────────────────
console.log('\n— 5. Couleurs');
const colors = () => page.evaluate(() => {
  const probe = (v) => {
    const d = document.createElement('div');
    d.style.color = 'var(' + v + ')';
    document.getElementById('usage-body').appendChild(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  };
  const fill = (cls) => {
    const e = document.querySelector('#usage-body .usage-seg.' + cls);
    return e ? getComputedStyle(e).fill : null;
  };
  return {
    fresh: fill('usage-seg-fresh'), cached: fill('usage-seg-cached'), unknown: fill('usage-seg-unknown'),
    accent: probe('--accent'), surface4: probe('--surface-4'), text3: probe('--text-3'),
  };
});
let c = await colors();
check('sombre : hors cache = accent', c.fresh === c.accent, c);
check('sombre : cache non renseigné = --surface-4', c.unknown === c.surface4, c);
check('sombre : trois couleurs distinctes dans la pile', new Set([c.fresh, c.cached, c.unknown]).size === 3, c);
await page.evaluate(() => selectTheme('light'));
await page.waitForTimeout(200);
c = await colors();
check('clair : hors cache = accent du thème clair', c.fresh === c.accent, c);
// --text-3 et non --border-2 : ce dernier était trop proche du cache pâle
// qu'il surmonte (ΔE 6,8 < 15), cf. usage-stats.css.
check('clair : cache non renseigné = --text-3', c.unknown === c.text3 && c.unknown !== c.surface4, c);
check('clair : trois couleurs distinctes dans la pile', new Set([c.fresh, c.cached, c.unknown]).size === 3, c);
await page.mouse.move(5, 5);
await page.locator('#usage-drawer').screenshot({ path: path.join(shotsDir, '02-clair-1mois.png') });
await page.evaluate(() => selectTheme('dark'));

// ── 5b. Largeur suivie : le corps rétrécit sans que la fenêtre bouge ────────
// (cas de la barre de défilement verticale qu'ajoutent graphe et tableau ; le
// Chromium headless masque les barres, d'où le rétrécissement simulé).
console.log('\n— 5b. Largeur');
await page.evaluate(() => { document.getElementById('usage-drawer').style.width = '520px'; });
await page.waitForFunction(() => {
  const b = document.getElementById('usage-body');
  const svg = b.querySelector('.usage-chart svg');
  return svg && Math.abs(Number(svg.getAttribute('width')) - b.clientWidth) < 1;
}, null, { timeout: 3000 }).catch(() => {});
const widths = await page.evaluate(() => {
  const b = document.getElementById('usage-body');
  return { svg: Number(b.querySelector('.usage-chart svg').getAttribute('width')), body: b.clientWidth };
});
check('drawer rétréci : le graphe est redessiné à la largeur du corps', Math.abs(widths.svg - widths.body) < 1 && widths.body < 560, widths);
await page.evaluate(() => { document.getElementById('usage-drawer').style.width = ''; });

// ── 6. Console ──────────────────────────────────────────────────────────────
console.log('\n— 6. Console');
check('aucune erreur console', errors.length === 0, errors);

await browser.close();
console.log('\n' + (failures.length ? failures.length + ' échec(s)' : 'OK') + ' — captures dans ' + shotsDir);
process.exit(failures.length ? 1 : 0);
