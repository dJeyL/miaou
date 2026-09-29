#!/usr/bin/env node
// Catalogue de modèles : tableau de la fiche serveur, panneau de ligne, menu du
// composer et palette. Les purs (visibilité, ordres, filtre, gestes, choix du
// menu) sont couverts par tests/test-storage.js ; ce script vérifie ce que
// QuickJS ne voit pas : le câblage, l'écriture de chaque geste dans le store,
// l'état de vue qui survit aux re-rendus (dont celui d'un AUTRE onglet), et le
// menu du composer au clavier.
//
// Trois serveurs sur stub.local : A « Mac mini » (actif, reconnu comme Ollama,
// un masqué, un ajouté à la main, un « Sans vision » manuel, une fenêtre
// saisie), B « Agrégateur » (12 modèles, mode « tout masquer », une exception),
// C « Bureau » (mis de côté, défaut absent de sa liste).
//
// Checklist :
//   1. tous les tableaux repliés à l'ouverture, aucune liste chargée pour eux
//   2. A déplié : ordre défaut / affichés / masqués, marques, fenêtres
//      (saisie et déclarée ; « ? » pour une inconnue, jamais le défaut de build)
//   3. titres : compte et « au menu » ; C sans compte (liste non chargée)
//   4. B : filtre au-delà de dix lignes ; filtre, focus et curseur survivent à un
//      re-rendu complet
//   5. case « Menu », défaut sur un masqué (les lignes déplacées glissent), ajout (doublon refusé en le nommant),
//      « Tout masquer » armé (le premier clic n'écrit rien, l'armement survit au
//      re-rendu), retrait (refusé sur le défaut, puis armé)
//   6. panneau : vision (choix sur un modèle non déclaré, retrait du flag), fenêtre
//      appliquée à Entrée
//   7. « Lire les propriétés » : un /api/show pour CE modèle, persisté, relu à
//      chaque clic ; absent sur un serveur qui n'est pas un Ollama
//   8. C : déplier charge sa liste ; défaut « absent de la liste » en tête
//   9. second onglet : une écriture y re-rend la liste ici, et un brouillon de
//      fenêtre focalisé ici n'est PAS écrit (ni au blur, ni au re-rendu)
//  10. formulaire enregistré après un ajout écrit pendant qu'il était ouvert :
//      l'ajout survit (le formulaire reprend l'enregistrement frais)
//  11. composer : focus sur le filtre, défaut en tête marqué, modèle masqué de la
//      conversation montré et marqué, « à la main », mode « tout masquer »,
//      serveur de côté absent
//  12. composer : filtre modèle+serveur, re-rendu asynchrone sans toucher au
//      champ, Échap vide puis ferme, ↓ Entrée choisit
//  13. palette : masqués exclus, même filtre ; sélecteur visible sur un serveur
//      en erreur grâce à ses modèles ajoutés à la main
//  14. aucune erreur console
//
// VERIFY_DIST=<chemin> rejoue sur un autre build : sur celui d'avant le
// catalogue, tout ce qui touche au tableau et au menu tombe au rouge.
//
// Usage : node verify-model-catalogue.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = process.env.VERIFY_DIST || path.join(path.resolve(__dirname, '../../..'), 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  if (!cond) failures.push(label);
};

const initScript = () => {
  if (localStorage.getItem('__cat_seeded') === null) {
    localStorage.setItem('__cat_seeded', '1');
    localStorage.setItem('miaou-api-servers', JSON.stringify([
      { id: 'srv-a', name: 'Mac mini', url: 'http://stub.local/a/v1', key: 'k', model: 'm-def',
        modelVisibility: { newHidden: false, except: ['m-hid'] }, handcraftedModels: ['hand-1'],
        vision: { 'm-3': false }, contextWindows: { 'm-2': 65536 } },
      { id: 'srv-b', name: 'Agrégateur', url: 'http://stub.local/b/v1', key: 'k', model: 'b-00',
        modelVisibility: { newHidden: true, except: ['b-03'] } },
      { id: 'srv-c', name: 'Bureau', url: 'http://stub.local/c/v1', key: 'k', model: 'absent-def', disabled: true },
    ]));
    localStorage.setItem('miaou-active-api-server', 'srv-a');
    localStorage.setItem('miaou-settings', JSON.stringify({ summaryInjectionMode: 'never', didYouKnow: false, showModelSelector: true }));
  }
  window.__listCalls = {};
  window.__shows = [];
  const LISTS = {
    a: [{ id: 'm-def', capabilities: { vision: true, function_calling: true, reasoning: false }, max_context_length: 32768 },
      { id: 'm-2' }, { id: 'm-3' }, { id: 'm-hid' }, { id: 'hf.co/unsloth/Qwen3-30B-A3B-GGUF:Q4_K_M' }],
    b: Array.from({ length: 12 }, (_, i) => ({ id: 'b-' + String(i).padStart(2, '0') })),
    c: [{ id: 'c-1' }, { id: 'c-2' }],
  };
  const json = (b, status) => new Response(JSON.stringify(b), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  const real = window.fetch.bind(window);
  window.fetch = async (input, opts) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const m = /^http:\/\/stub\.local\/([abc])\/v1\/models$/.exec(url);
    if (m) {
      window.__listCalls[m[1]] = (window.__listCalls[m[1]] || 0) + 1;
      if (m[1] === 'c') await new Promise(r => setTimeout(r, 300));
      return json({ object: 'list', data: LISTS[m[1]] });
    }
    // Chemin natif : A répond comme un Ollama, B et C non.
    const n = /^http:\/\/stub\.local\/([abc])\/api\/(tags|ps|show)$/.exec(url);
    if (n) {
      if (n[1] !== 'a') return json({ error: 'not found' }, 404);
      if (n[2] === 'tags') return json({ models: LISTS.a.map(x => ({ name: x.id })) });
      if (n[2] === 'ps') return json({ models: [] });
      const body = JSON.parse((opts && opts.body) || '{}');
      window.__shows.push(body.model);
      if (body.model === 'm-2') {
        return json({ capabilities: ['completion', 'tools', 'thinking'],
          model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 } });
      }
      return json({});
    }
    if (/^http:\/\/stub\.local\/.*chat\/completions$/.test(url)) {
      return json({ choices: [{ message: { role: 'assistant', content: 'Titre' }, finish_reason: 'stop' }] });
    }
    return real(input, opts);
  };
};

const browser = await launchIsolated({ headless: !headed }, { serve: false, native: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await context.addInitScript(initScript);
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text');
await page.waitForFunction(() => document.querySelector('.boot-done') !== null);

const card = (sid) => `#api-list .api-card[data-server-id="${sid}"]`;
const rowsOf = (pg, sid) => pg.evaluate((sel) => {
  const c = document.querySelector(sel);
  return c ? [...c.querySelectorAll('.api-model-row')].map(r => ({
    id: r.dataset.model,
    def: r.querySelector('.api-model-default').classList.contains('on'),
    menu: r.querySelector('.api-model-shown').checked,
    tag: (r.querySelector('.api-model-tag') || {}).textContent || '',
    ctx: r.querySelector('td.ctx').textContent,
    cap0: r.querySelector('.api-model-cap').className,
  })) : [];
}, card(sid));
const server = (pg, sid) => pg.evaluate((id) => getApiServer(id), sid);

// ── 1-3. ouverture, dépli, contenu ──────────────────────────────────────────
await page.evaluate(() => openApiServers());
await page.waitForFunction(() => document.querySelectorAll('#api-list .api-card').length === 3);
const folded = await page.evaluate(() => ({
  open: document.querySelectorAll('.api-catalogue.open').length, b: window.__listCalls.b || 0, c: window.__listCalls.c || 0,
  cards: document.querySelectorAll('.api-catalogue').length,
}));
check('1. trois tableaux, tous repliés, ni B ni C interrogés', folded.cards === 3 && folded.open === 0 && !folded.b && !folded.c, folded);
await page.click(card('srv-a') + ' .api-catalogue-toggle');
await page.click(card('srv-b') + ' .api-catalogue-toggle');
await page.waitForSelector(card('srv-b') + ' .api-model-row');
let a = await rowsOf(page, 'srv-a');
check('2. A : défaut, affichés (ordre du serveur), à la main, puis masqués',
  a.map(r => r.id).join() === 'm-def,hf.co/unsloth/Qwen3-30B-A3B-GGUF:Q4_K_M,m-2,m-3,hand-1,m-hid', a.map(r => r.id));
check('2. A : marques, case Menu du masqué décochée, appareil barré du « Sans vision »',
  a.find(r => r.id === 'hand-1').tag === 'ajouté à la main' && a.find(r => r.id === 'm-hid').menu === false
    && /manual-off/.test(a.find(r => r.id === 'm-3').cap0), a);
check('2. A : fenêtres saisie, déclarée, et « ? » (jamais le défaut de build)',
  a.find(r => r.id === 'm-2').ctx === '64 k' && a[0].ctx === '32 k' && a.find(r => r.id === 'm-3').ctx === '?', a.map(r => r.ctx));
const titles = await page.evaluate(() => [...document.querySelectorAll('.api-catalogue-toggle')].map(t => t.textContent));
check('3. titres : « Modèles (6) · 5 au menu », « (12) · 2 au menu », C sans compte',
  titles[0] === 'Modèles (6) · 5 au menu' && titles[1] === 'Modèles (12) · 2 au menu' && titles[2] === 'Modèles', titles);

// ── 4. filtre de B ───────────────────────────────────────────────────────────
check('4. B : champ de filtre présent', await page.locator(card('srv-b') + ' .api-catalogue-filter').count() === 1);
await page.focus(card('srv-b') + ' .api-catalogue-filter');
await page.keyboard.type('b-0', { delay: 20 });
await page.evaluate(() => renderApiServers());
await page.keyboard.type('1', { delay: 20 });
const f4 = await page.evaluate((sel) => ({ v: document.activeElement.value, key: document.activeElement.dataset.catFocus,
  rows: document.querySelectorAll(sel + ' .api-model-row').length }), card('srv-b'));
check('4. filtre, focus et curseur survivent au re-rendu complet', f4.v === 'b-01' && f4.key === 'filter' && f4.rows === 1, f4);

// ── 5. gestes du tableau ─────────────────────────────────────────────────────
await page.click(card('srv-a') + ' tr[data-model="m-3"] .api-model-shown');
let sa = await server(page, 'srv-a');
check('5. case Menu : m-3 rejoint les masqués', JSON.stringify(sa.modelVisibility) === '{"newHidden":false,"except":["m-hid","m-3"]}', sa.modelVisibility);
await page.click(card('srv-a') + ' tr[data-model="m-hid"] .api-model-default');
const slides = await page.evaluate((sel) => document.querySelector(sel).getAnimations({ subtree: true })
  .filter(an => an.effect && an.effect.target && an.effect.target.matches('tr.api-model-row')).map(an => an.effect.target.dataset.model), card('srv-a'));
a = await rowsOf(page, 'srv-a');
sa = await server(page, 'srv-a');
check('5. défaut sur un masqué : écrit, en tête, coché au menu', sa.model === 'm-hid' && a[0].id === 'm-hid' && a[0].def && a[0].menu, a[0]);
check('5. les lignes déplacées glissent (dont m-hid, remontée en tête)', slides.includes('m-hid'), slides);
await page.click(card('srv-a') + ' tr[data-model="m-def"] .api-model-default');
const addInput = card('srv-a') + ' .api-catalogue-add input';
await page.fill(addInput, 'm-2');
await page.press(addInput, 'Enter');
const err5 = await page.evaluate((sel) => (document.querySelector(sel + ' .api-catalogue-note.err') || {}).textContent, card('srv-a'));
check('5. doublon refusé en le nommant, rien d\'écrit', /« m-2 »/.test(err5 || '') && (await server(page, 'srv-a')).handcraftedModels.join() === 'hand-1', err5);
await page.fill(addInput, 'hand-2');
await page.press(addInput, 'Enter');
check('5. ajout à la main persisté, champ vidé et toujours focalisé',
  (await server(page, 'srv-a')).handcraftedModels.join() === 'hand-1,hand-2'
    && await page.evaluate((sel) => document.activeElement === document.querySelector(sel) && document.activeElement.value === '', addInput));
await page.locator(card('srv-a') + ' .api-catalogue-bar .drawer-btn', { hasText: 'Tout masquer' }).click();
const unarmed = (await server(page, 'srv-a')).modelVisibility.newHidden;
await page.evaluate(() => renderApiServers());
await page.locator(card('srv-a') + ' .api-catalogue-bar .drawer-btn.armed').click();
sa = await server(page, 'srv-a');
check('5. « Tout masquer » : premier clic sans écriture, armement qui survit au re-rendu, second clic qui vide les exceptions',
  unarmed === false && sa.modelVisibility.newHidden === true && sa.modelVisibility.except.join() === '', sa.modelVisibility);
await page.locator(card('srv-a') + ' .api-catalogue-bar .drawer-btn', { hasText: 'Tout afficher' }).click();
await page.locator(card('srv-a') + ' .api-catalogue-bar .drawer-btn.armed').click();
await page.click(card('srv-a') + ' tr[data-model="hand-2"] .api-model-default');
await page.click(card('srv-a') + ' tr.api-model-row[data-model="hand-2"] .api-model-expand');
await page.click(card('srv-a') + ' .api-model-remove');
const ref5 = await page.evaluate((sel) => (document.querySelector(sel + ' .api-model-refusal') || {}).textContent, card('srv-a'));
check('5. retrait du défaut refusé en disant quoi faire, sans armer',
  /autre modèle/.test(ref5 || '') && await page.locator(card('srv-a') + ' .api-model-remove.armed').count() === 0, ref5);
await page.click(card('srv-a') + ' tr[data-model="m-def"] .api-model-default');
await page.click(card('srv-a') + ' .api-model-remove');
check('5. premier clic de retrait : armé, rien d\'écrit', (await server(page, 'srv-a')).handcraftedModels.join() === 'hand-1,hand-2');
await page.click(card('srv-a') + ' .api-model-remove.armed');
check('5. second clic : retiré', (await server(page, 'srv-a')).handcraftedModels.join() === 'hand-1');

// ── 6. panneau : vision et fenêtre ───────────────────────────────────────────
const panel = (m) => card('srv-a') + ` tr.api-model-detail[data-model="${m}"]`;
await page.click(card('srv-a') + ' tr.api-model-row[data-model="m-3"] .api-model-expand');
await page.click(card('srv-a') + ' tr.api-model-row[data-model="m-def"] .api-model-expand');
const p6 = await page.evaluate(({ p3, pd }) => ({
  active3: (document.querySelector(p3 + ' .api-model-vision .seg.active') || {}).textContent,
  fixedDef: (document.querySelector(pd + ' .api-model-fixed') || {}).textContent,
  segsDef: !!document.querySelector(pd + ' .api-model-vision'),
}), { p3: panel('m-3'), pd: panel('m-def') });
check('6. vision : choix sur « Sans vision » pour m-3, libellé figé pour m-def (déclaré)',
  p6.active3 === 'Sans vision' && p6.fixedDef === 'Lit les images' && !p6.segsDef, p6);
await page.locator(panel('m-3') + ' .api-model-vision .seg', { hasText: 'Activée' }).click();
check('6. « Activée » retire le flag de m-3', JSON.stringify((await server(page, 'srv-a')).vision) === '{}');
await page.fill(panel('m-3') + ' .api-model-ctx-input', '12000');
await page.press(panel('m-3') + ' .api-model-ctx-input', 'Enter');
check('6. fenêtre appliquée à Entrée', (await server(page, 'srv-a')).contextWindows['m-3'] === 12000);

// ── 7. /api/show à la demande ────────────────────────────────────────────────
await page.click(card('srv-a') + ' tr.api-model-row[data-model="m-2"] .api-model-expand');
const showsBefore = await page.evaluate(() => window.__shows.slice());
await page.click(panel('m-2') + ' .api-model-read');
await page.waitForFunction((sel) => {
  const b = document.querySelector(sel + ' .api-model-read');
  return b && !b.disabled;
}, panel('m-2'));
const r7 = await page.evaluate(() => ({ shows: window.__shows.slice(), props: modelPropsFor(getApiServer('srv-a'), 'm-2') }));
a = await rowsOf(page, 'srv-a');
check('7. un /api/show pour m-2, capacités et fenêtre persistées (saisie gardée devant)',
  r7.shows.length === showsBefore.length + 1 && r7.shows[r7.shows.length - 1] === 'm-2'
    && r7.props.caps.tools === true && r7.props.caps.thinking === true && r7.props.contextMax === 40960
    && a.find(r => r.id === 'm-2').ctx === '64 k', { shows: r7.shows, caps: r7.props.caps, max: r7.props.contextMax });
await page.click(panel('m-2') + ' .api-model-read');
await page.waitForFunction((n) => window.__shows.length === n, r7.shows.length + 1, { timeout: 5000 }).catch(() => {});
check('7. second clic : relu (pas de mémo)', await page.evaluate(() => window.__shows.length) === r7.shows.length + 1);
await page.click(card('srv-b') + ' tr.api-model-row .api-model-expand');
check('7. B (pas un Ollama) : pas de « Lire les propriétés »',
  await page.locator(card('srv-b') + ' .api-model-read').count() === 0
    && await page.locator(card('srv-b') + ' .api-model-ctx-input').count() === 1);

// ── 8. serveur mis de côté ───────────────────────────────────────────────────
await page.click(card('srv-c') + ' .api-catalogue-toggle');
await page.waitForSelector(card('srv-c') + ' .api-model-row');
const c8 = await rowsOf(page, 'srv-c');
check('8. C : le dépli charge la liste, défaut « absent de la liste » en tête, case grisée',
  (await page.evaluate(() => window.__listCalls.c)) === 1 && c8[0].id === 'absent-def' && c8[0].tag === 'absent de la liste'
    && await page.evaluate((sel) => document.querySelector(sel + ' tr[data-model="absent-def"] .api-model-shown').disabled, card('srv-c')),
  c8.map(r => r.id + ':' + r.tag));

// ── 9-10. second onglet ──────────────────────────────────────────────────────
const page2 = await context.newPage();
page2.on('pageerror', e => errors.push('p2 ' + String(e)));
await page2.goto('file://' + distPath);
await page2.waitForSelector('#composer-text');
await page2.waitForFunction(() => document.querySelector('.boot-done') !== null);
await page.fill(panel('m-2') + ' .api-model-ctx-input', '99999');
await page.evaluate(() => { window.__renders = 0; const f = renderApiServers; renderApiServers = function () { window.__renders++; return f.apply(this, arguments); }; });
await page2.evaluate(() => onApiModelToggleShown('srv-a', 'hf.co/unsloth/Qwen3-30B-A3B-GGUF:Q4_K_M'));
await page.waitForFunction(() => window.__renders > 0, null, { timeout: 5000 }).catch(() => {});
const r9 = await page.evaluate((sel) => ({
  renders: window.__renders, saved: getApiServer('srv-a').contextWindows['m-2'],
  focus: document.activeElement === document.querySelector(sel), value: (document.querySelector(sel) || {}).value,
}), panel('m-2') + ' .api-model-ctx-input');
check('9. écriture de l\'autre onglet : re-rendu ici, brouillon focalisé gardé et NON écrit',
  r9.renders > 0 && r9.saved === 65536 && r9.focus && r9.value === '99999', r9);
await page.evaluate(() => document.activeElement.blur());
check('9. blur du brouillon : toujours rien d\'écrit', (await server(page, 'srv-a')).contextWindows['m-2'] === 65536);
// 10 : l'ajout est écrit dans le store SANS re-rendu, le formulaire ouvert ici
// restant celui d'avant. Par l'autre onglet, ce cas ne se monte pas : l'écriture
// d'un pair re-rend toute la liste et referme le formulaire (comportement
// antérieur au catalogue, noté comme point ouvert) ; c'est donc la reprise de
// l'enregistrement FRAIS par `onSaveApiCard` qui est vérifiée ici.
await page.click(card('srv-a') + ' .cfg-view button:has-text("Modifier")');
await page.evaluate(() => {
  const s = getApiServer('srv-a');
  saveApiServersRaw(loadApiServers().map(x => x.id === 'srv-a'
    ? Object.assign({}, s, { handcraftedModels: s.handcraftedModels.concat(['from-tab-2']) }) : x));
});
await page.click(card('srv-a') + ' .api-save');
const s10 = await server(page, 'srv-a');
check('10. formulaire enregistré après un ajout écrit pendant son ouverture : l\'ajout survit, défaut intact',
  s10.handcraftedModels.join() === 'hand-1,from-tab-2' && s10.model === 'm-def', { hand: s10.handcraftedModels, model: s10.model });
await page2.close();
await page.evaluate(() => closeApiServers());

// ── 11-12. composer ──────────────────────────────────────────────────────────
await page.evaluate(() => {
  // Retour à l'état de départ de A pour le menu : m-hid masqué, rien d'autre.
  const s = getApiServer('srv-a');
  upsertApiServer(Object.assign({}, s, { modelVisibility: { newHidden: false, except: ['m-hid'] } }));
  setConvModel('m-hid');   // conversation sur un modèle masqué
});
await page.waitForFunction(() => !$('composer-model').hidden);
await page.click('#composer-model-btn');
await page.waitForFunction(() => document.querySelectorAll('#composer-model-menu .model-group').length === 2
  && [...document.querySelectorAll('#composer-model-menu .model-opt-name')].some(n => n.textContent === 'b-03'));
const menu = () => page.evaluate(() => {
  const out = [];
  let g = '';
  for (const el of document.querySelectorAll('#composer-model-menu .composer-model-list > *')) {
    if (el.classList.contains('model-group')) g = el.textContent;
    else if (el.classList.contains('model-opt')) out.push(g + '|' + el.querySelector('.model-opt-name').textContent
      + '|' + ((el.querySelector('.model-opt-tag') || {}).textContent || '') + (el.classList.contains('selected') ? '|sel' : ''));
    else out.push(g + '|note:' + el.textContent);
  }
  return out;
});
let m = await menu();
check('11. focus sur le filtre à l\'ouverture',
  await page.evaluate(() => document.activeElement === document.querySelector('#composer-model-menu .composer-model-filter input')));
check('11. A : défaut en tête « défaut », masqué de la conversation « masqué » et coché, « à la main »',
  m[0] === 'Mac mini|m-def|défaut' && m.includes('Mac mini|m-hid|masqué|sel') && m.includes('Mac mini|hand-1|à la main')
    && m.includes('Mac mini|from-tab-2|à la main'), m);
check('11. B en mode « tout masquer » : défaut et exception seuls ; C absent',
  m.filter(x => x.startsWith('Agrégateur')).join() === 'Agrégateur|b-00|défaut,Agrégateur|b-03|' && !m.some(x => x.startsWith('Bureau')), m);
await page.keyboard.type('agr 03', { delay: 20 });
await page.evaluate(() => renderComposerModelOptions());   // arrivée asynchrone d'une liste
m = await menu();
const f12 = await page.evaluate(() => ({ v: document.activeElement.value, inFilter: !!document.activeElement.closest('.composer-model-filter') }));
check('12. filtre modèle+serveur ; re-rendu sans toucher au champ ni au focus',
  m.length === 1 && m[0].startsWith('Agrégateur|b-03') && f12.v === 'agr 03' && f12.inFilter, { m, f12 });
await page.keyboard.press('Escape');
check('12. Échap : vide le filtre, menu toujours ouvert',
  await page.evaluate(() => $('composer-model-menu').classList.contains('show') && document.querySelector('#composer-model-menu input').value === ''));
await page.keyboard.press('Escape');
check('12. Échap sur filtre vide : ferme le menu, focus rendu au bouton',
  await page.evaluate(() => !$('composer-model-menu').classList.contains('show') && document.activeElement === $('composer-model-btn')));
await page.click('#composer-model-btn');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
const picked = await page.evaluate(() => ({ model: activeModel(), open: $('composer-model-menu').classList.contains('show') }));
check('12. ↓ depuis la ligne en usage puis Entrée choisit la suivante', picked.model === 'hand-1' && !picked.open, picked);

// ── 13. palette et visibilité du sélecteur ───────────────────────────────────
const pal = await page.evaluate(() => ({ all: cmdkModelItems('').map(i => i.label), q: cmdkModelItems('mac def').map(i => i.label) }));
check('13. palette : masqué exclu (plus le modèle de la conversation), même filtre',
  !pal.all.includes('m-hid') && pal.all.includes('hand-1') && pal.all.includes('b-03') && !pal.all.includes('b-01') && pal.q.join() === 'm-def', pal);
const vis13 = await page.evaluate(() => {
  for (const x of loadApiServers()) if (x.id !== 'srv-a') upsertApiServer(Object.assign({}, x, { disabled: true }));
  _modelsById['srv-a'].models = null; _modelsById['srv-a'].error = 'boom';
  syncModelUI();
  const shown = !$('composer-model').hidden;
  upsertApiServer(Object.assign({}, getApiServer('srv-a'), { handcraftedModels: [], model: '' }));
  syncModelUI();
  return { withHand: shown, without: !$('composer-model').hidden };
});
check('13. seul serveur, liste en erreur : sélecteur visible grâce aux modèles à la main, masqué sans eux',
  vis13.withHand === true && vis13.without === false, vis13);

check('14. aucune erreur console', errors.length === 0, errors);
await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est vert.');
process.exit(failures.length ? 1 : 0);
