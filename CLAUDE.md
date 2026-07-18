# CLAUDE.md — MIAOU

Instructions pour travailler dans ce dépôt. Ce fichier couvre le noyau consulté
à chaque tâche : ce qu'est le projet, la boucle de travail, le pipeline de
build, les contraintes structurelles dures, et la liste des pièges déjà payés
(résumés — développement complet en lien). Les spécifications détaillées par
domaine (stockage, outils, MCP, skills, tests, export/horodatages) sont dans
`docs/` : les lire **avant** de toucher à la zone concernée, pas par défaut.

## Ce qu'est le projet

Client de chat web pour API OpenAI-compatible, livré comme **un seul fichier
HTML** (`dist/miaou.html`). On édite `src/`, `build.py` assemble. Pas de runtime,
pas de bundler, pas de Node, pas de modules ES.

## Boucle de travail

```bash
python3 build.py                          # src/ → dist/miaou.html
uv run --with quickjs python tests/runner.py   # tests des fonctions pures
```

**Avant chaque commit :** build si du code a changé, puis tests. Ne jamais
commit ni push sans avoir demandé l'accord explicite de l'utilisateur au préalable.

**Nouvelle feature utilisateur → se poser la question « faut-il mettre à jour
`src/help.md` ? »** `src/help.md` est l'aide utilisateur final servie au modèle
par l'outil `miaou__about` (injectée au build, une section par topic). Ce n'est
PAS de la doc dev (`docs/` l'est) : elle décrit ce que l'utilisateur peut faire,
sans internals. Toute capacité visible par l'utilisateur qu'on ajoute, modifie
ou retire doit déclencher cette question — si la réponse est oui, mettre à jour
la section concernée (souvent `interface`, sinon le topic dédié). L'oublier fait
confabuler le modèle sur les fonctionnalités de l'appli. Le contenu est
maintenu à la main, jamais généré depuis `docs/`.

Python via `uv` exclusivement. `config.json` (copié de `config.sample.json`) est
local et non versionné ; `dist/miaou.html` est versionné intentionnellement.

**Messages de commit en anglais** (le reste des échanges reste en français).

## Pipeline de build (ne pas le réécrire — détail : `docs/build.md`)

`build.py` assemble `dist/miaou.html` à partir de `src/html/index.html` par
substitution de placeholders. Ossature à garder en tête ; le **raisonnement fin**
(échappement `</`, `try/catch` vs `typeof`, valeurs dérivées) est dans
`docs/build.md` — le lire avant de toucher au build ou aux points d'injection.

- **`/* __CSS__ */`** ← `src/css/*.css` dans l'ordre `CSS_ORDER`
  (`base, sidebar, chat, composer, drawers, tools, palette, responsive,
  theme-light` — l'ordre EST la cascade ; `base` porte l'@import des fontes,
  `theme-light` reste dernier).
- **`/* __JS__ */`** ← `src/js/*.js` dans l'ordre `JS_ORDER`
  (`utils, sync, storage, resources, skills, tools, api, ui, main`).
- **`__MIAOU_CONFIG__`** ← `config.json` sérialisé (injecté dans `storage.js`,
  d'où dérivent `REQUIRE_API_KEY`, `MAX_SUMMARIES`, `BUILD_API_URL`,
  `BUILD_API_MODEL`).
- **`__MIAOU_HELP__`** ← `src/help.md` parsé en `{slug: markdown}` (injecté
  dans `tools.js`, alimente `miaou__about` et l'enum `topic`).
- **`__MIAOU_SYSTEM_SKILLS__`** ← `src/system-skills/*.md` (un fichier par
  skill, nom de fichier = slug) parsés en `{slug: {name, description,
  content}}` (injecté dans `skills.js`, upserté en IDB à chaque démarrage par
  `ensureSystemSkills()` — skills non éditables par l'utilisateur, `enabled`/
  `autotrigger` figés à `true`, cf. `docs/skills.md`).

Les commentaires sont retirés au passage (`strip_js_comments`/`strip_css_comments`/
`strip_html_comments`, testés dans `run_build_unit_tests`) : `src/` reste la
référence commentée, `dist/` est compact. Les quatre marqueurs sont à **occurrence
unique en position de valeur**, avec une garde `try/catch` côté source pour que
les tests QuickJS (sources non buildées) retombent sur `{}`. **`HELP_CONTENT`
n'entre jamais dans le contexte du modèle** : seul le blurb d'identité et l'enum
de slugs y vont, le contenu des sections arrive en tool result à la demande.

## Contraintes structurelles à respecter

- **Tout est global.** Les fichiers sont collés dans un seul `<script>`. Une
  fonction d'un fichier peut en appeler une d'un autre, mais **uniquement via
  des déclarations `function`** (elles deviennent des globals). Les `const`/`let`
  de portée script ne franchissent **pas** les frontières de fichier dans le
  *test runner* (qui `eval` chaque fichier séparément), même si elles le font
  dans le build concaténé. Conséquence pratique : un `const` partagé entre
  fichiers (ex. `MAX_SUMMARIES`) ne doit être **référencé qu'à l'intérieur de
  corps de fonctions** (exécutés au runtime, après chargement complet), jamais
  au top-level d'un autre fichier.
- **Noms top-level uniques** entre fichiers : le script concaténé est en
  `'use strict'` et une même portée — deux `const`/`let`/`function` homonymes au
  niveau racine cassent le build.
- `'use strict';` est la première instruction de `utils.js` (premier fichier) →
  tout le script est strict. Déclarer chaque variable, pas de global implicite.
- Garde de test obligatoire en fin de `main.js` :
  `if (typeof __TEST_ENV__ === 'undefined') { document.addEventListener('DOMContentLoaded', init); }`
- Les handlers câblés depuis l'UI doivent rester des fonctions globales portant
  **exactement** le nom attendu au point de câblage — que ce soit un attribut
  `onclick=`/`oninput=` **statique** dans `index.html`, un attribut **généré**
  en template string dans `ui.js` (ex. `onRegenerateFileDescription`), ou un
  `addEventListener`/callback (ainsi `sendMessage`, `undoToolAck`, `deleteConv`
  ne sont jamais en attribut inline littéral mais restent des globals appelés
  par listener/closure). Renommer/déplacer un tel handler sans mettre à jour son
  câblage casse silencieusement. Deux pièges de nommage à connaître :
  - Le bouton « Enregistrer » appelle `onSaveSettings()` — **pas** `saveSettings(obj)`
    de `storage.js` (persistance localStorage). Il est désactivé tant que le
    formulaire ne diverge pas des réglages persistés (`settingsFormDirty`, ui.js
    — le thème est exclu : auto-persisté par `selectTheme`).
  - Le bouton du composer appelle `onSendBtn()` (envoi **ou** stop selon
    `sending`), jamais `sendMessage()` directement.

## Pièges déjà payés (ne pas les ré-introduire)

Une ligne par piège ci-dessous — **développement complet, exemples et noms de
fonctions dans `docs/pitfalls-detail.md`** (le lire avant de toucher au flux de
conversation, au streaming, aux résumés/titrage, à l'édition de message, au
patienteur, au raisonnement, au sélecteur de modèle, ou au KV cache). Les pièges
16, 18, 21 et 24 — invariants transverses les plus coûteux — restent développés
inline sous la liste.

1. **Un seul message `role: 'system'`.** `buildSystemMessage()` concatène tout
   dans l'ordre (`IDENTITY_BLURB` en tête, … `CODEBLOCK_DOCTRINE`, prompt
   utilisateur, description du Space) ; jamais empiler plusieurs `system`.
2. **Injection ≠ appel d'outil.** L'injection de résumés est du texte ajouté par
   MIAOU ; les `tool_calls` viennent du **modèle** uniquement.
3. **Résultat d'outil jamais affiché avant `finish_reason: 'stop'`.** Borne
   `MAX_TOURS` sur les tours ; anti-redemande via `servedKeys`.
4. **Agrégation SSE par `index`.** Agréger `tool_calls` fragmentés par
   `tcDelta.index` ; ne pas parser `function.arguments` avant fin de stream.
5. **Pas de résumé sur conversation fraîche/avortée.** Seuil `hasSubstance()`
   (≥1 user ET ≥1 assistant ≥8 car.). Backfill gardé sur URL seule.
6. **Tombstones.** Suppression d'un souvenir = `suppressed: true`, données
   conservées ; compte comme entrée présente (empêche re-résumé).
7. **Parsing défensif des résumés.** Nettoyer les fences ` ```json ` avant
   `JSON.parse` ; échec → `null` silencieux.
8. **Indicateur d'activité** via `runBackgroundTask(label, fn)`, toujours
   `try/finally`.
9. **Titrage robuste à la navigation.** `maybeTitle` fige `convId`/`thread` avant
   l'async ; gouverné par `needTitle` (réarmé par `openConversation` si
   `!conv.title`) ; `regenerateTitle` l'ignore et retitre à la demande.
10. **Arrêt du streaming** via `AbortController` unique ; `aborted: true` sans
    rollback, court-circuite le tour suivant.
11. **Recherche historique.** Filtre persistant `convSearchFilter` ;
    `renderConvList()` reste sans argument exprès.
12. **Édition d'un message utilisateur.** `sendMessage`/`editUserMessage`
    partagent `runGenerationFromCurrentThread()` et `resolveSend(literal)`.
13. **Patienteur animé.** `startWaiter`/`stopWaiter` nettoient deux timers ;
    jamais patienteur + streaming simultanés.
14. **Affichage du raisonnement.** Détection par observation directe du delta
    (`reasoningDelta`), jamais via `reasoning_effort` ; champ séparé `reasoning`.
15. **Sélecteur de modèle (composer).** `settings.model` (défaut global) vs
    `conv.model`/`currentConvModel` (override) séparés ; résolus par
    `activeModel()`.
16. **Préservation du KV cache (Ollama).** → invariant transverse, développé
    sous la liste.
17. **Persistance des images jointes (content parts → descripteur).** Image en
    content parts OpenAI (`image_url` base64) **seulement au tour d'attache** ;
    ensuite le message user est réécrit **une fois** en string = texte + ligne(s)
    de descripteur byte-stable (`collapseAttachedMessageContent`, idempotente,
    calculée depuis les champs FIGÉS `name`/`w`/`h`/`size`, jamais recalculée
    depuis les octets).
18. **Herméticité des Spaces : un seul prédicat, partout.** → invariant
    transverse, développé sous la liste.
19. **Recall d'image : ré-injection via message user synthétique, jamais dans
    `role:'tool'`.** Le handler renvoie un tool result annonciateur ; l'image
    revient via un message user synthétique émis par `expandThread`, sa dataUrl
    reconstruite à chaque envoi par `resolveRecallImages` (champ `recallImage`,
    **jamais persisté**) → byte-stable, KV-safe (brief A2/D3).
20. **Résumé orphelin après suppression concurrente.** `summarizeIfNeeded`/
    `restoreSummaryItem`/`runBackfill` re-vérifient `loadConversation(id)` juste
    avant `saveSummary` ; `pruneOrphanSummariesOnInit()` nettoie au démarrage.
21. **Export HTML standalone : un seul chemin string→HTML à risque.** →
    invariant transverse, développé sous la liste.
22. **`EXPORT_CSS` ne suit PAS `chat.css`/`tools.css`/`composer.css`.** Feuille
    dédiée figée (lot G) : retoucher une classe réutilisée par l'export ne
    propage rien (sauf tokens de couleur via `getComputedStyle`). Revue manuelle
    à la charge de qui touche ce CSS (cf. `docs/exports.md`). **`EXPORT_CSS` et
    `EXPORT_SCRIPT` sont des template literals** : jamais de backtick dans leur
    contenu, commentaires compris (un `` `.body` `` dans un commentaire CSS clôt
    la chaîne — le build passe, mais le chargement du fichier casse en
    `TypeError: not a function`, erreur payée au lot R).
23. **Préviz HTML/SVG : la frontière est l'iframe sandbox, aucune autre voie.**
    Markup modèle rendu **uniquement** dans un `<iframe sandbox="allow-scripts">`
    **sans `allow-same-origin`** (`decoratePre`) ; `srcdoc` posé par propriété
    JS, jamais interpolé en template string. Ne jamais ajouter `allow-same-origin`
    ni une autre voie d'injection (cf. `docs/rendering.md`).
24. **Synchro multi-onglets : broadcast POST-commit, relecture APRÈS l'await.**
    → invariant transverse, développé sous la liste.
25. **Monde guest `js__eval` clos : une seule host function, jamais plus.**
    L'outil natif `js__eval` (lot L) exécute du JS modèle dans un bac à sable
    QuickJS-WASM (`runInQuickJs`, tools.js) sur le contenu textuel d'UN blob
    client. Surface guest FERMÉE : on n'injecte QUE `__miaou_text()` (unique pont
    host→guest) + un prélude JS pur (`text`/`lines`/`jsonLines`/`parse`) ; **jamais
    `fetch`, DOM, `globalThis` hôte, ni aucun autre pont** — symétrique du « jamais
    `allow-same-origin` » de l'iframe (piège 23). Trois guards obligatoires
    (`setInterruptHandler` timeout, `setMemoryLimit`, cap de sortie via
    `checkOutputCap`), tous les handles VM disposés en `try/finally`. Overflow de
    sortie = **REFUS explicite, pas troncature** (result texte non-`isError`, pour
    re-cibler dans le tour). Le `code` est d'origine **modèle** : `escHtml`
    impératif à l'export (exception piège 21). Doctrine `JS_EVAL_DOCTRINE`
    statique, inconditionnelle dans `ROOT_SYSTEM_PROMPT` (KV-safe, piège 16). Cf.
    `docs/tools.md` (section `js__eval`).
26. **Réécriture d'historique model-triggered : matérialisation d'un tool result
    passé (lot O-2).** `resource__from_result` (tools.js) mute **en place** le
    `entry.result` d'un ack passé (gros contenu → handle compact + résumé modèle)
    sur décision du modèle — première réécriture d'historique DÉCLENCHÉE par le
    modèle (l'image→descripteur du piège 17 est automatique, pas model-triggered).
    Trois gardes obligatoires : (a) **source unique de dérivation d'id**
    `enrichedAckGroups` (utils.js, pure), partagée par `expandThread` (émission du
    marqueur `[call:<id>]`) ET `findAckByCallId` (résolution) — jamais deux
    formules, sinon ciblage muet. (b) **réentrance** (mémoire
    `await_reentrancy_guard`) : cible gelée avant l'`await _storeBlock`,
    **re-résolue après** ; disparue ou déjà convertie → pas de réécriture, on
    renvoie quand même le handle valide. (c) **jamais `_makeResourceRef`**
    (record `'inline'` → ré-inline tout, piège du lot M) : toujours
    `formatInlineHandleForModel`, idempotence via `isInlineHandleResult`. Le
    **rendu UI** de l'ack ne lit pas `result` → inchangé. Double coût KV assumé :
    marqueur `[call:…]` **permanent et constant** (tous les tool results), et
    invalidation **ponctuelle** à chaque conversion (réécriture d'un ack passé).
    Cf. `docs/tools.md` (section « Matérialisation de ressource model-side »).
27. **Interjection mid-génération : bulle assistant `_acksOnly` matérialisée,
    élaguée à l'émission (lot Q).** Un message user tapé pendant la génération
    (`onInterjections`, dispatchSend) est drainé à la frontière de tour, APRÈS
    les acks du tour. Ces acks (entrées `tool-ack` autonomes dans `currentThread`,
    pas de paire assistant+tool avant `onFinal`) n'ont **pas d'assistant hôte** :
    sans lui, `renderThread` les rendrait **nus** au reload (branche orpheline,
    sans en-tête ni horodatage). On matérialise donc un `assistant`
    `{ content:'', _acksOnly:true }` — même geste que `onToolTour` — pour héberger
    les acks : live ET reload passent par le MÊME chemin (`placeToolAck` dans la
    bulle), **jamais** une classe DOM `.ack-shell` hors-thread (piste abandonnée :
    artefact DOM sans contrepartie données → divergence live/reload + mappings à
    rustiner). `content` toujours vide (le texte du tour est déjà consommé par
    `onToolTour`, appelé AVANT les acks). `expandThread` **élague à l'émission
    tout assistant à content blanc** (null/vide/blancs purs) : bruit KV, et 400
    sur les backends stricts (« must have either content or tool_calls ») —
    couvre cette bulle `_acksOnly` ET la bulle vide d'un stop sans contenu reçu
    (`onFinal 'aborted'`) ; le flag reste comme documentation d'origine,
    l'élagage n'en dépend plus. L'entrée reste dans le thread (rendu,
    « Régénérer », fidélité live/reload), elle ne part juste jamais sur le fil.
    La bulle user de
    l'interjection est **authentique** (`buildInterjectionEntry`, jamais
    `_synthetic` — l'injection `<miaou_context>` doit pouvoir la viser). Coût KV
    assumé : insertion mid-séquence, **volontaire et ponctuelle** (corollaire
    piège 16, comme la ré-injection image). Cf. `docs/interjections.md`.

### Invariants transverses (développés)

Les quatre pièges les plus coûteux, gardés inline parce qu'ils gouvernent des
frontières traversées par beaucoup de code.

**#16 — Préservation du KV cache (Ollama).** `buildSystemMessage()` reste
**statique** ; tout contenu dynamique (date, mémoire) est injecté en préfixe
éphémère du dernier message user via `buildContextBlock()`, jamais dans le
system message. Corollaire du piège 18 : changer de Space ou modifier la
bibliothèque de fichiers casse ce préfixe — assumé, mais reste statique tant
que ces états ne bougent pas.

**#18 — Herméticité des Spaces : un seul prédicat, partout.** `spaceConvIds(spaceId,
convs)` (storage.js, pure) est LA source de vérité pour « cette conversation
appartient-elle au Space actif ? » — sidebar, recherche, `conv__list`/
`conv__get`, sélection d'injection de résumés, `buildMemoryEntriesBlock`
(via `scope`), **fichiers de bibliothèque d'espace** (`getResourcesBySpace`/
`getCachedLibraryEntriesBySpace`, filtre `spaceId === activeSpaceId`, lot Cbis).
Jamais un filtre `c.spaceId === x` réécrit localement.
`conv__get`/`memory__update`/`memory__delete` sur un id hors-Space
répondent comme **inexistant** (pas d'oracle) ; même posture pour
`files__list`/`files__read` sur un `file-<id>` étranger ou inconnu (lot Cbis).
Changer de Space actif change le prompt système effectif : `description` du
Space (pas un system prompt) est **ajoutée après** le prompt système
utilisateur global (`resolveUserSystemPrompt`, brief D4 — concaténation,
jamais substitution) — **assumé** : ça casse le préfixe KV cache (piège 16),
mais reste statique tant qu'on ne change pas de Space. Le **manifeste de
bibliothèque de fichiers** (`buildLibraryManifestBlock`, injecté dans
`<miaou_context>` via `contextBlockParts().library`, lot Cbis) est de même
nature : byte-stable tant que la bibliothèque du Space actif ne change pas
(tri `createdAt`→`id` déterministe), casse le prefix KV cache à chaque
ajout/suppression/atterrissage de description de fichier (PAS un résumé
du contenu — cf. `docs/spaces.md`) — assumé, comme un changement de Space.
**Exception sanctionnée (lot F, palette de commandes)** : le submode
« recherche de conversation » de la palette (`cmdkConvItems`, ui.js) est
**volontairement cross-Space** — il itère `listAllConversations()` (TOUS les
Spaces), pas `spaceConvIds`, et annote chaque résultat de son Space. Les
conversations du Space actif restent priorisées en tête (`rankConvResults`,
utils.js, pure). Ouvrir un résultat d'un autre Space **suit** ce Space
(`followSpace` avant `selectConv`) pour ne jamais afficher un fil hors du
Space actif. C'est la SEULE voie cross-Space assumée ; la recherche sidebar
(`renderConvList`) reste, elle, scopée au Space actif. Décision Julien
2026-07-11, cf. `docs/command-palette.md`.

**#21 — Export HTML standalone : un seul chemin string→HTML à risque.**
L'export (`renderExportBody`, ui.js) hérite de la sûreté de l'écran
UNIQUEMENT parce qu'il re-rend via `renderMd`/`renderUserMd` (marked, sortie
passée à `sanitizeHtml`/DOMPurify) — les mêmes renderers que le DOM live, jamais
un clone/strip du `#thread` live. `formatToolAcksHtml` (utils.js) est
l'EXCEPTION : seule fonction qui concatène directement des chaînes d'origine
modèle/outil (`name`, `intent`, args JSON, result) en HTML — `escHtml` y est
systématique, et toute future extension similaire doit faire de même (cf.
`docs/exports.md`). **Depuis D1 révisé** (export interactif optionnel, réglage
`exportInteractive`), l'export peut porter un `<script>` inline (`EXPORT_SCRIPT`) :
JS statique **build-time** (aucune donnée modèle/outil dedans), mais
`exportConvHtml` échappe quand même `</` avant insertion — ne jamais y interpoler
de contenu modèle sans repenser cette sûreté. **Depuis E4**, deuxième exception :
`embedExportMermaid` injecte `out.svg` (Mermaid `strict`, piège 23) via
`innerHTML`, couverte par la sanitisation interne de Mermaid. **Depuis le lot R**,
troisième chemin : `renderMarkdownDocBody` (conversion d'un `.md` **utilisateur**,
pas du contenu modèle) appelle `marked` directement — ni `renderMd`
(`resolveConvRefs` n'a pas de sens sur un fichier externe) ni `renderUserMd`
(qui échapperait le HTML inline légitime d'un `.md`) — **mais passe sa sortie
dans `sanitizeHtml`/DOMPurify** comme les deux autres : c'est cette passe qui
rend le chemin sûr, ne jamais la retirer (cf. `docs/exports.md`).

**#24 — Synchro multi-onglets : broadcast POST-commit, relecture APRÈS l'await.**
Deux invariants jumeaux (lot J). **(a) Émettre après la persistance durable,
jamais avant** : tout `syncPost` de mutation (`conv-updated`, `settings-updated`,
`resources-updated`…) suit le `setItem`/`tx.oncomplete` correspondant — un pair
qui rehydrate lit le store (IDB : sur `tx.oncomplete`, **jamais** `req.onsuccess`).
**(b) Un récepteur qui rehydrate relit l'état APRÈS son `await`, jamais un
instantané figé avant.** `openConversation` contient un `await`
(`loadConversationResources`) : figer `currentThread` **avant** cet await perd un
`saveConversation` d'un pair survenu pendant (bug « toujours en retard d'un
tour »). La lecture de `conv.messages` (`projectConvMessages`, pur, testé) se fait
**après** l'await ; un **jeton de séquence** (`_openConvSeq`) fait abandonner tout
appel devenu obsolète. Filet : `readonly-off` relance une rehydratation. Cf.
`docs/multitab-sync.md`.

## Domaines détaillés (`docs/`)

À lire à la demande, selon la zone touchée — pas systématiquement :

- **`docs/code-map.md`** — index « où se trouve quoi » (fonctions/const JS,
  sections JS/CSS, avec lignes). **Généré par `build.py` à chaque build, ne
  jamais l'éditer** — s'en servir pour cibler les lectures dans les gros
  fichiers (`ui.js`, `chat.css`).
- **`docs/build.md`** — pipeline de build en détail : concaténation/strip,
  marqueurs `__MIAOU_CONFIG__`/`__MIAOU_HELP__`/`__MIAOU_SYSTEM_SKILLS__`,
  points d'injection et gardes `try/catch`.
- **`docs/pitfalls-detail.md`** — développement complet des pièges 1-24
  ci-dessus (25 et 26 sont développés inline ici même, comme 16/18/21/24).
- **`docs/storage.md`** — schéma `localStorage` (`miaou-settings`,
  `miaou-conversations`, `miaou-summaries`, `miaou-memories`,
  `miaou-mcp-servers`, `miaou-api-servers`, `miaou-active-api-server`,
  `miaou-spaces`, `miaou-active-space`) et IndexedDB (`skills`, `resources`).
- **`docs/tools.md`** — registre d'outils (`tools.js`), mécanisme d'acks
  (`tool-ack`), et références de conversation dans le texte du modèle
  (`conv_ref`).
- **`docs/context-inspector.md`** — inspecteur de contexte (brief B) : manifeste
  par bloc logique du contexte envoyé au modèle (`buildContextManifest`, pur) et
  totaux chars/tokens, rendu dans le drawer (`renderContextInspector`).
- **`docs/spaces.md`** — Spaces / « Espaces » (lot C) : herméticité (piège 18,
  `spaceConvIds`), default Space, scope `profile` des souvenirs, description de
  Space concaténée au prompt système, bibliothèque de fichiers par Space.
- **`docs/mcp.md`** — agrégation MCP distante (V2) : préfixage, routage,
  transport, timeout, dégradation gracieuse, D5–D10.
- **`docs/skills.md`** — skills stage 1 (CRUD, invocation slash, drawer) et
  stage 2 (autotrigger, doctrine de déclenchement, confirmation).
- **`docs/tests.md`** — ce qui est couvert par `tests/runner.py` (QuickJS) et
  ce qui doit être vérifié à la main (`docs/manual-tests.md`).
- **`docs/exports.md`** — export Markdown et export HTML standalone des
  conversations/messages (incluant traces d'outils) et fonctions d'horodatage.
- **`docs/rendering.md`** — rendu enrichi des blocs de code : diagrammes
  Mermaid (lazy-load, cycle de rendu, toggle, thème, posture de sécurité).
- **`docs/command-palette.md`** — palette Ctrl/Cmd+K (lot F) : registre
  déclaratif, sous-modes, intégration clavier, recherche cross-Space assumée.
- **`docs/multitab-sync.md`** — synchro multi-onglets (lot J, BroadcastChannel) :
  protocole d'enveloppe, liste fermée de types, émetteurs/récepteurs, file
  d'attente pendant génération, soft-lock, readonly/heartbeat/TTL, doctrine
  broadcast post-commit + relecture post-await (piège 24).
- **`docs/interjections.md`** — interjections mid-génération (lot Q) : file
  locale de messages tapés pendant une génération, drainée à la frontière de
  tour (réaiguillage mid-boucle) ou en fin d'échange nominale ; composer en
  mode file, puces annulables/éditables, bulle assistant matérialisée
  (`_acksOnly`, piège 27), reflux sur fin non-nominale.

## Composants UI provisoires (ne pas redessiner sans spec)

Un composant visuel implémenté en intérimaire ne se retravaille pas à l'aveugle :
demander les spécifications HTML/CSS avant de le redessiner. Seul cas restant :
**`.bg-activity`** (indicateur d'activité de fond, `chat.css`, `index.html`,
piloté par `runBackgroundTask`), hors maquette d'origine. (`.summary-banner`
relevait de la même réserve mais a depuis reçu une spec définitive — plus
concerné.)

## Règle d'or

En cas d'ambiguïté sur un point non couvert ici : **signaler plutôt que deviner**.
Le projet a déjà payé le prix de suppositions hâtives.
