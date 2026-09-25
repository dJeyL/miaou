#!/usr/bin/env node
// Vérif e2e du lot V-2 (MIAOU) : CRÉATION native d'une archive zip par le modèle
// (miaou__docs__pack), sans aucun serveur MCP compagnon. Pendant de
// verify-zip-native.mjs (V-1, lecture) — même famille, aucun proxy requis.
//
// Chemin réellement exercé (modèle STUBÉ, aucun appel réseau sortant) :
//   1. Trois ressources sont créées via _storeBlock dans la conversation
//      courante — dont DEUX PORTANT LE MÊME NOM, pour exercer la déduplication.
//   2. miaou__docs__pack(handles=[{handle, path?}, …]) — handler async :
//      resolveZipMemberPath → validateZipPlan (purs) → lazy-load fflate → zipSync
//      → _storeBlock classe 'binary' → formatResourceDescriptor.
//      resolveZipMemberPath porte les quatre branches de nommage (pas de path /
//      chemin de fichier littéral / dossier terminé par « / » / refus) et la
//      dedup ; buildZipMemberName reste dessous, appelée par elle.
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
//   - une entrée en CHAÎNE NUE (ancien schéma) → refus explicite, jamais un
//     path silencieusement ignoré
//   - path "dossier/fichier.ext" → le membre porte exactement ce chemin
//   - path "dossier/" → le membre garde son nom d'origine dans ce dossier
//   - deux entrées visant le MÊME path explicite → refus (pas de renommage)
//   - un sous-dossier fait l'ALLER-RETOUR : docs__list le relit tel quel
//   - le record produit est mime application/zip et classe 'binary'
//   - window.fflate.zipSync est une fonction après l'appel (garde étendue V-2)
//   - MODIFICATION (base) : remplacement sur path explicite, dedup d'un nom hérité
//     contre la base, rangement par dossier, retrait ; membres gardés relus octet
//     pour octet ; base intacte ; retrait seul ; refus (chemin absent, appel vide,
//     remove sans base, base non-zip, archive vidée) sans rien matérialiser ;
//     ack « Archive modifiée » + bilan ; base Office qui garde mime et extension
//   - RENOMMAGE (rename) : fichier et dossier, nom libéré réoccupé par un ajout,
//     contenu renommé relu octet pour octet ; refus (collision, from absent,
//     rename sans base, renommer ET remplacer) sans rien matérialiser
//
// PAS de fixture disque : toutes les ressources sont fabriquées en page. Le
// refus de cap (total > MAX_INLINE_BYTES) n'est PAS exercé ici — allouer 64 Mo
// dans un navigateur Playwright rendrait le script lent et instable ; ce refus
// est couvert en QuickJS (tests/test-zip.js), là où il est gratuit.
//
// Usage : node verify-zip-pack.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait. Aucun serveur à lancer.
import { launchIsolated } from './stub-backend.js';
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

const browser = await launchIsolated({ headless: !headed }, { serve: false });
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
    const items = t ? t.inputSchema.properties.handles.items : null;
    return {
      present: !!t,
      required: t ? JSON.stringify(t.inputSchema.required) : null,
      // Description vue par le modèle : la borne négative doit y être.
      negBound: t ? /ne crée aucun contenu/i.test(t.description) : false,
      // FORME des items, pas seulement `required` : une assertion sur
      // `required` reste verte quel que soit le type des entrées, donc elle ne
      // prouve rien du contrat { handle, path? } (mémoire projet
      // green_check_proves_nothing — instrument qui ne lit pas la grandeur).
      itemType: items ? items.type : null,
      itemRequired: items ? JSON.stringify(items.required) : null,
      hasPath: !!(items && items.properties && items.properties.path),
      hasBase: !!(t && t.inputSchema.properties.base),
      hasRemove: !!(t && t.inputSchema.properties.remove),
    };
  });
  check('docs__pack enregistré nativement', registered.present, JSON.stringify(registered));
  // Contrat changé avec la modification d'archive : un retrait seul (base +
  // remove) n'a pas de handles, donc plus rien n'est requis au schéma — c'est le
  // handler qui refuse un appel vide (vérifié plus bas).
  check('docs__pack n\'exige plus handles au schéma, et expose base + remove',
    registered.required == null && registered.hasBase && registered.hasRemove, JSON.stringify(registered));
  check('chaque entrée est un OBJET exigeant handle, avec path facultatif',
    registered.itemType === 'object' && registered.itemRequired === '["handle"]' && registered.hasPath,
    JSON.stringify(registered));
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

  const ghost = await callTool_('miaou__docs__pack',
    { handles: [{ handle: sources.a }, { handle: 'res_zzzzzzzz' }] });
  check('handle inexistant → échec NOMMANT le handle fautif',
    /introuvable/i.test(ghost.text) && /res_zzzzzzzz/.test(ghost.text), ghost.text.slice(0, 160));

  // Ancien schéma (chaîne nue) : REFUS explicite. L'accepter en silence ferait
  // croire au modèle que son `path` a été pris en compte alors que cette forme
  // ne peut pas en porter — défaut « silence » du texte adressé au modèle.
  const legacy = await callTool_('miaou__docs__pack', { handles: [sources.a] });
  check('entrée en chaîne nue (ancien schéma) → refus explicite',
    !legacy.ok || /doit être un objet/i.test(legacy.text), legacy.text.slice(0, 160));

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
  const cross = await callTool_('miaou__docs__pack', { handles: [{ handle: foreign }] });
  check('handle hors du cache de session -> MEME message qu\'introuvable (no-oracle)',
    /introuvable/i.test(cross.text), cross.text.slice(0, 160));

  // Refus portés par les CHEMINS de membres. Ils vivent ici, et pas plus bas,
  // pour tomber dans le périmètre du « aucun refus n'a matérialisé d'archive »
  // qui suit : un refus dont on ne vérifie pas qu'il n'a rien écrit ne vérifie
  // que son message.
  //
  // Deux entrées visant le MÊME path explicite : refus, jamais un renommage
  // silencieux — la dedup ne rattrape que les noms HÉRITÉS du record.
  const clash = await callTool_('miaou__docs__pack', {
    handles: [
      { handle: sources.a, path: 'docs/rapport.md' },
      { handle: sources.b, path: 'docs/rapport.md' },
    ],
  });
  check('deux path explicites identiques → refus',
    !clash.ok || /écraserait|même chemin/i.test(clash.text), clash.text.slice(0, 200));

  const slip = await callTool_('miaou__docs__pack',
    { handles: [{ handle: sources.a, path: '../evasion.md' }] });
  check('path remontant → refus (garde zip-slip sur un chemin RÉDIGÉ par le modèle)',
    !slip.ok || /non sûr/i.test(slip.text), slip.text.slice(0, 200));

  // Aucun refus ne doit avoir matérialisé quoi que ce soit.
  const zipsAfterRefusals = await page.evaluate(async () => {
    const all = await getAllResources();
    return all.filter((r) => r.mime === 'application/zip').length;
  });
  check('aucun refus n\'a matérialisé d\'archive', zipsAfterRefusals === 0, String(zipsAfterRefusals));

  await page.evaluate((n) => { _pendingToolAcks.length = n; }, before);

  // ── L'appel nominal ───────────────────────────────────────────────────────
  const packed = await callTool_('miaou__docs__pack',
    { handles: [{ handle: sources.a }, { handle: sources.b }, { handle: sources.c }], name: 'livrables' });
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

  // ── Chemins de membres : renommage et sous-dossiers ───────────────────────
  // Second appel nominal, dédié aux `path`. L'ALLER-RETOUR est le point : un
  // chemin de membre est un IDENTIFIANT au même titre qu'un nom nu, donc il ne
  // suffit pas que zipSync l'accepte — il doit revenir tel quel par docs__list,
  // sinon le membre est inatteignable (leçon des noms non-UTF-8, clôture V-1).
  const tree = await callTool_('miaou__docs__pack', {
    handles: [
      // Renommage + rangement en une fois, extension comprise.
      { handle: sources.a, path: 'machins/machin.md' },
      // Dossier seul : le nom d'origine (rapport.md) est conservé.
      { handle: sources.b, path: 'machins/' },
      // Sans path : racine, nom d'origine.
      { handle: sources.c },
    ],
    name: 'arborescence',
  });
  check('docs__pack accepte des chemins de membres', tree.ok, tree.text.slice(0, 200));
  const treeId = tree.text.match(/\[resource id=(res_[^\s\]]+)/);
  const treeRef = treeId ? treeId[1] : null;

  const treeListed = await callTool_('miaou__docs__list', { ref: treeRef });
  check('docs__list relit l\'archive arborescente', treeListed.ok, treeListed.text.slice(0, 200));
  check('le path de fichier fait l\'aller-retour : machins/machin.md',
    /machins\/machin\.md/.test(treeListed.text), treeListed.text.slice(0, 300));
  check('le path « dossier/ » garde le nom d\'origine : machins/rapport.md',
    /machins\/rapport\.md/.test(treeListed.text), treeListed.text.slice(0, 300));
  check('l\'entrée sans path reste à la racine : vignette.png',
    /(^|\s|\|)vignette\.png/m.test(treeListed.text), treeListed.text.slice(0, 300));

  // Recibler un membre PAR SON CHEMIN : lister ne prouve pas l'adressabilité.
  const deep = await callTool_('miaou__docs__extract', { ref: treeRef, path: 'machins/machin.md' });
  check('docs__extract recible un membre par son chemin complet', deep.ok, deep.text.slice(0, 200));
  const deepRound = await page.evaluate(async ({ text, expected }) => {
    const m = text.match(/\[resource id=(res_[^\s\]]+)/);
    if (!m) return { ok: false, why: 'pas d\'id dans le retour' };
    const r = getCachedRecord(m[1]);
    if (!r) return { ok: false, why: 'record absent du cache' };
    const got = new TextDecoder().decode(new Uint8Array(r.data));
    return { ok: got === expected, why: JSON.stringify(got).slice(0, 120) };
  }, { text: deep.text, expected: sources.bodyA });
  check('le membre en sous-dossier revient octet pour octet', deepRound.ok, deepRound.why);

  // ── MODIFICATION d'une archive existante (docs__pack avec base) ──────────
  // Base = livrables.zip produite plus haut : rapport.md (A), rapport-2.md (B),
  // vignette.png. Chaque membre relu l'est par les outils de LECTURE, jamais
  // par un parseur maison : c'est l'aller-retour qui prouve que la réécriture
  // du central directory est juste.
  const readMember = async (ref, member) => {
    const r = await callTool_('miaou__docs__extract', { ref, path: member });
    return page.evaluate((text) => {
      const m = text.match(/\[resource id=(res_[^\s\]]+)/);
      const rec = m && getCachedRecord(m[1]);
      return rec ? new TextDecoder().decode(new Uint8Array(rec.data)) : 'ÉCHEC: ' + text.slice(0, 120);
    }, r.text);
  };
  const countZips = () => page.evaluate(async () =>
    (await getAllResources()).filter((r) => r.mime === 'application/zip').length);

  const extra = await page.evaluate(async () => {
    const d = await _storeBlock('text/markdown', 'remplacant.md',
      new TextEncoder().encode('# Remplaçant\ndelta\n'), 'inline', currentConvId, Date.now(), Math.random);
    return { d, bodyD: '# Remplaçant\ndelta\n' };
  });

  // Refus d'abord, pour vérifier qu'aucun n'a rien matérialisé.
  const zipsBeforeEditRefusals = await countZips();
  const rmGhost = await callTool_('miaou__docs__pack', { base: zipRef, remove: ['absent.txt'] });
  check('modif : retrait d\'un chemin absent → refus NOMMANT le chemin',
    /absent\.txt/.test(rmGhost.text) && /rien n'a été retiré/i.test(rmGhost.text), rmGhost.text.slice(0, 200));
  const noop = await callTool_('miaou__docs__pack', { base: zipRef });
  check('modif : base seule, sans ajout ni retrait → refus', /rien à modifier/i.test(noop.text), noop.text.slice(0, 200));
  const rmNoBase = await callTool_('miaou__docs__pack', { remove: ['rapport.md'] });
  check('remove sans base → refus', /qu'avec base/i.test(rmNoBase.text), rmNoBase.text.slice(0, 200));
  const notZip = await callTool_('miaou__docs__pack', { base: sources.a, handles: [{ handle: sources.c }] });
  check('modif : base qui n\'est pas un zip → refus', /pas une archive zip/i.test(notZip.text), notZip.text.slice(0, 200));
  const emptied = await callTool_('miaou__docs__pack',
    { base: zipRef, remove: ['rapport.md', 'rapport-2.md', 'vignette.png'] });
  check('modif : tout retirer → refus (archive vide)', /serait vide/i.test(emptied.text), emptied.text.slice(0, 200));
  check('modif : aucun refus n\'a matérialisé d\'archive',
    (await countZips()) === zipsBeforeEditRefusals, String(await countZips()));

  // Appel nominal : remplacement + ajout avec nom hérité en collision + ajout
  // en sous-dossier + retrait, en UN appel.
  const acksBeforeEdit = await page.evaluate(() => _pendingToolAcks.length);
  const edited = await callTool_('miaou__docs__pack', {
    base: zipRef,
    handles: [
      { handle: extra.d, path: 'rapport.md' },          // REMPLACE le membre existant
      { handle: sources.a },                            // nom hérité rapport.md : pris → dedup
      { handle: sources.b, path: 'ajouts/' },           // dossier : garde son nom
    ],
    remove: ['vignette.png'],
  });
  check('modif : docs__pack avec base réussit', edited.ok && /copie modifiée de res_/.test(edited.text),
    edited.text.slice(0, 260));
  check('modif : le retour dit que l\'original est inchangé', /original est inchangé/.test(edited.text),
    edited.text.slice(0, 260));
  check('modif : le retour porte le bilan (2 ajoutés, 1 remplacé, 1 retiré)',
    /2 ajoutés, 1 remplacé, 1 retiré/.test(edited.text), edited.text.slice(0, 260));
  check('modif : sans name, la copie garde le nom de la base',
    /name="livrables\.zip"/.test(edited.text), edited.text.slice(0, 200));
  const editedRef = (edited.text.match(/\[resource id=(res_[^\s\]]+)/) || [])[1];
  check('modif : une NOUVELLE ressource, distincte de la base', !!editedRef && editedRef !== zipRef,
    editedRef + ' vs ' + zipRef);

  const editAck = await page.evaluate((n) => {
    const a = _pendingToolAcks.slice(n).find((x) => x.kind === 'docs_pack');
    return a ? { ok: a.ok, count: a.count, zipEdit: a.zipEdit, label: ACK_KINDS.docs_pack.label(a) } : null;
  }, acksBeforeEdit);
  check('modif : ack docs_pack porte zipEdit et count = 4',
    !!editAck && editAck.count === 4 && JSON.stringify(editAck.zipEdit) === '{"added":2,"replaced":1,"removed":1,"renamed":0}',
    JSON.stringify(editAck));
  check('modif : le libellé d\'ack dit « Archive modifiée » avec le bilan',
    !!editAck && /^Archive modifiée\u00a0: livrables\.zip — 4 membres \(2 ajoutés, 1 remplacé, 1 retiré\)/.test(editAck.label),
    editAck && editAck.label);

  const editedList = await callTool_('miaou__docs__list', { ref: editedRef });
  check('modif : docs__list relit la copie, 4 membres', editedList.ok && /4 membres/.test(editedList.text),
    editedList.text.slice(0, 300));
  check('modif : le membre retiré a disparu', !/vignette\.png/.test(editedList.text), editedList.text.slice(0, 300));
  check('modif : nom hérité en collision avec la base → rapport-3.md',
    /rapport-3\.md/.test(editedList.text), editedList.text.slice(0, 300));
  check('modif : membre rangé par dossier → ajouts/rapport.md',
    /ajouts\/rapport\.md/.test(editedList.text), editedList.text.slice(0, 300));
  check('modif : le membre REMPLACÉ porte le nouveau contenu',
    (await readMember(editedRef, 'rapport.md')) === extra.bodyD);
  const keptB = await readMember(editedRef, 'rapport-2.md');
  check('modif : un membre GARDÉ revient octet pour octet (recopié, pas recompressé)',
    keptB === '# Second rapport\nbeta\n', JSON.stringify(keptB));
  check('modif : membre ajouté par nom hérité lisible',
    (await readMember(editedRef, 'rapport-3.md')) === sources.bodyA);

  const origList = await callTool_('miaou__docs__list', { ref: zipRef });
  check('modif : la base est intacte (3 membres, vignette.png toujours là)',
    /3 membres/.test(origList.text) && /vignette\.png/.test(origList.text), origList.text.slice(0, 300));
  check('modif : la base garde son contenu d\'origine',
    (await readMember(zipRef, 'rapport.md')) === sources.bodyA);

  // Retrait seul : aucun ajout, donc aucune compression.
  const rmOnly = await callTool_('miaou__docs__pack', { base: zipRef, remove: ['vignette.png'], name: 'allege' });
  check('modif : retrait seul réussit, nom fourni complété en .zip',
    rmOnly.ok && /name="allege\.zip"/.test(rmOnly.text) && /1 retiré/.test(rmOnly.text), rmOnly.text.slice(0, 260));
  const rmOnlyRef = (rmOnly.text.match(/\[resource id=(res_[^\s\]]+)/) || [])[1];
  const rmOnlyList = await callTool_('miaou__docs__list', { ref: rmOnlyRef });
  check('modif : retrait seul → 2 membres relus', /2 membres/.test(rmOnlyList.text), rmOnlyList.text.slice(0, 200));

  // Base Office : un .docx modifié reste un .docx (mime ET extension). La base
  // est reconnue aux octets — ici ceux de livrables.zip sous un mime Word.
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const docxRef = await page.evaluate(async ({ ref, mime }) => {
    const z = getCachedRecord(ref);
    return _storeBlock(mime, 'note.docx', new Uint8Array(z.data), 'binary', currentConvId, Date.now(), Math.random);
  }, { ref: zipRef, mime: DOCX_MIME });
  const docxEdit = await callTool_('miaou__docs__pack',
    { base: docxRef, handles: [{ handle: extra.d, path: 'word/ajout.xml' }], name: 'note-v2' });
  check('modif Office : le nom garde l\'extension de la base (note-v2.docx)',
    /name="note-v2\.docx"/.test(docxEdit.text), docxEdit.text.slice(0, 260));
  const docxRec = await page.evaluate((text) => {
    const m = text.match(/\[resource id=(res_[^\s\]]+)/);
    const r = m && getCachedRecord(m[1]);
    return r ? { mime: r.mime, cls: r.class } : null;
  }, docxEdit.text);
  check('modif Office : le mime de la base est conservé, classe binary',
    !!docxRec && docxRec.mime === DOCX_MIME && docxRec.cls === 'binary', JSON.stringify(docxRec));

  // ── RENOMMAGE (rename) ───────────────────────────────────────────────────
  const zipsBeforeRename = await countZips();
  const renClash = await callTool_('miaou__docs__pack',
    { base: zipRef, rename: [{ from: 'rapport.md', to: 'rapport-2.md' }] });
  check('renommage : collision avec un membre gardé → refus nommé, jamais un écrasement',
    /rapport-2\.md/.test(renClash.text) && /écraserait/.test(renClash.text), renClash.text.slice(0, 200));
  const renGhost = await callTool_('miaou__docs__pack',
    { base: zipRef, rename: [{ from: 'absent.md', to: 'x.md' }] });
  check('renommage : from absent → refus nommé', /absent\.md/.test(renGhost.text) && /rien n'a été renommé/.test(renGhost.text),
    renGhost.text.slice(0, 200));
  const renNoBase = await callTool_('miaou__docs__pack', { rename: [{ from: 'a', to: 'b' }] });
  check('rename sans base → refus', /rename n'a de sens qu'avec base/.test(renNoBase.text), renNoBase.text.slice(0, 200));
  const renAndReplace = await callTool_('miaou__docs__pack', {
    base: zipRef, rename: [{ from: 'rapport.md', to: 'x.md' }], handles: [{ handle: extra.d, path: 'x.md' }],
  });
  check('renommage : renommer ET remplacer la même cible → refus', /renomme ou remplace/.test(renAndReplace.text),
    renAndReplace.text.slice(0, 200));
  check('renommage : aucun refus n\'a matérialisé d\'archive', (await countZips()) === zipsBeforeRename);

  const renamed = await callTool_('miaou__docs__pack', {
    base: zipRef,
    rename: [
      { from: 'rapport-2.md', to: 'second/rapport.md' },
      { from: 'vignette.png', to: 'images/vignette.png' },
    ],
    handles: [{ handle: extra.d, path: 'rapport-2.md' }],   // nom LIBÉRÉ par le renommage, réoccupé
    name: 'range',
  });
  check('renommage : l\'appel réussit, bilan « 1 ajouté, 2 renommés »',
    renamed.ok && /1 ajouté, 2 renommés/.test(renamed.text), renamed.text.slice(0, 260));
  const renamedRef = (renamed.text.match(/\[resource id=(res_[^\s\]]+)/) || [])[1];
  const renamedList = await callTool_('miaou__docs__list', { ref: renamedRef });
  check('renommage : docs__list relit les nouveaux chemins, 4 membres',
    /4 membres/.test(renamedList.text) && /second\/rapport\.md/.test(renamedList.text) &&
      /images\/vignette\.png/.test(renamedList.text) && !/(^|\s)vignette\.png/m.test(renamedList.text),
    renamedList.text.slice(0, 300));
  check('renommage : le membre renommé revient octet pour octet',
    (await readMember(renamedRef, 'second/rapport.md')) === '# Second rapport\nbeta\n');
  check('renommage : le nom libéré est réoccupé par l\'ajout, pas par l\'ancien membre',
    (await readMember(renamedRef, 'rapport-2.md')) === extra.bodyD);
  const renAck = await page.evaluate(() => {
    const a = _pendingToolAcks.filter((x) => x.kind === 'docs_pack' && x.ok).pop();
    return a ? ACK_KINDS.docs_pack.label(a) : null;
  });
  check('renommage : le libellé d\'ack porte le bilan', /^Archive modifiée\u00a0: range\.zip — 4 membres \(1 ajouté, 2 renommés\)/.test(renAck || ''),
    renAck);

  const renDir = await callTool_('miaou__docs__pack',
    { base: renamedRef, rename: [{ from: 'second/', to: 'deuxieme/' }] });
  const renDirRef = (renDir.text.match(/\[resource id=(res_[^\s\]]+)/) || [])[1];
  const renDirList = await callTool_('miaou__docs__list', { ref: renDirRef });
  check('renommage seul d\'un dossier : son contenu suit',
    renDir.ok && /deuxieme\/rapport\.md/.test(renDirList.text) && !/second\//.test(renDirList.text),
    renDirList.text.slice(0, 300));

  await page.evaluate((n) => { _pendingToolAcks.length = n; }, before);
  // Les acks du fil sont ceux de l'appel nominal de création, repoussé pour la
  // section DOM qui suit (elle lit _pendingToolAcks).
  await callTool_('miaou__docs__pack',
    { handles: [{ handle: sources.a }, { handle: sources.b }, { handle: sources.c }], name: 'livrables' });

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
  console.log('  OK — tous les points de la checklist sont verts (création et modification).');
  process.exit(0);
}
