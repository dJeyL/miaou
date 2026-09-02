# Stockage (localStorage / IndexedDB)

> **Synchro multi-onglets (lot J)** : depuis J2, la plupart des écritures
> émettent un broadcast `BroadcastChannel` **post-commit** (après `setItem` pour
> localStorage, sur `tx.oncomplete` pour IndexedDB — jamais `req.onsuccess`) pour
> notifier les autres onglets. Table des émetteurs et exceptions (`miaou-active-space`,
> résumés) dans `docs/multitab-sync.md`. `miaou-active-space` n'est **jamais**
> diffusé (état par onglet).

- `miaou-settings` : `{ url, key, model, systemPrompt, highlight, summaryInjectionMode,
  theme, showModelSelector, reasoningEffort, showReasoningSelector, sidebarWidth,
  intentTracing }`.
  `url`/`key`/`model` sont **legacy** : depuis l'introduction des serveurs API
  multiples (`miaou-api-servers` ci-dessous), ils ne sont plus édités nulle
  part dans l'UI — `onSaveSettings()` ne les écrit plus. Ils ne servent qu'à
  la migration silencieuse (une fois) et de filet dans `activeModel()` si
  jamais aucun serveur n'existe encore.
  `summaryInjectionMode` ∈ `auto | propose | never`, défaut `propose`. `model` est
  le **modèle par défaut** (global). `showModelSelector` (défaut `false`) n'affecte
  que la visibilité du **sélecteur serveur/modèle** dans le composer (libellé du
  réglage depuis 2026-08-21 : le sélecteur liste les modèles de tous les serveurs
  non désactivés, pas seulement de l'actif — cf. `docs/pitfalls-detail.md` §15). `reasoningEffort` (défaut `''`)
  est le **niveau de raisonnement par défaut** (global) ∈ `'' | none | low | medium
  | high` — `''` (défaut) n'ajoute **aucun** paramètre `reasoning_effort` à la
  requête API (comportement natif du modèle) ; toute autre valeur est posée telle
  quelle. `showReasoningSelector` (défaut `false`) n'affecte que la visibilité du
  sélecteur dans le composer, symétrique à `showModelSelector` : même composant
  pilule + `.model-menu`, mais liste statique de 5 valeurs (pas de fetch). La
  valeur « défaut » grise la pilule (classe `.effort-default`, composer ET
  settings) — l'accent orange signale un niveau explicitement choisi. Résolution par
  `activeReasoningEffort()` (main.js), même pattern que `activeModel()` :
  `conv.reasoningEffort` (override) sinon `settings.reasoningEffort` (défaut).
  Si l'API rejette `reasoning_effort` pour un (endpoint, modèle) donné (vLLM
  renvoie 400 sur les paramètres inconnus), le rejet est mémorisé en session
  (`_reasoningEffortRejected`, api.js — clé composite URL+modèle, **pas** juste
  l'URL comme `_noThinkRejected` : un même endpoint peut exposer plusieurs modèles
  aux capacités de raisonnement différentes), puis `streamCompletion` **rejoue une
  fois la même requête sans le paramètre** — l'utilisateur reçoit sa réponse, pas
  une bulle d'erreur (le flag posé garantit l'unicité du retry). Le sélecteur se
  masque pour la suite de la session via `syncReasoningUI` (ui.js), appelé dans le
  `finally` du tour (main.js) — donc aussi quand le retry a réussi, pas seulement
  sur le chemin d'erreur. Cf. pièges 14/16 (raisonnement, KV cache)
  pour le mécanisme voisin de détection par observation directe. `sidebarWidth`
  (défaut `264`) est
  la largeur redimensionnable de la sidebar, bornée `[264, 528]` (min = largeur
  d'origine, max = ×2), pilotée via la variable CSS `--sidebar-w`
  (cf. `initSidebarResize`, ui.js) ; pendant le drag, la classe `.resizing` coupe
  la transition de largeur, et la valeur finale est persistée au `mouseup`.
  `ROOT_SYSTEM_PROMPT` (doctrines binaire et mémoire) est **toujours** injecté
  dès que des outils sont présents.
> **Lot U-1 — les conversations et les résumés ne sont PLUS dans localStorage.**
> Ils vivent dans les stores IndexedDB `conversations` et `summaries` (base
> `miaou`, **v4**), décrits plus bas. Le quota localStorage (~5-10 Mo) était
> atteint en usage réel, avec perte silencieuse (un `setItem` qui jette laisse
> la conversation courante non persistée). Les clés `miaou-conversations` et
> `miaou-summaries` n'existent plus après migration (lot U-2, section
> « Migration depuis localStorage » plus bas).

### Cache RAM à deux étages (lot U-1)

Le passage en IDB pose un problème d'API : `loadConversations()`,
`loadConversation(id)`, `loadSummaries()` et consœurs sont **synchrones** et
appelées depuis ~100 sites, dont trois catégories qui ne peuvent pas devenir
async — le rendu (`renderConvList`, palette, tri, `spaceConvIds`), le chemin
chaud du streaming (`persistCurrent`/`persistGeneration`, à chaque frontière de
tour) et des handlers d'outils synchrones. Propager `await` rouvrirait des
fenêtres de réentrance dans du code qui n'en a pas.

**Décision : l'API publique reste synchrone**, adossée à un cache RAM ; seules
les **écritures** sont async (fire-and-forget).

- **Étage 1 — `_convMetaCache`** : `Map<id, meta>` des métadonnées de TOUTES les
  conversations, **permanent**, jamais `messages`. Hydraté au boot. C'est lui
  qui sert `listAllConversations`, `renderConvList`, la palette, le tri et
  `spaceConvIds` : ces call-sites restent synchrones et inchangés.
- **Étage 2 — `_convMessagesCache`** : `Map<id, messages>` **bornée en LRU**
  (`CONV_MESSAGES_LRU_MAX`). Restent chaudes la conversation affichée, les
  dernières ouvertes, et **obligatoirement** toute conversation portant une
  génération en vol (piège 28 : `_activeGenerations` épingle ses entrées, jamais
  évincées — sinon la génération perdrait ses messages sous les pieds).
- **`_summariesCache`** : l'index des résumés en entier (taille bornée par
  nature — une entrée courte par conversation, jamais de contenu de messages).
  Comme les deux autres étages, il est **par onglet** : `refreshSummariesFromDB()`
  le relit en entier à la réception d'un `conv-updated`, faute de quoi un onglet
  injecterait au modèle des résumés périmés (cf. `docs/multitab-sync.md`).

**Contrat à connaître** : `loadConversation(id)` d'une conversation **froide**
rend `messages: []`, pas `null` — la conversation existe, ses messages ne sont
simplement pas en RAM. Deux conséquences dures :

1. **Ne jamais persister un record reconstruit depuis le cache pour modifier une
   métadonnée.** Épingler ou renommer une conversation froide via
   `saveConversation(conv)` l'écraserait **avec un tableau de messages vide**.
   Toute écriture de métadonnée passe par `persistConversationField(id, fields)`,
   qui fait son read-modify-write **dans la transaction IDB** et ne touche jamais
   `messages`. Une valeur `undefined` y supprime le champ (sémantique de l'ancien
   `delete conv.model`).
2. **Un lecteur qui a besoin du contenu à froid, en masse, ne passe pas par le
   cache** : il lit IDB via `readAllConversationsFromDB()` et vit en async. Trois
   consommateurs sont dans ce cas — `backfillCandidates` et
   `backfillMessageModels` (traités en U-1), et la recherche plein-texte
   (`collectContentSearchHits`, U-3 — voir la section dédiée plus bas).
   `warmConversation(id)` charge une conversation en étage 2 ; `openConversation`
   l'appelle dans le même bloc `await` que `loadConversationResources`, donc
   avant la relecture post-await du piège 24.

**Écriture froide** : `persistConversationCold(conv)` écrit un record complet
comme `persistConversation`, même transaction et même broadcast post-commit,
mais **sans toucher l'étage 2** (les métadonnées, elles, sont rafraîchies —
l'étage 1 porte toutes les conversations de toute façon). Réservé aux écritures
en masse d'un consommateur froid : aujourd'hui `backfillMessageModels`, qui
réécrit au boot toutes les conversations dont les réponses assistant n'ont pas
de `model` — cas courant dans un historique ancien. Avec l'écriture chaude,
l'étage 2 se retrouvait rempli de douze conversations arbitraires (les dernières
backfillées) à chaque démarrage : borné et sans corruption, mais sans objet.

**Relecture systématique à l'ouverture** : `warmConversation(id)` relit IDB à
chaque appel, y compris quand la conversation est déjà en étage 2. La version
U-1 court-circuitait dans ce cas — « en RAM » y valait « à jour », vrai dans un
onglet seul, faux dès qu'il y en a deux : le cache du second ne se rafraîchissait
jamais, ni au broadcast ni en rouvrant la conversation (cf. `docs/multitab-sync.md`,
invariant (c)). **Exception impérative** : une conversation portant une
génération en vol n'est jamais relue (piège 28 — son thread est en avance sur le
storage, la relire lui retirerait le tour en cours) ; on ne rafraîchit que sa
position LRU. `refreshConversationFromDB(id)` sert le cas symétrique : une
conversation non affichée dont un pair a changé les métadonnées.

**Fenêtre assumée** : entre la mutation du cache et `tx.oncomplete`, la RAM est
en avance sur le disque ; un reload dans cet intervalle (quelques ms) perd la
dernière écriture. C'était déjà le cas de facto pour les `resources`.

**Échec d'écriture** : tracé en console, sans surface dédiée (décision Julien,
lot U-1 — le brief exclut toute affordance visuelle nouvelle, et le quota IDB
est très au-dessus de celui de localStorage). Même posture que `putResource`,
dont le rejet n'a jamais eu d'auditeur.

**Deux points d'ouverture, un seul schéma.** La base `miaou` est ouverte par
`openConvDB` (storage.js) **ou** `openResourceDB` (resources.js) — l'un ou
l'autre peut être premier, le schéma est donc déclaré deux fois. Deux règles, et
un test qui les garde (`run_idb_schema_check`, runner.py — source-à-source, faute
d'IndexedDB en QuickJS) :

1. **La version vient de `MIAOU_DB_VERSION`** (storage.js), jamais d'un littéral.
2. **Les deux `onupgradeneeded` restent identiques**, à la ligne près.

Ces deux règles ont été écrites *après* la panne. Au lot U-1, le bump v3 → v4
n'avait été fait que dans `openConvDB` ; `openResourceDB` demandait toujours `3`.
Demander une version **inférieure** à celle de la base la fait rejeter
(`VersionError`) — et comme les appelants de ce chemin (`loadSpaceLibrary`,
`ensureSystemSkills`, `loadSkillsCache`, `loadConversationResources`) avalent
l'erreur en `console.warn`, l'application **paraissait fonctionner** : plus de
skills système upsertées, plus de bibliothèque d'espace, plus de pièces jointes,
sans le moindre symptôme visible hors console. La leçon n'est pas « garder les
upgrades synchrones » (ce que la dette U-1 disait déjà) mais que **le numéro de
version était le vrai piège**, et qu'un `console.warn` sur un chemin
d'infrastructure achète du silence, pas de la robustesse.

**Tests** : QuickJS n'a pas IndexedDB. Le cache y EST la source de vérité
observable (on ne stube pas IDB, cf. `project_extract_pure_helper_over_idb_stub`) ;
`resetConvCacheForTests()` le remet à zéro, et le stub `localStorage.clear()` du
runner l'appelle pour que la sémantique « je repars vierge » reste vraie. Ce que
QuickJS ne couvre pas (schéma réel, hydratation, éviction, non-écrasement) est
vérifié par `.claude/skills/run-miaou/verify-conv-idb.mjs`.

### Migration depuis localStorage (lot U-2)

`migrateConversationsToIdbIfNeeded()` (storage.js), appelée par `init()`
**avant `hydrateConvCache()`** — le cache s'hydrate depuis IDB, les stores
doivent donc déjà porter l'historique, sinon la sidebar s'affiche sans rien au
premier boot post-migration.

**Court-circuit sur l'ABSENCE des clés localStorage**, pas sur « le store IDB
est peuplé ». Après une migration réussie les clés sont purgées, donc
`getItem === null` court-circuite pour toujours. Le critère « store peuplé »
aurait un défaut : un utilisateur qui supprime toutes ses conversations après
une purge ratée verrait la migration rejouer et **ressusciter** son historique.
La posture diffère donc de `migrateApiServersIfNeeded` (qui teste la présence
de la clé qu'elle écrit) tout en suivant la même logique : tester la trace que
la migration elle-même laisse.

**Une seule transaction** pour les deux stores (`['conversations','summaries']`,
`readwrite`) : l'atomicité est gratuite et le `oncomplete` — donc le feu vert à
la purge — est unique.

**La purge n'a lieu qu'après `tx.oncomplete`** (piège 24 dans sa forme la plus
littérale : ici le commit gouverne une SUPPRESSION de la source, pas un simple
broadcast). Un échec de transaction rejette : rien n'est purgé, localStorage
reste intact, le prochain boot retentera.

**Interruption : tout ou rien, et reprise sans doublon.** Tous les `put` sont
émis dans **une seule** transaction — un onglet fermé en cours de migration
l'avorte, rien n'est écrit (pas même les `put` déjà émis), et localStorage est
intact puisque la purge est post-commit. Le boot suivant rejoue tout. Si la
fermeture a lieu entre le commit et le `removeItem`, la clé survit mais
`selectRecordsToMigrate` écarte les ids déjà présents : aucun doublon, et la
purge aboutit cette fois. Un état **partiellement** migré est donc inatteignable
par interruption ; il ne peut venir que d'un import ou d'un palier de version,
et la reprise le complète sans rien dupliquer (le keyPath étant l'`id`, un `put`
redondant écraserait de toute façon au lieu de dupliquer — deux protections
superposées). **Si la migration était un jour découpée en lots** (pour ménager
la mémoire sur un très gros historique), cette garantie d'atomicité tomberait :
les contrôles « interruption » et « reprise partielle » de
`verify-conv-migration.mjs` sont là pour le détecter.

**Ce qui est déjà en IDB prime.** `selectRecordsToMigrate` (pure) écarte les ids
déjà présents ; on lit les clés par `getAllKeys()` et non `getAll()`, pour ne
pas rapatrier tout le volume juste pour décider de ne pas l'écraser. Cas visé :
une migration antérieure a écrit puis échoué à purger.

**Contenu présent mais illisible : conservé, jamais purgé.** `parseLegacyConversations`
et `parseLegacySummaries` (pures) distinguent trois cas — clé absente (`[]`,
rien à faire), contenu sain (les enregistrements exploitables), contenu présent
mais impossible à parser (**`null`**). Sur `null`, la clé n'est pas purgée : ses
octets restent récupérables à la main, et la purge, elle, est irréversible. Les
deux clés sont indépendantes : l'une migre et se purge même si l'autre est
abîmée. Contrepartie assumée : la migration est retentée à chaque boot tant
qu'une clé abîmée est là, avec un `console.error` à chaque fois.

**Changement de forme des résumés.** L'ancienne clé `miaou-summaries` portait un
**objet indexé** `{ id: entry }` ; le store IDB veut des **records** à
`keyPath: 'id'`. `parseLegacySummaries` fait la conversion et réaffirme `id`
depuis la clé de l'objet — les entrées récentes le portent déjà (`saveSummary`
le force), les anciennes pas forcément, et sans lui le `put` jette.

**Tests** : les trois helpers sont purs et couverts en QuickJS. La migration
réelle (écriture, ordre écriture→purge, non-écrasement, non-purge de l'illisible,
idempotence) est vérifiée par
`.claude/skills/run-miaou/verify-conv-migration.mjs`.

### Recherche plein-texte sur conversations froides (lot U-3)

Le passage en IDB a coupé la recherche de sa source : une conversation froide
n'a pas ses `messages` en RAM, et le scan de contenu était fait **dans** le
prédicat synchrone de rendu. Rendre le prédicat async aurait propagé `await`
jusque dans `renderConvList` et le rendu de la palette.

**Le scan de contenu est donc précalculé, le prédicat reste synchrone.**

- `convContentMatches(conv, q)` (utils.js, **pure**, testée) — ce qui est
  scanné dans UNE conversation. Deux exclusions héritées du prédicat d'avant
  U-3 : les acks (`tool-ack`/`memory-ack`, dont le `result` est potentiellement
  énorme et hors-sujet) et, côté user, le corps baké d'une slash-skill
  (`displayText` prime sur `content`). C'est elle qui porte l'invariant —
  sortie en pure exprès plutôt que noyée dans du code IDB non testable.
- `collectContentSearchHits(query)` (storage.js, **async**) — lit IDB via
  `readAllConversationsFromDB()` et rend un `Set` d'ids. Sous
  `CONTENT_SCAN_MIN_CHARS` (= 3, utils.js), rend un Set vide **sans aucune
  lecture** : le bruit d'un substring de 1-2 caractères domine le signal.
- `searchConversations(query, contentHits)` (ui.js) — inchangé pour titre et
  résumé ; le scan de contenu devient une consultation `contentHits.has(id)`.
  **Argument omis = pas de scan de contenu**, ce qui est le comportement du
  premier rendu, avant que la passe async ait rendu la main.

**Option (a) du brief, tranchée après mesure** : relecture IDB complète par
frappe débouncée, **pas** d'index RAM entretenu. ~14 ms pour 100 conversations /
3,8 Mo, ~70 ms pour 500 / 20 Mo en régime chaud, derrière un debounce de 150 ms.
Un index RAM garderait tout le texte en mémoire en permanence — exactement ce que
l'étage 2 du cache évite — pour gagner des millisecondes invisibles. Ne pas le
construire par anticipation.

**Deux surfaces, même mécanique** (la palette n'était mentionnée ni par le brief
ni par le HANDOVER — sans elle, sa recherche cross-Space aurait perdu le match
contenu en silence) :

| | sidebar (`onConvSearch`) | palette (`scheduleCmdkContentScan`) |
|---|---|---|
| debounce | déjà présent (`CONV_SEARCH_DEBOUNCE_MS`) | **ajouté** (même constante) |
| état du résultat | `convSearchFilter` (closure sur le Set) | `_cmdkContentHits` = `{ query, hits }` |
| jeton de séquence | `_convSearchSeq` | `_cmdkContentSeq` |

**Rendu en deux temps, délibéré.** La liste est filtrée sur titre/résumé
**immédiatement**, puis complétée quand la lecture IDB rend la main (re-rendu
sauté si le Set est vide, pour ne pas rejouer l'animation d'entrée pour rien).
Sans ce premier rendu, la liste resterait figée sur l'ancien filtre pendant
toute la lecture — perceptible sur un gros historique.

**Jetons de séquence, obligatoires.** Deux frappes rapprochées ont leurs passes
en vol simultanément et rien ne garantit qu'elles rendent la main dans l'ordre :
sans jeton, la plus lente écrase le résultat de la plus récente et la liste
affiche le filtre d'une requête abandonnée
(`project_await_reentrancy_guard`). Côté palette, le résultat est mémorisé
**avec sa requête**, jamais seul — un Set arrivé en retard s'appliquerait sinon à
une autre frappe. Les invalidations : effacement du champ
(`cancelConvSearchDebounce`), changement de submode et fermeture de la palette
(`cancelCmdkContentScan`).

**Tests** : QuickJS couvre `convContentMatches` et la consultation du Set. Ni la
lecture IDB, ni le débounce, ni les jetons — c'est-à-dire exactement ce qui peut
faire afficher un résultat périmé : vérifiés par
`.claude/skills/run-miaou/verify-conv-search.mjs` (14 contrôles). Son seed écrit
**directement en IDB** sans ouvrir aucune conversation, et sans poser de `model`
sur les réponses assistant : un seed passant par `saveConversation` les
réchaufferait, et le script ne prouverait plus rien du chemin froid.

### Schéma d'une conversation (store IDB `conversations`)

Record `{ id, title, timestamp, updatedAt?, messages, model?, reasoningEffort?,
pinned?, spaceId?, attSeq?, snippet? }` (keyPath `id`, index `by_space`).
`spaceId` (feature Spaces, lot C) : id du Space propriétaire ; absent =
`DEFAULT_SPACE_ID` (`listAllConversations()` l'expose toujours résolu dans sa
projection, jamais `undefined`). Backfillé par `migrateSpacesIfNeeded()` sur
toute conversation antérieure à la feature. `updatedAt` (optionnel) est le
timestamp du dernier `persistCurrent` ; absent sur les anciennes conversations
(tri/affichage tombent alors sur `timestamp`). `model` (optionnel) est
l'**override de modèle de la conversation** — à ne **jamais** confondre avec le
champ `model` de chaque message assistant (quel modèle a produit *cette*
réponse, cf. backfill modèle). `reasoningEffort` (optionnel) est l'**override de
niveau de raisonnement de la conversation**.

`snippet` (optionnel, lot AA) est l'**extrait de secours** : le début du premier
message user, écrit **une seule fois** par `maybeWriteSnippet` (main.js) via
`persistConversationField`, jamais recalculé ni effacé ensuite (même discipline
figée que le descripteur d'image, piège 17). Il tient lieu de libellé tant
qu'aucun titre n'existe — `convLabel` le rend avec `provisional: true`, et les
surfaces l'italisent. Un agent n'en porte jamais (abstention explicite : son
`agentIntent` est déjà son libellé définitif). Il devient inerte, sans être
supprimé, dès qu'un titre arrive : c'est l'ORDRE de `convLabel` qui le neutralise
(`title` > `agentIntent` > `snippet`), pas une écriture supplémentaire.
**`listAllConversations()` le projette**, pour la même raison qu'`agentIntent`
ci-dessous : un libellé doit voyager avec la méta, sans quoi il serait correct
sur la conversation chaude et muet sur les lignes froides de la sidebar.

**Champs d'agent (lot X-1)**, tous optionnels et absents d'une conversation
racine : `parentConvId` (id du parent — sa présence EST la définition d'un
agent), `parentCallId` (id du tool_call d'origine, traçabilité), `agentIntent`
(libellé rédigé par le modèle, qui tient lieu de titre — un agent n'est jamais
titré), `agentStatus` (état **terminal** seulement : `done` | `exhausted` |
`aborted` | `stopped` | `error` — `running` est toujours DÉRIVÉ du registre de
générations, jamais persisté), `agentTurns` (tours consommés, pour la borne) et
`agentFiles` (lot X-1b : fichiers délégués par le parent, `[{alias, recordId,
name, mime, size, ref}]` — la table est la SEULE autorité de résolution des
handles de l'agent, d'où sa persistance : un agent doit rester lisible après un
reload ; absente quand rien n'est délégué, jamais un tableau vide qui ferait
croire à une capacité).
Le prédicat unique est `isRootConversation` (agents.js) : jamais un
`c.parentConvId == null` réécrit localement. **`listAllConversations()` expose
`parentConvId` et `agentIntent` dans sa projection méta** — les omettre rendrait
tout agent invisible en tant qu'agent, donc jamais exclu de la sidebar, du
backfill ni de la recherche. `splitConvRecord`, lui, n'a rien demandé : il copie
tous les champs sauf `messages`. Détail : `docs/agents.md`.

- **Store IDB `summaries`** (keyPath `id` = id de conversation ; lot U-1, était
  la clé localStorage `miaou-summaries`). Trois états : résumé
  présent / tombstone (`suppressed: true`) / absent (candidat au backfill).
  **Invariant visé (pas garanti à 100% en historique)** : tout id de ce store
  correspond à un id présent dans le store `conversations`. `deleteConv`
  (main.js) supprime l'entrée via `deleteSummaryEntry` ; les trois sites de
  génération async (`summarizeIfNeeded`, `restoreSummaryItem`, `runBackfill`,
  cf. piège 20 CLAUDE.md) re-vérifient `loadConversation(id)` avant d'écrire,
  pour ne pas ressusciter une entrée si la conversation a été supprimée
  pendant l'appel LLM. `pruneOrphanSummariesOnInit()` (main.js, au démarrage,
  avant `runBackfill()`) balaie les résidus d'une race antérieure à ce fix via
  la fonction pure `pruneOrphanSummaries(summaries, convs)` (storage.js).
- `miaou-memories` : tableau `[{ id, content, created_at, updated_at, suppressed, scope? }]`.
  **Deux chemins d'écriture distincts** : édition directe utilisateur →
  `editMemory(id, newContent)` (in-place) ; écriture par le modèle →
  `memory__create` / `memory__update` (in-place) /
  `memory__delete` (tombstone). `listMemoryEntries(scopes?)` renvoie les
  non-supprimées ; sans argument, toutes (usage historique, export/import) ;
  avec un tableau de scopes (ex. `['profile', activeSpaceId]`), filtre en plus
  sur `scope` (cf. Spaces ci-dessous). `forgetMemory(id)` supprime définitivement l'entrée du tableau.
- `miaou-mcp-servers` : tableau de backends MCP distants `[{ name, url, transport,
  enabled, authorization_token, timeout, toolAllowlist, toolDenylist }]`
  (cf. `docs/mcp.md`). `name` est l'identité **et** le
  préfixe d'outil (unique, charset `[A-Za-z0-9_-]`, pas de `__`, `miaou` interdit).
  `authorization_token` est stocké **en clair** (posture assumée non-prod).
  Les lignes d'appel `mcp_call` sont **toujours affichées** dans le thread —
  posture de transparence, aucun toggle de masquage. CRUD
  dans `storage.js` (`loadMcpServers`/`upsertMcpServer`/`deleteMcpServer`/
  `getMcpServer`/`listEnabledMcpServers`). **Aucun état de session/outils distants
  n'est persisté** ici : le cache (`_remoteTools`/`_remoteStatus`, tools.js) est en
  mémoire seule, reconstruit au démarrage.
- `miaou-api-servers` : tableau de backends API (chat completions) `[{ id, name,
  url, key, model, disabled, vision }]`. Remplace les champs plats `url`/`key`/`model` de
  `miaou-settings` (cf. ci-dessus). **`id` est l'identité** (pas `name`, à la
  différence des serveurs MCP) : permet de renommer une carte sans perdre la
  référence de serveur actif ni casser un override en cours. `key` stocké en
  clair (même posture D6 que `authorization_token` MCP). `model` est le modèle
  par défaut de ce serveur, résolu par `activeApiConfig()` (avec
  `settings.model` legacy en filet) — c'est cette fonction, et **pas**
  `loadSettings()`, qui fournit url/key/model à **tous** les appels API
  (`silentCompletion`, `streamCompletion`, `fetchModels`) : titrage et résumé
  compris, sinon ils enverraient le modèle legacy du serveur migré à
  l'endpoint du serveur actif. `activeModel()` (main.js) = override de
  conversation sinon `activeApiConfig().model`. Changer de serveur actif
  (`onUseApiServer`, main.js) **lève l'override de modèle de la conversation
  courante** (`setConvModel('')`) : il pointait sur un modèle de l'ancien
  serveur. Depuis le sélecteur serveur/modèle du composer, choisir un modèle
  appartenant à un AUTRE serveur bascule aussi le serveur actif
  (`pickComposerModel(m, serverId)`, ui.js) — même effet global qu'« Utiliser ce
  serveur », sans override de serveur par conversation.
  `disabled` (défaut `false`) : serveur **mis de côté**. Il n'est plus interrogé
  pour peupler le sélecteur (`listSelectableApiServers()`, storage.js — prédicat
  unique `!disabled && url`, à réutiliser plutôt qu'un filtre local) et n'est plus
  éligible comme **repli** d'`activeApiServer()` ; il reste activable
  explicitement depuis sa carte (« Utiliser ce serveur »), sinon on ne pourrait
  plus le réactiver. Si TOUS les serveurs sont désactivés, le repli retombe quand
  même sur le premier : on ne veut jamais `null` tant qu'une carte existe.
  `vision` (D5, brief A2) : map `{ [nomModèle]: false }` — flag **manuel** « ce
  modèle sur ce serveur n'a pas la vision ». Seule la valeur `false` est
  persistée (`normalizeApiServer` filtre les `true`) ; absence d'entrée = inconnu
  = on envoie les parts image (défaut). Lu par le prédicat pur
  `serverModelVisionEnabled(server, model)` → `false` seulement si marqué. Quand
  `false`, `dispatchSend` passe `visionDisabled` à `streamCompletion` qui dégrade
  **proactivement** les parts image en descripteur (mitigation du silent-failure
  Ollama F1 : aucun 400 renvoyé sur un modèle sans projecteur vision, le chemin
  réactif `_visionRejected` d'api.js — cache SESSION non persisté — ne peut pas
  l'attraper). Réglé dans la carte serveur (drawer API), pill sous le champ
  modèle. Distinct de `_visionRejected` (api.js, session, réactif sur 400).
  Serveur actif persisté séparément dans `miaou-active-api-server` (string,
  `id` du serveur). CRUD dans `storage.js`
  (`loadApiServers`/`upsertApiServer`/`deleteApiServer`/`getApiServer`/
  `activeApiServer`/`activeApiConfig`/`getActiveApiServerId`/`setActiveApiServerId`).
  **Transformation silencieuse** (`migrateApiServersIfNeeded`, appelée en lazy
  par `loadApiServers()`) : au premier accès sans tableau existant, si
  `miaou-settings.url` (ou son défaut de build) est non-vide, crée un unique
  serveur `{ name: 'Par défaut', url, key, model }` à partir des anciens
  champs plats et l'active. Ne s'exécute qu'une fois — la présence de la clé
  `miaou-api-servers`, même tableau vide, la court-circuite pour toujours.
  Suppression du dernier serveur restant bloquée dans l'UI
  (`onDeleteApiCard`, main.js) : jamais d'état « configuré » sans aucun
  serveur en tableau non-vide.
- `miaou-spaces` : tableau `[{ id, name, description?, createdAt }]` (feature
  Spaces, lot C). `description` (texte libre) est **ajoutée après** le prompt
  système utilisateur global dans `buildSystemMessage()` — ce n'est PAS un
  system prompt de substitution (le brief D4 d'origine proposait un
  remplacement ; décision inversée, cf. `docs/pitfalls-detail.md` piège 18).
  Espaces mutuellement hermétiques : une conversation
  (`spaceId`) et un souvenir (`scope`) appartiennent à exactement un Space (ou
  au scope `'profile'`, pour les souvenirs uniquement — global, injecté dans
  tous les Spaces). Le **default Space** (id fixe `DEFAULT_SPACE_ID`,
  actuellement `'default'`, nom d'affichage « Général ») est l'espace hors-Space
  historique : pas de cas particulier dans le schéma, non supprimable
  (`deleteSpaceEntry` est un no-op dessus), renommable. CRUD calqué sur les
  serveurs API : `loadSpaces`/`saveSpaces`/`normalizeSpace`/`upsertSpace`
  (identité par `id`)/`deleteSpaceEntry`/`getSpace`/`genSpaceId`. Space actif
  persisté séparément dans `miaou-active-space` (string brute, `id` du Space,
  même pattern que `miaou-active-api-server`) ;
  `getActiveSpaceId()`/`setActiveSpaceId(id)` — absence de clé ⇒
  `DEFAULT_SPACE_ID` (jamais de Space actif indéfini).
  **Migration idempotente** `migrateSpacesIfNeeded()` : à la différence de
  `migrateApiServersIfNeeded()` (one-shot, court-circuité par la présence de la
  clé), c'est un **backfill rejoué à chaque chargement** (appelé en tête
  d'`init()`, avant tout rendu) — garantit le registre + le default Space,
  `spaceId` manquant → `DEFAULT_SPACE_ID` sur chaque conversation, `scope`
  manquant → `DEFAULT_SPACE_ID` sur chaque souvenir (**pas** `'profile'` : la
  promotion vers le scope profile est une action utilisateur explicite,
  jamais un défaut de migration). Une conversation ou un souvenir déjà
  correctement scopé n'est jamais réécrit (double passe = même état).
  **Prédicat d'herméticité unique** `spaceConvIds(spaceId, convs)` (storage.js,
  pure, `convs` déjà chargé par l'appelant) : `Set` des ids de conversations du
  Space donné, une conversation sans `spaceId` comptant pour
  `DEFAULT_SPACE_ID`. Tous les sites qui doivent respecter l'herméticité
  (sidebar, recherche, outils `conv__list`/`conv__get`,
  sélection d'injection de résumés) passent par ce prédicat — jamais par un
  filtre `c.spaceId === x` réécrit localement. Les résumés (store `summaries`)
  ne portent **pas** de `spaceId` dupliqué : ils scopent via leur conversation
  (jointure sur l'id), cf. `docs/spaces.md` pour le détail des sites branchés.
- **IndexedDB `miaou`** (**version 4**) : quatre object stores.
  `onupgradeneeded` est idempotent (contains-check par store/index) →
  migrations v1→v2→v3→v4 transparentes, chaque store intact à chaque palier.
  Deux points d'ouverture coexistent (`openResourceDB` dans `resources.js`,
  `openConvDB` dans `storage.js`) : chacun déclare le schéma COMPLET dans son
  `onupgradeneeded`, puisque l'un ou l'autre peut être le premier à ouvrir la
  base. Ne jamais faire diverger les deux déclarations.
  - store `skills` (keyPath `slug`, géré par `skills.js`) : voir `docs/skills.md`.
  - store `resources`, index `by_conversation` **et** `by_space` (v3, lot Cbis —
    scoping des fichiers de bibliothèque d'espace, cf. ci-dessous). Chaque entrée :
  `{ id, conversationId, class, mime, name, size, data (ArrayBuffer), createdAt, originUrl? }`.
  `class` ∈ `"inline"` (texte/JSON, passé en clair au modèle — `entry.result` de
  l'ack contient le texte brut) | `"binary"` (données opaques — `entry.result` de
  l'ack contient `[resource_ref:res_…]`, remplacé par un descripteur statique à
  l'envoi). `originUrl` (optionnel, lot K) = URL d'origine d'une ressource web
  matérialisée par `web__fetch_resource` (`_storeBlock` la reçoit de
  `extractResultParts`, source = l'`uri` du `BlobResourceContents`) ; `null`/absent
  pour les attachments et les autres blobs. **Champ de traçabilité seulement** :
  jamais injecté au contexte modèle (`formatResourceDescriptor` ne le lit pas —
  KV-stabilité, piège 16/17). Les données ne sont **jamais** dans `localStorage`. Cache session (`_resourceCache`)
  en mémoire : peuplé par `loadConversationResources` (fire-and-forget à
  `openConversation`) et par `_storeBlock` (au stockage). Suppression en cascade
  par conversation via `deleteResourcesByConversation` (appelé dans `deleteConv`,
  main.js). `requestPersistence()` sollicite `navigator.storage.persist()` au
  premier stockage (silencieux si refusé).
  - **Pièces jointes de message (brief A/D1)** : mêmes store `resources` et
    mécanismes de cycle de vie que ci-dessus (GC gratuit à la suppression de
    conversation, chargement en cache à la réouverture, jamais dans
    `localStorage`) — pas de store séparé (décision actée). Enregistrement :
    `{ id, attId, conversationId, class, mime, name, size, data (ArrayBuffer),
    createdAt, w?, h? }`. `id` (`att_<base36>`, `storeAttachment`, resources.js)
    reste la clef IDB (`keyPath: 'id'`) ; `attId` (`att-1`, `att-2`, …) est le
    champ additionnel qui relie l'enregistrement au `message.attachments[].attId`
    — recherché via `getCachedRecordByAttId(attId, conversationId)` (scan
    linéaire du cache session, nombre d'attachments toujours petit). `w`/`h`
    présents uniquement pour une image (dimensions finales post-downscale,
    figées). **Pas d'ack `resource_stored`** : `storeAttachment` est une
    fonction dédiée, distincte de `_storeBlock` — un attachment utilisateur
    n'est pas un résultat d'outil, rien à annoncer dans le fil.
    `formatAttachmentDescriptor` (resources.js, brief A lot 2) est un
    formateur **distinct** de `formatResourceDescriptor` (format différent :
    `att-N`, dimensions, texte anglais, mention `miaou__recall_attachment`) —
    ne pas les confondre, les deux coexistent. Réutilise `humanSize` pour la
    taille lisible ; son rendu (`"1.5 KB"`, majuscules) diverge du style de
    l'exemple du brief (`"214 kB"`) — écart assumé, pas de second formateur de
    taille ad hoc.
  - **Récupération depuis la bulle (lot A3-1)** : un chip d'attachment en
    bulle envoyée (`attChipHtml`, ui.js — gate `conversationId` truthy,
    exclut composer ET export/Gbis) porte un handler global unique
    `onAttachmentChipClick(event, attId, conversationId)`. Le prédicat pur
    `attachmentClickAction(record, hasModifier)` (ui.js, testé QuickJS)
    décide l'action depuis le même enregistrement IDB que ci-dessus :
    discriminant image = présence de `record.w`/`record.h` (`record.class`
    vaut `'binary'` pour une image ET un binaire non-image, donc inutilisable
    seul). Sans modificateur : non-image → `downloadFile` direct ; image →
    lightbox (`openAttachmentLightbox`, généralisation E3, lot A3-2 — cf.
    `docs/rendering.md`). Avec Cmd(Mac)/Ctrl : image → nouvel onglet
    (`openAttachmentInTab`, Blob + `URL.createObjectURL` + `window.open`,
    révocation différée ~30s — navigation top-level vers `data:` bloquée par
    les navigateurs). Record absent du cache (pas encore peuplé par
    `loadConversationResources`, fire-and-forget) → no-op silencieux, même
    posture que `resolveAttachmentThumb`.
  - **Bibliothèque de fichiers d'espace (lot Cbis, D1)** : mêmes store
    `resources` et IDB (pas de store dédié, pas de clé localStorage
    `miaou-space-files` — décision actée, smallest diff). Discriminant
    `kind: 'library'` sur le record (absent/`'attachment'` = pièce jointe,
    comportement inchangé — backfill gratuit, pas de migration de données) ;
    champ `spaceId` (les attachments gardent `conversationId`, `spaceId`
    absent — jamais les deux). Enregistrement : `{ id, spaceId, kind:'library',
    class, mime, name, size, data (ArrayBuffer), createdAt, source?, description?
    }`. `id` (`file_<base36>`, `generateFileId`, resources.js) — préfixe
    distinct de `res_`/`att_`. `source` (optionnel) = id de la conversation
    d'origine si le fichier vient d'une promotion d'attachment (path 2/3),
    absent pour un upload direct (path 1). `description` (optionnel, D7 ou
    fournie par `files__promote`) — **PAS un résumé du contenu** : décrit ce
    que le fichier EST (nature, sujets, structure) pour que le modèle juge
    s'il doit l'ouvrir (`files__read`), pas ce qu'il contient en détail.
    Toujours passée par `capFileDescription` (resources.js, cap
    `FILE_DESCRIPTION_MAX_CHARS` = 240, troncature sans coupure en plein mot).
    **Ref modèle** = `file-<id>` (tiret, `libraryRefFromId`/`parseLibraryRef`,
    resources.js) — distinct du style interne `file_<hex>` du record, et
    **sans indirection table par conversation** comme pour `att-N` : les
    fichiers sont Space-stables, la ref exposée est directement l'id du
    record. `getResourcesBySpace(spaceId)` (résultats non filtrés par ordre —
    le tri `createdAt`→`id` byte-stable, si requis, est à la charge de
    l'appelant, cf. manifeste D4) lit via l'index `by_space`. `storeLibraryFile`
    (opération haut-niveau, frère de `storeAttachment`) construit le record et
    persiste. Cascade de suppression : purge Space (D5) → boucle
    `getResourcesBySpace` + `deleteResource` par entrée ; suppression de
    conversation ne touche **jamais** les fichiers d'espace, y compris promus
    (ils ont été copiés, provenance informationnelle).

## Export / import complet des données (feature E)

Assurance-vie : tout l'état de MIAOU (les clés localStorage ci-dessus + les
stores IndexedDB) tient dans un unique fichier téléchargeable et réimportable —
une **archive `.zip`** depuis le lot V-3, un `.json` nu avant. **Remplacement
intégral à l'import, pas de fusion** (décision actée pour la v1 — un import
écrase tout l'état local).

### Versions du format

- **v1** — conversations et résumés sous `localStorage`, aux côtés des autres
  clés du schéma. C'est là qu'ils vivaient avant le lot U.
- **v2** (lot U-4) — ils passent sous `idb`, avec `skills` et `resources`,
  puisque c'est là qu'ils vivent depuis la migration U-2.
- **v3** (lot V-3) — le **conteneur** change : le fichier devient un `.zip`.
  `manifest.json` porte tout l'état sauf les octets binaires, qui vivent chacun
  dans un membre `resources/<id>`. **Plus de base64 nulle part**, ni à l'export
  ni à l'import. Le contenu du manifeste est par ailleurs identique à un
  payload v2, `idb.resources[]` mis à part.

| Version | Lot | Conteneur | Conversations & résumés | Ressources binaires | Écriture | Lecture |
|---------|-----|-----------|--------------------------|---------------------|----------|---------|
| **v1** | pré-U | `.json` nu | sous `localStorage` (résumés = objet indexé `{id: entry}`) | base64 dans `idb.resources[].data` | non | **oui** |
| **v2** | U-4 | `.json` nu | sous `idb` (résumés = tableau de records) | base64 dans `idb.resources[].data` | non | **oui** |
| **v3** | **V-3** | **`.zip`** | sous `idb`, dans `manifest.json` | **octets bruts**, un membre `resources/<id>` par record | **oui** | **oui** |

**Pourquoi le zip multi-membres et pas un `.json` simplement compressé.** Le
base64 n'était pas qu'un surcoût de 33 % : à l'instant du `JSON.stringify`
coexistaient en RAM les `ArrayBuffer` d'origine, **toutes** les strings base64,
et la string JSON finale qui les recontient — sur 40 Mo de binaires, ~148 Mo.
Et `JSON.stringify` produisait une string **unique**, dont l'échec est brutal
et survient au pire moment : quand l'utilisateur essaie de sauvegarder.
Enrober le même monolithe dans un zip aurait laissé ce mode de défaillance
intact et n'aurait acheté qu'un gain de taille de fichier — or ce n'était pas
le problème.

**Le pic n'est pas éliminé, il est divisé.** `zipSync` construit sa sortie en
mémoire : les `ArrayBuffer` d'origine et le buffer de sortie coexistent, soit
~78 Mo contre ~148. C'est ~2× mieux et, surtout, la string géante disparaît.
fflate expose bien une API streaming (`Zip`, `ZipDeflate`), qui descendrait à
~40 Mo — **écartée en V-3** (décision Julien) : une API à callbacks et une
agrégation manuelle de chunks sur un chemin destructif-adjacent, pour un gain
marginal face à celui déjà acquis. Le format s'y prête déjà si un profil réel le
demande, **sans nouvelle version** : les membres sont séparés.

**Le conteneur se reconnaît aux octets, pas à l'extension.**
`sniffBackupFormat` (utils.js, pur) teste la signature d'en-tête local
`PK\x03\x04` et dégrade **systématiquement** vers `'json'` — buffer trop court,
vide, `null`, signature partielle : jamais d'exception. Le chemin JSON est le
chemin historique, y retomber rend la même erreur qu'avant V-3. Le sniff dit
« ça ressemble à » ; c'est `parseZipCentralDirectory` (V-1) qui dit « c'en est
un ». Corollaire : un `.zip` contenant un manifeste `version: 2` serait
techniquement lisible — **ni interdit, ni produit** : la tolérance ne coûte
rien, et refuser demanderait une règle croisée conteneur↔version que rien ne
justifie.

L'écriture est **toujours à la version courante** (`EXPORT_FORMAT_VERSION`) ; la
lecture accepte **toutes les versions ≤ celle-ci**. Un fichier de version
supérieure est refusé avec un message, sans rien détruire.

> **Importer un fichier v1 EST une migration.** C'est, depuis U-2, le seul
> chemin de migration qui reste dans l'application — et il n'est déclenché par
> aucun boot, seulement par un fichier. Un scénario de test qui part d'une base
> vierge ne l'exerce donc jamais : c'est exactement l'angle mort qui a laissé
> passer trois bugs U-1 (cf. campagne, lot U). `verify-conv-export-import.mjs`
> importe ses fichiers v1 sur une base **déjà peuplée**, pour que le
> remplacement intégral ait quelque chose à remplacer.

**L'export était cassé en silence entre U-2 et U-4** : `EXPORT_KEYS` contenait
encore les deux clés purgées, `JSON.parse(null)` rendait `null`, normalisé en
vide par `buildExportPayload`. Le fichier produit était parfaitement valide et
vide de tout l'historique — aucune exception, aucun log. À garder en tête comme
forme de panne : une clé retirée d'un support ne fait pas échouer son lecteur,
elle le fait rendre du vide.

### Format

En v3, le fichier est une archive dont **`manifest.json` est obligatoire**, à la
racine et sous ce nom exact (absent ⇒ refus actionnable) :

```
miaou-export-2026-08-28-1432.zip
├── manifest.json          ← tout l'état sauf les octets binaires
├── resources/res_k3j9x2   ← octets BRUTS d'une ressource, un membre par record
├── resources/att_9zc4v0
└── resources/file_2n6h8s
```

Le manifeste, identique à un payload v2 **sauf** `idb.resources[]`, où `data`
est remplacé par `member` :

```json
{
  "format": "miaou-export",
  "version": 3,
  "exportedAt": 1751600000000,
  "localStorage": {
    "miaou-settings": { "…": "…" },
    "miaou-memories": [ "…" ],
    "miaou-api-servers": [ "…" ],
    "miaou-active-api-server": "srv_…",
    "miaou-mcp-servers": [ "…" ],
    "miaou-spaces": [ "…" ],
    "miaou-active-space": "sp_…"
  },
  "idb": {
    "skills": [ { "slug": "…", "name": "…", "description": "…", "enabled": true, "content": "…", "autotrigger": false } ],
    "resources": [ { "id": "res_…", "conversationId": "…", "class": "…", "mime": "…", "name": "…", "size": 0, "createdAt": 0, "member": "resources/res_…", "originUrl": null } ],
    "conversations": [ { "id": "…", "title": "…", "timestamp": 0, "updatedAt": 0, "spaceId": "…", "messages": [ "…" ] } ],
    "summaries": [ { "id": "…", "summary": "…", "keywords": [ "…" ], "messageCount": 0 } ]
  }
}
```

- Les valeurs `localStorage` sont les objets **désérialisés** (pas de strings
  JSON imbriquées) — sauf `miaou-active-api-server` et `miaou-active-space`,
  seules clés du schéma qui ne sont **pas** stockées en JSON (strings brutes,
  id du serveur / du Space actifs).
- **Les résumés changent de forme entre v1 et v2** : v1 porte l'objet indexé
  `{ id: entry }` de l'ancienne clé localStorage, v2 un **tableau de records**
  à `keyPath: 'id'` (la forme du store). La conversion est faite par
  `normalizeLegacySummaryMap`, **la même fonction** que la migration de boot
  U-2 — une seule formule pour les deux chemins, jamais un second convertisseur
  écrit sur place.
- **`resources[].data` selon la version.** En v1/v2, l'`ArrayBuffer` du store
  devient une string base64 à l'export (`arrayBufferToBase64`, resources.js) et
  repasse en `ArrayBuffer` à l'import (`base64ToArrayBuffer`). En **v3**, il n'y
  a plus de `data` dans le manifeste du tout : les octets bruts vivent dans le
  membre désigné par `member`. À l'import, `resourceDataShape` (pur) tranche
  entre les deux formes — c'est LE point unique, jumeau
  d'`extractImportedConvRecords` pour la forme des octets.
- **Champ `member` — contrat.** Dérivé de l'`id`, **jamais** du `name` : c'est
  un IDENTIFIANT, lui seul rattache les octets à leur entrée de manifeste, et
  s'il ne fait pas l'aller-retour à travers `zipSync`/`parseZipCentralDirectory`
  la ressource devient **inatteignable** à l'import (mode de défaillance des
  noms non-UTF-8 payé en clôture V-1). L'`id` est unique par construction
  (suffixe aléatoire) et en ASCII imprimable ; `rec.name` est rédigé par
  l'utilisateur ou le modèle, unicode arbitraire, et collisionne régulièrement.
  Aucune déduplication n'est donc nécessaire, contrairement à
  `buildZipMemberName` (V-2). C'est un **détail de transport** : retiré avant le
  `putResource`, il n'atteint jamais le store — la garde est doublée
  (`readBackupFromZip` **et** `applyImportedData`), parce que les deux fonctions
  composent.
- **Un membre `resources/<id>` manquant n'est pas un refus.** La ressource est
  importée avec des octets **vides** et le fait est **signalé dans le
  récapitulatif de confirmation**, donc **avant** le clic d'application
  (`counts.missingResourceData`, ligne `.import-summary-warn`). Une sauvegarde
  partiellement abîmée doit rendre ce qui est récupérable : refuser en bloc
  ferait perdre conversations, souvenirs et réglages pour un binaire manquant.
  Le compte voyage sous la clé transitoire `_missingResourceData`, posée par
  `readBackupFromZip` — elle naît du **réassemblage**, jamais du fichier, d'où
  le souligné qui la distingue d'une section de manifeste.
- Un record **sans octets** (`data` absent) n'a **pas** de `member` : cas
  licite, traité sans exception.
- **Posture assumée (clefs en clair)** : les clefs API (`miaou-api-servers[].key`)
  et tokens MCP (`miaou-mcp-servers[].authorization_token`) sont exportés **tels
  quels, en clair**, même posture non-prod que leur stockage (cf. D6, plus haut
  dans ce document). Le hint UI de la catégorie « Données » du settings drawer
  le rappelle explicitement avant l'export.
  **Le passage au `.zip` rend ce rappel plus nécessaire, pas moins** : une
  archive *paraît* plus opaque qu'un JSON alors qu'elle ne protège rien —
  **compresser n'est pas chiffrer**, et n'importe quel outil ouvre
  `manifest.json`. Le hint a été renforcé en ce sens au lot V-3 ; ne pas le
  raccourcir.

### Helpers purs (storage.js, QuickJS-testables)

- `EXPORT_FORMAT_VERSION` (= **3**) : version écrite, et borne haute acceptée en
  lecture. Un seul chiffre pour les deux, jamais un littéral dupliqué.
- `EXPORT_KEYS` : les **7** clés localStorage du schéma (référencée uniquement
  en corps de fonction depuis les autres fichiers, même contrainte que
  `MAX_SUMMARIES` — cf. CLAUDE.md). `miaou-conversations` et `miaou-summaries`
  en ont été **retirées** au lot U-4.
- `buildExportPayload(lsSnapshot, skills, resources, conversations, summaries)`
  → objet complet ci-dessus. Reste **pure** : l'appelant lit IDB et lui passe
  les tableaux, comme il le faisait déjà pour `skills`/`resources`. Sections
  manquantes → défauts vides (tableau ou objet selon la clé), jamais
  d'exception.
- `sniffBackupFormat(u8)` → `'zip' | 'json'` (**utils.js**, pas storage.js : il
  vit avec les autres primitives zip du lot V). Reconnaît le conteneur aux
  octets, dégrade systématiquement vers `'json'`, jamais d'exception.
- `resourceDataShape(data)` → `'base64' | 'bytes' | 'absent'`. **LE point unique
  où la forme des octets est traitée** (base64 v1/v2 vs octets bruts v3), jumeau
  d'`extractImportedConvRecords` : tout le reste de l'import ignore la
  compression — ne pas réintroduire un second test de forme ailleurs. Une string
  **vide** rend `'base64'` et non `'absent'` : un binaire de zéro octet est
  légitime, `base64ToArrayBuffer('')` rend un buffer vide, et les distinguer
  évite un cas particulier chez l'appelant.
- `buildResourceMemberIndex(resources)` → `{ entries, members, skipped }`.
  Sépare métadonnées (pour le manifeste, `data` retiré, `member` ajouté) et
  octets (pour les membres du zip). Ne mute pas les records d'origine. Un record
  **sans `id`** est écarté et **compté** (`skipped`), jamais passé sans membre :
  `id` est le keyPath du store, un tel record ne pourrait pas être réimporté.
- `extractImportedConvRecords(payload)` → `{ conversations, summaries }`, sous
  la forme des records IDB attendus par l'import. **C'est LE point unique où la
  différence v1/v2/v3 est traitée** : tout le reste de l'import ignore la version
  du fichier. Les records sans `id` sont écartés (`id` est le keyPath, le `put`
  jetterait). Une section a **autorité pour sa version** : un v2 dont `idb` est
  vide n'est pas complété depuis `localStorage` (un export v2 légitime peut
  n'avoir aucune conversation), et un v1 ignore une section `idb` qui traînerait.
- `normalizeLegacySummaryMap(obj)` → conversion de forme seule, à partir d'un
  objet **déjà parsé** : `{ id: entry }` → tableau de records portant leur `id`
  (réaffirmé depuis la clé, qui fait foi). `null` sur un objet indexé
  inexploitable — traité comme « présent mais illisible », jamais comme vide.
  Deux appelants délibérés : `parseLegacySummaries` (migration U-2) et
  `extractImportedConvRecords` (import v1).
- `validateImportPayload(obj)` → `{ ok: true, counts: { conversations,
  summaries, memories, skills, resources, servers, spaces,
  missingResourceData } }` (compteurs bruts pour le récapitulatif UI, `servers`
  = api-servers + mcp-servers ; `missingResourceData` = ressources dont le
  membre d'archive manquait, remonté depuis `_missingResourceData`, normalisé à
  0 si absent ou non numérique) ou
  `{ ok: false, error }`. Bloquant : `format !== 'miaou-export'`, `version`
  absente/non-numérique/`> EXPORT_FORMAT_VERSION`. Tolérant : sections
  `localStorage`/`idb` manquantes ou de type invalide → comptées comme vides,
  pas une erreur (le format peut évoluer entre deux versions de MIAOU).
  Conversations et résumés sont comptés **via `extractImportedConvRecords`**,
  celui-là même que l'import appliquera : un décompte qui divergerait de ce qui
  est réellement écrit ferait mentir le récapitulatif de confirmation.

### IDB

`getAllResources()` (resources.js) lit tout le store `resources`, sur le
modèle de `getAllSkillRecords()` (skills.js). `clearIdbStore(storeName)`
(resources.js) vide un store par son nom (générique) — utilisé par l'import
avant réinsertion complète, sur les quatre stores.

Côté conversations (storage.js) :

- `readAllConversationsFromDB()` — toutes les conversations **complètes**, hors
  cache. C'est le lecteur de l'export : `loadConversations()` servirait le
  cache, où une conversation froide sort avec `messages: []` (contrat de
  l'étage 2, U-1) — l'export y perdrait tout le contenu sauf celui des quelques
  conversations chaudes.
- `readAllSummariesFromDB()` — tous les records du store `summaries`, hors
  cache. Deux appelants : la relecture de synchro (`refreshSummariesFromDB`) et
  l'export, qui doit écrire ce qui est **en base** et non l'index RAM de cet
  onglet.
- `replaceConvRecordsFromImport(conversations, summaries)` — réinsertion en
  masse, les deux stores dans **une seule transaction**, comme la migration
  U-2 et pour la même raison : un état partiellement importé est inatteignable
  par interruption. Contrairement au reste des écritures du fichier, la
  promesse est **attendue** par l'appelant — un échec ne doit pas être masqué
  par le reload. Aucune mutation de cache (le reload le réhydrate) et aucun
  broadcast (`applyImportedData` émet un `full-reload` unique, plutôt qu'une
  grêle de `conv-updated`).

### Orchestration (main.js)

- `exportAllData()` : snapshot des 7 clés (`miaou-active-api-server` et
  `miaou-active-space` lues en string brute, les 5 autres en `JSON.parse`),
  lecture IDB (`getAllSkillRecords` + `getAllResources` +
  `readAllConversationsFromDB` + `readAllSummariesFromDB`), séparation
  métadonnées/octets par `buildResourceMemberIndex`, `ensureFflate()` puis
  `zipSync` et `downloadFile('miaou-export-<YYYY-MM-DD-HHmm>.zip', …)`.
  `downloadFile` accepte l'`Uint8Array` tel quel (`new Blob([content])`,
  `BlobPart` accepte un `BufferSource`) — rien à y modifier.
  **`exportAllData` n'avait aucun chemin d'erreur avant V-3** : tout y était
  synchrone-après-await. `ensureFflate` peut légitimement échouer (CDN
  indisponible, hors-ligne), d'où `showExportDataError` (ui.js, jumeau de
  `showImportDataError`, zone `#export-data-err`). **Pas de repli silencieux**
  vers le `.json` non compressé (décision Julien) : il produirait un fichier
  différent de ce que l'utilisateur croit avoir — extension, format, taille —
  sans le dire. Un bouton muet sur l'assurance-vie de l'application est le pire
  silence possible ; un message honnête vaut mieux qu'un fichier trompeur.
- `readBackupFromZip(u8)` (main.js, impur) : `parseZipCentralDirectory` →
  `decideZipMemberExtraction('manifest.json')` (le prédicat de refus est
  **unique**, jamais un second test d'`entry.encrypted` écrit à la main — un
  membre chiffré serait extrait par fflate **sans erreur**, en rendant du bruit
  binaire dont le `JSON.parse` dirait « JSON invalide », message qui envoie
  chercher au mauvais endroit) → `ensureFflate` → `unzipSync` → manifeste →
  **réassemblage**. L'ordre compte : réassembler **puis** valider, sinon le
  décompte de `validateImportPayload` mentirait au récapitulatif. Contrairement
  à `docs__extract` (V-1), on décompresse **tout** : manifeste et ressources
  sont tous nécessaires, le filtre sélectif n'a pas d'objet.
- `onImportDataClick()` / `onImportFileSelected(input)` : ouvrent un
  `<input type="file" accept=".zip,.json" hidden>`, lisent via `FileReader` en
  **`readAsArrayBuffer`** (le conteneur se reconnaît aux octets), aiguillent sur
  `sniffBackupFormat`, puis `validateImportPayload`. Le chemin JSON reste
  **strictement inchangé dans son comportement** — v1 et v2 non compressés
  doivent continuer de passer. Erreur → message inline sous les boutons
  (`showImportDataError`, registre hint/`showCardError`, jamais d'`alert`).
  Payload valide → récapitulatif des compteurs + bouton d'application passé par
  `armThenRun` (remplacement intégral = destructif, même pattern « armer puis
  confirmer » que les suppressions).
  **Jeton de séquence `_importSeq`** (motif `_openConvSeq`, piège 24b) : le
  chemin d'import est devenu **asynchrone** en V-3 (`ensureFflate` +
  décompression), et l'utilisateur peut sélectionner un second fichier pendant.
  Deux récapitulatifs se disputeraient `#import-data-summary`, et le bouton armé
  pourrait appliquer le **premier** payload alors que l'écran affiche le second
  — sur un chemin destructif. Le jeton est relu **après** l'`await`, jamais figé
  avant. Ce risque n'existait pas avant V-3 : `readAsText` + `JSON.parse` sont
  synchrones après le `onload`. `reader.onload` étant devenu `async`, le
  `try/catch` autour de `readBackupFromZip` est **obligatoire** — un `throw` non
  capturé y partirait en rejet silencieux et l'interface resterait muette.
- `applyImportedData(payload)` : écrit les 7 clés localStorage (clé **absente**
  du fichier → `removeItem`, pour ne pas laisser d'état résiduel incohérent
  mélangeant deux exports), vide puis réinsère les **quatre** stores IDB
  (`skills`, `resources`, `conversations`, `summaries`), puis
  `location.reload()` — l'état de session (caches, thread courant, statut MCP)
  se reconstruit proprement au boot, aucune resynchronisation manuelle à
  écrire. C'est aussi ce reload qui rend le cache RAM des conversations (U-1)
  cohérent : il est réhydraté depuis les stores fraîchement réécrits, sans
  qu'aucune invalidation ait à être posée à la main.
  **Les deux clés héritées ne sont jamais réécrites en localStorage**, même à
  l'import d'un fichier v1 : elles ré-armeraient la migration de boot (dont le
  court-circuit teste l'absence des clés), qui les reprendrait au tour suivant.
  Ça fonctionnerait par ricochet ; on ne s'appuie pas dessus, l'import fait
  lui-même le routage vers IDB.
  Le **conteneur** a déjà été absorbé en amont : ce qui arrive ici est un
  payload de forme uniforme, `resources[].data` mis à part, que
  `resourceDataShape` tranche en un point unique. Le champ `member` est retiré
  avant le `putResource`.

## État des lieux du stockage (drawer Paramètres › Données)

Bloc informatif en tête de la catégorie **Données**, au-dessus de
l'export/import : un avertissement sur la volatilité du stockage navigateur, et
une pesée de ce qui est occupé. Une entrée de renvoi le signale aussi depuis la
catégorie **Mémoire** (c'est de là que la demande est partie), sans dupliquer
les chiffres — un seul point d'affichage.

### Un seul chiffre d'occupation : la mesure interne

L'occupation affichée est **mesurée par MIAOU** (somme exacte, ventilable par
catégorie). De `navigator.storage.estimate()` on ne retient que **`quota`**.

🚨 **Ne pas rétablir `estimate().usage` comme chiffre principal** — régression
payée le 2026-08-26. La première version affichait `usage` en ligne principale
au-dessus du détail mesuré, en documentant que le détail serait « nécessairement
plus bas » (index, sérialisation, fragmentation). **C'était faux, et dans les
deux sens** : c'est le chiffre du navigateur qui est approximatif, la somme
interne qui est exacte. Constaté sur deux bases réelles — 44,2 Mo mesurés
affichés sous un total de 30,4 Mo, et 179 Mo sous 34 Mo : un rapport dont le
détail dépasse visiblement le total.

Diagnostic (sonde d'1 Mo écrite puis relue) :

| Mesure | Valeur |
| --- | --- |
| `size` déclaré (somme) | 44,2 Mo |
| octets `data` réellement présents | 44,2 Mo |
| records sans `data` / `size` ≠ réel | 0 / 0 |
| `estimate().usage` | 30,4 Mo |
| `usage` après écriture de +1 Mo | **delta 0,0 Mo** |
| `navigator.storage.persisted()` | `false` |

`size` est donc fiable (et il n'y avait **aucun record orphelin**) : c'est
`usage` qui plafonne. Cette valeur est délibérément **quantifiée** par le
navigateur (anti-fingerprinting) et l'est davantage sur un stockage
*best-effort*. Un chiffre qui ne bouge pas d'un octet après l'écriture d'1 Mo ne
mesure pas ce qu'on croit.

Corollaire : `percent` se calcule sur `measured` rapporté à `quota`. Il minore
légèrement l'occupation réelle de l'origine (index, surcharge de sérialisation,
caches hors MIAOU non comptés) — assumé, et sans commune mesure avec l'erreur
d'`usage`.

Si `estimate()` est indisponible (navigateur ancien, contexte non sécurisé),
`quota` et `percent` valent `null` et la ligne principale affiche `measured`
seul. `collectStorageReport` continue d'appeler `estimate()` **pour son quota** :
l'appel n'est pas superflu, ne pas le retirer.

### Éviction best-effort

`navigator.storage.persisted()` vaut `false` en usage réel : le stockage est en
mode *best-effort*, que le navigateur s'autorise à évincer sous pression disque.
`requestPersistence()` (resources.js) demande le mode persistant à chaque
écriture de ressource ; l'octroi dépend de critères propres au navigateur
(engagement utilisateur, installation PWA, favori) et le refus est silencieux.

Décision : **rien dans l'UI**, une phrase dans `src/help.md` (topic `donnees`).
L'utilisateur n'a pas de levier direct dessus, le risque est faible, et une
ligne d'état dans le rapport inquiéterait sans action possible. Ne pas
transformer ce constat en alerte visuelle sans nouvelle décision.

### Découpage des fonctions (storage.js)

| Fonction | Nature | Rôle |
| --- | --- | --- |
| `utf8ByteLength(str)` | pure | Poids en octets **UTF-8** (pas UTF-16) — cohérent avec la façon dont IDB et le navigateur comptent. Gère les paires de substitution (un emoji hors BMP = 4 octets, pas 6). |
| `recordByteLength(rec)` | pure | Poids JSON d'un enregistrement structuré. Approximation du *structured clone* d'IDB, pas une mesure exacte. Rend `0` plutôt que de lever (structure circulaire). |
| `sumRecordBytes(records)` | pure | Somme sur un lot. |
| `buildStorageReport(parts, estimate)` | pure | Assemble le rapport final (`detail`, `measured`, `quota`, `percent`). Ne lit d'`estimate` que son `quota`. Toute l'arithmétique à risque est ici, donc testée. |
| `measureLocalStorageBytes()` | impure | Somme des clefs `miaou-*` (clef **et** valeur pèsent), **hors** `CONV_KEY`/`SUMMARIES_KEY` — reliquats non purgés de l'avant-lot U, à ne pas compter deux fois. |
| `measureResourcesBytes()` | impure | Store `resources`, **au curseur**. |
| `measureSkillsBytes()` | impure | Store `skills`, via `getAll` (volume borné). |
| `collectStorageReport()` | impure | Point d'entrée unique. **Ne rejette jamais** : chaque mesure est gardée individuellement, une source indisponible dégrade l'affichage sans le casser. |

### Coût et curseur

La mesure relit conversations, résumés et ressources — elle n'est déclenchée
qu'à **l'ouverture du drawer**, jamais en fond. Le parcours des ressources se
fait **au curseur** (`openCursor`, un record à la fois, GC-able) et non via
`getAll()`, qui matérialiserait tous les binaires en RAM d'un coup : c'est
exactement ce que le cache à deux étages des conversations (U-1) s'emploie à
éviter. Le poids d'une ressource est lu dans son champ `size` (figé à
l'écriture), pas recalculé depuis les octets.

### Rendu (ui.js)

`refreshStorageReport()` est appelée par `openSettings()` et porte un **jeton de
séquence** (`_storageReportSeq`) : un drawer refermé puis rouvert pendant la
mesure fait abandonner le rendu devenu obsolète — même discipline que
`_openConvSeq` (piège 24, relire l'état après l'`await`). `renderStorageReport()`
ne construit que du texte d'origine locale, passé à `escHtml` ; les libellés
vivent dans `STORAGE_REPORT_LABELS`.
