#!/usr/bin/env node
// Vérification du lot U-3 (recherche plein-texte sur conversations froides).
//
// Depuis U-1, une conversation FROIDE n'a pas ses `messages` en RAM : le scan
// de contenu de la recherche a perdu sa source synchrone. U-3 le précalcule en
// async (`collectContentSearchHits`) et passe le résultat au prédicat, resté
// synchrone. Les tests QuickJS couvrent le prédicat pur (`convContentMatches`)
// mais NI la lecture IDB, NI le débounce, NI les jetons de séquence — c'est-à-
// dire exactement ce qui peut faire afficher un résultat périmé.
//
// Scénarios :
//   1. sidebar : une conversation FROIDE (jamais ouverte) est trouvée par un mot
//      qui n'existe que dans son contenu — le cœur du lot
//   2. le match titre et le match résumé fonctionnent toujours (non-régression)
//   3. seuil : sous 3 caractères, aucun scan de contenu
//   4. rendu en deux temps : la liste se remplit sur titre/résumé sans attendre
//      la lecture IDB, puis se complète
//   5. réentrance : une frappe rapide n'affiche jamais le résultat d'une requête
//      abandonnée (jeton de séquence)
//   6. effacement du champ pendant une passe en vol : aucun filtre ne réapparaît
//   7. palette de commandes : même capacité, cross-Space, sur conversation froide
//   8. fermeture de la palette pendant une passe : pas de rendu fantôme
//
// Usage : node verify-conv-search.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-conv-search');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
const isNoise = (t) => /ERR_NAME_NOT_RESOLVED|fonts\.(googleapis|gstatic)/.test(t);
page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => { if (!isNoise(String(e))) errors.push(String(e)); });

await page.addInitScript(() => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',
    }));
  } catch (e) {}
});

const boot = async () => {
  await page.goto('file://' + distPath);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
};

// Le mot-témoin n'existe QUE dans le contenu des messages : ni titre, ni résumé.
const RARE = 'ornithorynque';

await boot();

// ── Seed direct en IDB, SANS ouvrir aucune conversation ─────────────────────
// C'est le point du lot : ces conversations restent froides (messages jamais
// chargés en étage 2). Un seed qui passerait par saveConversation les
// réchaufferait et le test ne prouverait rien.
await page.evaluate(async ({ rare }) => {
  const db = await openConvDB();
  await new Promise((r) => {
    const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
    tx.objectStore('conversations').clear();
    tx.objectStore('summaries').clear();
    tx.oncomplete = r;
  });
  const now = Date.now();
  const recs = [
    { id: 's-froide', title: 'Sujet quelconque', timestamp: now - 1000, updatedAt: now - 1000,
      spaceId: 'default',
      messages: [{ role: 'user', content: 'un mot rare : ' + rare },
                 // PAS de `model` : c'est le cas d'un historique réel (les
                 // vieilles conversations n'en ont pas). backfillMessageModels
                 // (U-1) va donc réécrire ce record au boot — et il doit le faire
                 // en écriture FROIDE, sans réchauffer la conversation. Le
                 // contrôle de froideur ci-dessous vérifie précisément ça.
                 { role: 'assistant', content: 'en effet' }] },
    { id: 's-titre', title: 'Un titre avec Postgres dedans', timestamp: now - 2000,
      updatedAt: now - 2000, spaceId: 'default',
      messages: [{ role: 'user', content: 'contenu sans rapport' }] },
    { id: 's-resume', title: 'Titre neutre', timestamp: now - 3000, updatedAt: now - 3000,
      spaceId: 'default',
      messages: [{ role: 'user', content: 'contenu sans rapport' }] },
    { id: 's-muette', title: 'Rien à voir', timestamp: now - 4000, updatedAt: now - 4000,
      spaceId: 'default',
      messages: [{ role: 'user', content: 'contenu sans rapport' }] },
    // Ack porteur du mot rare : ne doit JAMAIS matcher (result hors-sujet).
    { id: 's-ack', title: 'Conversation à outils', timestamp: now - 5000, updatedAt: now - 5000,
      spaceId: 'default',
      messages: [{ role: 'tool-ack', kind: 'mcp_call', result: rare + ' dans un result' },
                 { role: 'assistant', content: 'réponse neutre' }] },
  ];
  await new Promise((r) => {
    const tx = db.transaction('conversations', 'readwrite');
    for (const rec of recs) tx.objectStore('conversations').put(rec);
    tx.oncomplete = r;
  });
  await new Promise((r) => {
    const tx = db.transaction('summaries', 'readwrite');
    tx.objectStore('summaries').put({
      id: 's-resume', title: 'Titre neutre', timestamp: now,
      summary: 'discussion sur le portail captif', keywords: ['portail'], messageCount: 2,
    });
    tx.oncomplete = r;
  });
}, { rare: RARE });

await boot();   // rehydrate le cache depuis IDB : métadonnées seules, aucun message

const coldCheck = await page.evaluate(() => ({
  listed: listAllConversations().map((c) => c.id).sort().join(','),
  // Contrat U-1 : une conversation froide sort avec messages: [].
  coldMessages: (loadConversations().find((c) => c.id === 's-froide') || {}).messages,
}));
check('les 5 conversations seedées sont visibles', coldCheck.listed === 's-ack,s-froide,s-muette,s-resume,s-titre');
// Froideur APRÈS backfill : ces conversations n'ont pas de `model` sur leurs
// réponses, backfillMessageModels les a donc réécrites au boot. Une écriture
// chaude les aurait laissées en étage 2 et la recherche aurait « marché » sans
// rien prouver du chemin froid.
check('elles sont bien FROIDES après backfill (messages absents du cache)',
  Array.isArray(coldCheck.coldMessages) && coldCheck.coldMessages.length === 0);

// Helper : tape une requête dans la recherche sidebar et attend la stabilisation
// (debounce + lecture IDB), puis rend les ids affichés.
const searchSidebar = async (q) => {
  await page.fill('#conv-search', '');
  await page.fill('#conv-search', q);
  await page.waitForTimeout(600);
  return page.$$eval('#conv-list .conv .conv-title', (els) => els.map((e) => e.textContent).join('|'));
};

// ── 1. Conversation froide trouvée par son contenu ──────────────────────────
const r1 = await searchSidebar(RARE);
check('1. une conversation FROIDE est trouvée par un mot de son seul contenu', r1 === 'Sujet quelconque');
check('1bis. le mot dans un result d\'ack ne fait PAS matcher', !r1.includes('Conversation à outils'));
await page.screenshot({ path: path.join(outDir, '01-recherche-contenu-froid.png') });

// ── 2. Non-régression titre / résumé ────────────────────────────────────────
check('2. match titre (substring) inchangé',
  (await searchSidebar('Postgres')) === 'Un titre avec Postgres dedans');
check('2bis. match résumé (scoreSummary) inchangé', (await searchSidebar('portail')) === 'Titre neutre');

// ── 3. Seuil de 3 caractères ────────────────────────────────────────────────
// « or » est un préfixe du mot rare : sans seuil, il matcherait par substring.
const r3 = await searchSidebar('or');
check('3. sous 3 caractères, pas de scan de contenu', !r3.includes('Sujet quelconque'));
// Contrôle direct de la primitive : aucune lecture, Set vide.
const hits2c = await page.evaluate(async () => (await collectContentSearchHits('or')).size);
check('3bis. collectContentSearchHits rend un Set vide sous le seuil', hits2c === 0);

// ── 4. Rendu en deux temps ──────────────────────────────────────────────────
// Juste après le debounce mais avant la fin de la lecture IDB, la liste doit
// déjà porter les matchs titre/résumé — pas rester figée sur l'ancien filtre.
await page.fill('#conv-search', '');
await page.waitForTimeout(400);
await page.fill('#conv-search', 'Postgres');
await page.waitForTimeout(200);   // > debounce (150), le scan peut encore courir
const r4 = await page.$$eval('#conv-list .conv .conv-title', (els) => els.map((e) => e.textContent).join('|'));
check('4. la liste est filtrée sur titre/résumé sans attendre la lecture IDB',
  r4 === 'Un titre avec Postgres dedans');

// ── 5. Réentrance : frappe rapide ───────────────────────────────────────────
// On tape le mot rare puis, immédiatement, une requête sans résultat. Le Set du
// premier scan ne doit JAMAIS être appliqué au second (jeton de séquence).
await page.fill('#conv-search', '');
await page.waitForTimeout(400);
await page.fill('#conv-search', RARE);
await page.waitForTimeout(160);            // laisse partir la passe du mot rare
await page.fill('#conv-search', 'zzzzintrouvable');
await page.waitForTimeout(700);
const r5 = await page.$$eval('#conv-list .conv .conv-title', (els) => els.map((e) => e.textContent).join('|'));
check('5. une passe abandonnée n\'affiche pas son résultat sur la requête suivante', r5 === '');

// ── 6. Effacement pendant une passe en vol ──────────────────────────────────
await page.fill('#conv-search', '');
await page.waitForTimeout(400);
await page.fill('#conv-search', RARE);
await page.waitForTimeout(160);
await page.click('#search-clear');
await page.waitForTimeout(700);
const r6 = await page.$$eval('#conv-list .conv .conv-title', (els) => els.map((e) => e.textContent).join('|'));
check('6. effacer le champ pendant une passe ne fait pas réapparaître de filtre',
  r6.split('|').filter(Boolean).length === 5);

// ── 7. Palette de commandes ─────────────────────────────────────────────────
await page.fill('#conv-search', '');
await page.waitForTimeout(300);
await page.keyboard.press('Meta+k');       // Meta, pas Control (project_playwright_meta_not_control)
await page.waitForSelector('#cmdk-overlay:not([hidden])', { timeout: 3000 });
// Submode « conversation » : on passe par la commande, pas par une globale.
await page.fill('#cmdk-input', 'conversation');
await page.waitForTimeout(120);
await page.evaluate(() => enterCmdkSubmode('conv'));
await page.fill('#cmdk-input', RARE);
await page.waitForTimeout(700);
const r7 = await page.$$eval('#cmdk-list .cmdk-item-label', (els) => els.map((e) => e.textContent).join(','));
check('7. la palette trouve elle aussi la conversation froide par son contenu',
  r7.includes('Sujet quelconque'));
await page.screenshot({ path: path.join(outDir, '02-palette-contenu-froid.png') });

// ── 8. Fermeture pendant une passe ──────────────────────────────────────────
await page.fill('#cmdk-input', '');
await page.waitForTimeout(300);
await page.fill('#cmdk-input', RARE);
await page.waitForTimeout(160);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const r8 = await page.evaluate(() => ({
  open: _cmdkOpen,
  hidden: $('cmdk-overlay').hidden,
  hits: _cmdkContentHits,
}));
check('8. fermer la palette pendant une passe ne laisse pas de rendu fantôme',
  r8.open === false && r8.hidden === true && r8.hits === null);

check('aucune erreur console', errors.length === 0);
if (errors.length) errors.slice(0, 5).forEach((e) => console.log('    ' + e));

console.log(failures.length ? `\nÉCHEC — ${failures.length} contrôle(s)` : '\nOK — tous les contrôles passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
