#!/usr/bin/env node
// Lot Z — inspecteur d'appel d'outil : poignée sur l'ack + drawer de détail.
//
// Ce que le script prouve, et que les tests QuickJS ne peuvent pas prouver :
//   - la poignée n'apparaît QUE sur un ack porteur de détail (prédicat câblé) ;
//   - elle est accessible sur un ack INTERMÉDIAIRE d'un enchaînement, y compris
//     quand le groupe est COMPACT (nœuds détachés, WeakMap) — le besoin qui a
//     motivé le lot ;
//   - le drawer s'ouvre sur le bon appel, en .drawer-wide, volets empilés ;
//   - le code js__eval sort en JavaScript colorisé, pas en string JSON ;
//   - un argument multiligne passe en bloc, pas en valeur inline ;
//   - Escape ferme bien CE drawer (registration dans _drawerStack) ;
//   - la densité est inférieure à celle du fil (exigence explicite).
//
// Usage : node verify-tool-inspector.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-tool-inspector');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// Un enchaînement réaliste : trois appels MCP puis un js__eval, plus un ack
// LEGACY (sans args/result/code) qui ne doit PAS porter de poignée.
await page.evaluate(() => {
  document.getElementById('thread').innerHTML = '';
  const w = startAssistantMessage('test-model');
  placeToolAck(w, {
    id: 'a1', role: 'tool-ack', kind: 'mcp_call', server: 'splunk',
    name: 'splunk__search', intent: 'Chercher les erreurs 5xx',
    args: { query: 'index=main status>=500\n| stats count by host', earliest: '-24h' },
    result: '{"results":[{"host":"web-01","count":42}],"fields":["host","count"]}',
    ts: Date.now() - 60000,
  }, false);
  placeToolAck(w, {
    id: 'a2', role: 'tool-ack', kind: 'mcp_call', server: 'apim',
    name: 'apim__list_apis', args: { page: 1 },
    result: 'Erreur outil distant apim__list_apis : timeout', error: true,
    ts: Date.now() - 40000,
  }, false);
  // `name` est posé par onEnrichLastAck en production (le handler js__eval ne
  // le pousse pas lui-même) : la fixture doit le refléter, sinon on testerait
  // un ack qui n'existe pas et on raterait le breadcrumb sur cet outil.
  placeToolAck(w, {
    id: 'a3', role: 'tool-ack', kind: 'js_eval', name: 'miaou__js__eval',
    code: 'const rows = JSON.parse(__miaou_text("h1"));\nrows.filter(r => r.count > 10).length;',
    args: { code: 'const rows = JSON.parse(__miaou_text("h1"));\nrows.filter(r => r.count > 10).length;', input_handles: { h1: 'res_42' } },
    outLen: 3, result: '7', ts: Date.now() - 20000,
  }, false);
  placeToolAck(w, { id: 'a4', role: 'tool-ack', kind: 'resource_presented', resourceName: 'vieux.png' }, false);
});
await page.waitForTimeout(200);

// ── Groupe COMPACT : un seul .tool-ack en DOM, les autres détachés ───────────
// L'ack VISIBLE en compact est le DERNIER du groupe — ici l'ack legacy, qui n'a
// légitimement pas de poignée. On vérifie donc les deux faits séparément : le
// legacy visible n'en a pas, et un ack ENRICHI mis en position visible en a une.
const compact = await page.evaluate(() => ({
  domAcks: document.querySelectorAll('#thread .tool-ack').length,
  mode: document.querySelector('.ack-group').dataset.mode,
  visibleKind: document.querySelector('#thread .tool-ack').className,
  handlesInDom: document.querySelectorAll('#thread .ack-inspect').length,
}));
check('groupe compact : un seul ack en DOM (les autres dans la WeakMap)', compact.domAcks === 1);
check('compact : l\'ack visible est le dernier poussé', compact.visibleKind.includes('ack-resource_presented'));
check('compact : ce dernier étant legacy, aucune poignée', compact.handlesInDom === 0);

// Un groupe compact dont le dernier ack EST enrichi : la poignée doit s'y
// trouver, sur le nœud attaché. C'est le contrôle que le précédent ne fait pas.
const compactEnriched = await page.evaluate(() => {
  const w = startAssistantMessage('test-model');
  placeToolAck(w, { id: 'b1', role: 'tool-ack', kind: 'mcp_call', name: 'splunk__a', args: { x: 1 }, result: 'r1' }, false);
  placeToolAck(w, { id: 'b2', role: 'tool-ack', kind: 'mcp_call', name: 'splunk__b', args: { x: 2 }, result: 'r2' }, false);
  const groups = document.querySelectorAll('.ack-group');
  const last = groups[groups.length - 1];
  return {
    domAcks: last.querySelectorAll('.tool-ack').length,
    handles: last.querySelectorAll('.ack-inspect').length,
  };
});
check('compact + dernier ack enrichi : un seul ack en DOM', compactEnriched.domAcks === 1);
check('compact + dernier ack enrichi : sa poignée est présente', compactEnriched.handles === 1);

await page.screenshot({ path: path.join(outDir, '01-compact.png') });

// ── Bascule en liste : tous les acks reviennent, poignées comprises ──────────
await page.click('.ack-badge');
await page.waitForTimeout(400);
const listed = await page.evaluate(() => ({
  acks: document.querySelectorAll('.ack-list .tool-ack').length,
  handles: document.querySelectorAll('.ack-list .ack-inspect').length,
  legacyHasHandle: !!document.querySelector('.ack-list .ack-resource_presented .ack-inspect'),
}));
check('mode liste : les 4 acks sont en DOM', listed.acks === 4);
check('3 poignées sur 4 acks — l\'ack legacy n\'en a pas', listed.handles === 3);
// Ordre des icônes : la loupe vient APRÈS le téléchargement, donc en dernière
// position — sinon elle se décale sur les seules lignes qui portent un
// téléchargement, et la colonne d'icônes n'est plus alignée dans un groupe
// déplié (retour utilisateur sur capture réelle).
const align = await page.evaluate(() => {
  const rights = Array.from(document.querySelectorAll('.ack-list .ack-inspect'))
    .map(i => Math.round(i.getBoundingClientRect().right));
  const withBoth = Array.from(document.querySelectorAll('.ack-list .tool-ack'))
    .filter(a => a.querySelector('.ack-inspect') && a.querySelector('.ack-dl'));
  return {
    aligned: new Set(rights).size === 1,
    count: rights.length,
    inspectLast: withBoth.every(a => {
      const i = a.querySelector('.ack-inspect'), d = a.querySelector('.ack-dl');
      return (i.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_PRECEDING) > 0;
    }),
  };
});
check('loupes alignées sur une même colonne, avec ou sans téléchargement', align.aligned && align.count === 3);
check('la loupe suit le téléchargement quand les deux sont présents', align.inspectLast);
check('ack legacy (sans args/result/code) : aucune poignée', listed.legacyHasHandle === false);

await page.screenshot({ path: path.join(outDir, '02-liste.png') });

// ── Ouverture depuis un ack INTERMÉDIAIRE (le 1er d'un enchaînement) ─────────
await page.evaluate(() => {
  document.querySelectorAll('.ack-list .tool-ack')[0].querySelector('.ack-inspect').click();
});
await page.waitForTimeout(450);

const opened = await page.evaluate(() => {
  const d = document.getElementById('inspect-drawer');
  const body = document.getElementById('inspect-body');
  const crumb = body.querySelector('.inspect-crumb');
  const titles = Array.from(body.querySelectorAll('.inspect-section-title')).map(t => t.textContent);
  const bodyFont = parseFloat(getComputedStyle(body).fontSize);
  const threadFont = parseFloat(getComputedStyle(document.querySelector('#thread .msg')).fontSize);
  return {
    shown: d.classList.contains('show'),
    wide: d.classList.contains('drawer-wide'),
    width: Math.round(d.getBoundingClientRect().width),
    crumb: crumb ? crumb.textContent : '',
    chevrons: crumb ? crumb.querySelectorAll('.ack-sep').length : 0,
    titles,
    intent: (body.querySelector('.inspect-intent') || {}).textContent || '',
    // Volets EMPILÉS : chaque section commence sous la précédente.
    stacked: (() => {
      const s = Array.from(body.querySelectorAll('.inspect-section'));
      return s.every((el, i) => i === 0 ||
        el.getBoundingClientRect().top >= s[i - 1].getBoundingClientRect().bottom - 1);
    })(),
    bodyFont, threadFont,
    // L'argument multiligne (requête SPL) doit être en BLOC, pas inline.
    hasBlock: !!body.querySelector('.inspect-section pre'),
    inlineVals: Array.from(body.querySelectorAll('.inspect-val')).map(v => v.textContent),
    resultText: (() => {
      const pres = Array.from(body.querySelectorAll('pre'));
      return pres.length ? pres[pres.length - 1].textContent : '';
    })(),
  };
});
check('le drawer s\'ouvre', opened.shown);
check('drawer large (.drawer-wide, 620px comme Skills/Outils)', opened.wide && opened.width === 620);
check('breadcrumb à chevrons du nom d\'outil', opened.chevrons === 1 && opened.crumb.includes('splunk'));
check('volets Requête / Réponse / Méta présents', ['Requête', 'Réponse', 'Méta'].every(t => opened.titles.includes(t)));
check('volets EMPILÉS verticalement (pas des onglets)', opened.stacked);
check('intention déclarée affichée', opened.intent.includes('5xx'));
check('densité plus forte que le fil', opened.bodyFont < opened.threadFont);
check('argument multiligne rendu en bloc', opened.hasBlock);
check('aucune valeur inline ne contient de saut de ligne', opened.inlineVals.every(v => !v.includes('\n')));
check('résultat JSON ré-indenté (non tronqué)', opened.resultText.includes('\n') && opened.resultText.includes('web-01'));

// Le .code-head (langue + copier/télécharger/aperçu) vit DANS le <pre> : borner
// la hauteur sur le <pre> le ferait défiler avec le contenu, faisant disparaître
// les boutons juste quand le contenu est assez long pour qu'on en ait besoin.
// La borne doit donc porter sur le <code>.
const scrollOwner = await page.evaluate(() => {
  const body = document.getElementById('inspect-body');
  const w = startAssistantMessage('scroll-fixture');
  placeToolAck(w, { id: 'sc', role: 'tool-ack', kind: 'mcp_call', name: 's__long',
    args: { q: 1 }, result: Array.from({ length: 200 }, (_, i) => 'ligne ' + i).join('\n') }, false);
  document.querySelectorAll('.ack-inspect')[document.querySelectorAll('.ack-inspect').length - 1].click();
  const pre = Array.from(body.querySelectorAll('pre'))
    .find(x => x.textContent.includes('ligne 150'));
  if (!pre) return { found: false };
  const code = pre.querySelector('code');
  const head = pre.querySelector('.code-head');
  const top0 = head.getBoundingClientRect().top;
  code.scrollTop = 400;
  return {
    found: true,
    preScrolls: pre.scrollHeight > pre.clientHeight,
    codeScrolls: code.scrollHeight > code.clientHeight,
    headStayed: Math.abs(head.getBoundingClientRect().top - top0) <= 1,
    reallyScrolled: code.scrollTop > 0,
  };
});
check('long résultat : le scroll vertical est sur le <code>, pas le <pre>',
  scrollOwner.found && scrollOwner.codeScrolls && !scrollOwner.preScrolls);
check('en-tête du bloc (langue + boutons) épinglé pendant le défilement',
  scrollOwner.reallyScrolled && scrollOwner.headStayed);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
await page.evaluate(() => {
  const groups = document.querySelectorAll('.ack-group');
  const last = groups[groups.length - 1];
  if (last && last.closest('.msg')) last.closest('.msg').remove();
});
await page.evaluate(() => {
  document.querySelectorAll('.ack-list .tool-ack')[0].querySelector('.ack-inspect').click();
});
await page.waitForTimeout(400);

await page.screenshot({ path: path.join(outDir, '03-drawer-mcp.png') });

// ── Escape ferme CE drawer (registration _drawerStack) ───────────────────────
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
check('Escape ferme l\'inspecteur',
  await page.evaluate(() => !document.getElementById('inspect-drawer').classList.contains('show')));

// ── js__eval : le code en JavaScript colorisé, jamais en string JSON ─────────
await page.evaluate(() => {
  document.querySelectorAll('.ack-list .tool-ack')[2].querySelector('.ack-inspect').click();
});
await page.waitForTimeout(600);
const evalView = await page.evaluate(() => {
  const body = document.getElementById('inspect-body');
  const code = body.querySelector('pre code');
  const crumb = body.querySelector('.inspect-crumb');
  return {
    lang: code ? code.className : '',
    text: code ? code.textContent : '',
    highlighted: code ? code.querySelectorAll('span.token').length : 0,
    quoted: body.textContent.includes('\\n'),
    crumbSegs: crumb ? crumb.querySelectorAll('code').length : 0,
    crumbChevrons: crumb ? crumb.querySelectorAll('.ack-sep').length : 0,
    codeBlocks: Array.from(body.querySelectorAll('pre code'))
      .filter(c => c.textContent.includes('__miaou_text')).length,
  };
});
check('code js__eval en bloc language-javascript', evalView.lang.includes('language-javascript'));
check('breadcrumb à chevrons sur un outil interne aussi', evalView.crumbSegs === 3 && evalView.crumbChevrons === 2);
check('code non redupliqué depuis args.code (rendu une seule fois)', evalView.codeBlocks === 1);
check('code affiché tel quel, pas en string JSON échappée', evalView.text.includes('\n') && !evalView.quoted);
check('coloration Prism appliquée au code', evalView.highlighted > 0);

await page.screenshot({ path: path.join(outDir, '04-drawer-jseval.png') });

// ── Ack en échec : l'issue est dite, même si le texte a l'air normal ─────────
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.evaluate(() => {
  document.querySelectorAll('.ack-list .tool-ack')[1].querySelector('.ack-inspect').click();
});
await page.waitForTimeout(450);
const errView = await page.evaluate(() => {
  const body = document.getElementById('inspect-body');
  return {
    badge: !!body.querySelector('.inspect-badge-error'),
    text: body.textContent,
  };
});
check('ack en échec : badge « en échec » dans l\'en-tête', errView.badge);
check('ack en échec : issue reportée en Méta', errView.text.includes('échec'));

await page.screenshot({ path: path.join(outDir, '05-drawer-erreur.png') });

// ── Volet ressource : les quatre présentations ──────────────────────────────
// On peuple le cache session (mêmes records que loadConversationResources) puis
// on inspecte un ack de chaque famille. Sans ce cache, la résolution partirait
// en IDB et on testerait le chemin dégradé au lieu du chemin nominal.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const enc = new TextEncoder();
  const png = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC'
  ), c => c.charCodeAt(0));
  _resourceCache['res_json'] = { id: 'res_json', name: 'resultat.json', mime: 'application/json',
    size: 40, class: 'inline', data: enc.encode('{"rows":[{"host":"web-01","count":42}]}').buffer };
  _resourceCache['res_svg'] = { id: 'res_svg', name: 'schema.svg', mime: 'image/svg+xml',
    size: 90, class: 'inline', data: enc.encode('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#c60"/></svg>').buffer };
  _resourceCache['res_png'] = { id: 'res_png', name: 'capture.png', mime: 'image/png',
    size: png.byteLength, w: 10, h: 10, class: 'binary', data: png.buffer };
  _resourceCache['res_pdf'] = { id: 'res_pdf', name: 'rapport.pdf', mime: 'application/pdf',
    size: 4096, class: 'binary', data: enc.encode('%PDF-1.4 fake').buffer };

  document.getElementById('thread').innerHTML = '';
  const w = startAssistantMessage('test-model');
  [['res_json', 'resultat.json', 'application/json', 40],
   ['res_svg', 'schema.svg', 'image/svg+xml', 90],
   ['res_png', 'capture.png', 'image/png', 68],
   ['res_pdf', 'rapport.pdf', 'application/pdf', 4096]].forEach(([id, name, mime, size], i) => {
    placeToolAck(w, { id, role: 'tool-ack', kind: 'resource_stored', resourceName: name,
      mime, size, name: 'mcp__store', args: { path: name }, result: 'Ressource ' + id + ' enregistrée.',
      ts: Date.now() - (4 - i) * 1000 }, false);
  });
});
await page.waitForTimeout(200);
await page.click('.ack-badge');
await page.waitForTimeout(400);

const resView = [];
for (let i = 0; i < 4; i++) {
  await page.evaluate((idx) => {
    document.querySelectorAll('.ack-list .tool-ack')[idx].querySelector('.ack-inspect').click();
  }, i);
  await page.waitForTimeout(600);
  resView.push(await page.evaluate(() => {
    const body = document.getElementById('inspect-body');
    const sec = Array.from(body.querySelectorAll('.inspect-section'))
      .find(s => s.querySelector('.inspect-section-title').textContent === 'Ressource');
    const prev = sec ? sec.querySelector('.inspect-preview') : null;
    const code = prev ? prev.querySelector('pre code') : null;
    return {
      hasSection: !!sec,
      fields: sec ? Array.from(sec.querySelectorAll('.inspect-key')).map(k => k.textContent) : [],
      hasDownload: !!(sec && sec.querySelector('.inspect-dl')),
      thumb: !!(prev && prev.querySelector('.inspect-thumb')),
      codeLang: code ? code.className : null,
      codeText: code ? code.textContent : '',
      previewBtn: !!(prev && prev.querySelector('.code-preview-btn')),
      note: prev ? (prev.querySelector('.inspect-empty') || {}).textContent || '' : '',
    };
  }));
  await page.screenshot({ path: path.join(outDir, '0' + (6 + i) + '-ressource-' + i + '.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

const [rJson, rSvg, rPng, rPdf] = resView;
check('volet Ressource présent quand l\'ack en désigne une', resView.every(r => r.hasSection));
check('descripteur complet (nom, identifiant, type, taille)',
  ['nom', 'identifiant', 'type', 'taille'].every(f => rJson.fields.includes(f)));
check('téléchargement offert sur les quatre présentations', resView.every(r => r.hasDownload));
check('JSON → bloc colorisé et ré-indenté', rJson.codeLang && rJson.codeLang.includes('language-json') && rJson.codeText.includes('\n'));
check('SVG → source affichée', rSvg.codeLang && rSvg.codeLang.includes('language-svg') && rSvg.codeText.includes('<rect'));
check('SVG → bouton d\'aperçu sandboxé proposé (les deux façons)', rSvg.previewBtn);
check('image bitmap → vignette, pas de source', rPng.thumb && !rPng.codeLang);
check('binaire opaque → descripteur seul, message explicite', !rPdf.codeLang && !rPdf.thumb && rPdf.note.includes('binaire'));

// ── Nommage des téléchargements de blocs ────────────────────────────────────
// Sans `data-filename`, decoratePre retombe sur « miaou-snippet.<ext> » pour
// TOUS les blocs : on perd l'information alors qu'on l'a sous les yeux (la clé
// du paramètre, le nom de la ressource). On intercepte le nom proposé sans
// déclencher de vrai téléchargement.
await page.evaluate(() => {
  window.__dlNames = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__dlNames.push(this.download); else orig.call(this);
  };
  document.getElementById('thread').innerHTML = '';
  const w = startAssistantMessage('test-model');
  placeToolAck(w, { id: 'n1', role: 'tool-ack', kind: 'mcp_call', server: 'splunk',
    name: 'splunk__search', args: { query: 'index=main\n| stats count' },
    result: '{"a":1}' }, false);
  placeToolAck(w, { id: 'n2', role: 'tool-ack', kind: 'js_eval', name: 'miaou__js__eval',
    code: 'const x = 1;\nx + 1;', result: '2' }, false);
  placeToolAck(w, { id: 'res_json', role: 'tool-ack', kind: 'resource_stored',
    resourceName: 'resultat.json', mime: 'application/json', size: 40,
    name: 'mcp__store', args: { p: 1 }, result: 'ok' }, false);
  // Second outil portant LA MÊME clé `query` : sans préfixe, les deux blocs
  // proposeraient `query.txt` et se marcheraient dessus au téléchargement.
  placeToolAck(w, { id: 'n4', role: 'tool-ack', kind: 'mcp_call', server: 'apim',
    name: 'apim__list', args: { query: 'x\ny' }, result: 'ok' }, false);
});
await page.waitForTimeout(200);
await page.click('.ack-badge');
await page.waitForTimeout(400);

const dlNames = [];
for (let i = 0; i < 4; i++) {
  await page.evaluate((idx) => {
    document.querySelectorAll('.ack-list .ack-inspect')[idx].click();
  }, i);
  await page.waitForTimeout(650);
  dlNames.push(await page.evaluate(() => {
    window.__dlNames = [];
    document.querySelectorAll('#inspect-body .code-dl').forEach(b => b.click());
    return window.__dlNames.slice();
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

check('aucun bloc ne retombe sur le générique miaou-snippet',
  dlNames.flat().length > 0 && dlNames.flat().every(n => !n.startsWith('miaou-snippet')));
check('argument multiligne : clé du paramètre PRÉFIXÉE de l\'outil',
  dlNames[0].includes('search-query.txt'));
check('résultat préfixé du dernier segment de l\'outil',
  dlNames[0].includes('search-resultat.json') && dlNames[1].includes('eval-resultat.txt'));
check('code js__eval préfixé aussi', dlNames[1].includes('eval-code.js'));
// Le point de la remarque : deux outils partageant un nom de paramètre ne
// doivent pas proposer deux fichiers homonymes.
check('deux outils, même clé `query` → deux noms distincts',
  dlNames[0].includes('search-query.txt') && dlNames[3].includes('list-query.txt'));
check('ressource nommée d\'après le nom du record (extension conservée)',
  dlNames[2].includes('resultat.json'));

console.log('');
if (consoleErrors.length) {
  console.log('Erreurs console :');
  consoleErrors.forEach(e => console.log('  ' + e));
}
check('aucune erreur console', consoleErrors.length === 0);

console.log('');
console.log(failures.length ? `ÉCHECS (${failures.length}) :` : 'TOUT VERT');
failures.forEach(f => console.log('  - ' + f));
console.log('Captures : ' + outDir);

await browser.close();
process.exit(failures.length ? 1 : 0);
