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
`filterMcpTools`, routage `callTool` interne/erreur, CRUD `miaou-mcp-servers`),
**ressources** (`classifyMime`, `humanSize`, `formatResourceDescriptor`,
`generateResourceId`, `arrayBufferToBase64`/`base64ToArrayBuffer`,
`utf8Encode`/`utf8Decode`, `extractResultParts`, `assembleToolResultForModel`),
**skills** (`validateSkillSlug`, `parseSlashCommand`, `bakeSkillMessage`, sync du
cache mémoire `setSkillsCache`/`upsertSkillCache`/`removeSkillCache`/
`listEnabledSkills`/`matchSkillCompletions`, `skills__list` activés-seulement,
chemins d'erreur synchrones de `skills__read`, arithmétique d'index de
`moveSkillAcSelection` — entrée par ↑ sans sélection = dernière option, wraps,
garde liste vide —, projection `autotrigger` de
`_skillMeta`, `getAutotriggerSkillsMeta` (filtrage enabled+autotrigger, cas liste
vide), `skillDoctrinePrompt` conditionnel sur skills autotrigger ET résolution de
la variante CONFIRMATION selon `confirmSkillAutoUse`), **export Markdown des
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
`EXPORT_KEYS` (les 7 clés), `buildExportPayload` (structure `format`/`version`/
`exportedAt`, les 7 clés localStorage reprises désérialisées, `miaou-active-api-server`
qui reste une string brute, sections manquantes → défauts vides tableau/objet,
skills/resources embarqués sous `idb`), `validateImportPayload` (payload valide
avec compteurs `conversations`/`memories`/`skills`/`resources`/`servers`,
format inconnu, format absent, version future ou non-numérique, `null`/
`undefined` sans crash, sections `localStorage`/`idb` manquantes → comptées
vides sans erreur, types invalides — ex. un tableau attendu remplacé par un
objet — comptés à 0 sans crash, version 1 exactement acceptée). Le round-trip
base64 d'une ressource (`arrayBufferToBase64`/`base64ToArrayBuffer`) était déjà
couvert par la suite existante, réutilisé tel quel pour l'export. La plomberie
IDB (`getAllResources`, `clearIdbStore`) et l'orchestration (`exportAllData`,
`onImportFileSelected`, `applyImportedData` — lecture fichier, `FileReader`,
`location.reload()`) ne sont pas QuickJS-testables : vérification manuelle
(`docs/manual-tests.md`).

Couvert aussi : la **résolution multi-serveurs des chemins legacy**
(`modelName` et `backfillMessageModels` lisent `activeApiConfig().model`, jamais
`loadSettings().model` directement — serveur actif prioritaire, filet legacy,
cas « rien de résolu »), et le **cache session de rejet de `reasoning_effort`**
(`markReasoningEffortRejected`/`isReasoningEffortRejected`, clé composite
endpoint+modèle — indépendance par URL et par modèle). Le retry de
`streamCompletion` sans le paramètre après rejet passe par `fetch` : manuel.

Le contenu skill lu en IDB (`getSkillContent`/`getSkillRecord`, chemin async)
se vérifie à la main, comme la garde « aucun skill activé » de `resolveSend`
(async — le harness QuickJS n'exécute pas les microtâches, un `.then` ne se
résout jamais dans le corps synchrone d'un `it`). IDB, `internResourcesFromResult`, `loadConversationResources`
et la cascade D8 (cf. `docs/mcp.md`) se vérifient à la main (tests 28–34 dans
`docs/manual-tests.md`).

Adapter un squelette est permis si le comportement testé est respecté (un cas l'a
été : `indexOf` vaut 0 pour le premier élément, donc tester la présence avec
`>= 0`, pas `toBeTruthy`). La boucle `tool_calls`, `silentCompletion` et **tout
le chemin MCP distant** (fetch JSON-RPC, SSE réel, AbortController, cascade D8) se
vérifient à la main (checklist dans `docs/manual-tests.md`). Le banc d'essai MCP
(`mcp_bench.py`) a été extrait dans le projet `miaou-mcp-servers`.
