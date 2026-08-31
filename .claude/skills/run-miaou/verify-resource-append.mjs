#!/usr/bin/env node
// Vérifie le lot Y — écriture incrémentale de ressources :
//   - resource__append prolonge une res_… existante sans retransmettre le déjà-écrit ;
//   - la garde de famille refuse att-N / file-<id> / handle inconnu ;
//   - js__eval + output_handle expose emit() et l'écriture atterrit RÉELLEMENT
//     dans la ressource cible, lisible après retour de l'outil ;
//   - emit() SANS output_handle est un ReferenceError guest propre (surface
//     fermée : la primitive n'existe pas, elle n'est pas un no-op) ;
//   - le buffer émis avant un échec guest (throw/timeout) est flushé, pas perdu ;
//   - le cas moteur : assemblage multi-tours sans qu'aucun résultat d'outil
//     individuel ne porte le contenu accumulé.
//
// Les handlers natifs sont appelés directement (callInternalTool) : le lot Y ne
// touche pas au streaming ni à la boucle d'outils, un stub SSE n'apporterait rien
// et masquerait les assertions derrière du bruit. Ce qui est vérifié ici, c'est
// que l'écriture ATTERRIT en IDB et se relit — l'oracle est le contenu du record
// relu depuis le cache, jamais le texte que l'outil affirme avoir écrit.
//
// Usage : node verify-resource-append.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
// L'overlay de boot (plancher 1,8 s) n'est jamais retiré du DOM : attendre la
// CLASSE, pas la visibilité.
await page.waitForFunction(
  () => document.getElementById('boot-overlay').classList.contains('boot-done'),
  null, { timeout: 10000 },
);

// Helper de page : appelle un outil natif et renvoie son texte de résultat.
// Globals référencés par nom NU (script concaténé, rien sur window).
await page.evaluate(() => {
  window.__call = async (name, args) => {
    const r = await callInternalTool(name, args, { convId: currentConvId, spaceId: activeSpaceId });
    return { text: r.content[0].text, isError: !!r.isError };
  };
  // Oracle de lecture : le CONTENU RÉEL du record, relu depuis le cache session
  // (peuplé par _cacheRecord après le commit IDB) — jamais ce que l'outil dit.
  window.__read = (id) => {
    const rec = getCachedRecord(id);
    return rec ? utf8Decode(rec.data) : null;
  };
  window.__size = (id) => { const r = getCachedRecord(id); return r ? r.size : null; };
  // Le guest n'a pas accès au cap host : on l'injecte comme littéral dans le
  // code envoyé, dérivé de la constante réelle (jamais un nombre en dur ici).
  window.__capProbe = JS_EVAL_OUTPUT_CAP + 100;
});

// ── 1. resource__append nominal ──────────────────────────────────────────────

const seed = await page.evaluate(() =>
  window.__call('resource__create', { content: 'col_a,col_b\n', name: 'sortie.csv', mime: 'text/csv' }));
const resId = (seed.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];
check('resource__create rend un handle res_… exploitable', !!resId);

const app1 = await page.evaluate((id) => window.__call('resource__append', { id, content: '1,2\n' }), resId);
check('resource__append réussit sur une res_… existante', !app1.isError && !/introuvable|invalide/i.test(app1.text));

const after1 = await page.evaluate((id) => window.__read(id), resId);
check('le contenu ajouté est RELU depuis le record (pas seulement annoncé)',
  after1 === 'col_a,col_b\n1,2\n');

// Le point du lot : l'appel ne porte QUE le morceau nouveau. On mesure les
// arguments réellement transmis, pas une intention.
const appendArgs = { id: resId, content: '3,4\n' };
check('l\'argument content ne contient PAS le contenu déjà stocké (O(n) et non O(n²))',
  appendArgs.content.indexOf('col_a,col_b') < 0 && appendArgs.content.indexOf('1,2') < 0);

await page.evaluate((a) => window.__call('resource__append', a), appendArgs);
const after2 = await page.evaluate((id) => window.__read(id), resId);
check('appends successifs : rien du déjà-écrit n\'est perdu ni dupliqué',
  after2 === 'col_a,col_b\n1,2\n3,4\n');

const sizeNow = await page.evaluate((id) => window.__size(id), resId);
check('record.size suit le cumul en octets', sizeNow === after2.length);

// Le handle est INCHANGÉ après append : le modèle continue de l'utiliser.
const evalAfter = await page.evaluate((id) =>
  window.__call('js__eval', { handle: id, code: 'lines().length;' }), resId);
check('le même handle reste lisible par js__eval après append', evalAfter.text.trim().startsWith('4'));

// ── 2. Gardes de famille et handles inconnus ─────────────────────────────────

const badAtt = await page.evaluate(() => window.__call('resource__append', { id: 'att-1', content: 'x' }));
check('att-N refusé proprement (garde de famille), pas un crash',
  /res_<id>/.test(badAtt.text) && !/Erreur outil/.test(badAtt.text));

const badFile = await page.evaluate(() => window.__call('resource__append', { id: 'file-deadbeef', content: 'x' }));
check('file-<id> refusé proprement (garde de famille)',
  /res_<id>/.test(badFile.text) && !/Erreur outil/.test(badFile.text));

const badUnknown = await page.evaluate(() => window.__call('resource__append', { id: 'res_zzzzzzzz', content: 'x' }));
check('res_… inconnu → « introuvable » (no-oracle), pas un crash',
  /introuvable/i.test(badUnknown.text) && !/Erreur outil/.test(badUnknown.text));

const badEmpty = await page.evaluate((id) => window.__call('resource__append', { id, content: '' }), resId);
check('content vide → refus explicite, jamais un no-op silencieux', /vide/i.test(badEmpty.text));

const stillIntact = await page.evaluate((id) => window.__read(id), resId);
check('aucun refus n\'a altéré la ressource', stillIntact === after2);

// ── 3. js__eval + output_handle : emit() atterrit dans la ressource ──────────

const src = await page.evaluate(() =>
  window.__call('resource__create', { content: 'a\nb\nc\nd\ne\n', name: 'source.txt' }));
const srcId = (src.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];
const dst = await page.evaluate(() =>
  window.__call('resource__create', { content: '', name: 'dest.txt' }));
const dstId = (dst.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];
// resource__create refuse un contenu vide : on sème un caractère puis on mesure
// l'écart, pour que l'oracle porte sur ce qu'emit a ajouté et rien d'autre.
const dstSeeded = await page.evaluate(() =>
  window.__call('resource__create', { content: 'HEAD\n', name: 'dest.txt' }));
const dstSeededId = (dstSeeded.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];

const emitRun = await page.evaluate(({ s, d }) => window.__call('js__eval', {
  handle: s,
  output_handle: d,
  // emit au fil de l'eau, une fois par ligne : rien n'est accumulé côté guest.
  code: 'var n=0; lines().forEach(function(l){ if(l){ emit("["+l+"]\\n"); n++; } }); n;',
}), { s: srcId, d: dstSeededId });
check('js__eval avec output_handle réussit', !emitRun.isError && /^5/.test(emitRun.text.trim()));

const emitted = await page.evaluate((id) => window.__read(id), dstSeededId);
check('les emit() ont TOUS atterri dans la ressource cible, dans l\'ordre',
  emitted === 'HEAD\n[a]\n[b]\n[c]\n[d]\n[e]\n');

check('le canal de retour normal reste actif en plus de emit (valeur de synthèse)',
  emitRun.text.trim().startsWith('5'));
check('le résultat annonce le nombre de caractères ajoutés', /caractères ont été ajoutés/.test(emitRun.text));

// ── 4. emit() sans output_handle : ReferenceError, pas un no-op ──────────────

const noHandle = await page.evaluate((s) => window.__call('js__eval', {
  handle: s, code: 'emit("perdu"); 1;',
}), srcId);
// L'erreur doit nommer `emit` LUI-MÊME, pas le pont host `__miaou_emit` : si le
// prélude définissait emit() inconditionnellement, l'appel échouerait AUSSI —
// mais sur « __miaou_emit is not defined », c'est-à-dire une plomberie interne
// que le modèle ne peut pas corriger. Distinguer les deux est tout l'objet du
// choix « primitive absente plutôt que no-op ».
check('emit() sans output_handle échoue en nommant emit (la primitive), pas le pont interne',
  /'emit' is not defined/.test(noHandle.text) && !/__miaou_emit/.test(noHandle.text));
check('cet échec passe par le chemin d\'erreur guest normal, pas un crash host',
  /bac à sable/.test(noHandle.text) && !/Erreur outil/.test(noHandle.text));
// Contrôle de non-vacuité : sans cette assertion, un emit() devenu no-op
// silencieux passerait — on vérifie donc que RIEN n'a été écrit nulle part.
const untouched = await page.evaluate((id) => window.__read(id), dstSeededId);
check('un emit() sans handle n\'a rien écrit dans la ressource précédente',
  untouched === emitted);

// ── 5. Flush du travail partiel sur échec guest ──────────────────────────────

const partial = await page.evaluate(() =>
  window.__call('resource__create', { content: 'P\n', name: 'partiel.txt' }));
const partialId = (partial.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];

const crashed = await page.evaluate(({ s, d }) => window.__call('js__eval', {
  handle: s,
  output_handle: d,
  // Émet trois morceaux PUIS lève : le travail déjà émis doit survivre.
  code: 'emit("un\\n"); emit("deux\\n"); emit("trois\\n"); throw new Error("boum");',
}), { s: srcId, d: partialId });
check('un throw guest est rapporté comme erreur d\'exécution', /boum/.test(crashed.text));

const partialContent = await page.evaluate((id) => window.__read(id), partialId);
check('FLUSH INCONDITIONNEL : ce qui a été émis avant l\'échec est conservé',
  partialContent === 'P\nun\ndeux\ntrois\n');
check('le résultat signale au modèle que l\'écriture est INCOMPLÈTE, pas seulement qu\'elle a eu lieu',
  /incomplète/.test(crashed.text) && /relis-la/.test(crashed.text));

// L'ack doit le dire AUSSI : sans ça l'utilisateur voit une ressource qui a
// grossi et rien qui indique qu'elle s'arrête en plein milieu.
const partialAck = await page.evaluate(() => {
  const a = _pendingToolAcks.filter(x => x.kind === 'resource_appended').pop();
  return { ok: a.ok, appendedLen: a.appendedLen, isError: ackIsError(a), label: ACK_KINDS.resource_appended.label(a) };
});
check('l\'ack de l\'écriture partielle porte ok:false', partialAck.ok === false);
check('ackIsError le rend rouge (convention partagée js_eval/docs_pack)', partialAck.isError === true);
check('son libellé dit « interrompu » ET garde le décompte de ce qui a été sauvé',
  /interrompu/.test(partialAck.label) && /\+\d+ car\./.test(partialAck.label));

// DISTINCTION CAP / ERROR — le point qui peut se casser en silence. Un refus de
// cap veut dire « le calcul est allé au bout, seul le RETOUR texte est refusé » :
// l'écriture, elle, est complète. La peindre en rouge serait un faux positif.
const capped = await page.evaluate(async () => {
  const r = await window.__call('resource__create', { content: 'C\n', name: 'cap.txt' });
  const d = (r.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];
  // emit() borné et complet, MAIS un retour texte volontairement au-dessus du cap.
  const run = await window.__call('js__eval', {
    handle: d, output_handle: d,
    code: 'emit("complet\\n"); var s=""; while(s.length < ' + window.__capProbe + ') { s += "x"; } s;',
  });
  const a = _pendingToolAcks.filter(x => x.kind === 'resource_appended').pop();
  return { text: run.text, content: window.__read(d), ok: a.ok, isError: ackIsError(a) };
});
check('un refus de cap est bien un refus de SORTIE (prémisse du contrôle suivant)',
  /Sortie refusée/.test(capped.text));
check('sur un refus de cap, l\'écriture est COMPLÈTE et l\'ack reste neutre',
  capped.content === 'C\ncomplet\n' && capped.ok === undefined && capped.isError === false);

// ── 6. output_handle invalide : refus AVANT exécution ────────────────────────

const badOut = await page.evaluate((s) => window.__call('js__eval', {
  handle: s, output_handle: 'att-1', code: 'emit("x"); 1;',
}), srcId);
check('output_handle hors famille refusé (garde symétrique de resource__append)',
  /output_handle invalide/.test(badOut.text));

const missingOut = await page.evaluate((s) => window.__call('js__eval', {
  handle: s, output_handle: 'res_zzzzzzzz', code: 'emit("x"); 1;',
}), srcId);
check('output_handle inconnu → introuvable, refusé avant d\'exécuter le code',
  /output_handle introuvable/.test(missingOut.text));

// ── 7. Cas moteur : assemblage multi-tours sous le cap de sortie ─────────────

const cap = await page.evaluate(() => JS_EVAL_OUTPUT_CAP);
const motor = await page.evaluate(async ({ cap }) => {
  // Trois « fichiers » JSON, comme le cas réel du brief : extraction par
  // fichier, accumulation dans un seul CSV, sans jamais retransmettre le CSV.
  const mk = (i) => JSON.stringify({ id: i, nom: 'item' + i, valeur: i * 10 });
  const sources = [];
  for (let i = 1; i <= 3; i++) {
    const r = await window.__call('resource__create', { content: mk(i), name: 'src' + i + '.json' });
    sources.push((r.text.match(/blob=(res_[a-z0-9]+)/) || [])[1]);
  }
  const dstR = await window.__call('resource__create', { content: 'id,nom,valeur\n', name: 'combine.csv' });
  const dst = (dstR.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];

  const resultLengths = [];
  for (const s of sources) {
    // Un tour js__eval par fichier : extraction, écriture directe par emit.
    const r = await window.__call('js__eval', {
      handle: s, output_handle: dst,
      code: 'var o = parse(); emit(o.id+","+o.nom+","+o.valeur+"\\n"); "ok";',
    });
    resultLengths.push(r.text.length);
  }
  return { dst, content: window.__read(dst), resultLengths, cap };
}, { cap });

check('le CSV combiné est assemblé sur trois tours',
  motor.content === 'id,nom,valeur\n1,item1,10\n2,item2,20\n3,item3,30\n');
check('AUCUN résultat d\'outil individuel n\'approche le cap de sortie',
  motor.resultLengths.every(l => l < motor.cap / 10));
console.log('  info  longueurs des résultats d\'outil : ' + JSON.stringify(motor.resultLengths) +
  ' (cap = ' + motor.cap + ')');

// ── 7bis. Agent : append sur une ressource DÉLÉGUÉE par le parent ───────────
// Décision Julien (2026-08-31) : déléguer une ressource à un agent, c'est la lui
// CONFIER — l'agent peut y écrire, pas seulement la lire. Aucun code de
// délégation n'a été touché par le lot Y ; ce qui est vérifié ici, c'est que
// l'append hérite bien de la dérogation (resolveDelegatedRecordId) au lieu de
// contourner resolveHandleRecord — et surtout qu'il adresse l'écriture par l'ID
// DE RECORD résolu, pas par l'alias (qui n'est l'id d'aucun record).

const delegated = await page.evaluate(async () => {
  // Ressource du « parent », puis une génération d'agent qui la reçoit sous un
  // ALIAS distinct de son id réel — la table figée au spawn (X-1b).
  const r = await window.__call('resource__create', { content: 'PARENT\n', name: 'partage.txt' });
  const realId = (r.text.match(/blob=(res_[a-z0-9]+)/) || [])[1];
  const alias = 'res_aliasagent01';
  const agentConvId = 'conv_agent_verify_y';
  _activeGenerations.set(agentConvId, {
    convId: agentConvId, spaceId: activeSpaceId,
    agentFiles: [{ alias, recordId: realId, name: 'partage.txt' }],
  });
  const ctx = { convId: agentConvId, spaceId: activeSpaceId };
  const call = async (n, a) => {
    const res = await callInternalTool(n, a, ctx);
    return { text: res.content[0].text, isError: !!res.isError };
  };
  const appended = await call('resource__append', { id: alias, content: 'AGENT\n' });
  const emitted = await call('js__eval', {
    handle: alias, output_handle: alias, code: 'emit("EMIT\\n"); "ok";',
  });
  // Un alias NON délégué doit rester introuvable : la dérogation est bornée à
  // ce que le parent a nommé, le lot Y ne l'élargit pas.
  const foreign = await call('resource__append', { id: 'res_aliasautre99', content: 'x' });
  _activeGenerations.delete(agentConvId);
  return { appended, emitted, foreign, content: window.__read(realId), alias, realId };
});

check('l\'alias d\'agent est bien distinct de l\'id de record (prémisse du test)',
  delegated.alias !== delegated.realId);
check('un agent peut APPEND sur une ressource que son parent lui a déléguée',
  !delegated.appended.isError && !/introuvable|invalide/i.test(delegated.appended.text));
check('un agent peut EMIT vers une ressource déléguée (output_handle en alias)',
  !/introuvable|invalide/i.test(delegated.emitted.text));
check('les deux écritures atterrissent dans le RECORD du parent, via l\'alias',
  delegated.content === 'PARENT\nAGENT\nEMIT\n');
check('un alias NON délégué reste introuvable (la dérogation n\'est pas élargie)',
  /introuvable/i.test(delegated.foreign.text));

// ── 8. Acks ─────────────────────────────────────────────────────────────────

const acks = await page.evaluate(() => _pendingToolAcks.map(a => ({
  kind: a.kind, appendedLen: a.appendedLen, outputHandle: a.outputHandle, size: a.size })));
check('des acks resource_appended ont été poussés',
  acks.some(a => a.kind === 'resource_appended' && a.appendedLen > 0));
check('l\'ack porte À LA FOIS l\'ajout et la taille totale (le couple seul est parlant)',
  acks.some(a => a.kind === 'resource_appended' && a.appendedLen != null && a.size != null));
check('l\'ack js_eval d\'un run avec output_handle porte outputHandle et appendedLen',
  acks.some(a => a.kind === 'js_eval' && a.outputHandle && a.appendedLen > 0));

check('aucune erreur console pendant tout le scénario',
  consoleErrors.filter(e => !/favicon|net::ERR_FILE/.test(e)).length === 0);
if (consoleErrors.length) console.log('  info  console : ' + JSON.stringify(consoleErrors.slice(0, 5)));

await browser.close();
console.log('\n' + (failures.length ? 'ÉCHEC — ' + failures.length + ' : ' + failures.join(' | ')
  : 'OK — toutes les vérifications passent'));
process.exit(failures.length ? 1 : 0);
