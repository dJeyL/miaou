// Mesure la hauteur de la palette de commandes (Ctrl/Cmd+K) et cherche le
// plafond `max-height` sous lequel la liste racine tient sans scroll.
// Motif : l'entrée « Agents » (conditionnelle) fait déborder la liste sur un
// grand écran, alors que le plafond de 540px n'y est pas contraint par la place
// disponible mais par sa propre valeur absolue.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + resolve(HERE, '../../../dist/miaou.html');

// Viewport calé sur le cas remonté : 32 pouces, zoom 90%.
const VW = parseInt(process.argv[2] || '1512', 10);
const VH = parseInt(process.argv[3] || '1160', 10);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(APP);
await page.waitForSelector('#composer-text', { timeout: 15000 });

// Six des dix-sept commandes portent un prédicat `enabled` : la palette n'en
// montre qu'un sous-ensemble selon l'état. On mesure le CAS MAXIMAL (toutes
// visibles), qui est celui remonté, en neutralisant les prédicats — construire
// l'état réel (un agent qui tourne, deux Espaces, une conversation ouverte)
// mesurerait la même hauteur pour beaucoup plus de pilotage.
const shown = await page.evaluate(() => {
  COMMANDS.forEach(c => { if (c.enabled) c.enabled = () => true; });
  return COMMANDS.length;
});
console.log('commandes forcées visibles : ' + shown);

await page.keyboard.press('Meta+k');            // Meta, pas Control (macOS)
await page.waitForSelector('.cmdk-list', { timeout: 5000 });
await page.waitForTimeout(300);                 // transition d'ouverture

const m = await page.evaluate(() => {
  const box  = document.querySelector('.cmdk-box') || document.querySelector('.cmdk');
  const list = document.querySelector('.cmdk-list');
  const input = document.querySelector('.cmdk-input');
  const items = [...document.querySelectorAll('.cmdk-item')];
  const cs = getComputedStyle(list);
  return {
    viewportH: window.innerHeight,
    boxClass: box ? box.className : null,
    boxH: box ? box.getBoundingClientRect().height : null,
    boxMaxHeight: box ? getComputedStyle(box).maxHeight : null,
    listClientH: list.clientHeight,
    listScrollH: list.scrollHeight,
    listPadding: cs.paddingTop + ' / ' + cs.paddingBottom,
    inputH: input ? input.getBoundingClientRect().height : null,
    itemCount: items.length,
    itemH: items.length ? items[0].getBoundingClientRect().height : null,
    hasAgents: items.some(i => /Agents/.test(i.textContent)),
    scrolls: list.scrollHeight > list.clientHeight + 1,
  };
});

const need = m.listScrollH + (m.inputH || 0);   // liste entière + champ de saisie
console.log(JSON.stringify({ ...m, boxHeightNeeded: need }, null, 2));

const check = (label, ok) => console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
check(`l'entrée « Agents » est présente (sinon la mesure ne vaut rien)`, m.hasAgents);
// Assertion de NON-RÉGRESSION : le mode racine au complet doit tenir sans
// scroll. Elle échouait avant le passage du plafond de 540 à 620px, et
// réchouera si une commande de plus est ajoutée sans re-mesurer.
check(`le mode racine complet tient sans scroll`, !m.scrolls);
check(`la boîte reste sous le garde-fou (100vh - 16vh)`, m.boxH <= Math.floor(m.viewportH * 0.84) + 1);
console.log(`\n→ hauteur de boîte nécessaire : ${Math.ceil(need)}px`);
console.log(`→ place disponible (100vh - 16vh) : ${Math.floor(m.viewportH * 0.84)}px`);
if (errors.length) console.log('\nconsole errors:\n' + errors.join('\n'));
await browser.close();
