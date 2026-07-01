# Stockage (localStorage / IndexedDB)

- `miaou-settings` : `{ url, key, model, systemPrompt, highlight, summaryInjectionMode,
  theme, showModelSelector, sidebarWidth, includeToolsInSystemPrompt, saveJsonResponses,
  intentTracing, confirmSkillAutoUse }`.
  `summaryInjectionMode` ∈ `auto | propose | never`, défaut `propose`. `model` est
  le **modèle par défaut** (global). `showModelSelector` (défaut `false`) n'affecte
  que la visibilité du sélecteur dans le composer. `sidebarWidth` (défaut `264`) est
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
  pinned? }]`. `updatedAt` (optionnel) est le timestamp du dernier `persistCurrent` ;
  absent sur les anciennes conversations (tri/affichage tombent alors sur `timestamp`).
  `model` (optionnel) est l'**override de modèle de la conversation**
  — à ne **jamais** confondre avec le champ `model` de chaque message assistant
  (quel modèle a produit *cette* réponse, cf. backfill modèle). `pinned`
  (optionnel, bool) épingle la conversation : `renderConvList()` regroupe les
  épinglées dans une section **Épinglé** (singulier assumé) en tête de liste,
  retirées de leur tranche temporelle ; toggle via `toggleConversationPin(id)`
  (storage) exposé par le handler global `togglePin(id)` (main.js).
  Chaque message du tableau `messages` porte les champs optionnels :
  `model?` (assistant uniquement, quel modèle a produit ce message),
  `ts?` (epoch ms de création, absent sur les anciens messages — affichage sans
  horodatage, pas de crash), `reasoning?` (texte de raisonnement, assistant
  uniquement). Ces trois champs sont **sérialisés par `persistCurrent` et
  restaurés par `openConversation`** — ne pas les omettre si on retouche ces
  fonctions.
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
