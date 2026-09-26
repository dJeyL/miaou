#!/usr/bin/env node
// Vérification des pastilles de source web (lot AI-2) et du canal `_meta` des
// appels MCP (AI-3b) : la couche DOM que QuickJS ne voit pas — marked et
// DOMPurify réels, cascade CSS, infobulle à icône, délégation du « +N ».
// Les purs (registre, provenance, normalisation, groupement, validation de
// l'icône) sont testés dans tests/test-utils.js.
//
// Ce qui est vérifié :
//   A. rendu : un groupe de pastilles en fin de paragraphe ET dans un item de
//      liste (HTML inline gardé par marked, jamais avalé en bloc) ; libellé
//      nom de site / domaine ; favicon (<img> data: gardé par DOMPurify) ou
//      globe ; `target`/`rel` posés ; états : consultée, relayée (compte rendu
//      d'agent), non consultée en pointillé (style CALCULÉ, pas la classe) ;
//      `webMeta` a traversé la projection de reload (ACK_COPY_FIELDS) ;
//   B. groupe de cinq : deux pastilles repliées (display calculé), « +2 »
//      visible, clic → dépli et bouton retiré ;
//   C. infobulle : icône à côté du titre (favicon, sinon globe), détail
//      site · domaine, constat « Page absente… » ; la pastille ne change pas de
//      largeur au survol (flèche posée, pas ajoutée) ;
//   D. évacuation simulée (result réécrit en handle, re-rendu) : aucune
//      pastille ne change d'état — le mémo du registre est bien invalidé et la
//      provenance ne lit pas `result` ;
//   E. streaming : pastille résolue pendant le streaming, marqueur ouvert
//      masqué ;
//   F. export HTML : lien ordinaire « (Site A) », aucune pastille ni marqueur ;
//      copie : lien Markdown, aucun marqueur ;
//   G. callRemoteTool relaie `_meta` (mcpRpc bouchonné), webMetaFromResult le
//      lit — le maillon réseau du canal, hors génération ;
//   H. doctrine : la consigne web_ref est dans le message système composé,
//      dont la longueur est imprimée (à comparer au bundle d'avant).
//
// Fixtures construites ici (page.evaluate). Rejeu contre un autre bundle :
// VERIFY_DIST=/chemin/miaou.html node verify-web-refs.mjs
//
// Usage : node verify-web-refs.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
await page.waitForTimeout(400);

// ── Fixture ─────────────────────────────────────────────────────────────────
// a.com : lue, webMeta complet avec favicon (PNG réel, canvas) ;
// www.b.com : lue, sans webMeta (repli domaine + globe) ;
// d.io : relayée par un agent (message user à agentResult) ;
// c.org : vue seulement en recherche (titre repris), jamais lue → pointillé.
const FAV = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const g = c.getContext('2d'); g.fillStyle = '#2e7d32'; g.fillRect(2, 2, 12, 12);
  return c.toDataURL('image/png');
});
await page.evaluate((fav) => {
  const now = Date.now();
  const five = ['https://a.com/p', 'https://www.b.com/', 'https://d.io/x', 'https://c.org/x', 'https://e.net/y']
    .map(u => '[web_ref:' + u + ']').join(' ');
  saveConversation({ id: 'c-web', title: 'Sources', timestamp: now, spaceId: DEFAULT_SPACE_ID,
    messages: [
      { role: 'user', content: 'Cherche.' },
      { role: 'tool-ack', kind: 'mcp_call', server: 'ddg', name: 'ddg__ddg_search', args: { query: 'q' },
        result: JSON.stringify([{ title: 'Titre C vu en recherche', url: 'https://c.org/x', snippet: '…' }]), ts: now, group: 'gvw1' },
      { role: 'tool-ack', kind: 'mcp_call', server: 'web', name: 'web__fetch_url', args: { url: 'https://a.com/p' },
        result: 'Contenu de la page A', ts: now, group: 'gvw2',
        webMeta: { title: 'Titre A', site_name: 'Site A', canonical_url: 'https://a.com/p', favicon: fav } },
      { role: 'tool-ack', kind: 'mcp_call', server: 'web', name: 'web__fetch_url', args: { url: 'https://www.b.com' },
        result: 'Contenu de la page B', ts: now, group: 'gvw2' },
      { role: 'user', content: "[Résultat d'agent — terminé]\n\n--- Réponse de l'agent ---\n\nVu. [web_ref:https://d.io/x]",
        agentResult: { id: 'c-absent', status: 'done', intent: 'lire' } },
      { role: 'assistant', content:
        'Affirmation lue. [web_ref:https://a.com/p] [web_ref:https://www.b.com/]\n\n' +
        '- item de liste relayé [web_ref:https://d.io/x]\n' +
        '- item non consulté [web_ref:https://c.org/x]\n\n' +
        'Cinq sources : ' + five },
    ] });
}, FAV);
await page.evaluate(() => openConversation('c-web'));
await page.waitForFunction(() => document.querySelectorAll('#thread .body a.web-ref').length > 0, null, { timeout: 5000 }).catch(() => {});

// ── A. Rendu ────────────────────────────────────────────────────────────────
const A = await page.evaluate(() => {
  const body = document.querySelector('#thread .msg.assistant .body');
  const groups = [...body.querySelectorAll('.web-refs')];
  const pill = (u) => [...body.querySelectorAll('a.web-ref')].find(a => a.getAttribute('href') === u);
  const info = (a) => a && {
    cls: a.className, label: (a.querySelector('.wr-label') || {}).textContent,
    img: !!a.querySelector('img.wr-icon'), imgSrc: (a.querySelector('img.wr-icon') || {}).src || '',
    globe: !!a.querySelector('.wr-globe'), target: a.getAttribute('target'), rel: a.getAttribute('rel'),
    tipIcon: a.getAttribute('data-tip-icon') || '', parentTag: a.closest('.web-refs').parentElement.tagName,
    borderStyle: getComputedStyle(a).borderTopStyle, bg: getComputedStyle(a).backgroundColor,
  };
  return {
    groups: groups.length,
    raw: /\[web_ref:/.test(body.textContent),
    a: info(pill('https://a.com/p')), b: info(pill('https://www.b.com/')),
    d: info(pill('https://d.io/x')), c: info(pill('https://c.org/x')),
    ackMeta: !!(currentThread.find(m => m.webMeta) || {}).webMeta,
  };
});
check('A. prémisse : webMeta a traversé la projection de reload', A.ackMeta);
check('A. quatre groupes rendus, aucun marqueur brut', A.groups === 4 && !A.raw, A.groups);
check('A. groupe en fin de paragraphe', A.a && A.a.parentTag === 'P', A.a && A.a.parentTag);
check('A. groupe dans un item de liste', A.d && A.d.parentTag === 'LI', A.d && A.d.parentTag);
check('A. consultée : libellé = nom de site', A.a && A.a.label === 'Site A', A.a && A.a.label);
check('A. favicon <img> data: gardée par DOMPurify', A.a && A.a.img && A.a.imgSrc === FAV);
check('A. data-tip-icon gardé', A.a && A.a.tipIcon === FAV);
check('A. sans webMeta : domaine sans www, globe', A.b && A.b.label === 'b.com' && A.b.globe && !A.b.img, A.b && A.b.label);
check('A. target _blank + rel noopener', A.a && A.a.target === '_blank' && /noopener/.test(A.a.rel || ''));
check('A. relayée : classe relayed, pas unverified', A.d && /\brelayed\b/.test(A.d.cls) && !/unverified/.test(A.d.cls), A.d && A.d.cls);
check('A. non consultée : bordure pointillée CALCULÉE', A.c && A.c.borderStyle === 'dashed', A.c && A.c.borderStyle);
check('A. consultée : pas de pointillé', A.a && A.a.borderStyle !== 'dashed', A.a && A.a.borderStyle);
check('A. non consultée : libellé = titre vu en recherche', A.c && A.c.label === 'Titre C vu en recherche', A.c && A.c.label);

// ── B. Groupe de cinq ───────────────────────────────────────────────────────
const lastGroup = () => page.evaluate(() => {
  const g = [...document.querySelectorAll('#thread .body .web-refs')].pop();
  const pills = [...g.querySelectorAll('a.web-ref')];
  const more = g.querySelector('button.web-ref-more');
  return {
    total: pills.length,
    shown: pills.filter(a => getComputedStyle(a).display !== 'none').length,
    more: more ? { text: more.textContent, display: getComputedStyle(more).display } : null,
  };
});
const B1 = await lastGroup();
check('B. cinq pastilles, trois affichées', B1.total === 5 && B1.shown === 3, B1.total + '/' + B1.shown);
check('B. « +2 » visible', B1.more && B1.more.text === '+2' && B1.more.display !== 'none', JSON.stringify(B1.more));
await page.evaluate(() => [...document.querySelectorAll('#thread .body .web-refs')].pop().querySelector('button.web-ref-more').click());
const B2 = await lastGroup();
check('B. clic : les cinq affichées, bouton retiré', B2.shown === 5 && B2.more === null, B2.shown);

// ── C. Infobulle ────────────────────────────────────────────────────────────
const hoverPill = async (url) => {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const r = await page.evaluate((u) => {
    const a = [...document.querySelectorAll('#thread .body a.web-ref')].find(x => x.getAttribute('href') === u);
    a.scrollIntoView({ block: 'center' });
    const b = a.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width };
  }, url);
  await page.mouse.move(r.x, r.y, { steps: 3 });
  await page.waitForFunction(() => { const el = document.querySelector('body > .tip'); return el && el.classList.contains('tip-shown'); }, null, { timeout: 3000 }).catch(() => {});
  const t = await page.evaluate((u) => {
    const el = document.querySelector('body > .tip');
    const a = [...document.querySelectorAll('#thread .body a.web-ref')].find(x => x.getAttribute('href') === u);
    if (!el || !el.classList.contains('tip-shown')) return null;
    const head = el.querySelector('.tip-head');
    const img = el.querySelector('img.tip-icon');
    return {
      hasIcon: el.classList.contains('has-icon'),
      headOrder: head ? [...head.children].map(c => c.className) : [],
      imgSrc: img ? img.src : '', globe: !!el.querySelector('.tip-icon-globe'),
      label: (el.querySelector('.tip-label') || {}).textContent,
      detail: (el.querySelector('.tip-detail') || {}).textContent,
      hoverW: a.getBoundingClientRect().width,
      arrow: getComputedStyle(a, '::after').display,
    };
  }, url);
  return { rest: r, tip: t };
};
const CA = await hoverPill('https://a.com/p');
check('C. favicon à côté du titre (icône puis libellé)', CA.tip && CA.tip.hasIcon && CA.tip.imgSrc === FAV &&
  CA.tip.headOrder[0] === 'tip-icon' && CA.tip.headOrder[1] === 'tip-label', CA.tip && CA.tip.headOrder.join(','));
check('C. titre puis site · domaine', CA.tip && CA.tip.label === 'Titre A' && CA.tip.detail === 'Site A · a.com', CA.tip && CA.tip.detail);
check('C. flèche affichée au survol', CA.tip && CA.tip.arrow === 'block', CA.tip && CA.tip.arrow);
check('C. largeur inchangée au survol', CA.tip && Math.abs(CA.tip.hoverW - CA.rest.w) < 0.5, CA.tip && CA.rest.w + ' → ' + CA.tip.hoverW);
const CC = await hoverPill('https://c.org/x');
check('C. sans favicon : globe', CC.tip && CC.tip.globe && !CC.tip.imgSrc);
check('C. non consultée : constat', CC.tip && /Page absente des outils de cette conversation/.test(CC.tip.detail || ''), CC.tip && CC.tip.detail);
const CD = await hoverPill('https://d.io/x');
check('C. relayée : « Consultée par un agent »', CD.tip && /Consultée par un agent/.test(CD.tip.detail || ''), CD.tip && CD.tip.detail);
await page.mouse.move(5, 5);

// ── D. Évacuation simulée ───────────────────────────────────────────────────
const D = await page.evaluate(() => {
  for (const m of currentThread) {
    if (m.role === 'tool-ack' && typeof m.result === 'string') m.result = '[resource_stored:res_evac — 40 caractères]';
  }
  rerenderCurrentThread();
  const pill = (u) => [...document.querySelectorAll('#thread .body a.web-ref')].find(a => a.getAttribute('href') === u);
  return { a: pill('https://a.com/p').className, b: pill('https://www.b.com/').className, c: pill('https://c.org/x').className,
    cLabel: pill('https://c.org/x').querySelector('.wr-label').textContent };
});
check('D. après évacuation : a.com et b.com toujours consultées', !/unverified/.test(D.a) && !/unverified/.test(D.b), D.a + ' / ' + D.b);
check('D. après évacuation : c.org toujours non consultée', /unverified/.test(D.c), D.c);
check('D. titre de recherche perdu → repli sur le domaine (mémo invalidé)', D.cLabel === 'c.org', D.cLabel);

// ── E. Streaming ────────────────────────────────────────────────────────────
const E = await page.evaluate(() => {
  const wrap = document.createElement('div');
  const body = document.createElement('div');
  wrap.appendChild(body); document.querySelector('#thread').appendChild(wrap);
  renderStreamBlocks(wrap, body, 'Lu. [web_ref:https://a.com/p] Suite [web_ref:https://a.co', { caret: true });
  const r = { pill: !!body.querySelector('a.web-ref'), raw: /web_ref/.test(body.textContent) };
  wrap.remove();
  return r;
});
check('E. streaming : pastille résolue, marqueur ouvert masqué', E.pill && !E.raw, JSON.stringify(E));

// ── F. Export HTML et copie ─────────────────────────────────────────────────
const F = await page.evaluate(async () => {
  // renderExportBody rend le HTML du corps (chaîne), relu dans un fragment.
  const html = await renderExportBody(currentThread, 'c-web');
  const c = document.createElement('div');
  c.innerHTML = html;
  const link = [...c.querySelectorAll('a')].find(a => a.getAttribute('href') === 'https://a.com/p');
  // Corps ASSISTANT seulement : le compte rendu d'agent (message user) passe par
  // renderUserMd, à l'écran comme à l'export, et y laisse ses marqueurs bruts —
  // défaut antérieur au lot, signalé, hors de ce contrôle.
  const asst = [...c.querySelectorAll('.msg.assistant .body')].map(b => b.textContent).join('\n');
  return { raw: /\[web_ref:/.test(asst), pills: c.querySelectorAll('.web-ref, .web-refs').length,
    linkText: link ? link.textContent : null, hasHtml: html.length > 0 };
});
check('F. export : lien ordinaire « (Site A) »', F.linkText === '(Site A)', F.linkText);
check('F. export : ni pastille ni marqueur', F.pills === 0 && !F.raw, F.pills);
await page.evaluate(() => copyMsg(document.querySelector('#thread .msg.assistant .msg-copy')));
await page.waitForTimeout(200);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('F. copie : lien Markdown, aucun marqueur', /\[a\.com\]\(https:\/\/a\.com\/p\)/.test(clip) && !/\[web_ref:/.test(clip), clip.slice(0, 60));

// ── G. callRemoteTool relaie `_meta` ────────────────────────────────────────
const G = await page.evaluate(async (fav) => {
  const realRpc = mcpRpc;
  let solicited = 0;
  mcpRpc = async () => { solicited++; return { content: [{ type: 'text', text: 'page' }],
    _meta: { 'miaou/web': { title: 'T', site_name: 'S', favicon: fav, junk: 1 } } }; };
  try {
    const r = await callRemoteTool({ name: 'web' }, 'fetch_url', { url: 'https://a.com/p' });
    clearPendingToolAcks();
    const w = webMetaFromResult(r);
    return { solicited, meta: !!r._meta, title: w && w.title, site: w && w.site_name, fav: w && w.favicon === fav, junk: w && 'junk' in w };
  } finally { mcpRpc = realRpc; }
}, FAV);
check('G. prémisse : le mcpRpc bouchonné a été sollicité', G.solicited === 1, G.solicited);
check('G. `_meta` relayé par callRemoteTool', G.meta);
check('G. webMetaFromResult lit le contrat, rien d\'autre', G.title === 'T' && G.site === 'S' && G.fav && !G.junk, JSON.stringify(G));

// ── H. Doctrine ─────────────────────────────────────────────────────────────
const H = await page.evaluate(() => { const s = buildSystemMessage().content; return { len: s.length, has: s.indexOf('[web_ref:URL]') >= 0 }; });
check('H. consigne web_ref dans le message système composé', H.has);
console.log('  INFO  longueur du message système composé : ' + H.len + ' caractères');

check('aucune erreur console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));

await browser.close();
console.log(failures.length ? `\nÉCHEC — ${failures.length} vérification(s) en échec` : '\nOK — toutes les vérifications passent');
process.exit(failures.length ? 1 : 0);
