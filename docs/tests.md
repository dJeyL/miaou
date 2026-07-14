# Couverture de tests

Squelettes dans `tests/` exécutés par `tests/runner.py` (QuickJS, stubs
navigateur + framework maison). Le runner exécute d'abord quelques **tests
unitaires Python de build.py** (`run_build_unit_tests` : strip des commentaires
JS/CSS/HTML — strings, templates, regex, commentaire non terminé), comptés dans
le même total. Seules les **fonctions pures** sont couvertes
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
data embarquée, ack sans `args`), **`list_conversations`** (filtre `query` via
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
sidebar** (`searchConversations` : le comportement existant — titre en
substring, résumé via `tokenize`/`scoreSummary`, tombstone ignoré — reste
couvert en non-régression ; le scan de contenu ajouté est testé sur un match
message user, un match message assistant, la priorité `displayText` sur le
`content` baké d'une slash-skill (un mot présent uniquement dans le corps
injecté ne doit pas matcher), le seuil des 3 caractères — en dessous, aucun
scan de contenu même si le mot existe — et l'exclusion des entrées ack, dont
le `result` peut être volumineux et hors-sujet).

Couvert aussi : l'**export/import complet des données** (feature E) —
`EXPORT_KEYS` (les 9 clés), `buildExportPayload` (structure `format`/`version`/
`exportedAt`, les 9 clés localStorage reprises désérialisées, `miaou-active-api-server`
et `miaou-active-space` qui restent des strings brutes, sections manquantes → défauts vides tableau/objet,
skills/resources embarqués sous `idb`), `validateImportPayload` (payload valide
avec compteurs `conversations`/`memories`/`skills`/`resources`/`servers`/`spaces`,
format inconnu, format absent, version future ou non-numérique, `null`/
`undefined` sans crash, sections `localStorage`/`idb` manquantes → comptées
vides sans erreur, types invalides — ex. un tableau attendu remplacé par un
objet — comptés à 0 sans crash, version 1 exactement acceptée). Le round-trip
base64 d'une ressource (`arrayBufferToBase64`/`base64ToArrayBuffer`) était déjà
couvert par la suite existante, réutilisé tel quel pour l'export. `snapshotLocalStorageForExport`
(main.js) est couvert : les 9 clés JSON valides désérialisées, `miaou-active-api-server`/
`miaou-active-space` conservées en string brute, une clé au JSON corrompu → `null` sans crash.
La plomberie
IDB (`getAllResources`, `clearIdbStore`) et l'orchestration (`exportAllData`,
`onImportFileSelected`, `applyImportedData` — lecture fichier, `FileReader`,
`location.reload()`) ne sont pas QuickJS-testables : vérification manuelle
(`docs/manual-tests.md`).

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
