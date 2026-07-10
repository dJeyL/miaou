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

Python via `uv` exclusivement. `config.json` (copié de `config.sample.json`) est
local et non versionné ; `dist/miaou.html` est versionné intentionnellement.

**Messages de commit en anglais** (le reste des échanges reste en français).

## Pipeline de build (ne pas le réécrire)

`build.py` lit `src/html/index.html` et remplace deux placeholders :
`/* __CSS__ */` (← les `src/css/*.css` concaténés dans l'ordre `CSS_ORDER` :
`base, sidebar, chat, composer, drawers, tools, responsive, theme-light` —
l'ordre EST la cascade, `base` porte l'@import des fontes, `theme-light` doit
rester dernier) et `/* __JS__ */` (← les `src/js/*.js` concaténés dans l'ordre
`JS_ORDER` : `utils, storage, resources, skills, tools, api, ui, main`).
Les commentaires sont retirés au passage — JS (`strip_js_comments`, respecte
strings/templates/regex), CSS (`strip_css_comments`, respecte les strings) et
HTML (`strip_html_comments`, sur le template avant substitution des
placeholders) : `src/` reste la référence commentée, `dist/` est compact.
Tests unitaires de ces transformations dans `tests/runner.py`
(`run_build_unit_tests`).
Il substitue aussi **un seul marqueur de config**, `__MIAOU_CONFIG__`, par
l'objet `config.json` entier sérialisé en JSON (JSON ⊂ littéral objet JS, donc
`json.dumps` gère seul quoting/nombres/booléens — pas de marqueur par clef, pas
de distinction guillemets/sans-guillemets). `build.py` échappe `</` dans le
littéral pour ne pas casser le `</script>` porteur. Côté source (`storage.js`),
un **unique point d'injection** :

```js
const BUILD_CONFIG = (function () { try { return __MIAOU_CONFIG__; } catch (e) { return {}; } })();
```

- **Marqueur à occurrence unique, en position de valeur** : `.replace` global,
  donc toute autre occurrence serait substituée aussi.
- **Forme tolérante via `try`** : sources non buildées (tests QuickJS),
  `__MIAOU_CONFIG__` est un identifiant nu → `ReferenceError` attrapée → `{}`.
  (Un `typeof … !== 'undefined'` ne convient pas : la garde elle-même contient
  le marqueur, qui serait substitué → objet dupliqué.)
- Les quatre valeurs dérivées (`REQUIRE_API_KEY`, `MAX_SUMMARIES`,
  `BUILD_API_URL`, `BUILD_API_MODEL`) sont **toutes déclarées dans `storage.js`**,
  juste sous `BUILD_CONFIG`, avec leurs défauts. Elles ne sont **référencées
  ailleurs qu'en corps de fonction** (cf. contrainte `const`/test runner
  ci-dessous) : ne pas les redéclarer dans un autre fichier au top-level.
- `REQUIRE_API_KEY` (défaut `true`) gouverne l'état « configuré » : si `false`,
  le composer se déverrouille avec l'URL seule (clef optionnelle), cf.
  `syncConfigured` (ui.js).

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
  exactement ces noms — que le câblage soit un attribut `onclick=`/`oninput=`
  **statique** dans `index.html`, un attribut **généré dynamiquement** en
  template string dans `ui.js` (ex. `onRegenerateFileDescription`), ou un
  `addEventListener`/callback (ainsi `sendMessage`, `undoToolAck`, `deleteConv`
  ne sont **jamais** en attribut inline littéral, mais restent des globals
  appelés par listener/closure). La liste ci-dessous est **non exhaustive**
  (terminée par « … ») et mélange ces trois modes de câblage :
  (`sendMessage`, `onSendBtn`, `newConversation`, `openSettings`,
  `onSaveSettings`, `selectSummaryInjectionMode`, `summaryBanner`, `deleteConv`,
  `onConvSearch`, `clearConvSearch`, `onEditMsg`, `switchMemoryTab`,
  `addMemoryEntry`, `deleteMemoryEntry`, `restoreMemoryEntry`,
  `startEditMemoryEntry`, `cancelMemoryEntryEdit`, `saveMemoryEntryEdit`,
  `forgetMemoryEntry`, `undoToolAck`, `downloadConvMd`, `downloadMsgMd`, `copyMsg`,
  `regenerateTitle`, `regenerateResponse`, `continueTruncated`, `exportConvHtml`,
  `openApiServers`, `closeApiServers`, `addApiServerCard`,
  `toggleReasoning`, `toggleSettingsCat`, `exportAllData`, `onImportDataClick`,
  `onImportFileSelected`, `onAttachClick`, `onAttachFilesSelected`,
  `onComposerDragOver`, `onComposerDragLeave`, `onComposerDrop`, `onComposerPaste`,
  `removeComposerAttachment`, `toggleSpaceMenu`, `closeSpaceScreen`,
  `onSpaceFormInput`, `onSaveSpaceScreen`, `onDeleteSpaceScreen`,
  `promoteAttachmentToLibrary`, `onSpaceFilesUploadClick`, `onSpaceFilesSelected`,
  `onDeleteSpaceFile`, `onRegenerateFileDescription`, `toggleConvSelection`,
  `selectSpaceTab`, …).
  Le bouton « Enregistrer »
  appelle `onSaveSettings()` — à ne pas confondre avec `saveSettings(obj)` de
  `storage.js` (persistance localStorage). Il est désactivé tant que le
  formulaire ne diverge pas des réglages persistés (`settingsFormDirty`,
  ui.js — le thème est exclu : auto-persisté par `selectTheme`). Le bouton du composer appelle
  `onSendBtn()` (envoi **ou** stop selon `sending`), jamais `sendMessage()`
  directement.

## Pièges déjà payés (ne pas les ré-introduire)

Résumés ci-dessous ; développement complet, exemples et noms de fonctions
précis dans **`docs/pitfalls-detail.md`** — le lire avant de toucher au flux
de conversation, au streaming, aux résumés/titrage, à l'édition de message,
au patienteur, au raisonnement, au sélecteur de modèle, ou au KV cache.

1. **Un seul message `role: 'system'`.** Jamais en empiler plusieurs.
   `buildSystemMessage()` concatène `ROOT_SYSTEM_PROMPT` (doctrines build-time,
   toujours injectées si outils présents) + éventuellement `toolsSystemPrompt()`
   + `CODEBLOCK_DOCTRINE` (nommage des blocs de code, **toujours** injectée,
   indépendamment de la présence d'outils — cf. `docs/tools.md`) + le prompt
   système utilisateur.
2. **Injection ≠ appel d'outil.** L'injection de résumés est du texte ajouté
   par MIAOU ; les `tool_calls` sont déclenchés par le **modèle** uniquement.
3. **Le résultat d'un outil n'est jamais affiché** avant `finish_reason:
   'stop'`. Borne `MAX_TOURS` sur le nombre de tours, pas d'outils. Anti-
   redemande via `servedKeys` dans le même échange.
4. **Agrégation SSE par `index`.** `tool_calls` fragmentés : agréger par
   `tcDelta.index`, jamais parser `function.arguments` avant fin de stream.
5. **Pas de résumé sur conversation fraîche/avortée.** Seuil `hasSubstance()` :
   ≥1 user ET ≥1 assistant non trivial (≥8 car.). Backfill gardé sur présence
   d'URL seule (pas `configured`).
6. **Tombstones.** Suppression d'un souvenir = `suppressed: true` en conservant
   les données ; compte comme entrée présente (empêche re-résumé).
7. **Parsing défensif des résumés.** Nettoyage des fences ```` ```json ````
   avant `JSON.parse` ; échec → `null`, silencieux.
8. **Indicateur d'activité** via `runBackgroundTask(label, fn)`, toujours
   `try/finally`.
9. **Titrage robuste à la navigation.** `maybeTitle` fige `convId`/`thread`
   avant l'appel async ; pas de titre provisoire (« Nouvelle conversation »
   partout tant que non résolu). Gouverné par `needTitle` (un seul essai par
   conversation) : `openConversation` doit le réarmer (`!conv.title`) sur une
   conversation rouverte sans titre, sinon le titrage reste bloqué à vie.
   Bouton de régénération manuelle (`regenerateTitle`) : ignore `needTitle`,
   retitre à la demande même après un titre déjà posé (manuel ou auto).
10. **Arrêt du streaming** via `AbortController` unique ; `aborted: true`
    sans rollback, court-circuite avant tout traitement de tour suivant.
11. **Recherche historique.** Filtre persistant `convSearchFilter` ;
    `renderConvList()` reste sans argument exprès.
12. **Édition d'un message utilisateur.** `sendMessage`/`editUserMessage`
    partagent `runGenerationFromCurrentThread()` et `resolveSend(literal)`
    (chemin unique slash-skill, cf. `docs/skills.md`).
13. **Patienteur animé.** `startWaiter`/`stopWaiter` nettoient deux timers ;
    jamais patienteur + streaming simultanés.
14. **Affichage du raisonnement.** Détection par observation directe du delta
    (`reasoningDelta`), jamais via `reasoning_effort`. Champ séparé `reasoning`.
15. **Sélecteur de modèle (composer).** `settings.model` (défaut global) vs
    `conv.model`/`currentConvModel` (override par conversation) strictement
    séparés ; résolus par `activeModel()`.
16. **Préservation du KV cache (Ollama).** `buildSystemMessage()` reste
    statique ; contenu dynamique (date, mémoire) injecté en préfixe éphémère
    du dernier message user via `buildContextBlock()`, jamais dans le system
    message.
17. **Persistance des images jointes (content parts → descripteur).** Une image
    jointe part en content parts OpenAI (`image_url` base64) **seulement au
    tour où elle est attachée** ; une fois ce tour terminé (normal, avorté ou
    halte), le message user est réécrit **une fois** en une string = texte +
    une ligne de descripteur byte-stable par image (`collapseAttachedMessageContent`,
    idempotente). Le descripteur est calculé depuis les champs FIGÉS du schéma
    (`name`, `w`, `h`, `size`) — **jamais recalculé** depuis les octets à un
    tour ultérieur.
18. **Herméticité des Spaces : un seul prédicat, partout.** `spaceConvIds(spaceId,
    convs)` (storage.js, pure) est LA source de vérité pour « cette conversation
    appartient-elle au Space actif ? » — sidebar, recherche, `list_conversations`/
    `get_conversation`, sélection d'injection de résumés, `buildMemoryEntriesBlock`
    (via `scope`), **fichiers de bibliothèque d'espace** (`getResourcesBySpace`/
    `getCachedLibraryEntriesBySpace`, filtre `spaceId === activeSpaceId`, lot Cbis).
    Jamais un filtre `c.spaceId === x` réécrit localement.
    `get_conversation`/`update_memory`/`delete_memory` sur un id hors-Space
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
19. **Recall d'image : ré-injection via message user synthétique, jamais dans
    `role:'tool'` (brief A2, D3).** Un `recall_attachment` sur une image ne
    remet PAS les pixels dans le résultat de l'outil (`role:'tool'` textuel) :
    le handler renvoie un tool result annonciateur, et l'image revient au modèle
    via un **message user synthétique** porteur de la content part image, émis
    par `expandThread` **après** les tool results du groupe. Ce message n'existe
    pas dans `currentThread` : la dataUrl est reconstruite depuis le record en
    cache par le pré-pass `resolveRecallImages` (resources.js) à **chaque** envoi
    (champ `recallImage` sur une copie de l'ack), **jamais persistée** (absente
    d'`ACK_COPY_FIELDS` — seul `attId` l'est) → byte-stable, KV-safe. Raison du
    choix (probe 2026-07-05, `mistral-small3.2`) : une part image dans un message
    `role:'tool'` transmet bien les pixels sur Ollama MAIS **confabule
    silencieusement** quand elle est strippée ; le message user échoue honnêtement
    (« AUCUNE IMAGE »). Corollaire du collapse-timing (D2) : l'image→descripteur
    ne se fait **jamais entre deux appels d'une même boucle d'outils** — le
    payload `apiMessages` est construit UNE fois avant la boucle `runConversation`
    et seulement complété par push ; le collapse (`rewriteAttachedUserMessage`)
    n'a lieu qu'en `onFinal`/`onHalt`, donc après la fin de l'échange.
20. **Résumé orphelin après suppression concurrente.** `summarizeIfNeeded`,
    `restoreSummaryItem` et `runBackfill` re-vérifient `loadConversation(id)`
    juste avant `saveSummary`, pour ne pas ressusciter une entrée
    `miaou-summaries` si la conversation a été supprimée pendant l'`await`
    LLM (`deleteSummaryEntry` dans `deleteConv` a déjà tourné avant, en pure
    perte). `pruneOrphanSummariesOnInit()` nettoie en complément les résidus
    au démarrage, avant `runBackfill()`.
21. **Export HTML standalone : un seul chemin string→HTML à risque.**
    L'export (`renderExportBody`, ui.js) hérite de la sûreté de l'écran
    UNIQUEMENT parce qu'il re-rend via `renderMd`/`renderUserMd` (marked,
    sortie passée à `sanitizeHtml`/DOMPurify — marked laisse passer le HTML
    inline du modèle, la sanitisation est ce qui empêche un payload reproduit
    depuis une source hostile de s'exécuter) — les mêmes renderers que le DOM
    live, jamais un clone/strip du `#thread` live. `formatToolAcksHtml` (utils.js) est l'EXCEPTION : seule
    fonction qui concatène directement des chaînes d'origine modèle/outil
    (`name`, `intent`, args JSON, result) en HTML — `escHtml` y est
    systématique. Toute future extension de l'export qui ajoute un chemin de
    concaténation similaire doit `escHtml` de la même façon (cf.
    `docs/exports.md`). **Depuis D1 révisé** (export interactif optionnel,
    réglage `exportInteractive`), l'export peut porter un `<script>` inline
    (`EXPORT_SCRIPT`) : c'est du JS statique **build-time** (aucune donnée
    modèle/outil concaténée dedans), mais `exportConvHtml` échappe quand même
    `</` (`.replace(/<\//g, '<\\/')`) avant l'insertion dans le `<script>`
    porteur — ne jamais y interpoler de contenu d'origine modèle sans repenser
    cette sûreté. **Depuis E4**, deuxième exception sanctionnée :
    `embedExportMermaid` injecte `out.svg` (sortie de Mermaid `strict`, même
    posture que `renderMermaidUnder`, piège 23) via `innerHTML` — pas de
    re-sanitisation, couverte par la sanitisation interne de Mermaid.
22. **`EXPORT_CSS` (export HTML) ne suit PAS les évolutions de
    `chat.css`/`tools.css`/`composer.css`.** C'est une feuille dédiée écrite
    à la main (audit lot G, `docs/exports.md`), pas un miroir vivant de
    l'écran — assumé, un export est un instantané figé. **Conséquence** : si
    on retouche une classe réutilisée par l'export (`.msg`/`.bubble`/
    `.reasoning`/`.tool-ack`/`.att-*`/`.code-head`/`.code-lang`/`.code-copy`/
    `.code-dl`/`.mermaid-view`/`.mermaid-src`/tables/blocs de code), rien ne casse
    silencieusement, mais l'export continue de produire l'**ancien** style —
    aucun test ne détecte cette dérive. Seuls les tokens de couleur
    (`THEME_TOKENS`/`serializeThemeTokens`, voie `getComputedStyle`) restent
    synchronisés automatiquement. Revue manuelle à la charge de qui touche ce
    CSS : vérifier si `EXPORT_CSS` doit suivre.
23. **Préviz HTML/SVG : la frontière est l'iframe sandbox, aucune autre voie.**
    L'aperçu des blocs `html`/`svg` (bouton « œil », `decoratePre`) est
    l'exception sanctionnée à la doctrine `textContent` : du markup d'origine
    modèle atteint une surface de rendu, mais UNIQUEMENT dans un
    `<iframe sandbox="allow-scripts">` **sans `allow-same-origin`** (origine
    opaque : pas de localStorage/IndexedDB/DOM parent — un `<script>` embarqué
    s'exécute, confiné). Cette iframe ne doit **jamais** gagner
    `allow-same-origin`, et aucune autre voie d'injection de markup modèle ne
    doit être ajoutée (le SVG Mermaid, piège hors numérotation, passe par la
    sanitisation interne de Mermaid `strict` — cf. `docs/rendering.md`).
    `srcdoc` est posé par **propriété JS** sur un élément `createElement`,
    jamais interpolé dans un template string HTML.

## Domaines détaillés (`docs/`)

À lire à la demande, selon la zone touchée — pas systématiquement :

- **`docs/code-map.md`** — index « où se trouve quoi » (fonctions/const JS,
  sections JS/CSS, avec lignes). **Généré par `build.py` à chaque build, ne
  jamais l'éditer** — s'en servir pour cibler les lectures dans les gros
  fichiers (`ui.js`, `chat.css`).
- **`docs/pitfalls-detail.md`** — développement complet des 23 pièges ci-dessus.
- **`docs/storage.md`** — schéma `localStorage` (`miaou-settings`,
  `miaou-conversations`, `miaou-summaries`, `miaou-memories`,
  `miaou-mcp-servers`) et IndexedDB (`skills`, `resources`).
- **`docs/tools.md`** — registre d'outils (`tools.js`), mécanisme d'acks
  (`tool-ack`), et références de conversation dans le texte du modèle
  (`conv_ref`).
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

## Règle d'or

En cas d'ambiguïté sur un point non couvert ici : **signaler plutôt que deviner**.
Le projet a déjà payé le prix de suppositions hâtives.

> Note : `.bg-activity` n'était pas dans la maquette d'origine et a été implémenté
> en intérimaire. **Avant de le retravailler**, demander les spécifications HTML/CSS
> plutôt que de redessiner à l'aveugle. (`.summary-banner` a depuis reçu une spec et
> une implémentation définitives — cette mise en garde ne le concerne plus.)
