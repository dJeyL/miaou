// Vérifie que les réglages d'apparence changés dans un onglet ARRIVENT chez le
// pair, même en rafale (storageEventDecision, sync.js + écouteur `storage`,
// main.js). Motif, mesuré le 2026-09-25 : le message BroadcastChannel peut
// arriver AVANT que l'écriture localStorage de l'émetteur soit visible chez le
// pair ; celui-ci relisait alors l'ancienne valeur, l'appliquait, et plus rien
// ne corrigeait. C'était la dette « propagation du thème intermittente » de
// docs/multitab-sync.md — jamais reproduite à coup unique, systématique en
// rafale : 11 à 30 itérations sur 40 en échec sur le code d'avant.
//
// Montage : deux onglets du même contexte, boot TERMINÉ des deux côtés (le
// canal se branche en fin d'init()). A enchaîne selectTheme/selectPalette/
// selectFonts dans le même tour — trois écritures, trois messages — 40 fois,
// drawer du pair ouvert puis refermé en cours de route. Après chaque rafale, le
// pair doit converger vers les trois valeurs (délai d'attente, jamais fixe).
// `ambre` et `graphite` sont les défauts : l'attribut est alors RETIRÉ (null).
//
// En cas d'échec, l'état du pair est imprimé AVEC ce qu'il lisait dans
// localStorage à la réception de chaque message : c'est ce qui distingue une
// course de visibilité d'un défaut d'application.
// Usage : node verify-settings-sync-race.mjs
import { launchIsolated } from './stub-backend.js';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');

const ITER = 40;
const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra }); }

const browser = await launchIsolated({});
const ctx = await browser.newContext();
const pageErrors = [];
const booted = () => document.querySelector('.boot-done') !== null;
const A = await ctx.newPage(); A.on('pageerror', e => pageErrors.push(String(e)));
await A.goto(appUrl); await A.waitForSelector('#composer-text'); await A.waitForFunction(booted);
const B = await ctx.newPage(); B.on('pageerror', e => pageErrors.push(String(e)));
await B.goto(appUrl); await B.waitForSelector('#composer-text'); await B.waitForFunction(booted);

// Témoin + diagnostic : ce que le pair lit à la réception de chaque message.
await B.evaluate(() => {
  window.__rx = [];
  const orig = _syncHandler;
  _syncHandler = function (env) {
    if (env && env.type === 'settings-updated') {
      const st = JSON.parse(localStorage.getItem('miaou-settings') || '{}');
      window.__rx.push([String(env.payload && env.payload.keys), st.theme, st.palette, st.fonts]);
    }
    return orig.apply(this, arguments);
  };
});

const themes = ['light', 'dark'], pals = ['ambre', 'encre', 'foret'], fonts = ['graphite', 'atelier'];
const failures = [];
for (let i = 0; i < ITER; i++) {
  const want = { t: themes[i % 2], p: pals[i % 3], f: fonts[(i >> 1) % 2] };
  if (i % 7 === 3) await B.evaluate(() => { if (typeof openSettings === 'function') openSettings(); });
  if (i % 7 === 5) await B.evaluate(() => { if (typeof closeSettings === 'function') closeSettings(); });
  await A.evaluate(w => { selectTheme(w.t); selectPalette(w.p); selectFonts(w.f); }, want);
  const ok = await B.waitForFunction(w => {
    const r = document.documentElement;
    const d = (v, def) => (v === def ? null : v);
    return r.getAttribute('data-theme') === w.t
      && r.getAttribute('data-palette') === d(w.p, 'ambre')
      && r.getAttribute('data-fonts') === d(w.f, 'graphite');
  }, want, { timeout: 3000 }).then(() => true, () => false);
  if (!ok) {
    failures.push(await B.evaluate(w => ({
      want: w,
      seen: ['data-theme', 'data-palette', 'data-fonts'].map(a => document.documentElement.getAttribute(a)),
      rxAtReception: window.__rx.slice(-3),
    }), want));
  }
}

const rx = await B.evaluate(() => window.__rx.length);
check('témoin : le pair a reçu les messages du canal (3 par rafale)', rx >= ITER * 3, rx);
check(`le pair converge après chacune des ${ITER} rafales`, failures.length === 0,
  failures.length + ' échec(s) ; premiers : ' + JSON.stringify(failures.slice(0, 3)));
check('aucune exception de page', pageErrors.length === 0, pageErrors);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '  → ' + JSON.stringify(r.extra)));
}
await browser.close();
console.log(failed ? `\n${failed} échec(s)` : '\nOK');
process.exit(failed ? 1 : 0);
