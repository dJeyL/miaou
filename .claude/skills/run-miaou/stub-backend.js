// Serveur factice commun des verify — module ES, consommé par les scripts de
// cette skill à la place de `chromium.launch()`.
//
// POURQUOI. `dist/miaou.html` embarque le `config.json` LOCAL : serveur API de
// la machine (et avec lui le chemin natif d'Ollama, `/api/tags`, `/api/ps`,
// `/api/show`), serveur MCP ajouté au premier démarrage par le seed de build,
// délais réglés par la config. Un verify qui ne neutralise pas tout ça teste la
// machine autant que le code : rejeu du 2026-09-25, 18 rouges sur 26 venaient de
// là, et ils changeaient selon que le proxy MCP tournait ou non. Chaque script
// réparait sa propre copie du montage ; celle-ci est la seule à maintenir.
//
// CE QUE ÇA POSE, dans CHAQUE contexte du navigateur (donc chaque page, onglets
// de synchro compris), avant tout script de la page :
//   - server : un serveur API fixture `http://stub.local/v1` actif, si aucun
//     tableau de serveurs n'existe encore (même garde que la migration de
//     l'appli : un script qui pose le sien, ou un reload, n'est pas écrasé) ;
//   - mcp    : aucun serveur MCP, sentinelle du seed de build posée — sans elle
//     le serveur de config.json est ajouté au tableau vide au démarrage
//     (seedBuildMcpServersIfNeeded). Premier chargement seulement ;
//   - native : la sonde native d'Ollama sur stub.local répond 404 (« pas un
//     Ollama »), au lieu de partir sur le réseau (ERR_NAME_NOT_RESOLVED) ;
//   - serve  : liste de modèles et chat servis sur stub.local — le chat en SSE
//     (une réponse courte), titrage et résumé en JSON (piège de la skill : un
//     chat servi en JSON laisse l'assistant vide).
//
// COMPOSITION avec le stub propre d'un script. L'ordre entre un init script de
// contexte (ici) et un init script de page (le script) n'est PAS défini par
// Playwright. D'où la règle : un script qui stube lui-même le chat ou les
// modèles (`window.fetch` ou `page.route`) passe `serve: false`, et ce module
// ne touche alors à rien d'autre que la sonde native — ce qui compose dans les
// deux ordres. Un script qui stube la sonde native elle-même (verify-model-*)
// passe aussi `native: false`.
//
// `window.__stubBackend.hits` compte ce que ce module a servi : un stub jamais
// sollicité rend une checklist creuse (cf. SKILL.md).
//
// AUDIT RÉSEAU (opt-in) : `VERIFY_NET_AUDIT=<fichier>` ajoute à ce fichier une
// ligne par requête sortie vers un hôte http(s) qui n'est ni stub.local ni un
// CDN de bibliothèque (liste `AUDIT_ALLOWED`) — c'est-à-dire vers le backend ou
// le proxy MCP de la machine. Rejouer le parc avec, puis lire le fichier : vide,
// l'isolation tient ; sinon il nomme le script et l'URL qui fuient.
//
// Usage :
//   import { launchIsolated } from './stub-backend.js';
//   const browser = await launchIsolated({ headless: !headed });
//   const browser = await launchIsolated({ headless }, { serve: false });

import { chromium } from 'playwright';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

export const STUB_URL = 'http://stub.local/v1';
export const STUB_MODEL = 'stub-model';

// Hôtes légitimes hors stub : bibliothèques et fontes chargées depuis un CDN.
const AUDIT_ALLOWED = /^https?:\/\/(stub\.local|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|esm\.sh)(\/|:|$)/;

const DEFAULTS = { server: true, mcp: true, native: true, serve: true, models: [STUB_MODEL] };

// Exécutée DANS la page (sérialisée par addInitScript) : aucune fermeture sur
// le module, tout passe par `o`.
function installStubBackend(o) {
  window.__stubBackend = { hits: 0, paths: [] };
  try {
    if (o.server && localStorage.getItem('miaou-api-servers') === null) {
      localStorage.setItem('miaou-api-servers', JSON.stringify([
        { id: 'srv-stub', name: 'Stub', url: o.url, key: 'stub-key', model: o.models[0] },
      ]));
      localStorage.setItem('miaou-active-api-server', 'srv-stub');
    }
    if (o.mcp && localStorage.getItem('miaou-mcp-seeded') === null) {
      localStorage.setItem('miaou-mcp-servers', '[]');
      localStorage.setItem('miaou-mcp-seeded', '1');
    }
  } catch (e) { /* storage indisponible : rien à isoler */ }

  const origin = o.url.replace(/\/v1$/, '') + '/';
  const realFetch = window.fetch.bind(window);
  const json = (body, status) => new Response(JSON.stringify(body),
    { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  const served = (url, res) => {
    window.__stubBackend.hits++;
    window.__stubBackend.paths.push(url.slice(origin.length - 1));
    return res;
  };
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(origin) !== 0) return realFetch(input, opts);
    if (o.native && /\/api\/(tags|ps|show)$/.test(url)) {
      return served(url, json({ error: 'not found' }, 404));
    }
    if (o.serve && /\/v1\/models$/.test(url)) {
      return served(url, json({ object: 'list', data: o.models.map(id => ({ id, object: 'model' })) }));
    }
    if (o.serve && /\/chat\/completions$/.test(url)) {
      let body = {};
      try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) { /* corps illisible */ }
      if (!body.stream) {
        return served(url, json({ choices: [{ message: { role: 'assistant', content: 'Titre' },
          finish_reason: 'stop' }] }));
      }
      const sse = ['Réponse du serveur factice.', null].map(c => 'data: ' + JSON.stringify({
        choices: [c ? { delta: { content: c } } : { delta: {}, finish_reason: 'stop' }],
      }) + '\n\n').join('') + 'data: [DONE]\n\n';
      return served(url, new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    }
    return realFetch(input, opts);
  };
}

// Lance Chromium et pose le montage dans chaque contexte créé ensuite.
// `browser.newPage()` crée un contexte implicite qu'on ne peut pas instrumenter
// avant sa première page : il est donc redirigé vers newContext() + newPage(),
// et le contexte est fermé avec sa page (même cycle de vie qu'avant).
export async function launchIsolated(launchOpts, backendOpts) {
  const o = Object.assign({}, DEFAULTS, { url: STUB_URL }, backendOpts || {});
  const browser = await chromium.launch(launchOpts);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (ctxOpts) => {
    const ctx = await newContext(ctxOpts);
    await ctx.addInitScript(installStubBackend, o);
    const audit = process.env.VERIFY_NET_AUDIT;
    if (audit) {
      const script = path.basename(process.argv[1] || '?');
      ctx.on('request', (r) => {
        const u = r.url();
        if (/^https?:/.test(u) && !AUDIT_ALLOWED.test(u)) appendFileSync(audit, script + ' ' + u + '\n');
      });
    }
    return ctx;
  };
  browser.newPage = async (pageOpts) => {
    const ctx = await browser.newContext(pageOpts);
    const page = await ctx.newPage();
    page.on('close', () => { ctx.close().catch(() => {}); });
    return page;
  };
  return browser;
}
