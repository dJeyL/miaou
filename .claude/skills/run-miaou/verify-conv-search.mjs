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
//   9-12. extraits surlignés : présence, match de titre sans ligne d'extrait,
//      terme exact entre guillemets (le « de » de tête non surligné), ET/ordre libre
//   13. placeholder : intitulé au repos, syntaxe au focus
//   14. palette : placeholder de syntaxe et second étage d'extrait
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

// La sidebar est repliée par défaut à ce viewport : les contrôles lisent le DOM
// (qui existe repliée ou non), mais les CAPTURES ne montreraient rien. À appeler
// après chaque `boot()`, la classe étant reposée à chaque chargement.
const openSidebar = () => page.evaluate(() => {
  if (!$('app').classList.contains('sidebar-open')) toggleSidebar();
});

// Le mot-témoin n'existe QUE dans le contenu des messages : ni titre, ni résumé.
const RARE = 'ornithorynque';
// Titres de TOUTES les conversations seedées, triés : ce que la liste montre
// quand aucun filtre n'est actif. Dérivé une fois, jamais recompté à la main.
const ALL_TITLES = [
  'Conversation à outils', 'Fiche animale', 'Rien à voir',
  'Sujet quelconque', 'Titre neutre', 'Un titre avec Postgres dedans',
].sort().join('|');

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
    // Extraits surlignés : le texte porte « de chien de race » — le « de » de
    // TÊTE est le piège, il ne doit pas être surligné par une recherche citée.
    // Il porte aussi les deux mots d'un ET dispersé, pour la même conversation.
    { id: 's-extrait', title: 'Fiche animale', timestamp: now - 6000, updatedAt: now - 6000,
      spaceId: 'default',
      messages: [{ role: 'user', content: 'On parle beaucoup de chien de race ici, et le vaccin arrive plus loin dans la phrase.' }] },
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
await openSidebar();

const coldCheck = await page.evaluate(() => ({
  listed: listAllConversations().map((c) => c.id).sort().join(','),
  // Contrat U-1 : une conversation froide sort avec messages: [].
  coldMessages: (loadConversations().find((c) => c.id === 's-froide') || {}).messages,
}));
check('les conversations seedées sont visibles',
  coldCheck.listed === 's-ack,s-extrait,s-froide,s-muette,s-resume,s-titre');
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
// Contrôle direct de la primitive : aucune lecture, table vide.
const hits2c = await page.evaluate(async () => (await collectContentSearchHits('or')).size);
check('3bis. collectContentSearchHits rend une table vide sous le seuil', hits2c === 0);

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
// On tape le mot rare puis, immédiatement, une requête sans résultat. La table du
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
const r6 = await page.$$eval('#conv-list .conv .conv-title', (els) => els.map((e) => e.textContent).sort().join('|'));
// Ensemble des titres attendus, pas leur CARDINAL : un compte nu reperime au
// prochain ajout au seed (payé ici même), et ne dit pas lequel manque.
check('6. effacer le champ pendant une passe ne fait pas réapparaître de filtre',
  r6 === ALL_TITLES);

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

// ── 9. Extraits surlignés (sidebar) ─────────────────────────────────────────
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
// Escape est aussi le dernier recours de la cascade : il vient de REFERMER la
// sidebar. Les contrôles liraient le DOM quand même, mais les captures ne
// montreraient rien — c'est ce qui les rendait aveugles jusqu'ici.
await openSidebar();
await searchSidebar(RARE);
const r9 = await page.evaluate(() => {
  const card = [...document.querySelectorAll('#conv-list .conv')]
    .find((el) => (el.querySelector('.conv-title') || {}).textContent === 'Sujet quelconque');
  const ex = card && card.querySelector('.conv-excerpt');
  return { hasExcerpt: !!ex, text: ex ? ex.textContent : '',
           marks: ex ? [...ex.querySelectorAll('mark.search-hit')].map((m) => m.textContent) : [] };
});
check('9. la carte porte un extrait du passage trouvé', r9.hasExcerpt && r9.text.includes('ornithorynque'));
check('9bis. le terme cherché y est surligné', r9.marks.join('|') === 'ornithorynque');
await page.screenshot({ path: path.join(outDir, '03-extrait-surligne.png') });

// ── 10. Match de TITRE : surligné dans le titre, sans ligne d'extrait ────────
await searchSidebar('Postgres');
const r10 = await page.evaluate(() => {
  const card = [...document.querySelectorAll('#conv-list .conv')]
    .find((el) => (el.querySelector('.conv-title') || {}).textContent.includes('Postgres'));
  return { marks: card ? [...card.querySelectorAll('.conv-title mark.search-hit')].map((m) => m.textContent) : [],
           excerpt: !!(card && card.querySelector('.conv-excerpt')) };
});
check('10. un match de titre est surligné DANS le titre', r10.marks.join('|') === 'Postgres');
check('10bis. et n\'ouvre pas de ligne d\'extrait (elle répéterait le titre)', r10.excerpt === false);

// ── 11. Terme exact : le « de » de tête n'est PAS surligné ───────────────────
await searchSidebar('"chien de race"');
const r11 = await page.evaluate(() => {
  const card = [...document.querySelectorAll('#conv-list .conv')]
    .find((el) => (el.querySelector('.conv-title') || {}).textContent === 'Fiche animale');
  const ex = card && card.querySelector('.conv-excerpt');
  return { found: !!card, marks: ex ? [...ex.querySelectorAll('mark.search-hit')].map((m) => m.textContent) : [] };
});
check('11. une suite entre guillemets trouve la conversation', r11.found);
check('11bis. la suite est surlignée d\'UN bloc, sans le « de » de tête',
  r11.marks.join('|') === 'chien de race');
await page.screenshot({ path: path.join(outDir, '04-terme-exact.png') });

// ── 12. ET sur les termes, ordre libre ──────────────────────────────────────
const r12a = await searchSidebar('chien vaccin');
check('12. deux mots dispersés remontent la conversation (ET, ordre libre)',
  r12a.includes('Fiche animale'));
const r12b = await searchSidebar('"chien vaccin"');
check('12bis. la même suite entre guillemets ne la remonte pas',
  !r12b.includes('Fiche animale'));

// ── 13. Placeholder : syntaxe au focus, intitulé au repos ───────────────────
await page.fill('#conv-search', '');
await page.evaluate(() => $('conv-search').blur());
await page.waitForTimeout(120);
const restPh = await page.$eval('#conv-search', (el) => el.placeholder);
await page.focus('#conv-search');
await page.waitForTimeout(120);
const focusPh = await page.$eval('#conv-search', (el) => el.placeholder);
await page.evaluate(() => $('conv-search').blur());
await page.waitForTimeout(120);
const backPh = await page.$eval('#conv-search', (el) => el.placeholder);
check('13. le placeholder au repos annonce la fonction', restPh === 'Rechercher…');
check('13bis. au focus il enseigne la syntaxe', focusPh.includes('"suite exacte"'));
check('13ter. le blur restaure le texte de repos', backPh === restPh);

// ── 14. Extraits dans la palette (second étage) ─────────────────────────────
await page.fill('#conv-search', '');
await page.waitForTimeout(300);
await page.keyboard.press('Meta+k');
await page.waitForSelector('#cmdk-overlay:not([hidden])', { timeout: 3000 });
await page.evaluate(() => enterCmdkSubmode('conv'));
const cmdkPh = await page.$eval('#cmdk-input', (el) => el.placeholder);
check('14. le placeholder de la palette porte la syntaxe', cmdkPh.includes('"suite exacte"'));
await page.fill('#cmdk-input', RARE);
await page.waitForTimeout(700);
const r14 = await page.evaluate(() => {
  const item = [...document.querySelectorAll('#cmdk-item, #cmdk-list .cmdk-item')]
    .find((el) => (el.querySelector('.cmdk-item-label') || {}).textContent === 'Sujet quelconque');
  const ex = item && item.querySelector('.cmdk-item-excerpt');
  return { row: !!(item && item.querySelector('.cmdk-item-row')), hasExcerpt: !!ex,
           marks: ex ? [...ex.querySelectorAll('mark.search-hit')].map((m) => m.textContent) : [] };
});
check('14bis. la ligne est enveloppée dans .cmdk-item-row', r14.row);
check('14ter. elle porte un second étage avec le terme surligné',
  r14.hasExcerpt && r14.marks.join('|') === 'ornithorynque');
await page.screenshot({ path: path.join(outDir, '05-palette-deux-etages.png') });
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

check('aucune erreur console', errors.length === 0);
if (errors.length) errors.slice(0, 5).forEach((e) => console.log('    ' + e));

console.log(failures.length ? `\nÉCHEC — ${failures.length} contrôle(s)` : '\nOK — tous les contrôles passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
