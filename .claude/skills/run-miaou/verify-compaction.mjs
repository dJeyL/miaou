#!/usr/bin/env node
// Lot AE — compaction du contexte. Vérification des surfaces VISUELLES.
//
// Périmètre, et pourquoi il s'arrête là : les purs du lot sont couverts par les
// tests QuickJS (frontière, élagage, appariement bulle↔entrée, microcompaction,
// gardes AE-7, registre de commandes). Ce qui n'est couvert par AUCUN test pur, et qui est donc l'objet
// exclusif de ce script, c'est le CSS et le rendu — `docs/compaction.md` le dit
// explicitement en fin de section « Vérification ».
//
// Les blocs, dans l'ordre du script (leurs titres `── N. … ──` font foi, ce
// sommaire ne les compte pas — un cardinal en tête reperime au prochain ajout) :
//   1. Séparateur de compaction dans le fil, et ce qu'il PROMET (rien n'est
//      perdu : les messages d'avant restent affichés).
//   2. Glyphe de seuil sur la pilule — visible au-delà de 50 %, caché en
//      dessous, ET caché sans fenêtre connue (le troisième cas est traité
//      explicitement par le code : un seuil testé d'un seul côté est aveugle à
//      la moitié de son sujet).
//   3. Affordance du drawer d'inspecteur — présence INCONDITIONNELLE, saillance
//      au seuil, et le bouton jamais désactivé par les bornes AE-7 (le refus
//      passe par le texte, décision de design explicite).
//   4. Liste du `/` et ses deux familles — ordre, distinction visuelle,
//      absence en édition de message passé, et la densité mesurée de l'étape 5.
//   5. Les deux affordances d'allègement, rangées par coût croissant.
//   6. Occupation de la conversation pendant le geste (registre, relais).
//   7. Navigation pendant le geste (partir ; partir puis revenir).
//   8. Appariement bulle ↔ entrée APRÈS une frontière : édition d'un message
//      user, symptômes du décalage corrigé le 2026-09-22.
//   9. Pastille « non lu » — absente sur une compaction REGARDÉE, présente sur
//      une compaction finie hors écran (l'autre défaut du 2026-09-22).
//  10. Régénérer / éditer / continuer par-dessus une frontière — second clic
//      et bandeau « Compaction annulée », continuation refusée (revue AE).
//
// Ce que ce script NE fait PAS, délibérément : la compaction de bout en bout
// (elle exige de stuber /chat/completions pour la rédaction du résumé) et la
// microcompaction (idem, plus IDB). Le RACCORD entre le geste et les purs est
// déjà tenu par les tests QuickJS ; ici on pose la frontière directement dans
// le thread et on regarde ce qui se peint. Décision Julien, 2026-09-21.
//
// Compteurs : aucun cardinal en dur. Le registre de commandes est lu par
// `commandSlugs()` et les skills système par `Object.keys(SYSTEM_SKILLS_CONTENT)`
// — un compte nu ne dit pas LEQUEL manque quand il tombe (cinq scripts sont
// tombés sur ce seul motif le 2026-09-05).
//
// Usage : node verify-compaction.mjs [dossier-captures] [--headed]
import { launchIsolated } from './stub-backend.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-compaction');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));

// Serveur API : celui de stub-backend.js (fixture stub.local). La fenêtre de
// contexte se règle depuis le lot AF par (serveur, modèle) sur la fiche serveur
// (`server.contextWindows`) ; le champ global `settings.contextWindow` que ce
// script posait a été supprimé — la valeur ne prenait plus, la pilule tombait
// en saturation et le glyphe en `currentColor`. Le serveur réel de la config
// introduirait en plus une fenêtre MESURÉE (`/api/ps`, qui prime sur une
// saisie) dépendante de la machine.
await page.addInitScript(() => {
  // Saisie de fenêtre pour le modèle actif, par le même champ que la fiche
  // serveur (cf. onSaveApiServer, main.js).
  window.__setContextWindow = (w) => {
    const srv = activeApiServer();
    upsertApiServer(Object.assign({}, srv, { contextWindows: { [activeModel()]: w } }));
  };
});

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 10000 });
await page.evaluate(() => document.fonts.ready).catch(() => {});

// ════════════════════════════════════════════════════════════════════════════
// 1. Le séparateur de compaction dans le fil
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 1. Séparateur de compaction ──');

// Frontière posée DIRECTEMENT dans le thread : la compaction réelle exige un
// aller-retour modèle, et le raccord geste→purs est déjà couvert par QuickJS.
// Ce qu'on mesure ici est le RENDU, que rien d'autre ne regarde.
const SUMMARY = 'Julien veut **compacter** le contexte.\n\n- décision AE-2 : rien n\'est détruit\n- reste à faire : le verify';
await page.evaluate(async (summary) => {
  await newConversation();
  currentThread.push({ role: 'user', content: 'Un message AVANT la frontière' });
  currentThread.push({ role: 'assistant', content: 'Une réponse avant la frontière' });
  currentThread.push({ role: 'compaction', content: summary, reclaimed: 1234 });
  currentThread.push({ role: 'user', content: 'Un message APRÈS la frontière' });
  await persistCurrent();
  rerenderCurrentThread();
}, SUMMARY);
await page.waitForFunction(() => !!document.querySelector('#thread .compaction-mark'));

const mark = await page.evaluate(() => {
  const el = document.querySelector('#thread .compaction-mark');
  const label = el.querySelector('.compaction-mark-label');
  const body = el.querySelector('details.compaction-mark-body');
  const sum = el.querySelector('.compaction-mark-summary');
  return {
    exists: !!el,
    visible: !el.hidden && el.offsetParent !== null,
    label: label ? label.textContent : null,
    hasIcon: !!el.querySelector('svg.compaction-mark-icon'),
    collapsed: body ? !body.open : null,
    // Le résumé est d'origine MODÈLE : il doit être rendu en markdown via
    // renderMd (sortie sanitisée), jamais interpolé. Un <strong> prouve le
    // rendu ; un texte brut prouverait l'inverse.
    summaryHtml: sum ? sum.innerHTML : '',
    summaryHasStrong: !!(sum && sum.querySelector('strong')),
    summaryHasList: !!(sum && sum.querySelector('li')),
  };
});
check('le séparateur est rendu et visible dans le fil', mark.exists && mark.visible);
check('il porte son glyphe', mark.hasIcon);
// Le libellé DIT que rien n'est perdu — c'est la promesse de AE-2, et un
// libellé qui laisserait croire à une suppression ferait craindre une perte
// qui n'a pas lieu. On asserte le sens, pas la chaîne exacte.
check('le libellé dit que les messages ne sont plus TRANSMIS (pas supprimés)',
  /ne sont plus transmis/i.test(mark.label || '') && !/supprim/i.test(mark.label || ''));
// Le chiffre des tokens récupérés est PERSISTÉ sur l'entrée (champ `reclaimed`,
// posé ici à 1234) et affiché par le séparateur : c'est la surface qui rend
// compte du geste sans qu'on ait à ouvrir le drawer, et elle survit au reload.
check('le séparateur affiche les tokens récupérés',
  /1234/.test(mark.label || '') && /récupérés/.test(mark.label || ''));
check('le résumé est replié par défaut', mark.collapsed === true);
check('le résumé est rendu en markdown (renderMd), pas en texte brut',
  mark.summaryHasStrong && mark.summaryHasList);
check('le résumé ne contient pas de markdown non rendu', !/\*\*/.test(mark.summaryHtml));

// La promesse centrale de AE-2 : les messages d'AVANT restent affichés. C'est
// ce qui distingue une compaction d'une suppression, et c'est invisible aux
// purs (qui testent l'ÉMISSION, où ils sont bien élagués).
const around = await page.evaluate(() => {
  const txt = document.getElementById('thread').textContent;
  return { before: txt.includes('AVANT la frontière'), after: txt.includes('APRÈS la frontière') };
});
check('les messages d\'AVANT la frontière restent AFFICHÉS (AE-2)', around.before);
check('les messages d\'après le sont aussi', around.after);

// Le repli s'ouvre : l'affordance n'est pas décorative.
await page.click('#thread .compaction-mark-body > summary');
await page.waitForFunction(() => document.querySelector('#thread details.compaction-mark-body').open === true);
check('le résumé se déplie au clic', true);
await page.screenshot({ path: path.join(outDir, '1-compaction-mark.png'),
  clip: await page.evaluate(() => {
    const r = document.querySelector('#thread .compaction-mark').getBoundingClientRect();
    return { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 60), width: Math.min(1200, r.width + 80), height: r.height + 140 };
  }) });

// ════════════════════════════════════════════════════════════════════════════
// 2. Glyphe de seuil sur la pilule
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. Glyphe de seuil (50 %) sur la pilule ──');

// Le glyphe signale le seuil par la FORME, jamais par la couleur (--ctx-warn
// et l'état `over` occupent déjà le registre chromatique). Trois états à
// éprouver, dont celui SANS fenêtre connue : un seuil testé d'un seul côté est
// aveugle à la moitié de son sujet.
// La visibilité se lit sur le PIXEL, jamais sur `el.hidden`. Deux raisons qui
// se cumulent ici, et la seconde a laissé passer un défaut réel :
//  - `[hidden] { display: none !important }` (base.css) est du CSS, donc la
//    propriété JS ne dit rien de ce qui est peint (invariant 8) ;
//  - la cible est un <svg>, et `hidden` est une propriété de HTMLElement,
//    ABSENTE de SVGElement : `el.hidden = false` y crée une propriété JS sans
//    retirer l'attribut. Un contrôle qui relit `el.hidden` répond donc
//    « visible » sur un glyphe que le CSS cache — vacuité parfaite, et c'est
//    exactement ce qui est arrivé : le glyphe n'a jamais été peint entre
//    l'étape 3 et sa correction, tous les contrôles au vert.
// Mesurer la boîte tranche les deux d'un coup.
const glyphAt = async (tokens, win) => page.evaluate(({ t, w }) => {
  syncCompactionHintGlyph({ totalTokens: t }, w);
  const el = document.getElementById('ctx-counter-compact');
  const r = el.getBoundingClientRect();
  return {
    painted: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none',
    attrHidden: el.hasAttribute('hidden'),
    exists: !!el,
  };
}, { t: tokens, w: win });

const ratioRef = await page.evaluate(() => CONTEXT_COMPACTION_HINT_RATIO);
check('le seuil de compaction est distinct du seuil d\'alerte de la pilule',
  await page.evaluate(() => CONTEXT_COMPACTION_HINT_RATIO !== CONTEXT_WINDOW_WARN_RATIO));

const WIN = 10000;
const under = await glyphAt(Math.floor(WIN * ratioRef) - 500, WIN);
check('sous le seuil : glyphe non peint', under.painted === false);
const at = await glyphAt(Math.ceil(WIN * ratioRef), WIN);
check('au seuil exact : glyphe RÉELLEMENT PEINT (borne inclusive)', at.painted === true);
const over = await glyphAt(WIN * 0.9, WIN);
check('au-delà du seuil : glyphe réellement peint', over.painted === true);
// Sans fenêtre connue, aucun ratio n'est calculable : pas de glyphe plutôt
// qu'un signal arbitraire. C'est le cas que le code traite nommément.
const noWin = await glyphAt(999999, 0);
check('sans fenêtre de contexte connue : glyphe non peint (pas de signal arbitraire)',
  noWin.painted === false);
// L'ATTRIBUT suit, et c'est lui qui commande le CSS sur un <svg> : le contrôle
// est redondant avec `painted` en nominal, mais il NOMME la cause si le défaut
// du `.hidden` sur SVG se réintroduit.
check('la visibilité est écrite sur l\'ATTRIBUT hidden, pas sur la propriété',
  under.attrHidden === true && over.attrHidden === false);

// La FORME, pas la couleur : le glyphe ne doit porter aucune des deux classes
// chromatiques de saturation. Lues sur la computed style, pas sur classList
// seule (asserter la classe ne prouve que l'exécution du JS).
await glyphAt(WIN * 0.6, WIN);
const glyphStyle = await page.evaluate(() => {
  const el = document.getElementById('ctx-counter-compact');
  const counter = document.getElementById('ctx-counter');
  return {
    isSvg: el.tagName.toLowerCase() === 'svg',
    warn: counter.classList.contains('ctx-counter-warn'),
    over: counter.classList.contains('ctx-counter-over'),
  };
});
check('le signal est un GLYPHE (svg), pas une teinte', glyphStyle.isSvg);

// Le CHEMIN RÉEL, et non la fonction du glyphe appelée à la main : c'est
// `syncContextCounter` que l'application invoque (ouverture de conversation,
// fin d'envoi, changement de fenêtre). Un glyphe correct en isolation mais
// jamais atteint en vrai passerait tous les contrôles ci-dessus — chemin visé
// ≠ chemin emprunté. On pose donc une vraie conversation et une vraie fenêtre,
// et on regarde la pilule telle qu'elle se peint.
const viaRealPath = async (chars, win) => page.evaluate(async ({ c, w }) => {
  __setContextWindow(w);
  await newConversation();
  if (c) currentThread.push({ role: 'user', content: 'x'.repeat(c) });
  await persistCurrent();
  rerenderCurrentThread();
  syncContextCounter();
  const g = document.getElementById('ctx-counter-compact');
  const r = g.getBoundingClientRect();
  return { painted: r.width > 0 && r.height > 0,
    label: document.getElementById('ctx-counter-label').textContent };
}, { c: chars, w: win });

const realLow = await viaRealPath(4000, 200000);      // ~7 %
const realHigh = await viaRealPath(500000, 200000);   // ~69 %
check(`chemin réel, sous le seuil (${realLow.label}) : pas de glyphe`, realLow.painted === false);
check(`chemin réel, au-delà (${realHigh.label}) : glyphe peint sur la pilule`, realHigh.painted === true);

// Le glyphe porte l'ACCENT, donc il suit la palette : c'est la couleur
// d'identité de l'interface, pas une couleur de statut. Éprouvé sur les TROIS
// palettes — une seule ne prouverait rien, `--accent` pouvant être codé en dur.
for (const pal of ['ambre', 'encre', 'foret']) {
  const c = await page.evaluate(async (p) => {
    selectPalette(p);
    __setContextWindow(200000);
    await newConversation();
    currentThread.push({ role: 'user', content: 'x'.repeat(500000) });
    await persistCurrent(); rerenderCurrentThread(); syncContextCounter();
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return {
      glyph: getComputedStyle(document.getElementById('ctx-counter-compact')).color,
      accent: m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex,
    };
  }, pal);
  check(`palette ${pal} : le glyphe porte l'accent de la palette (${c.glyph} / ${c.accent})`, c.glyph === c.accent);
}

// EXCEPTION : sous un seuil de saturation, le glyphe redescend à la couleur de
// la pilule. Deux couleurs dans une même pilule se liraient comme deux messages
// concurrents, et c'est la saturation qui doit gagner.
const warnColors = await page.evaluate(async () => {
  selectPalette('ambre');
  __setContextWindow(200000);
  await newConversation();
  currentThread.push({ role: 'user', content: 'x'.repeat(750000) });
  await persistCurrent(); rerenderCurrentThread(); syncContextCounter();
  const counter = document.getElementById('ctx-counter');
  return {
    // La règle d'exception couvre les DEUX états de saturation : on asserte
    // donc « l'un ou l'autre », et non `warn` seul. Viser `warn` nommément
    // était faux — le contexte FIXE (système + définitions d'outils) s'ajoute
    // au thread, si bien que 750 000 caractères poussent au-delà de 100 % et
    // donnent `over`. La précondition l'a dit ; sans elle, le contrôle suivant
    // serait passé à vide sur une pilule sans aucune classe de seuil.
    saturated: counter.classList.contains('ctx-counter-warn')
      || counter.classList.contains('ctx-counter-over'),
    label: document.getElementById('ctx-counter-label').textContent,
    glyph: getComputedStyle(document.getElementById('ctx-counter-compact')).color,
    text: getComputedStyle(counter).color,
  };
});
check(`précondition : la pilule est bien en état de saturation (${warnColors.label})`,
  warnColors.saturated === true);
check('sous alerte, le glyphe cède à la couleur de la pilule (un seul message)',
  warnColors.glyph === warnColors.text);
check('à 60 %, la pilule ne prend aucune classe de saturation (80 % / 100 %)',
  !glyphStyle.warn && !glyphStyle.over);

// ════════════════════════════════════════════════════════════════════════════
// 3. Affordance du drawer d'inspecteur
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Affordance de compaction (drawer) ──');

// Le bloc 2 a ouvert plusieurs conversations lourdes pour éprouver les seuils :
// on repart d'une conversation VIERGE, sans quoi le grisé « pas de matière »
// testé juste après n'aurait rien à mesurer. Une fixture héritée du bloc
// précédent est la façon la plus discrète de rendre un contrôle vacu.
await page.evaluate(async () => {
  __setContextWindow(200000);
  await newConversation();
  currentThread.push({ role: 'user', content: 'Un message AVANT la frontière' });
  currentThread.push({ role: 'compaction', content: 'Résumé court.' });
  await persistCurrent();
  rerenderCurrentThread();
});

await page.evaluate(() => openContextInspector());
await page.waitForSelector('#ctx-drawer.show', { timeout: 5000 });
await page.waitForTimeout(350);   // translateX(100%) → none

const aff = await page.evaluate(() => {
  const wrap = document.getElementById('ctx-compact');
  const btn = document.getElementById('ctx-compact-btn');
  const hint = document.getElementById('ctx-compact-hint');
  const cs = btn ? getComputedStyle(btn) : null;
  return {
    wrapVisible: !!wrap && !wrap.hidden && wrap.offsetParent !== null,
    btnVisible: !!btn && !btn.hidden && btn.offsetParent !== null,
    btnDisabled: btn ? btn.disabled : null,
    opacity: cs ? cs.opacity : null,
    cursor: cs ? cs.cursor : null,
    hint: hint ? hint.textContent : null,
  };
});
check('l\'affordance est présente dans le drawer', aff.wrapVisible && aff.btnVisible);
// À ce stade le thread du bloc 1 est trop court (~100 caractères, sous
// COMPACTION_MIN_CHARS) : le bouton doit être GRISÉ. C'est le seul cas où il
// l'est — une conversation trop courte ne changera pas tant que l'utilisateur
// n'aura pas parlé, là où une borne AE-7 est une attente qui se lève seule.
check('sur une conversation sans matière, le bouton est grisé', aff.btnDisabled === true);
// …et il en a l'AIR : `disabled` est une propriété JS, le grisé est du CSS, et
// `.ctx-compact.is-salient .ctx-compact-btn` est plus spécifique que
// `.ctx-compact-btn:disabled`. Sans cette mesure, un bouton inerte mais
// d'apparence cliquable passerait (invariant 8 : lire la computed style).
check('…et il en a visuellement l\'air (opacité réduite, curseur non cliquable)',
  parseFloat(aff.opacity) < 1 && aff.cursor === 'default');

// PRÉCONDITION du bloc de saillance : `syncCompactionAffordance` teste la
// MATIÈRE avant toute question de ratio — sans 2 000 caractères
// (COMPACTION_MIN_CHARS) APRÈS la dernière frontière, les trois libellés se
// réduisent à celui « pas assez d'historique » et les contrôles de saillance
// comparent la même chaîne à elle-même. Le thread du bloc 1 fait ~100
// caractères : on l'étoffe ici, et on ASSERTE la précondition plutôt que de la
// supposer (un hint testé sur un thread trop maigre serait vacue).
//
// APRÈS et non avant : `compactableCharCount` part de `lastCompactionIndex + 1`
// — ce qui est compactable est ce qui s'est accumulé DEPUIS la dernière
// compaction, pas ce qu'elle a déjà résumé. Écrit à l'envers au premier jet,
// et la précondition l'a dit tout de suite.
const minChars = await page.evaluate(() => COMPACTION_MIN_CHARS);
await page.evaluate((n) => {
  const filler = [];
  while (filler.join('').length < n * 2) {
    filler.push('Un échange de travail suffisamment long pour peser dans le compte de matière compactable. ');
  }
  currentThread.push({ role: 'user', content: filler.join('') });
}, minChars);
check('précondition : le thread porte assez de matière pour être compactable',
  await page.evaluate(() => hasCompactableSubstance(currentThread)));
// Réciproque du grisé mesuré plus haut : dès qu'il y a de la matière, le bouton
// redevient actif. Sans ce contrôle, un `disabled` posé en dur passerait aussi.
check('dès qu\'il y a de la matière, le bouton redevient actif',
  await page.evaluate(() => { syncCompactionAffordance();
    return document.getElementById('ctx-compact-btn').disabled === false; }));

// Saillance : bascule de `is-salient` au seuil. La classe est ici le contrat,
// mais on lit AUSSI la computed style — asserter la classe seule ne prouve que
// l'exécution du JS, pas que la cascade a suivi (invariant 8).
const salienceAt = async (tokens, win) => page.evaluate(({ t, w }) => {
  // On force le manifeste et la fenêtre vus par la synchro, puis on la joue.
  window.__origManifest = window.__origManifest || effectiveContextManifest;
  window.__origWin = window.__origWin || contextWindowFor;
  effectiveContextManifest = () => ({ totalTokens: t });
  contextWindowFor = () => w;
  syncCompactionAffordance();
  const wrap = document.getElementById('ctx-compact');
  return { salient: wrap.classList.contains('is-salient'),
    hint: document.getElementById('ctx-compact-hint').textContent };
}, { t: tokens, w: win });

// `.ctx-compact-btn` porte une transition de 140ms sur color/background/border :
// lire la computed style dans le même tour que la bascule de classe rend la
// valeur de DÉPART, et les deux états se ressemblent. Attendre l'état terminal
// plutôt qu'un délai — un délai fixe est une course, pas une synchronisation.
const btnPaint = async () => {
  await page.waitForFunction(() => {
    const btn = document.getElementById('ctx-compact-btn');
    const salient = document.getElementById('ctx-compact').classList.contains('is-salient');
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    const accent = m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex;
    // En saillance la couleur DOIT avoir rejoint l'accent ; hors saillance elle
    // doit l'avoir quitté. Dans les deux cas c'est la fin de la transition.
    return salient === (getComputedStyle(btn).color === accent);
  }, { timeout: 3000 });
  return page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('ctx-compact-btn'));
    return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopColor };
  });
};

const sUnder = await salienceAt(Math.floor(WIN * ratioRef) - 500, WIN);
const pUnder = await btnPaint();
const sOver = await salienceAt(Math.ceil(WIN * ratioRef), WIN);
const pOver = await btnPaint();
check('sous le seuil : pas de saillance', sUnder.salient === false);
check('au seuil : saillance posée', sOver.salient === true);
// La cascade a bien suivi : l'apparence DIFFÈRE réellement entre les deux
// états. Asserter la classe seule ne prouverait que l'exécution du JS, pas que
// la règle a gagné la cascade — c'est la moitié qui casse en silence.
check('la saillance change réellement l\'apparence du bouton (cascade suivie)',
  pUnder.color !== pOver.color && pUnder.bg !== pOver.bg);
// …et elle l'appuie par l'ACCENT, pas par une couleur d'alerte : la compaction
// est une hygiène proposée, pas un incident à traiter.
check('la saillance emploie l\'accent, jamais une couleur d\'alerte',
  await page.evaluate((c) => {
    const cs = getComputedStyle(document.documentElement);
    const hex = cs.getPropertyValue('--accent').trim();
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    const rgb = m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : hex;
    return c === rgb;
  }, pOver.color));
// Les deux hints ne disent pas la même chose, et les deux promettent que rien
// n'est perdu — c'est la crainte spontanée devant « compacter ».
check('les deux hints diffèrent selon la saillance', sUnder.hint !== sOver.hint);
check('les deux hints disent que les messages restent affichés',
  /restent affichés/i.test(sUnder.hint) && /restent affichés/i.test(sOver.hint));

// Capture AVANT le test « sans matière » : celui-ci réécrit le hint sur un
// thread vidé, et une capture prise après montrerait un bouton saillant sous un
// hint « pas assez d'historique » — un état que l'application ne produit jamais
// (elle recalcule les deux ensemble), mais que le script fabrique.
await page.screenshot({ path: path.join(outDir, '2-affordance-drawer.png'),
  clip: await page.evaluate(() => {
    const r = document.getElementById('ctx-compact').getBoundingClientRect();
    return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 20), width: r.width + 40, height: r.height + 40 };
  }) });

// Troisième libellé : pas assez de matière. C'est un état distinct des deux
// autres, atteint par le thread et non par le ratio.
const sEmpty = await page.evaluate(() => {
  const keep = currentThread.slice();
  currentThread.length = 0;
  syncCompactionAffordance();
  const h = document.getElementById('ctx-compact-hint').textContent;
  currentThread.push(...keep);
  return h;
});
check('sans matière compactable, le hint le dit', /pas encore assez d'historique/i.test(sEmpty));
check('le hint « sans matière » diffère des deux autres',
  sEmpty !== sUnder.hint && sEmpty !== sOver.hint);

await page.evaluate(() => {
  effectiveContextManifest = window.__origManifest;
  contextWindowFor = window.__origWin;
});
await page.evaluate(() => closeContextInspector());
await page.waitForTimeout(300);

// ════════════════════════════════════════════════════════════════════════════
// 4. La liste du `/` et ses deux familles
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. Autocomplétion du `/` : commandes et skills ──');

// Des skills pour que la liste ait de la matière : sans elles, la question de
// l'ORDRE entre les deux familles ne se pose pas, et le contrôle serait vide.
await page.evaluate(async () => {
  const names = [['revue', 'Revue de code'], ['cr', 'Compte-rendu'], ['traduire', 'Traduction']];
  for (const [slug, name] of names) {
    await putSkill({ slug, name, description: name, content: 'x', enabled: true, autotrigger: false });
  }
  await loadSkillsCache();
});

const openAc = async () => {
  await page.fill('#composer-text', '');
  await page.click('#composer-text');
  await page.keyboard.type('/');
  await page.waitForFunction(() => {
    const b = document.getElementById('skill-ac');
    return b && !b.hasAttribute('hidden') && b.querySelectorAll('.skill-ac-opt').length > 1;
  }, { timeout: 5000 });
};
await openAc();

// Registre lu depuis la SOURCE VIVANTE. Jamais un cardinal : un compte nu ne
// dit pas lequel manque quand il tombe.
const expectedCommands = await page.evaluate(() => commandSlugs());
const listed = await page.evaluate(() => [...document.querySelectorAll('#skill-ac .skill-ac-opt')]
  .map(o => ({
    slug: o.dataset.slug,
    isCommand: o.classList.contains('is-command'),
    tag: o.querySelector('.skill-ac-tag') ? o.querySelector('.skill-ac-tag').textContent : null,
    text: o.querySelector('.skill-ac-slug').textContent,
  })));

const shownCommands = listed.filter(o => o.isCommand).map(o => o.slug);
check(`toutes les commandes du registre sont proposées (attendu : ${expectedCommands.join(', ')})`,
  expectedCommands.every(s => shownCommands.includes(s)));
check('aucune option marquée commande hors du registre',
  shownCommands.every(s => expectedCommands.includes(s)));

// L'ORDRE est le correctif de l'étape 4 : ce qui est BORNÉ passe devant ce qui
// ne l'est pas. Les skills sont une liste ouverte ; mettre l'ouverte devant
// rend la bornée inatteignable à mesure qu'elle grossit.
const firstNonCommand = listed.findIndex(o => !o.isCommand);
const lastCommand = listed.map(o => o.isCommand).lastIndexOf(true);
check('les commandes sont EN TÊTE, avant toute skill', lastCommand < firstNonCommand);

// Distinction visuelle : une commande n'est pas une skill, et les afficher
// identiques ferait chercher une skill « compact » éditable dans le drawer.
// Deux signaux, l'étiquette (lisible sans couleur) et la teinte.
const cmdRow = listed.find(o => o.isCommand);
const skillRow = listed.find(o => !o.isCommand);
check('la commande porte une étiquette « commande »', cmdRow && cmdRow.tag === 'commande');
check('une skill n\'en porte pas', skillRow && skillRow.tag === null);
const tint = await page.evaluate(() => {
  const c = document.querySelector('#skill-ac .skill-ac-opt.is-command .skill-ac-slug');
  const s = document.querySelector('#skill-ac .skill-ac-opt:not(.is-command) .skill-ac-slug');
  return { cmd: getComputedStyle(c).color, skill: getComputedStyle(s).color };
});
check('la teinte du slug distingue commande et skill (cascade suivie)', tint.cmd !== tint.skill);

// Densité et hauteur — l'objet de l'étape 5. Le pas de ligne mesuré était de
// 36px pour un CSS qui l'annonçait : le CSS était respecté mais réglé comme un
// bloc de texte, pas comme une liste qu'on parcourt à la flèche.
const geom = await page.evaluate(() => {
  const box = document.getElementById('skill-ac');
  const opts = [...box.querySelectorAll('.skill-ac-opt')];
  const step = opts.length > 1
    ? opts[1].getBoundingClientRect().top - opts[0].getBoundingClientRect().top : null;
  const r = box.getBoundingClientRect();
  return {
    step, nOptions: opts.length,
    top: r.top, height: r.height,
    scrollHeight: box.scrollHeight,
    overflows: box.scrollHeight > box.clientHeight + 1,
    maxHeightInline: box.style.maxHeight,
    slugFont: getComputedStyle(box.querySelector('.skill-ac-slug')).fontFamily,
    monoToken: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(),
  };
});
// Containment, pas comparaison ouverte d'un seul côté : le pas doit tenir dans
// une fourchette, un pas trop PETIT serait aussi un défaut (cibles de clic).
check(`le pas de ligne est celui d'une liste (mesuré ${Math.round(geom.step)}px, attendu 24-32)`,
  geom.step >= 24 && geom.step <= 32);
// La borne de hauteur est MESURÉE à l'ouverture, pas fixée en dur : elle doit
// donc s'adapter à la place réelle au-dessus du panneau.
check('la hauteur max est posée par la mesure JS (style inline)', /^\d+px$/.test(geom.maxHeightInline));
check('le panneau ne déborde pas du haut du viewport', geom.top >= 0);
check('la borne suit la place réellement disponible au-dessus',
  parseInt(geom.maxHeightInline, 10) <= Math.round(geom.top + geom.height));
// Le slug suit l'axe des lots de fontes (corrigé à l'étape 5 : il déclarait sa
// pile mono EN DUR et échappait donc à cet axe).
check('le slug utilise var(--mono), donc suit le lot de fontes actif',
  geom.monoToken && geom.slugFont.includes(geom.monoToken.split(',')[0].replace(/['"]/g, '').trim()));

await page.screenshot({ path: path.join(outDir, '3-slash-list.png'),
  clip: await page.evaluate(() => {
    const r = document.getElementById('skill-ac').getBoundingClientRect();
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: r.height + 20 };
  }) });

// Le panneau s'adapte à une liste LONGUE plutôt que de se brider : c'est ce
// que la valeur fixe de 220px ne savait pas faire. On éprouve le cas dur.
const longList = await page.evaluate(async () => {
  for (let i = 0; i < 25; i++) {
    await putSkill({ slug: 'bulk' + i, name: 'Skill de remplissage ' + i, description: 'd', content: 'x', enabled: true, autotrigger: false });
  }
  await loadSkillsCache();
  onComposerInput();
  const box = document.getElementById('skill-ac');
  const r = box.getBoundingClientRect();
  return {
    n: box.querySelectorAll('.skill-ac-opt').length,
    top: r.top, height: r.height, bottom: r.bottom,
    maxInline: parseInt(box.style.maxHeight, 10),
    overflows: box.scrollHeight > box.clientHeight + 1,
    scrollable: getComputedStyle(box).overflowY,
  };
});
check('avec une liste longue, le panneau reste dans le viewport', longList.top >= 0);
check('et il défile plutôt que de déborder', longList.overflows && longList.scrollable === 'auto');
check('la liste longue est bien plus longue que le panneau (le cas dur est atteint)',
  longList.n > 20);
// Revue du 2026-09-22 : la borne lisait `rect.top` d'un panneau ancré par le
// BAS, donc soustrayait sa propre hauteur de la place libre — jusqu'à rester
// SOUS les 220px qu'elle devait lever. Les contrôles ci-dessus passaient quand
// même (ils ne demandaient que « dans le viewport » et « défile »). On exige
// donc que la place disponible soit réellement prise : la borne vaut le bas du
// panneau moins la marge, et dépasse le plafond du CSS quand il y a la place.
check(`la borne se mesure depuis le BAS du panneau (max ${longList.maxInline}px, bas à ${Math.round(longList.bottom)}px)`,
  Math.abs(longList.maxInline - Math.max(120, Math.round(longList.bottom - 12))) <= 1);
check(`avec la place, le panneau dépasse le plafond CSS de 220px (mesuré ${Math.round(longList.height)}px)`,
  longList.bottom - 12 <= 220 || longList.height > 220);

// Condition 2 du § 4.7 : JAMAIS de commande en édition d'un message passé.
// L'édition EST une réécriture d'historique, donc déjà sous la garde AE-7 ; y
// proposer une commande qui en déclenche une autre n'aurait pas de sens.
// `updateSkillAutocomplete` est PARTAGÉ entre les deux surfaces, et les deux
// états ont la même forme — d'où le discriminant explicite `commands: true`.
await page.evaluate(() => hideSkillAutocomplete());
const editAc = await page.evaluate(() => {
  // État d'édition : même forme que le composer, mais SANS `commands`.
  const box = document.createElement('div');
  box.className = 'skill-ac';
  document.body.appendChild(box);
  const ta = document.createElement('textarea');
  ta.value = '/';
  document.body.appendChild(ta);
  ta.selectionStart = ta.selectionEnd = 1;
  const state = { ta, box, index: -1, trigger: null };   // pas de commands: true
  updateSkillAutocomplete(state);
  const slugs = [...box.querySelectorAll('.skill-ac-opt')].map(o => o.dataset.slug);
  const commands = [...box.querySelectorAll('.skill-ac-opt.is-command')].length;
  box.remove(); ta.remove();
  return { slugs, commands, total: slugs.length };
});
check('en édition de message passé, AUCUNE commande n\'est proposée', editAc.commands === 0);
check('aucun slug de commande n\'y apparaît',
  expectedCommands.every(s => !editAc.slugs.includes(s)));
// Contrôle : la liste n'est pas vide pour autant — sinon l'absence ci-dessus
// serait vacue (elle passerait sur une autocomplétion simplement cassée).
check('témoin : les skills, elles, y sont bien proposées', editAc.total > 0);

// ════════════════════════════════════════════════════════════════════════════
// 5. Les DEUX affordances d'allègement (AE-5 annulé, 2026-09-22)
// ════════════════════════════════════════════════════════════════════════════
// L'évacuation des résultats d'outils est devenue un geste AUTONOME : couplée à
// la compaction, elle n'avait aucun effet observable (tout ce qui précède la
// frontière est élagué à l'émission, et la frontière est posée en fin de
// thread). Ce bloc vérifie ce que les purs ne voient pas : les deux affordances
// coexistent, dans le bon ORDRE, et le grisé décrit bien l'état.
console.log('\n── 5. Les deux affordances d\'allègement ──');

// Conversation SANS gros résultat d'outil : rien à évacuer.
//
// `ensureConversation()` et pas seulement `newConversation()` : ce bloc appelle
// le geste RÉEL (les blocs précédents n'observent que du rendu), et celui-ci
// sort sur `if (!currentConvId) return null` — or `newConversation` remet
// justement cet id à null, la conversation n'étant créée qu'au premier envoi.
// Sans ça le geste rend `null` en silence, et les assertions accusent le code
// d'un défaut qui appartient au montage. Appelé AVANT de pousser les messages :
// il réinitialise `currentThread`.
await page.evaluate(async () => {
  await newConversation();
  ensureConversation();
  currentThread.push({ role: 'user', content: 'Une question courte' });
  currentThread.push({ role: 'assistant', content: 'Une réponse courte' });
  await persistCurrent();
  rerenderCurrentThread();
  openContextInspector();
});
await page.waitForSelector('#ctx-drawer.show');
// Le drawer glisse en `translateX` (220ms) : `.show` est posé AVANT la fin de
// la transition, donc il est encore hors viewport à cet instant (mesuré
// x=1299 pour une fenêtre de 1280). Les assertions DOM n'en souffrent pas,
// mais toute capture clippée sur ces coordonnées tombe hors image. On attend
// l'état TERMINAL — la position — jamais un délai fixe, qui serait une course.
await page.waitForFunction(() => {
  const r = document.getElementById('ctx-drawer').getBoundingClientRect();
  return r.right <= window.innerWidth + 1;
}, { timeout: 5000 });

const both = await page.evaluate(() => {
  const ev = document.getElementById('ctx-evacuate');
  const co = document.getElementById('ctx-compact');
  // Ordre réel dans le DOM : DOCUMENT_POSITION_FOLLOWING === l'évacuation
  // précède la compaction. Mesuré sur la position, jamais supposé du source.
  const evacuateFirst = !!(ev.compareDocumentPosition(co) & Node.DOCUMENT_POSITION_FOLLOWING);
  const box = el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
  return {
    evacuateExists: !!ev, compactExists: !!co, evacuateFirst,
    evacuateVisible: box(ev).w > 0 && box(ev).h > 0,
    evacuateDisabled: document.getElementById('ctx-evacuate-btn').disabled,
    evacuateHint: document.getElementById('ctx-evacuate-hint').textContent,
    // Le glyphe ne doit PAS être celui du téléchargement : le geste remplace un
    // contenu par un lien, il ne transfère rien (souvenir icon-vocabulary).
    // Témoin : le bac à flèche descendante de l'export de conversation.
    evacuateIcon: ev.querySelector('svg').innerHTML,
    exportIcon: (document.querySelector('.conv-dl-btn svg') || { innerHTML: '' }).innerHTML,
  };
});
check('les DEUX affordances sont présentes', both.evacuateExists && both.compactExists);
check('l\'évacuation est visible', both.evacuateVisible);
check('elle précède la compaction (coût croissant)', both.evacuateFirst);
check('sans résultat volumineux, le bouton est grisé', both.evacuateDisabled === true);
check('et le hint dit pourquoi', /aucun résultat/i.test(both.evacuateHint));
check('son glyphe n\'est pas celui du téléchargement',
  both.exportIcon.length > 0 && both.evacuateIcon !== both.exportIcon);

// Même conversation, AVEC deux gros résultats d'outils : il y a de la matière.
await page.evaluate(async () => {
  const big = new Array(3001).join('x');
  currentThread.push({ role: 'tool-ack', name: 'docs__read', args: { ref: 'a' }, result: big });
  currentThread.push({ role: 'tool-ack', name: 'docs__read', args: { ref: 'b' }, result: big });
  await persistCurrent();
  renderContextInspector();
});
const withMatter = await page.evaluate(() => ({
  disabled: document.getElementById('ctx-evacuate-btn').disabled,
  hint: document.getElementById('ctx-evacuate-hint').textContent,
}));
check('avec des résultats volumineux, le bouton s\'active', withMatter.disabled === false);
check('le hint annonce le COMPTE', /2 résultats/.test(withMatter.hint));
// Le gain n'est PAS annoncé avant le geste : il n'est honnêtement calculable
// qu'une fois les descripteurs écrits, et un chiffre promis puis démenti par la
// pilule serait pire que pas de chiffre du tout.
check('le hint ne promet AUCUN gain chiffré avant le clic',
  !/tok/.test(withMatter.hint));
check('il dit que rien n\'est perdu', /rouvrir|rien n'est perdu/i.test(withMatter.hint));

await page.screenshot({ path: path.join(outDir, '5-affordances.png'),
  clip: await page.evaluate(() => {
    const a = document.getElementById('ctx-evacuate').getBoundingClientRect();
    const b = document.getElementById('ctx-compact').getBoundingClientRect();
    const x = Math.max(0, a.x - 12), y = Math.max(0, a.y - 12);
    return {
      x, y,
      width: Math.max(1, Math.min(window.innerWidth - x, a.width + 24)),
      height: Math.max(1, Math.min(window.innerHeight - y, (b.bottom - a.top) + 24)),
    };
  }) });

// Le geste RÉEL, de bout en bout : il n'appelle pas le modèle (contrairement à
// la compaction), donc il est jouable ici sans stub — c'est précisément ce qui
// le distingue, et ce que le bloc 1 ne pouvait pas faire.
//
// `recomputeLastContextManifest([], false)` AVANT le geste : c'est le montage
// exact d'un envoi réel (le même appel que `dispatchSend` fait à `onFinal`).
// Sans lui, `_lastContextManifest` reste null, `effectiveContextManifest()`
// retombe sur la simulation à froid, et la pilule se rafraîchit toute seule —
// le montage rendrait alors le défaut INATTEIGNABLE, et le contrôle vert ne
// prouverait rien (souvenir `green-check-proves-nothing`, forme « chemin visé
// ≠ chemin emprunté »). C'est précisément ce que la reproduction doit établir :
// le défaut n'apparaît QUE lorsqu'une photo d'envoi réel existe.
const outcome = await page.evaluate(async () => {
  const before = emittedHistoryCharCount(currentThread);
  recomputeLastContextManifest([], false);
  syncContextCounter();
  const pillBefore = document.getElementById('ctx-counter-label').textContent;
  const res = await evacuateToolResults();
  return {
    res, before, after: emittedHistoryCharCount(currentThread),
    pillBefore,
    pillAfter: document.getElementById('ctx-counter-label').textContent,
    hint: document.getElementById('ctx-evacuate-hint').textContent,
    remaining: evacuableToolResults(currentThread, TOOL_RESULT_EVACUATION_MIN_CHARS,
                                    isInlineHandleResult).count,
    disabled: document.getElementById('ctx-evacuate-btn').disabled,
  };
});
check('le geste rend un bilan (pas un refus)', !!(outcome.res && outcome.res.done));
check('le thread a réellement maigri', outcome.after < outcome.before);
check('plus rien n\'est éligible ensuite (idempotence)', outcome.remaining === 0);
check('le bouton se regrise tout seul après coup', outcome.disabled === true);
// Le bilan est un gain MESURÉ, affiché après coup — c'est là que le chiffre
// apparaît, et nulle part avant.
check('le bilan chiffre ce qui a été récupéré',
  /récupérés/.test(outcome.hint) && /tok/.test(outcome.hint));
// « 2 résultats » seul ne prouve RIEN ici : le hint d'AVANT le geste porte déjà
// ce compte (« 2 résultats d'outils volumineux peuvent être… »). Le contrôle
// doit distinguer les deux rédactions, sinon il passe sur un hint jamais mis à
// jour — ce qu'il a effectivement fait pendant que les cinq voisins étaient
// rouges, vacuité exacte du « vert qui ne prouve rien ».
check('le bilan dit combien de résultats ont été évacués',
  /2 résultats évacués/.test(outcome.hint));
check('et il a REMPLACÉ l\'annonce d\'avant le geste',
  !/peuvent être remplacés/.test(outcome.hint));

// ── La PILULE suit-elle le geste ? (défaut soupçonné, 2026-09-22) ──────────
// Soupçon initial : « la pilule ne se rafraîchit pas quand le geste finit sur
// un onglet masqué ». La reproduction montre que la visibilité n'y est pour
// RIEN — le défaut est dans `effectiveContextManifest()`, qui rend
// `_lastContextManifest || computeContextManifestNow()` : tant que la photo du
// dernier envoi réel existe, elle GAGNE, et les deux gestes d'allègement
// n'envoient rien. Ils allègent ce qui SERA envoyé puis appellent
// `syncContextCounter()`, lequel réaffiche la photo d'AVANT.
//
// Les six autres sites qui périment le manifeste (bibliothèque, MCP, skills,
// switch de Space ×2, switch de conversation) écrivent tous
// `_lastContextManifest = null` juste avant `syncContextCounter()`. Les deux
// gestes d'AE étaient les seuls à l'omettre, alors que c'est leur raison d'être.
//
// Pourquoi ça n'avait jamais été reproduit : `openConversation` remet le
// manifeste à null. Changer de conversation et revenir EFFACE le symptôme —
// toute tentative passant par la sidebar le rate, ce qui a fait attribuer le
// défaut à la visibilité de l'onglet.
const pillTokens = (s) => { const m = /(\d+)\s*tok/.exec(s || ''); return m ? +m[1] : null; };
check('témoin : la pilule portait bien un compte avant le geste',
  pillTokens(outcome.pillBefore) !== null);
check('la pilule BAISSE après l\'évacuation',
  pillTokens(outcome.pillAfter) < pillTokens(outcome.pillBefore));

// ════════════════════════════════════════════════════════════════════════════
// 6. La compaction occupe la conversation sur TOUS les onglets (étape 8)
// ════════════════════════════════════════════════════════════════════════════
// Le geste entre au registre des générations le temps de son aller-retour
// modèle : c'est ce qui fait partir `conv-generation-started` sur le canal, et
// donc ce qui verrouille la conversation chez les pairs qui l'affichent.
//
// Un seul `page` ne peut pas observer le pair (il faudrait deux contextes et un
// BroadcastChannel qui les relie, ce que `file://` ne donne pas). Ce qui EST
// observable d'ici, et qui est la moitié utile, c'est que l'enveloppe part —
// et que les exemptions du `kind` tiennent pendant ce temps : pas de bulle
// vive, pas de composer en mode stop.
//
// `silentCompletion` est stubée plutôt que le réseau : elle est le seul point
// d'appel du modèle sur ce chemin, et la stuber laisse tout le reste du geste
// (gardes, frontière, persistance, bilan) s'exécuter pour de vrai.
console.log('\n── 6. Occupation multi-onglets pendant la compaction ──');

const occupied = await page.evaluate(async () => {
  await newConversation();
  ensureConversation();
  const convId = currentConvId;
  for (let i = 0; i < 6; i++) {
    currentThread.push({ role: 'user', content: 'Question numéro ' + i + ' ' + new Array(200).join('m') });
    currentThread.push({ role: 'assistant', content: 'Réponse numéro ' + i + ' ' + new Array(200).join('r') });
  }
  await persistCurrent();
  rerenderCurrentThread();

  // Espion sur le canal : on capture les enveloppes émises, sans toucher au
  // transport (syncPost reste la seule voie, on l'observe).
  const posted = [];
  const realPost = window.syncPost;
  syncPost = function (type, payload) { posted.push({ type, payload }); return realPost.apply(this, arguments); };

  // Stub du SEUL appel modèle du chemin. Il rend la forme réelle attendue par
  // `parseSummaryJSON`, et pendant qu'il « réfléchit » on photographie l'état
  // de la conversation — c'est la fenêtre qui nous intéresse.
  const during = {};
  const realSilent = window.silentCompletion;
  silentCompletion = async function () {
    await new Promise(r => setTimeout(r, 50));
    during.isGenerating = isGenerating(convId);
    during.registered = !!generationFor(convId);
    during.kind = generationFor(convId) ? generationFor(convId).kind : null;
    // Les exemptions, mesurées PENDANT le geste et pas après : c'est le seul
    // moment où elles peuvent échouer visiblement.
    during.ownsScreen = genOwnsScreen(generationFor(convId));
    during.streamGen = streamGenerationFor(convId);
    during.sending = sending;
    // Ce que le rebranchement d'écran FERAIT s'il était sollicité maintenant.
    // Mesuré en le déclenchant pour de bon, pas en supposant : c'est le geste
    // qu'un re-rendu concurrent (bascule de thème, rehydratation d'un pair)
    // provoquerait pendant la fenêtre de compaction. Sans ce déclenchement, les
    // deux contrôles ci-dessous sont VACUS — vérifié par injection : casser
    // `genOwnsScreen` ou `streamGenerationFor` les laissait verts, parce que
    // rien ne peignait entre le début du geste et cette photo.
    // Comparaison AVANT/APRÈS, et non un prédicat sur l'état final : une
    // première rédaction comptait les `.cursor-blink` et les bulles « vides »,
    // et restait verte alors que le rebranchement était bel et bien déclenché
    // — la bulle qu'ouvre `startAssistantMessage` porte un patienteur, pas un
    // caret, et son corps n'est pas vide au sens de ce filtre. Le compte de
    // bulles, lui, ne peut pas mentir : le fil est le même des deux côtés du
    // re-rendu, donc toute bulle en plus est une bulle fantôme.
    during.bubblesBefore = document.querySelectorAll('#thread .msg.assistant').length;
    rerenderCurrentThread();
    during.bubblesAfter = document.querySelectorAll('#thread .msg.assistant').length;
    // Le verrou de l'onglet LOCAL — celui d'où part le geste. Les pairs sont
    // couverts par le relais (`conv-generation-started`), mais eux seuls :
    // `applyReadonlyState` ne regardait que `_peersGenerating`, et une
    // compaction n'appelle pas `setSending`, qui borde une génération
    // ordinaire. L'onglet qui compactait restait donc libre d'envoyer,
    // d'éditer et de régénérer pendant sa propre réécriture d'historique.
    during.readonly = isComposerReadonly();
    during.bodyReadonly = document.body.classList.contains('conv-readonly');
    during.composerDisabled = document.getElementById('composer-text').disabled;
    // La pilule de topbar et son popover : la surface qu'on voit quand on a
    // NAVIGUÉ ailleurs pendant le geste. La compaction étant au registre, elle
    // y apparaît — et la ligne doit dire ce qu'elle fait vraiment. Sans statut
    // propre elle retombait sur le libellé générique « génère », qui est faux :
    // une compaction ne produit pas de réponse, elle réécrit l'historique.
    //
    // La pilule se TAIT tant qu'on regarde la conversation concernée
    // (`resolveAgentCount` : une seule chose à annoncer, et elle est sous les
    // yeux). Le cas signalé est celui d'APRÈS la navigation — on simule donc le
    // départ en déplaçant `currentConvId`, sans quoi on mesurerait une pilule
    // masquée et le contrôle du libellé serait vacu.
    // Les DEUX surfaces qui annoncent le geste, mesurées dans les deux
    // positions : chacune doit parler exactement là où l'autre se tait.
    // D'abord SUR la conversation — l'indicateur de fond est alors la seule
    // surface (la pilule se tait, cf. `resolveAgentCount`).
    during.bgOnScreen = document.getElementById('bg-activity').classList.contains('active');
    during.bgLabelOnScreen = document.getElementById('bg-label').textContent;
    during.pillHiddenOnScreen = document.getElementById('agent-count').hidden;

    const savedConvId = currentConvId;
    currentConvId = '__ailleurs__';
    // La bascule de surface suit la navigation : c'est `openConversation` qui
    // l'appelle en vrai, on la déclenche ici puisqu'on simule le départ.
    syncCompactionActivitySurface();
    during.bgOffScreen = document.getElementById('bg-activity').classList.contains('active');
    syncAgentCount();
    renderAgentMenu();
    during.pillLabel = document.getElementById('agent-count-label').textContent;
    during.pillHidden = document.getElementById('agent-count').hidden;
    during.menuStatuses = Array.from(document.querySelectorAll('#agent-menu .agent-row-meta'))
      .map(e => e.textContent);
    currentConvId = savedConvId;
    syncCompactionActivitySurface();   // retour sur la conv : l'indicateur revient
    during.badge = convBadgeState(convId);
    during.started = posted.filter(p => p.type === 'conv-generation-started' &&
                                        p.payload && p.payload.convId === convId).length;
    return JSON.stringify({ summary: 'Résumé de compaction produit par le stub.' });
  };

  let res;
  try {
    res = await compactCurrentConversation();
  } finally {
    silentCompletion = realSilent;
    syncPost = realPost;
  }

  const startedFor = posted.filter(p => p.type === 'conv-generation-started' &&
                                        p.payload && p.payload.convId === convId).length;
  const endedFor = posted.filter(p => p.type === 'conv-generation-ended' &&
                                      p.payload && p.payload.convId === convId).length;
  return {
    res, during, startedFor, endedFor,
    afterRegistered: !!generationFor(convId),
    afterSending: sending,
    afterReadonly: isComposerReadonly(),
    afterBodyReadonly: document.body.classList.contains('conv-readonly'),
    afterComposerDisabled: document.getElementById('composer-text').disabled,
    hasBoundary: currentThread.some(e => e.role === 'compaction'),
    pill: document.getElementById('ctx-counter-label').textContent,
  };
});

check('le geste aboutit (bilan, pas refus)', !!(occupied.res && occupied.res.done));
check('une frontière a bien été posée', occupied.hasBoundary === true);
// L'occupation elle-même : c'est l'objet de l'étape 8.
check('PENDANT le geste, la conversation est au registre', occupied.during.registered === true);
check('elle y est comme \'compaction\', pas comme un stream', occupied.during.kind === 'compaction');
check('isGenerating la voit (gardes AE-7 fermées, badge working)', occupied.during.isGenerating === true);
check('le badge de conversation dit « working »', occupied.during.badge === 'working');
check('l\'enveloppe conv-generation-started est partie sur le canal',
  occupied.during.started >= 1);
// Les trois exemptions, mesurées pendant le geste.
check('exemption : la compaction ne possède PAS l\'écran', occupied.during.ownsScreen === false);
check('exemption : streamGenerationFor l\'écarte', occupied.during.streamGen === null);
// Le cas concret que les deux exemptions préviennent : un re-rendu du fil
// PENDANT la compaction (bascule de thème, rehydratation d'un pair) ne doit
// pas ouvrir de bulle assistant fantôme au bas du thread.
check('témoin : le fil portait bien des bulles avant le re-rendu',
  occupied.during.bubblesBefore > 0);
check('un re-rendu pendant le geste n\'ajoute AUCUNE bulle fantôme',
  occupied.during.bubblesAfter === occupied.during.bubblesBefore);
check('le composer ne passe PAS en mode stop', occupied.during.sending === false);
// Le verrou LOCAL — l'onglet d'où part le geste, que le relais multi-onglets
// ne couvre pas (il ne parle qu'aux pairs).
check('l\'onglet LOCAL passe en lecture seule pendant le geste',
  occupied.during.readonly === true);
check('la classe body.conv-readonly est posée', occupied.during.bodyReadonly === true);
check('et le composer est réellement désactivé', occupied.during.composerDisabled === true);
// La libération, qui est l'autre moitié : un verrou sans relâchement condamne
// la conversation sur tous les onglets jusqu'au rechargement de la page.
check('après le geste, le registre est libéré', occupied.afterRegistered === false);
check('et conv-generation-ended est parti', occupied.endedFor >= 1);
check('le composer n\'est pas resté en mode stop', occupied.afterSending === false);
// La LEVÉE du verrou local : un verrou sans levée laisse la conversation morte
// sous les yeux de qui vient de la compacter, et ce geste n'a pas d'autre
// surface pour le dire.
// Les deux surfaces d'annonce, et leur exclusion mutuelle. Le doublon signalé
// par Julien : l'indicateur de fond (« compaction… », anonyme) restait allumé
// après la navigation, en même temps que la pilule qui dit la même chose en
// mieux — elle nomme la conversation et permet d'y revenir.
check('sur la conversation, l\'indicateur de fond est la seule surface',
  occupied.during.bgOnScreen === true && occupied.during.pillHiddenOnScreen === true);
check('et il nomme le geste', /compaction/i.test(occupied.during.bgLabelOnScreen));
check('une fois ailleurs, l\'indicateur de fond s\'efface',
  occupied.during.bgOffScreen === false);

// La pilule de topbar et son popover, vus depuis AILLEURS (la pilule se tait
// tant qu'on regarde la conversation concernée).
check('la pilule s\'affiche quand on a navigué ailleurs',
  occupied.during.pillHidden === false);
check('le popover liste la conversation', occupied.during.menuStatuses.length >= 1);
check('sa ligne dit qu\'elle COMPACTE, pas qu\'elle génère',
  occupied.during.menuStatuses.some(s => /compacte le contexte/.test(s)));
check('et le mot « génère » n\'y apparaît nulle part',
  occupied.during.menuStatuses.every(s => !/génère/.test(s)));

check('le verrou local est LEVÉ après le geste', occupied.afterReadonly === false);
check('la classe body.conv-readonly est retirée', occupied.afterBodyReadonly === false);
check('et le composer redevient utilisable', occupied.afterComposerDisabled === false);
// Point 2, sur l'autre geste : la pilule doit avoir suivi la compaction aussi.
check('la pilule reflète le contexte compacté',
  /tok/.test(occupied.pill));

// ════════════════════════════════════════════════════════════════════════════
// 7. Quitter la conversation PENDANT la compaction (2026-09-22)
// ════════════════════════════════════════════════════════════════════════════
// Défaut trouvé en usage réel : laisser une compaction se terminer en
// regardant une autre conversation, revenir, et ne trouver AUCUNE trace de la
// compaction. Le geste abandonnait silencieusement quand l'écran était parti —
// le résumé était rédigé, l'appel modèle payé, puis jeté.
//
// L'abandon était juste tant que rien ne protégeait la conversation pendant le
// geste ; depuis l'étape 8 elle est au registre et verrouillée, donc personne
// n'a pu la muter. Ce qui change en partant n'est pas la sûreté, c'est le
// RÉFÉRENTIEL d'écriture (piège 28) : `currentThread` désigne désormais la
// conversation d'arrivée.
console.log('\n── 7. Navigation pendant la compaction ──');

const navigated = await page.evaluate(async () => {
  // Deux conversations : celle qu'on compacte, celle vers laquelle on part.
  await newConversation();
  ensureConversation();
  const targetId = currentConvId;
  for (let i = 0; i < 6; i++) {
    currentThread.push({ role: 'user', content: 'Question ' + i + ' ' + new Array(200).join('m') });
    currentThread.push({ role: 'assistant', content: 'Réponse ' + i + ' ' + new Array(200).join('r') });
  }
  await persistCurrent();
  const before = currentThread.length;

  await newConversation();
  ensureConversation();
  currentThread.push({ role: 'user', content: 'Une autre conversation' });
  await persistCurrent();
  const otherId = currentConvId;

  // Retour sur la cible, d'où part le geste.
  await openConversation(targetId);

  const real = window.silentCompletion;
  silentCompletion = async function () {
    // On PART pendant que le modèle « rédige » : c'est le scénario exact.
    await openConversation(otherId);
    return JSON.stringify({ summary: 'Résumé rédigé pendant que l\'écran est ailleurs.' });
  };
  let res;
  try { res = await compactCurrentConversation(); }
  finally { silentCompletion = real; }

  // Ce que le STORAGE a retenu — la seule source qui compte, l'écran étant
  // ailleurs. Relu par le chemin normal, pas depuis un état en mémoire.
  await warmConversation(targetId);
  const stored = loadConversation(targetId);
  const storedEntries = (stored && stored.messages) || [];

  // Puis on revient, comme l'utilisateur : la frontière doit être là.
  await openConversation(targetId);

  return {
    res,
    before,
    leftScreen: otherId !== targetId,
    storedHasBoundary: storedEntries.some(e => e.role === 'compaction'),
    storedCount: storedEntries.length,
    // L'autre conversation ne doit RIEN avoir reçu : c'est la moitié « piège
    // 28 » du contrôle. Une frontière écrite dans `currentThread` aurait
    // atterri ici.
    otherHasBoundary: ((loadConversation(otherId) || {}).messages || [])
      .some(e => e.role === 'compaction'),
    threadHasBoundary: currentThread.some(e => e.role === 'compaction'),
    markInDom: !!document.querySelector('#thread .compaction-mark'),
  };
});

check('témoin : on a bien quitté la conversation pendant le geste',
  navigated.leftScreen === true);
check('le geste ABOUTIT malgré la navigation (plus d\'abandon silencieux)',
  !!(navigated.res && navigated.res.done));
check('la frontière est PERSISTÉE dans la conversation compactée',
  navigated.storedHasBoundary === true);
check('rien n\'a été écrit dans la conversation d\'arrivée (piège 28)',
  navigated.otherHasBoundary === false);
// La garde anti-troncature de persistGeneration (piège 29) : l'historique doit
// être intact ET augmenté de la frontière, jamais remplacé par elle.
check('l\'historique n\'a pas été tronqué (piège 29)',
  navigated.storedCount > navigated.before);
check('au retour, la frontière est dans le thread', navigated.threadHasBoundary === true);
check('et le séparateur est visible dans le fil', navigated.markInDom === true);

// Variante : partir puis REVENIR pendant la rédaction. `currentConvId` vaut
// alors la bonne conversation, mais `currentThread` est un tableau NEUF relu
// du storage (openConversation ne rebranche pas sur une compaction). Décider
// le référentiel sur l'égalité des ids plutôt que sur l'identité du tableau
// poserait la frontière dans la copie, et `persistCurrent` écraserait l'autre.
const returned = await page.evaluate(async () => {
  await newConversation();
  ensureConversation();
  const targetId = currentConvId;
  for (let i = 0; i < 6; i++) {
    currentThread.push({ role: 'user', content: 'Q' + i + ' ' + new Array(200).join('m') });
    currentThread.push({ role: 'assistant', content: 'R' + i + ' ' + new Array(200).join('r') });
  }
  await persistCurrent();
  const before = currentThread.length;

  await newConversation(); ensureConversation();
  currentThread.push({ role: 'user', content: 'ailleurs' });
  await persistCurrent();
  const otherId = currentConvId;
  await openConversation(targetId);

  const real = window.silentCompletion;
  silentCompletion = async function () {
    await openConversation(otherId);    // on part…
    await openConversation(targetId);   // …et on REVIENT avant la fin
    return JSON.stringify({ summary: 'Résumé rédigé pendant un aller-retour.' });
  };
  let res;
  try { res = await compactCurrentConversation(); }
  finally { silentCompletion = real; }

  await warmConversation(targetId);
  const stored = (loadConversation(targetId) || {}).messages || [];
  return {
    res, before,
    storedBoundaries: stored.filter(e => e.role === 'compaction').length,
    storedCount: stored.length,
    markInDom: !!document.querySelector('#thread .compaction-mark'),
  };
});

check('aller-retour : le geste aboutit', !!(returned.res && returned.res.done));
check('aller-retour : UNE frontière persistée, pas zéro ni deux',
  returned.storedBoundaries === 1);
check('aller-retour : l\'historique est intact', returned.storedCount > returned.before);
check('aller-retour : le séparateur est peint sans rechargement manuel',
  returned.markInDom === true);

// ════════════════════════════════════════════════════════════════════════════
// 8. Appariement bulle ↔ entrée de thread APRÈS une frontière
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 8. Édition d\'un message après une frontière ──');

// Défaut signalé par Julien le 2026-09-22, et c'est un DÉCALAGE : la frontière
// de compaction n'est pas un ack, mais elle ne produit pas de bulle `.msg` non
// plus (c'est un séparateur). `reindexThreadDom` la comptait donc comme une
// entrée à bulle, et tous les indices d'après glissaient de un — l'édition d'un
// message user chargeait la textarea avec le contenu du message SUIVANT, puis
// `editUserMessage` refusait silencieusement (`role !== 'user'`), d'où un
// « Valider » sans effet.
//
// Le pur `entryHasMsgBubble` est couvert par QuickJS ; ce qui ne l'est pas, et
// qui est l'objet de ce bloc, c'est le CÂBLAGE DOM → thread : les tests purs
// ne voient ni `data-thread-idx` ni la textarea. On mesure donc les deux
// symptômes que Julien a vus, pas le prédicat.
const edited = await page.evaluate(async () => {
  await newConversation();
  ensureConversation();
  currentThread.push({ role: 'user', content: 'U-avant' });
  currentThread.push({ role: 'tool-ack', kind: 'mcp_call', name: 'srv__foo',
                       args: { q: 1 }, result: 'ok', ts: Date.now(), group: 'g1' });
  currentThread.push({ role: 'assistant', content: 'A-avant' });
  currentThread.push({ role: 'compaction', content: 'Résumé.', reclaimed: 10, ts: Date.now() });
  currentThread.push({ role: 'user', content: 'U-après' });
  currentThread.push({ role: 'assistant', content: 'A-après' });
  await persistCurrent();
  rerenderCurrentThread();

  // Chaque bulle doit pointer l'entrée dont elle affiche le texte. On compare
  // le TEXTE peint à celui de l'entrée visée : un appariement décalé coïncide
  // parfois par hasard sur les indices, jamais sur le contenu.
  const rows = Array.from(document.querySelectorAll('#thread .msg')).map(w => ({
    idx: Number(w.dataset.threadIdx),
    painted: (w.querySelector('.body') || {}).textContent || '',
  }));
  return {
    rows: rows.map(r => ({ idx: r.idx, painted: r.painted.trim(),
      pointed: (currentThread[r.idx] || {}).content })),
    bubbles: rows.length,
    entries: currentThread.length,
  };
});

check('témoin : quatre bulles pour six entrées (ack + frontière sans bulle)',
  edited.bubbles === 4 && edited.entries === 6);
check('chaque bulle pointe l\'entrée dont elle affiche le texte',
  edited.rows.every(r => r.painted === r.pointed));
// Le message d'APRÈS la frontière est celui que le décalage visait : sans le
// correctif, sa bulle pointait l'assistant qui le suit.
const afterRow = edited.rows.find(r => r.painted === 'U-après');
check('le message user d\'après la frontière pointe bien son entrée',
  !!afterRow && afterRow.pointed === 'U-après');

// Symptôme 1 : la textarea se remplissait avec le mauvais contenu.
const ta = await page.evaluate(() => {
  const wrap = Array.from(document.querySelectorAll('#thread .msg.user'))
    .find(w => (w.querySelector('.body') || {}).textContent.trim() === 'U-après');
  enterEditMode(wrap);
  const area = wrap.querySelector('.msg-edit-area');
  return area ? area.value : null;
});
check('la textarea d\'édition est remplie avec le message CLIQUÉ', ta === 'U-après');

// Symptôme 2 : « Valider » restait sans effet (editUserMessage refusait sur un
// index non-user, et son refus est un `null` silencieux — pas un message).
// On stube le tour de génération : ce qu'on mesure est la TRONCATURE du thread,
// preuve que la réécriture a bien eu lieu à l'index visé.
const submitted = await page.evaluate(async () => {
  const wrap = Array.from(document.querySelectorAll('#thread .msg.user'))
    .find(w => w.classList.contains('editing'));
  const realRun = window.runGenerationFromCurrentThread;
  runGenerationFromCurrentThread = async function () { return null; };
  let err;
  try { err = await commitEdit(wrap, 'U-après CORRIGÉ'); }
  finally { runGenerationFromCurrentThread = realRun; }
  return {
    err,
    roles: currentThread.map(e => e.role),
    last: currentThread[currentThread.length - 1],
    stillBoundary: currentThread.some(e => e.role === 'compaction'),
  };
});
check('la soumission réécrit bien le message (thread tronqué à l\'index visé)',
  submitted.last && submitted.last.role === 'user' &&
  submitted.last.content === 'U-après CORRIGÉ');
check('la frontière de compaction survit à la réécriture', submitted.stillBoundary === true);
check('aucune erreur d\'édition remontée', !submitted.err);

// ════════════════════════════════════════════════════════════════════════════
// 9. La pastille « non lu » après une compaction sous les yeux
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 9. Pas de « non lu » sur une compaction qu\'on regarde ──');

// Second défaut signalé le 2026-09-22. `unregisterGeneration` lisait
// `genOwnsScreen` pour répondre à « la conversation est-elle sous les yeux ? ».
// Les deux coïncident pour un stream, mais une compaction est EXEMPTÉE de
// `genOwnsScreen` par construction (elle ne peint rien) : la pastille se posait
// donc même en regardant la conversation, scrollé au fond, et ne s'effaçait
// qu'en partant puis revenant (`openConversation` → `markConvRead`).
//
// Le contrôle porte sur `convBadgeState` APRÈS le geste, sans changer d'écran —
// exactement le geste que Julien ne pouvait pas faire.
const badge = await page.evaluate(async () => {
  await newConversation();
  ensureConversation();
  const targetId = currentConvId;
  for (let i = 0; i < 6; i++) {
    currentThread.push({ role: 'user', content: 'Q' + i + ' ' + new Array(200).join('m') });
    currentThread.push({ role: 'assistant', content: 'R' + i + ' ' + new Array(200).join('r') });
  }
  await persistCurrent();
  rerenderCurrentThread();
  scrollBottom(true);

  const real = window.silentCompletion;
  silentCompletion = async function () {
    return JSON.stringify({ summary: 'Résumé d\'une compaction regardée.' });
  };
  let res;
  try { res = await compactCurrentConversation(); }
  finally { silentCompletion = real; }

  return {
    res,
    onScreen: currentConvId === targetId,
    atBottom: isAtBottom(),
    unseen: hasThreadUnseen(targetId),
    badge: convBadgeState(targetId),
    // Le badge se lit aussi dans la sidebar : un état interne juste avec un
    // rendu qui traîne laisserait la pastille à l'écran (souvenir
    // `ui-refresh-at-write-point`). La conversation compactée est l'ACTIVE (on
    // ne l'a pas quittée) ; la pastille existe toujours en DOM et c'est
    // `hidden` qui porte l'état (applyActivityBadge), donc on lit le pixel.
    dotInSidebar: (() => {
      const d = document.querySelector('.conv.active .activity-dot');
      if (!d) return false;
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(d).display !== 'none';
    })(),
  };
});

check('témoin : le geste a abouti', !!(badge.res && badge.res.done));
check('témoin : on est resté dans la conversation, scrollé au fond',
  badge.onScreen === true && badge.atBottom === true);
check('témoin : rien de non vu dans le fil', badge.unseen === false);
check('AUCUNE pastille « non lu » après une compaction regardée', badge.badge === null);
check('et rien de peint dans la sidebar', badge.dotInSidebar === false);

// Réciproque : la même compaction, mais lancée depuis une conversation qu'on
// QUITTE, doit bien poser la pastille. Sans ce versant, le contrôle ci-dessus
// passerait aussi sur un code qui aurait simplement supprimé le marquage.
const badgeAway = await page.evaluate(async () => {
  await newConversation();
  ensureConversation();
  const targetId = currentConvId;
  for (let i = 0; i < 6; i++) {
    currentThread.push({ role: 'user', content: 'Q' + i + ' ' + new Array(200).join('m') });
    currentThread.push({ role: 'assistant', content: 'R' + i + ' ' + new Array(200).join('r') });
  }
  await persistCurrent();
  await newConversation(); ensureConversation();
  currentThread.push({ role: 'user', content: 'ailleurs' });
  await persistCurrent();
  const otherId = currentConvId;
  await openConversation(targetId);

  const real = window.silentCompletion;
  silentCompletion = async function () {
    await openConversation(otherId);   // on part et on NE revient pas
    return JSON.stringify({ summary: 'Résumé hors écran.' });
  };
  let res;
  try { res = await compactCurrentConversation(); }
  finally { silentCompletion = real; }

  return { res, left: currentConvId === otherId, badge: convBadgeState(targetId) };
});

check('témoin : on a bien quitté la conversation compactée', badgeAway.left === true);
check('une compaction finie HORS écran pose bien la pastille',
  badgeAway.badge === 'unread');

// ════════════════════════════════════════════════════════════════════════════
// 10. Revenir en arrière par-dessus une frontière (revue du 2026-09-22)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── 10. Régénérer / éditer / continuer par-dessus une frontière ──');

// Régénérer ou éditer avant la dernière frontière la retire (retour en arrière
// ACCEPTÉ, décision Julien) : second clic exigé AVANT, bandeau « Compaction
// annulée » APRÈS. « Continuer » une réponse tronquée d'avant la frontière est,
// lui, refusé. Les purs (`compactionUndoneNotice`, `regenerateKeptLength`,
// `compactionFollows`) sont couverts en QuickJS ; l'objet de ce bloc est le
// CÂBLAGE — onclick réel, état armé peint, bandeau visible, bouton inerte.
// Chaque « avant/après » est mesuré dans un même evaluate : l'armement se
// désarme seul après ARM_DELETE_MS.
const seedBoundary = async (page, { truncated } = {}) => page.evaluate(async (tr) => {
  await newConversation();
  ensureConversation();
  currentThread.push({ role: 'user', content: 'U1' });
  const a = { role: 'assistant', content: 'A1' };
  if (tr) a.truncated = true;
  currentThread.push(a);
  currentThread.push({ role: 'compaction', content: 'Résumé.', reclaimed: 10, ts: Date.now() });
  await persistCurrent();
  rerenderCurrentThread();
  clearCompactionUndoneBanner();
}, !!truncated);

const bannerShown = () => {
  const el = document.getElementById('compaction-undone-banner');
  const r = el.getBoundingClientRect();
  return { shown: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none',
           text: (document.getElementById('compaction-undone-text') || {}).textContent || '' };
};

await seedBoundary(page);
const regen = await page.evaluate(async (bannerShownSrc) => {
  const bannerShown = eval(bannerShownSrc);
  const btn = document.querySelector('#thread .msg.assistant .msg-regen');
  const real = window.runGenerationFromCurrentThread;
  let runs = 0;
  runGenerationFromCurrentThread = async function () { runs++; return null; };
  const out = { visible: !!btn && !btn.hidden };
  try {
    btn.click();
    // `.msg-regen` transitionne son fond en 150 ms : mesuré à l'instant du clic,
    // on lirait une valeur intermédiaire (rouge au premier passage, pour cette
    // raison et non pour un défaut de CSS). On attend la fin de la transition,
    // bien en deçà de la fenêtre d'armement.
    await new Promise(r => setTimeout(r, 300));
    // Couleur de l'état armé : l'ACCENT de la palette, jamais le rouge --err
    // des suppressions. Comparée à une sonde peinte avec les deux tokens.
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    probe.style.background = 'var(--accent)';
    const accent = getComputedStyle(probe).backgroundColor;
    probe.style.background = 'var(--err)';
    const err = getComputedStyle(probe).backgroundColor;
    probe.remove();
    out.afterFirst = {
      armed: btn.classList.contains('armed'),
      bg: getComputedStyle(btn).backgroundColor, accent, err,
      title: btn.title,
      boundary: currentThread.some(e => e.role === 'compaction'),
      runs,
      banner: bannerShown(),
    };
    btn.click();
    out.afterSecond = {
      boundary: currentThread.some(e => e.role === 'compaction'),
      runs,
      banner: bannerShown(),
    };
    document.querySelector('#compaction-undone-banner .compaction-undone-close').click();
    out.afterClose = bannerShown();
  } finally { runGenerationFromCurrentThread = real; }
  return out;
}, bannerShown.toString());

check('témoin : « régénérer » est offert sur la réponse qui précède la frontière', regen.visible);
check('premier clic : le bouton s\'ARME, rien n\'est tronqué',
  regen.afterFirst.armed && regen.afterFirst.boundary && regen.afterFirst.runs === 0);
check(`l'état armé porte l'accent de la palette, pas le rouge des suppressions (${regen.afterFirst.bg})`,
  regen.afterFirst.bg === regen.afterFirst.accent && regen.afterFirst.bg !== regen.afterFirst.err);
check('le title armé dit que la compaction sera annulée', /annulera la compaction/.test(regen.afterFirst.title));
check('aucun bandeau avant la confirmation', !regen.afterFirst.banner.shown);
check('second clic : la régénération part et la frontière est retirée',
  regen.afterSecond.runs === 1 && !regen.afterSecond.boundary);
check('le bandeau « Compaction annulée » est PEINT',
  regen.afterSecond.banner.shown && /^Compaction annulée/.test(regen.afterSecond.banner.text));
check('il dit que toute la conversation repart (aucune frontière antérieure)',
  /toute la conversation/.test(regen.afterSecond.banner.text));
check('sa croix le lève', !regen.afterClose.shown);

// Réciproque : sans frontière emportée, un clic suffit — sans elle, les
// contrôles ci-dessus passeraient sur un code qui armerait TOUJOURS.
const nominal = await page.evaluate(async () => {
  await newConversation();
  ensureConversation();
  currentThread.push({ role: 'user', content: 'U1' });
  currentThread.push({ role: 'assistant', content: 'A1' });
  await persistCurrent();
  rerenderCurrentThread();
  const btn = document.querySelector('#thread .msg.assistant .msg-regen');
  const real = window.runGenerationFromCurrentThread;
  let runs = 0;
  runGenerationFromCurrentThread = async function () { runs++; return null; };
  try { btn.click(); } finally { runGenerationFromCurrentThread = real; }
  return { runs, armed: btn.classList.contains('armed') };
});
check('sans frontière emportée : un seul clic régénère, rien ne s\'arme',
  nominal.runs === 1 && !nominal.armed);

// Édition d'un message situé AVANT la frontière : même garde sur le crayon.
await seedBoundary(page);
// Deux temps : la rangée d'actions monte en opacité par une transition
// (120ms, chat.css) ; lue dans le même tour que le clic, elle valait encore 0
// une fois sur deux. On attend l'état TERMINAL avant le second clic (la
// fenêtre d'armement court bien au-delà).
const editFirst = await page.evaluate(() => {
  const wrap = document.querySelector('#thread .msg.user');
  const btn = wrap.querySelector('.msg-edit');
  btn.click();
  return { armed: btn.classList.contains('armed'),
           editing: !!wrap.querySelector('.msg-edit-area') };
});
const actionsVisible = await page.waitForFunction(() =>
  getComputedStyle(document.querySelector('#thread .msg.user .msg-user-actions')).opacity === '1',
  null, { timeout: 1500 }).then(() => true, () => false);
const actionsOpacity = await page.evaluate(() =>
  getComputedStyle(document.querySelector('#thread .msg.user .msg-user-actions')).opacity);
const editGuard = await page.evaluate((first) => {
  const wrap = document.querySelector('#thread .msg.user');
  wrap.querySelector('.msg-edit').click();
  return { first, editingAfter: !!wrap.querySelector('.msg-edit-area') };
}, Object.assign(editFirst, { actionsVisible, opacity: actionsOpacity }));
check('éditer avant la frontière : le premier clic arme sans ouvrir l\'édition',
  editGuard.first.armed && !editGuard.first.editing);
check(`le crayon armé reste visible hors survol (opacité ${editGuard.first.opacity})`, editGuard.first.actionsVisible);
check('le second clic ouvre l\'édition', editGuard.editingAfter);

// « Continuer » une réponse tronquée d'avant la frontière : refusé, bouton
// inerte avec son motif, et aucune génération au point de mutation.
await seedBoundary(page, { truncated: true });
const cont = await page.evaluate(() => {
  const btn = document.querySelector('#thread .msg.assistant .msg-continue');
  const real = window.dispatchSend;
  let calls = 0;
  dispatchSend = function () { calls++; };
  try { continueTruncated(btn); } finally { dispatchSend = real; }
  return { present: !!btn, disabled: btn && btn.disabled, title: btn && btn.title, calls };
});
check('témoin : la réponse tronquée porte son bouton « Continuer »', cont.present);
check('il est DÉSACTIVÉ, avec un title qui dit pourquoi',
  cont.disabled && /compaction/.test(cont.title));
check('même appelé directement, il ne lance rien (garde au point de mutation)', cont.calls === 0);

// ════════════════════════════════════════════════════════════════════════════
console.log('\n────────────────────────────────────────────');
if (consoleErrors.length) {
  console.log('Erreurs console :', JSON.stringify(consoleErrors, null, 2));
  failures.push('erreurs console');
}
if (failures.length) {
  console.log(`ÉCHEC — ${failures.length} contrôle(s) rouge(s) :`);
  failures.forEach(f => console.log('  · ' + f));
} else {
  console.log('OK — tous les contrôles sont verts.');
}
console.log('Captures :', outDir);
await browser.close();
process.exitCode = failures.length ? 1 : 0;
