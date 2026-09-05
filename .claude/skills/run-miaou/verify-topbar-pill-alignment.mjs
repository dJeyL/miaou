#!/usr/bin/env node
// Alignement vertical des pilules de topbar (.bg-activity / .agent-count).
//
// CE QUI EST MESURÉ : les deux pilules vivent côte à côte dans .topbar-right
// (align-items:center) et sont censées lire comme des objets de même nature —
// même padding, même typo, même rayon. Elles n'ont pourtant PAS le même
// contenu : .bg-activity porte un .spin de 12px, .agent-count une pastille de
// 7px et du texte mono 10.5px. La hauteur de chaque pilule est donc fixée par
// son propre contenu, et deux hauteurs différentes centrées sur la même ligne
// donnent des BORDS qui ne s'alignent pas — visible seulement quand les deux
// sont affichées simultanément (cas de l'inventaire d'agents).
//
// Aucune assertion DOM sur les positions ne l'attrape si on ne compare pas les
// deux boîtes ENTRE ELLES : chacune est individuellement correcte.
//
// Le script force l'affichage des deux pilules (pur CSS : `hidden` retiré,
// classe `active` posée, libellés remplis) sans monter de scénario d'agents —
// la géométrie ne dépend pas de la provenance des données.
//
// Usage : node verify-topbar-pill-alignment.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text');

// Affichage forcé des deux pilules, sans scénario d'agents.
await page.evaluate(() => {
  const bg = document.getElementById('bg-activity');
  bg.classList.add('active');
  document.getElementById('bg-label').textContent = 'titrage…';

  const ac = document.getElementById('agent-count');
  ac.hidden = false;
  document.getElementById('agent-count-label').textContent = '4 agents';

  // Troisieme pilule de la meme famille (.agent-count.auth-pending) : elle
  // reprend la forme des deux autres avec sa propre font-size, donc elle est
  // exposee au meme ecart et doit s'aligner sur elles.
  const ap = document.getElementById('auth-pending');
  ap.hidden = false;
  document.getElementById('auth-pending-label').textContent = '1 serveur';

  // .model-pill est TOUJOURS visible : rien a forcer, mais elle est la
  // quatrieme pilule de la zone et doit s'aligner avec les trois autres.
  document.getElementById('model-label').textContent = 'un-modele';
});
await page.waitForTimeout(120);

const m = await page.evaluate(() => {
  const box = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2),
      height: +r.height.toFixed(2),
      paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
      fontSize: cs.fontSize, lineHeight: cs.lineHeight,
      borderWidth: cs.borderTopWidth, boxSizing: cs.boxSizing,
    };
  };
  const bg = document.getElementById('bg-activity');
  const ac = document.getElementById('agent-count');
  const ap = document.getElementById('auth-pending');
  const mp = document.querySelector('.model-pill');
  return {
    bg: box(bg),
    ac: box(ac),
    ap: box(ap),
    mp: box(mp),
    spin: box(bg.querySelector('.spin')),
    dot: box(ac.querySelector('.activity-dot')),
    bgLabel: box(document.getElementById('bg-label')),
    acLabel: box(document.getElementById('agent-count-label')),
    apLabel: box(document.getElementById('auth-pending-label')),
    mpLabel: box(document.getElementById('model-label')),
  };
});

console.log('\n─ Mesures ────────────────────────────────────────────');
for (const [k, v] of Object.entries(m)) {
  console.log(`  ${k.padEnd(8)} top=${String(v.top).padStart(7)}  bottom=${String(v.bottom).padStart(7)}  h=${String(v.height).padStart(6)}  pad=${v.paddingTop}/${v.paddingBottom}  fs=${v.fontSize}  lh=${v.lineHeight}  bw=${v.borderWidth}  ${v.boxSizing}`);
}
console.log('');
console.log(`  Δ hauteur  (bg - ac) = ${(m.bg.height - m.ac.height).toFixed(2)}px`);
console.log(`  Δ bord haut  (bg - ac) = ${(m.bg.top - m.ac.top).toFixed(2)}px`);
console.log(`  Δ bord bas   (bg - ac) = ${(m.bg.bottom - m.ac.bottom).toFixed(2)}px`);
console.log(`  Δ hauteur  (ap - ac) = ${(m.ap.height - m.ac.height).toFixed(2)}px`);
console.log(`  Δ bord haut  (ap - ac) = ${(m.ap.top - m.ac.top).toFixed(2)}px`);
console.log(`  Δ hauteur  (mp - ac) = ${(m.mp.height - m.ac.height).toFixed(2)}px`);
console.log(`  Δ bord haut  (mp - ac) = ${(m.mp.top - m.ac.top).toFixed(2)}px`);
console.log('');

// Les deux pilules doivent avoir la MÊME boîte verticale : même hauteur, donc
// bords haut et bas confondus (elles sont centrées sur la même ligne flex).
// Tolérance sous le demi-pixel — au-delà, un bord se voit à l'écran.
check('les deux pilules ont la même hauteur',
      Math.abs(m.bg.height - m.ac.height) < 0.5);
check('les bords hauts sont alignés',
      Math.abs(m.bg.top - m.ac.top) < 0.5);
check('les bords bas sont alignés',
      Math.abs(m.bg.bottom - m.ac.bottom) < 0.5);

check('la pilule d\'autorisation a la meme hauteur',
      Math.abs(m.ap.height - m.ac.height) < 0.5);
check('la pilule d\'autorisation est alignee en haut',
      Math.abs(m.ap.top - m.ac.top) < 0.5);

check('la pilule de modele a la meme hauteur',
      Math.abs(m.mp.height - m.ac.height) < 0.5);
check('la pilule de modele est alignee en haut',
      Math.abs(m.mp.top - m.ac.top) < 0.5);

check('aucune erreur console', errors.length === 0);
if (errors.length) errors.forEach(e => console.log('    ' + e));

await browser.close();
console.log(failures.length ? `\nFAIL — ${failures.length} échec(s)` : '\nOK — tout passe');
process.exit(failures.length ? 1 : 0);
