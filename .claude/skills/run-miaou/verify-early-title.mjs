#!/usr/bin/env node
// Lot AA — « un titre disponible tôt ». Vérifie la cascade des trois niveaux
// (extrait instantané / titrage précoce / titrage de fin d'échange) sur les
// points qu'aucun test QuickJS ne peut atteindre.
//
// Checklist :
//   1. extrait visible en sidebar ET topbar dès l'envoi, en italique ; onglet sans italique
//   2. le titre du niveau 2 remplace l'extrait, l'italique disparaît des deux surfaces
//   3. LIGNE FROIDE : conversation évincée du cache de messages → la sidebar garde son libellé
//   4. un agent affiche son agentIntent SANS italique, et ne porte AUCUN snippet en base
//   5. titre manuel saisi avant l'envoi : jamais écrasé, aucun snippet écrit
//   6. earlyTitle décoché : aucun appel de titrage à l'envoi
//   7. le niveau 3 est DÉSARMÉ quand le niveau 2 a réussi (un seul titrage sur l'échange)
//   8. message sans texte (image seule) : aucun snippet, aucun titrage précoce
//
// Backend stubé : on distingue titrage précoce / titrage de fin / chat par le
// system prompt, et on COMPTE les appels de chaque sorte.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Compteurs par sorte d'appel. Le titrage précoce se reconnaît à la phrase qui
// est SA raison d'être (« pas encore répondu ») ; le titrage de fin, à sa
// première phrase. Les distinguer est tout l'objet des contrôles 6 et 7.
let calls = { early: 0, late: 0, chat: 0 };
const resetCalls = () => { calls = { early: 0, late: 0, chat: 0 }; };

// Retenue globale des réponses, par un flag lu DANS le handler unique. Un
// second `page.route` posé par-dessus (même avec `times`) intercepte tout le
// trafic suivant et laisse un état résiduel : le contrôle 1 voit alors un écran
// figé et les contrôles d'après ne reçoivent plus rien. Défaut payé à
// l'écriture de ce script — le harnais mentait, pas le code.
let holdMs = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await page.route('**/chat/completions', async (route) => {
  if (holdMs) await sleep(holdMs);
  const body = JSON.parse(route.request().postData() || '{}');
  const sys = (body.messages || []).find(m => m.role === 'system');
  const txt = (sys && sys.content) || '';
  // Les titrages passent par silentCompletion (JSON non streamé) ; le chat,
  // lui, DOIT être servi en SSE. Un stub JSON pour le chat laisse le message
  // assistant à content VIDE, et maybeTitle s'abstient alors à raison (garde
  // des 8 caractères, piège 5) : le script lirait « le niveau 3 ne titre pas »
  // sur un défaut de harnais. Vérifié : le même faux négatif se produit sur la
  // révision d'avant le lot.
  if (/pas encore répondu/.test(txt)) {
    calls.early++;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre precoce' }, finish_reason: 'stop' }] }) });
    return;
  }
  if (/Génère un titre court/.test(txt)) {
    calls.late++;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre tardif' }, finish_reason: 'stop' }] }) });
    return;
  }
  calls.chat++;
  const chunks = [
    { choices: [{ delta: { content: 'Une réponse assez longue pour compter comme substantielle.' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ];
  await route.fulfill({
    status: 200, contentType: 'text/event-stream',
    body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n',
  });
});
await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'stub-model' }] }),
}));

await page.goto('file://' + distPath);
await page.waitForSelector('.boot-done, #composer-text', { timeout: 15000 });
await page.evaluate(() => {
  localStorage.setItem('miaou-settings', JSON.stringify({
    url: 'http://stub.local/v1', key: 'x', model: 'stub-model', earlyTitle: true,
  }));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail: detail || '' }); };

// Lecture des trois surfaces de libellé. `provisional` est lue sur la CLASSE,
// pas sur le style calculé : c'est la classe qui est le contrat, l'italique
// n'en est que la conséquence CSS (on vérifie aussi le rendu au contrôle 1).
const surfaces = (convId) => page.evaluate((id) => {
  // La ligne de sidebar porte la classe `.conv` (pas `.conv-item`) et n'expose
  // pas son id en attribut : on la retrouve par la case de sélection, qui
  // l'embarque dans son `onclick`.
  const box = document.querySelector(`.conv-list .conv-select[onclick*="${id}"]`);
  const row = box ? box.closest('.conv').querySelector('.conv-title') : null;
  const top = document.getElementById('conv-title');
  return {
    rowText: row ? row.textContent : null,
    rowItalic: row ? row.classList.contains('provisional') : null,
    rowComputedItalic: row ? getComputedStyle(row).fontStyle === 'italic' : null,
    topText: top.textContent,
    topItalic: top.classList.contains('provisional'),
    topComputedItalic: getComputedStyle(top).fontStyle === 'italic',
    docTitle: document.title,
  };
}, convId);

const LONG = 'Comment configurer un reverse proxy Caddy avec un certificat wildcard';

// ── 1. extrait dès l'envoi, avant toute réponse ─────────────────────────────
// Le titrage et le chat sont bloqués le temps de l'observation : sans ça, le
// stub répond instantanément et l'extrait serait déjà remplacé — on testerait
// l'état d'arrivée en croyant tester l'état de départ.
holdMs = 4000;
await page.evaluate((t) => { sendUserText(t); }, LONG);
await page.waitForTimeout(600);
const convId = await page.evaluate(() => currentConvId);
const s1 = await surfaces(convId);
const expectedSnippet = await page.evaluate((t) => conversationSnippet(t), LONG);
check('1a. la sidebar affiche l\'extrait', s1.rowText === expectedSnippet, `reçu ${JSON.stringify(s1.rowText)}`);
check('1b. la topbar affiche l\'extrait', s1.topText === expectedSnippet, `reçu ${JSON.stringify(s1.topText)}`);
check('1c. les deux surfaces sont en italique (classe ET rendu)',
  s1.rowItalic && s1.rowComputedItalic && s1.topItalic && s1.topComputedItalic,
  JSON.stringify(s1));
check('1d. l\'onglet porte l\'extrait BRUT, sans marque de provisoire',
  s1.docTitle === expectedSnippet + ' — MIAOU', s1.docTitle);
holdMs = 0;

// ── 2. le titre remplace l'extrait ──────────────────────────────────────────
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
resetCalls();
await page.evaluate((t) => { sendUserText(t); }, LONG);
await page.waitForTimeout(2500);
const conv2 = await page.evaluate(() => currentConvId);
const s2 = await surfaces(conv2);
// Défaut du complément : le retitrage est ARMÉ, donc l'état d'arrivée est le
// titre de FIN d'échange. C'est le titre précoce qui n'est que transitoire.
check('2a. le titre de fin d\'échange a remplacé l\'extrait',
  s2.rowText === 'Titre tardif' && s2.topText === 'Titre tardif', JSON.stringify(s2));
check('2b. l\'italique a disparu des deux surfaces',
  !s2.rowItalic && !s2.topItalic && !s2.rowComputedItalic && !s2.topComputedItalic, JSON.stringify(s2));

// ── 7. les DEUX titrages tournent (retitrage armé par défaut) ───────────────
// Contrôle inversé par le complément au lot AA : le niveau 3 n'est plus désarmé
// par défaut. Le désarmement conditionnel porte sur les DEUX porteurs —
// gen.needTitle (copie figée, la seule que maybeTitle lit) et la globale
// d'écran — et le contrôle 10 vérifie le cas décoché.
check('7. les deux titrages tournent, le tardif écrase le précoce',
  calls.early === 1 && calls.late === 1, JSON.stringify(calls));

// ── 3. LIGNE FROIDE (le point dur du lot) ───────────────────────────────────
// Conversation sans titre, évincée du cache de messages : son libellé ne peut
// venir que de la projection méta de listAllConversations. Sans la ligne
// `snippet: c.snippet`, la sidebar retombe sur « Nouvelle conversation ».
const cold = await page.evaluate(async () => {
  const id = 'cold-' + Date.now();
  saveConversation({
    id, title: '', timestamp: Date.now(), updatedAt: Date.now(), spaceId: 'default',
    snippet: 'Un extrait figé sur une conversation froide',
    messages: [{ role: 'user', content: 'Un extrait figé sur une conversation froide' }],
  });
  // Éviction explicite de l'étage 2 : c'est exactement l'état d'une
  // conversation ancienne après un reload ou une LRU pleine.
  _convMessagesCache.delete(id);
  renderConvList();
  const meta = listAllConversations().find(c => c.id === id);
  const lbl = convLabel(meta);
  return { id, metaSnippet: meta ? meta.snippet : null, text: lbl.text, provisional: lbl.provisional,
           hasMessages: (loadConversation(id).messages || []).length };
});
check('3a. listAllConversations PROJETTE snippet (la ligne critique du lot)',
  cold.metaSnippet === 'Un extrait figé sur une conversation froide', JSON.stringify(cold));
check('3b. la conversation est bien FROIDE (messages non peuplés)', cold.hasMessages === 0, String(cold.hasMessages));
check('3c. la ligne froide garde son libellé, marqué provisoire',
  cold.text === 'Un extrait figé sur une conversation froide' && cold.provisional === true, JSON.stringify(cold));
const coldRow = await page.evaluate((id) => {
  const el = Array.from(document.querySelectorAll('.conv-title'))
    .find(e => e.textContent === 'Un extrait figé sur une conversation froide');
  return el ? { text: el.textContent, italic: getComputedStyle(el).fontStyle === 'italic' } : null;
}, cold.id);
check('3d. et la sidebar la rend en italique', !!(coldRow && coldRow.italic), JSON.stringify(coldRow));

// ── 4. agent : agentIntent, sans italique, sans snippet ─────────────────────
const agent = await page.evaluate(async () => {
  const id = 'agent-' + Date.now();
  saveConversation({
    id, title: '', timestamp: Date.now(), updatedAt: Date.now(), spaceId: 'default',
    parentConvId: 'p-x', agentIntent: 'Trier les journaux', agentStatus: 'done',
    messages: [{ role: 'user', content: 'Trie ces journaux.' }],
  });
  const meta = listAllConversations().find(c => c.id === id);
  const lbl = convLabel(meta);
  // maybeWriteSnippet doit S'ABSTENIR sur un agent : l'absence en base est
  // l'invariant, un affichage correct ne la prouverait pas.
  maybeWriteSnippet(id, { role: 'user', content: 'Trie ces journaux.' });
  const after = loadConversation(id);
  return { text: lbl.text, provisional: lbl.provisional, snippet: after.snippet || null };
});
check('4a. un agent affiche son agentIntent', agent.text === 'Trier les journaux', JSON.stringify(agent));
check('4b. et NON provisoire (libellé définitif, pas une attente)', agent.provisional === false, JSON.stringify(agent));
check('4c. aucun snippet n\'est écrit sur un agent (lu en base, pas à l\'écran)',
  agent.snippet === null, JSON.stringify(agent));

// ── 5. titre manuel : jamais écrasé, aucun snippet ──────────────────────────
const manual = await page.evaluate(async () => {
  const id = 'manual-' + Date.now();
  saveConversation({
    id, title: 'Nom choisi à la main', timestamp: Date.now(), updatedAt: Date.now(),
    spaceId: 'default', messages: [],
  });
  maybeWriteSnippet(id, { role: 'user', content: 'Un message qui ne doit rien écrire.' });
  const after = loadConversation(id);
  const lbl = convLabel(after);
  return { title: after.title, snippet: after.snippet || null, text: lbl.text, provisional: lbl.provisional };
});
check('5a. un titre manuel bloque l\'écriture du snippet',
  manual.snippet === null && manual.title === 'Nom choisi à la main', JSON.stringify(manual));
check('5b. et le libellé reste le titre, non provisoire',
  manual.text === 'Nom choisi à la main' && manual.provisional === false, JSON.stringify(manual));

// ── 8. message sans texte (image seule) ─────────────────────────────────────
const imageOnly = await page.evaluate(async () => {
  const id = 'img-' + Date.now();
  saveConversation({ id, title: '', timestamp: Date.now(), updatedAt: Date.now(), spaceId: 'default', messages: [] });
  maybeWriteSnippet(id, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:,' } }] });
  return { snippet: (loadConversation(id).snippet) || null };
});
check('8. une image sans légende n\'écrit aucun snippet (rien à afficher)',
  imageOnly.snippet === null, JSON.stringify(imageOnly));

// ── 9. réception multi-onglets sur une conversation LISTÉE, non affichée ────
// BroadcastChannel ne traverse pas deux pages `file://` (origines opaques) : on
// injecte l'enveloppe dans `_onSyncRawMessage`, qui EST le point d'entrée réel
// du récepteur — le transport n'est pas ce qu'on teste, la relecture APRÈS
// l'await l'est (piège 24 b : un instantané figé avant l'await laisserait la
// liste « en retard d'un tour »).
const crossTab = await page.evaluate(async () => {
  const id = 'peer-' + Date.now();
  saveConversation({
    id, title: '', timestamp: Date.now(), updatedAt: Date.now(), spaceId: 'default',
    snippet: 'Un extrait posé par un autre onglet', messages: [],
  });
  renderConvList();
  const labelOf = () => {
    const box = document.querySelector(`.conv-list .conv-select[onclick*="${id}"]`);
    const row = box ? box.closest('.conv').querySelector('.conv-title') : null;
    return row ? { text: row.textContent, italic: getComputedStyle(row).fontStyle === 'italic' } : null;
  };
  const before = labelOf();
  // Le pair a titré : la méta change en base, puis l'enveloppe arrive.
  persistConversationField(id, { title: 'Titré par le pair' });
  _onSyncRawMessage({ data: makeEnvelope('conv-updated', 'peer-tab', { convId: id, spaceId: 'default' }) });
  await new Promise(r => setTimeout(r, 800));
  return { before, after: labelOf(), displayed: currentConvId === id };
});
check('9a. la conversation du pair n\'est PAS celle affichée', crossTab.displayed === false, JSON.stringify(crossTab));
check('9b. elle affichait son extrait, en italique',
  !!(crossTab.before && crossTab.before.text === 'Un extrait posé par un autre onglet' && crossTab.before.italic),
  JSON.stringify(crossTab.before));
check('9c. le titre du pair arrive en sidebar, sans italique',
  !!(crossTab.after && crossTab.after.text === 'Titré par le pair' && !crossTab.after.italic),
  JSON.stringify(crossTab.after));

// ── 6. earlyTitle décoché : aucun titrage à l'envoi ─────────────────────────
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('miaou-settings'));
  s.earlyTitle = false;
  localStorage.setItem('miaou-settings', JSON.stringify(s));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => { newConversation(); });
// Reset APRÈS le reload et la stabilisation : les générations des étapes
// précédentes sont encore vivantes au moment du reload et leur titrage retombe
// sinon dans ces compteurs (le script accusait le code d'un titrage qu'il
// n'avait pas émis à cette étape).
await page.waitForTimeout(1500);
resetCalls();
await page.evaluate((t) => { sendUserText(t); }, 'Une question posée réglage décoché.');
await page.waitForTimeout(2500);
check('6a. réglage décoché : AUCUN titrage précoce', calls.early === 0, JSON.stringify(calls));
check('6b. et le niveau 3 titre comme avant le lot', calls.late === 1, JSON.stringify(calls));
const s6 = await surfaces(await page.evaluate(() => currentConvId));
check('6c. l\'extrait reste affiché en attendant (niveau 1 indépendant du réglage)',
  s6.topText === 'Titre tardif' || s6.topText === 'Une question posée réglage décoché.', JSON.stringify(s6));

// ══ Complément au lot AA — « titre après la première réponse » ═════════════

// ── 10. retitrage DÉCOCHÉ : on retombe sur le comportement d'origine ────────
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('miaou-settings'));
  s.earlyTitle = true; s.retitleAfterReply = false;
  localStorage.setItem('miaou-settings', JSON.stringify(s));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => { newConversation(); });
await page.waitForTimeout(1500);
resetCalls();
await page.evaluate((t) => { sendUserText(t); }, 'Une question avec retitrage decoche.');
await page.waitForTimeout(2500);
check('10a. décoché : le niveau 3 est désarmé, un seul titrage',
  calls.early === 1 && calls.late === 0, JSON.stringify(calls));
const s10 = await surfaces(await page.evaluate(() => currentConvId));
check('10b. et le titre précoce reste en place',
  s10.topText === 'Titre precoce', JSON.stringify(s10));

// ── 11. titre MANUEL saisi PENDANT la génération ────────────────────────────
// Le défaut trouvé en implémentant : onTitleBlur éteint la globale d'écran,
// jamais la copie figée dans `gen` — la seule que maybeTitle lit. La fenêtre
// couvre désormais tout l'échange (gen.needTitle reste armé jusqu'à onFinal),
// donc un titre tapé pendant une longue réponse serait écrasé en fin d'échange.
// On passe par le VRAI chemin (le contentEditable de la topbar), pas par un
// appel direct : c'est le câblage qu'on vérifie autant que la garde.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('miaou-settings'));
  s.earlyTitle = true; s.retitleAfterReply = true;
  localStorage.setItem('miaou-settings', JSON.stringify(s));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => { newConversation(); });
await page.waitForTimeout(1500);
resetCalls();
holdMs = 3500;   // l'échange dure : c'est la fenêtre où l'utilisateur peut renommer
await page.evaluate((t) => { sendUserText(t); }, 'Une question longue pendant laquelle je renomme.');
await page.waitForTimeout(500);
const manualConvId = await page.evaluate(() => currentConvId);
await page.evaluate(() => {
  const el = document.getElementById('conv-title');
  el.focus();
  el.textContent = 'Nom tapé pendant la génération';
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
});
holdMs = 0;
await page.waitForTimeout(4000);
const manualDuring = await page.evaluate((id) => {
  const c = loadConversation(id);
  return { title: c.title, autoTitled: c.autoTitled === true, top: document.getElementById('conv-title').textContent };
}, manualConvId);
check('11a. le titre manuel survit à la fin de l\'échange (jamais écrasé)',
  manualDuring.title === 'Nom tapé pendant la génération', JSON.stringify(manualDuring));
check('11b. et il n\'est PAS marqué autoTitled (le marqueur distingue les deux)',
  manualDuring.autoTitled === false, JSON.stringify(manualDuring));
check('11c. la topbar affiche bien le titre choisi',
  manualDuring.top === 'Nom tapé pendant la génération', JSON.stringify(manualDuring));

// ── 12. dépendance UI du réglage : libellé, état, éditabilité ───────────────
const ui = await page.evaluate(() => {
  const read = () => {
    const cb = document.getElementById('set-retitle-after-reply');
    const row = cb.closest('.check-row');
    const lblEl = document.getElementById('set-retitle-label');
    const track = cb.parentElement.querySelector('.track');
    return {
      checked: cb.checked, disabled: cb.disabled,
      label: lblEl.textContent,
      locked: row.classList.contains('is-locked'),
      labelOpacity: getComputedStyle(row.querySelector('.label-col')).opacity,
      trackOpacity: getComputedStyle(track).opacity,
      cursor: getComputedStyle(cb.closest('.toggle')).cursor,
    };
  };
  openSettings();
  const early = document.getElementById('set-early-title');
  early.checked = true;  updateSettingsDirty();
  const on = read();
  early.checked = false; updateSettingsDirty();
  const off = read();
  return { on, off };
});
check('12a. précoce ON : libellé « régénéré », case modifiable',
  ui.on.label === 'Titre régénéré après la première réponse' && ui.on.disabled === false,
  JSON.stringify(ui.on));
check('12b. précoce OFF : libellé sans « régénéré », cochée et FIGÉE',
  ui.off.label === 'Titre après la première réponse' && ui.off.checked === true && ui.off.disabled === true,
  JSON.stringify(ui.off));
check('12c. figée = grisée : libellé ET interrupteur à opacité réduite',
  ui.off.locked === true && ui.off.labelOpacity === '0.45' && ui.off.trackOpacity === '0.45',
  JSON.stringify(ui.off));
check('12d. et le curseur cesse d\'annoncer un clic possible',
  ui.off.cursor === 'default' && ui.on.cursor === 'pointer', JSON.stringify(ui));
check('12e. précoce ON : pleine opacité (la ligne n\'est pas grisée à tort)',
  ui.on.locked === false && ui.on.labelOpacity === '1' && ui.on.trackOpacity === '1',
  JSON.stringify(ui.on));

// Capture des DEUX états côte à côte, drawer ouvert et déroulé sur la catégorie
// « Mémoire » — prise AVANT le contrôle 13, qui referme le drawer en
// enregistrant. Cadrée sur la ligne, pas sur la page : un plein écran ne
// montrerait pas l'écart d'opacité.
for (const early of [true, false]) {
  await page.evaluate((e) => {
    openSettings();
    const cb = document.getElementById('set-retitle-after-reply');
    const cat = cb.closest('.set-cat');
    if (cat && !cat.classList.contains('open')) cat.querySelector('.set-cat-head').click();
    document.getElementById('set-early-title').checked = e;
    updateSettingsDirty();
  }, early);
  await page.waitForTimeout(400);
  const row = await page.$('#set-retitle-after-reply');
  const box = await page.evaluate(() => {
    const r = document.getElementById('set-early-title').closest('.field').getBoundingClientRect();
    const r2 = document.getElementById('set-retitle-after-reply').closest('.field').getBoundingClientRect();
    return { x: r.x - 12, y: r.y - 10, width: r.width + 24, height: (r2.bottom - r.top) + 20 };
  });
  if (row && box.height > 0) {
    await page.screenshot({ path: path.join(__dirname, `shots-retitle/toggle-early-${early ? 'on' : 'off'}.png`), clip: box });
  }
}

// ── 13. la valeur est REMISE à true en storage à la bascule (E2) ────────────
// Le point que « forcer à la lecture » ne tiendrait pas : un false dormant en
// base ressurgirait au ré-activage du précoce.
const persisted = await page.evaluate(() => {
  const setBoth = (early, retitle) => {
    document.getElementById('set-early-title').checked = early;
    document.getElementById('set-retitle-after-reply').checked = retitle;
    updateSettingsDirty();
    onSaveSettings();
    return JSON.parse(localStorage.getItem('miaou-settings')).retitleAfterReply;
  };
  const off = setBoth(true, false);          // décoché pendant que le précoce est actif
  const afterEarlyOff = setBoth(false, false); // puis on éteint le précoce
  document.getElementById('set-early-title').checked = true;  // et on le rallume
  updateSettingsDirty();
  const uiOnRelight = document.getElementById('set-retitle-after-reply').checked;
  return { off, afterEarlyOff, uiOnRelight };
});
check('13a. décoché avec précoce actif : false bien persisté', persisted.off === false, JSON.stringify(persisted));
check('13b. précoce éteint : la valeur est REMISE à true en base',
  persisted.afterEarlyOff === true, JSON.stringify(persisted));
check('13c. au ré-activage, la case repart armée (aucun false dormant)',
  persisted.uiOnRelight === true, JSON.stringify(persisted));

await browser.close();

let failed = 0;
for (const r of results) {
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '  — ' + r.detail : ''));
  if (!r.ok) failed++;
}
if (consoleErrors.length) console.log('\nConsole errors:\n' + JSON.stringify(consoleErrors, null, 2));
console.log('\n' + (failed ? failed + ' échec(s)' : 'tout vert') + ' — ' + results.length + ' contrôles');
process.exitCode = failed ? 1 : 0;
