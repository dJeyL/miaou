#!/usr/bin/env node
// Lot Z-2 — note de présentation détachée du résultat dans l'inspecteur.
//
// Le bug, observé sur de vrais appels au MCP météo (wttr.in) : l'ack persiste UN
// champ `result` qui sert deux destinataires — le modèle, qui a besoin de
// NOT_PRESENTED_NOTE concaténée en queue, et l'inspecteur, qui montre ce que
// l'OUTIL a répondu. La note s'affichait donc comme si le serveur l'avait
// renvoyée, ET (le vrai dégât) empêchait inspectResultShape de reconnaître le
// JSON : plus de ré-indentation, plus de coloration, une seule longue ligne.
//
// Ce que ce script prouve, et que les tests QuickJS ne peuvent pas prouver :
//   - le câblage est réel (splitToolResultNote APPELÉ par renderToolInspector,
//     pas seulement pur et testé à côté) ;
//   - la langue affichée par le <pre> redevient json, donc multiligne ;
//   - la note est rendue SOUS le bloc de code, pas au-dessus ;
//   - un résultat SANS note n'acquiert pas de .inspect-note parasite.
//
// Volet Z-2b (ressources désignées par un mcp_call) — ce que ce script prouve
// en plus :
//   - un ack `mcp_call` dont le résultat porte un `[resource_ref:…]` ouvre un
//     volet Ressource (image en vignette), là où il n'affichait que le marqueur ;
//   - le marqueur reste visible mais SANS bloc de code (.inspect-ref) ;
//   - nom/type/taille sont remplis depuis le RECORD résolu — un mcp_call n'en
//     porte aucune copie, le volet n'aurait qu'un identifiant nu ;
//   - la lightbox respecte les proportions de l'image : les champs w/h du record
//     n'existent pas pour un binaire interné, et le repli 800×600 l'étirait.
//
// Usage : node verify-tool-inspector-note.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-tool-inspector-note');
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

// Fixture calquée sur le cas réel : JSON météo wttr.in + la note telle que
// internResourcesFromResult la concatène. On lit NOT_PRESENTED_NOTE depuis la
// PAGE (constante du build), jamais une copie recopiée ici : un littéral
// dupliqué dans la fixture testerait un texte que l'appli n'émet plus.
await page.evaluate(() => {
  document.getElementById('thread').innerHTML = '';
  const weather = JSON.stringify({
    current_condition: [{ FeelsLikeC: '23', cloudcover: '96', humidity: '77',
      temp_C: '21', uvIndex: '1', visibility: '10' }],
  });
  const w = startAssistantMessage('test-model');
  placeToolAck(w, {
    id: 'n1', role: 'tool-ack', kind: 'mcp_call', server: 'miaou-proxy',
    name: 'miaou-proxy__weather__get_weather', args: { location: 'Nantes' },
    result: weather + NOT_PRESENTED_NOTE, ts: Date.now(),
  }, false);
  placeToolAck(w, {
    id: 'n2', role: 'tool-ack', kind: 'mcp_call', server: 'weather',
    name: 'weather__get_weather', args: { location: 'Nantes' },
    result: weather, ts: Date.now(),
  }, false);
});
await page.waitForTimeout(200);

// Déplier le groupe pour atteindre l'ack AVEC note (le premier).
await page.click('.ack-badge');
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.querySelectorAll('.ack-list .tool-ack')[0].querySelector('.ack-inspect').click();
});
await page.waitForTimeout(450);

const withNote = await page.evaluate(() => {
  const body = document.getElementById('inspect-body');
  const sections = Array.from(body.querySelectorAll('.inspect-section'));
  const res = sections.find(s => {
    const t = s.querySelector('.inspect-section-title');
    return t && t.textContent === 'Réponse';
  });
  const pre = res ? res.querySelector('pre') : null;
  const code = pre ? pre.querySelector('code') : null;
  const note = res ? res.querySelector('.inspect-note') : null;
  return {
    hasNote: !!note,
    noteText: note ? note.textContent : '',
    // Le texte affiché ne doit PLUS contenir la note.
    preText: pre ? pre.textContent : '',
    codeClass: code ? code.className : '',
    // Positions : la note doit commencer sous le bas du <pre>.
    noteBelow: (note && pre)
      ? note.getBoundingClientRect().top >= pre.getBoundingClientRect().bottom - 1
      : false,
    // Proximité : une glose doit toucher CE qu'elle commente. `.inspect-section`
    // est un flex à row-gap, donc les marges ne fusionnent pas et s'additionnent
    // — un margin-top « raisonnable » posé ici éloignait la note du bloc au
    // point de la rapprocher du titre de la section SUIVANTE (mesuré 24 contre
    // 14 px). On compare les deux écarts plutôt que d'asserter une valeur en dur,
    // qui périmerait au premier changement de densité.
    gapAbove: (note && pre)
      ? Math.round(note.getBoundingClientRect().top - pre.getBoundingClientRect().bottom)
      : -1,
    gapBelow: (() => {
      if (!note) return -1;
      const secs = Array.from(body.querySelectorAll('.inspect-section'));
      const next = secs[secs.indexOf(res) + 1];
      const title = next && next.querySelector('.inspect-section-title');
      return title
        ? Math.round(title.getBoundingClientRect().top - note.getBoundingClientRect().bottom)
        : -1;
    })(),
  };
});

check('la note est rendue (l\'information n\'est pas perdue)', withNote.hasNote);
check('elle dit bien que l\'utilisateur ne voit pas le contenu',
  withNote.noteText.includes('ne le voit PAS'));
check('la note est SOUS le bloc de code, pas au-dessus', withNote.noteBelow);
check('la note est nettoyée de ses marqueurs modèle (\\n et crochets)',
  withNote.noteText.charAt(0) === 'C' && !withNote.noteText.includes(']'));
check('la note est plus proche du bloc qu\'elle commente que de la section suivante',
  withNote.gapAbove >= 0 && withNote.gapBelow > withNote.gapAbove);
check('le bloc de code ne contient plus la note',
  !withNote.preText.includes('ne le voit PAS'));
check('le JSON est ré-indenté (multiligne), donc de nouveau reconnu',
  withNote.preText.includes('\n') && withNote.preText.includes('current_condition'));
check('la langue du bloc est json, pas text',
  withNote.codeClass.includes('language-json'));

await page.screenshot({ path: path.join(outDir, '01-avec-note.png') });

// ── Contrôle négatif : un résultat SANS note ────────────────────────────────
// Sans lui, un .inspect-note posé inconditionnellement passerait tous les
// contrôles ci-dessus (green check qui ne prouve rien : fonction non appliquée
// à toutes ses sources).
await page.evaluate(() => {
  document.querySelectorAll('.ack-list .tool-ack')[1].querySelector('.ack-inspect').click();
});
await page.waitForTimeout(450);

const noNote = await page.evaluate(() => {
  const body = document.getElementById('inspect-body');
  const res = Array.from(body.querySelectorAll('.inspect-section')).find(s => {
    const t = s.querySelector('.inspect-section-title');
    return t && t.textContent === 'Réponse';
  });
  const pre = res ? res.querySelector('pre') : null;
  const code = pre ? pre.querySelector('code') : null;
  return {
    hasNote: !!(res && res.querySelector('.inspect-note')),
    preText: pre ? pre.textContent : '',
    codeClass: code ? code.className : '',
  };
});
check('résultat sans note : aucune .inspect-note parasite', noNote.hasNote === false);
check('résultat sans note : toujours du json ré-indenté',
  noNote.codeClass.includes('language-json') && noNote.preText.includes('\n'));

await page.screenshot({ path: path.join(outDir, '02-sans-note.png') });

// ── Ressource désignée par un mcp_call via [resource_ref:…] ─────────────────
// Une vraie image stockée en IDB par le chemin de production (_storeBlock), puis
// un ack mcp_call qui la référence : la forme exacte d'un fetch_url d'image.
const refCase = await page.evaluate(async () => {
  document.getElementById('thread').innerHTML = '';
  const c = document.createElement('canvas'); c.width = 240; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#c96'; g.fillRect(0, 0, 240, 160);
  const b64 = c.toDataURL('image/png').split(',')[1];
  const id = await _storeBlock('image/png', 'photo-labrador.png',
    base64ToArrayBuffer(b64), 'binary', null, Date.now(), Math.random);
  const w = startAssistantMessage('gemma4');
  placeToolAck(w, {
    id: 'r1', role: 'tool-ack', kind: 'mcp_call', server: 'miaou-proxy',
    name: 'miaou-proxy__web__fetch_url', intent: 'Récupération de la photo',
    args: { url: 'https://images.unsplash.com/photo-1537204696486' },
    result: '[resource_ref:' + id + ']' + PRESENTED_NOTE, ts: Date.now(),
  }, false);
  const rec = getCachedRecord(id);
  // Prémisse du correctif de lightbox : ce record n'a PAS de w/h. Si un jour
  // _storeBlock se met à les calculer, ce contrôle le dira plutôt que de laisser
  // le test passer pour une raison qui n'existe plus.
  return { recordHasNoDims: rec.w == null && rec.h == null };
});
check('prémisse : un binaire interné n\'a ni w ni h dans son record',
  refCase.recordHasNoDims);

await page.evaluate(() => {
  const b = document.querySelectorAll('.ack-inspect');
  b[b.length - 1].click();
});
await page.waitForTimeout(700);

const refPanel = await page.evaluate(() => {
  const body = document.getElementById('inspect-body');
  const titles = Array.from(body.querySelectorAll('.inspect-section-title')).map(t => t.textContent);
  const fields = {};
  body.querySelectorAll('.inspect-section').forEach(sec => {
    const t = sec.querySelector('.inspect-section-title');
    if (!t || t.textContent !== 'Ressource') return;
    sec.querySelectorAll('.inspect-field').forEach(f => {
      const k = f.querySelector('.inspect-key'), v = f.querySelector('.inspect-val');
      if (k && v) fields[k.textContent] = v.textContent;
    });
  });
  const ref = body.querySelector('.inspect-ref');
  const note = body.querySelector('.inspect-note');
  const r = e => e.getBoundingClientRect();
  return {
    hasResourceSection: titles.includes('Ressource'),
    hasThumb: !!body.querySelector('.inspect-thumb'),
    refText: ref ? ref.textContent : '',
    // Le marqueur ne doit PAS être dans un <pre> : pas de bloc de code pour un
    // identifiant, le contenu est juste en dessous.
    refInPre: !!(ref && ref.closest('pre')),
    responseHasPre: (() => {
      const res = Array.from(body.querySelectorAll('.inspect-section')).find(s => {
        const t = s.querySelector('.inspect-section-title');
        return t && t.textContent === 'Réponse';
      });
      return !!(res && res.querySelector('pre'));
    })(),
    fields,
    noteOverlapsRef: (ref && note) ? r(note).top < r(ref).bottom : null,
  };
});

check('mcp_call + [resource_ref:] → un volet Ressource', refPanel.hasResourceSection);
check('image affichée en vignette, pas en référence', refPanel.hasThumb);
check('le marqueur reste visible', refPanel.refText.includes('[resource_ref:'));
check('le marqueur n\'est pas rendu en bloc de code',
  !refPanel.refInPre && !refPanel.responseHasPre);
check('nom rempli depuis le record résolu',
  refPanel.fields['nom'] === 'photo-labrador.png');
check('type rempli depuis le record résolu', refPanel.fields['type'] === 'image/png');
check('taille remplie depuis le record résolu',
  !!refPanel.fields['taille'] && refPanel.fields['taille'] !== '…');
check('la note ne chevauche pas le marqueur (marge réglée sur le frère)',
  refPanel.noteOverlapsRef === false);

await page.screenshot({ path: path.join(outDir, '04-ref-image.png') });

// ── Lightbox : proportions ──────────────────────────────────────────────────
await page.evaluate(() => document.querySelector('.inspect-thumb').click());
await page.waitForTimeout(600);
const lb = await page.evaluate(() => {
  const img = document.querySelector('.mermaid-lightbox-canvas img');
  const canvas = document.querySelector('.mermaid-lightbox-canvas');
  if (!img || !canvas) return null;
  const r = canvas.getBoundingClientRect();
  return {
    natural: +(img.naturalWidth / img.naturalHeight).toFixed(3),
    shown: +(r.width / r.height).toFixed(3),
  };
});
check('la lightbox s\'ouvre sur la vignette', lb !== null);
// Sans le correctif : 1.333 (repli 800×600) contre 1.5 réel — vérifié en
// retirant la correction, le contrôle échoue bien.
check('la lightbox respecte les proportions de l\'image',
  lb !== null && Math.abs(lb.natural - lb.shown) < 0.01);

await page.screenshot({ path: path.join(outDir, '05-lightbox.png') });

check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log('  ', consoleErrors.slice(0, 5).join('\n   '));

console.log('\n' + (failures.length
  ? `ÉCHEC — ${failures.length} contrôle(s) : ${failures.join(' | ')}`
  : 'OK — tous les contrôles passent'));
console.log('Captures : ' + outDir);
await browser.close();
process.exit(failures.length ? 1 : 0);
