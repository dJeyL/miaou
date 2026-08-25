# Couverture de tests

Squelettes dans `tests/` exécutés par `tests/runner.py` (QuickJS, stubs
navigateur + framework maison). Le runner exécute d'abord quelques **tests
unitaires Python de build.py** (`run_build_unit_tests` : strip des commentaires
JS/CSS/HTML — strings, templates, regex, commentaire non terminé ;
`parse_help_sections` — nominal, ordre, fence, slug dupliqué, fichier sans
section ; `parse_system_skill_file`/`load_system_skills` — cartouche nominal,
description absente, cartouche/`name`/corps manquant → `ValueError`, lecture
réelle de `src/system-skills/*.md`, dossier absent → `{}` via un `SRC` de test
temporaire), comptés dans le même total. S'y ajoutent deux **contrôles
source-à-source** (QuickJS n'a ni système de fichiers ni IndexedDB) :
`run_docs_index_check` (tout `docs/*.md` figure dans l'index de `CLAUDE.md`) et
`run_idb_schema_check` (les deux points d'ouverture de la base `miaou` —
`openConvDB`/`openResourceDB` — demandent la même version via
`MIAOU_DB_VERSION` et portent des `onupgradeneeded` identiques ; la divergence
laissée par U-1 a rendu muets skills système, bibliothèque d'espace et pièces
jointes, chaque appelant avalant le `VersionError` en `console.warn`). Seules les **fonctions pures** sont
couvertes
(pas de `fetch` dans QuickJS) : tokenisation/scoring, les trois états de l'index
de résumés, le registre d'outils, parsing SSE/résumés, **horodatages**
(`formatMessageTime`, `formatFullDateFr`, `formatDateRelative`), **agrégation MCP**
(`parseToolName`, `groupByNamespace`, `guessMcpTransport`, `validateMcpServerName`,
`filterMcpTools`, routage `callTool` interne/erreur, CRUD `miaou-mcp-servers`
— y compris `normalizeMcpServer` défauts/coercition, `getMcpServer`/`deleteMcpServer`
par `name`), **serveurs API** (`miaou-api-servers` : `migrateApiServersIfNeeded`
one-shot gardé sur la présence de clé, CRUD `upsertApiServer`/`deleteApiServer`/
`getApiServer`, `activeApiServer` avec repli sur le premier serveur si l'id actif
est périmé, `activeApiConfig` avec filet `loadSettings().model`), **`hasSubstance`**
(piège 5 — seuil `trim().length >= 8`, comptage user/assistant distinct, garde
`Array.isArray`) et `backfillCandidates`,
**ressources** (`humanSize`, `formatResourceDescriptor`,
`generateResourceId`, `arrayBufferToBase64`/`base64ToArrayBuffer`,
`utf8Encode`/`utf8Decode`, `extractResultParts`, `assembleToolResultForModel`),
**pièces jointes — envoi et persistance (brief A lot 2)** :
`formatAttachmentDescriptor` (format exact byte-stable, dérivé uniquement des
champs figés), `formatTextAttachmentBlock` (en-tête + fence, texte vide),
`buildAttachedMessageContent` (texte seul → string, image → tableau de content
parts avec une part par image, composition texte+image), `prefixTextInContentParts`
(insertion dans la première part texte, création si absente, non-mutation),
`collapseAttachedMessageContent` (réécriture parts→descripteur : idempotence
sur une string déjà réécrite, une ligne par image dans l'ordre des
attachments, attachments non-image ignorés, parts texte multiples concaténées),
`messageTextForSummary` (durcissement generateTitle/generateSummary :
`displayText` prioritaire, extraction des parts texte d'un tableau de content
parts sans jamais produire `[object Object]`), `expandThread` (passthrough
inchangé d'un `content` en tableau de parts), et le **cache session de rejet
vision** (`isVisionRejected`/`markVisionRejected`, clé composite endpoint+modèle
— indépendance par modèle sur un même endpoint), `messagesHaveImageParts`,
`degradeVisionMessages` (collapse content-parts→string, non-mutation),
`injectVisionDegradedNote` (insertion dans un `<miaou_context>` existant,
préfixe simple sinon, ciblage du dernier message user, system message intact).
Le rejeu réseau (400 → retry sans images) et la construction du contenu depuis
le cache session IDB (`buildOutgoingContentForAttachments`, main.js) restent
manuels (pas de `fetch`/IDB sous QuickJS) — cf. `docs/manual-tests.md`.
**Pièces jointes — rappel et hook d'inflation (brief A lots 3-4)** :
`ATTACHMENT_DOCTRINE` (présence dans `ROOT_SYSTEM_PROMPT`), `recall_attachment`
(chemins d'erreur synchrones : ref manquant, ref inconnu du cache session — le
round-trip complet image/texte/binaire reste manuel, IDB non disponible sous
QuickJS), et le hook D6 : `toolDeclaresAttachmentInflation` (capability via
`ref`+`content_b64` déclarés dans l'`inputSchema` distant, sans nom de serveur
en dur), `ATTACHMENT_REF_RE`, la table d'état poussé/non-poussé
(`isAttachmentPushed`/`markAttachmentPushed`/`clearAttachmentPushState`, scopée
par conversation), `_isRefUnknownError` (code machine `errorCode`, jamais une
sous-chaîne du texte libre). `callDocsInflatedRemoteTool` lui-même (le
round-trip réseau complet + le rejeu `REF_UNKNOWN`) reste manuel — nécessite un
serveur `mcp_docs` réel, cf. `docs/manual-tests.md` (test 57) ; le stub `fetch`
du runner QuickJS (`tests/runner.py`) ne résout ni ne rejette jamais, un test
qui l'exercerait resterait bloqué silencieusement.
**ressources — cache session** (`getCachedRecordByAttId` : match exact attId+conversationId,
conversationId omis, conversationId différent, attId absent ; `getCachedLibraryEntriesBySpace` :
filtre `kind==='library'` et `spaceId`, spaceId sans fichier), **doctrines conditionnelles**
`intentDoctrinePrompt` (gate `TOOLS.length && settings.intentTracing`, défaut `true`) et
les **blocs de contexte dynamique** (main.js : `buildSummaryBlock` — vide/1+ match avec
id/titre/résumé —, `buildMemoryEntriesBlock` — scope profile+Space actif, absent hors
scope — et `buildSkillsContextBlock` — vide sans autotrigger, listing sinon ; `contextBlockParts`/
`buildContextBlock` ne sont PAS testés directement, `Intl.DateTimeFormat` n'étant pas
stubé sous QuickJS),
**skills** (`validateSkillSlug`, `findSlashTriggers`, `bakeSkillMessage`, sync du
cache mémoire `setSkillsCache`/`upsertSkillCache`/`removeSkillCache`/
`listEnabledSkills`/`matchSkillCompletions`, `skills__list` activés-seulement,
chemins d'erreur synchrones de `skills__read`, arithmétique d'index de
`moveSkillAcSelection` — entrée par ↑ sans sélection = dernière option, wraps,
garde liste vide —, projection `autotrigger` de
`_skillMeta`, `getAutotriggerSkillsMeta` (filtrage enabled+autotrigger, cas liste
vide), `skillDoctrinePrompt` conditionnel sur skills autotrigger, jamais de
confirmation), **export Markdown des
traces d'outils** (`formatToolAcksMd` : singulier/pluriel, `intent` présent/absent,
erreur, troncature args/résultat/nom de ressource, `resource_presented` sans
data embarquée, ack sans `args`), **`conv__list`** (filtre `query` via
`tokenize`/`scoreSummary` cumulable avec `since`, exclusion de la conversation
courante via `currentConvId`, capture de `miaou_intent` sur un outil interne y
compris via un handler async), **acks — label avec intent** (`ackLabel`
`conversation_list` et `skill_list` : préfixe `"<intent> : "` si présent — c'est
le texte brut de secours ; le rendu DOM à deux niveaux effectivement affiché
par `renderLabel`/`renderIntentTwoLevel`, avec chevron et détail replié, n'est
pas couvert ici, faute de DOM riche dans QuickJS — vérification manuelle),
**`conv_ref`**
(`parseConvRefs` : marqueur avec/sans titre, titre contenant `:`, plusieurs
marqueurs ; `resolveConvRefs` : lien avec titre fourni, lookup storage si titre
absent, lien conservé avec titre sur une entrée tombstone (conversation
existante), texte barré `~~...(supprimée)~~` si `loadConversation` échoue —
avec titre du marqueur, avec titre orphelin en résumé, ou repli sur l'ID si
aucun titre connu —, encodage URL de l'id), et la **recherche plein texte de la
sidebar** (`searchConversations` : titre en substring, résumé via
`tokenize`/`scoreSummary`, tombstone ignoré, et — depuis U-3 — appartenance à
l'ensemble `contentHits` fourni par l'appelant, ainsi que le comportement quand
il est omis : titre et résumé seulement, jamais le contenu). Le scan de contenu
lui-même est testé sur `convContentMatches` (utils.js, pure) : match message
user, match message assistant, priorité `displayText` sur le `content` baké
d'une slash-skill (un mot présent uniquement dans le corps injecté ne doit pas
matcher), exclusion des entrées ack (dont le `result` peut être volumineux et
hors-sujet), entrées dégénérées (conversation sans messages, requête vide,
`null`), et la valeur du seuil `CONTENT_SCAN_MIN_CHARS`. Le seuil est **appliqué**
par `collectContentSearchHits` (async, IDB) : son câblage relève du Playwright
(`verify-conv-search.mjs`), pas de QuickJS.

Couvert aussi : l'**export/import complet des données** (feature E, format v2
depuis le lot U-4) — `EXPORT_KEYS` (les **7** clés, et l'absence explicite de
`miaou-conversations`/`miaou-summaries`), `buildExportPayload` (structure
`format`/`version`/`exportedAt` avec `version` à 2, les 7 clés localStorage
reprises désérialisées, `miaou-active-api-server` et `miaou-active-space` qui
restent des strings brutes, sections manquantes → défauts vides tableau/objet,
skills/resources **et conversations/résumés** embarqués sous `idb`, messages
conservés intégralement), `validateImportPayload` (payload valide avec compteurs
`conversations`/`summaries`/`memories`/`skills`/`resources`/`servers`/`spaces`,
format inconnu, format absent, version future ou non-numérique, `null`/
`undefined` sans crash, sections `localStorage`/`idb` manquantes → comptées
vides sans erreur, types invalides — ex. un tableau attendu remplacé par un
objet — comptés à 0 sans crash, versions 1 et 2 acceptées).

Les deux helpers purs du lot U-4 portent l'invariant de rétrocompatibilité :
`normalizeLegacySummaryMap` (objet indexé → records, `id` réaffirmé depuis la
clé, entrées non-objet ignorées, tableau/non-objet → `null` distinct du vide, et
le fait que `parseLegacySummaries` **délègue** bien à elle — une seule formule de
conversion pour la migration U-2 et l'import v1) et
`extractImportedConvRecords` (routage v1 depuis `localStorage` / v2 depuis
`idb`, messages intacts, records sans `id` écartés, une section fait autorité
pour sa version dans les deux sens, sections absentes sans crash, aller-retour
`buildExportPayload` → `extract` à l'identique, et la **cohérence entre le
compte affiché par `validateImportPayload` et ce qu'`extract` rendra**).

Le round-trip base64 d'une ressource
(`arrayBufferToBase64`/`base64ToArrayBuffer`) était déjà couvert par la suite
existante, réutilisé tel quel pour l'export. `snapshotLocalStorageForExport`
(main.js) est couvert : les 7 clés JSON valides désérialisées,
`miaou-active-api-server`/`miaou-active-space` conservées en string brute, une
clé au JSON corrompu → `null` sans crash, et le fait qu'un résidu
`miaou-conversations` en localStorage n'est **plus lu**.

La plomberie IDB (`getAllResources`, `clearIdbStore`,
`readAllConversationsFromDB`, `readAllSummariesFromDB`,
`replaceConvRecordsFromImport`) et l'orchestration (`exportAllData`,
`onImportFileSelected`, `applyImportedData` — lecture fichier, `FileReader`,
`location.reload()`) ne sont pas QuickJS-testables : elles relèvent du Playwright
(`verify-conv-export-import.mjs`, 26 contrôles) et de la vérification manuelle
(`docs/manual-tests.md`). C'est là que se joue le vrai risque du palier :
l'export ne se lit pas dans sa forme mais dans son **contenu** (une conversation
froide doit sortir avec ses messages), et l'import d'un fichier v1 **est une
migration**, donc doit être exercé sur une base déjà peuplée — jamais vierge.

Couvert aussi : les **Spaces** (lot C, herméticité) — CRUD du registre
(`upsertSpace`/`getSpace`/`deleteSpaceEntry` no-op sur le default Space/
`getActiveSpaceId`/`setActiveSpaceId`, défaut `DEFAULT_SPACE_ID`),
`migrateSpacesIfNeeded` (création du registre + default Space, backfill
`spaceId`/`scope` manquants, **idempotence** vérifiée par double appel sans
écrasement des valeurs déjà posées), le prédicat d'herméticité
`spaceConvIds` (filtrage par Space, conversation sans `spaceId` traitée comme
default), `listMemoryEntries(scopes?)` (comportement historique sans argument,
filtrage par liste de scopes, tombstones toujours respectées), et
`listAllConversations` qui expose `spaceId` résolu. La couche UI (sélecteur de
Space, écran Space, switch avec `resetToEmpty`) et le branchement herméticité
sur `renderConvList`/`searchConversations`/les outils modèle arrivent en C2/C3
— non couverts ici.

Couvert aussi : la **résolution multi-serveurs des chemins legacy**
(`modelName` et `backfillMessageModels` lisent `activeApiConfig().model`, jamais
`loadSettings().model` directement — serveur actif prioritaire, filet legacy,
cas « rien de résolu »), et le **cache session de rejet de `reasoning_effort`**
(`markReasoningEffortRejected`/`isReasoningEffortRejected`, clé composite
endpoint+modèle — indépendance par URL et par modèle). Le retry de
`streamCompletion` sans le paramètre après rejet passe par `fetch` : manuel.

Le contenu skill lu en IDB (`getSkillContent`/`getSkillRecord`, chemin async)
se vérifie à la main, comme la garde « aucune skill activée » de `resolveSend`
(async — le harness QuickJS n'exécute pas les microtâches, un `.then` ne se
résout jamais dans le corps synchrone d'un `it`). IDB, `internResourcesFromResult`, `loadConversationResources`
et la cascade D8 (cf. `docs/mcp.md`) se vérifient à la main (tests 28–34 dans
`docs/manual-tests.md`).

Couvert aussi : le **nom de fichier proposé par le modèle pour un bloc de code**
(`filename=`, cf. `docs/tools.md`) — `parseCodeFenceInfo` (lang seul, lang +
filename séparés par un espace, espaces multiples, filename entre guillemets
avec espace interne, virgule terminale sur le lang nettoyée — ancienne forme
cassée, non-régression —, info string vide ou absente) et
`sanitizeDownloadName` (nom simple inchangé, séparateurs de chemin neutralisés,
traversée de répertoire, suffixe d'extension dérivée du langage si absente,
caractères de contrôle retirés, chaîne vide/`undefined` → chaîne vide). Le
renderer marked custom (`marked.use({ renderer: { code } })`, ui.js) et la
lecture de `data-filename` par `decoratePre` ne sont pas QuickJS-testables (pas
de DOM riche/Prism) : vérification manuelle (`docs/manual-tests.md`).

**Rendu Mermaid et préviz sandboxée (lot E, cf. `docs/rendering.md`)** : seuls
les helpers purs sont couverts — `isMermaidLang` (casse, langues voisines,
vide/`undefined`), `mermaidThemeFor` (`dark` → `dark`, tout le reste →
`default`), `isPreviewableLang` (html/svg seuls, casse, xml/xhtml exclus) et
`buildPreviewSrcdoc` (html passthrough byte-identique, svg enveloppé dans un
document minimal, contenu vide/null), `diagramImageName` (remplacement
d'extension, nom générique, assainissement via `sanitizeDownloadName`). Le
lazy-load CDN, la passe `renderMermaidUnder`, le toggle, le hook thème,
l'iframe sandbox, la lightbox pan/zoom, le canvas PNG, la passe d'export
`embedExportMermaid` (E4, DOM/async) et les fallbacks
d'erreur sont du territoire manuel (tests 71–88 dans `docs/manual-tests.md`).

**Groupe d'acks (ticker, brief N, cf. `docs/tools.md`)** : le réducteur pur
`ackGroupReduce` (arrivée, franchissement du seuil à 2 acks, héritage
`slotExpanded`, bascule `toggleMode` dans les deux sens mid-stream) et ses
dérivées `ackGroupIsCompact`/`ackGroupCount`/`ackGroupVisibleAck`, ainsi que
`resolveMotionReduced` (les 3 réglages, préférence système injectée en
paramètre) sont couverts QuickJS. Le DOM (ticker `translateY`, agrandissement
vertical `height` à la bascule, badge, reduced-motion appliqué) et le drawer
Apparence sont vérifiés à la main (scénario ajouté dans
`docs/manual-tests.md`).

**Synchro multi-onglets (lot J, cf. `docs/multitab-sync.md`)** : le noyau pur de
`sync.js` est couvert par `tests/test-sync.js` — `makeEnvelope`/`validateEnvelope`
(version, type dans la liste fermée, `tabId` non vide, rejet des formes
invalides), `routeMessage` (présélection d'action par type × conv affichée ou
non, `ignore-self` par `tabId`), `generateTabId` (préfixe, suffixe aléatoire).
`tests/test-main.js` couvre `projectConvMessages` (projection fidèle des
messages persistés vers `currentThread` : user/assistant avec champs affichables,
`displayText` et normalisation `display`→`displayText`, attachments, acks via la
whitelist `ACK_COPY_FIELDS`, ordre et cardinalité 1:1, et l'invariant du fix
piège 24 — la projection reflète la DERNIÈRE réponse présente, base de la
relecture post-await). L'adaptateur impur (`BroadcastChannel`, `initSyncChannel`,
`syncPost`, `syncOnMessage`), le câblage `openConversation` (l'`await` et le jeton
`_openConvSeq`) et tout le comportement inter-onglets réel (soft-lock, readonly,
heartbeat/TTL, rehydratation post-await) ne sont pas QuickJS-testables : script de
non-régression Playwright `verify-multitab-sync.mjs` (deux pages sur un contexte
partagé, `fetch` stubé) et scénarios manuels deux-onglets (`docs/manual-tests.md`).

**`js__eval` — briques pures du sandbox de compute (lot L, cf. `docs/tools.md`)** :
la frontière pure est couverte avant tout câblage VM. `tests/test-utils.js`
couvre `splitLines` (multi-lignes sur `\n`, dernier fragment sans `\n` final
conservé, normalisation CRLF/CR→LF, `\n` final → dernier fragment vide, texte
vide → `['']`, null/undefined) — substrat de la primitive guest `lines()` — et
`checkOutputCap` (sous/à/au-dessus du cap avec borne inclusive, null/undefined →
longueur 0) — garde de refus §3, la logique isolée du marshaling VM.
`tests/test-tools.js` couvre `classifyHandleRef` (positifs `att-N`/`file-<id>`/
`res_<id>` → tag de famille ; rejets vide/`res-x`/`attN`/`file-ABC`/non-string →
null) — le cœur de décision « quelle famille de handle », pur, réutilisant les
trois regex existantes. Impurs, NON QuickJS-testables (vérif runtime L3 via
`verify-js-eval.mjs`) : `resolveHandleRecord` (lit le cache session), le
lazy-load CDN de l'engine, la création VM, l'injection de globals, l'exécution
guest et les guards timeout/mémoire — tout l'embedding QuickJS-WASM chargé en
browser, autre embedding que le `qjs` du runner.

Adapter un squelette est permis si le comportement testé est respecté (un cas l'a
été : `indexOf` vaut 0 pour le premier élément, donc tester la présence avec
`>= 0`, pas `toBeTruthy`). La boucle `tool_calls`, `silentCompletion` et **tout
le chemin MCP distant** (fetch JSON-RPC, SSE réel, AbortController, cascade D8) se
vérifient à la main (checklist dans `docs/manual-tests.md`). Le banc d'essai MCP
(`mcp_bench.py`) a été extrait dans le projet `miaou-mcp-servers`.

**Fixtures de développement (`.claude/skills/run-miaou/seed-fixtures.js`).**
Jeu de données réaliste — 26 conversations (dont 5 dans un second Space
« Pro »), leurs résumés, 4 souvenirs, 2 skills et les pièces jointes de
`seed-10b` — utilisé par les scripts Playwright pour peupler la page dist avant
vérification. C'était `tests/dev-seed.html` jusqu'au lot U-5 : une page qu'on
ouvrait à la main, dont les verify extrayaient le `<script>` par regex pour
l'évaluer dans la page. L'enveloppe HTML a disparu (Playwright avait remplacé
l'usage manuel) et les fixtures vivent maintenant dans un module ES importé par
les scripts : `seedAll(page)` sème tout, `seedConversations(page)` seulement
l'historique. Chaque fonction résout **après `tx.oncomplete`**, donc l'appelant
enchaîne `page.reload()` sans attente arbitraire.

Deux points à ne pas redécouvrir :

- Conversations et résumés sont écrits en **IndexedDB** depuis le lot U ; le
  module ouvre la base sur sa constante `MIAOU_DB_VERSION`, qui **doit rester
  alignée sur celle de `storage.js`** — un script qui ouvre `miaou` sur un
  littéral périmé bloque l'ouverture (le cas s'est produit).
- Plusieurs verify portent des **assertions chiffrées** sur ces fixtures
  (nombre de conversations en sidebar, comptes d'acks, cartes de skills). Elles
  se périment quand le fixture grandit ou quand une skill système s'ajoute :
  les corriger avec le compte réel, jamais assouplir l'assertion.

Les scripts verify **écrits depuis** construisent leurs propres fixtures en
`page.evaluate` plutôt que de dépendre du module : c'est la pratique cible pour
tout nouveau script, le module reste pour ceux qui en dépendent déjà.
