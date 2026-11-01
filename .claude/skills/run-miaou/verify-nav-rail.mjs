#!/usr/bin/env node
// Rail de navigation du fil (nav-rail.js) : marques, illumination, survol
// croisé marque <-> entrée du panneau, saut au clic, conditions d'affichage.
//
// Montage : une conversation de huit échanges aux réponses longues, écrite
// directement en stockage puis ouverte — aucune génération, le rail ne fait
// que lire le DOM du fil.
//
// Le contrôle des fonds du panneau tourne dans les DEUX thèmes : en clair,
// --surface-3 et --surface-4 ont la même luminosité, et l'entrée survolée ne se
// distinguait pas d'une entrée allumée (relevé à l'œil, 2026-11-02).
//
// Usage : node verify-nav-rail.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

const EXCHANGES = 8;

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// ── Fixture ──────────────────────────────────────────────────────────────────
async function openFixture(pg) {
  await pg.goto('file://' + distPath);
  await pg.waitForSelector('#composer-text');
  await pg.waitForFunction(() => {
    const o = document.getElementById('boot-overlay');
    return !o || getComputedStyle(o).opacity === '0';
  }, null, { timeout: 15000 });
  await pg.evaluate(async (n) => {
    const para = 'Paragraphe de réponse assez long pour occuper de la hauteur dans le fil. '.repeat(6);
    const messages = [];
    const t0 = Date.now() - 3600e3;
    for (let i = 0; i < n; i++) {
      messages.push({ role: 'user', content: `Question numéro ${i} :\n\n  avec   des blancs   à replier`, ts: t0 + i * 1000 });
      messages.push({ role: 'assistant', content: Array(5).fill(para).join('\n\n'), model: 'stub-model', ts: t0 + i * 1000 + 500 });
    }
    const id = 'conv-navrail-' + Math.random().toString(36).slice(2);
    saveConversation({ id, title: 'Rail', timestamp: Date.now(), messages, spaceId: activeSpaceId });
    await openConversation(id, true);
  }, EXCHANGES);
  await pg.waitForFunction((n) => document.querySelectorAll('#thread > .msg.user').length === n, EXCHANGES);
  await pg.waitForFunction((n) => document.querySelectorAll('#nav-rail-marks .nav-rail-mark').length === n, EXCHANGES);
  await pg.waitForTimeout(400);
}
await openFixture(page);

const state = () => page.evaluate(() => {
  const rail = document.getElementById('nav-rail');
  const marks = [...document.querySelectorAll('#nav-rail-marks .nav-rail-mark')];
  const items = [...document.querySelectorAll('#nav-rail-panel .nav-rail-item')];
  const panel = document.getElementById('nav-rail-panel');
  return {
    visible: !rail.hidden && rail.getClientRects().length > 0,
    lit: marks.map((m, i) => m.classList.contains('lit') ? i : -1).filter(i => i >= 0),
    widths: marks.map(m => parseFloat(getComputedStyle(m, '::before').width)),
    hoverMarks: marks.map((m, i) => m.classList.contains('hover') ? i : -1).filter(i => i >= 0),
    hoverItems: items.map((m, i) => m.classList.contains('hover') ? i : -1).filter(i => i >= 0),
    panelOpacity: getComputedStyle(panel).opacity,
    items: items.map(it => it.textContent),
  };
});
const markCenter = (i) => page.evaluate((i) => {
  const r = document.querySelectorAll('#nav-rail-marks .nav-rail-mark')[i].getBoundingClientRect();
  return { x: r.left + r.width - 6, y: r.top + r.height / 2 };
}, i);
const itemCenter = (i) => page.evaluate((i) => {
  const r = document.querySelectorAll('#nav-rail-panel .nav-rail-item')[i].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, i);
// Distance entre le haut de la bulle i et le haut utile de la zone du fil.
const bubbleOffset = (i) => page.evaluate((i) => {
  const m = document.getElementById('messages');
  const b = document.querySelectorAll('#thread > .msg.user')[i];
  const padTop = parseFloat(getComputedStyle(m).paddingTop) || 0;
  return b.getBoundingClientRect().top - (m.getBoundingClientRect().top + padTop);
}, i);

// ── A. Présence et géométrie ─────────────────────────────────────────────────
console.log('\nA. présence et géométrie');
let s = await state();
check('le rail est visible sur un fil de plusieurs messages', s.visible);
const geo = await page.evaluate(() => {
  const m = document.getElementById('messages').getBoundingClientRect();
  const marks = document.getElementById('nav-rail-marks').getBoundingClientRect();
  const thread = document.getElementById('thread').getBoundingClientRect();
  return { mMid: (m.top + m.bottom) / 2, kMid: (marks.top + marks.bottom) / 2,
           kLeft: marks.left, tRight: thread.right, mRight: m.right, kRight: marks.right };
});
check('colonne de marques centrée verticalement sur la zone du fil',
  Math.abs(geo.mMid - geo.kMid) < 2, `écart ${(geo.kMid - geo.mMid).toFixed(1)}px`);
check('marques à droite de la colonne du fil, dans la zone',
  geo.kLeft >= geo.tRight && geo.kRight <= geo.mRight, `fil→${geo.tRight.toFixed(0)}, marques ${geo.kLeft.toFixed(0)}–${geo.kRight.toFixed(0)}, zone→${geo.mRight.toFixed(0)}`);

// ── B. Illumination ──────────────────────────────────────────────────────────
console.log('\nB. illumination');
check('ouverture au fond : le dernier échange est allumé, pas le premier',
  s.lit.includes(EXCHANGES - 1) && !s.lit.includes(0), `allumés ${s.lit}`);
// Remontée par un VRAI geste de molette : l'ouverture colle le fil au fond le
// temps que sa hauteur se stabilise (stickToBottomWhileSettling), et seul un
// geste utilisateur y met fin — un scrollTop écrit par le script est repris.
await page.mouse.move(500, 450);
await page.mouse.wheel(0, -100000);
await page.waitForFunction(() => document.querySelector('#nav-rail-marks .nav-rail-mark').classList.contains('lit'));
await page.waitForTimeout(250);   // transition de largeur (lire en cours de route mesure un entre-deux)
s = await state();
check('en haut du fil : le premier est allumé, pas le dernier',
  s.lit.includes(0) && !s.lit.includes(EXCHANGES - 1), `allumés ${s.lit}`);
check('marque au repos plus courte qu\'une marque allumée',
  s.widths[EXCHANGES - 1] < s.widths[0], `${s.widths[EXCHANGES - 1]} < ${s.widths[0]}`);

// ── C. Survol d'une marque ───────────────────────────────────────────────────
console.log('\nC. survol d\'une marque');
const K = 4;
const restW = s.widths[K];        // 4 et ses voisines ne sont pas allumées en haut du fil
check('prémisse : la marque survolée et ses voisines sont au repos',
  ![K - 2, K - 1, K, K + 1, K + 2].some(i => s.lit.includes(i)), `allumés ${s.lit}`);
let p = await markCenter(K);
await page.mouse.move(p.x, p.y);
await page.waitForFunction(() => getComputedStyle(document.getElementById('nav-rail-panel')).opacity === '1');
await page.waitForTimeout(250);   // transition de largeur
s = await state();
check('le survol ouvre le panneau, une entrée par message', s.items.length === EXCHANGES, `${s.items.length}`);
check('aperçu aux blancs repliés', s.items[0] === 'Question numéro 0 : avec des blancs à replier', JSON.stringify(s.items[0]));
check('marque survolée élargie de 8px', Math.abs(s.widths[K] - (restW + 8)) < 0.5, `${s.widths[K]} (repos ${restW})`);
check('voisines directes élargies de 4px',
  Math.abs(s.widths[K - 1] - (restW + 4)) < 0.5 && Math.abs(s.widths[K + 1] - (restW + 4)) < 0.5,
  `${s.widths[K - 1]} / ${s.widths[K + 1]}`);
check('voisines à distance 2 inchangées',
  Math.abs(s.widths[K - 2] - restW) < 0.5 && Math.abs(s.widths[K + 2] - restW) < 0.5,
  `${s.widths[K - 2]} / ${s.widths[K + 2]}`);
check('l\'entrée correspondante du panneau est désignée (et elle seule)',
  s.hoverItems.join() === String(K), `${s.hoverItems}`);

// Fonds du panneau dans les deux thèmes : survolée ≠ allumée ≠ repos, et le
// survol ÉCLAIRCIT (luminance au-dessus de celle du panneau).
const bgs = () => page.evaluate((K) => {
  const lum = (c) => {
    // color-mix rend `color(srgb r g b)` en 0..1, les autres `rgb()` en 0..255.
    const scale = c.startsWith('color(') ? 255 : 1;
    const v = c.replace(/^color\(srgb/, '').match(/[\d.]+/g).slice(0, 3).map(x => Number(x) * scale);
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const items = document.querySelectorAll('#nav-rail-panel .nav-rail-item');
  const lit = [...items].find(it => it.classList.contains('lit') && !it.classList.contains('hover'));
  const panel = getComputedStyle(document.getElementById('nav-rail-panel')).backgroundColor;
  const hover = getComputedStyle(items[K]).backgroundColor;
  const litBg = lit ? getComputedStyle(lit).backgroundColor : null;
  return { panel, hover, lit: litBg, lPanel: lum(panel), lHover: lum(hover), lLit: litBg ? lum(litBg) : null };
}, K);
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(200);   // transition de fond des entrées
  const b = await bgs();
  check(`[${theme}] entrée survolée distincte de l'entrée allumée`, b.lit !== null && b.hover !== b.lit, `${b.hover} vs ${b.lit}`);
  check(`[${theme}] le survol éclaircit le fond (au-dessus du panneau)`, b.lHover > b.lPanel + 3,
    `luminance ${b.lHover.toFixed(1)} vs panneau ${b.lPanel.toFixed(1)}`);
}
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });

// ── D. Survol d'une entrée du panneau ────────────────────────────────────────
console.log('\nD. survol d\'une entrée');
const J = 6;
p = await itemCenter(J);
await page.mouse.move(p.x, p.y, { steps: 4 });
await page.waitForTimeout(250);
s = await state();
check('le panneau reste ouvert en passant de la marque à l\'entrée', s.panelOpacity === '1', s.panelOpacity);
check('survol d\'entrée : sa marque est désignée', s.hoverMarks.join() === String(J), `${s.hoverMarks}`);
check('survol d\'entrée : sa marque élargie de 8px, ses voisines de 4px',
  Math.abs(s.widths[J] - (s.widths[J - 2] + 8)) < 0.5 && Math.abs(s.widths[J - 1] - (s.widths[J - 2] + 4)) < 0.5,
  `${s.widths[J - 2]} → ${s.widths[J - 1]} → ${s.widths[J]}`);
check('l\'ancienne marque survolée est revenue au repos', Math.abs(s.widths[K] - restW) < 0.5, `${s.widths[K]}`);

// ── E. Clic ──────────────────────────────────────────────────────────────────
console.log('\nE. saut au clic');
await page.mouse.click(p.x, p.y);
await page.waitForFunction((j) => {
  const m = document.getElementById('messages');
  const b = document.querySelectorAll('#thread > .msg.user')[j];
  const padTop = parseFloat(getComputedStyle(m).paddingTop) || 0;
  return Math.abs(b.getBoundingClientRect().top - (m.getBoundingClientRect().top + padTop)) < 3;
}, J, { timeout: 3000 }).catch(() => {});
let off = await bubbleOffset(J);
check('clic sur une entrée : le message arrive en haut de la zone', Math.abs(off) < 3, `écart ${off.toFixed(1)}px`);
await page.waitForTimeout(100);
s = await state();
check('… et sa marque s\'allume', s.lit.includes(J), `allumés ${s.lit}`);

const I = 2;
p = await markCenter(I);
await page.mouse.move(p.x, p.y, { steps: 4 });
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(500);
off = await bubbleOffset(I);
check('clic sur une marque : le message arrive en haut de la zone', Math.abs(off) < 3, `écart ${off.toFixed(1)}px`);

// ── F. Sortie ────────────────────────────────────────────────────────────────
console.log('\nF. sortie du rail');
await page.mouse.move(400, 400, { steps: 4 });
await page.waitForFunction(() => getComputedStyle(document.getElementById('nav-rail-panel')).opacity === '0', null, { timeout: 2000 }).catch(() => {});
s = await state();
check('quitter le rail ferme le panneau', s.panelOpacity === '0', s.panelOpacity);
check('quitter le rail efface les désignations', s.hoverMarks.length === 0 && s.hoverItems.length === 0,
  `${s.hoverMarks} / ${s.hoverItems}`);

// ── G. Reconstruction et conditions d'affichage ──────────────────────────────
console.log('\nG. reconstruction et affichage');
await page.evaluate(() => { appendUserMessage('Interjection ajoutée', Date.now()); });
await page.waitForFunction((n) => document.querySelectorAll('#nav-rail-marks .nav-rail-mark').length === n + 1, EXCHANGES, { timeout: 2000 }).catch(() => {});
const nMarks = await page.evaluate(() => document.querySelectorAll('#nav-rail-marks .nav-rail-mark').length);
check('une bulle user ajoutée ajoute une marque', nMarks === EXCHANGES + 1, `${nMarks}`);

await page.evaluate(() => { document.getElementById('thread').style.maxWidth = 'none'; });
await page.waitForTimeout(300);
s = await state();
check('fil pleine largeur (gouttière insuffisante) : rail masqué', !s.visible);
await page.evaluate(() => { document.getElementById('thread').style.maxWidth = ''; });
await page.waitForTimeout(600);   // transition de max-width du fil
s = await state();
check('gouttière rendue : rail de retour', s.visible);

await page.evaluate(() => newConversation());
await page.waitForTimeout(300);
s = await state();
check('accueil (aucun message) : rail masqué', !s.visible);

// ── I. Calage sur les pixels physiques (zoom 90 % sur écran 2x) ─────────────
console.log('\nI. ratio de pixels fractionnaire (1,8)');
const zoomed = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.8 });
zoomed.on('pageerror', (e) => consoleErrors.push(String(e)));
await openFixture(zoomed);
const px = await zoomed.evaluate(() => {
  const dpr = window.devicePixelRatio;
  const marks = [...document.querySelectorAll('#nav-rail-marks .nav-rail-mark')];
  const cs = getComputedStyle(marks[0], '::before');
  const inset = parseFloat(cs.marginTop);
  const thick = parseFloat(cs.height);
  const frac = (v) => Math.abs(v * dpr - Math.round(v * dpr));
  return {
    dpr, thick, thickDev: thick * dpr,
    worstTop: Math.max(...marks.map(m => frac(m.getBoundingClientRect().top + inset))),
    pitches: marks.slice(1).map((m, i) => +(m.getBoundingClientRect().top - marks[i].getBoundingClientRect().top).toFixed(4)),
  };
});
// Tolérances : Chrome arrondit les longueurs au 1/64 de px CSS, soit
// 0,028 pixel d'écran à 1,8, et la position d'un trait en subit DEUX (haut de
// la colonne, haut de la marque) — 0,056 au pire, très loin du demi-pixel qui
// ferait basculer son arrondi. Ce qui est interdit, c'est le cumul de marque
// en marque : empilées, les marques dérivaient de 0,147 à la huitième
// (mesuré), et la toute première version avait un pas de 21,6 pixels d'écran.
check('prémisse : ratio de pixels fractionnaire', Math.abs(px.dpr - 1.8) < 1e-3, String(px.dpr));
check('épaisseur = nombre entier de pixels d\'écran', Math.abs(px.thickDev - Math.round(px.thickDev)) < 0.03, `${px.thickDev}`);
check('chaque trait commence sur un pixel d\'écran entier (sans cumul)', px.worstTop < 0.06, `pire écart ${px.worstTop.toFixed(3)} px d'écran`);
check('pas égaux entre marques à un arrondi près', Math.max(...px.pitches) - Math.min(...px.pitches) < 0.03, px.pitches.join(','));
await zoomed.close();

// ── H. Console ───────────────────────────────────────────────────────────────
console.log('\nH. console');
check('aucune erreur console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nOK');
process.exit(failures.length ? 1 : 0);
