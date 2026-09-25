// Vérifie que le chargement d'une bibliothèque CDN est BORNÉ (loadCdnScript,
// ui.js). Motif : un CDN qui accepte la connexion sans jamais répondre ne
// déclenche ni onload ni onerror ; avant la borne, la promesse mémoïsée de
// ensureFflate/ensurePdfJs/… restait pendante pour toujours, et avec elle
// l'outil qui l'attendait — que Stop n'interrompt pas (piège 10).
//
// Montage : les URL CDN sont interceptées par page.route. « Muet » = un handler
// qui ne répond jamais (promesse jamais résolue : un handler qui ne fait RIEN
// annule la requête, et l'appli prendrait alors son chemin onerror, qui marchait
// déjà — cf. SKILL.md). La borne est raccourcie en réécrivant le délai lu depuis
// la constante VIVANTE CDN_LOAD_TIMEOUT_MS, jamais depuis un littéral.
//
// Checklist :
//   1. script muet → ensureFflate rejette dans un délai borné, message « sans
//      réponse » ; le <script> pendu est retiré du DOM ;
//   2. reset-on-reject : le CDN revient, un nouvel appel réussit ;
//   3. pdf.js : script servi, WORKER muet → ensurePdfJs rejette aussi (le fetch
//      du worker est borné comme le script) ;
//   4. témoins : chaque route muette a bien été sollicitée.
//
// Rejoué sur le code d'avant la borne : les checks 1 et 3 tombent sur le délai
// de course du script (la promesse ne se règle jamais). Aucun accès réseau : les
// bibliothèques sont remplacées par des scripts factices.
// Usage : node verify-cdn-load-timeout.mjs
import { launchIsolated } from './stub-backend.js';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');

const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra }); }

const SHORT_MS = 1500;
const RACE_MS = 8000;   // bien au-delà de SHORT_MS, bien en deçà de la vraie borne

const browser = await launchIsolated({});
const context = await browser.newContext();
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e)));

// Délai raccourci : la page appelle `setTimeout` nu, qui résout sur
// window.setTimeout. La valeur visée est lue plus bas depuis la constante vivante.
await page.addInitScript(() => {
  const orig = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    if (window.__shrink && ms === window.__shrink.from) ms = window.__shrink.to;
    return orig.call(window, fn, ms, ...rest);
  };
});

const hits = { fflateMute: 0, pdfWorkerMute: 0 };
let fflateMute = true;
await page.route(/fflate@.*\/umd\/index\.js/, async (route) => {
  if (fflateMute) {
    hits.fflateMute++;
    await new Promise(() => {});   // ne répond jamais
    return;
  }
  await route.fulfill({
    contentType: 'application/javascript',
    body: 'self.fflate = { unzipSync: function(){}, zipSync: function(){}, strToU8: function(){} };',
  });
});
await page.route(/pdfjs-dist@.*\/build\/pdf\.min\.js/, (route) => route.fulfill({
  contentType: 'application/javascript',
  body: 'window.pdfjsLib = { getDocument: function(){}, GlobalWorkerOptions: {} };',
}));
await page.route(/pdfjs-dist@.*\/build\/pdf\.worker\.min\.js/, async () => {
  hits.pdfWorkerMute++;
  await new Promise(() => {});
});

await page.goto(appUrl);
await page.waitForSelector('#composer-text');
await page.waitForFunction(() => document.querySelector('.boot-done') !== null);

// typeof : sur un bundle d'avant la borne, la constante n'existe pas — la
// prémisse tombe alors, et les checks suivants disent ce qui pend.
const live = await page.evaluate((to) => {
  if (typeof CDN_LOAD_TIMEOUT_MS === 'undefined') return null;
  window.__shrink = { from: CDN_LOAD_TIMEOUT_MS, to };
  return CDN_LOAD_TIMEOUT_MS;
}, SHORT_MS);
check('prémisse : la borne vivante est lue (CDN_LOAD_TIMEOUT_MS > délai raccourci)', live > SHORT_MS, live);

// Règle une promesse de la page en {ok, msg, ms}, ou {hung} passé RACE_MS.
async function settle(expr) {
  return page.evaluate(async ({ expr, race }) => {
    const t0 = performance.now();
    const p = (0, eval)(expr);
    const r = await Promise.race([
      p.then(() => ({ ok: true }), (e) => ({ ok: false, msg: String(e && e.message || e) })),
      new Promise(res => setTimeout(() => res({ hung: true }), race)),
    ]);
    r.ms = Math.round(performance.now() - t0);
    return r;
  }, { expr, race: RACE_MS });
}

// 1. fflate muet
const r1 = await settle('ensureFflate()');
check('1. CDN muet : ensureFflate REJETTE au lieu de pendre', r1.ok === false && !r1.hung, r1);
check('1. le motif nomme l\'absence de réponse', /sans réponse/.test(r1.msg || ''), r1.msg);
check('1. dans un délai borné (≈ la borne raccourcie)', !r1.hung && r1.ms >= SHORT_MS - 50 && r1.ms < RACE_MS, r1.ms);
const leftover = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].filter(s => /fflate@/.test(s.src)).length);
check('1. le <script> pendu est retiré du DOM', leftover === 0, leftover);

// 2. le CDN revient : reset-on-reject
fflateMute = false;
const r2 = await settle('ensureFflate()');
check('2. après rejet, un nouvel appel réussit (promesse non mémoïsée en échec)', r2.ok === true, r2);

// 3. pdf.js : script servi, worker muet
const r3 = await settle('ensurePdfJs()');
check('3. worker pdf.js muet : ensurePdfJs REJETTE au lieu de pendre', r3.ok === false && !r3.hung, r3);
check('3. le motif nomme le worker', /worker pdf\.js/.test(r3.msg || ''), r3.msg);

// 4. témoins
check('4. témoin : la route fflate muette a été sollicitée', hits.fflateMute >= 1, hits.fflateMute);
check('4. témoin : la route worker muette a été sollicitée', hits.pdfWorkerMute >= 1, hits.pdfWorkerMute);
check('aucune erreur de page', consoleErrors.length === 0, consoleErrors);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '  → ' + JSON.stringify(r.extra)));
}
await browser.close();
console.log(failed ? `\n${failed} échec(s)` : '\nOK');
process.exit(failed ? 1 : 0);
