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
  `ROOT_SYSTEM_PROMPT` (doctrines binaire et mémoire) est **toujours** injecté
  dès que des outils sont présents.
- `miaou-conversations` : tableau `[{ id, title, timestamp, updatedAt?, messages, model?,
  reasoningEffort?, pinned?, spaceId? }]`. `spaceId` (feature Spaces, lot C) :
  id du Space propriétaire ; absent = `DEFAULT_SPACE_ID` (`listAllConversations()`
  l'expose toujours résolu dans sa projection, jamais `undefined`). Backfillé par
  `migrateSpacesIfNeeded()` sur toute conversation antérieure à la feature. `updatedAt` (optionnel) est le timestamp du dernier
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
  `attSeq?` (optionnel, entier) : compteur monotone d'attId (pièces jointes,
  brief A) de la conversation — **jamais décrémenté ni réinitialisé**, y
  compris après troncature du thread par édition d'un message (`editUserMessage`) :
  un `att-N` n'est jamais réattribué, même si les entrées IDB qu'il référençait
  redeviennent orphelines (piège 12, non-goal assumé du brief A — GC différé
  à la suppression de la conversation entière). Alloué par `allocateAttId(counter)`
  (resources.js, fonction pure) à chaque fichier attaché, persisté immédiatement
  par `persistAttSeq` (main.js), indépendamment de `persistCurrent`.
  Chaque message du tableau `messages` porte les champs optionnels :
  `model?` (assistant uniquement, quel modèle a produit ce message),
  `server?` (assistant uniquement, nom du serveur API qui a produit ce
  message ; absent sur les messages antérieurs au multi-serveurs — pas de
  backfill possible, la provenance est inconnue), `ts?` (epoch ms de création,
  absent sur les anciens messages — affichage sans
  horodatage, pas de crash), `reasoning?` (texte de raisonnement, assistant
  uniquement), `attachments?` (**user uniquement**, brief A/D1) : tableau
  `[{attId, name, mime, size, kind, w?, h?}]` — `attId` conversation-scopé
  (`att-1`, `att-2`, …, cf. `attSeq` ci-dessus), `kind ∈ {image, text, binary}`
  (`classifyAttachmentKind`, resources.js, fonction pure — mime `image/*` →
  `image`, extension d'une liste fermée ajustable `ATTACHMENT_TEXT_EXTENSIONS`
  → `text`, sinon `binary`), `w`/`h` (dimensions finales en pixels, **image
  uniquement**, figées à l'attache). Ces cinq champs sont
  **sérialisés par `persistCurrent` et restaurés par `openConversation`** — ne
  pas les omettre si on retouche ces fonctions.
  `openConversation` filtre les entrées falsy (`null`/`undefined`) de
  `messages` avant de les mapper (`.filter(Boolean)`) : une entrée corrompue
  plantait silencieusement tout le rechargement de la conversation (accès à
  `m.role` sur `null`), sans erreur visible à l'écran — juste un clic sidebar
  sans effet.

  **Forme de `content` d'un message user porteur d'un attachment `kind:'image'`
  (brief A lot 2, D2/D3 — envoi au modèle et politique de persistance)** :
  DEUX formes successives, jamais les deux en même temps en storage.
  - **Au tour d'attache** (juste après l'envoi, avant la réponse assistant) :
    `content` est un **tableau de content parts OpenAI**
    `[{type:'text',text:…},{type:'image_url',image_url:{url:'data:<mime>;base64,…'}}, …]`
    — une part `image_url` par attachment `kind:'image'` du message
    (`buildAttachedMessageContent`, resources.js). C'est la SEULE fenêtre où
    le base64 de l'image transite (réseau + ce message, transitoirement).
  - **Après la fin du tour** (réponse normale, tour avorté, ou halte
    `ask_confirmation` — cf. piège 17, CLAUDE.md) : `rewriteAttachedUserMessage`
    (main.js) réécrit `content` en **string** = les parts texte concaténées +
    une ligne de descripteur byte-stable **par image jointe**
    (`formatAttachmentDescriptor`, resources.js) :
    ```
    [attachment att-3: image "diagram.png", 1280x960, 214 kB — content available via miaou__recall_attachment]
    ```
    C'est la forme **persistée durablement**, celle qu'on retrouve dans
    `localStorage['miaou-conversations']` pour toute conversation rouverte
    après le premier tour — zéro base64 résiduel. Descripteur dérivé des
    champs figés `name`/`w`/`h`/`size` de `message.attachments[]` (jamais
    recalculé). Réécriture idempotente (no-op si `content` est déjà une
    string) : peut être rejouée sans effet.
  - Un attachment `kind:'text'` (D3) ne suit PAS ce cycle : son bloc fencé
    avec en-tête nom de fichier (`formatTextAttachmentBlock`) est injecté au
    tour d'attache et reste **tel quel** dans `content` pour toujours (pas de
    descripteur, pas de réécriture — texte cheap, stabilité dès le 1ᵉʳ tour).
  - `message.attachments[]` (schéma D1 ci-dessus) ne change jamais : seule la
    représentation de `content` évolue selon la phase.
  - **`displayText` est posé dès l'envoi** (sendUserText, main.js) sur tout
    message porteur d'attachments dont le `content` final diverge du littéral
    tapé — c'est le cas pour toute image (parts, puis descripteurs) et tout
    fichier texte (bloc fencé persisté) ; pas pour un attachment `binary`
    seul, où `content` reste le littéral. Doctrine displayText (invariant
    n°1) : la bulle et la textarea d'édition sourcent TOUJOURS le littéral,
    jamais les descripteurs ni le contenu fencé injecté. Même mécanisme que
    les slash-skills — les deux causes se cumulent (message `/skill …` +
    pièce jointe : displayText = littéral tapé, content = corps bakée + blocs
    + parts).

  À l'affichage (`assistantHead`, ui.js), la provenance est rendue
  « serveur › modèle » (séparateur `.inline-sep` coloré) **uniquement si
  plusieurs serveurs API sont configurés** ; sinon, modèle seul. `server`
  n'atteint jamais le payload API (`expandThread` projette en `{role, content}`).
  `truncated?` (bool, assistant uniquement, feature C) : posé à `true` sur le
  `onFinal` de `dispatchSend` (main.js) pour une réponse **incomplète** —
  **absent** sinon, ce n'est pas un booléen toujours présent. Deux causes :
  `finish_reason === 'length'` (backend coupé à la limite de tokens), ou stop
  manuel (`runConversation` passe le sentinel `'aborted'` sur ce chemin —
  `null` reste réservé au cas « backend sans finish_reason », traité comme une
  fin normale) **à condition que du contenu ait été reçu** : stopper avant le
  premier token laisse une bulle vide sans flag (« Régénérer » suffit).
  Gouverne l'affichage du bandeau `.msg-truncated` (texte « Réponse
  incomplète » + bouton « Continuer », ui.js) sous `.body` de
  la bulle assistant : le **texte** persiste sur tout message qui porte le
  flag, quelle que soit sa position dans le fil ; le **bouton** n'est
  actif/visible que sur la dernière bulle assistant et hors stream (même
  helper `syncLastAssistantActions` que le bouton régénérer, feature B). Une
  continuation (`continueTruncated` → `dispatchSend(matches, continuation)`)
  **mute** le message existant (même `ts`, pas de nouveau message) : `content`
  devient `prefix + content`, `truncated` est **retiré** si la nouvelle
  réponse se termine normalement, et **reposé/conservé** si elle est
  re-tronquée (`'length'`, chaîne de continuations possible) ou de nouveau
  stoppée à la main (`'aborted'`) — le raccord partiel reste reprenable.
  Ce champ n'a pas besoin de backfill : sa
  seule source est `dispatchSend`, pas de conversation antérieure à combler.
- `miaou-summaries` : objet indexé par id de conversation. Trois états : résumé
  présent / tombstone (`suppressed: true`) / absent (candidat au backfill).
  **Invariant visé (pas garanti à 100% en historique)** : toute clé de cet
  objet correspond à un id présent dans `miaou-conversations`. `deleteConv`
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
  url, key, model, vision }]`. Remplace les champs plats `url`/`key`/`model` de
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
  filtre `c.spaceId === x` réécrit localement. Les résumés (`miaou-summaries`)
  ne portent **pas** de `spaceId` dupliqué : ils scopent via leur conversation
  (jointure sur l'id), cf. `docs/spaces.md` pour le détail des sites branchés.
- **IndexedDB `miaou`** (ouverte par `resources.js`, **version 3**) : deux object
  stores. `onupgradeneeded` est idempotent (contains-check par store/index) →
  migrations v1→v2→v3 transparentes, `resources` intact à chaque palier.
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

Assurance-vie : tout l'état de MIAOU (les 9 clés localStorage ci-dessus + les
deux stores IndexedDB `skills`/`resources`) tient dans un unique fichier JSON,
téléchargeable et réimportable. **Remplacement intégral à l'import, pas de
fusion** (décision actée pour la v1 — un import écrase tout l'état local).

### Format

```json
{
  "format": "miaou-export",
  "version": 1,
  "exportedAt": 1751600000000,
  "localStorage": {
    "miaou-settings": { "…": "…" },
    "miaou-conversations": [ "…" ],
    "miaou-summaries": { "…": "…" },
    "miaou-memories": [ "…" ],
    "miaou-api-servers": [ "…" ],
    "miaou-active-api-server": "srv_…",
    "miaou-mcp-servers": [ "…" ],
    "miaou-spaces": [ "…" ],
    "miaou-active-space": "sp_…"
  },
  "idb": {
    "skills": [ { "slug": "…", "name": "…", "description": "…", "enabled": true, "content": "…", "autotrigger": false } ],
    "resources": [ { "id": "res_…", "conversationId": "…", "class": "…", "mime": "…", "name": "…", "size": 0, "createdAt": 0, "data": "<base64>", "originUrl": null } ]
  }
}
```

- Les valeurs `localStorage` sont les objets **désérialisés** (pas de strings
  JSON imbriquées) — sauf `miaou-active-api-server` et `miaou-active-space`,
  seules clés du schéma qui ne sont **pas** stockées en JSON (strings brutes,
  id du serveur / du Space actifs).
- `resources[].data` (`ArrayBuffer` en IDB) devient une string base64 à
  l'export (`arrayBufferToBase64`, resources.js) et repasse en `ArrayBuffer` à
  l'import (`base64ToArrayBuffer`).
- **Posture assumée (clefs en clair)** : les clefs API (`miaou-api-servers[].key`)
  et tokens MCP (`miaou-mcp-servers[].authorization_token`) sont exportés **tels
  quels, en clair**, même posture non-prod que leur stockage (cf. D6, plus haut
  dans ce document). Le hint UI de la catégorie « Données » du settings drawer
  le rappelle explicitement avant l'export.

### Helpers purs (storage.js, QuickJS-testables)

- `EXPORT_KEYS` : les 9 clés du schéma (référencée uniquement en corps de
  fonction depuis les autres fichiers, même contrainte que `MAX_SUMMARIES` —
  cf. CLAUDE.md).
- `buildExportPayload(lsSnapshot, skills, resources)` → objet complet
  ci-dessus. Sections manquantes de `lsSnapshot` → défauts vides (tableau ou
  objet selon la clé), jamais d'exception.
- `validateImportPayload(obj)` → `{ ok: true, counts: { conversations,
  memories, skills, resources, servers, spaces } }` (compteurs bruts pour le
  récapitulatif UI, `servers` = api-servers + mcp-servers) ou
  `{ ok: false, error }`. Bloquant : `format !== 'miaou-export'`, `version`
  absente/non-numérique/`> 1`. Tolérant : sections `localStorage`/`idb`
  manquantes ou de type invalide → comptées comme vides, pas une erreur (le
  format peut évoluer entre deux versions de MIAOU).

### IDB

`getAllResources()` (resources.js) lit tout le store `resources`, sur le
modèle de `getAllSkillRecords()` (skills.js). `clearIdbStore(storeName)`
(resources.js) vide un store par son nom (générique skills/resources) — utilisé
par l'import avant réinsertion complète.

### Orchestration (main.js)

- `exportAllData()` : snapshot des 9 clés (`miaou-active-api-server` et
  `miaou-active-space` lues en string brute, les 7 autres en `JSON.parse`),
  lecture IDB (`getAllSkillRecords`
  + `getAllResources`), encodage base64 des `data` de ressources, puis
  `downloadFile('miaou-export-<YYYY-MM-DD-HHmm>.json', …)`.
- `onImportDataClick()` / `onImportFileSelected(input)` : ouvrent un
  `<input type="file" accept=".json" hidden>`, lisent via `FileReader`,
  `JSON.parse` puis `validateImportPayload`. Erreur → message inline sous les
  boutons (`showImportDataError`, registre hint/`showCardError`, jamais
  d'`alert`). Payload valide → récapitulatif des compteurs + bouton
  d'application passé par `armThenRun` (remplacement intégral = destructif,
  même pattern « armer puis confirmer » que les suppressions).
- `applyImportedData(payload)` : écrit les 9 clés localStorage (clé **absente**
  du fichier → `removeItem`, pour ne pas laisser d'état résiduel incohérent
  mélangeant deux exports), vide puis réinsère les stores IDB `skills` et
  `resources`, puis `location.reload()` — l'état de session (caches, thread
  courant, statut MCP) se reconstruit proprement au boot, aucune
  resynchronisation manuelle à écrire.
