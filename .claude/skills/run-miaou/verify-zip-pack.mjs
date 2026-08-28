#!/usr/bin/env node
// Vérif e2e du lot V-2 (MIAOU) : CRÉATION native d'une archive zip par le modèle
// (miaou__docs__pack), sans aucun serveur MCP compagnon. Pendant de
// verify-zip-native.mjs (V-1, lecture) — même famille, aucun proxy requis.
//
// Chemin réellement exercé (modèle STUBÉ, aucun appel réseau sortant) :
//   1. Trois ressources sont créées via _storeBlock dans la conversation
//      courante — dont DEUX PORTANT LE MÊME NOM, pour exercer la déduplication.
//   2. miaou__docs__pack(handles=[res_…, res_…, res_…]) — handler async :
//      buildZipMemberName → validateZipPlan (purs) → lazy-load fflate → zipSync
//      → _storeBlock classe 'binary' → formatResourceDescriptor.
//   3. ALLER-RETOUR COMPLET, le point le plus parlant du sous-lot : on relit
//      l'archive produite par miaou__docs__list, puis on ré-extrait un membre
//      par miaou__docs__extract et on compare les octets à la source. Un nom de
//      membre est un IDENTIFIANT : s'il ne revient pas à l'identique, le membre
//      est inatteignable (leçon payée en clôture V-1 sur les noms non-UTF-8).
//
// Checklist (mémoire projet no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - docs__pack est enregistré nativement et exposé au modèle
//   - deux ressources homonymes → l'archive porte rapport.md ET rapport-2.md
//   - aller-retour : docs__list sur le res_… produit rend les membres attendus
//   - aller-retour : docs__extract rend le contenu d'origine OCTET POUR OCTET
//   - le retour au modèle contient un [resource id=…] et AUCUN [resource_ref:
//   - deux acks sont poussés (resource_stored + docs_pack), count = nb membres
//   - le bouton de téléchargement .ack-dl est présent sur l'ack resource_stored
//   - handle inexistant → échec NOMMANT le handle, et rien n'est matérialisé
//   - handle hors du cache de session → même message qu'inexistant (no-oracle)
//   - handles: [] → refus, aucune archive de zéro membre créée
//   - le record produit est mime application/zip et classe 'binary'
//   - window.fflate.zipSync est une fonction après l'appel (garde étendue V-2)
//
// PAS de fixture disque : toutes les ressources sont fabriquées en page. Le
// refus de cap (total > MAX_INLINE_BYTES) n'est PAS exercé ici — allouer 64 Mo
// dans un navigateur Playwright rendrait le script lent et instable ; ce refus
// est couvert en QuickJS (tests/test-zip.js), là où il est gratuit.
//
// Usage : node verify-zip-pack.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait. Aucun serveur à lancer.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-zip-pack');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};

if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }

// ── Stub modèle : aucun appel réseau ne doit sortir ──────────────────────────
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([]));   // AUCUN serveur
  } catch (e) {}
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
};

const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(initScript);
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error] ' + m.text()); });

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
  // Attendre la CLASSE .boot-done, jamais la visibilité (l'overlay la porte
  // parce qu'il vient d'être estompé — mémoire boot_overlay_hides_playwright_shots).
  await page.waitForFunction(
    () => document.getElementById('boot-overlay').classList.contains('boot-done'),
    null, { timeout: 15000 },
  );

  const noServers = await page.evaluate(() =>
    (typeof _remoteTools === 'undefined') || Object.keys(_remoteTools).length === 0);
  check('aucun serveur MCP branché (le natif est bien seul en jeu)', noServers);

  const registered = await page.evaluate(() => {
    const t = TOOLS.find((x) => x.name === 'docs__pack');
    return {
      present: !!t,
      required: t ? JSON.stringify(t.inputSchema.required) : null,
      // Description vue par le modèle : la borne négative doit y être.
      negBound: t ? /ne crée aucun contenu/i.test(t.description) : false,
    };
  });
  check('docs__pack enregistré nativement', registered.present, JSON.stringify(registered));
  check('docs__pack exige handles', registered.required === '["handles"]', String(registered.required));
  check('sa description porte la borne négative « ne crée aucun contenu »', registered.negBound);

  // ── Trois ressources sources, dont DEUX HOMONYMES ─────────────────────────
  // Un message est d'abord envoyé pour que la conversation existe réellement.
  await page.fill('#composer-text', 'préparation des ressources');
  await page.evaluate(() => { if (typeof onSendBtn === 'function') onSendBtn(); });
  await page.waitForFunction(() => typeof currentConvId !== 'undefined' && !!currentConvId,
    null, { timeout: 30000 });

  const sources = await page.evaluate(async () => {
    const enc = (s) => new TextEncoder().encode(s);
    const mk = (mime, name, body, cls) =>
      _storeBlock(mime, name, enc(body), cls, currentConvId, Date.now(), Math.random);
    // F1 — deux ressources textuelles au MÊME nom : exerce la déduplication.
    const a = await mk('text/markdown', 'rapport.md', '# Premier rapport\nalpha\n', 'inline');
    const b = await mk('text/markdown', 'rapport.md', '# Second rapport\nbeta\n', 'inline');
    // F2 — une ressource binaire : vérifie qu'un membre non textuel passe.
    const c = await _storeBlock('image/png', 'vignette.png',
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
      'binary', currentConvId, Date.now(), Math.random);
    return { a, b, c, bodyA: '# Premier rapport\nalpha\n' };
  });
  check('trois ressources sources créées', !!(sources.a && sources.b && sources.c),
    JSON.stringify({ a: sources.a, b: sources.b, c: sources.c }));

  // ── Refus : plan vide, handle inexistant, handle hors conversation ────────
  const before = await page.evaluate(() => _pendingToolAcks.length);

  const empty = await callTool_('miaou__docs__pack', { handles: [] });
  check('handles: [] → refus', /au moins un/i.test(empty.text), empty.text.slice(0, 160));

  const ghost = await callTool_('miaou__docs__pack', { handles: [sources.a, 'res_zzzzzzzz'] });
  check('handle inexistant → échec NOMMANT le handle fautif',
    /introuvable/i.test(ghost.text) && /res_zzzzzzzz/.test(ghost.text), ghost.text.slice(0, 160));

  // F4 — handle d'une AUTRE conversation. Pour la famille `res_...`,
  // resolveHandleRecord n'applique AUCUN filtre de convId (contrairement a
  // `att-N`, filtre par conversation, et `file-<id>`, filtre par Space) :
  // l'hermeticite vient du CACHE DE SESSION. En usage reel, ouvrir une
  // conversation charge ses ressources et pas celles des autres. Le test doit
  // donc reproduire cette condition — un record cree par _storeBlock est en
  // cache par construction, et l'evincer est ce qui simule « appartient a une
  // autre conversation » (memoire verify_needs_real_env_data : une fixture non
  // representative valide un cas qui n'existe pas).
  const foreign = await page.evaluate(async () => {
    const other = await _storeBlock('text/plain', 'ailleurs.txt',
      new TextEncoder().encode('hors scope'), 'inline',
      'conv-etrangere-xyz', Date.now(), Math.random);
    invalidateResourceCache([other]);   // hors cache de session = hors portee
    return other;
  });
  const cross = await callTool_('miaou__docs__pack', { handles: [foreign] });
  check('handle hors du cache de session -> MEME message qu\'introuvable (no-oracle)',
    /introuvable/i.test(cross.text), cross.text.slice(0, 160));

  // Aucun refus ne doit avoir matérialisé quoi que ce soit.
  const zipsAfterRefusals = await page.evaluate(async () => {
    const all = await getAllResources();
    return all.filter((r) => r.mime === 'application/zip').length;
  });
  check('aucun refus n\'a matérialisé d\'archive', zipsAfterRefusals === 0, String(zipsAfterRefusals));

  await page.evaluate((n) => { _pendingToolAcks.length = n; }, before);

  // ── L'appel nominal ───────────────────────────────────────────────────────
  const packed = await callTool_('miaou__docs__pack',
    { handles: [sources.a, sources.b, sources.c], name: 'livrables' });
  check('docs__pack réussit', packed.ok, packed.text.slice(0, 200));
  check('le retour contient un descripteur [resource id=…]',
    /\[resource id=res_[^\]]+\]/.test(packed.text), packed.text.slice(0, 200));
  // Piège 26c — repris tel quel de verify-zip-native.
  check('le retour ne contient AUCUN [resource_ref: (piège 26c)',
    packed.text.indexOf('[resource_ref:') === -1, packed.text.slice(0, 200));
  check('le nom d\'archive reçoit son extension .zip',
    /name="livrables\.zip"/.test(packed.text), packed.text.slice(0, 200));
  check('le retour signale que le téléchargement est déjà proposé',
    /t[ée]l[ée]chargement dans le fil/i.test(packed.text), packed.text.slice(0, 200));

  // La garde étendue de ensureFflate (V-2, point ouvert 4) : les DEUX fonctions.
  const ff = await page.evaluate(() => ({
    unzip: !!(window.fflate && typeof window.fflate.unzipSync === 'function'),
    zip: !!(window.fflate && typeof window.fflate.zipSync === 'function'),
  }));
  check('fflate expose zipSync après l\'appel (garde étendue V-2)', ff.zip && ff.unzip,
    JSON.stringify(ff));

  // ── Deux acks, et le bouton de téléchargement ─────────────────────────────
  const acks = await page.evaluate(() => _pendingToolAcks.map((a) => ({
    kind: a.kind, ok: a.ok, count: a.count, name: a.resourceName, mime: a.mime,
  })));
  const packAck = acks.find((a) => a.kind === 'docs_pack');
  const storedAck = acks.find((a) => a.kind === 'resource_stored');
  check('un ack docs_pack est poussé, count = 3 membres',
    !!packAck && packAck.ok === true && packAck.count === 3, JSON.stringify(packAck));
  check('_storeBlock pousse AUSSI resource_stored (deux acks par appel)',
    !!storedAck, JSON.stringify(acks.map((a) => a.kind)));
  // Le bouton vient de resource_stored via ackDownloadTarget, PAS de docs_pack.
  const dlTargets = await page.evaluate(() => _pendingToolAcks.map((a) => !!ackDownloadTarget(a)));
  check('ackDownloadTarget désigne une cible téléchargeable pour l\'archive',
    dlTargets.some((x) => x), JSON.stringify(dlTargets));

  // ── Le record produit ─────────────────────────────────────────────────────
  const rec = await page.evaluate(async () => {
    const all = await getAllResources();
    const z = all.filter((r) => r.mime === 'application/zip');
    if (!z.length) return null;
    const r = z[z.length - 1];
    return { id: r.id, name: r.name, mime: r.mime, cls: r.class, size: r.size };
  });
  check('le record produit est application/zip de classe binary',
    !!rec && rec.mime === 'application/zip' && rec.cls === 'binary', JSON.stringify(rec));

  // ── ALLER-RETOUR : relire l'archive par les outils de LECTURE (V-1) ───────
  const packedId = packed.text.match(/\[resource id=(res_[^\s\]]+)/);
  check('l\'id de l\'archive est lisible dans le retour', !!packedId, packed.text.slice(0, 120));
  const zipRef = packedId ? packedId[1] : null;

  const listed = await callTool_('miaou__docs__list', { ref: zipRef });
  check('docs__list relit l\'archive produite', listed.ok, listed.text.slice(0, 200));
  check('déduplication observable : rapport.md ET rapport-2.md',
    /\brapport\.md\b/.test(listed.text) && /\brapport-2\.md\b/.test(listed.text),
    listed.text.slice(0, 300));
  check('le membre binaire figure aussi dans l\'archive',
    /vignette\.png/.test(listed.text), listed.text.slice(0, 300));
  check('l\'archive compte 3 membres', /3 membres/.test(listed.text), listed.text.slice(0, 120));

  // Le point le plus parlant : le contenu revient OCTET POUR OCTET. C'est ce qui
  // ferme l'exigence d'aller-retour du nom de membre — lister ne suffit pas, il
  // faut que le nom listé permette de RECIBLER le membre.
  const extracted = await callTool_('miaou__docs__extract', { ref: zipRef, path: 'rapport.md' });
  check('docs__extract recible un membre de l\'archive produite', extracted.ok,
    extracted.text.slice(0, 200));
  const roundTrip = await page.evaluate(async ({ text, expected }) => {
    const m = text.match(/\[resource id=(res_[^\s\]]+)/);
    if (!m) return { ok: false, why: 'pas d\'id dans le retour' };
    const r = getCachedRecord(m[1]);
    if (!r) return { ok: false, why: 'record absent du cache' };
    const got = new TextDecoder().decode(new Uint8Array(r.data));
    return { ok: got === expected, why: JSON.stringify(got).slice(0, 120) };
  }, { text: extracted.text, expected: sources.bodyA });
  check('le membre ré-extrait est identique à la source, octet pour octet',
    roundTrip.ok, roundTrip.why);

  await page.screenshot({ path: path.join(outDir, '1-pack.png'), fullPage: true }).catch(() => {});

  // ── Le bouton .ack-dl dans le DOM ─────────────────────────────────────────
  // callTool pousse dans _pendingToolAcks mais NE REND RIEN : le rendu appartient
  // a la boucle d'outils (placeToolAck). Pour verifier le DOM il faut donc passer
  // par le vrai chemin — les acks entrent dans le fil comme entrees de thread en
  // role 'tool-ack', puis renderThread les place. On reproduit exactement ca, en
  // recopiant les champs par ACK_COPY_FIELDS (jamais une copie manuelle) et en
  // re-rendant par rerenderCurrentThread, jamais renderThread nu (piege 28).
  const rendered = await page.evaluate(() => {
    for (const a of _pendingToolAcks) {
      const entry = { role: 'tool-ack' };
      copyAckFields(a, entry);
      currentThread.push(entry);
    }
    // Un groupe d'acks (et donc son badge de bascule) n'existe que si les acks
    // sont places DANS une bulle assistant : renderThread accumule les entrees
    // 'tool-ack' et ne les groupe qu'en rencontrant l'assistant qui suit. Sans
    // bulle hote, ils sortent nus par la branche orpheline — exactement la
    // situation du piege 27. La vraie boucle d'outils materialise donc toujours
    // un assistant apres ses acks ; on reproduit ce meme geste.
    currentThread.push({ role: 'assistant', content: '', _acksOnly: true });
    rerenderCurrentThread();
    return {
      acks: document.querySelectorAll('.tool-ack').length,
      badges: document.querySelectorAll('.ack-badge').length,
    };
  });
  check('les acks sont rendus dans le fil', rendered.acks > 0, JSON.stringify(rendered));

  // ⚠️ En mode compact, un SEUL .tool-ack est visible par groupe (les autres
  // vivent dans la WeakMap ackNodeOf) : querySelectorAll(...)[n] echouerait.
  // Le badge (>= 2 acks) bascule en mode liste — on clique reellement, ce qui
  // exerce le chemin utilisateur (memoire compact_ack_group_single_node_in_dom).
  check('le groupe porte un badge de bascule (>= 2 acks)', rendered.badges > 0,
    'badges: ' + rendered.badges);
  if (rendered.badges > 0) {
    await page.locator('.ack-badge').first().click();
    await page.waitForTimeout(400);   // laisse l'animation de bascule finir
  }
  const dlPresent = await page.evaluate(() => document.querySelectorAll('.ack-dl').length);
  check('un bouton de telechargement .ack-dl est rendu dans le fil',
    dlPresent > 0, 'boutons: ' + dlPresent);

  await page.screenshot({ path: path.join(outDir, '2-ack-dl.png'), fullPage: true }).catch(() => {});

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
  console.log('  OK — tous les points de la checklist V-2 sont verts.');
  process.exit(0);
}
