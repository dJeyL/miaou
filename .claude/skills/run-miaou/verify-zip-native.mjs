#!/usr/bin/env node
// Vérif e2e du lot V-1 (MIAOU) : ouverture NATIVE d'une archive zip, sans aucun
// serveur MCP compagnon. C'est le point du sous-lot — ce script ne lance et ne
// requiert donc AUCUN proxy (contrairement à verify-docs-extract.mjs, lot M, qui
// exerce le chemin serveur du MÊME nom d'outil).
//
// Chemin réellement exercé (modèle STUBÉ, aucun réseau) :
//   1. untracked/muscle/log.zip est attaché en pièce jointe réelle via
//      #attach-file-input → att-N classifié 'binary' (22,5 Mo décompressés :
//      au-delà de l'ancien cap 32 Mo, sous le nouveau MAX_INLINE_BYTES = 64 Mo,
//      ce qui valide concrètement l'étape 1 du lot).
//   2. miaou__docs__list(ref=att-N) — handler SYNCHRONE, ne charge PAS fflate :
//      le listing se lit dans le seul central directory (AUDIT §2).
//   3. miaou__docs__extract(ref=att-N, path=pihole.log) — handler async,
//      lazy-load fflate depuis le CDN → _storeBlock → res_… classe 'inline'
//      rendu par formatInlineHandleForModel (JAMAIS [resource_ref:…], piège 26c).
//   4. miaou__js__eval(handle=res_…, code) sur ce handle : preuve que le membre
//      décompressé a bien traversé jusqu'à l'IDB et se relit intégralement.
//   5. untracked/muscle/enc.zip (zip chiffré) : REFUS EXPLICITE à l'extraction.
//      C'est LE test qui garde le piège de l'AUDIT §3 — fflate ne détecte pas le
//      chiffrement et rend des ordures binaires SANS lever d'erreur. Sans la
//      lecture manuelle du bit 0 du general purpose flag, ce point passe au vert
//      en apparence avec du contenu faux : vérifier le refus, pas l'absence
//      d'exception.
//
// Checklist (mémoire projet no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - docs__list liste UN membre pihole.log, taille ~22,5 Mo, sans charger fflate
//   - le listing ne contient jamais de contenu de membre
//   - docs__extract rend un handle res_…, JAMAIS un [resource_ref:…]
//   - le res_… est en IDB, classe 'inline', mime textuel, taille = 22 505 359 o
//   - js__eval sur ce handle compte les lignes du log (contenu réellement lisible)
//   - enc.zip : docs__list SIGNALE le membre chiffré avec son motif (jamais omis)
//   - enc.zip : docs__extract REFUSE explicitement, et ne matérialise rien
//   - multi.zip : les 3 entrées, dont sub/ annoncée comme répertoire
//   - description automatique (étape 6) : un zip de bibliothèque se décrit par
//     son listing natif, sans serveur MCP branché
//
// ── FIXTURES (untracked/, donc NON versionnées — à régénérer) ────────────────
// Les trois archives vivent dans `untracked/muscle/`, exclue du dépôt par
// `.gitignore`. Ce script est versionné, elles non : voici de quoi les refaire.
// Provenance et commandes d'origine : `untracked/muscle/README-fixtures-zip.md`
// (lui aussi untracked — d'où cette duplication délibérée, seule trace publique).
//
//   multi.zip  — plusieurs membres + une entrée répertoire (3 entrées, 458 o) :
//       echo "alpha" > a.txt            # 6 o
//       mkdir -p sub && echo "beta beta" > sub/b.txt   # 10 o
//       zip -r multi.zip a.txt sub      # crée aussi l'entrée `sub/`
//     Attendu : a.txt (6 o), sub/ (répertoire), sub/b.txt (10 o).
//
//   enc.zip    — archive CHIFFRÉE, la fixture qui garde le piège AUDIT §3
//                (1 membre, 215 o) :
//       echo "secret data here" > secret.txt          # 17 o
//       zip -P motdepasse enc.zip secret.txt
//     Attendu : secret.txt, 17 o, general purpose flag bit 0 = 1. Le mot de passe
//     n'a aucune importance (on ne déchiffre jamais) — seul le BIT compte.
//
//   log.zip    — cas réel volumineux (1 membre, 22 505 359 o décompressés) :
//     archive d'un vrai `pihole.log`. N'importe quel gros fichier texte convient,
//     MAIS l'assertion de taille exacte ci-dessous (PIHOLE_SIZE) est un ORACLE :
//     un fichier régénéré aura une autre taille. Deux options —
//       (a) régénérer et mettre PIHOLE_SIZE à jour :
//             zip log.zip pihole.log && stat -f%z pihole.log
//       (b) fabriquer un substitut de taille libre :
//             yes "$(date) query[A] example.com from 192.168.42.1" | head -c 22505359 > pihole.log
//             zip log.zip pihole.log
//     Le membre DOIT s'appeler `pihole.log` (le script l'extrait par ce chemin)
//     et peser > 20 Mo pour rester au-dessus de l'ancien cap de 32 Mo une fois
//     les copies en mémoire — c'est ce qui valide le passage à 64 Mo. Seule
//     contrainte de contenu : du texte à lignes multiples (js__eval en compte
//     les lignes, l'assertion attend ≥ 1000). Les mots `dnsmasq`/`query[A]`/
//     `gravity` peuvent y figurer sans risque : l'assertion qui les cherche
//     porte sur le LISTING, lequel ne transporte que des noms et des tailles —
//     c'est précisément ce qu'elle vérifie.
//
// Usage : node verify-zip-native.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait. Aucun serveur à lancer.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const fixturesDir = path.join(repoRoot, 'untracked/muscle');
const logZipPath = path.join(fixturesDir, 'log.zip');
const encZipPath = path.join(fixturesDir, 'enc.zip');
const multiZipPath = path.join(fixturesDir, 'multi.zip');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-zip-native');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const PIHOLE_SIZE = 22505359;   // oracle : README-fixtures-zip.md

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

// ── Prérequis fichiers ───────────────────────────────────────────────────────
if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
for (const p of [logZipPath, encZipPath, multiZipPath]) {
  if (!fs.existsSync(p)) {
    console.error('fixture manquante : ' + p + '\n(régénération : untracked/muscle/README-fixtures-zip.md)');
    process.exit(2);
  }
}
const logZipBytes = fs.readFileSync(logZipPath);
const encZipBytes = fs.readFileSync(encZipPath);
const multiZipBytes = fs.readFileSync(multiZipPath);

// ── Stub modèle : aucun appel réseau ne doit sortir (le natif est le sujet) ──
// Le stub ne scripte AUCUN tool_call : les outils sont appelés directement par
// le script via callTool, ce qui exerce exactement le même chemin que le
// dispatcher (callInternalTool) sans dépendre d'un aller-retour SSE.
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([]));   // AUCUN serveur : c'est le point
  } catch (e) {}

  window.__cdnHits = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      const body = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n' +
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n' +
        'data: [DONE]\n\n';
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    }
    if (url.indexOf('/models') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, opts);
  };
  // Traçage du chargement fflate : le listing NE DOIT PAS le déclencher.
  const realCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    const el = realCreate(tag);
    if (String(tag).toLowerCase() === 'script') {
      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        Object.defineProperty(el, 'src', {
          configurable: true,
          get() { return desc.get.call(this); },
          set(v) { try { window.__cdnHits.push(String(v)); } catch (e) {} desc.set.call(this, v); },
        });
      } catch (e) {}
    }
    return el;
  };
};

// ── Pilotage Playwright ──────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(initScript);
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error] ' + m.text()); });

// Appelle un outil interne par le vrai dispatcher, en résolvant la Promise
// éventuelle (docs__extract et js__eval sont async).
const callTool_ = (name, args) => page.evaluate(async ({ n, a }) => {
  try {
    const r = await callTool(n, a);
    if (typeof r === 'string') return { ok: true, text: r };
    return { ok: !r.isError, text: (r && r.content && r.content[0] && r.content[0].text) || String(r) };
  } catch (e) { return { ok: false, text: 'throw:' + (e && e.message) }; }
}, { n: name, a: args });

let exitCode = 0;
try {
  await page.goto('file://' + distPath);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  // Overlay de boot : jamais retiré du DOM, plancher 1,8 s — attendre .boot-done
  // AVANT toute capture, sinon on photographie le préchargement (mémoire projet
  // boot_overlay_hides_playwright_shots). Attendre la CLASSE, pas la visibilité :
  // l'overlay porte `boot-done` parce qu'il vient d'être estompé, il est donc
  // `hidden` au moment où la condition est remplie (waitForSelector exigerait
  // un élément visible et expirerait).
  await page.waitForFunction(
    () => document.getElementById('boot-overlay').classList.contains('boot-done'),
    null, { timeout: 15000 },
  );

  const noServers = await page.evaluate(() =>
    (typeof _remoteTools === 'undefined') || Object.keys(_remoteTools).length === 0);
  check('aucun serveur MCP branché (le natif est bien seul en jeu)', noServers);

  const registered = await page.evaluate(() => ({
    list: TOOLS.some((t) => t.name === 'docs__list'),
    extract: TOOLS.some((t) => t.name === 'docs__extract'),
  }));
  check('docs__list et docs__extract enregistrés nativement', registered.list && registered.extract,
    JSON.stringify(registered));

  // ── log.zip attaché : att-1 ────────────────────────────────────────────────
  await page.setInputFiles('#attach-file-input', {
    name: 'log.zip', mimeType: 'application/zip', buffer: logZipBytes,
  });
  await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
  // L'attachment ne devient un att-N résolvable qu'une fois le message envoyé.
  await page.fill('#composer-text', 'archive de logs');
  await page.evaluate(() => { if (typeof onSendBtn === 'function') onSendBtn(); });
  await page.waitForFunction(() => {
    try { return !!getCachedRecordByAttId('att-1', currentConvId); } catch (e) { return false; }
  }, null, { timeout: 30000 });

  const attSize = await page.evaluate(() => {
    const r = getCachedRecordByAttId('att-1', currentConvId);
    return r ? r.size : 0;
  });
  check('log.zip attaché comme att-1 (binaire)', attSize > 0, attSize + ' o compressés');

  // ── docs__list : le listing, sans fflate ───────────────────────────────────
  const cdnBefore = await page.evaluate(() => window.__cdnHits.slice());
  const listing = await callTool_('miaou__docs__list', { ref: 'att-1' });
  check('docs__list réussit sur att-1', listing.ok, listing.text.slice(0, 120));
  check('le listing nomme le membre pihole.log', /pihole\.log/.test(listing.text));
  check('le listing annonce ~22,5 Mo décompressés', /22[.,]\d\s*M|21[.,]\d\s*M/i.test(listing.text),
    listing.text.split('\n')[0]);
  check('le listing annonce UN membre', /\b1 membre\b/.test(listing.text), listing.text.split('\n')[0]);
  // Le listing DÉCRIT, il ne transporte jamais de contenu de membre.
  check('aucun contenu de membre dans le listing',
    !/dnsmasq|query\[A\]|gravity/i.test(listing.text));

  const cdnAfterList = await page.evaluate(() => window.__cdnHits.slice());
  const fflateOnList = cdnAfterList.filter((u) => /fflate/i.test(u)).length
    > cdnBefore.filter((u) => /fflate/i.test(u)).length;
  check('docs__list n\'a PAS chargé fflate (central directory seul, AUDIT §2)', !fflateOnList);

  await page.screenshot({ path: path.join(outDir, '1-docs_list.png'), fullPage: true }).catch(() => {});

  // ── docs__extract : le membre → res_… inline ───────────────────────────────
  const extracted = await callTool_('miaou__docs__extract', { ref: 'att-1', path: 'pihole.log' });
  check('docs__extract réussit sur pihole.log', extracted.ok, extracted.text.slice(0, 160));
  const handleMatch = /res_[A-Za-z0-9_-]+/.exec(extracted.text || '');
  check('docs__extract rend un handle res_…', !!handleMatch, extracted.text.slice(0, 160));
  // Piège 26c / mémoire resource_ref_reinlines_inline_class : un [resource_ref:…]
  // vers un record classe 'inline' ré-injecterait les 22,5 Mo au tour suivant.
  check('le retour ne contient AUCUN [resource_ref:…] (piège 26c)',
    !/\[resource_ref:/.test(extracted.text || ''));

  const fflateLoaded = await page.evaluate(() => (window.__cdnHits || []).some((u) => /fflate/i.test(u)));
  check('fflate chargé au premier appel de docs__extract (lazy-load)', fflateLoaded);

  const handle = handleMatch ? handleMatch[0] : '';
  const rec = await page.evaluate((id) => {
    const r = (typeof _resourceCache !== 'undefined') ? _resourceCache[id] : null;
    return r ? { class: r.class, mime: r.mime, size: r.size, name: r.name } : null;
  }, handle);
  check('res_… en cache, classe inline', !!rec && rec.class === 'inline', JSON.stringify(rec));
  check('mime textuel (text/plain pour un .log)', !!rec && /text|json/i.test(rec.mime || ''), rec && rec.mime);
  check('taille = taille décompressée exacte du membre',
    !!rec && rec.size === PIHOLE_SIZE, rec && (rec.size + ' o (attendu ' + PIHOLE_SIZE + ')'));

  // ── js__eval : le contenu est réellement relisible de bout en bout ─────────
  const evalRes = await callTool_('miaou__js__eval', {
    handle,
    code: 'const n = lines().length; JSON.stringify({ lignes: n });',
  });
  check('js__eval lit le membre extrait et compte ses lignes',
    evalRes.ok && /"lignes":\s*\d{4,}/.test(evalRes.text), evalRes.text.slice(0, 160));

  await page.screenshot({ path: path.join(outDir, '2-docs_extract_js_eval.png'), fullPage: true }).catch(() => {});

  // ── enc.zip : LE test du lot (AUDIT §3) ────────────────────────────────────
  // fflate extrait un membre chiffré en octets binaires SANS lever d'erreur.
  // Le refus doit venir de la lecture du bit 0 du general purpose flag ; ce
  // point ne se vérifie donc PAS par « pas d'exception », mais par le refus.
  await page.setInputFiles('#attach-file-input', {
    name: 'enc.zip', mimeType: 'application/zip', buffer: encZipBytes,
  });
  await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
  await page.fill('#composer-text', 'archive chiffrée');
  await page.evaluate(() => { if (typeof onSendBtn === 'function') onSendBtn(); });
  await page.waitForFunction(() => {
    try { return !!getCachedRecordByAttId('att-2', currentConvId); } catch (e) { return false; }
  }, null, { timeout: 30000 });

  const encListing = await callTool_('miaou__docs__list', { ref: 'att-2' });
  check('docs__list réussit sur enc.zip', encListing.ok, encListing.text.slice(0, 120));
  check('le membre chiffré est SIGNALÉ avec son motif (jamais omis silencieusement)',
    /chiffr/i.test(encListing.text) && /secret\.txt/.test(encListing.text),
    encListing.text.slice(0, 200));

  const resourcesBefore = await page.evaluate(() =>
    Object.keys(typeof _resourceCache !== 'undefined' ? _resourceCache : {}).length);
  const encExtract = await callTool_('miaou__docs__extract', { ref: 'att-2', path: 'secret.txt' });
  check('docs__extract REFUSE explicitement le membre chiffré (garde AUDIT §3)',
    /chiffr/i.test(encExtract.text || ''), encExtract.text.slice(0, 200));
  // Le refus ne doit rien produire : ni handle, ni ressource fantôme d'octets bruts.
  check('le refus ne rend AUCUN handle res_…', !/res_[A-Za-z0-9_-]+/.test(encExtract.text || ''),
    encExtract.text.slice(0, 160));
  const resourcesAfter = await page.evaluate(() =>
    Object.keys(typeof _resourceCache !== 'undefined' ? _resourceCache : {}).length);
  check('le refus n\'a matérialisé aucune ressource (pas d\'ordures binaires stockées)',
    resourcesAfter === resourcesBefore, resourcesBefore + ' → ' + resourcesAfter);

  await page.screenshot({ path: path.join(outDir, '3-encrypted_refusal.png'), fullPage: true }).catch(() => {});

  // ── multi.zip : plusieurs membres + une entrée répertoire ──────────────────
  await page.setInputFiles('#attach-file-input', {
    name: 'multi.zip', mimeType: 'application/zip', buffer: multiZipBytes,
  });
  await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
  await page.fill('#composer-text', 'archive multi-membres');
  await page.evaluate(() => { if (typeof onSendBtn === 'function') onSendBtn(); });
  await page.waitForFunction(() => {
    try { return !!getCachedRecordByAttId('att-3', currentConvId); } catch (e) { return false; }
  }, null, { timeout: 30000 });

  const multiListing = await callTool_('miaou__docs__list', { ref: 'att-3' });
  check('docs__list liste a.txt et sub/b.txt', multiListing.ok
    && /a\.txt/.test(multiListing.text) && /sub\/b\.txt/.test(multiListing.text),
    multiListing.text.slice(0, 200));
  check('l\'entrée sub/ est comptée comme répertoire, pas comme membre',
    /r[ée]pertoire/i.test(multiListing.text) && /\b2 membres\b/.test(multiListing.text),
    multiListing.text.split('\n')[0]);

  // ── Format non géré : erreur ACTIONNABLE, sans serveur branché ─────────────
  // Rattrapage du cas dégradé côté OUTIL (docsUnsupportedFormatMessage), jamais
  // côté doctrine : DOCS_DOCTRINE est statique et ignore l'état de branchement.
  const notZip = await page.evaluate(async () => {
    try {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x00]);   // %PDF-1.4
      const id = await _storeBlock('application/pdf', 'faux.pdf', bytes.buffer, 'binary', currentConvId);
      const r = await callTool('miaou__docs__list', { ref: id });
      return { id, text: typeof r === 'string' ? r : ((r.content && r.content[0] && r.content[0].text) || '') };
    } catch (e) { return { id: '', text: 'throw:' + (e && e.message) }; }
  });
  check('docs__list sur un non-zip renvoie une erreur actionnable',
    /n'est pas une archive zip/i.test(notZip.text), notZip.text.slice(0, 200));
  check('sans serveur branché, le message le DIT au lieu de nommer un outil absent',
    /aucun outil branch/i.test(notZip.text), notZip.text.slice(0, 200));

  // ── Description automatique d'un fichier de bibliothèque (étape 6) ─────────
  // Bifurcation par type en amont de findDocsInflationTool() : sans serveur MCP,
  // le chemin serveur rendrait null ; le natif doit produire le listing.
  // Le record de la bibliothèque est simulé à partir des octets déjà en cache
  // (att-1 = log.zip) : c'est bien le RECORD que lit la fonction, pas un handle.
  const desc = await page.evaluate(async () => {
    try {
      const src = getCachedRecordByAttId('att-1', currentConvId);
      const rec = { id: 'file-verify', kind: 'library', class: 'binary',
        name: 'archive.zip', mime: 'application/zip', size: src.size, data: src.data };
      const text = await extractBinaryFileTextForDescription(rec, 8 * 1024);
      return { ok: !!text, text: (text || '').slice(0, 200) };
    } catch (e) { return { ok: false, text: 'throw:' + (e && e.message) }; }
  });
  check('un zip se décrit par son listing natif, sans serveur MCP branché',
    desc.ok && /pihole\.log/.test(desc.text), desc.text.slice(0, 160));

  await page.screenshot({ path: path.join(outDir, '4-multi_and_description.png'), fullPage: true }).catch(() => {});

} catch (e) {
  console.error('  FAIL  exception : ' + (e && e.message));
  failures.push('exception: ' + (e && e.message));
  exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

console.log('\n────────────────────────────────────────────');
if (failures.length) {
  console.log('  ÉCHECS (' + failures.length + ') :\n   - ' + failures.join('\n   - '));
  process.exit(exitCode || 1);
} else {
  console.log('  OK — tous les points de la checklist V-1 sont verts.');
  process.exit(0);
}
