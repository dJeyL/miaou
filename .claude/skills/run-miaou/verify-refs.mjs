#!/usr/bin/env node
// Vérification des références dans le texte du modèle (lot AI-1) : la couche
// DOM que QuickJS ne voit pas — marked et DOMPurify réels, clic, lightbox,
// téléchargement, infobulle. Les purs (résolution, neutralisation, masquage,
// filtre de conversation, ancrage par ligne) sont testés dans tests/.
//
// Ce qui est vérifié :
//   A. rendu : un [file_ref:…] devient un lien a.file-ref en fin de paragraphe,
//      y compris écrit en cible d'un lien Markdown ([nom](file_ref:…)),
//      dans une liste et dans un tableau (jamais un bloc HTML qui avalerait la
//      ligne) ; libellé à `_` rendu tel quel ; glyphe CSS présent et différent
//      pour une image ; attributs d'infobulle et ARIA conservés par DOMPurify ;
//      pas de target ; [conv_ref:…] porte son infobulle ;
//   B. clic : fichier texte → téléchargement nommé ; image jointe → lightbox à
//      ses dimensions figées ; image res_ sans w/h → lightbox aux dimensions
//      MESURÉES ; res_ d'une autre conversation PRÉSENT en cache → toast et
//      rien d'autre (la prémisse « il est en cache » est vérifiée) ; handle
//      inconnu → toast ;
//   C. infobulle d'un lien coupé sur deux lignes : ancrée sur la ligne survolée
//      (sur l'ancien code, ancrée au-dessus de la première ligne dans les deux
//      cas) ;
//   D. streaming : marqueur ouvert en queue masqué pendant le streaming, visible
//      brut au rendu final ;
//   E. copie d'un message et export .md de la conversation : aucun marqueur brut.
//
// Fixtures construites ici (page.evaluate), rien du module de seed. Les id de
// conversation et de ressource sont propres au script.
//
// Usage : node verify-refs.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
// VERIFY_DIST : rejouer contre un autre bundle (ex. celui d'avant le lot).
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
await page.waitForTimeout(400);

// ── Fixtures ────────────────────────────────────────────────────────────────
// Deux conversations : c-refs (affichée) et c-other, dont un res_ reste en
// cache session après son ouverture. Images générées par canvas (PNG réel,
// décodable) : 40×20 pour le res_ sans dimensions, 64×32 pour la pièce jointe
// dont les dimensions figées (300×150) diffèrent volontairement des vraies —
// la lightbox doit prendre les figées, comme pour une vignette de bulle.
await page.evaluate(async () => {
  const png = (w, h) => new Promise((resolve) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, w, h);
    c.toBlob((b) => b.arrayBuffer().then(resolve), 'image/png');
  });
  const text = (s) => new TextEncoder().encode(s).buffer;
  const now = Date.now();
  const recs = [
    { id: 'res_vrtxt', conversationId: 'c-refs', class: 'inline', mime: 'text/csv', name: 'rapport_final_v2.csv', data: text('a,b\n1,2\n') },
    { id: 'res_vrimg', conversationId: 'c-refs', class: 'binary', mime: 'image/png', name: 'graphe.png', data: await png(40, 20) },
    { id: 'att_vr1', attId: 'att-1', conversationId: 'c-refs', class: 'binary', mime: 'image/png', name: 'capture.png', data: await png(64, 32), w: 300, h: 150 },
    { id: 'res_vrother', conversationId: 'c-other', class: 'inline', mime: 'text/plain', name: 'secret.txt', data: text('ailleurs') },
  ];
  for (const r of recs) { r.size = r.data.byteLength; r.createdAt = now; await putResource(r); }
  const long = 'Un lien de conversation assez long pour passer à la ligne dans une colonne étroite';
  saveConversation({ id: 'c-other', title: 'Autre conversation', timestamp: now - 1000, spaceId: DEFAULT_SPACE_ID,
    messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'réponse ailleurs' }] });
  // Titre d'un conv_ref sans libellé : lu dans l'index des RÉSUMÉS (règle de
  // resolveConvRefs, reprise par neutralizeRefMarkers), pas dans conv.title.
  saveSummary('c-other', { title: 'Autre conversation', timestamp: now, summary: 's', keywords: [] });
  saveConversation({ id: 'c-refs', title: 'Références', timestamp: now, spaceId: DEFAULT_SPACE_ID, attSeq: 1,
    messages: [
      { role: 'user', content: 'Donne-moi les fichiers.' },
      { role: 'assistant', content:
        'Le rapport est prêt : [file_ref:res_vrtxt]\n\n' +
        '- la capture : [file_ref:att-1|la capture]\n' +
        '- le graphe : [file_ref:res_vrimg]\n' +
        // Forme déviante observée sur un petit modèle : le marqueur en CIBLE
        // d'un lien Markdown (normalizeRefLinkForms).
        '- forme déviante : [le CSV](file_ref:res_vrtxt)\n\n' +
        '| Fichier | Lien |\n|---|---|\n| autre | [file_ref:res_vrother] |\n| inconnu | [file_ref:res_nope] |\n\n' +
        'Voir aussi [conv_ref:c-other].\n\n' +
        'Paragraphe étroit : début [conv_ref:c-other|' + long + '] fin.' },
    ] });
});
// c-other d'abord : son res_ entre dans le cache session et y RESTE.
await page.evaluate(() => openConversation('c-other'));
await page.waitForFunction(() => currentConvId === 'c-other');
await page.evaluate(() => openConversation('c-refs'));
await page.waitForFunction(() => document.querySelectorAll('#thread a.file-ref').length > 0, null, { timeout: 5000 }).catch(() => {});

// ── A. Rendu ────────────────────────────────────────────────────────────────
const A = await page.evaluate(() => {
  const links = [...document.querySelectorAll('#thread .msg.assistant .body a.file-ref')];
  const by = (h) => links.find(a => a.getAttribute('href') === '#miaou-file:' + h);
  const txt = by('res_vrtxt'), img = by('res_vrimg'), att = by('att-1');
  const glyph = (a) => { const cs = getComputedStyle(a, '::after'); return { w: cs.width, mask: cs.maskImage || cs.webkitMaskImage }; };
  const conv = document.querySelector('#thread .msg.assistant .body a.conv-ref');
  return {
    count: links.length,
    deviant: (links.find(a => a.textContent === 'le CSV') || { getAttribute: () => null }).getAttribute('href'),
    txtParent: txt && txt.parentElement.tagName,
    attParent: att && att.parentElement.tagName,
    tableParent: by('res_vrother') && by('res_vrother').parentElement.tagName,
    txtText: txt && txt.textContent,
    txtHasEm: !!(txt && txt.querySelector('em')),
    txtKind: txt && txt.dataset.fileKind, imgKind: img && img.dataset.fileKind,
    txtGlyph: txt && glyph(txt), imgGlyph: img && glyph(img),
    txtTip: txt && txt.getAttribute('data-tip'), txtDetail: txt && txt.getAttribute('data-tip-detail'),
    txtAria: txt && (txt.getAttribute('aria-description') || txt.getAttribute('aria-label')),
    targets: links.filter(a => a.hasAttribute('target')).length + (conv && conv.hasAttribute('target') ? 1 : 0),
    convTip: conv && conv.getAttribute('data-tip'),
    rawLeft: /\[(file|conv)_ref:/.test(document.querySelector('#thread .msg.assistant .body').textContent),
  };
});
check('A. six liens de fichier rendus', A.count === 6, A.count);
check('A. forme lien Markdown → lien de fichier', A.deviant === '#miaou-file:res_vrtxt', A.deviant);
check('A. en fin de paragraphe : dans un <p>', A.txtParent === 'P', A.txtParent);
check('A. dans une liste : dans un <li>', A.attParent === 'LI', A.attParent);
check('A. dans un tableau : dans un <td>', A.tableParent === 'TD', A.tableParent);
check('A. libellé à _ rendu tel quel, sans emphase', A.txtText === 'rapport_final_v2.csv' && !A.txtHasEm, A.txtText);
check('A. glyphe ::after présent (13px, masque)', A.txtGlyph && A.txtGlyph.w === '13px' && /url\(/.test(A.txtGlyph.mask || ''), JSON.stringify(A.txtGlyph && A.txtGlyph.w));
check('A. glyphe image distinct du glyphe de téléchargement', A.imgKind === 'image' && A.txtKind === 'file' && A.imgGlyph.mask !== A.txtGlyph.mask);
check('A. infobulle et ARIA gardées par DOMPurify', A.txtTip === 'Télécharger' && A.txtDetail === 'rapport_final_v2.csv' && !!A.txtAria, A.txtTip + ' / ' + A.txtAria);
check('A. aucun target sur les liens internes', A.targets === 0, A.targets);
check('A. conv_ref porte son infobulle', A.convTip === 'Ouvrir la conversation', A.convTip);
check('A. aucun marqueur brut à l\'écran', A.rawLeft === false);

// ── B. Clics ────────────────────────────────────────────────────────────────
const clickLink = (h) => page.evaluate((hh) => document.querySelector('#thread a.file-ref[href="#miaou-file:' + hh + '"]').click(), h);
const lightbox = () => page.evaluate(() => {
  const lb = document.querySelector('.mermaid-lightbox.show');
  if (!lb) return null;
  const img = lb.querySelector('img');
  const canvas = img && img.parentElement;
  return { w: canvas && parseFloat(canvas.style.width), h: canvas && parseFloat(canvas.style.height) };
});
const closeLb = () => page.evaluate(() => closeMermaidLightbox());
const toastText = () => page.evaluate(() => [...document.querySelectorAll('#toasts .toast-text')].map(t => t.textContent).join(' | '));
const clearToasts = () => page.evaluate(() => { document.querySelectorAll('#toasts .toast-x').forEach(b => b.click()); });

const dlPromise = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
await clickLink('res_vrtxt');
const dl = await dlPromise;
check('B. fichier texte : téléchargement', !!dl);
check('B. nommé d\'après le record', dl && dl.suggestedFilename() === 'rapport_final_v2.csv', dl && dl.suggestedFilename());
check('B. le clic ne navigue pas (hash inchangé)', await page.evaluate(() => location.hash === ''));

await clickLink('att-1');
await page.waitForTimeout(300);
const lb1 = await lightbox();
check('B. image jointe : lightbox ouverte', !!lb1);
check('B. dimensions figées de la pièce jointe (300×150)', lb1 && lb1.w === 300 && lb1.h === 150, lb1 && lb1.w + '×' + lb1.h);
await closeLb();

await clickLink('res_vrimg');
await page.waitForTimeout(400);
const lb2 = await lightbox();
check('B. image res_ sans w/h : lightbox aux dimensions mesurées (40×20)', lb2 && lb2.w === 40 && lb2.h === 20, lb2 && lb2.w + '×' + lb2.h);
await closeLb();

const otherCached = await page.evaluate(() => !!getCachedRecord('res_vrother'));
check('B. prémisse : le res_ de l\'autre conversation est en cache', otherCached);
await clearToasts();
const dlOther = page.waitForEvent('download', { timeout: 1500 }).catch(() => null);
await clickLink('res_vrother');
await page.waitForTimeout(300);
check('B. res_ d\'une autre conversation : toast', /Fichier introuvable dans cette conversation/.test(await toastText()), await toastText());
check('B. … et aucun téléchargement', (await dlOther) === null);
check('B. … ni lightbox', (await lightbox()) === null);
await clearToasts();
await page.waitForTimeout(300);
await clickLink('res_nope');
await page.waitForTimeout(300);
check('B. handle inconnu : toast', /Fichier introuvable/.test(await toastText()));

// ── C. Infobulle d'un lien sur deux lignes ─────────────────────────────────
await clearToasts();
const lines = await page.evaluate(() => {
  const a = [...document.querySelectorAll('#thread a.conv-ref')].find(x => /assez long/.test(x.textContent));
  a.parentElement.style.width = '260px';
  a.scrollIntoView({ block: 'center' });
  return [...a.getClientRects()].filter(r => r.width > 0).map(r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }));
});
check('C. prémisse : le lien est coupé sur deux lignes au moins', lines.length >= 2, lines.length);
const tipBox = () => page.evaluate(() => {
  const el = document.querySelector('body > .tip');
  if (!el || !el.classList.contains('tip-shown')) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, side: el.dataset.side, arrowX: parseFloat(el.style.getPropertyValue('--arrow-x')) };
});
const hoverRect = async (r) => {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await page.mouse.move((r.left + r.right) / 2, (r.top + r.bottom) / 2, { steps: 3 });
  await page.waitForFunction(() => { const el = document.querySelector('body > .tip'); return el && el.classList.contains('tip-shown'); }, null, { timeout: 3000 }).catch(() => {});
  return tipBox();
};
if (lines.length >= 2) {
  const first = lines[0], last = lines[lines.length - 1];
  const t1 = await hoverRect(first);
  const t2 = await hoverRect(last);
  const aim = (t, r) => t && Math.abs((t.left + t.arrowX) - (r.left + r.right) / 2);
  check('C. première ligne : bulle au-dessus de la première ligne', t1 && t1.side === 'top' && t1.bottom <= first.top, t1 && t1.bottom + ' vs ' + first.top);
  check('C. dernière ligne : bulle au-dessus de la DERNIÈRE ligne, pas de la première',
    t2 && t2.side === 'top' && t2.bottom <= last.top && t2.bottom > first.top, t2 && t2.bottom + ' ∈ (' + first.top + ', ' + last.top + ']');
  check('C. flèche sur le centre de la ligne survolée', aim(t2, last) !== null && aim(t2, last) < 2, aim(t2, last));
}
await page.mouse.move(5, 5);

// ── D. Streaming ────────────────────────────────────────────────────────────
const D = await page.evaluate(() => {
  const wrap = document.createElement('div');
  const body = document.createElement('div');
  wrap.appendChild(body); document.body.appendChild(wrap);
  renderStreamBlocks(wrap, body, 'Voir [file_ref:res_4f', { caret: true });
  const during = body.textContent;
  renderStreamBlocks(wrap, body, 'Voir [file_ref:res_4f', { force: true, noHtml: true });
  const final = body.textContent;
  wrap.remove();
  return { during, final };
});
check('D. streaming : marqueur ouvert masqué', !/file_ref/.test(D.during) && /Voir/.test(D.during), JSON.stringify(D.during));
check('D. rendu final : marqueur ouvert visible brut', /\[file_ref:res_4f/.test(D.final), JSON.stringify(D.final));

// ── E. Copie et export .md ─────────────────────────────────────────────────
await page.evaluate(() => copyMsg(document.querySelector('#thread .msg.assistant .msg-copy')));
await page.waitForTimeout(200);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('E. copie : aucun marqueur brut', !/\[(file|conv|web)_ref:/.test(clip));
check('E. copie : libellés présents', /rapport_final_v2\.csv/.test(clip) && /la capture/.test(clip) && /Autre conversation/.test(clip), clip.slice(0, 80));
const mdDl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
await page.evaluate(() => downloadConvMd());
const md = await mdDl;
const mdText = md ? fs.readFileSync(await md.path(), 'utf8') : '';
check('E. export .md : aucun marqueur brut', !!md && !/\[(file|conv|web)_ref:/.test(mdText));
check('E. export .md : libellé de fichier présent', /rapport_final_v2\.csv/.test(mdText));

check('aucune erreur console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));

await browser.close();
console.log(failures.length ? `\nÉCHEC — ${failures.length} vérification(s) en échec` : '\nOK — toutes les vérifications passent');
process.exit(failures.length ? 1 : 0);
