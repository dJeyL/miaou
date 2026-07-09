# Export Markdown, export HTML, téléchargements et horodatages

## Export Markdown et téléchargements

- `downloadFile(filename, content, mimeType)` dans `utils.js` : Blob +
  `createObjectURL` + `<a download>` éphémère + clic programmatique +
  `revokeObjectURL`. **N'est pas un outil LLM.** Point d'entrée unique pour
  tout téléchargement côté client (blocs de code, messages, export conversation,
  et futurs backup/import).
- `slugTitle(title)` dans `utils.js` (pure, testée QuickJS) : slug de nom de
  fichier depuis le titre de conversation. Les lettres accentuées sont
  **translittérées** en ASCII (`normalize('NFD')` + suppression des marques
  diacritiques U+0300–U+036F) **avant** le remplacement du reste par des
  tirets — « café » donne `cafe`, pas `caf` ni `caf-`. Fallback
  `miaou-conversation` si le titre est vide ou ne contient que des caractères
  non alphanumériques (après translittération). Utilisée par `downloadConvMd`
  (`.md`, sans date) et l'export HTML (`.html`, avec date — cf. section
  dédiée ci-dessous).
- `exportDateStamp(now)` dans `utils.js` (pure, testée QuickJS) : horodatage
  `YYYY-MM-DD` déterministe (heure locale, pas d'`Intl`/`toLocaleString`),
  utilisé dans le nom de fichier de l'export HTML.
- `LANG_TO_EXT` / `langExt(lang)` dans `utils.js` : table langage → extension.
  Fallback `.txt` si le langage est absent ou inconnu.
- Bouton `.code-dl` dans `decoratePre` (ui.js) : posé aux côtés de `.code-copy`,
  télécharge le contenu brut du bloc.
- **`.msg-dl` (bouton download d'un message assistant) porte l'attribut `hidden`
  à la création** (`assistantHead`) et est révélé uniquement par `finalizeAssistant`
  (message live) **et** `buildMsg` (reload depuis storage). Ne jamais l'afficher
  avant finalisation — le contenu est incomplet pendant le streaming.
  Le contenu brut à télécharger est stocké dans `body.dataset.raw`, posé par
  `finalizeAssistant` et `buildMsg` (chemin reload). Si on retouche l'un ou
  l'autre, s'assurer que `dataset.raw` est bien mis à jour.
- **`.conv-dl-btn` (export de la conversation) est désactivé (`disabled`) pendant
  le streaming** via `setSending` (ui.js). CSS : `.conv-dl-btn:disabled` masque
  le bouton. `downloadConvMd()` (main.js) ne garde que les rôles `user`/`assistant`
  pour le texte, et inclut l'horodatage par message si `ts` est défini.
- **Traces d'appels d'outils dans l'export.** `formatToolAcksMd(acks)` (utils.js,
  pure, testée QuickJS) rend un groupe d'acks **enrichis** (`args` non null —
  mêmes acks que `expandThread` réinjecte cross-turn, cf. `docs/tools.md`)
  en blockquote Markdown juste avant le texte de réponse du tour : nom de l'outil
  + `— intent` (si présent), arguments (JSON), résultat (ou « Résultat (erreur) »
  si `m.error`), et pour `resource_presented` une note `Ressource présentée
  automatiquement : nom (mime) — non incluse dans cet export` (**jamais de
  data-URI/base64 embarqué**, cohérent avec D8/D9 (`docs/mcp.md`) — le binaire
  reste en IDB). Un seul appel → « Outil appelé : » ; plusieurs (même `group`) →
  « Outils appelés (n) : » en liste numérotée. Troncature pour la lisibilité du
  fichier (n'affecte ni le storage ni le payload modèle) : args/résultat à 300
  caractères, nom de ressource à 60, suffixe `...` simple (pas de mention
  « tronqué »). Acks **legacy** (sans `args`) restent **omis** de l'export, comme
  avant cette fonctionnalité — pas de fallback sur le label compact écran.
  `downloadConvMd()` tamponne les acks enrichis qui précèdent un message
  assistant (même motif que `renderThread`) ; `downloadMsgMd()` (ui.js) retrouve
  les acks de son propre tour en remontant `currentThread` depuis `msgIndex(wrap)`.
- **`.msg-ts` user est un sibling de `.bubble`**, pas un enfant — `align-items:
  flex-end` du `.msg.user` gère l'alignement à droite. Ne pas le mettre à
  l'intérieur du bubble (sinon il serait exclu/recréé lors des reconstructions
  de `bubble.innerHTML` comme dans `cancelEdit`).

## Export HTML standalone (lot G, brief `untracked/muscle/G-html-export.md`)

Export d'une conversation en un fichier `.html` autonome, zéro-JS, ouvrable
hors MIAOU (mail, partage). Étape G-1 : socle de fonctions pures (le
générateur de template complet et le bouton topbar sont des étapes
ultérieures du même lot).

- **`formatToolAcksHtml(acks)`** dans `utils.js` (pure, testée QuickJS) :
  sœur HTML de `formatToolAcksMd` — même seuils de troncature
  (`EXPORT_ARGS_MAX`/`EXPORT_RESULT_MAX`/`EXPORT_RESNAME_MAX`), même politique
  `resource_presented` (nom + mime, jamais de binaire/data-URI), mêmes acks
  legacy (sans `args`) omis. Sortie : `<details class="tool-trace">` fermé par
  défaut (cohérent avec le reasoning masqué à l'écran) contenant un
  `<summary>` (« Outil appelé » / « Outils appelés (n) ») et une `<ul>` des
  appels. **`escHtml` systématique** sur `name`, `intent`, les arguments JSON
  et le résultat : ce sont des chaînes d'origine modèle/outil, et c'est
  l'unique chemin de concaténation string→HTML de tout l'export (cf. note de
  piège dans `CLAUDE.md`/`docs/pitfalls-detail.md`) — toute future extension
  qui ajoute un chemin similaire doit `escHtml` de la même façon.
- **`resolveConvRefs(text, opts)`** (ui.js) gagne un paramètre optionnel
  `opts.asPlainText` (défaut `false`, comportement écran **inchangé**). En
  mode `asPlainText`, une référence de conversation vivante est rendue en
  **label nu échappé** (pas de `[label](#miaou-conv:…)`) car le lien
  `#miaou-conv:` ne résout jamais hors MIAOU (D3 du brief G — « no dead
  links »). Le tombstone `~~label (supprimée)~~` reste inchangé dans les deux
  modes (c'est déjà du texte, pas un lien). `renderMd(text, opts)` transmet
  `opts` à `resolveConvRefs` en passe-plat.
- **`buildExportHtml({ title, dateStamp, theme, styleCss, bodyHtml })`** (ui.js,
  pure, testée QuickJS) : assemble le squelette `<!doctype html><html
  data-theme="…"><head>…</head><body>` (topbar titre+date, `bodyHtml`, footer
  « Généré par MIAOU »). **Zéro `<script>`, zéro `<link>`** (invariant D1,
  testé). Le `styleCss` (tokens + `EXPORT_CSS` + `PRISM_THEME_CSS`) est
  composé par l'appelant et passé en argument — `buildExportHtml` reste pur
  en ne faisant qu'insérer une string déjà assemblée.
- **`renderExportBody(thread, convId)`** (ui.js, DOM/marked — pas QuickJS) :
  construit un **fragment détaché** (jamais de lecture/mutation de `#thread`
  live), itère `thread` avec le même buffer d'acks que `downloadConvMd`/
  `renderThread` : les acks enrichis (`args != null`) précédant un message
  `assistant` sont rendus en `formatToolAcksHtml` avant le corps ; ceux
  précédant un `user` sont silencieusement droppés (même choix que
  `downloadConvMd`, pas une régression). Corps assistant via
  `renderMd(content, { asPlainText: true })` (conv_ref délié), reasoning en
  `<details class="reasoning">` **fermé** par défaut. Corps user via
  `renderUserMd`, attachments réutilisant `attChipHtml(att, thumb, false,
  null)` — `removable=false` et `conversationId=null` suppriment
  respectivement `.att-remove` et `.att-promote` (aucune de ces affordances
  n'a de sens dans un fichier zéro-JS). Après peuplement du fragment, si
  `highlightEnabled` et `window.Prism`, `Prism.highlightAllUnder(fragment)`
  pré-tokenise le code (voie B) : les `<span>` de coloration Prism sont
  sérialisés dans le HTML exporté, donc **déjà coloriés à l'ouverture, sans
  JS**. Un langage jamais affiché à l'écran (grammaire non chargée par
  l'autoloader Prism) reste en texte brut — dégradation gracieuse, pas de
  crash (cas limite v1 acceptable).
- **`THEME_TOKENS`** (ui.js, liste de noms `--…`) + **`serializeThemeTokens()`**
  (lit `getComputedStyle(document.documentElement)` pour chaque nom, assemble
  un `:root{…}`) : voie **runtime** tranchée (pas de modif `build.py`, pas de
  placeholder). Comme `data-theme` est déjà résolu `light|dark` au moment de
  l'export, `getComputedStyle` renvoie les valeurs du **thème effectif** — un
  seul jeu de tokens émis, pas les deux. **`THEME_TOKENS` est la seule chose à
  tenir à jour** si un token `--…` est ajouté à `base.css`/`theme-light.css` ;
  `--col`/`--sidebar-w` volontairement exclus (mise en page écran, sans usage
  dans un document statique).
- **`PRISM_THEME_CSS`** (ui.js, constante) : copie **figée** de
  `prism-tomorrow.min.css` (CDN, cf. `index.html`) + les overrides Prism clair
  de `theme-light.css`. Inlinée dans l'export (pas de `<link>` CDN) puisque
  les `<span>` de tokens sont pré-générés par `renderExportBody`. **Dette
  assumée** : à resynchroniser manuellement si le thème Prism CDN change
  (rare).
- **`EXPORT_CSS`** (ui.js, constante, template string) : feuille **dédiée et
  minimale**, écrite à la main — PAS une extraction programmatique de
  `chat.css`/`tools.css` (leur sectionnement mélange règles écran/export,
  dette `next.md`), PAS un miroir vivant de ces fichiers. Couvre uniquement
  ce qui a un sens dans un document statique : bulles, typo markdown, tables,
  blocs de code, `.reasoning`/`.tool-trace` en `<details>`, attachments
  (`.att-chip`/`.att-thumb`/`.att-icon`). **Dette assumée et mémorisée** : si
  `chat.css`/`tools.css`/`composer.css` évoluent (nouvelle classe, structure
  changée), `EXPORT_CSS` ne suit PAS automatiquement — seuls les tokens de
  couleur (voie `getComputedStyle`) restent synchronisés. Revue manuelle à la
  charge de qui retouche ce CSS.
  - **Largeur de lecture : `900px` EN DUR**, pas via `var(--col)` (720px,
    gabarit du composer écran) : `--col` est volontairement absent de
    `THEME_TOKENS` (sans usage dans un document statique), donc y référencer
    `var(--col)` résoudrait à rien. 900px choisi après retour manuel (« 720px
    trop étroit ») pour une lecture plus confortable qu'à l'écran, sans
    devenir disproportionné sur un grand écran (`.export-topbar`/
    `.export-body`/`.export-footer` partagent tous cette valeur en dur — si
    on la change, la changer aux trois endroits).
  - **`zoom: 0.9` sur `<html>`** : dézoom global de l'export (retour manuel —
    la mise en page par défaut était perçue comme trop grande). Choisi plutôt
    que `transform: scale(0.9)` (universellement supporté mais laisse un
    espace vide résiduel puisque la mise en page garde sa taille de layout
    avant réduction visuelle) — `zoom` respecte le flow naturel de la page.
    Support Firefox natif récent (~2024+) ; dégradation gracieuse en cas
    d'absence de support (page affichée à 100%, pas de crash). Toutes les
    tailles d'`EXPORT_CSS` sont en `px` absolus (pas d'`em`/`rem`), donc ce
    zoom global scale fidèlement l'ensemble sans recalcul de chaque valeur.
- **Bouton retitle-btn (fix collatéral, pas lié à G)** : `.topbar-mid:hover
  .conv-retitle-btn` révélait le bouton de retitrage au survol de **tout**
  `.topbar-mid` (titre ET boutons de download, jumeaux), contredisant le
  commentaire du CSS (« retitrage au survol du titre seulement ») — bug
  pré-existant, révélé par l'ajout du second bouton jumeau. Corrigé en
  `:has(#conv-title:hover, .conv-retitle-btn:hover)` (chat.css) : la
  condition inclut le bouton lui-même, sinon il disparaîtrait sous le
  curseur dès qu'on quitte `#conv-title` pour l'atteindre.
- **`exportConvHtml()`** (ui.js, global — futur handler `onclick`) : point
  d'entrée. Résout titre/slug (`slugTitle`)/thème actif/`dateStamp`
  (`exportDateStamp`), assemble `styleCss` et `bodyHtml`, appelle
  `buildExportHtml`, calcule la taille du HTML final (`Blob.size`) et avertit
  via **`confirm()` natif** si elle dépasse `EXPORT_HTML_SIZE_WARN` (8 Mo —
  pas de dialogue dédié en v1, YAGNI), puis télécharge
  `miaou-<slug>-<dateStamp>.html` via `downloadFile`.
- **Étape suivante du lot (non livrée ici)** : bouton topbar jumeau de
  `.conv-dl-btn`, câblage `syncConvDownloadBtn`/`setSending`, entrée palette
  (gatée sur le lot F, absent).

## Horodatages des messages

- `formatMessageTime(ts, now)`, `formatFullDateFr(ts)` et `formatDateRelative(ts, now)`
  dans `utils.js` : fonctions pures, **sans `Intl` ni `toLocaleString`** (déterminisme
  + testabilité QuickJS). Abréviations et noms complets des jours/mois codés en dur
  en français.
- `SHOW_YEAR_AFTER_DAYS = 183` : constante nommée, exprimée en jours (pas en
  mois calendaires), testable par soustraction d'epoch.
- `_startOfDay(d)` : helper interne (minuit local, DST-safe) partagé par
  `formatMessageTime` et `formatDateRelative`. Le delta calendaire se calcule via
  `Math.round((_startOfDay(n) - _startOfDay(d)) / 86400000)` — **`Math.round`, pas
  `Math.floor`** : au passage heure d'été un jour calendaire adjacent dure 23h,
  `floor` le classerait à tort comme « aujourd'hui ».
- `formatMessageTime` distingue le découpage **calendaire** (minuit/minuit) de la
  fenêtre 24h glissante : un message d'hier à 23:50 est « hier » même si < 24h
  se sont écoulées ; un message à 00:10 aujourd'hui est l'heure courte même si
  > 9h se sont écoulées.
- `formatDateRelative` est **date-only** (pas de composante horaire) : tiers
  aujourd'hui / hier / avant-hier / `"3 mars"` / `"12 janvier 2024"`, réutilise
  `SHOW_YEAR_AFTER_DAYS` et `FR_MONTHS_FULL`. Employé par `showSummaryBanner` pour
  les dates des items de la liste.
- `formatFullDateFr` (ex. « jeudi 26 juin 2026 à 14:30 ») est réservé aux
  **tooltips de la sidebar** (`:hover` = contexte de détail, l'année toujours
  présente). Pour les horodatages inline des messages, utiliser `formatMessageTime`.
- Le champ `ts` (epoch ms) est posé par `sendUserText` (user), `onFinal` et
  `onToolTour` (assistant). Absent sur les anciens messages → affichage sans
  horodatage, pas de crash.
