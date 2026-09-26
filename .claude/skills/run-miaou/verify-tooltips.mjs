#!/usr/bin/env node
// Vérification du module d'infobulles (lot AH-1) : la couche DOM de
// tooltips.js, que QuickJS ne voit pas (les purs y sont testés).
//
// Écrit à AH-1, avant la migration des porteurs : le script injecte ses
// propres porteurs (setTip) dans la topbar, le composer et le fil, et ne
// dépend d'aucun porteur réel.
//
// Ce qui est vérifié :
//   A. règle ARIA appliquée par setTip (nom posé, aria-label d'auteur intact,
//      retrait limité à ce que la règle a posé) ;
//   B. délai à froid, voisine immédiate (fenêtre chaude), retour à froid ;
//   C. retournement sous un porteur de topbar, bulle dans la fenêtre, flèche
//      sur le centre du porteur ;
//   D. texte suivi en direct par setTip ; clic qui masque ; réaffichage (nouveau texte
//      sous le pointeur → réaffichage) ;
//   E. Échap consommé : la bulle se ferme, le drawer ouvert derrière reste
//      ouvert (témoin : sans bulle, Échap ferme le drawer) ; Shift seul ne
//      masque pas (AH-2 : l'infobulle d'export s'ajuste sous Shift), une
//      lettre masque ;
//   F. focus clavier → bulle ; clic → pas de bulle une fois le pointeur parti ;
//   G. porteur détruit sous la bulle → bulle masquée ;
//   H. défilement : le fil qui défile ne masque pas une bulle du composer
//      (streaming), mais masque celle d'un porteur qu'il contient.
//
// Usage : node verify-tooltips.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
await page.waitForTimeout(500);

// État de la bulle, lu dans le DOM et le style calculé (jamais la classe seule).
const tip = () => page.evaluate(() => {
  const el = document.querySelector('body > .tip');
  if (!el) return { exists: false, visible: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    exists: true,
    visible: cs.visibility === 'visible' && el.classList.contains('tip-shown'),
    text: el.textContent,
    side: el.dataset.side,
    top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width,
    arrowX: parseFloat(el.style.getPropertyValue('--arrow-x')),
    pe: cs.pointerEvents, z: cs.zIndex,
  };
});
const center = (sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, width: r.width };
}, sel);
const waitVisible = (text) => page.waitForFunction((t) => {
  const el = document.querySelector('body > .tip');
  return !!el && el.classList.contains('tip-shown') && getComputedStyle(el).visibility === 'visible' && (t == null || el.textContent === t);
}, text == null ? null : text, { timeout: 3000 }).then(() => true, () => false);
const waitHidden = () => page.waitForFunction(() => {
  const el = document.querySelector('body > .tip');
  return !el || !el.classList.contains('tip-shown');
}, null, { timeout: 3000 }).then(() => true, () => false);
// Zone neutre : bas du fil, sans porteur.
const park = () => page.mouse.move(600, 450);

// Porteurs injectés. Boutons-icônes vides (pas de texte visible), donc la règle
// ARIA doit leur donner un nom.
await page.evaluate(() => {
  const mk = (id, host, before) => {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.style.cssText = 'width:28px;height:28px;flex:none;';
    if (before) host.insertBefore(b, host.firstChild); else host.appendChild(b);
    return b;
  };
  const right = document.querySelector('.topbar .topbar-right');
  setTip(mk('vt-a', right, true), 'Infobulle A');
  setTip(mk('vt-b', right, true), 'Infobulle B');
  const author = mk('vt-author', right, true);
  author.setAttribute('aria-label', 'Copier cette interjection');
  setTip(author, 'Copier');
  setTip(mk('vt-comp', document.querySelector('.composer'), false), 'Infobulle composer');
});
await park();

// ════════════════════════════════════════════════════════════════════════════
console.log('\nA. Règle ARIA appliquée par setTip');
// ════════════════════════════════════════════════════════════════════════════
const aria = await page.evaluate(() => {
  const a = document.getElementById('vt-a');
  const au = document.getElementById('vt-author');
  const out = {
    aLabel: a.getAttribute('aria-label'), aMark: a.getAttribute('data-tip-aria'), aTip: getTip(a),
    auLabel: au.getAttribute('aria-label'), auMark: au.getAttribute('data-tip-aria'),
  };
  setTip(a, { label: 'Deux', detail: 'étages' });
  out.twoLabel = a.getAttribute('aria-label');
  out.twoTip = JSON.stringify(getTip(a));
  setTip(a, '');
  out.clearedLabel = a.getAttribute('aria-label');
  out.clearedTip = a.getAttribute('data-tip');
  setTip(au, '');
  out.auAfterClear = au.getAttribute('aria-label');
  setTip(au, 'Copier');
  setTip(a, 'Infobulle A');
  return out;
});
check('bouton-icône : aria-label = infobulle, marqué', aria.aLabel === 'Infobulle A' && aria.aMark === 'label', aria.aLabel);
check('getTip rend la chaîne posée', aria.aTip === 'Infobulle A');
check('deux étages : aria-label plat « libellé. détail », getTip rend l\'objet',
  aria.twoLabel === 'Deux. étages' && aria.twoTip === '{"label":"Deux","detail":"étages"}', aria.twoLabel);
check('setTip vide : retire l\'aria-label posé par la règle et data-tip', aria.clearedLabel === null && aria.clearedTip === null);
check('aria-label d\'auteur : intact, rien de marqué (le nom contient l\'infobulle)',
  aria.auLabel === 'Copier cette interjection' && aria.auMark === null);
check('setTip vide sur un porteur à aria-label d\'auteur : l\'auteur reste', aria.auAfterClear === 'Copier cette interjection');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nB. Délais : froid, voisine immédiate, retour à froid');
// ════════════════════════════════════════════════════════════════════════════
const consts = await page.evaluate(() => ({ cold: TIP_COLD_MS, warm: TIP_WARM_WINDOW_MS }));
let c = await center('#vt-a');
await page.mouse.move(c.x, c.y);
const t0 = Date.now();
await page.waitForTimeout(150);
check('froid : rien après 150 ms', !(await tip()).visible);
check('froid : bulle affichée ensuite', await waitVisible('Infobulle A'));
const coldMs = Date.now() - t0;
check('froid : délai de l\'ordre de TIP_COLD_MS', coldMs >= consts.cold - 60 && coldMs < consts.cold + 600, coldMs + ' ms');
let t = await tip();
check('bulle non survolable (pointer-events: none), z-index 100', t.pe === 'none' && t.z === '100', t.pe + ' / ' + t.z);

c = await center('#vt-b');
await page.mouse.move(c.x, c.y);
await page.waitForTimeout(60);
t = await tip();
check('chaud : la voisine s\'affiche sans délai', t.visible && t.text === 'Infobulle B', t.text);

await park();
check('sortie du porteur : bulle masquée', await waitHidden());
await page.waitForTimeout(consts.warm + 150);
c = await center('#vt-a');
await page.mouse.move(c.x, c.y);
await page.waitForTimeout(150);
check('fenêtre chaude expirée : de nouveau à froid', !(await tip()).visible);
await waitVisible('Infobulle A');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nC. Placement : topbar, fenêtre, flèche');
// ════════════════════════════════════════════════════════════════════════════
t = await tip();
c = await center('#vt-a');
check('porteur de topbar : bulle retournée AU-DESSOUS', t.side === 'bottom' && t.top >= c.bottom, t.side + ' top=' + t.top + ' anchorBottom=' + c.bottom);
check('bulle dans la fenêtre (marge 8)', t.left >= 8 && t.right <= 1200 - 8, t.left + '…' + t.right);
const arrowAbs = t.left + t.arrowX;
check('flèche sur le centre du porteur', Math.abs(arrowAbs - c.x) <= 1.5, arrowAbs + ' vs ' + c.x);
check('flèche bornée hors des coins', t.arrowX >= 10 && t.arrowX <= t.width - 10, t.arrowX + ' / ' + t.width);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nD. Texte en direct, clic, réaffichage');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => setTip(document.getElementById('vt-a'), 'Infobulle A modifiée'));
t = await tip();
check('setTip sur la bulle affichée : texte suivi en place', t.visible && t.text === 'Infobulle A modifiée', t.text);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(700);
check('clic : bulle masquée, et elle ne revient pas seule', !(await tip()).visible);
await page.evaluate(() => setTip(document.getElementById('vt-a'), 'Cliquer à nouveau pour confirmer'));
await page.waitForTimeout(40);
t = await tip();
check('réaffichage : nouveau texte sous le pointeur → réaffichage immédiat', t.visible && t.text === 'Cliquer à nouveau pour confirmer', t.text);
await page.evaluate(() => setTip(document.getElementById('vt-a'), 'Infobulle A'));
await park();
await waitHidden();
await page.evaluate(() => setTip(document.getElementById('vt-a'), 'Hors pointeur'));
await page.waitForTimeout(40);
check('réaffichage, témoin : setTip hors pointeur n\'affiche rien', !(await tip()).visible);
await page.evaluate(() => setTip(document.getElementById('vt-a'), 'Infobulle A'));

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE. Échap consommé, frappe qui masque');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => openSettings());
await page.waitForSelector('#drawer.show');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('témoin : sans bulle, Échap ferme le drawer', !(await page.evaluate(() => document.getElementById('drawer').classList.contains('show'))));
await page.evaluate(() => openSettings());
await page.waitForSelector('#drawer.show');
await page.waitForTimeout(300);
// Le fond du drawer recouvre la topbar : le porteur est posé DANS le drawer.
await page.evaluate(() => {
  const d = document.createElement('button');
  d.id = 'vt-drawer';
  d.type = 'button';
  d.style.cssText = 'width:28px;height:28px;';
  const host = document.getElementById('drawer');
  host.insertBefore(d, host.firstChild);
  setTip(d, 'Dans le drawer');
});
await page.mouse.move(600, 450);
await page.waitForTimeout(consts.warm + 100);
c = await center('#vt-drawer');
await page.mouse.move(c.x, c.y);
check('bulle affichée sur un porteur du drawer ouvert', await waitVisible('Dans le drawer'));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('Échap : bulle fermée', !(await tip()).visible);
check('Échap consommé : le drawer reste ouvert', await page.evaluate(() => document.getElementById('drawer').classList.contains('show')));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('second Échap (plus de bulle) : le drawer se ferme', !(await page.evaluate(() => document.getElementById('drawer').classList.contains('show'))));
await park();
await page.waitForTimeout(consts.warm + 100);
c = await center('#vt-b');
await page.mouse.move(c.x, c.y);
await waitVisible('Infobulle B');
await page.keyboard.press('Shift');
await page.waitForTimeout(60);
check('Shift seul : la bulle reste (touche de modification, tipKeyHides)', (await tip()).visible);
await page.keyboard.press('a');
await page.waitForTimeout(60);
check('frappe (lettre) : bulle masquée', !(await tip()).visible);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nF. Focus clavier / focus par clic');
// ════════════════════════════════════════════════════════════════════════════
await page.mouse.move(600, 450);
await page.waitForTimeout(consts.warm + 100);
// vt-b précède vt-a dans le DOM (insertion en tête) : Tab depuis vt-b mène à vt-a.
await page.evaluate(() => document.getElementById('vt-b').focus());
await page.keyboard.press('Tab');
const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
check('prémisse : Tab a amené le focus sur vt-a', focused === 'vt-a', focused);
check('focus clavier : bulle affichée', await waitVisible('Infobulle A'));
await page.evaluate(() => document.activeElement.blur());
check('perte du focus : bulle masquée', await waitHidden());
await page.waitForTimeout(consts.warm + 100);
c = await center('#vt-comp');
await page.mouse.click(c.x, c.y);
await park();
await page.waitForTimeout(consts.cold + 300);
const compFocused = await page.evaluate(() => document.activeElement && document.activeElement.id);
check('prémisse : le clic a donné le focus', compFocused === 'vt-comp', compFocused);
check('focus par clic, pointeur parti : aucune bulle', !(await tip()).visible);
await page.evaluate(() => document.activeElement.blur());

// ════════════════════════════════════════════════════════════════════════════
console.log('\nG. Porteur détruit sous la bulle');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => {
  const d = document.createElement('button');
  d.id = 'vt-doomed';
  d.style.cssText = 'position:fixed;left:300px;top:400px;width:40px;height:30px;z-index:5;';
  document.body.appendChild(d);
  setTip(d, 'Condamné');
});
c = await center('#vt-doomed');
await page.mouse.move(c.x, c.y);
check('bulle affichée sur le porteur condamné', await waitVisible('Condamné'));
await page.evaluate(() => document.getElementById('vt-doomed').remove());
check('porteur retiré du DOM : bulle masquée', await waitHidden());
await park();

// ════════════════════════════════════════════════════════════════════════════
console.log('\nH. Défilement');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => {
  const m = document.getElementById('messages');
  const sp = document.createElement('div');
  sp.id = 'vt-spacer';
  sp.style.cssText = 'height:3000px;flex:none;position:relative;';   // .messages est en flex colonne
  const inner = document.createElement('button');
  inner.id = 'vt-inner';
  inner.style.cssText = 'position:absolute;top:120px;left:40px;width:30px;height:30px;';
  sp.appendChild(inner);
  m.appendChild(sp);
  m.scrollTop = 0;
  setTip(inner, 'Dans le fil');
});
const scrollable = await page.evaluate(() => { const m = document.getElementById('messages'); return m.scrollHeight > m.clientHeight; });
check('prémisse : le fil défile', scrollable);
await page.waitForTimeout(consts.warm + 100);
c = await center('#vt-comp');
await page.mouse.move(c.x, c.y);
check('bulle du composer affichée', await waitVisible('Infobulle composer'));
const scrolled = await page.evaluate(async () => {
  const m = document.getElementById('messages');
  let n = 0;
  const on = () => { n++; };
  m.addEventListener('scroll', on);
  for (let i = 1; i <= 5; i++) {
    m.scrollTop = i * 80;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  m.removeEventListener('scroll', on);
  return n;
});
check('prémisse : le fil a émis des événements scroll', scrolled > 0, scrolled);
t = await tip();
check('défilement du fil (streaming) : la bulle du composer reste', t.visible && t.text === 'Infobulle composer');
await page.evaluate(() => { document.getElementById('messages').scrollTop = 0; });
await park();
await waitHidden();
await page.waitForTimeout(consts.warm + 100);
c = await center('#vt-inner');
await page.mouse.move(c.x, c.y);
check('bulle d\'un porteur du fil affichée', await waitVisible('Dans le fil'));
await page.evaluate(() => { document.getElementById('messages').scrollTop = 60; });
check('défilement du conteneur du porteur : bulle masquée', await waitHidden());

// ════════════════════════════════════════════════════════════════════════════
check('aucune erreur console', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nOK — tout passe');
process.exit(failures.length ? 1 : 0);
