// Vérifie le CROISEMENT multi-ressources de js__eval (lot L-2) : `input_handles`
// remplace le `handle` scalaire du lot L par un objet {clé: handle} de 1 à
// JS_EVAL_MAX_INPUTS entrées, pour que le modèle puisse rapprocher deux gros
// résultats dans la sandbox au lieu de les faire transiter par son contexte.
//
// Script SÉPARÉ de verify-js-eval.mjs (qui garde la checklist du lot L de base,
// migrée à la nouvelle signature) : ce qui est vérifié ici est le delta L-2, et
// doit rester lisible comme tel. Checklist, 7 points :
//   1. Croisement réel : deux JSON distincts joints par une clé commune dans la
//      VM, comparé à un calcul de référence fait CÔTÉ SCRIPT (pas dans la VM —
//      sinon l'oracle et le sujet seraient le même code).
//   2. Refus TOTAL sur clé invalide : message nommant la clé fautive, ET aucun
//      ack js_eval poussé (preuve qu'aucune exécution n'a eu lieu).
//   3. Cap sur le NOMBRE de clés, lu depuis la constante réelle du bundle
//      (jamais un 4 en dur ici — il dériverait en silence).
//   4. Clé absente référencée dans le code → erreur guest CATCHABLE, pas un
//      undefined silencieux ni un crash de page.
//   5. Non-régression du cas à une seule ressource.
//   6. Libellé thread à 2+ clés : forme résumée (jsEvalHandlesSummary).
//   7. Export HTML : les deux clés ET les deux handles présents, échappés — les
//      CLÉS sont d'origine modèle, c'est un chemin d'échappement nouveau (piège 21).
//
// Comme verify-js-eval.mjs : pilotage direct des globals du bundle en
// page.evaluate (pas de flux modèle/SSE), cache session peuplé à la main,
// resolveHandleRecord restant la source unique de résolution (piège 18).
//
// Réseau : le premier appel charge quickjs-emscripten depuis jsDelivr.
// Usage : node verify-js-eval-multi.mjs
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
  typeof utf8Encode === 'function' &&
  typeof jsEvalHandlesSummary === 'function');

// ── Fixtures : deux JSON distincts, joignables par un id commun ──────────────
// Les données sont GÉNÉRÉES ici (côté script) pour pouvoir calculer l'oracle du
// point 1 hors de la VM, puis injectées dans le cache session de la page.
const CLIENTS = [];
const COMMANDES = [];
for (let i = 1; i <= 200; i++) CLIENTS.push({ id: i, nom: 'client' + i });
for (let i = 0; i < 1000; i++) {
  COMMANDES.push({ clientId: (i % 200) + 1, montant: (i % 7) + 1 });
}
// Oracle : la même jointure, calculée en Node. Un client sur deux seulement est
// retenu (id pair), pour que le résultat ne puisse pas être obtenu par un code
// qui ignorerait l'une des deux ressources.
const attendu = {};
for (const c of CLIENTS) {
  if (c.id % 2 !== 0) continue;
  const total = COMMANDES.filter(o => o.clientId === c.id).reduce((s, o) => s + o.montant, 0);
  if (total) attendu[c.nom] = total;
}

await page.evaluate(({ clients, commandes }) => {
  function put(id, text) { _resourceCache[id] = { id, data: utf8Encode(text) }; }
  put('res_clients', JSON.stringify(clients));
  put('res_commandes', JSON.stringify(commandes));
  put('res_solo', 'a\nb\nc\nd\n');
}, { clients: CLIENTS, commandes: COMMANDES });

// Helper : appel brut, rend le texte + les acks poussés par CE seul appel.
async function callEval(args) {
  return page.evaluate(async (a) => {
    clearPendingToolAcks();
    const res = await callInternalTool('js__eval', a);
    return {
      text: res && res.content && res.content[0] ? res.content[0].text : '',
      isError: !!res.isError,
      acks: _pendingToolAcks.slice(),
    };
  }, args);
}

// ── Point 1 : croisement réel de deux ressources ────────────────────────────
const joinCode = [
  'var cs = parse("clients");',
  'var os = parse("commandes");',
  'var tot = {};',
  'cs.forEach(function (c) { if (c.id % 2 === 0) { tot[c.nom] = 0; } });',
  'os.forEach(function (o) {',
  '  var c = cs[o.clientId - 1];',
  '  if (c && tot[c.nom] !== undefined) { tot[c.nom] += o.montant; }',
  '});',
  'JSON.stringify(tot);',
].join('\n');
const joined = await callEval({
  input_handles: { clients: 'res_clients', commandes: 'res_commandes' },
  code: joinCode,
});
let obtenu = null;
try { obtenu = JSON.parse(joined.text); } catch (e) { /* laissé à null */ }
check('1a. le croisement de DEUX ressources s\'exécute sans erreur',
  !joined.isError && obtenu !== null, joined.text.slice(0, 120));
check('1b. le résultat est EXACTEMENT la jointure de référence calculée hors VM',
  obtenu !== null && JSON.stringify(obtenu) === JSON.stringify(attendu),
  obtenu ? Object.keys(obtenu).length + ' clés vs ' + Object.keys(attendu).length : 'null');
// Contrôle de non-vacuité : sans ça, deux objets vides passeraient le test.
check('1c. la jointure de référence n\'est pas vide (prémisse du contrôle 1b)',
  Object.keys(attendu).length > 50, String(Object.keys(attendu).length));
check('1d. l\'ack porte les DEUX entrées sous leurs clés',
  joined.acks.length === 1 && joined.acks[0].kind === 'js_eval' &&
  joined.acks[0].inputHandles && joined.acks[0].inputHandles.clients === 'res_clients' &&
  joined.acks[0].inputHandles.commandes === 'res_commandes',
  JSON.stringify(joined.acks[0] && joined.acks[0].inputHandles));

// ── Point 2 : refus TOTAL sur clé invalide, sans exécution ───────────────────
// Deux chemins de refus DISTINCTS, éprouvés séparément : la garde de FORME
// (classifyHandleRef) et la RÉSOLUTION (resolveHandleRecord → null). Les
// confondre masquerait qu'un des deux ne nomme pas sa clé. « res_nexiste_pas »
// est malformé (underscores) et n'atteindrait jamais la résolution.
const refus = await callEval({
  input_handles: { bonne: 'res_clients', mauvaise: 'res_zzzzzzzz' },
  code: 'text("bonne").length;',
});
check('2a. une clé de forme VALIDE mais non résoluble fait échouer l\'appel ENTIER',
  /introuvable/i.test(refus.text), refus.text.slice(0, 140));
check('2b. le message NOMME la clé fautive, pas la valide',
  /"mauvaise"/.test(refus.text) && !/"bonne"/.test(refus.text), refus.text.slice(0, 140));
const refusForme = await callEval({
  input_handles: { bonne: 'res_clients', malformee: 'res-pas-un-handle' },
  code: 'text("bonne").length;',
});
check('2b-bis. une clé MALFORMÉE est refusée par la garde de forme, en se nommant',
  /invalide/i.test(refusForme.text) && /"malformee"/.test(refusForme.text),
  refusForme.text.slice(0, 140));
// La preuve que rien n'a tourné : un ack js_eval n'est poussé qu'APRÈS
// résolution+exécution. Son absence est le témoin du refus pré-exécution.
check('2c. AUCUN ack js_eval poussé → aucune exécution n\'a eu lieu',
  refus.acks.filter(a => a.kind === 'js_eval').length === 0,
  JSON.stringify(refus.acks.map(a => a.kind)));

// ── Point 3 : cap sur le NOMBRE de clés (constante lue dans le bundle) ───────
const maxInputs = await page.evaluate(() => JS_EVAL_MAX_INPUTS);
check('3a. JS_EVAL_MAX_INPUTS est exposée par le bundle', typeof maxInputs === 'number' && maxInputs > 0,
  String(maxInputs));
const tooMany = {};
for (let i = 0; i <= maxInputs; i++) tooMany['k' + i] = 'res_clients';
const capped = await callEval({ input_handles: tooMany, code: '1;' });
check('3b. au-delà de la limite, refus annonçant le compte ET la limite',
  new RegExp(String(maxInputs + 1) + ' clés').test(capped.text) &&
  new RegExp('maximum ' + maxInputs).test(capped.text), capped.text.slice(0, 140));
// Contrôle de prémisse : À la limite exacte, le même appel passe la garde de
// nombre (il échouera plus loin ou réussira, mais pas sur « maximum »).
const atLimit = {};
for (let i = 0; i < maxInputs; i++) atLimit['k' + i] = 'res_clients';
const okLimit = await callEval({ input_handles: atLimit, code: 'text("k0").length;' });
check('3c. À la limite exacte l\'appel n\'est PAS refusé sur le nombre',
  !/maximum/.test(okLimit.text), okLimit.text.slice(0, 100));

// ── Point 4 : clé absente référencée dans le code → erreur guest catchable ───
const missingKey = await callEval({
  input_handles: { a: 'res_solo' },
  code: 'text("b").length;',
});
check('4a. lire une clé non fournie remonte une erreur d\'exécution (pas un undefined)',
  /Erreur d'exécution/.test(missingKey.text), missingKey.text.slice(0, 160));
check('4b. le message nomme la clé absente', /"b"/.test(missingKey.text), missingKey.text.slice(0, 160));
// L'erreur doit être CATCHABLE côté guest : le modèle doit pouvoir la rattraper
// dans son propre code, pas seulement la subir. C'est ce que garantit le
// protocole { error: ctx.newError(...) } plutôt qu'un retour undefined.
const caught = await callEval({
  input_handles: { a: 'res_solo' },
  code: 'var m = "non"; try { text("b"); } catch (e) { m = "RATTRAPE"; } m;',
});
check('4c. cette erreur est RATTRAPABLE par un try/catch du code modèle',
  /RATTRAPE/.test(caught.text), caught.text.slice(0, 120));

// ── Point 5 : non-régression du cas à UNE ressource ──────────────────────────
const solo = await callEval({ input_handles: { seule: 'res_solo' }, code: 'lines("seule").length;' });
check('5. une seule ressource (avec sa clé) fonctionne comme avant',
  !solo.isError && solo.text.trim().startsWith('5'), solo.text.slice(0, 80));

// ── Point 6 : libellé thread — résumé à 2+, handle nu à 1 ───────────────────
const labels = await page.evaluate(() => {
  const mk = (inputHandles) => {
    const el = document.createElement('span');
    ACK_KINDS.js_eval.renderLabel({ kind: 'js_eval', inputHandles, outLen: 12 }, el);
    return el.textContent;
  };
  return {
    un: mk({ src: 'res_clients' }),
    deux: mk({ clients: 'res_clients', commandes: 'res_commandes' }),
    plat: ACK_KINDS.js_eval.label({ kind: 'js_eval', inputHandles: { a: 'res_1', b: 'res_2' }, outLen: 3 }),
  };
});
check('6a. à UNE clé le libellé montre le handle nu (raccourci du cas majoritaire)',
  /res_clients/.test(labels.un), labels.un);
check('6b. à DEUX clés le libellé résume : compte + clés, sans les handles bruts',
  /2 ressources/.test(labels.deux) && /clients/.test(labels.deux) &&
  /commandes/.test(labels.deux) && !/res_clients/.test(labels.deux), labels.deux);
check('6c. le libellé plat (label) suit la même règle que renderLabel',
  /2 ressources/.test(labels.plat), labels.plat);

// ── Point 7 : export HTML — clés ET handles présents, ÉCHAPPÉS ───────────────
// La clé est écrite par le MODÈLE : l'énumération des entrées ouvre un chemin
// d'échappement que le lot L n'avait pas (seul le handle y transitait).
const exportHtml = await page.evaluate(() => {
  const m = {
    name: 'miaou__js__eval', kind: 'js_eval', ok: true, outLen: 3,
    inputHandles: { '</script><b>pwn</b>': 'res_clients', sain: 'res_commandes' },
    code: 'text("sain").length',
  };
  return _formatToolCallHtml(m);
});
check('7a. l\'export énumère les deux clés et les deux handles',
  exportHtml.indexOf('res_clients') !== -1 && exportHtml.indexOf('res_commandes') !== -1 &&
  exportHtml.indexOf('sain') !== -1);
check('7b. une clé malveillante ressort ÉCHAPPÉE, jamais en balise brute',
  exportHtml.indexOf('</script>') === -1 && exportHtml.indexOf('<b>pwn</b>') === -1 &&
  exportHtml.indexOf('&lt;/script&gt;') !== -1);

// ── Rapport ─────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
}
if (errors.length) {
  console.log('\nErreurs console :');
  for (const e of errors) console.log('  ' + e);
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' points OK');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
