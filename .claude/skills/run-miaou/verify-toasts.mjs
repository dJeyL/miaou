#!/usr/bin/env node
// Verify du lot AG — toasts et troisième expression du chat.
//
// Couvre ce que les purs (tests QuickJS : file, durées, placement, résolveur)
// ne voient pas : le DOM réellement produit, le rôle ARIA, le texte posé en
// textContent, le focus jamais volé, le placement MESURÉ dans la vraie mise en
// page (composer, bord droit, drawer ouvert, drawer trop large), la sortie sous
// le kill-switch de mouvement, et la géométrie des sourcils « stockage plein »
// (deux traits distincts, à plat, à la même hauteur — pas un monosourcil).
//
// Usage : node verify-toasts.mjs [dossier-captures] [--headed]
import { launchIsolated } from './stub-backend.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, 'shots-toasts');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, info) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (info !== undefined ? '  (' + info + ')' : ''));
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

async function boot() {
  await page.goto('file://' + distPath);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
  await page.waitForTimeout(400);
}
const visibleToasts = () => page.evaluate(() =>
  [...document.querySelectorAll('#toasts .toast')].filter(t => !t.classList.contains('toast-leaving')).map(t => t.dataset.key));
const clearAll = () => page.evaluate(() => { [..._toastLive.keys()].forEach(k => dismissToast(k)); });

await boot();

// ── 1. Tout sain : rien n'apparaît ────────────────────────────────────────────
{
  const r = await page.evaluate(() => ({
    hidden: document.getElementById('toasts').hidden,
    n: document.querySelectorAll('#toasts .toast').length,
    cls: document.body.className,
  }));
  check('au démarrage, tout sain : aucun toast, conteneur masqué', r.hidden && r.n === 0);
  check('au démarrage : ni miaou-worried ni miaou-storage', !/miaou-(worried|storage)/.test(r.cls), r.cls);
}

// ── 2. Rendu, rôle, textContent, focus ────────────────────────────────────────
{
  await page.focus('#composer-text');
  await page.keyboard.type('brouillon');
  await page.evaluate(() => {
    showToast({ key: 't-err', level: 'error', theme: 'storage', text: 'Erreur <b>pas du HTML</b>', persistent: true,
      action: { label: 'Réglages › Données', run: () => { window.__actionRan = (window.__actionRan || 0) + 1; } } });
    showToast({ key: 't-warn', level: 'warn', theme: 'clipboard', text: 'Copie refusée par le navigateur.' });
    showToast({ key: 't-info', level: 'info', theme: 'services', text: 'Serveur API « Stub » rétabli.' });
  });
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#toasts .toast')];
    return {
      keys: els.map(e => e.dataset.key),
      roles: els.map(e => e.getAttribute('role')),
      errText: els[0].querySelector('.toast-text').textContent,
      errHasB: !!els[0].querySelector('.toast-text b'),
      errBodyTag: els[0].querySelector('.toast-body').tagName,
      warnBodyTag: els[1].querySelector('.toast-body').tagName,
      closes: els.map(e => !!e.querySelector('button.toast-x')),
      glyphs: els.map(e => !!e.querySelector('.toast-glyph svg')),
      active: document.activeElement && document.activeElement.id,
      draft: document.getElementById('composer-text').value,
      live: document.getElementById('toasts').getAttribute('aria-live'),
      opacity: getComputedStyle(els[2]).opacity,
    };
  });
  check('ordre : le plus récent en bas', JSON.stringify(r.keys) === JSON.stringify(['t-err', 't-warn', 't-info']), r.keys.join(','));
  check('rôles : alert pour l\'erreur, status sinon', JSON.stringify(r.roles) === JSON.stringify(['alert', 'status', 'status']), r.roles.join(','));
  check('conteneur aria-live', r.live === 'polite');
  check('texte posé en textContent (aucun <b> interprété)', r.errText === 'Erreur <b>pas du HTML</b>' && !r.errHasB);
  check('corps cliquable = <button> seulement avec action', r.errBodyTag === 'BUTTON' && r.warnBodyTag === 'DIV');
  check('croix et glyphe sur chaque toast', r.closes.every(Boolean) && r.glyphs.every(Boolean));
  check('focus jamais volé : le composer garde le focus et le brouillon', r.active === 'composer-text' && r.draft === 'brouillon', r.active);
  check('entrée achevée (opacité 1)', r.opacity === '1', r.opacity);
  await page.screenshot({ path: path.join(outDir, '01-trois-niveaux-composer.png') });
}

// ── 3. Placement mesuré : à droite du composer (1700 px) ─────────────────────
{
  const r = await page.evaluate(() => {
    const host = document.getElementById('toasts').getBoundingClientRect();
    const input = document.querySelector('.composer .input-wrap').getBoundingClientRect();
    return { mode: document.getElementById('toasts').dataset.placement, hostLeft: host.left, hostRight: host.right,
      hostBottom: host.bottom, inputRight: input.right, inputBottom: input.bottom, vw: innerWidth };
  });
  check('1700 px : placement « composer »', r.mode === 'composer', r.mode);
  check('pile collée au bord droit (marge 16 ±1), sans empiéter sur le champ', Math.abs(r.vw - r.hostRight - 16) <= 1 && r.hostLeft >= r.inputRight + 15.5,
    `left ${r.hostLeft.toFixed(1)} / input ${r.inputRight.toFixed(1)} / right ${r.hostRight.toFixed(1)}`);
  check('bas de la pile aligné sur le bas du champ (±1)', Math.abs(r.hostBottom - r.inputBottom) <= 1,
    `${r.hostBottom.toFixed(1)} vs ${r.inputBottom.toFixed(1)}`);
}

// ── 4. Placement : bord droit (1280 px), jamais sur le composer ──────────────
{
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const host = document.getElementById('toasts').getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    return { mode: document.getElementById('toasts').dataset.placement, hostRight: host.right, hostBottom: host.bottom,
      composerTop: composer.top, vw: innerWidth };
  });
  check('1280 px : placement « edge »', r.mode === 'edge', r.mode);
  check('collé au bord droit (marge 16 ±1)', Math.abs(r.vw - r.hostRight - 16) <= 1, (r.vw - r.hostRight).toFixed(1));
  check('au-dessus du composer, sans le recouvrir', r.hostBottom <= r.composerTop, `${r.hostBottom.toFixed(1)} ≤ ${r.composerTop.toFixed(1)}`);
  await page.screenshot({ path: path.join(outDir, '02-bord-droit-1280.png') });
}

// ── 5. Drawer ouvert : à gauche du drawer (S7) ───────────────────────────────
{
  const bottomBefore = await page.evaluate(() => document.getElementById('toasts').getBoundingClientRect().bottom);
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const host = document.getElementById('toasts').getBoundingClientRect();
    const drawer = document.getElementById('drawer').getBoundingClientRect();
    const t = document.querySelector('#toasts .toast');
    const hit = document.elementFromPoint(host.left + 40, host.bottom - 12);
    return { mode: document.getElementById('toasts').dataset.placement, hostRight: host.right, drawerLeft: drawer.left,
      hostBottom: host.bottom, hitInToast: !!(hit && hit.closest('#toasts')) };
  });
  check('drawer ouvert : même hauteur qu\'avant l\'ouverture (pas de saut vertical)', Math.abs(r.hostBottom - bottomBefore) <= 1,
    `${r.hostBottom.toFixed(1)} vs ${bottomBefore.toFixed(1)}`);
  check('drawer ouvert : placement « beside-drawer »', r.mode === 'beside-drawer', r.mode);
  check('pile à gauche du drawer, marge 16 (±1)', Math.abs(r.drawerLeft - r.hostRight - 16) <= 1, (r.drawerLeft - r.hostRight).toFixed(1));
  check('au-dessus du backdrop : le toast reçoit le pointeur', r.hitInToast);
  await page.screenshot({ path: path.join(outDir, '03-drawer-ouvert.png') });
  await page.evaluate(() => closeSettings());
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => document.getElementById('toasts').dataset.placement);
  check('drawer refermé : la pile revient au bord droit', back === 'edge', back);
}

// ── 6. Drawer trop large pour la place à sa gauche : par-dessus ──────────────
{
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => openTools());
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const host = document.getElementById('toasts').getBoundingClientRect();
    return { mode: document.getElementById('toasts').dataset.placement, hostRight: host.right, vw: innerWidth,
      drawerW: document.getElementById('tools-drawer').offsetWidth };
  });
  check('900 px, drawer large : placement « over-drawer »', r.mode === 'over-drawer', `${r.mode}, drawer ${r.drawerW}`);
  check('par-dessus, collé au bord droit', Math.abs(r.vw - r.hostRight - 16) <= 1);
  await page.screenshot({ path: path.join(outDir, '04-par-dessus-drawer.png') });
  await page.evaluate(() => closeTools());
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.waitForTimeout(400);
}

// ── 7. Remplacement par clé (option B) et plafond (S6) ───────────────────────
{
  // Le remplaçant garde son action : le bloc 8 clique dessus.
  await page.evaluate(() => showToast({ key: 't-err', level: 'error', theme: 'storage', text: 'Erreur remplacée', persistent: true,
    action: { label: 'Réglages › Données', run: () => { window.__actionRan = (window.__actionRan || 0) + 1; } } }));
  await page.waitForTimeout(250);
  let keys = await visibleToasts();
  check('même clé : remplacé et redescendu en bas, sans doublon',
    JSON.stringify(keys) === JSON.stringify(['t-warn', 't-info', 't-err']), keys.join(','));
  await page.evaluate(() => {
    showToast({ key: 'e2', level: 'error', theme: 'services', text: 'Erreur 2' });
    showToast({ key: 'w2', level: 'warn', theme: 'export', text: 'Avertissement 2' });
  });
  await page.waitForTimeout(300);
  keys = await visibleToasts();
  check('plafond de 4 : les plus anciens non-erreur sortis, l\'erreur restée',
    JSON.stringify(keys) === JSON.stringify(['t-err', 'e2', 'w2']) || JSON.stringify(keys) === JSON.stringify(['t-info', 't-err', 'e2', 'w2']),
    keys.join(','));
  check('jamais plus de TOAST_MAX_VISIBLE toasts', keys.length <= 4, keys.length);
}

// ── 8. Action, croix ──────────────────────────────────────────────────────────
{
  await page.click('#toasts .toast[data-key="t-err"] .toast-body');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ ran: window.__actionRan || 0, has: !!document.querySelector('#toasts .toast[data-key="t-err"]') }));
  check('clic sur le corps : action exécutée une fois, toast fermé', r.ran === 1 && !r.has, JSON.stringify(r));
  await page.click('#toasts .toast[data-key="w2"] .toast-x');
  await page.waitForTimeout(300);
  const has = await page.evaluate(() => !!document.querySelector('#toasts .toast[data-key="w2"]'));
  check('croix : toast fermé', !has);
}

// ── 9. Minuteurs : info 5 s, pause au survol, P1 sans minuteur ───────────────
{
  await clearAll();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    showToast({ key: 'i-auto', level: 'info', theme: 'services', text: 'Disparaît seul' });
    showToast({ key: 'w-hover', level: 'warn', theme: 'export', text: 'Survolé' });
    showToast({ key: 'p1', level: 'error', theme: 'storage', text: 'Persistant', persistent: true });
  });
  const p1 = await page.evaluate(() => ({ remaining: _toastLive.get('p1').remaining, timer: _toastLive.get('p1').timer }));
  check('erreur P1 : aucun minuteur armé', p1.remaining === null && p1.timer === null, JSON.stringify(p1));
  await page.hover('#toasts .toast[data-key="w-hover"]');
  await page.waitForTimeout(5400);
  let keys = await visibleToasts();
  check('info fermé seul après 5 s', !keys.includes('i-auto'), keys.join(','));
  await page.waitForTimeout(3000);
  keys = await visibleToasts();
  check('avertissement survolé : toujours là après 8,4 s (minuteur en pause)', keys.includes('w-hover'), keys.join(','));
  // Survolé dès l'affichage, le minuteur n'a presque rien consommé : il lui
  // reste ~8 s à courir une fois le pointeur parti.
  await page.mouse.move(10, 10);
  await page.waitForTimeout(8600);
  keys = await visibleToasts();
  check('survol quitté : l\'avertissement finit par partir', !keys.includes('w-hover'), keys.join(','));
  check('P1 toujours là', keys.includes('p1'));
}

// ── 10. Kill-switch de mouvement : la sortie aboutit sans transitionend ──────
{
  await page.evaluate(() => { document.documentElement.setAttribute('data-motion', 'reduced'); dismissToast('p1'); });
  await page.waitForTimeout(TOAST_LEAVE_MS_JS());
  const r = await page.evaluate(() => ({ p1: !!document.querySelector('#toasts .toast[data-key="p1"]'),
    n: document.querySelectorAll('#toasts .toast').length, hidden: document.getElementById('toasts').hidden }));
  check('mouvement réduit : toast retiré du DOM', !r.p1, JSON.stringify(r));
  check('dernier toast parti : conteneur masqué', r.n === 0 && r.hidden, JSON.stringify(r));
  await page.evaluate(() => document.documentElement.removeAttribute('data-motion'));
}
function TOAST_LEAVE_MS_JS() { return 400; }

// ── 11. Chat « stockage plein » : géométrie des sourcils ─────────────────────
{
  await page.evaluate(() => setStorageFull(true, false));
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const logo = document.getElementById('brand-logo');
    const l = logo.querySelector('.brow-l').getBoundingClientRect();
    const rr = logo.querySelector('.brow-r').getBoundingClientRect();
    const scale = logo.getBoundingClientRect().width / 64;
    // La boîte englobante d'un trait tourné est celle de sa géométrie
    // d'origine, tournée : elle ne dit pas s'il est à plat. Les extrémités du
    // tracé, passées par la matrice écran (transform CSS comprise), le disent.
    const ends = (el) => {
      const m = el.getScreenCTM();
      const len = el.getTotalLength();
      return [el.getPointAtLength(0), el.getPointAtLength(len)].map(p => new DOMPoint(p.x, p.y).matrixTransform(m));
    };
    const le = ends(logo.querySelector('.brow-l')), re = ends(logo.querySelector('.brow-r'));
    return {
      lSlope: Math.abs(le[0].y - le[1].y) / scale, rSlope: Math.abs(re[0].y - re[1].y) / scale,
      cls: document.body.className,
      gap: (rr.left - l.right) / scale, lH: l.height / scale, rH: rr.height / scale,
      dy: Math.abs((l.top + l.bottom) / 2 - (rr.top + rr.bottom) / 2) / scale,
      lW: l.width / scale, rW: rr.width / scale,
      op: getComputedStyle(logo.querySelector('.brow-l')).opacity,
      mouthWorried: getComputedStyle(logo.querySelector('.mouth-worried')).opacity,
    };
  });
  check('stockage plein : body.miaou-storage, sans miaou-worried', /miaou-storage/.test(r.cls) && !/miaou-worried/.test(r.cls), r.cls);
  check('sourcils visibles, bouche du froncement', r.op === '1' && r.mouthWorried === '1');
  check('deux traits distincts : écart ≥ 2 unités (pas de monosourcil)', r.gap >= 2, r.gap.toFixed(2));
  check('à plat : extrémités à la même hauteur (±0,05 unité)', r.lSlope <= 0.05 && r.rSlope <= 0.05, `${r.lSlope.toFixed(3)} / ${r.rSlope.toFixed(3)}`);
  check('symétriques : même hauteur et même largeur (±0,1)', r.dy <= 0.1 && Math.abs(r.lW - r.rW) <= 0.1, `dy ${r.dy.toFixed(2)}, ${r.lW.toFixed(2)} / ${r.rW.toFixed(2)}`);
  check('allongés de 25 % (9,24 × 1,25 ≈ 11,55 ±0,3)', Math.abs(r.lW - 11.55) <= 0.3, r.lW.toFixed(2));
  await page.screenshot({ path: path.join(outDir, '05-chat-stockage.png'), clip: { x: 0, y: 0, width: 420, height: 80 } });
  await page.evaluate(() => setStorageFull(false, false));
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => document.body.className);
  check('levée : l\'expression disparaît', !/miaou-storage/.test(back), back);
}

// ── 12. Thème sombre : capture (le navigateur de test démarre en clair) ──────
{
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    showToast({ key: 'l-err', level: 'error', theme: 'storage', text: 'Stockage plein : les dernières modifications ne sont pas enregistrées.', persistent: true, action: { label: 'Réglages › Données', run: () => {} } });
    showToast({ key: 'l-warn', level: 'warn', theme: 'export', text: 'L\'export HTML de cette conversation a échoué.' });
    showToast({ key: 'l-info', level: 'info', theme: 'services', text: 'Serveur API « Stub » rétabli.' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '06-sombre.png') });
  await clearAll();
}

// ── 13. Branchements (AG-4) ───────────────────────────────────────────────────
// Quota simulé sur le VRAI chemin d'écriture : `put` avorte sa transaction en
// exposant un `tx.error` nommé QuotaExceededError — ce que fait un échec au
// commit. `tx.abort()` seul donnerait AbortError, qui ne pose rien.
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
const peer = await page.context().newPage();
peer.on('pageerror', (e) => consoleErrors.push('[B] ' + String(e)));
await peer.setViewportSize({ width: 1700, height: 900 });
await peer.goto('file://' + distPath);
await peer.waitForSelector('#composer-text', { timeout: 10000 });
await peer.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
const armQuota = (on) => page.evaluate((on) => {
  if (!window.__realPut) window.__realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = on ? function() {
    const tx = this.transaction;
    const req = window.__realPut.apply(this, arguments);
    Object.defineProperty(tx, 'error', { configurable: true, get: () => new DOMException('quota', 'QuotaExceededError') });
    tx.abort();
    return req;
  } : window.__realPut;
}, on);
const state = (p) => p.evaluate(() => ({
  full: isStorageFull(), cls: document.body.className,
  toast: !!document.querySelector('#toasts .toast[data-key="storage-quota"]:not(.toast-leaving)'),
  role: (document.querySelector('#toasts .toast[data-key="storage-quota"]') || {}).getAttribute
    ? document.querySelector('#toasts .toast[data-key="storage-quota"]').getAttribute('role') : null,
}));
{
  await armQuota(true);
  await page.evaluate(() => putResource({ id: 'res_ag_quota', conversationId: 'c-ag', name: 'x.bin', data: new ArrayBuffer(8) })
    .catch(() => {}));
  await page.waitForTimeout(600);
  const a = await state(page), b = await state(peer);
  check('quota sur putResource (échec au commit) : état posé', a.full, JSON.stringify(a));
  check('quota : sourcils horizontaux dans l\'onglet qui écrit', /miaou-storage/.test(a.cls));
  check('quota : toast d\'erreur (role alert) dans l\'onglet qui écrit', a.toast && a.role === 'alert');
  check('quota diffusé : état, sourcils ET toast dans l\'autre onglet (S3)', b.full && /miaou-storage/.test(b.cls) && b.toast, JSON.stringify(b));
  // Front seulement : l'onglet déjà plein ne réaffiche pas un toast fermé.
  await page.click('#toasts .toast[data-key="storage-quota"] .toast-x');
  await page.waitForTimeout(300);
  await page.evaluate(() => { persistConversation({ id: 'c-ag-2', title: 'x', messages: [], spaceId: 'default' }); });
  await page.waitForTimeout(500);
  const again = await state(page);
  check('second échec, déjà plein : pas de nouveau toast (front seul)', again.full && !again.toast, JSON.stringify(again));
  await armQuota(false);
  await page.evaluate(() => removeConversationRecord('c-ag-inexistante', 'default'));
  await page.waitForTimeout(600);
  const la = await state(page), lb = await state(peer);
  check('suppression commitée : état levé, sourcils partis', !la.full && !/miaou-storage/.test(la.cls), JSON.stringify(la));
  check('levée diffusée : l\'autre onglet aussi, toast retiré', !lb.full && !/miaou-storage/.test(lb.cls) && !lb.toast, JSON.stringify(lb));
  await peer.screenshot({ path: path.join(outDir, '07-pair-avant-levee.png') }).catch(() => {});
}
// Clic → Réglages › Données, catégorie dépliée.
{
  await armQuota(true);
  await page.evaluate(() => putResource({ id: 'res_ag_quota2', conversationId: 'c-ag', name: 'y.bin', data: new ArrayBuffer(8) }).catch(() => {}));
  await page.waitForTimeout(500);
  await armQuota(false);
  await page.screenshot({ path: path.join(outDir, '08-quota.png') });
  await page.click('#toasts .toast[data-key="storage-quota"] .toast-body');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const head = document.querySelector('#drawer .set-cat-head[data-cat="donnees"]');
    const hr = head.getBoundingClientRect();
    return { drawer: document.getElementById('drawer').classList.contains('show'), open: head.classList.contains('open'),
      inView: hr.top >= 0 && hr.bottom <= innerHeight };
  });
  check('clic du toast de quota : réglages ouverts sur « Données » dépliée et visible', r.drawer && r.open && r.inView, JSON.stringify(r));
  await page.screenshot({ path: path.join(outDir, '09-reglages-donnees.png') });
  await page.evaluate(() => { closeSettings(); setStorageFull(false, false); });
  await page.waitForTimeout(400);
}
// Backend : panne, croix, retour → « rétabli » quand même (D5).
{
  await page.evaluate(() => noteBackendProbe(false));
  await page.waitForTimeout(300);
  let r = await page.evaluate(() => {
    const t = document.querySelector('#toasts .toast[data-key^="backend:"]');
    return { key: t && t.dataset.key, level: t && t.dataset.level, text: t && t.querySelector('.toast-text').textContent,
      worried: document.body.classList.contains('miaou-worried') };
  });
  check('backend ok → down : toast d\'erreur, chat soucieux', r.level === 'error' && r.worried, JSON.stringify(r));
  check('texte : guillemets à espaces insécables', /« Stub »/.test(r.text || ''), r.text);
  await page.click('#toasts .toast[data-key^="backend:"] .toast-x');
  await page.waitForTimeout(300);
  await page.evaluate(() => noteBackendProbe(true));
  await page.waitForTimeout(300);
  r = await page.evaluate(() => {
    const t = document.querySelector('#toasts .toast[data-key^="backend:"]');
    return { level: t && t.dataset.level, text: t && t.querySelector('.toast-text').textContent };
  });
  check('down → ok, erreur déjà fermée : « rétabli » affiché quand même', r.level === 'info' && /rétabli/.test(r.text || ''), JSON.stringify(r));
  await page.evaluate(() => noteBackendProbe(true));
  await page.waitForTimeout(200);
  const n = await page.evaluate(() => document.querySelectorAll('#toasts .toast[data-key^="backend:"]').length);
  check('état inchangé : pas de second toast', n === 1, n);
  await clearAll();
}
// MCP : erreur, rétabli, retrait.
{
  await page.evaluate(() => { mcpStatusSnapshot()['fx'] = { state: 'error', count: 0 }; syncAuthorizationPending(); });
  await page.waitForTimeout(300);
  let lvl = await page.evaluate(() => (document.querySelector('#toasts .toast[data-key="mcp:fx"]') || {}).dataset?.level);
  check('MCP → error : toast d\'erreur', lvl === 'error', lvl);
  await page.evaluate(() => { mcpStatusSnapshot()['fx'] = { state: 'ok', count: 1 }; syncAuthorizationPending(); });
  await page.waitForTimeout(300);
  lvl = await page.evaluate(() => (document.querySelector('#toasts .toast[data-key="mcp:fx"]:not(.toast-leaving)') || {}).dataset?.level);
  check('MCP error → ok : « rétabli »', lvl === 'info', lvl);
  await page.evaluate(() => { mcpStatusSnapshot()['fx'] = { state: 'error', count: 0 }; syncAuthorizationPending();
    delete mcpStatusSnapshot()['fx']; syncAuthorizationPending(); });
  await page.waitForTimeout(400);
  const left = await page.evaluate(() => !!document.querySelector('#toasts .toast[data-key="mcp:fx"]:not(.toast-leaving)'));
  check('MCP en erreur puis retiré : toast retiré, sans rétabli', !left);
  await clearAll();
}
// localStorage plein (S2) : le handler va au bout, toast sans état.
{
  const r = await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function() { throw new DOMException('plein', 'QuotaExceededError'); };
    let threw = false;
    try { saveSettings({ agQuotaProbe: 1 }); } catch (e) { threw = true; }
    Storage.prototype.setItem = real;
    return { threw, full: isStorageFull(), toast: !!document.querySelector('#toasts .toast[data-key="local-quota"]') };
  });
  check('quota localStorage : le handler ne lève plus', !r.threw);
  check('quota localStorage : toast local-quota, sans l\'état « stockage plein »', r.toast && !r.full, JSON.stringify(r));
  await clearAll();
}
// Export HTML raté : le clic ne reste plus muet.
{
  const r = await page.evaluate(async () => {
    const realRender = renderExportBody;
    currentThread = [{ role: 'user', content: 'x' }];
    renderExportBody = () => { throw new Error('rendu cassé'); };
    try { await exportConvHtml(); } finally { renderExportBody = realRender; currentThread = []; }
    return !!document.querySelector('#toasts .toast[data-key^="export:"]');
  });
  check('export HTML raté : toast d\'avertissement', r);
  await clearAll();
}
// Émetteurs sans chemin simple à provoquer ici : rendu et clé.
{
  const r = await page.evaluate(() => {
    toastTruncateRefused('c-inconnue');
    const t = document.querySelector('#toasts .toast[data-key="truncate:c-inconnue"]');
    return { level: t.dataset.level, hasAction: t.classList.contains('has-action'), persistent: _toastLive.get('truncate:c-inconnue').remaining };
  });
  check('troncature refusée : erreur P1, sans clic, sans minuteur', r.level === 'error' && !r.hasAction && r.persistent === null, JSON.stringify(r));
  await clearAll();
}
await peer.close();

// Les échecs que ce script PROVOQUE tracent en console, c'est leur contrat :
// exclus nommément, jamais par un filtre large qui masquerait un vrai défaut.
const EXPECTED_ERRORS = /^\[miaou\] (échec d'écriture (ressource res_ag_|conversation c-ag-|localStorage miaou-settings)|export HTML échoué)/;
const unexpected = consoleErrors.filter((e) => !EXPECTED_ERRORS.test(e));
check('aucune erreur console inattendue', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));

await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nOK — tout passe');
process.exit(failures.length ? 1 : 0);
