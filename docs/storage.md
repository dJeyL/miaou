# Stockage (localStorage / IndexedDB)

- `miaou-settings` : `{ url, key, model, systemPrompt, highlight, summaryInjectionMode,
  theme, showModelSelector, reasoningEffort, showReasoningSelector, sidebarWidth,
  includeToolsInSystemPrompt, saveJsonResponses, intentTracing, confirmSkillAutoUse }`.
  `url`/`key`/`model` sont **legacy** : depuis l'introduction des serveurs API
  multiples (`miaou-api-servers` ci-dessous), ils ne sont plus édités nulle
  part dans l'UI — `onSaveSettings()` ne les écrit plus. Ils ne servent qu'à
  la migration silencieuse (une fois) et de filet dans `activeModel()` si
  jamais aucun serveur n'existe encore.
  `summaryInjectionMode` ∈ `auto | propose | never`, défaut `propose`. `model` est
  le **modèle par défaut** (global). `showModelSelector` (défaut `false`) n'affecte
  que la visibilité du sélecteur dans le composer. `reasoningEffort` (défaut `''`)
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
  `includeToolsInSystemPrompt` (défaut `false`) contrôle uniquement l'injection de
  `toolsSystemPrompt()` — la description textuelle redondante des outils. `ROOT_SYSTEM_PROMPT`
  (doctrines binaire et mémoire) est **toujours** injecté dès que des outils sont présents,
  indépendamment de ce toggle. À activer pour les modèles qui lisent mal leur tool schema
  natif. `buildSystemMessage()` (main.js) conditionne l'appel ; `tools.js` reste agnostique
  du réglage.
- `miaou-conversations` : tableau `[{ id, title, timestamp, updatedAt?, messages, model?,
  reasoningEffort?, pinned? }]`. `updatedAt` (optionnel) est le timestamp du dernier
  `persistCurrent` ; absent sur les anciennes conversations (tri/affichage tombent
  alors sur `timestamp`). `model` (optionnel) est l'**override de modèle de la
  conversation** — à ne **jamais** confondre avec le champ `model` de chaque
  message assistant (quel modèle a produit *cette* réponse, cf. backfill modèle).
  `reasoningEffort` (optionnel) est l'**override de niveau de raisonnement de la
  conversation**, même statut que `model` (résolu par `activeReasoningEffort()`).
  `pinned`
  (optionnel, bool) épingle la conversation : `renderConvList()` regroupe les
  épinglées dans une section **Épinglé** (singulier assumé) en tête de liste,
  retirées de leur tranche temporelle ; toggle via `toggleConversationPin(id)`
  (storage) exposé par le handler global `togglePin(id)` (main.js).
  Chaque message du tableau `messages` porte les champs optionnels :
  `model?` (assistant uniquement, quel modèle a produit ce message),
  `server?` (assistant uniquement, nom du serveur API qui a produit ce
  message ; absent sur les messages antérieurs au multi-serveurs — pas de
  backfill possible, la provenance est inconnue), `ts?` (epoch ms de création,
  absent sur les anciens messages — affichage sans
  horodatage, pas de crash), `reasoning?` (texte de raisonnement, assistant
  uniquement). Ces quatre champs sont **sérialisés par `persistCurrent` et
  restaurés par `openConversation`** — ne pas les omettre si on retouche ces
  fonctions. À l'affichage (`assistantHead`, ui.js), la provenance est rendue
  « serveur › modèle » (séparateur `.tool-name-sep` coloré) **uniquement si
  plusieurs serveurs API sont configurés** ; sinon, modèle seul. `server`
  n'atteint jamais le payload API (`expandThread` projette en `{role, content}`).
- `miaou-summaries` : objet indexé par id de conversation. Trois états : résumé
  présent / tombstone (`suppressed: true`) / absent (candidat au backfill).
- `miaou-memories` : tableau `[{ id, content, created_at, updated_at, suppressed }]`.
  **Deux chemins d'écriture distincts** : édition directe utilisateur →
  `editMemory(id, newContent)` (in-place) ; écriture par le modèle →
  `create_memory` / `update_memory` (in-place) /
  `delete_memory` (tombstone). `listMemoryEntries()` renvoie uniquement les
  non-supprimées. `forgetMemory(id)` supprime définitivement l'entrée du tableau.
- `miaou-mcp-servers` : tableau de backends MCP distants `[{ name, url, transport,
  enabled, authorization_token, timeout, toolAllowlist, toolDenylist, showCalls }]`
  (cf. `docs/mcp.md`). `name` est l'identité **et** le
  préfixe d'outil (unique, charset `[A-Za-z0-9_-]`, pas de `__`, `miaou` interdit).
  `authorization_token` est stocké **en clair** (posture assumée non-prod).
  `showCalls` (booléen, défaut `true`) contrôle l'affichage des lignes d'appel
  `mcp_call` dans le thread : `false` masque le rendu DOM mais **conserve les acks
  dans l'historique** — toggle de rendu pur, sans effet sur le payload modèle. CRUD
  dans `storage.js` (`loadMcpServers`/`upsertMcpServer`/`deleteMcpServer`/
  `getMcpServer`/`listEnabledMcpServers`). **Aucun état de session/outils distants
  n'est persisté** ici : le cache (`_remoteTools`/`_remoteStatus`, tools.js) est en
  mémoire seule, reconstruit au démarrage.
- `miaou-api-servers` : tableau de backends API (chat completions) `[{ id, name,
  url, key, model }]`. Remplace les champs plats `url`/`key`/`model` de
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
  serveur.
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
- **IndexedDB `miaou`** (ouverte par `resources.js`, **version 2**) : deux object
  stores. `onupgradeneeded` est idempotent (contains-check par store) → migration
  v1→v2 transparente, `resources` intact.
  - store `skills` (keyPath `slug`, géré par `skills.js`) : voir `docs/skills.md`.
  - store `resources`, index `by_conversation`. Chaque entrée :
  `{ id, conversationId, class, mime, name, size, data (ArrayBuffer), createdAt }`.
  `class` ∈ `"inline"` (texte/JSON, passé en clair au modèle — `entry.result` de
  l'ack contient le texte brut) | `"binary"` (données opaques — `entry.result` de
  l'ack contient `[resource_ref:res_…]`, remplacé par un descripteur statique à
  l'envoi). Les données ne sont **jamais** dans `localStorage`. Cache session (`_resourceCache`)
  en mémoire : peuplé par `loadConversationResources` (fire-and-forget à
  `openConversation`) et par `_storeBlock` (au stockage). Suppression en cascade
  par conversation via `deleteResourcesByConversation` (appelé dans `deleteConv`,
  main.js). `requestPersistence()` sollicite `navigator.storage.persist()` au
  premier stockage (silencieux si refusé).
