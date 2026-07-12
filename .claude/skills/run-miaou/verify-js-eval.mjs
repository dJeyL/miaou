// Vérifie l'outil natif js__eval (lot L) : compute sandboxé QuickJS-WASM sur le
// contenu textuel d'UN blob client référencé par handle, sans jamais faire entrer
// les octets bruts en contexte. Checklist unique batchée (mémoire
// feedback_no_manual_verification) = §9 du brief lot L, 9 points :
//   1. Synthèse d'un gros fichier : le code renvoie un petit résultat, le raw
//      n'apparaît jamais dans le tool result.
//   2. Boucle infinie tuée par le guard timeout (erreur, dans un délai borné).
//   3. OOM catchable (erreur, pas de crash de page).
//   4. Sortie > cap : REFUS explicite (pas de troncature).
//   5. Les trois familles de handle (att-N / file-<id> / res_<id>) résolvent.
//   6. Handle hors-scope / inconnu → « introuvable » (pas d'oracle).
//   7. Monde guest CLOS : fetch / DOM / globalThis hôte indéfinis dans la VM.
//   8. Code capturé dans l'ack (export) mais ABSENT du rendu thread.
//   9. Engine lazy-loadé (pas chargé avant le 1er appel) + doctrine COMPUTE_SANDBOX
//      statique dans le system message (KV-safe).
//
// Le test pilote directement les globals du bundle (callInternalTool, runInQuickJs,
// buildSystemMessage, ACK_KINDS…) en page.evaluate — pas de flux modèle/SSE : L3
// vérifie la mécanique de l'outil, pas l'orchestration. Le cache session
// (_resourceCache) est peuplé à la main pour fabriquer les trois familles de
// handle, resolveHandleRecord restant la source unique (herméticité, piège 18).
//
// Réseau : le premier appel js__eval charge quickjs-emscripten depuis jsDelivr
// (ensureQuickJs, ui.js). Nécessite donc un accès réseau. Usage : node verify-js-eval.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');

const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra }); }

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.goto(appUrl);
await page.waitForFunction(() =>
  typeof callInternalTool === 'function' &&
  typeof runInQuickJs === 'function' &&
  typeof buildSystemMessage === 'function' &&
  typeof utf8Encode === 'function');

// ── Point 9a : engine PAS chargé avant le premier appel (lazy-load) ──────────
const lazyBefore = await page.evaluate(() => typeof _quickjsPromise === 'undefined' || _quickjsPromise === null);
check('engine QuickJS non chargé avant le 1er appel (lazy)', lazyBefore);

// ── Point 9b : doctrine COMPUTE_SANDBOX statique dans le system message ──────
const doctrine = await page.evaluate(() => {
  const sys = buildSystemMessage();
  const txt = typeof sys === 'string' ? sys : (sys && sys.content) || JSON.stringify(sys);
  return { hasBlock: txt.indexOf('COMPUTE_SANDBOX') !== -1, hasPrim: txt.indexOf('jsonLines') !== -1 };
});
check('doctrine COMPUTE_SANDBOX présente dans le system message', doctrine.hasBlock);
check('doctrine énumère les primitives (jsonLines)', doctrine.hasPrim);

// ── Peuple le cache session avec les trois familles de handle ────────────────
// res_… : id = handle. file-<id> : record id = file_<id>, kind library, spaceId
// actif. att-N : lookup par attId + currentConvId.
const BIG = await page.evaluate(() => {
  // Un « gros » fichier JSON-lines : 5000 lignes, chaque ligne un objet.
  const lines = [];
  for (let i = 0; i < 5000; i++) lines.push(JSON.stringify({ i, v: 'x'.repeat(20) }));
  const text = lines.join('\n');

  function put(id, extra) {
    const buf = utf8Encode(text);
    _resourceCache[id] = Object.assign({ id, data: buf }, extra);
  }
  // res_… (id = handle direct)
  put('res_bigtest1', {});
  // file-… → record id file_bigtest2, kind library, spaceId courant
  const sp = (typeof activeSpaceId !== 'undefined') ? activeSpaceId : DEFAULT_SPACE_ID;
  put('file_bigtest2', { kind: 'library', spaceId: sp });
  // att-7 → lookup par attId + currentConvId (fixe currentConvId pour le scope)
  currentConvId = 'conv-jseval-test';
  put('rec_att_bigtest3', { attId: 'att-7', conversationId: 'conv-jseval-test' });

  // Un marqueur du raw pour détecter une fuite : une sous-chaîne présente dans le
  // fichier mais improbable ailleurs.
  return { firstLine: lines[0], nLines: lines.length, rawMarker: lines[0] };
});

// Helper : appelle js__eval et normalise le résultat texte.
async function evalTool(handle, code) {
  return page.evaluate(async ([h, c]) => {
    clearPendingToolAcks();
    const res = await callInternalTool('js__eval', { handle: h, code: c });
    const text = res && res.content && res.content[0] ? res.content[0].text : '';
    const acks = _pendingToolAcks.slice();
    return { text, isError: !!res.isError, acks };
  }, [handle, code]);
}

// ── Point 1 : synthèse — compte des lignes, sans fuite du raw ────────────────
const r1 = await evalTool('res_bigtest1', 'lines().length');
check('synthèse : compte de lignes correct (5000)', r1.text === '5000', 'got=' + r1.text);
check('synthèse : le raw du fichier n\'apparaît pas dans le result',
  r1.text.indexOf(BIG.rawMarker) === -1 && r1.text.length < 100, 'len=' + r1.text.length);

// jsonLines() : agrégation sur objets parsés
const r1b = await evalTool('res_bigtest1',
  'var s=0; var a=jsonLines(); for (var k=0;k<a.length;k++) s+=a[k].i; s');
check('jsonLines : somme des index (0..4999 = 12497500)', r1b.text === '12497500', 'got=' + r1b.text);

// ── Point 5 : les trois familles résolvent le même contenu ───────────────────
const rFile = await evalTool('file-bigtest2', 'lines().length');
const rAtt = await evalTool('att-7', 'lines().length');
check('famille res_… résout', r1.text === '5000');
check('famille file-… résout', rFile.text === '5000', 'got=' + rFile.text);
check('famille att-N résout', rAtt.text === '5000', 'got=' + rAtt.text);

// ── Point 6 : handle inconnu / hors-scope → introuvable (pas d'oracle) ───────
const rUnknown = await evalTool('res_doesnotexist', 'lines().length');
check('handle inconnu → « introuvable » (pas d\'oracle)',
  /introuvable/i.test(rUnknown.text) && !rUnknown.isError, rUnknown.text.slice(0, 60));
// file-<id> d'un autre Space : record présent mais spaceId ≠ actif → introuvable
const rOtherSpace = await page.evaluate(async () => {
  const buf = utf8Encode('secret d\'un autre espace');
  _resourceCache['file_otherspace'] = { id: 'file_otherspace', data: buf, kind: 'library', spaceId: '__another__' };
  clearPendingToolAcks();
  const res = await callInternalTool('js__eval', { handle: 'file-otherspace', code: 'text().length' });
  return res.content[0].text;
});
check('file-<id> hors-Space → introuvable (herméticité)', /introuvable/i.test(rOtherSpace), rOtherSpace.slice(0, 60));

// ── Point 3 handle invalide (forme) → rejet synchrone clair ──────────────────
const rBadForm = await evalTool('res-bad-form', 'lines().length');
check('handle mal formé → « invalide » (rejet synchrone)', /invalide/i.test(rBadForm.text));

// ── Point 4 : sortie > cap → REFUS explicite (pas de troncature) ─────────────
const cap = await page.evaluate(() => JS_EVAL_OUTPUT_CAP);
const rCap = await evalTool('res_bigtest1', 'text()');   // renvoie tout le fichier, largement > cap
check('sortie > cap → refus explicite',
  /refus/i.test(rCap.text) && rCap.text.indexOf(String(cap)) !== -1 && !rCap.isError,
  rCap.text.slice(0, 80));
check('refus : pas de troncature du raw (le fichier n\'est pas renvoyé tronqué)',
  rCap.text.indexOf(BIG.rawMarker) === -1);

// ── Point 2 : boucle infinie tuée par le timeout (délai borné) ───────────────
const t0 = Date.now();
const rLoop = await evalTool('res_bigtest1', 'while(true){}');
const elapsed = Date.now() - t0;
check('boucle infinie → erreur (guard timeout)', /erreur/i.test(rLoop.text) && !rLoop.isError, rLoop.text.slice(0, 60));
check('boucle infinie tuée dans un délai borné (< 10s)', elapsed < 10000, elapsed + 'ms');

// ── Point 3 : OOM catchable (erreur, pas de crash de page) ───────────────────
const rOom = await evalTool('res_bigtest1', 'var a=[]; while(true){ a.push(new Array(100000).fill(0)); }');
check('OOM → erreur catchable (pas de crash)', /erreur/i.test(rOom.text) && !rOom.isError, rOom.text.slice(0, 60));
// Page toujours vivante après OOM :
const alive = await page.evaluate(() => typeof callInternalTool === 'function');
check('page toujours vivante après OOM', alive);

// ── Point 7 : monde guest CLOS (fetch/DOM/globalThis hôte indéfinis) ─────────
const guest = await page.evaluate(async () => {
  const out = {};
  const probe = async (expr) => {
    const r = await runInQuickJs('ignored', 'typeof (' + expr + ')');
    return r.ok ? r.output : ('ERR:' + (r.message || r.reason));
  };
  out.fetch = await probe('fetch');
  out.document = await probe('document');
  out.window = await probe('window');
  out.XMLHttpRequest = await probe('XMLHttpRequest');
  out.miaou_text = await probe('__miaou_text');   // le SEUL pont doit exister
  return out;
});
check('guest : fetch indéfini', guest.fetch === 'undefined', guest.fetch);
check('guest : document indéfini', guest.document === 'undefined', guest.document);
check('guest : window indéfini', guest.window === 'undefined', guest.window);
check('guest : XMLHttpRequest indéfini', guest.XMLHttpRequest === 'undefined', guest.XMLHttpRequest);
check('guest : __miaou_text est le seul pont host (présent)', guest.miaou_text === 'function', guest.miaou_text);

// ── Point 8 : code capturé dans l'ack mais ABSENT du rendu thread ────────────
const CODE = 'lines().length /*MARKER_CODE_9f3a*/';
const r8 = await evalTool('res_bigtest1', CODE);
const ack8 = r8.acks.find(a => a.kind === 'js_eval');
check('ack js_eval poussé', !!ack8);
check('ack porte le champ code (capturé pour export)', ack8 && ack8.code === CODE, ack8 && ack8.code);
// Le label rendu dans le thread ne contient JAMAIS le code
const labelText = await page.evaluate((ack) => {
  const el = document.createElement('div');
  const spec = ACK_KINDS.js_eval;
  if (spec.renderLabel) spec.renderLabel(ack, el); else el.textContent = spec.label(ack);
  return el.textContent;
}, ack8);
check('label thread n\'affiche PAS le code', labelText.indexOf('MARKER_CODE_9f3a') === -1, labelText);
check('label thread mentionne le handle + longueur', /res_bigtest1/.test(labelText) && /car\./.test(labelText), labelText);

// Export : _formatToolCallHtml DOIT contenir le code, échappé (piège 21).
// L'ack d'export réel porte aussi `name` (via ACK_COPY_FIELDS) — on l'ajoute.
const exportHtml = await page.evaluate((ack) => {
  const m = Object.assign({ name: 'miaou__js__eval' }, ack);
  return typeof _formatToolCallHtml === 'function' ? _formatToolCallHtml(m) : '(fn absente)';
}, ack8);
check('export HTML contient le code (capturé)', exportHtml.indexOf('MARKER_CODE_9f3a') !== -1);
// Échappement réel du code modèle (piège 21) : un `</script>` dans le code doit
// ressortir échappé, jamais brut.
const exportEsc = await page.evaluate(() => {
  const m = { name: 'miaou__js__eval', kind: 'js_eval', handle: 'res_bigtest1', ok: true, outLen: 3,
    code: 'var x = "</script><b>pwn</b>"; lines().length' };
  return _formatToolCallHtml(m);
});
check('export HTML échappe </script> du code modèle (pas de balise brute)',
  exportEsc.indexOf('</script>') === -1 && exportEsc.indexOf('<b>pwn</b>') === -1 &&
  exportEsc.indexOf('&lt;/script&gt;') !== -1);

// ── Point 9c : engine chargé APRÈS le premier appel (lazy confirmé) ──────────
const lazyAfter = await page.evaluate(() => _quickjsPromise != null);
check('engine QuickJS chargé après usage (lazy confirmé)', lazyAfter);

await browser.close();

let ok = true;
for (const r of results) {
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '  — ' + r.extra : ''));
  if (!r.ok) ok = false;
}
if (errors.length) {
  console.log('\nConsole / page errors:');
  for (const e of errors.slice(0, 20)) console.log('  ' + e);
}
console.log(ok ? '\nOK' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
