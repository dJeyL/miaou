# Rendu enrichi des blocs de code — Mermaid & préviz sandboxée (lot E)

Ce document couvre le rendu des diagrammes Mermaid dans le fil de conversation
(lot E1), la préviz sandboxée des blocs HTML/SVG (lot E2) et la lightbox
pan/zoom avec exports d'image SVG/PNG (lot E3). L'export HTML standalone avec
SVG Mermaid embarqué (lot E4, `embedExportMermaid`) est documenté dans
`docs/exports.md` — même posture de sécurité (Mermaid strict, pas de
re-sanitisation), même conservation de l'id du SVG. À lire avant de toucher
`renderMermaidUnder`, `ensureMermaid`, `decoratePre` (parties mermaid/aperçu),
la lightbox (`openMermaidLightbox` et voisines) ou le hook thème de
`applyTheme`.

## Lazy-load (ensureMermaid, ui.js)

Mermaid (~2,5 Mo minifié) n'est **pas** chargé comme Prism : le cœur de Prism
est un `<script src>` statique dans `index.html`, payé à chaque ouverture de
page. Pour Mermaid, injection dynamique d'un `<script>` au premier bloc
` ```mermaid ` rencontré, derrière une **promesse mémoïsée avec reset sur
rejet** : un échec CDN n'empoisonne pas la session, la passe suivante retente.

Pin : `https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.12.0/mermaid.min.js`
— même host que marked/DOMPurify/Prism, build **IIFE** exposant
`window.mermaid` (pas l'ESM `.mjs` : le projet n'a pas de modules). Confirmé
par Julien le 2026-07-10.

Configuration (`mermaidInit`) :

- `startOnLoad: false` — le rendu est piloté par la passe, jamais spontané.
- `securityLevel: 'strict'` — c'est le défaut Mermaid, mais posé
  **explicitement** pour qu'un upgrade ne l'assouplisse pas en silence
  (cf. Sécurité ci-dessous).
- `htmlLabels: false` (global + `flowchart`) — labels en `<text>` SVG pur,
  aucun `<foreignObject>` dans le SVG produit. Prérequis de l'export PNG
  canvas (lot E3 : un `<foreignObject>` rend le canvas tainted/blanc sur
  Safari). Rendu des labels légèrement différent du défaut Mermaid : assumé.
  **Corollaire** : les balises HTML de mise en forme (`<b>`, `<i>`, `<em>`…)
  ne sont PAS interprétées, elles s'affichent littéralement dans les `<text>`.
  Le modèle en glisse parfois malgré la doctrine → strippées avant render,
  cf. `sanitizeMermaidSource` ci-dessous.
- `theme` — dérivé du `data-theme` résolu via `mermaidThemeFor` (utils.js,
  pure) : `dark` → `'dark'`, tout le reste → `'default'` (clair).

## Nettoyage de la source avant render (sanitizeMermaidSource, utils.js)

`CODEBLOCK_DOCTRINE` (tools.js, `v4`) demande au modèle trois choses pour les
diagrammes : ne **jamais** poser de séquence backslash-n littérale dans un
label (Mermaid ne l'interprète pas comme saut de ligne — seul `<br/>` l'est),
**quoter** tout label contenant un caractère spécial (`A["France (2-0)"]` —
une parenthèse nue dans un `[label]` casse le parse, Mermaid l'interprète
comme un délimiteur de forme), et **ne pas** poser de balises HTML de mise en
forme dans les labels. Le modèle obéit de façon inégale (le backslash-n
littéral et la contrainte négative sur `<b>` en particulier — récidive
observée sur plusieurs modèles malgré la doctrine, cf. lot E retouche
post-livraison).

Défense en profondeur côté application, **indépendante de l'obéissance du
modèle** : `sanitizeMermaidSource(src)` (pure, testée QuickJS) strippe les
balises `b/i/em/strong/u/mark/small` de la chaîne **passée à `mermaid.render`**,
en préservant `<br/>` (seule balise reconnue par Mermaid, saut de ligne), et
convertit toute séquence backslash-n **littérale** (deux caractères `\`+`n`
dans le texte, pas un vrai saut de ligne) en `<br/>`. Elle n'altère **jamais**
`code.textContent` (source de vérité pour toggle, thème, exports, lightbox).
Appliquée aux **deux** points de rendu — `renderMermaidUnder` (écran) et
`embedExportMermaid` (export standalone) — pour que l'export corresponde à
l'écran. Comme `src` sert aussi de clef d'idempotence (`_mermaidSrc`/
`_mermaidErrSrc`) et de garde anti-obsolescence, ces comparaisons portent sur
la version **strippée** (re-strip de `code.textContent` au retour d'`await`),
pas sur le brut.

Le quoting des parenthèses, lui, n'est **pas** rattrapé côté app (il faudrait
un parseur mermaid pour distinguer une parenthèse de label d'un délimiteur de
forme) : seul le prompt le couvre, et un diagramme non quoté qui casse tombe
proprement sur la notice `.mermaid-error`.

## Cycle de rendu (renderMermaidUnder, ui.js)

La passe transforme chaque `code.language-mermaid` d'un scope en diagramme.
Points d'accroche — **finalisation uniquement, jamais pendant le streaming**
(source partielle = flicker + erreurs de parse en cascade) :

- `finalizeAssistant` (fin de message live, après `highlightUnder`) ;
- `buildMsg` (messages historiques : reload, `renderThread`, édition).
  Fire-and-forget : la continuation async s'exécute en microtâche, après que
  l'appelant a appendé le wrap au DOM (garde `isConnected` dans la passe).
- `streamInto` appelle `decoratePre` (le bouton toggle existe donc pendant le
  stream, **caché**) mais ne déclenche JAMAIS la passe.

Architecture DOM : le `<pre>` n'est **jamais détruit**. La vue rendue
(`.mermaid-view`, porteuse du SVG) vit **dans** le `<pre>` — même précédent
que `.code-head`, div insérée là par `decoratePre` — pour que l'en-tête, donc
le bouton toggle, reste visible dans les deux états. La classe
`.mermaid-rendered` sur le `<pre>` inverse code ↔ vue (pur CSS, chat.css).
`code.textContent` reste l'**unique source de vérité** : re-render thème,
toggle, futurs exports et lightbox relisent là.

Détails de la passe :

- Idempotence : une vue existante dont `_mermaidSrc` égale la source courante
  est conservée telle quelle ; une source déjà en échec (`pre._mermaidErrSrc`)
  n'est pas retentée (l'édition du message change la source → retente).
- `mermaid.render(uid, src)` exige un id unique : compteur + suffixe aléatoire
  (jamais un timestamp seul).
- Garde anti-obsolescence après chaque `await` : `pre.isConnected` et source
  inchangée, sinon abandon silencieux du résultat.
- **Échec de parse** → `<pre>` intact + notice `.mermaid-error`
  (« Diagramme invalide — source affichée »), jamais de rendu cassé. Mermaid
  v11 peut laisser un nœud d'erreur orphelin dans `document.body` : nettoyé
  (ids `uid` et `d<uid>`).
- **CDN indisponible** → passe silencieuse, la source surlignée reste (même
  dégradation que marked/DOMPurify offline).

## Toggle rendu ↔ source

Bouton `.code-mmd-toggle` (pictogramme « diagramme », 3 nœuds reliés) dans
`.code-actions`, posé par `decoratePre` **uniquement** sur les blocs
`language-mermaid` (`isMermaidLang`, utils.js). Câblé en **closure** `onclick`
comme copier/télécharger — pas de handler global, la liste CLAUDE.md est
inchangée. Caché tant qu'aucun rendu n'a réussi ; révélé par la passe.
Accentué (`--accent`) quand la vue rendue est affichée.

## Thème

Hook **unique** dans `applyTheme` → `refreshMermaidTheme(resolved)` : couvre
`selectTheme` ET le suivi matchMedia OS. `mermaid.initialize` ne ré-applique
pas le thème aux SVG déjà rendus → si le thème mermaid résolu change et que
Mermaid est chargé : re-`initialize`, purge des `.mermaid-view` du fil,
re-passe. La classe `.mermaid-rendered` est conservée pendant le re-render
(pas de flash de source). Si Mermaid n'a jamais été chargé : no-op.

## Sécurité (surface DOM live)

Le SVG produit par `mermaid.render` est inséré via `innerHTML` dans
`.mermaid-view` — du markup dérivé de texte d'origine modèle atteint donc le
DOM live. Posture :

- `securityLevel: 'strict'` : Mermaid sanitise lui-même labels et liens
  (DOMPurify interne, interactions `click` désactivées).
- On ne re-passe **pas** cette sortie dans `sanitizeHtml` : DOMPurify
  généraliste ampute les `<style>` internes des SVG Mermaid (rendu cassé), et
  la sanitisation amont couvre déjà le vecteur.
- `htmlLabels: false` réduit la surface à du SVG « dessin » pur (pas de
  `<foreignObject>`, donc pas de HTML arbitraire dans le SVG).

La préviz HTML/SVG relève d'une posture différente : voir ci-dessous.

## Préviz sandboxée HTML/SVG (lot E2, D2)

Bouton « œil » (`.code-preview-btn`) dans `.code-actions`, posé par
`decoratePre` sur les blocs dont la langue est éligible (`isPreviewableLang`,
utils.js : `html` et `svg` seulement — `xml`/`xhtml` exclus, pas de runner JS,
non-goals du brief). **Clic explicite uniquement, jamais automatique** —
posture de sécurité et de coût.

Fonctionnement (closure dans `decoratePre`, pas de handler global) :

- Le clic crée (ou réutilise) un conteneur `.code-preview` DANS le `<pre>`
  (même motif que `.mermaid-view`), portant un bouton fermer (×) et l'iframe.
  La classe `.preview-open` sur le `<pre>` masque la source ; fermer retire le
  conteneur et restaure la source. Un seul aperçu par bloc.
- **Re-clic = re-render** depuis `code.textContent` courant (source de vérité
  unique).
- Le srcdoc est construit par `buildPreviewSrcdoc(lang, code)` (utils.js,
  pure) : `html` → passthrough byte-identique ; `svg` → enveloppé dans un
  document HTML minimal (un SVG nu n'est pas un document srcdoc valide, et il
  peut porter `<script>` : il s'exécute, confiné — contrat D2).
- CSS (`chat.css`) : iframe `width: 100%`, hauteur fixe 420px (décision
  Julien 2026-07-10 : pas de resize, pas d'auto-height postMessage), fond
  blanc forcé quel que soit le thème (le contenu prévisualisé suppose un fond
  clair par défaut).

### Sécurité — la frontière est l'iframe (piège 23)

- `<iframe sandbox="allow-scripts">` **sans `allow-same-origin`** : origine
  opaque → aucun accès à localStorage (clefs API), IndexedDB ni au DOM parent.
  Un `<script>` embarqué s'exécute mais reste confiné. Ne JAMAIS ajouter
  `allow-same-origin` (combiné à `allow-scripts`, il annule la sandbox).
- `srcdoc` posé par **propriété JS** sur un élément `createElement`, jamais
  interpolé dans un template string HTML → pas d'échappement d'attribut à
  gérer, ne pas en créer un.
- C'est l'exception sanctionnée à la doctrine `textContent` — et la SEULE :
  aucune autre voie d'injection de markup modèle (piège 23, CLAUDE.md et
  `docs/pitfalls-detail.md`).
- L'export HTML standalone n'embarque aucune iframe de préviz.

## Lightbox & exports d'image (lot E3)

Barre d'actions `.mermaid-actions` posée par `renderMermaidUnder` (via
`attachDiagramActions`) sur chaque `.mermaid-view` : agrandir (flèches
diagonales), « SVG », « PNG ». Câblage en **closures**, comme les boutons de
`decoratePre` — pas de nouveaux handlers globaux. La source des exports est
toujours le SVG **courant** de la vue, relu au clic.

### Exports SVG et PNG

- `serializeDiagramSvg(svgEl)` (ui.js, DOM) : sérialise un **clone** du SVG
  avec des dimensions explicites tirées du viewBox — Mermaid pose
  `width="100%"` + `max-width`, dont la taille intrinsèque retombe à 300×150
  quand le XML est rasterisé via `<img>`. Le SVG affiché n'est jamais modifié.
- SVG : `XMLSerializer` → `downloadFile(name, xml, 'image/svg+xml')` —
  `downloadFile` reste le point d'entrée download unique du projet.
- PNG (`downloadDiagramPng`) : XML → Blob → `<img>` → canvas **2x**
  (dimensions viewBox) → `toBlob('image/png')` → `downloadFile`. **Fond
  opaque** rempli avec le `--code-bg` résolu du thème actif avant `drawImage`
  (un PNG transparent issu du thème sombre est illisible collé dans un
  document clair). `htmlLabels: false` (cf. Lazy-load) garantit l'absence de
  `<foreignObject>` → canvas jamais tainted, y compris Safari.
- Nom de fichier : `diagramImageName(rawName, ext)` (utils.js, **pure**) —
  `data-filename` du fence assaini par `sanitizeDownloadName`, extension
  remplacée par `svg`/`png` (un fence mermaid porte typiquement `.mmd`) ;
  `miaou-diagram.<ext>` par défaut. La `CODEBLOCK_DOCTRINE` (tools.js, `v2`)
  demande explicitement au modèle un `filename=` sur les blocs mermaid pour
  alimenter ce nommage — cf. `docs/tools.md`.

### Lightbox pan/zoom

Singleton DOM (`.mermaid-lightbox`, créé au premier usage, `ensureLightbox`),
affiche le contenu courant (clone SVG ou `<img>`, cf. généralisation A3-2
ci-dessous) sur fond `--code-bg`, overlay `rgba(0,0,0,.75)` en `z-index: 60`
(au-dessus des drawers, 50). Transform CSS `translate+scale` sur un wrapper
interne (`transform-origin: 0 0`) :

- **molette** = zoom centré curseur (facteur 1.2, borné [0.1, 24]) ;
- **drag** = pan (pointer capture — le drag survit à la sortie de la scène) ;
- **double-clic** = reset (re-fit : jamais agrandi au-delà de l'échelle 1,
  centré avec marge) ;
- **fermeture** : bouton ×, clic (sans drag) sur le fond de la scène hors
  diagramme, ou **Escape — niveau 0 de la cascade D-Esc** (`ui.js`,
  `closeMermaidLightboxViaEscape`, prioritaire sur dropdowns/drawers/sidebar).

Les boutons SVG/PNG sont repris dans la lightbox (mêmes fonctions d'export,
sur le clone). À la fermeture, le clone est purgé (pas de gros SVG résident).

**Généralisation image (lot A3-2)** : le cœur pan/zoom/fermeture (agnostique
du contenu depuis l'origine — il transforme `_lbCanvas`, peu importe ce qu'il
contient) est resté inchangé. Extraction mécanique :
`openLightboxWith(contentEl, w, h, rawName, mode)` factorise le
dimensionnement/affichage/fit communs ; `openMermaidLightbox` (diagrammes,
`mode:'mermaid'`) et deux nouveaux appelants portent chacun leur construction
de contenu :

- `openAttachmentLightbox(record)` — pièce jointe de bulle envoyée (clic
  vignette, cf. `docs/storage.md` §A3-1) : `<img>` sur le record du cache
  session (mêmes bytes que `resolveAttachmentThumb`, déjà downscalés
  ≤1536px — pas de résolution « pleine taille » distincte), dimensions
  `record.w`/`record.h` (champs figés du schéma attachment).
- `openToolImageLightbox(imgEl)` — image modèle inline (`.tool-block-img`,
  résultat d'outil éphémère, `renderToolBlock`) : clic direct sur l'`<img>`
  déjà rendu (closure posée à la création, pas de handler global — élément
  créé par `createElement`) ; dimensions lues sur l'élément
  (`naturalWidth`/`naturalHeight`, pas de schéma figé ici, contenu jamais
  persisté).

La barre d'actions (`.mermaid-lightbox-actions`) est construite **une seule
fois** (pas de refonte du singleton) : boutons SVG/PNG et bouton unique
« Télécharger » (icône `ICON_DOWNLOAD`, même tracé que `.code-dl`) coexistent
dans le DOM, togglés via `hidden` selon le mode — `openLightboxWith` masque
SVG/PNG et révèle Télécharger en mode `'image'` (et inversement). Les
closures SVG/PNG restent posées mais inertes (cachées) en mode image ; la
closure du bouton Télécharger est reciblée (`onclick` réassigné) à chaque
ouverture vers le download du contenu courant (`downloadFile`, direct depuis
le record ou reconstruit depuis le `src` data-URI pour le mode outil).
Téléchargement d'une image = **exclusivement** ce bouton (le clic simple sur
la vignette/l'image ouvre la lightbox, ne télécharge jamais).

## Tests

- QuickJS (`tests/test-utils.js`) : `isMermaidLang`, `mermaidThemeFor`,
  `sanitizeMermaidSource`, `isPreviewableLang`, `buildPreviewSrcdoc`,
  `diagramImageName` — les seuls helpers purs. Le rendu, le toggle, le thème, l'iframe, la lightbox et le
  canvas PNG sont du **territoire manuel** : `docs/manual-tests.md` tests 71
  à 84.
- Fixtures : `tests/dev-seed.html` seed-23 (bloc mermaid valide avec
  `filename=flux-oauth.mmd` — exercice du nommage d'export E3 — + bloc
  invalide + bloc bash de contrôle) et seed-24 (page HTML avec script sondant
  `localStorage`, SVG avec `<script>` embarqué, bloc xml de contrôle).
