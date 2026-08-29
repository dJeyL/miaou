#!/usr/bin/env node
// Vérifie le lot V-8 sur le bundle réel : les numéros de page du sommaire
// (chantier A) et le rendu image d'une page de PDF (chantier B).
//
// Ce que les tests QuickJS ne peuvent PAS couvrir et qui est vérifié ici :
//   - listPdfDocument résout réellement les destinations pdf.js (les tests purs
//     ne voient que formatPdfListing, à qui on donne déjà des numéros) ;
//   - la dégradation PAR ENTRÉE sur une destination non résoluble ;
//   - le handler docs__render_page de bout en bout (réservation d'attId,
//     stockage IDB, ack, injection d'image du tour courant) ;
//   - LA PERSISTANCE : après reload, le thread ré-émet l'image via
//     resolveRecallImages + expandThread (moitié B du chemin image, piège 19).
//     C'est le contrôle qui vaut le plus — aucun test unitaire ne l'atteint.
//   - la non-régression du recall_attachment, qui partage le kind d'ack ;
//   - la RÉENTRANCE du compteur d'attId sur ses deux fronts : outil ↔ outil
//     (deux rendus concurrents) et composer ↔ outil (une pièce jointe déposée
//     pendant un rendu). Le second n'est vérifiable qu'ici : il demande deux
//     chemins asynchrones réels entrelacés.
//
// Usage : node verify-v8-pdf.mjs [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const fxDir = path.join(repoRoot, 'untracked/test-files');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};
const fx = (n) => {
  try { return Array.from(fs.readFileSync(path.join(fxDir, n))); } catch { return null; }
};

// Fixtures non versionnées (untracked/) : le verify doit tourner sans elles en
// disant ce qu'il n'a pas pu vérifier, jamais échouer sur leur absence.
const FIX = ['test.pdf', 'big-toc.pdf', 'named-dest-toc.pdf', 'scanned2.pdf'];
const missing = FIX.filter((n) => fx(n) === null);
if (missing.length) {
  console.log('  SKIP  fixtures absentes : ' + missing.join(', '));
  console.log('        (big-toc.pdf et named-dest-toc.pdf se regénèrent :');
  console.log('         spike-v8-fixtures/gen-big-toc.py et gen-named-dest-toc.py)');
}

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
// Overlay de boot : attendre la CLASSE, pas la visibilité (cf. verify-boot-overlay).
await page.waitForFunction(
  () => document.getElementById('boot-overlay').classList.contains('boot-done'),
  null, { timeout: 10000 },
);

// ── Chantier A : les numéros de page du sommaire ─────────────────────────────
console.log('\nChantier A — sommaire numéroté');

async function listing(name) {
  const bytes = fx(name);
  if (!bytes) return null;
  return page.evaluate(async ({ bytes, name }) => {
    const u8 = new Uint8Array(bytes);
    const rec = { id: 'v8', name, mime: 'application/pdf', size: u8.length, data: u8.buffer };
    const t0 = performance.now();
    const s = await listPdfDocument(u8, rec, 'att-1');
    return { ms: performance.now() - t0, s: String(s) };
  }, { bytes, name });
}

const lTest = await listing('test.pdf');
if (lTest) {
  const toc = lTest.s.split('\n').filter((l) => l.trim().startsWith('-'));
  check('test.pdf : toutes les entrées de sommaire portent leur page',
    toc.length > 0 && toc.every((l) => /p\.\d+/.test(l)),
    `${toc.length} entrées`);
  check('test.pdf : aucun « p.0 » ni « p.NaN »',
    !/p\.0\b/.test(lTest.s) && !/NaN/.test(lTest.s));
}

const lBig = await listing('big-toc.pdf');
if (lBig) {
  const toc = lBig.s.split('\n').filter((l) => l.trim().startsWith('-'));
  const numbered = toc.filter((l) => /p\.\d+/.test(l)).length;
  check('big-toc.pdf : 372 entrées, toutes numérotées',
    toc.length === 372 && numbered === 372, `${numbered}/${toc.length}`);
  // La mesure du spike : ~1,4 ms de résolution. Le seuil est LARGE (le listing
  // inclut l'ouverture du document) : il garde contre une régression en
  // séquentiel sur un gros sommaire, pas contre une variation de machine.
  check('big-toc.pdf : le listing reste sous 3 s malgré 372 résolutions',
    lBig.ms < 3000, `${lBig.ms.toFixed(0)} ms`);
  check('big-toc.pdf : l\'indentation hiérarchique est conservée',
    /\n {4}- p\.\d+ 1\.1\.1 /.test(lBig.s));
}

const lNamed = await listing('named-dest-toc.pdf');
if (lNamed) {
  const toc = lNamed.s.split('\n').filter((l) => l.trim().startsWith('-'));
  const numbered = toc.filter((l) => /p\.\d+/.test(l)).length;
  // LE contrôle de dégradation : destinations NOMMÉES, dont 2 pointant vers un
  // nom absent de l'arbre /Names. Les 4 autres doivent se résoudre.
  check('named-dest-toc.pdf : destinations nommées résolues (4 sur 6)',
    toc.length === 6 && numbered === 4, `${numbered}/${toc.length}`);
  check('named-dest-toc.pdf : l\'entrée non résoluble GARDE SON TITRE',
    /- Section 3 \(destination absente\)/.test(lNamed.s));
  check('named-dest-toc.pdf : elle n\'hérite pas d\'un faux numéro',
    !/p\.\d+ Section 3/.test(lNamed.s) && !/p\.0/.test(lNamed.s));
}

// ── Chantier B : le rendu image ──────────────────────────────────────────────
console.log('\nChantier B — rendu image');

// Handler RÉEL via callTool, avec un ctx explicite (piège 28) : c'est le chemin
// que le modèle emprunte, pas une fonction interne appelée à la main.
const rendered = await page.evaluate(async ({ bytes }) => {
  // Une conversation réelle, pour que reserveAttIdFor ait une cible.
  ensureConversation();
  const convId = currentConvId;
  const u8 = new Uint8Array(bytes);
  // Les PDF SOURCES des fixtures portent des attId hors de la trajectoire du
  // compteur (att-90+), jamais att-1/att-7/att-9 : les sections partagent une
  // conversation, et les rendus successifs font monter le compteur jusqu'à
  // réutiliser ces numéros. Deux records sous le même attId, et
  // getCachedRecordByAttId — qui rend le PREMIER trouvé — devient dépendant de
  // l'ordre d'itération du cache : contrôles intermittents, et un « format
  // inconnu » qui accuse le code alors que c'est la fixture qui collisionne.
  const rec = await storeAttachment('att-91', 'application/pdf', 'test.pdf',
    u8.buffer, 'binary', convId, Date.now(), Math.random);
  clearPendingToolAcks();
  clearPendingImageInjections();
  const before = (loadConversation(convId) || {}).attSeq || 0;
  // callTool rend la forme MCP { content: [{ text }], isError }, pas une chaîne
  // nue — et une Promise pour les handlers async, d'où l'await.
  const res = await callTool('miaou__docs__render_page', { ref: 'att-91', page: 2 },
    { convId, spaceId: activeSpaceId });
  const resText = String((res && res.content && res.content[0] && res.content[0].text) || res);
  const acks = getPendingToolAcks();
  const inj = getPendingImageInjections();
  const after = (loadConversation(convId) || {}).attSeq || 0;
  return {
    convId, result: resText, resIsError: !!(res && res.isError), acks, before, after,
    injCount: inj.length,
    injAttId: inj[0] && inj[0].attId,
    injIsImage: !!(inj[0] && /^data:image\/png;base64,/.test(inj[0].dataUrl)),
    injBytes: inj[0] ? inj[0].dataUrl.length : 0,
    pdfRecOk: !!rec,
  };
}, { bytes: fx('test.pdf') });

check('docs__render_page : le result ANNONCE l\'image sans la porter',
  /rendue en image/.test(rendered.result) && !/base64/.test(rendered.result),
  rendered.result.slice(0, 80));
// Le result est le DERNIER texte que le modèle lit avant de recevoir les pixels.
// Il disait « affichée à l'utilisateur » : un modèle de test en a conclu que
// c'était Julien qui avait la vision, et a failli s'abstenir. Il désigne
// désormais le modèle comme destinataire.
check('le result désigne le MODÈLE comme destinataire de l\'image',
  /te la montre/.test(rendered.result) &&
  !/affichée à l'utilisateur/.test(rendered.result), rendered.result.slice(0, 90));
// Un rendu réussi n'est pas une erreur d'outil : la boucle doit continuer.
check('docs__render_page : succès non-isError', rendered.resIsError === false);
check('docs__render_page : un ack attachment_recalled est poussé',
  rendered.acks.length === 1 && rendered.acks[0].kind === 'attachment_recalled');
check('l\'ack porte origin=docs_render (aiguillage d\'affichage)',
  rendered.acks[0] && rendered.acks[0].origin === 'docs_render');
check('l\'ack porte sourceName et selector (d\'où se déduit le libellé)',
  rendered.acks[0] && rendered.acks[0].sourceName === 'test.pdf' &&
  rendered.acks[0].selector === '2');
check('les pixels partent par le registre d\'injections du tour courant',
  rendered.injCount === 1 && rendered.injIsImage,
  `${(rendered.injBytes / 1024 / 1024).toFixed(2)} Mo`);
check('l\'injection cible le même attId que l\'ack',
  rendered.injAttId === (rendered.acks[0] && rendered.acks[0].attId),
  rendered.injAttId);
// Le compteur est RÉSERVÉ avant l'await (réentrance) et persisté sur la conv.
check('le compteur attId de la conversation a été persisté',
  rendered.after === rendered.before + 1,
  `${rendered.before} → ${rendered.after}`);

// Contrôle négatif de réentrance : deux rendus CONCURRENTS ne collisionnent pas.
const concurrent = await page.evaluate(async ({ bytes }) => {
  ensureConversation();
  const convId = currentConvId;
  const u8 = new Uint8Array(bytes);
  await storeAttachment('att-92', 'application/pdf', 'test.pdf', u8.buffer, 'binary',
    convId, Date.now(), Math.random);
  clearPendingToolAcks();
  clearPendingImageInjections();
  const ctx = { convId, spaceId: activeSpaceId };
  // Lancés SANS await intermédiaire : c'est la fenêtre que le composer ferme
  // par séquentialisation et que deux générations parallèles n'ont pas.
  await Promise.all([
    callTool('miaou__docs__render_page', { ref: 'att-92', page: 1 }, ctx),
    callTool('miaou__docs__render_page', { ref: 'att-92', page: 3 }, ctx),
  ]);
  const ids = getPendingToolAcks().map((a) => a.attId);
  return { ids, unique: new Set(ids).size };
}, { bytes: fx('test.pdf') });
check('deux rendus concurrents obtiennent des attId DISTINCTS',
  concurrent.ids.length === 2 && concurrent.unique === 2, concurrent.ids.join(' / '));

// Contrôle de réentrance COMPOSER ↔ OUTIL — la moitié que le contrôle
// ci-dessus ne voit pas. Le composer allouait avant son await et persistait
// après ; deux générations ne sont sérialisées ni entre elles ni avec lui, donc
// une pièce jointe déposée pendant un rendu écrasait le compteur et le rendu
// suivant réutilisait un att-N déjà pris. getCachedRecordByAttId rendant le
// PREMIER record trouvé, la ré-injection cross-turn et le bouton de
// téléchargement auraient servi la mauvaise image — sans erreur, sans perte de
// données. Depuis, les deux passent par reserveAttIdFor : un allocateur, un ordre.
//
// La fenêtre est reproduite pour de vrai : ingestAttachmentFile est lancée SANS
// await (elle bloque sur downscaleImageFile + arrayBuffer), et le rendu part
// pendant ce temps. C'est exactement l'entrelacement que l'ancien ordre
// perdait.
const composerRace = await page.evaluate(async ({ bytes }) => {
  ensureConversation();
  const convId = currentConvId;
  const u8 = new Uint8Array(bytes);
  // Le PDF source porte un attId HORS de la trajectoire du compteur (qui en est
  // à att-3 ici) : le poser sur un numéro que les réservations suivantes vont
  // atteindre fabriquerait la collision qu'on prétend mesurer, et le contrôle
  // échouerait sur sa propre fixture.
  await storeAttachment('att-90', 'application/pdf', 'test.pdf', u8.buffer, 'binary',
    convId, Date.now(), Math.random);
  clearPendingToolAcks();
  clearPendingImageInjections();
  const before = (loadConversation(convId) || {}).attSeq || 0;

  // Un vrai PNG 1x1 dans un File : le composer le classe 'image' et part sur
  // son chemin le plus long (downscale), celui qui ouvre la fenêtre.
  const png = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ), c => c.charCodeAt(0));
  const file = new File([png], 'photo.png', { type: 'image/png' });

  const ingest = ingestAttachmentFile(file);            // PAS d'await : on garde la main
  const rend = callTool('miaou__docs__render_page', { ref: 'att-90', page: 1 },
    { convId, spaceId: activeSpaceId });
  const [att, res] = await Promise.all([ingest, rend]);

  const ack = getPendingToolAcks().find(a => a.origin === 'docs_render');
  const after = (loadConversation(convId) || {}).attSeq || 0;
  // Le témoin qui compte : deux records distincts, chacun retrouvé par SON attId.
  const byComposer = att ? getCachedRecordByAttId(att.attId, convId) : null;
  const byRender = ack ? getCachedRecordByAttId(ack.attId, convId) : null;
  return {
    composerAttId: att && att.attId, renderAttId: ack && ack.attId,
    before, after,
    resIsError: !!(res && res.isError),
    composerMime: byComposer && byComposer.mime,
    renderMime: byRender && byRender.mime,
    composerName: byComposer && byComposer.name,
    renderName: byRender && byRender.name,
  };
}, { bytes: fx('test.pdf') });

check('composer et outil obtiennent des attId DISTINCTS',
  !!composerRace.composerAttId && !!composerRace.renderAttId &&
  composerRace.composerAttId !== composerRace.renderAttId,
  `composer ${composerRace.composerAttId} / rendu ${composerRace.renderAttId}`);
// Le compteur avance de DEUX : aucune des deux écritures n'a écrasé l'autre.
check('le compteur a été incrémenté une fois par allocation',
  composerRace.after === composerRace.before + 2,
  `${composerRace.before} → ${composerRace.after}`);
// Le vrai symptôme qu'on prévient : sur collision, le lookup par attId aurait
// rendu le même record aux deux — donc la mauvaise image à l'un des deux.
check('chaque attId retrouve SON record, pas celui de l\'autre',
  composerRace.composerMime === 'image/png' && composerRace.renderMime === 'image/png' &&
  composerRace.composerName === 'photo.png' && composerRace.renderName === 'test-p1.png',
  `${composerRace.composerName} / ${composerRace.renderName}`);
check('le rendu concurrent reste un succès', composerRace.resIsError === false);

// Refus métier : un document qui n'est pas un PDF.
const notPdf = await page.evaluate(async () => {
  ensureConversation();
  const convId = currentConvId;
  const data = new TextEncoder().encode('PK pas un pdf');
  await storeAttachment('att-93', 'application/zip', 'archive.zip', data.buffer,
    'binary', convId, Date.now(), Math.random);
  clearPendingToolAcks();
  const r = await callTool('miaou__docs__render_page', { ref: 'att-93', page: 1 },
    { convId, spaceId: activeSpaceId });
  return String((r && r.content && r.content[0] && r.content[0].text) || r);
});
check('un non-PDF est refusé en nommant la voie qui existe',
  /Seul un PDF/.test(notPdf) && /docs__list/.test(notPdf), notPdf.slice(0, 90));

// ── La persistance : l'image revient après reload ────────────────────────────
console.log('\nPersistance — l\'image survit au reload');

// On matérialise le thread comme le ferait onFinal, puis on recharge la page :
// c'est la moitié B du chemin image (resolveRecallImages + expandThread) qui
// doit ré-émettre les pixels depuis le seul attId persisté.
const persisted = await page.evaluate(async ({ convId }) => {
  const conv = loadConversation(convId);
  const ack = { role: 'tool-ack', kind: 'attachment_recalled', origin: 'docs_render',
    attId: 'att-2', resourceName: 'test-p2.png', sourceName: 'test.pdf',
    selector: '2', mime: 'image/png', convId,
    name: 'miaou__docs__render_page', args: { ref: 'att-91', page: 2 },
    result: 'Page 2 rendue.', ts: Date.now() };
  conv.messages = [{ role: 'user', content: 'Montre-moi la page 2.' }, ack];
  saveConversation(conv);
  return { saved: loadConversation(convId).messages.length };
}, { convId: rendered.convId });
check('le thread avec l\'ack de rendu est persisté', persisted.saved === 2);

await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(
  () => document.getElementById('boot-overlay').classList.contains('boot-done'),
  null, { timeout: 10000 },
);

const afterReload = await page.evaluate(async ({ convId }) => {
  await openConversation(convId);
  // Le chemin exact de dispatchSend : refs → recall images → expansion.
  const msgs = expandThread(resolveRecallImages(resolveResourceRefs(currentThread)));
  const withImage = msgs.filter((m) => Array.isArray(m.content) &&
    m.content.some((p) => p.type === 'image_url'));
  const ackNode = document.querySelector('.tool-ack');
  return {
    total: msgs.length,
    imageMsgs: withImage.length,
    synthetic: withImage.every((m) => m._synthetic === true),
    dataUrlOk: withImage[0] && /^data:image\/png;base64,/.test(
      withImage[0].content.find((p) => p.type === 'image_url').image_url.url),
    ackText: ackNode ? ackNode.textContent.trim() : null,
    ackHtml: ackNode ? ackNode.innerHTML : '',
  };
}, { convId: rendered.convId });

check('après reload, l\'image est RÉ-ÉMISE dans le payload',
  afterReload.imageMsgs === 1, `${afterReload.imageMsgs} message(s) porteur(s)`);
check('elle passe par un message user SYNTHÉTIQUE (piège 19)',
  afterReload.synthetic === true);
check('la dataUrl est reconstruite depuis le record figé',
  afterReload.dataUrlOk === true);
// textContent inclut le niveau 2 même replié : ce contrôle vaut pour la
// DÉRIVATION du libellé, pas pour sa visibilité (celle-ci est contrôlée plus bas
// avec l'intention, où les deux niveaux sont distingués).
check('l\'ack rendu dérive son libellé après reload',
  /Page 2 rendue en image/.test(afterReload.ackText || '') &&
  /test\.pdf/.test(afterReload.ackText || ''), afterReload.ackText);
check('l\'ack rendu porte l\'icône image, pas l\'œil',
  afterReload.ackHtml.includes('<rect') &&
  !afterReload.ackHtml.includes('<circle cx="12" cy="12" r="3"'));

// ── La page rendue n'est affichée sur AUCUNE des deux surfaces ───────────────
// Une page rendue est une donnée de TRAVAIL du modèle : l'utilisateur a déjà le
// document source. L'ack et son bouton de téléchargement suffisent. Le prédicat
// est UNIQUE (ackImageIsDisplayable) — un contrôle par surface, plus un
// contre-exemple qui garde la voie web inchangée.
console.log('\nAffichage — la page rendue reste dans l\'ack seul');

const exported = await page.evaluate(async ({ convId }) => {
  const conv = loadConversation(convId);
  // Un assistant après l'ack : renderExportBody n'émet les acks bufferisés que
  // dans la bulle assistant qu'ils ont nourrie (même motif que renderThread).
  const msgs = conv.messages.concat([{ role: 'assistant', content: 'Voici la page.' }]);
  const html = await renderExportBody(msgs, convId);
  renderThread(msgs);
  const ackNode = document.querySelector('#thread .tool-ack');
  return {
    hasImg: /tool-block-img/.test(html),
    hasAck: /Page 2 rendue en image/.test(html) || /docs__render_page/.test(html),
    bytes: html.length,
    liveHasImg: !!document.querySelector('#thread img.tool-block-img'),
    liveHasAck: !!ackNode && /Page 2 rendue en image/.test(ackNode.textContent),
    liveHasDownload: !!(ackNode && ackNode.querySelector('.ack-dl, [class*="download"], button[title*="élécharg"]')),
  };
}, { convId: rendered.convId });

check('l\'export ne porte AUCUNE image de page rendue',
  exported.hasImg === false);
check('l\'écran non plus', exported.liveHasImg === false);
check('mais la trace de l\'appel est là, des deux côtés',
  exported.hasAck === true && exported.liveHasAck === true);
check('et l\'ack à l\'écran offre le téléchargement de la page',
  exported.liveHasDownload === true);
check('le corps exporté reste léger (pas de base64 de page)',
  exported.bytes < 50000, `${exported.bytes} caractères`);

// Contre-exemple : la voie que ce changement ne doit PAS toucher — une image que
// le modèle est allé chercher sur le web à la demande de l'utilisateur.
const webImg = await page.evaluate(async ({ convId }) => {
  // 1x1 PNG transparent
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const id = await _storeBlock('image/png', 'trouvee.png', u8.buffer, 'binary',
    convId, Date.now(), Math.random);
  const ack = { role: 'tool-ack', kind: 'resource_presented', id,
    resourceName: 'trouvee.png', mime: 'image/png', convId,
    name: 'miaou__resource__present', args: { id }, result: 'ok', ts: Date.now() };
  const msgs = [{ role: 'user', content: 'Montre cette image.' }, ack,
    { role: 'assistant', content: 'La voici.' }];
  const html = await renderExportBody(msgs, convId);
  renderThread(msgs);
  return {
    live: !!document.querySelector('#thread img.tool-block-img'),
    exported: /tool-block-img/.test(html),
  };
}, { convId: rendered.convId });

check('une image RAPPORTÉE par le modèle reste affichée à l\'écran',
  webImg.live === true);
check('et reste embarquée dans l\'export', webImg.exported === true);

// L'échappatoire explicite : l'utilisateur DEMANDE de voir la page, le modèle
// appelle resource__present sur l'id du record. L'exclusion porte sur l'ORIGINE
// de l'ack, pas sur le record — l'ack devient resource_presented, affiché.
const onDemand = await page.evaluate(async ({ convId }) => {
  const conv = loadConversation(convId);
  conv.attSeq = 5; conv.messages = []; saveConversation(conv);
  clearPendingToolAcks();
  await callTool('miaou__docs__render_page', { ref: 'att-91', page: 1 },
    { convId, spaceId: activeSpaceId });
  const renderAck = getPendingToolAcks().find((a) => a.origin === 'docs_render');
  const rec = getCachedRecordByAttId(renderAck.attId, convId);
  clearPendingToolAcks();
  await callTool('miaou__resource__present', { id: rec.id },
    { convId, spaceId: activeSpaceId });
  const presentAck = getPendingToolAcks()[0];
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="body"></div>';
  placeToolAck(wrap, presentAck, false);
  return {
    mime: rec.mime,
    kind: presentAck && presentAck.kind,
    shows: !!wrap.querySelector('img.tool-block-img'),
  };
}, { convId: rendered.convId });

check('sur demande explicite, resource__present RÉAFFICHE la page rendue',
  onDemand.mime === 'image/png' && onDemand.kind === 'resource_presented' &&
  onDemand.shows === true, `${onDemand.kind} / affichée=${onDemand.shows}`);
// Contrepartie du masquage : sans l'id dans le result, le modèle n'aurait aucun
// moyen de montrer la page à l'utilisateur qui la demande.
check('le result donne l\'identifiant à passer à resource__present',
  rendered.result.includes('resource__present') &&
  /identifiant\s*:\s*att_[a-z0-9]+/.test(rendered.result),
  rendered.result.slice(-90));

// ── Non-régression : le recall d'une pièce jointe partage ce kind ────────────
console.log('\nNon-régression — recall_attachment');

const recall = await page.evaluate(() => {
  const el = buildToolAck({ role: 'tool-ack', kind: 'attachment_recalled',
    attId: 'att-3', resourceName: 'photo.jpg', mime: 'image/jpeg' });
  return { txt: el.textContent.trim(), html: el.innerHTML };
});
check('un rappel SANS origin garde son libellé d\'origine',
  /Pièce jointe rappelée/.test(recall.txt) && /photo\.jpg/.test(recall.txt), recall.txt);
check('et son icône œil',
  recall.html.includes('<circle cx="12" cy="12" r="3"'));

// ── L'intention du modèle est affichée à l'écran ─────────────────────────────
// Elle arrivait bien sur l'ack (callTool + ACK_COPY_FIELDS) et s'affichait dans
// l'export, mais attachment_recalled était la SEULE ligne d'ACK_KINDS dont le
// renderLabel ne la lisait pas. Les deux cas de la ligne sont contrôlés.
console.log('\nIntention du modèle (miaou_intent) à l\'écran');

const intents = await page.evaluate(() => {
  const mk = extra => buildToolAck(Object.assign({
    role: 'tool-ack', kind: 'attachment_recalled', mime: 'image/png',
    intent: 'Lire le certificat scanné',
  }, extra));
  const render = mk({ origin: 'docs_render', attId: 'att-9',
    sourceName: 'scanned2.pdf', selector: '1' });
  const plain = mk({ attId: 'att-3', resourceName: 'photo.jpg' });
  const lvl1 = el => (el.querySelector('.mcp-intent') || {}).textContent || '';
  const lvl2 = el => (el.querySelector('.mcp-breadcrumb-detail') || {}).textContent || '';
  const hidden = el => {
    const d = el.querySelector('.mcp-breadcrumb-detail');
    return !!(d && d.hasAttribute('hidden'));
  };
  return {
    renderL1: lvl1(render), renderL2: lvl2(render), renderHidden: hidden(render),
    plainL1: lvl1(plain), plainL2: lvl2(plain),
  };
});
check('une page rendue affiche l\'intention au niveau 1',
  intents.renderL1 === 'Lire le certificat scanné', intents.renderL1);
check('son libellé dérivé passe au niveau 2, replié',
  /Page 1 rendue en image/.test(intents.renderL2) &&
  /scanned2\.pdf/.test(intents.renderL2) && intents.renderHidden === true,
  intents.renderL2);
check('un rappel de pièce jointe suit le même patron',
  intents.plainL1 === 'Lire le certificat scanné' &&
  /Pièce jointe rappelée/.test(intents.plainL2) &&
  /photo\.jpg/.test(intents.plainL2), intents.plainL2);

// Les trois autres lignes qui ne lisaient pas `intent` (audit 2026-08-29). Elles
// EN REÇOIVENT un — mesuré par sonde, pas déduit : resource__create,
// resource__present et files__promote sont des outils que le modèle appelle, et
// leur ack est le dernier poussé, donc celui que callTool enrichit.
const others = await page.evaluate(() => {
  const mk = extra => buildToolAck(Object.assign({ role: 'tool-ack' }, extra));
  const lvl1 = el => (el.querySelector('.mcp-intent') || {}).textContent || '';
  const lvl2 = el => (el.querySelector('.mcp-breadcrumb-detail') || {}).textContent || '';
  const stored = mk({ kind: 'resource_stored', id: 'res_1', resourceName: 'note.txt',
    size: 7, intent: 'Créer une note' });
  // Sous-produit de _storeBlock (docs__pack, docs__read as_resource, fetch_url) :
  // l'intent est allé à l'ack principal, celui-ci n'en porte pas.
  const sub = mk({ kind: 'resource_stored', id: 'res_2', resourceName: 'o.zip', size: 42 });
  const presented = mk({ kind: 'resource_presented', id: 'res_3',
    resourceName: 'plan.png', intent: 'Montrer le plan' });
  const promoted = mk({ kind: 'file_promote', id: 'file-9',
    resourceName: 'contrat.pdf', intent: 'Ranger le contrat' });
  return {
    storedL1: lvl1(stored), storedL2: lvl2(stored),
    subHasIntentNode: !!sub.querySelector('.mcp-intent'), subText: sub.textContent.trim(),
    presL1: lvl1(presented), presL2: lvl2(presented),
    promL1: lvl1(promoted), promL2: lvl2(promoted),
  };
});
check('resource_stored, ack unique d\'un outil : intention au niveau 1',
  others.storedL1 === 'Créer une note' && /Ressource enregistrée/.test(others.storedL2) &&
  /note\.txt/.test(others.storedL2), others.storedL2);
check('resource_stored en SOUS-PRODUIT (sans intent) : rendu inchangé',
  others.subHasIntentNode === false && /Ressource enregistrée/.test(others.subText) &&
  /o\.zip/.test(others.subText), others.subText);
check('resource_presented affiche l\'intention',
  others.presL1 === 'Montrer le plan' && /Ressource présentée/.test(others.presL2),
  others.presL2);
check('file_promote affiche l\'intention',
  others.promL1 === 'Ranger le contrat' &&
  /Fichier ajouté à la bibliothèque/.test(others.promL2), others.promL2);

check('aucune erreur console', consoleErrors.length === 0,
  consoleErrors.slice(0, 2).join(' | '));

await browser.close();
console.log('');
if (failures.length) {
  console.log(`ÉCHEC — ${failures.length} contrôle(s) : ${failures.join(' ; ')}`);
  process.exit(1);
}
console.log('OK — tous les contrôles passent');
