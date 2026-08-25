#!/usr/bin/env node
// Vérification : propagation de l'index des résumés entre onglets (lot U).
//
// Depuis U-1, `_summariesCache` est un cache RAM PAR ONGLET. Les résumés
// n'émettent aucun broadcast propre (arbitrage du lot J, « ne pas broadcaster
// l'invisible ») — arbitrage pris quand `loadSummaries` relisait localStorage et
// était donc forcément frais. Sans relecture, un onglet injecte au modèle un jeu
// de résumés périmé : c'est du CONTEXTE MODÈLE, plus de l'invisible.
//
// Scénarios :
//   1. un résumé écrit dans A atteint le cache de B
//   2. une tombstone posée dans A est vue par B (pas de résurrection)
//   3. le rafraîchissement ne casse pas les résumés locaux de B
//
// Usage : node verify-summary-sync.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(path.resolve(__dirname, '../../..'), 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
// MÊME contexte pour les deux pages : BroadcastChannel est scopé à l'origine ET
// au contexte navigateur. Deux contextes distincts ne se parlent pas.
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const errors = [];
const isNoise = (t) => /ERR_NAME_NOT_RESOLVED|fonts\.(googleapis|gstatic)/.test(t);
ctx.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); });

await ctx.addInitScript(() => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'k', model: 'm', summaryInjectionMode: 'never',
    }));
  } catch (e) {}
});

const open = async () => {
  const p = await ctx.newPage();
  await p.goto('file://' + distPath);
  await p.waitForSelector('#composer-text', { timeout: 10000 });
  await p.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
  return p;
};

const A = await open();
const B = await open();

// Une conversation commune, écrite par A (le broadcast conv-updated est le
// porteur du rafraîchissement des résumés : les deux voyagent ensemble).
await A.evaluate(async () => {
  const db = await openConvDB();
  await new Promise((r) => {
    const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
    tx.objectStore('conversations').clear();
    tx.objectStore('summaries').clear();
    tx.oncomplete = r;
  });
});
await A.reload(); await A.waitForSelector('#composer-text');
await B.reload(); await B.waitForSelector('#composer-text');
await B.waitForTimeout(300);

// ── 1. Résumé écrit dans A, vu par B ────────────────────────────────────────
await A.evaluate(() => {
  saveConversation({ id: 'sync-1', title: 'Partagée', timestamp: Date.now(),
    updatedAt: Date.now(), spaceId: 'default',
    messages: [{ role: 'user', content: 'bonjour' },
               { role: 'assistant', content: 'salut', model: 'm' }] });
  saveSummary('sync-1', { title: 'Partagée', timestamp: Date.now(),
    summary: 'discussion sur le portail captif', keywords: ['portail'], messageCount: 2 });
});
await B.waitForTimeout(900);

const b1 = await B.evaluate(() => {
  const all = loadSummaries();
  return { has: !!all['sync-1'], summary: all['sync-1'] ? all['sync-1'].summary : null };
});
check('1. un résumé écrit dans A atteint le cache de B', b1.has);
check('1bis. son contenu est intègre', /portail captif/.test(b1.summary || ''));

// Conséquence concrète : la recherche par résumé fonctionne dans B.
const b1search = await B.evaluate(() => {
  const pred = searchConversations('portail');
  return pred ? pred({ id: 'sync-1', title: 'Partagée' }) : false;
});
check('1ter. B retrouve la conversation par son résumé (recherche)', b1search === true);

// ── 2. Tombstone posée dans A, vue par B ────────────────────────────────────
await A.evaluate(() => {
  suppressSummary('sync-1');
  // Le porteur du rafraîchissement est conv-updated : on touche la conversation.
  persistConversationField('sync-1', { updatedAt: Date.now() });
});
await B.waitForTimeout(900);

const b2 = await B.evaluate(() => {
  const all = loadSummaries();
  const pred = searchConversations('portail');
  return {
    suppressed: !!(all['sync-1'] && all['sync-1'].suppressed),
    stillMatches: pred ? pred({ id: 'sync-1', title: 'Partagée' }) : false,
  };
});
check('2. la tombstone posée dans A est vue par B', b2.suppressed);
check('2bis. B ne ressuscite pas le résumé supprimé (recherche)', b2.stillMatches === false);

// ── 3. Le rafraîchissement n'écrase pas un résumé local de B ────────────────
// L'index est relu EN ENTIER : un résumé que B vient d'écrire doit survivre,
// puisqu'il est en base — c'est la garantie que la relecture globale est sûre.
await B.evaluate(() => {
  saveConversation({ id: 'local-b', title: 'Locale B', timestamp: Date.now(),
    updatedAt: Date.now(), spaceId: 'default',
    messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y', model: 'm' }] });
  saveSummary('local-b', { title: 'Locale B', timestamp: Date.now(),
    summary: 'résumé strictement local', keywords: ['local'], messageCount: 2 });
});
await A.evaluate(() => {
  saveConversation({ id: 'sync-2', title: 'Autre', timestamp: Date.now(),
    updatedAt: Date.now(), spaceId: 'default',
    messages: [{ role: 'user', content: 'z' }, { role: 'assistant', content: 'w', model: 'm' }] });
});
await B.waitForTimeout(900);

const b3 = await B.evaluate(() => {
  const all = loadSummaries();
  return { localSurvives: !!all['local-b'], count: Object.keys(all).length };
});
check('3. un résumé local de B survit au rafraîchissement global', b3.localSurvives);

check('aucune erreur console', errors.length === 0);
if (errors.length) errors.slice(0, 5).forEach((e) => console.log('    ' + e));

console.log(failures.length ? `\nÉCHEC — ${failures.length} contrôle(s)` : '\nOK — tous les contrôles passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
