#!/usr/bin/env node
// Rendu par blocs pendant le streaming (cf. docs/rendering.md, « Rendu pendant
// le streaming ») — un seul lancement :
//   1. un bloc terminé garde ses nœuds DOM, et une sélection posée dedans tient
//      pendant que la suite arrive ;
//   2. une sélection sur le bloc en cours DIFFÈRE le rendu, qui rattrape au
//      relâchement ;
//   3. le défilement interne d'un bloc de code en cours d'écriture est reporté
//      sur son successeur ;
//   4. le défilement horizontal d'un tableau large terminé tient ;
//   5. finalizeAssistant garde la sélection d'un bloc terminé, et son rendu est
//      le même que renderMd (celui du rechargement) ;
//   6. le raisonnement garde une sélection pendant qu'il s'allonge.
// Usage : node verify-stream-blocks.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (!cond && detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });
await page.waitForFunction(() => !!(window.marked && window.DOMPurify), null, { timeout: 15000 });

// Helpers côté page : pousser un texte et laisser passer le throttle de 90 ms.
await page.evaluate(() => {
  window.__wrap = startAssistantMessage('test-model', undefined);
  window.__body = window.__wrap.querySelector('.body');
  window.__select = (el, from, to) => {
    const tn = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange();
    r.setStart(tn, from); r.setEnd(tn, to);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return r.toString();
  };
});
const push = async (t) => {
  await page.evaluate((x) => streamInto(window.__wrap, x), t);
  await page.waitForTimeout(160);
};

const wideRow = (c) => '| ' + Array.from({ length: 14 }, (_, i) => c + ' cellule assez longue ' + i).join(' | ') + ' |\n';
const P1 = 'Premier paragraphe complet, qui sera sélectionné pendant la suite du streaming.\n\n';
const TABLE = wideRow('en-tête') + '|' + ' --- |'.repeat(14) + '\n' + wideRow('a') + wideRow('b') + '\n';
const P2 = 'Deuxième paragraphe, lui aussi terminé.\n\n';
let text = P1 + TABLE + P2 + 'Troisième paragraphe en cours';

// ── 1. Bloc terminé : nœuds gardés, sélection qui tient ─────────────────────
await push(text);
check('tableau GFM rendu pendant le streaming (options marked fusionnées)',
  await page.evaluate(() => !!window.__body.querySelector('.table-bleed table')));
await page.evaluate(() => { window.__p1 = window.__body.querySelector('p'); window.__tbl = window.__body.querySelector('.table-bleed'); });
const sel1 = await page.evaluate(() => window.__select(window.__p1, 0, 17));
for (let i = 0; i < 5; i++) { text += ' encore' + i; await push(text); }
let st = await page.evaluate(() => ({
  sameNode: window.__body.querySelector('p') === window.__p1 && window.__p1.isConnected,
  sel: getSelection().toString(),
  last: window.__body.textContent.includes('encore4'),
}));
check('bloc terminé : même nœud <p> après 5 rendus', st.sameNode);
check('bloc terminé : sélection intacte', st.sel === sel1, st.sel);
check('bloc en cours : bien mis à jour', st.last);

// ── 2. Sélection dans le bloc en cours → rendu différé puis rattrapage ──────
await page.evaluate(() => {
  const ps = window.__body.querySelectorAll(':scope > p');
  window.__select(ps[ps.length - 1], 0, 10);
});
text += ' PENDANT-SELECTION';
await push(text);
await page.waitForTimeout(200);
st = await page.evaluate(() => ({ shown: window.__body.textContent.includes('PENDANT-SELECTION'), sel: getSelection().toString() }));
check('sélection sur le bloc en cours : rendu différé', !st.shown);
check('sélection sur le bloc en cours : intacte', st.sel.length === 10, st.sel);
await page.evaluate(() => getSelection().removeAllRanges());
await page.waitForTimeout(250);
check('relâchement : le rendu rattrape le texte accumulé',
  await page.evaluate(() => window.__body.textContent.includes('PENDANT-SELECTION')));

// ── 3. Défilement d'un bloc de code en cours d'écriture ─────────────────────
text += '.\n\n```python\n';
for (let i = 0; i < 120; i++) text += 'print("ligne ' + i + '")\n';
await push(text);
const codeState = () => page.evaluate(() => {
  const codes = window.__body.querySelectorAll('pre > code');
  const c = codes[codes.length - 1];
  return { top: c.scrollTop, scrollable: c.scrollHeight > c.clientHeight, node: c };
});
await page.evaluate(() => {
  const codes = window.__body.querySelectorAll('pre > code');
  window.__code = codes[codes.length - 1];
  window.__code.scrollTop = 300;
});
let cs = await codeState();
check('bloc de code borné : défile en interne', cs.scrollable);
const before = await page.evaluate(() => window.__code.scrollTop);
for (let i = 120; i < 140; i++) { text += 'print("ligne ' + i + '")\n'; }
await push(text);
cs = await page.evaluate(() => {
  const codes = window.__body.querySelectorAll('pre > code');
  const c = codes[codes.length - 1];
  return { top: c.scrollTop, replaced: c !== window.__code, hasLast: c.textContent.includes('ligne 139') };
});
check('bloc de code en cours : remplacé (chemin de report emprunté)', cs.replaced && cs.hasLast);
check('bloc de code en cours : défilement reporté', Math.abs(cs.top - before) < 2, { before, after: cs.top });

// ── 4. Défilement horizontal d'un tableau terminé ───────────────────────────
await page.evaluate(() => { window.__tbl.scrollLeft = 250; });
const tblBefore = await page.evaluate(() => window.__tbl.scrollLeft);
text += '```\n\nParagraphe après le code';
await push(text);
text += ', qui s\'allonge.';
await push(text);
st = await page.evaluate(() => ({ same: window.__body.querySelector('.table-bleed') === window.__tbl, left: window.__tbl.scrollLeft }));
check('tableau large : défile horizontalement (montage valide)', tblBefore > 0, tblBefore);
check('tableau terminé : même porteur, scrollLeft intact', st.same && st.left === tblBefore, { tblBefore, ...st });

// ── 5. Finalisation : sélection gardée, rendu == renderMd ───────────────────
text += '\n\nRéférence [doc][d].\n\n[d]: https://example.com/doc\n';
await push(text);
await page.evaluate(() => { window.__p1 = window.__body.querySelector('p'); });
const sel5 = await page.evaluate(() => window.__select(window.__p1, 0, 17));
await page.evaluate((t) => finalizeAssistant(window.__wrap, t), text);
st = await page.evaluate(() => ({
  sameNode: window.__body.querySelector('p') === window.__p1,
  sel: getSelection().toString(),
  caret: !!window.__body.querySelector('.cursor-blink'),
}));
check('finalize : bloc terminé gardé', st.sameNode);
check('finalize : sélection intacte', st.sel === sel5, st.sel);
check('finalize : pas de caret', !st.caret);
const eq = await page.evaluate((t) => {
  // Même normalisation des deux côtés : en-têtes de code retirés, coloration
  // Prism aplatie (asynchrone, autoloader), nœuds texte blancs entre blocs ôtés.
  const norm = (body) => {
    const c = body.cloneNode(true);
    c.querySelectorAll('.code-head').forEach(n => n.remove());
    c.querySelectorAll('code').forEach(n => { n.textContent = n.textContent; n.removeAttribute('class'); n.className = (n.getAttribute('data-l') || ''); });
    // Prism pose aussi tabindex="0" sur le <pre> qu'il colore : attributs du <pre> retirés.
    c.querySelectorAll('pre').forEach(n => n.getAttributeNames().forEach(a => n.removeAttribute(a)));
    [...c.childNodes].forEach(n => { if (n.nodeType === 3 && !n.textContent.trim()) n.remove(); });
    return c.innerHTML;
  };
  const fake = document.createElement('div');
  fake.className = 'msg';
  fake.innerHTML = '<div class="body"></div>';
  const fb = fake.querySelector('.body');
  fb.innerHTML = renderMd(t);
  decoratePre(fake);
  const a = norm(window.__body), b = norm(fb);
  let d = 0; while (d < a.length && a[d] === b[d]) d++;
  return { equal: a === b, a: a.slice(Math.max(0, d - 80), d + 120), b: b.slice(Math.max(0, d - 80), d + 120), hasRef: !!window.__body.querySelector('a[href="https://example.com/doc"]') };
}, text);
check('finalize : rendu identique à renderMd (rechargement)', eq.equal, eq.equal ? undefined : { a: eq.a, b: eq.b });
check('finalize : lien en référence résolu', eq.hasRef);

// ── 6. Raisonnement : sélection qui tient pendant qu'il s'allonge ───────────
await page.evaluate(() => {
  window.__rw = startAssistantMessage('test-model', undefined);
  flushReasoning(window.__rw, 'Je réfléchis à la question posée par l\'utilisateur.');
  window.__rw.querySelector('.reasoning').removeAttribute('hidden');
});
const sel6 = await page.evaluate(() => window.__select(window.__rw.querySelector('.reasoning-content'), 3, 13));
await page.evaluate(() => flushReasoning(window.__rw, 'Je réfléchis à la question posée par l\'utilisateur. Puis je continue.'));
st = await page.evaluate(() => ({ sel: getSelection().toString(), txt: window.__rw.querySelector('.reasoning-content').textContent }));
check('raisonnement : texte prolongé', st.txt.endsWith('Puis je continue.'));
check('raisonnement : sélection intacte', st.sel === sel6, st.sel);

await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log('Console errors:', JSON.stringify(consoleErrors, null, 2));
  failures.push('console errors');
} else {
  console.log('No console errors.');
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
