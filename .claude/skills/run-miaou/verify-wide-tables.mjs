#!/usr/bin/env node
// Vérification du débordement des grands tableaux (« planche ») : son réglage
// « Élargir les grands tableaux » (Apparence) et sa borne inconditionnelle dans
// les bulles utilisateur.
//
// Ce que le script mesure, et pourquoi c'est une mesure et pas une lecture de
// classe : le gate est CSS de bout en bout (aucun re-rendu, aucune classe posée
// par du JS), donc le seul témoin honnête est la largeur PEINTE du tableau
// comparée à celle de la colonne de lecture. Une assertion sur
// `documentElement.dataset.wideTables` ne prouverait que l'exécution du
// handler, jamais que la cascade a suivi.
//
// Quatre volets :
//   1. Réglage activé (défaut) : un grand tableau de message assistant sort de
//      la colonne, des deux côtés et symétriquement.
//   2. Réglage décoché : le même tableau rentre dans la colonne, et sa largeur
//      peinte n'excède plus celle du porteur (il défile en interne).
//   3. Bulle utilisateur : un tableau n'en sort JAMAIS, dans les deux états du
//      réglage — c'est une boîte dessinée (fond + bordure), pas la colonne.
//   4. Export HTML : le réglage est figé dans le fichier produit (attribut sur
//      <body>), et la bulle utilisateur y garde sa borne.
//
// Usage : node verify-wide-tables.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '   [' + detail + ']' : ''));
  if (!cond) failures.push(label);
};

// Tableau assez large pour dépasser toute colonne de lecture : huit colonnes de
// texte, aucune ne pouvant se comprimer sans devenir illisible. C'est ce que le
// débordement existe pour servir.
// Onze colonnes, et non huit : la colonne de l'export (.export-body, 860px de
// contenu) est plus large que celle de l'écran au cran par défaut. Un tableau
// calibré sur l'écran seul rentre sans déborder dans l'export, et les volets
// « déborde » y passent au vert sans rien prouver — mesuré à +0.0px en écrivant
// ce script. Le tableau doit dépasser LA PLUS LARGE des deux colonnes.
const WIDE_TABLE_MD = [
  '| Région | Population | Densité | Superficie | Préfecture | Départements | PIB régional | Croissance | Chef-lieu | Code INSEE | Communes |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  '| Île-de-France | 12 317 279 | 1 022 hab/km² | 12 011 km² | Paris | 8 | 765 Md€ | +1,8 % | Paris | 11 | 1 268 |',
  '| Auvergne-Rhône-Alpes | 8 092 598 | 116 hab/km² | 69 711 km² | Lyon | 12 | 279 Md€ | +2,1 % | Lyon | 84 | 4 032 |',
  '| Nouvelle-Aquitaine | 6 033 952 | 72 hab/km² | 84 036 km² | Bordeaux | 12 | 179 Md€ | +1,4 % | Bordeaux | 75 | 4 288 |',
].join('\n');

// Viewport large : le débordement n'existe QUE s'il reste de la place entre la
// colonne de lecture et les bords du fil. Sur écran étroit `max(0px, …)` le
// ramène à zéro et les quatre volets deviendraient vacuously verts.
const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 10000 });

// Un message assistant (dans la colonne de lecture, sans boîte) et un message
// utilisateur (dans une bulle) portant LE MÊME tableau : c'est la comparaison
// entre les deux qui fait la démonstration du volet 3.
await page.evaluate((md) => {
  appendUserMessage(md, Date.now());
  // finalizeAssistant, pas streamInto : ce dernier passe par un throttle de
  // 90ms, et c'est l'état FINALISÉ qu'on mesure de toute façon.
  const wrap = startAssistantMessage('test-model', undefined);
  finalizeAssistant(wrap, md, false);
}, WIDE_TABLE_MD);
await page.waitForTimeout(200);

// Mesure commune : géométrie peinte du tableau, de son porteur, et de la
// colonne de lecture (le .body du message, qui EST la colonne pour un
// assistant). `scrollWidth > clientWidth` sur le porteur dit qu'il y a du
// contenu à faire défiler, seul témoin qu'un tableau bridé reste lisible.
const geom = (sel) => page.evaluate((s) => {
  const table = document.querySelector(s);
  if (!table) return null;
  const holder = table.parentElement;
  const body = holder.closest('.body');
  const bubble = holder.closest('.bubble');
  const messages = document.getElementById('messages');
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
  return {
    table: r(table),
    holder: r(holder),
    body: r(body),
    bubble: bubble ? r(bubble) : null,
    messages: r(messages),
    holderScrolls: holder.scrollWidth > holder.clientWidth + 1,
    // Valeur RÉSOLUE du débordement offert : c'est le levier unique du gate
    // (réglage) comme des deux exceptions de boîte (bulle, compte rendu
    // d'agent). La lire dit lequel des deux a agi, là où une géométrie seule
    // laisse la question ouverte.
    bleed: getComputedStyle(holder).getPropertyValue('--table-bleed').trim(),
  };
}, sel);

const ASSISTANT_TABLE = '#thread .msg.assistant .body .table-bleed table';
const USER_TABLE = '#thread .msg.user .bubble .body .table-bleed table';

// ── 1. Réglage activé (défaut) ──────────────────────────────────────────────
console.log('\n── Réglage activé (défaut) ──');
let a = await geom(ASSISTANT_TABLE);
check('un tableau assistant est bien enveloppé et mesuré', a !== null);

// Le débordement est symétrique par construction (marges négatives égales) :
// asserter les DEUX côtés, sinon un tableau simplement décalé passerait.
const overLeft = a.body.left - a.table.left;
const overRight = a.table.right - a.body.right;
check('déborde de la colonne à gauche', overLeft > 1,
  'gauche +' + overLeft.toFixed(1) + 'px');
check('déborde de la colonne à droite', overRight > 1,
  'droite +' + overRight.toFixed(1) + 'px');
check('débordement symétrique', Math.abs(overLeft - overRight) < 2,
  'écart ' + Math.abs(overLeft - overRight).toFixed(1) + 'px');
// Borne haute : le débordement s'arrête à la zone du fil, jamais sous la
// sidebar. Contenance des deux côtés, pas une comparaison à sens unique.
check('reste dans la zone du fil',
  a.table.left >= a.messages.left - 1 && a.table.right <= a.messages.right + 1,
  'table [' + a.table.left.toFixed(0) + ', ' + a.table.right.toFixed(0) + '] dans fil [' +
  a.messages.left.toFixed(0) + ', ' + a.messages.right.toFixed(0) + ']');

// ── 3a. Bulle utilisateur, réglage ACTIVÉ ───────────────────────────────────
//
// Ce qu'on mesure ici est le PORTEUR, jamais la boîte de la <table>. Piège payé
// en écrivant ce script : `getBoundingClientRect()` d'une table qui défile dans
// son porteur rend sa boîte de MISE EN PAGE (600px pour un porteur de 548), pas
// ce qui est peint — la table est clippée par l'`overflow-x` du porteur. Une
// assertion sur la table rougit donc alors que le rendu est correct, et l'objet
// de la garde est bien la contenance visible : c'est le porteur qui la porte.
console.log('\n── Bulle utilisateur, réglage activé ──');
let u = await geom(USER_TABLE);
check('un tableau de bulle utilisateur est mesuré', u !== null);
check('le porteur ne sort pas de la bulle',
  u.holder.left >= u.bubble.left - 1 && u.holder.right <= u.bubble.right + 1,
  'porteur [' + u.holder.left.toFixed(0) + ', ' + u.holder.right.toFixed(0) + '] dans bulle [' +
  u.bubble.left.toFixed(0) + ', ' + u.bubble.right.toFixed(0) + ']');
// Le débordement offert est explicitement remis à zéro : sans cette assertion,
// un porteur qui rentre par accident (bulle assez large) passerait la
// précédente et le jour où la bulle s'élargit le tableau ressortirait.
check('le débordement offert est nul dans la bulle', u.bleed === '0px', u.bleed);
// La contrepartie du bridage : le tableau reste lisible parce qu'il défile.
// Sans elle, un tableau écrasé aux colonnes illisibles passerait les deux
// précédentes.
check('le porteur offre le défilement interne', u.holderScrolls);

// ── 2. Réglage décoché ──────────────────────────────────────────────────────
console.log('\n── Réglage décoché ──');
await page.evaluate(() => { openSettings(); });
await page.waitForSelector('#drawer.show', { timeout: 5000 });
await page.waitForTimeout(300);   // glissement du drawer (translateX 220ms)
const cbBefore = await page.evaluate(() => document.getElementById('set-wide-tables').checked);
check('la case est cochée par défaut', cbBefore === true);
// L'<input> est masqué (le `.toggle` est un label stylé : track + thumb) —
// page.click dessus expire sur « element is not visible ». On clique le LABEL,
// qui est l'affordance réelle, et pas `cb.checked = true` en JS : cette dernière
// forme n'émet aucun `change`, donc n'appellerait jamais onToggleWideTables.
await page.click('#drawer label.toggle:has(#set-wide-tables)');
await page.waitForTimeout(150);
check('le clic sur le label a bien décoché la case',
  await page.evaluate(() => document.getElementById('set-wide-tables').checked === false));
check('le réglage est persisté immédiatement (sans Enregistrer)',
  await page.evaluate(() => loadSettings().wideTables === false));
// « Enregistrer » ne doit pas s'armer : ce réglage est hors settingsFormDirty,
// comme le thème.
check('« Enregistrer » reste désactivé',
  await page.evaluate(() => document.getElementById('save-settings-btn').disabled === true));
await page.evaluate(() => { closeSettings(); });
await page.waitForTimeout(300);

a = await geom(ASSISTANT_TABLE);
// Le PORTEUR, jamais la table : elle défile désormais dans lui, donc sa boîte
// de mise en page reste plus large que ce qui est peint (mesuré 1339 pour un
// porteur à 1161). C'est le porteur qui matérialise la contenance visible.
check('le porteur rentre dans la colonne',
  a.holder.left >= a.body.left - 1 && a.holder.right <= a.body.right + 1,
  'porteur [' + a.holder.left.toFixed(0) + ', ' + a.holder.right.toFixed(0) + '] colonne [' +
  a.body.left.toFixed(0) + ', ' + a.body.right.toFixed(0) + ']');
// Le levier explicite, et pas seulement son effet : un porteur qui rentre parce
// que la fenêtre est étroite passerait l'assertion ci-dessus sans que le gate
// ait agi.
check('le débordement offert est remis à zéro', a.bleed === '0px', a.bleed);
// Contrepartie : bridé, le tableau reste lisible parce qu'il défile — sans quoi
// il aurait simplement écrasé ses colonnes.
check('le porteur offre le défilement interne', a.holderScrolls);

// ── 3b. Bulle utilisateur, réglage DÉCOCHÉ ──────────────────────────────────
console.log('\n── Bulle utilisateur, réglage décoché ──');
u = await geom(USER_TABLE);
check('le porteur ne sort toujours pas de la bulle',
  u.holder.left >= u.bubble.left - 1 && u.holder.right <= u.bubble.right + 1);
check('le débordement offert reste nul', u.bleed === '0px', u.bleed);
check('le porteur offre toujours le défilement interne', u.holderScrolls);

// ── 4. Export HTML ──────────────────────────────────────────────────────────
// Le fichier exporté n'a pas de réglages : l'état du moment y est gravé. On
// produit les DEUX exports depuis la même page — d'abord réglage décoché (état
// courant), puis recoché — et on ouvre chacun pour mesurer la géométrie peinte,
// jamais la seule présence de l'attribut.
console.log('\n── Export HTML ──');
const exportHtml = () => page.evaluate(async () => {
  const conv = { id: 'c-wide', title: 'Tableaux larges', timestamp: Date.now(), messages: [] };
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const styleCss = serializeThemeTokens() + EXPORT_CSS + prismThemeCssForExport();
  const bodyHtml = await renderExportBody(currentThread && currentThread.length ? currentThread : window.__thread, null);
  const s = loadSettings();
  return buildExportHtml({
    title: conv.title, dateDisplay: '09/09/2026', theme, styleCss, bodyHtml,
    scriptTag: '', kind: 'export', wideTables: s.wideTables !== false,
  });
});

// Le thread live n'est pas persisté (aucune conversation ouverte) : on fournit
// à renderExportBody le même contenu, sous la forme qu'il attend.
await page.evaluate((md) => {
  window.__thread = [
    { role: 'user', content: md, ts: Date.now() },
    { role: 'assistant', content: md, model: 'test-model', ts: Date.now() },
  ];
}, WIDE_TABLE_MD);

const htmlOff = await exportHtml();
check('export avec réglage décoché : body porte l\'attribut',
  htmlOff.indexOf('<body data-wide-tables="off">') >= 0);

await page.evaluate(() => { saveSettings({ wideTables: true }); applyWideTables(true); });
const htmlOn = await exportHtml();
check('export avec réglage activé : body nu', htmlOn.indexOf('<body>') >= 0);

// Ouverture réelle des deux exports : c'est la seule façon de savoir que
// EXPORT_CSS (feuille FIGÉE, portage manuel de chat.css — piège 22) porte
// vraiment le gate et la borne de bulle. Un test sur la chaîne HTML ne dirait
// rien de la cascade.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miaou-wide-'));
const measureExport = async (html, name) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, html);
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await p.goto('file://' + f);
  await p.waitForSelector('.export-body', { timeout: 10000 });
  const g = await p.evaluate(() => {
    const pick = (sel) => {
      const t = document.querySelector(sel);
      if (!t) return null;
      const holder = t.parentElement;
      const body = holder.closest('.body');
      const bubble = holder.closest('.bubble');
      const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; };
      return { table: r(t), holder: r(holder), body: r(body), bubble: bubble ? r(bubble) : null,
        holderScrolls: holder.scrollWidth > holder.clientWidth + 1,
        bleed: getComputedStyle(holder).getPropertyValue('--table-bleed').trim() };
    };
    return {
      assistant: pick('.msg.assistant .body .table-bleed table'),
      user: pick('.msg.user .bubble .body .table-bleed table'),
    };
  });
  await p.close();
  return g;
};

const gOn = await measureExport(htmlOn, 'export-on.html');
check('export élargi : le tableau assistant sort de la colonne',
  gOn.assistant !== null && gOn.assistant.body.left - gOn.assistant.table.left > 1,
  gOn.assistant ? '+' + (gOn.assistant.body.left - gOn.assistant.table.left).toFixed(1) + 'px' : 'absent');
// Le porteur, jamais la table : même raison qu'à l'écran (une table qui défile
// rend une boîte de mise en page plus large que ce qui est peint).
check('export élargi : la bulle utilisateur borne quand même son porteur',
  gOn.user !== null &&
  gOn.user.holder.left >= gOn.user.bubble.left - 1 &&
  gOn.user.holder.right <= gOn.user.bubble.right + 1,
  gOn.user ? 'porteur [' + gOn.user.holder.left.toFixed(0) + ', ' + gOn.user.holder.right.toFixed(0) +
    '] bulle [' + gOn.user.bubble.left.toFixed(0) + ', ' + gOn.user.bubble.right.toFixed(0) + ']' : 'absent');
check('export élargi : le débordement offert est nul dans la bulle',
  gOn.user !== null && gOn.user.bleed === '0px', gOn.user ? gOn.user.bleed : 'absent');
check('export élargi : le porteur de la bulle défile', gOn.user !== null && gOn.user.holderScrolls);

const gOff = await measureExport(htmlOff, 'export-off.html');
check('export non élargi : le porteur assistant rentre dans la colonne',
  gOff.assistant !== null &&
  gOff.assistant.holder.left >= gOff.assistant.body.left - 1 &&
  gOff.assistant.holder.right <= gOff.assistant.body.right + 1,
  gOff.assistant ? 'porteur [' + gOff.assistant.holder.left.toFixed(0) + ', ' + gOff.assistant.holder.right.toFixed(0) +
    '] colonne [' + gOff.assistant.body.left.toFixed(0) + ', ' + gOff.assistant.body.right.toFixed(0) + ']' : 'absent');
check('export non élargi : le débordement offert est nul',
  gOff.assistant !== null && gOff.assistant.bleed === '0px', gOff.assistant ? gOff.assistant.bleed : 'absent');
check('export non élargi : le porteur défile', gOff.assistant !== null && gOff.assistant.holderScrolls);

fs.rmSync(tmp, { recursive: true, force: true });

// ── Bilan ───────────────────────────────────────────────────────────────────
console.log('');
if (consoleErrors.length) {
  console.log('Erreurs console :');
  consoleErrors.forEach((e) => console.log('  ' + e));
}
await browser.close();
if (failures.length) {
  console.log('ÉCHEC — ' + failures.length + ' assertion(s) en échec');
  process.exit(1);
}
console.log('OK — toutes les assertions passent');
