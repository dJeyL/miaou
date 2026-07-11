#!/usr/bin/env node
// Vérification de la palette de commandes (lot F, un seul lancement) :
//   - ouverture/fermeture Ctrl/Cmd+K, focus input, restauration focus composer,
//   - filtrage + navigation ↑/↓/Entrée, liste vide,
//   - round-trip clavier de commandes (réglages, souvenirs…),
//   - commandes contextuelles masquées (enabled()),
//   - bascule thème (light↔dark) et coloration (sans no-op DOM),
//   - sous-modes : modèle (cache injecté), skill (insertion /slug), espace,
//   - recherche conversation CROSS-Space (Space actif en tête, annotation, follow),
//   - profondeur Escape / sous-mode.
// Usage : node verify-command-palette.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-command-palette');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

// Ctrl/Cmd+K : le handler teste metaKey||ctrlKey. Sous ce build Playwright,
// modifiers:['Meta'] pose metaKey=true (cf. mémoire playwright_meta_not_control).
const MOD = 'Meta';
const openPalette = async () => { await page.keyboard.press(MOD + '+KeyK'); await page.waitForTimeout(120); };

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed ─────────────────────────────────────────────────────────────────────
const seedHtml = fs.readFileSync(seedPath, 'utf8');
const seedScript = seedHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1];
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'log'; d.hidden = true;
  document.body.appendChild(d);
});
await page.evaluate(seedScript);
await page.waitForFunction(() => document.getElementById('log').textContent.includes('skill(s)'), { timeout: 5000 });
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

// ── 1. Ouverture / fermeture / focus ─────────────────────────────────────────
await openPalette();
check('ouverture : overlay visible', await page.evaluate(() =>
  document.getElementById('cmdk-overlay').hidden === false));
check('ouverture : input focalisé', await page.evaluate(() =>
  document.activeElement === document.getElementById('cmdk-input')));
await shot('01-open.png');
await openPalette();   // toggle → ferme
check('toggle : Ctrl/Cmd+K ferme la palette', await page.evaluate(() =>
  document.getElementById('cmdk-overlay').hidden === true));
check('fermeture : focus rendu au composer', await page.evaluate(() =>
  document.activeElement === document.getElementById('composer-text')));

// ── 2. Filtrage + navigation clavier + liste vide ────────────────────────────
await openPalette();
await page.fill('#cmdk-input', 'régl');
await page.waitForTimeout(120);
check('filtrage : "régl" ne laisse que "Ouvrir les réglages"', await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('#cmdk-list .cmdk-item-label')).map(e => e.textContent);
  return items.length === 1 && items[0] === 'Ouvrir les réglages';
}));
await page.fill('#cmdk-input', 'zzzznope');
await page.waitForTimeout(120);
check('liste vide : message "Aucun résultat" affiché', await page.evaluate(() =>
  document.getElementById('cmdk-empty').hidden === false &&
  document.querySelectorAll('#cmdk-list .cmdk-item').length === 0));
await page.fill('#cmdk-input', '');
await page.waitForTimeout(120);
// navigation : sélection initiale = 0, ↓ passe à 1
const selBefore = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#cmdk-list .cmdk-item')).findIndex(li => li.classList.contains('selected')));
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(60);
const selAfter = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#cmdk-list .cmdk-item')).findIndex(li => li.classList.contains('selected')));
check('navigation : ↓ déplace la sélection', selBefore === 0 && selAfter === 1);
await shot('02-filter-nav.png');
// Échap ferme (mode racine)
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('Échap ferme la palette (mode racine)', await page.evaluate(() =>
  document.getElementById('cmdk-overlay').hidden === true));

// ── 3. Round-trip clavier : "Ouvrir les réglages" ────────────────────────────
await openPalette();
await page.fill('#cmdk-input', 'réglages');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('round-trip : "Ouvrir les réglages" ouvre le drawer réglages + ferme la palette',
  await page.evaluate(() =>
    document.getElementById('drawer').classList.contains('show') &&
    document.getElementById('cmdk-overlay').hidden === true));
await page.evaluate(() => closeSettings());
await page.waitForTimeout(150);

// ── 3bis. Raccourcis par commande (champ vide, mode racine) ──────────────────
// Hint gauche affiché sur chaque ligne racine.
await openPalette();
await page.fill('#cmdk-input', '');
await page.waitForTimeout(120);
check('raccourci : hint touche (à gauche) affiché sur les lignes racine', await page.evaluate(() => {
  const keys = Array.from(document.querySelectorAll('#cmdk-list .cmdk-item-key'))
    .map(e => e.textContent).filter(Boolean);
  return keys.includes('N') && keys.includes('T') && keys.includes('S') && keys.includes('C');
}));
check('raccourci : à l’ouverture, mode raccourci actif (liste .cmdk-shortcuts, touches orange)',
  await page.evaluate(() => document.getElementById('cmdk-list').classList.contains('cmdk-shortcuts')));
await shot('01b-shortcuts-mode.png');
// 'S' (champ vide, mode raccourci) → Serveurs MCP directement, sans Entrée.
await page.keyboard.press('s');
await page.waitForTimeout(200);
check('raccourci : "S" lance "Serveurs MCP" (champ vide) + ferme la palette', await page.evaluate(() =>
  document.getElementById('mcp-drawer').classList.contains('show') &&
  document.getElementById('cmdk-overlay').hidden === true));
await page.evaluate(() => closeMcpServers());
await page.waitForTimeout(150);
// ',' → réglages
await openPalette();
await page.keyboard.press(',');
await page.waitForTimeout(200);
check('raccourci : "," lance "Ouvrir les réglages"', await page.evaluate(() =>
  document.getElementById('drawer').classList.contains('show')));
await page.evaluate(() => closeSettings());
await page.waitForTimeout(150);
// Espace en tête : bascule en mode filtre (avalé, champ reste vide) → une lettre
// ne lance plus de commande mais filtre.
await openPalette();
await page.keyboard.press('Space');
await page.waitForTimeout(120);
check('bascule filtre : Espace avalé (champ vide) + mode raccourci quitté', await page.evaluate(() =>
  document.getElementById('cmdk-input').value === '' &&
  !document.getElementById('cmdk-list').classList.contains('cmdk-shortcuts')));
await shot('01c-filter-mode.png');
await page.keyboard.type('s');
await page.waitForTimeout(150);
check('bascule filtre : "s" après Espace FILTRE (palette ouverte, aucun drawer, liste réduite)',
  await page.evaluate(() =>
    document.getElementById('cmdk-overlay').hidden === false &&
    !document.getElementById('mcp-drawer').classList.contains('show') &&
    document.getElementById('cmdk-input').value === 's'));
// Réarmement : vider le champ repasse en mode raccourci.
await page.fill('#cmdk-input', '');
await page.evaluate(() => document.getElementById('cmdk-input').dispatchEvent(new Event('input', { bubbles: true })));
await page.waitForTimeout(120);
check('réarmement : champ vidé → retour au mode raccourci (.cmdk-shortcuts)', await page.evaluate(() =>
  document.getElementById('cmdk-list').classList.contains('cmdk-shortcuts')));
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

// ── 4. Commandes contextuelles masquées (enabled()) ──────────────────────────
// Sans conversation ouverte : export absent. "Changer de modèle" présent SSI le
// cache modèles est non vide (peut être préchargé au boot — état légitime, on
// vérifie la cohérence, pas une valeur absolue).
// (seed a 2 skills et 2 espaces → invoke skill + switch space présents.)
await page.evaluate(() => resetToEmpty());
await page.waitForTimeout(100);
await openPalette();
await page.fill('#cmdk-input', '');
await page.waitForTimeout(120);
const rootLabels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#cmdk-list .cmdk-item-label')).map(e => e.textContent));
check('sans conversation : "Exporter …" absent', !rootLabels.some(l => l.startsWith('Exporter')));
check('cohérence : "Changer de modèle" présent SSI le cache modèles est non vide',
  await page.evaluate(() => {
    const hasCmd = Array.from(document.querySelectorAll('#cmdk-list .cmdk-item-label'))
      .some(e => e.textContent === 'Changer de modèle');
    const hasModels = !!(_modelsCache && _modelsCache.length);
    return hasCmd === hasModels;
  }));
check('2 skills seedées : "Invoquer une skill" présent', rootLabels.includes('Invoquer une skill'));
check('2 espaces (Général+Pro) : "Changer d’espace" présent', rootLabels.includes('Changer d’espace'));
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

// ── 5. Bascule thème (light↔dark) ────────────────────────────────────────────
const themeBefore = await page.evaluate(() => loadSettings().theme);
await openPalette();
await page.fill('#cmdk-input', 'clair sombre');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const themeAfter = await page.evaluate(() => loadSettings().theme);
check('bascule thème : la préférence a changé et vaut light|dark',
  themeAfter !== themeBefore && (themeAfter === 'light' || themeAfter === 'dark'));
check('bascule thème : palette fermée après action', await page.evaluate(() =>
  document.getElementById('cmdk-overlay').hidden === true));
await shot('03-theme-toggled.png');

// ── 5bis. Welcome re-tiré au changement de thème (écran d'accueil) ───────────
// On est sur une conversation vierge (resetToEmpty au bloc 4) → welcome affiché.
await page.evaluate(() => resetToEmpty());
await page.waitForTimeout(120);
const welcomeBefore = await page.evaluate(() =>
  (document.querySelector('#thread .welcome-screen .welcome-title') || {}).textContent || '');
check('écran d’accueil affiché (conversation vierge)', !!welcomeBefore);
// Bascule directe du thème (selectTheme → applyTheme → refreshWelcomeIfPresent).
await page.evaluate(() => toggleThemeLightDark());
await page.waitForTimeout(150);
const welcomeAfter = await page.evaluate(() =>
  (document.querySelector('#thread .welcome-screen .welcome-title') || {}).textContent || '');
check('welcome re-tiré et DIFFÉRENT après bascule de thème',
  !!welcomeAfter && welcomeAfter !== welcomeBefore);
check('welcome : toujours un seul écran d’accueil (pas empilé)', await page.evaluate(() =>
  document.querySelectorAll('#thread .welcome-screen').length === 1));
// « Nouvelle conversation » répétée (bouton) : welcome différent à chaque fois.
// 5 tirages consécutifs, chacun ≠ du précédent (garanti par pickWelcomeScreen).
const seq = await page.evaluate(() => {
  const titles = [];
  for (let i = 0; i < 5; i++) {
    newConversation();
    titles.push((document.querySelector('#thread .welcome-title') || {}).textContent || '');
  }
  return titles;
});
check('Nouvelle conversation répétée : chaque welcome ≠ du précédent', await page.evaluate((t) => {
  for (let i = 1; i < t.length; i++) if (t[i] === t[i - 1]) return false;
  return t.every(Boolean);
}, seq));

// ── 6. Bascule coloration (checkbox reflète l'état) ──────────────────────────
const hlBefore = await page.evaluate(() => document.getElementById('set-highlight').checked);
await openPalette();
await page.fill('#cmdk-input', 'coloration');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const hlAfter = await page.evaluate(() => document.getElementById('set-highlight').checked);
check('bascule coloration : checkbox Réglages inversée (pas de no-op DOM)', hlAfter === !hlBefore);

// ── 7. Sous-mode modèle (cache injecté) ──────────────────────────────────────
await page.evaluate(() => { _modelsCache = ['gpt-x', 'mistral-small3.2', 'llama3']; _modelsCacheUrl = 'x'; });
await openPalette();
await page.fill('#cmdk-input', 'modèle');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');   // entre dans le sous-mode model
await page.waitForTimeout(120);
check('sous-mode modèle : liste des 3 modèles injectés', await page.evaluate(() =>
  document.querySelectorAll('#cmdk-list .cmdk-item-label').length === 3));
check('sous-mode modèle : placeholder dédié', await page.evaluate(() =>
  document.getElementById('cmdk-input').placeholder === 'Choisir un modèle…'));
await shot('04-submode-model.png');
// Escape recule à la racine (ne ferme pas)
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('sous-mode : Échap revient à la racine (palette toujours ouverte)', await page.evaluate(() =>
  document.getElementById('cmdk-overlay').hidden === false &&
  document.querySelectorAll('#cmdk-list .cmdk-item-label').length > 3));
// second Escape ferme
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('sous-mode : second Échap ferme la palette', await page.evaluate(() =>
  document.getElementById('cmdk-overlay').hidden === true));
// pick d'un modèle applique l'override conversation
await page.evaluate(() => ensureConversation());
await openPalette();
await page.fill('#cmdk-input', 'modèle');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
await page.fill('#cmdk-input', 'llama');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('sous-mode modèle : pick applique l’override conversation', await page.evaluate(() =>
  currentConvModel === 'llama3'));

// ── 8. Sous-mode skill : insertion /slug dans le composer ────────────────────
await openPalette();
await page.fill('#cmdk-input', 'skill');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');   // sous-mode skill
await page.waitForTimeout(120);
const skillLabels = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#cmdk-list .cmdk-item-label')).map(e => e.textContent));
check('sous-mode skill : les 2 skills seedées listées', skillLabels.length === 2);
await shot('05-submode-skill.png');
await page.fill('#cmdk-input', 'revue');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('sous-mode skill : "/revue " inséré dans le composer + focus, sans envoi', await page.evaluate(() =>
  document.getElementById('composer-text').value === '/revue ' &&
  document.activeElement === document.getElementById('composer-text')));
await page.fill('#composer-text', '');

// ── 9. Sous-mode espace : bascule ────────────────────────────────────────────
await openPalette();
await page.fill('#cmdk-input', 'espace');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');   // sous-mode space
await page.waitForTimeout(120);
await page.fill('#cmdk-input', 'Pro');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
check('sous-mode espace : bascule vers "Pro"', await page.evaluate(() =>
  getActiveSpaceId() !== 'default' &&
  document.getElementById('space-select-label').textContent === 'Pro'));
// retour à Général pour la suite
await page.evaluate(() => pickSpace('default'));
await page.waitForTimeout(200);

// ── 10. Recherche conversation CROSS-Space (Space actif en tête + annotation) ─
// Depuis Général (actif). "asyncio" ne matche que seed-02 (Space Pro). Doit
// apparaître, annoté "Pro". "caddy"/"reverse proxy" existe dans les deux espaces.
await openPalette();
await page.fill('#cmdk-input', 'rechercher');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');   // sous-mode conv
await page.waitForTimeout(120);
await page.fill('#cmdk-input', 'asyncio');
await page.waitForTimeout(150);
const convItems = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#cmdk-list .cmdk-item')).map(li => ({
    label: li.querySelector('.cmdk-item-label')?.textContent || '',
    note: li.querySelector('.cmdk-item-note')?.textContent || '',
  })));
check('recherche cross-Space : trouve une conv du Space "Pro" depuis Général',
  convItems.some(i => /asyncio/i.test(i.label)));
check('recherche cross-Space : résultat d’un autre Space annoté "Pro"',
  convItems.some(i => /asyncio/i.test(i.label) && i.note === 'Pro'));
await shot('06-submode-conv-crossspace.png');
// Ouvrir la conv d'un autre Space suit le Space (followSpace) puis ouvre le fil
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('recherche cross-Space : ouvrir une conv "Pro" bascule vers "Pro"', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Pro'));
check('recherche cross-Space : la conversation ciblée est ouverte', await page.evaluate(() =>
  currentConvId === 'seed-02'));
// reveal : la conv ouverte depuis la palette est scrollée en vue dans la liste
// (élément .active présent et son rect vertical compris dans le conteneur
// scrollable) — vaut même sidebar masquée, cf. revealActiveConv().
check('recherche cross-Space : la conv ouverte est révélée (scrollée en vue)', await page.evaluate(() => {
  const el = document.querySelector('#conv-list .conv.active');
  if (!el) return false;
  const list = document.getElementById('conv-list');
  const r = el.getBoundingClientRect();
  const c = list.getBoundingClientRect();
  const mid = (r.top + r.bottom) / 2;
  return mid >= c.top && mid <= c.bottom;
}));
await shot('07-conv-opened-followed-space.png');

// ── 11. Priorité Space actif en tête (rankConvResults appliqué en réel) ──────
// Depuis Pro (actif), chercher un terme présent dans Pro ET default : Pro d'abord.
await openPalette();
await page.fill('#cmdk-input', 'rechercher');
await page.waitForTimeout(120);
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
await page.fill('#cmdk-input', 'caddy');
await page.waitForTimeout(150);
const order = await page.evaluate(() => {
  const active = getActiveSpaceId();
  const spaceById = new Map(loadSpaces().map(s => [s.name, s.id]));
  return Array.from(document.querySelectorAll('#cmdk-list .cmdk-item')).map(li => {
    const note = li.querySelector('.cmdk-item-note')?.textContent || '';
    // note vide = Space actif ; note remplie = autre Space
    return note === '' ? 'ACTIVE' : 'OTHER';
  });
});
// Si des résultats des deux côtés existent, tous les ACTIVE doivent précéder les OTHER.
const firstOther = order.indexOf('OTHER');
const lastActive = order.lastIndexOf('ACTIVE');
check('priorité : les conversations du Space actif précèdent celles des autres',
  firstOther === -1 || lastActive === -1 || lastActive < firstOther);
await shot('08-conv-active-first.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
await page.keyboard.press('Escape');

await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log('Console errors:', JSON.stringify(consoleErrors, null, 2));
  failures.push('console errors');
} else {
  console.log('No console errors.');
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
