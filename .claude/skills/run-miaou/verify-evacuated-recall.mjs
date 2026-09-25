#!/usr/bin/env node
// Relecture d'un résultat d'outil ÉVACUÉ — le chaînon que rien ne couvrait.
//
// Motif, daté : le 2026-09-22, Julien teste l'évacuation en conversation réelle
// et demande au modèle de rappeler un résultat évacué. Le modèle patauge trois
// tours, se contredit, finit par re-télécharger l'URL, puis conclut à tort sur
// ses propres capacités. L'enquête a montré DEUX causes distinctes, et c'est
// leur superposition qui rendait le diagnostic difficile :
//   (a) un bug du serveur MCP web (corps gzip non décompressé) qui faisait
//       rendre du binaire à TOUS les chemins — corrigé côté miaou-mcp-servers,
//       hors périmètre d'ici ;
//   (b) MIAOU ne DISAIT nulle part qu'une ressource textuelle se relit en
//       clair. `RESOURCE_DOCTRINE` ne parle que de js__eval, et
//       `ATTACHMENT_DOCTRINE` n'annonçait `res_<id>` que pour REGARDER une
//       image. Exclusivité implicite : rien de faux, mais le cas texte
//       n'existait dans aucun texte permanent.
//
// Ce script tient (b) : le chemin fonctionne, ET il est annoncé. Les purs du
// lot AE vérifient l'évacuation (le contenu PART) ; `verify-compaction.mjs`
// vérifie les surfaces du geste. Aucun des deux ne vérifiait qu'on puisse le
// RELIRE — la moitié qui donne son sens à l'autre, et précisément celle qui a
// échoué en prod.
//
// Ce que ce script NE fait PAS : appeler un vrai modèle ou un vrai serveur MCP.
// Les handlers d'outils sont invoqués directement, ce qui est le chemin réel
// qu'emprunte une génération (`callTool`), sans la couche réseau.
//
// Usage : node verify-evacuated-recall.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
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

// `callTool` rend la forme MCP `{ content: [{type:'text', text}], isError }`,
// jamais une chaîne : un `String(out)` donnerait « [object Object] » et TOUS
// les contrôles de contenu passeraient au vert sur du vide. On lit le texte
// par la même voie que l'appelant réel.
const toolText = (out) => {
  if (out == null) return '';
  if (typeof out === 'string') return out;
  const parts = Array.isArray(out.content) ? out.content : [];
  return parts.filter(p => p && p.type === 'text').map(p => String(p.text || '')).join('\n');
};

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 10000 });

// ════════════════════════════════════════════════════════════════════════════
// 1. Un gros résultat d'outil, évacué, se relit EN CLAIR
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 1. Évacuer puis relire ──');

// Contenu ASCII et reconnaissable de bout en bout : c'est le témoin. Un
// contenu généré au hasard prouverait qu'on relit QUELQUE CHOSE ; celui-ci
// prouve qu'on relit CE résultat-là, celui qu'on a évacué.
const MARKER_HEAD = 'DEBUT-DU-RESULTAT-EVACUE';
const MARKER_TAIL = 'FIN-DU-RESULTAT-EVACUE';

const setup = await page.evaluate(async ({ head, tail }) => {
  await newConversation();
  // `ensureConversation()` : le geste réel sort sur `if (!currentConvId)
  // return null`, et `newConversation` remet justement cet id à null (la
  // conversation n'est créée qu'au premier envoi). Sans lui le geste rend
  // `null` en silence et les assertions accusent le code d'un défaut qui
  // appartient au montage — même piège que `verify-compaction.mjs`, qui le
  // documente au même endroit. Appelé AVANT de pousser : il réinitialise
  // `currentThread`.
  ensureConversation();
  const body = head + '\n' + 'contenu volumineux. '.repeat(600) + '\n' + tail;
  currentThread.push({ role: 'user', content: 'Va chercher cette page' });
  // Forme réelle d'un ack : une entrée `tool-ack` de PREMIER NIVEAU du thread,
  // jamais imbriquée dans un assistant — c'est sur celles-là qu'itère
  // `evacuableToolResults`, et le montage doit épouser le chemin réel sous
  // peine de rendre le défaut inatteignable.
  currentThread.push({
    role: 'tool-ack', name: 'web__fetch_url',
    args: { url: 'https://exemple.test/page' }, result: body,
  });
  await persistCurrent();
  // L'id call:… n'est pas stocké sur l'ack : il est DÉRIVÉ par
  // `enrichedAckGroups`, source unique partagée avec `findAckByCallId`. On le
  // lui demande donc, au lieu d'en inventer un qui ne résoudrait pas.
  const groups = enrichedAckGroups(currentThread);
  const callId = groups.length && groups[0].ids.length ? groups[0].ids[0] : '';
  return {
    convId: currentConvId,
    bodyLen: body.length,
    callId,
    // Témoin d'éligibilité : si le résultat n'était pas assez gros, tout le
    // reste du script passerait en n'évacuant rien (vacuité).
    eligible: evacuableToolResults(currentThread, TOOL_RESULT_EVACUATION_MIN_CHARS,
                                   isInlineHandleResult).count,
  };
}, { head: MARKER_HEAD, tail: MARKER_TAIL });

check('témoin : le résultat monté est éligible à l\'évacuation', setup.eligible === 1);
check('témoin : un id call:… est dérivable pour cet ack', !!setup.callId);

const evac = await page.evaluate(async () => {
  const res = await evacuateToolResults();
  const ack = currentThread.find(m => m.role === 'tool-ack');
  return {
    done: !!(res && res.done),
    result: ack ? String(ack.result) : '',
    // L'id tel que le modèle le lit dans son contexte, via le MÊME pur que le
    // refus de resource__from_result : si les deux divergeaient, le refus
    // nommerait une ressource que le modèle ne trouverait pas.
    idFromHandle: ack ? inlineHandleResourceId(ack.result) : '',
  };
});
check('le geste rend un bilan', evac.done);
check('le résultat est devenu un handle', /texte adressable par js__eval/.test(evac.result));
check('le corps volumineux a quitté le contexte', !evac.result.includes('contenu volumineux'));
check('un id res_… est extractible du handle', /^res_/.test(evac.idFromHandle));

// LE contrôle central : le contenu se relit en clair, entier, par le geste que
// les doctrines annoncent. C'est l'exacte question posée en prod.
const recalled = await page.evaluate(async (id) => {
  const out = await callTool('miaou__recall_attachment', { ref: id }, { convId: currentConvId });
  return { out };
}, evac.idFromHandle);
recalled.text = toolText(recalled.out);

check('recall_attachment rend du texte, pas un descripteur d\'échec',
  !/non lisible directement/.test(recalled.text));
check('le contenu relu porte le DÉBUT du résultat évacué',
  recalled.text.includes(MARKER_HEAD));
check('… et sa FIN (rien n\'a été tronqué en route)',
  recalled.text.includes(MARKER_TAIL));
// Le symptôme exact de la prod : des octets illisibles au lieu du texte. Le
// caractère de remplacement est ce qu'on voyait, il ne doit jamais reparaître.
check('aucun caractère de remplacement (symptôme du bug gzip)',
  !recalled.text.includes('�'));

// ════════════════════════════════════════════════════════════════════════════
// 2. Le refus de resource__from_result est ACTIONNABLE
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. Refus qui nomme la ressource ──');

// En prod le modèle a appelé `resource__from_result` sur un résultat DÉJÀ
// ressource. Le refus était vrai (« Ce résultat est déjà une ressource. ») mais
// ne disait pas LAQUELLE : deux tours perdus à la retrouver.
const refusal = await page.evaluate(async (callId) => {
  const out = await callTool('miaou__resource__from_result',
    { ref: callId, description: 'x', name: 'y.txt' }, { convId: currentConvId });
  return { out };
}, setup.callId);
refusal.text = toolText(refusal.out);

check('l\'appel est bien refusé (idempotence préservée)',
  /déjà la ressource|déjà une ressource/.test(refusal.text));
// `includes('')` est TOUJOURS vrai : sans la garde sur l'id, ce contrôle
// passerait au vert précisément quand l'extraction échoue — le cas qu'il est
// censé attraper (souvenir `green-check-proves-nothing`).
check('le refus NOMME la ressource',
  !!evac.idFromHandle && refusal.text.includes(evac.idFromHandle));
check('il dit comment en relire le contenu', /recall_attachment/.test(refusal.text));
check('et il nomme l\'autre usage, sans le confondre avec le premier',
  /js__eval/.test(refusal.text));

// ════════════════════════════════════════════════════════════════════════════
// 3. La capacité est ANNONCÉE dans le contexte permanent
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Ce que le modèle sait sans avoir à essayer ──');

// Un chemin qui marche mais que rien n'annonce reste inatteignable en pratique
// — c'est le défaut « capacité inatteignable » / « silence ». On interroge le
// message système RÉELLEMENT composé, jamais la constante : c'est ce que le
// modèle reçoit qui compte.
// `buildSystemMessage()` rend { role, content } — c'est `content` qui est le
// texte servi au modèle.
const sys = await page.evaluate(() => buildSystemMessage().content);
check('témoin : le message système est bien composé', sys.length > 500);
check('il annonce que recall_attachment accepte un handle res_…',
  /recall_attachment/.test(sys) && /res_<id>/.test(sys));
check('il dit qu\'une ressource TEXTUELLE se relit en clair',
  /ressource TEXTUELLE/.test(sys) && /en clair/.test(sys));
check('il relie explicitement ce geste au cas « résultat évacué »',
  /évacué/.test(sys));

// ── Bilan ───────────────────────────────────────────────────────────────────
if (consoleErrors.length) {
  console.log('\nErreurs console :');
  consoleErrors.forEach(e => console.log('  ' + e));
}
console.log('\n' + (failures.length ? `ÉCHECS (${failures.length}) :\n  - ` + failures.join('\n  - ')
                                    : 'Tout est vert.'));
await browser.close();
process.exit(failures.length ? 1 : 0);
