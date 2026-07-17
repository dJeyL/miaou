# Agrégation MCP distante (V2)

MIAOU est un **client/agrégateur MCP** : il fusionne ses outils internes et ceux
de N serveurs MCP distants en **un seul registre**, invisible au modèle. Les
invariants ci-dessous sont déjà payés — ne pas les ré-introduire de travers.

1. **Le préfixe est une VUE, pas un stockage.** `TOOLS` reste en noms **nus**
   (`memory__create`, …). Le préfixe `miaou__` est ajouté **à l'exposition
   seulement** par `exposedTools()` (consommé par `toolDefinitions()`). Les
   outils distants sont mis en cache **déjà préfixés**
   `servername__`. `parseToolName(name)` (utils, pur) splitte sur le **PREMIER**
   `__` uniquement — un `toolName` distant peut lui-même contenir `__`, un
   `split('__')` naïf le corromprait. `groupByNamespace` (pur) projette le nom
   canonique en `{namespace, bareName}` pour le sous-drawer « Voir les outils
   exposés » — rien n'est stocké, tout dérive du nom. Le tri d'affichage
   (namespaces en trois familles, puis outils alpha par `bareName` dans chaque
   groupe) vit dans `renderToolsList` (ui.js), purement présentationnel :
   `groupByNamespace` reste en ordre d'apparition.
2. **V2 rompt délibérément le byte-identical de V1.** Les outils internes sont
   désormais envoyés au modèle préfixés (`miaou__memory__create`). Assumé : le
   préfixe sert à router interne vs distant sans cas particulier. La doctrine
   mémoire (`MEMORY_DOCTRINE`) emploie donc les noms **préfixés** — **sauf
   `ask_confirmation`, qui reste NU** (hors registre, primitif halting ;
   `toolIsHalting` et l'interception api.js le matchent nu). Ne pas le préfixer
   par réflexe d'uniformité : le préfixe marque l'appartenance au registre, et
   lui n'y est pas.
3. **`callTool(name, args)` est le routeur unique, à retour MIXTE assumé.** Split
   sur le 1er `__` : préfixe `miaou` (ou absent) → `callInternalTool` **synchrone**
   (objet `{content, isError}`) ; sinon → serveur distant activé → `callRemoteTool`
   **asynchrone** (Promise). Préfixe inconnu / serveur désactivé → objet d'erreur
   **synchrone**. Les appelants font `await callTool(...)` (api.js) ; `await` sur
   un objet le renvoie tel quel. Cette asymétrie est **voulue** : elle garde les
   branches interne/erreur synchrones, donc **testables sans async** — le runner
   QuickJS exécute `it()` sans attendre les promesses (le chemin distant se
   vérifie à la main, cf. `docs/manual-tests.md`).
4. **Transport.** `streamable-http` implémenté (JSON-RPC 2.0 ; un seul endpoint
   POST, réponse JSON **ou** flux SSE `event:message`/`data:` agrégé par
   `readSseJsonRpc`). `sse` legacy **différé** : `mcpRpc` **lève** « non
   implémenté » plutôt que de demi-câbler. Devinette de transport
   (`guessMcpTransport`, pur) = **pré-remplissage seulement**, jamais un override :
   l'UI ne l'applique que si le champ n'a pas été touché (`dataset.touched`).
   Côté UI, le choix passe par le dropdown pilule custom `cfgPillSelect`
   (ui.js — valeur dans l'input hidden `.mcp-transport`), pas un select natif.
5. **Timeout via `AbortController` (D5).** Chaque appel `mcpRpc` arme un
   `setTimeout(timeout)` → `abort()` ; sur abort, résultat `{ isError: true }` au
   message clair. Sans ça le champ `timeout` serait décoratif. `Mcp-Session-Id`
   capturé sur l'`initialize` et renvoyé sur les appels suivants.
6. **Dégradation gracieuse (D10).** `connectMcpServer` (initialize → notification
   initialized → tools/list → préfixe + filtre + cache) **ne lève jamais** vers
   l'appelant : tout échec marque le serveur en erreur et **n'expose aucun** de
   ses outils ; le reste du registre (interne + autres serveurs) tient. Un mauvais
   backend ne gèle pas MIAOU. Connexion au démarrage via `reconnectMcpServers`
   (fire-and-forget dans `init`), et à chaque save de carte.
7. **Filtres `toolAllowlist`/`toolDenylist` (D7) au merge** (`filterMcpTools`,
   pur, appliqué dans `connectMcpServer` après `tools/list`). **Denylist gagne**
   en conflit ; allowlist vide → tout passe. Portent sur le nom **nu**.
7b. **Acks `mcp_call` (visibilité des appels dans le thread).** Chaque appel
   `callRemoteTool` pousse un ack `{ kind:'mcp_call', server, name }` dans
   `_pendingToolAcks` **de manière synchrone** (avant le premier `await`), ce qui
   permet à `onEarlyAcks` de le peindre **pendant** le round-trip. Le champ `server`
   (= premier segment, l'identité du serveur) sert de clé pour le filtre `showCalls`.
   `name` est le nom complet `a__b__c`, découpé sur **chaque** `__` pour le breadcrumb
   (segments vides ignorés). Sur erreur, `callRemoteTool` pose `ackEntry.error = true`
   sur l'objet partagé ; `onToolAcks` rétro-applique `.ack-error` sur le nœud DOM
   déjà rendu. Ces acks sont persisted dans `currentThread` / localStorage (champs
   `server`, `name`, `error`) et restaurés au reload. Ils sont filtrés du payload
   modèle par le filtre rôle existant — aucune liste blanche par kind à maintenir.
   Le toggle `showCalls` est éditable sur la **carte serveur en mode édition**
   uniquement — pas en mode vue — pour éviter une modification accidentelle.
8. **Blocs non-text = données persistées en IDB, rendu via IDB au reload (D8/D9).**
   `callRemoteTool` pousse tous les blocs non-text reçus du serveur dans
   `_pendingToolBlocks` (tools.js). `internResourcesFromResult` (api.js) intercepte
   le résultat **avant** `flattenToolResult` :
   - Blocs **inline** (`resource.text`) → stocke en IDB (persistance, accès via
     `resource__present`) ; appelle `retainPendingToolBlocks` pour retirer le bloc de
     la queue D8 (pas d'affichage automatique côté UI) ; pousse dans le résultat le
     texte brut **suivi de `NOT_PRESENTED_NOTE`** (composition par
     `formatInlineTextForModel`, resources.js, pure et testée) — le modèle reçoit le
     contenu, et l'information qu'il est **le seul** à l'avoir sous les yeux.
     - **Pourquoi la note.** Cette branche est la seule où un contenu **substantiel**
       part au modèle sans que rien ne soit affiché : le bloc est retiré de la queue
       D8, et le seul signal visible est le chip `resource_stored` (« Ressource
       enregistrée »), qui trace **l'appel d'outil, jamais son contenu**. Sans note, le
       modèle ne reçoit aucun marqueur — contrairement au `[ressource rendue dans
       l'interface]` de `flattenToolResult`, réservé aux blocs **sans** texte — et
       applique alors `BINARY_DOCTRINE` (« l'application l'a déjà présentée à
       l'utilisateur ») : il répond « comme tu peux le voir ci-dessus » sur un JSON que
       l'utilisateur n'a **jamais** vu. Observé en prod (serveur MCP maison renvoyant
       une réponse d'API distante en `resource`). `BINARY_DOCTRINE` (tools.js, v2) borne
       désormais explicitement la présentation automatique aux **binaires affichables** ;
       la note est le rappel per-résultat, la doctrine la règle générale — les deux
       ensemble, car la doctrine seule laisse le silence s'interpréter.
     - Pas de descripteur `[resource id=…]` ici (contrairement aux binaires et au handle
       `store_inline_from_bytes`) : le modèle a déjà le contenu en clair, un ID ne lui
       servirait qu'à un `resource__present` non désiré.
   - Blocs **binaires** (image, audio, resource blob) → stocke en IDB + remplace par
     `[resource_ref:res_…]` + note « présentée » (`entry.result` = ref).
   `flattenToolResult` voit ensuite uniquement des blocs `text` et les aplatit.
   Son fallback `[image rendue dans l'interface]` ne se déclenche que si le bloc
   échappe à `internResourcesFromResult` — le marqueur (pas le vide) est délibéré :
   un message `tool` vide poussait le modèle à **simuler/encoder** l'image.
   Les blocs **binaires** de `_pendingToolBlocks` sont drainés par `onToolAcks` et
   rendus dans la bulle par `placeToolBlocks` (image → `<img>` ; binaire →
   téléchargement éphémère). **Les blocs inline ont été retirés de la queue** par
   `retainPendingToolBlocks` — seul le chip `resource_stored` reste visible.
   **Au reload**, `placeToolAck` re-rend les blocs **binaires** depuis IDB
   (`getPendingToolBlocks().length === 0` + `record.class !== 'inline'`) ; les inline
   sont dans l'IDB mais non affichés (accessibles via `resource__present` si besoin).
   Au payload API, `resolveResourceRefs` remplace les refs **binaires** par le
   descripteur statique ; les inline ont le texte brut dans `entry.result` — pas de ref.
   DOM-safe : seule exception « HTML-ish » = le `src` data-URI de l'`<img>`, qui
   n'injecte aucun markup. **Deux couches pour DEUX
   échecs distincts** (pas primaire/repli) : le marqueur de `flattenToolResult` empêche
   le base64 d'**atteindre** le modèle ; une règle de **formulation** l'empêche de
   **narrer/simuler** l'image même sans déclencheur. Cette règle est une doctrine
   **comportementale transverse** → `BINARY_DOCTRINE` (constante dans `tools.js`,
   partie de `ROOT_SYSTEM_PROMPT`), **toujours injectée** dès que des outils existent.
   Surtout pas dans `MEMORY_DOCTRINE` (sans rapport avec la mémoire) ni dans une
   entrée par outil.
9. **Ré-handshake paresseux sur session invalidée (Correction B).** streamable-http
   est *stateful* : `initialize` renvoie un `Mcp-Session-Id` que le client renvoie à
   chaque appel. Un serveur **redémarré** ne reconnaît plus l'ancien id et répond
   **404**. `mcpRpcAttempt` tague l'erreur `staleSession` **uniquement si on détenait
   une session** (sinon un 404 est un vrai mauvais endpoint) ; `mcpRpc` refait alors
   `initialize` (`mcpReinitialize`, sans re-`tools/list`) et **rejoue l'appel une
   seule fois**. Échec du ré-handshake ou du rejeu → propagé → dégradation D10. Jamais
   de re-sonde préventive, jamais plus d'une tentative (pas de boucle sur un serveur
   mort). `initialize`/notifications passent par `mcpRpcAttempt` directement → pas de
   récursion.
10. **Auth : posture ASSUME (D6).** `authorization_token` en clair dans
    localStorage. Décision consciente : tout ce que JS lit, un XSS le lit ; un
    chiffrement client a besoin d'une clef client → ne protège rien. Le correctif
    prod est un **proxy** (token côté serveur) — mentionné comme la voie, **non
    implémenté en V2**. Caveat sobre affiché dans la carte serveur.
11. **Le sous-écran « Serveurs MCP » est un drawer à part** (`#mcp-drawer`, cartes
    éditables construites en `createElement`/`textContent`), pas une ligne de plus
    dans le drawer Paramètres déjà chargé. `validateMcpServerName` (pur) refuse
    espace, `__`, `miaou`, et les doublons.

12. **Hook d'inflation dispatcher pour les pièces jointes (brief A, D6 — moitié
    client du lot D `mcp_docs`).** `callTool` route désormais les appels
    distants via `callDocsInflatedRemoteTool(server, toolName, args, intent)`
    (tools.js), point d'accroche juste avant `callRemoteTool`. But : injecter
    le contenu base64 d'une pièce jointe (`att-N`) **sur le wire uniquement**
    quand l'outil distant ciblé en a besoin, sans jamais toucher aux `args`
    capturés par l'appelant pour la réinjection cross-turn (`onEnrichLastAck`)
    — le contexte modèle reste les args **originaux**, non inflés.
    - **Détection de capability SANS nom de serveur en dur** (contrainte
      explicite de l'audit lot A) : `toolDeclaresAttachmentInflation(server,
      toolName)` lit l'`inputSchema` mis en cache dans `_remoteTools` (issu du
      `tools/list` du serveur) et vérifie que les propriétés `ref` **et**
      `content_b64` y sont **toutes deux** déclarées — signature stable du
      contrat brief D, indépendante du nom que l'utilisateur donne à son
      serveur MCP docs.
    - Ne se déclenche que si `args.ref` matche `ATTACHMENT_REF_RE` (`att-N`,
      même forme que `allocateAttId`, resources.js) ET que
      `getCachedRecordByAttId(ref, currentConvId)` trouve un enregistrement en
      session cache (sinon la ref est inconnue localement — on laisse le
      serveur distant répondre lui-même, pas de matérialisation à l'aveugle).
    - **Table d'état poussé/non-poussé** `_attachmentPushState`, clé
      `(conversationId, attId)`, EN MÉMOIRE uniquement (comme
      `_remoteStatus`/`_remoteTools` — pas de persistance ; un rechargement de
      page revient à « non poussé », cohérent avec la session serveur
      elle-même éphémère, TTL sweep côté serveur docs). `session_id`
      (= `currentConvId`) est injecté sur **chaque** appel capable à ref
      connue — le serveur en a besoin pour localiser sa session, et le modèle
      ne connaît pas l'id de la conversation courante, il ne peut pas le
      fournir lui-même. `content_b64` n'est ajouté qu'au **premier** appel
      pour un `(conversationId, attId)` non encore poussé ; succès →
      `markAttachmentPushed`, les appels suivants repartent sans le contenu
      (le serveur a déjà matérialisé le fichier dans sa session).
    - **Contrat d'erreur partagé `REF_UNKNOWN`** (brief D D1) : porté par le
      serveur dans `error.data.code` (JSON-RPC 2.0, `code` reste l'entier
      protocolaire, `data` est le slot applicatif). `mcpRpcAttempt` attache
      `err.data = msg.error.data` ; `callRemoteTool` le recopie dans
      `result.errorCode` sur le chemin `catch` (jamais persisté — lu
      synchrone par l'appelant immédiat, pas dans `ACK_COPY_FIELDS`).
      `_isRefUnknownError(result)` teste `result.errorCode ===
      REF_UNKNOWN_ERROR_CODE` (constante unique, tools.js) — **jamais** une
      recherche de sous-chaîne dans le texte d'erreur (fragile, dépendrait de
      la formulation libre du message serveur).
    - Si l'état local dit « déjà poussé » mais le serveur répond
      `REF_UNKNOWN` (ex. session serveur expirée par TTL malgré notre table
      client) : **un seul rejeu** avec le contenu inliné, même discipline
      « un seul rejeu » que le ré-handshake `staleSession` (point 9
      ci-dessus), mais implémentée à un niveau **au-dessus** de `mcpRpc` (le
      hook D6 vit dans `callDocsInflatedRemoteTool`, pas dans `mcpRpc` lui-même
      — cf. audit lot A, section 4). Le rejeu passe `result.ackEntry` en 5ᵉ
      argument de `callRemoteTool` (`reuseAckEntry`) : il **réutilise la ligne
      d'ack du premier essai** au lieu d'en pousser une seconde, et l'erreur
      transitoire est effacée (`delete ackEntry.error`) si le rejeu réussit —
      une seule ligne d'appel visible pour l'échange complet, identique au
      rendu d'un rejeu `staleSession` (dont le retry vit sous UN
      `callRemoteTool`). `errorCode`/`ackEntry` sur l'objet résultat de
      `callRemoteTool` sont des champs internes, jamais persistés (hors
      `ACK_COPY_FIELDS`), consommés en synchrone par le hook seul.
    - Hook **inerte** tant qu'aucun serveur ne déclare le contrat `ref` +
      `content_b64` : `toolDeclaresAttachmentInflation` renvoie `false`, la
      fonction délègue directement à `callRemoteTool` sans changement de
      comportement — le lot D peut brancher son serveur sans retoucher MIAOU.
    - **Déclencheur côté modèle (brief H) : le descripteur binaire est ce qui
      amorce toute cette mécanique.** Les points ci-dessus décrivent l'aval
      (le hook, une fois que le modèle a choisi d'appeler l'outil) ; en amont,
      un attachment `kind:'binary'` (fichier joint non-image/texte : .docx,
      .zip, .pdf, …) émet dans le message user un descripteur générique
      `formatBinaryAttachmentDescriptor` (resources.js) — `[attachment att-N:
      file "...", <mime>, <taille> — binary content, not inlined]`, dérivé
      des champs figés du schéma, byte-stable, câblé dans
      `buildAttachedMessageContent`/`buildOutgoingContentForAttachments`
      (même famille que le bloc texte D3 : pas de content part, pas de
      rewrite ultérieur nécessaire — un binaire n'a aucun octet à envoyer).
      Le modèle voit systématiquement la pièce, quel que soit le type de
      fichier et indépendamment de la présence d'un serveur `mcp_docs` —
      c'est délibéré (nommage par capability, pas par type en dur).
    - Le **guidage** (« comment » ouvrir la pièce) est porté séparément par
      `docsDoctrinePrompt()` (tools.js), injectée dans `buildSystemMessage()`
      **seulement** si `anyToolDeclaresAttachmentInflation()` détecte au moins
      un outil du registre distant déclarant `ref`+`content_b64` — même
      mécanisme conditionnel que `skillDoctrinePrompt`/`intentDoctrinePrompt`.
      Nommage par **critère** (« un outil déclarant `ref` et `content_b64` »)
      **et exemple** (`docs__read`) : le prompt reste correct si l'utilisateur
      renomme son serveur MCP docs. Sans serveur qualifiant, la doctrine est
      une chaîne vide — zéro pollution des setups sans extraction documentaire.
      La phrase binaire d'`ATTACHMENT_DOCTRINE` (inconditionnelle) est nuancée
      en conséquence (« pas lisible directement, sauf si un outil d'extraction
      est disponible ») plutôt que de rester catégorique comme avant le lot D.

13. **Généralisation du hook d'inflation aux fichiers de bibliothèque d'espace
    (lot Cbis, `files__read` — §4 audit).** Le hook du point 12 était câblé en
    dur sur la forme `att-N` (regex, cache par `attId`+`conversationId`, clé de
    push `(conversationId, attId)`) : un `file-<id>` d'espace ne passait aucune
    des trois conditions. Généralisation, **pas de second hook** :
    - `_resolveInflationRef(ref)` (tools.js) reconnaît `ATTACHMENT_REF_RE`
      (`att-N`) OU `FILE_REF_RE` (`file-<id>`, même forme que
      `LIBRARY_REF_RE`/resources.js) et renvoie un objet uniforme `{ record,
      sessionId, isPushed, markPushed }` — `callDocsInflatedRemoteTool` ne
      connaît plus la forme de la ref, seulement ce contrat.
    - `att-N` → résolution par `getCachedRecordByAttId(ref, currentConvId)`
      (conversation-scopée, inchangé) ; `file-<id>` → `parseLibraryRef(ref)`
      puis `getCachedRecord(recordId)` (cache session **unifié** avec les
      attachments) suivi d'une vérification `record.kind === 'library' &&
      record.spaceId === activeSpaceId` — **herméticité** : un fichier d'un
      autre Space n'est pas résolu, exactement comme s'il était inconnu (pas
      d'oracle, cf. piège 18).
    - **Deux tables de push distinctes** : `_attachmentPushState` (clé
      `(conversationId, attId)`, inchangée) et `_filePushState` (nouvelle, clé
      `(spaceId, fileId)`) — les deux familles de refs ne partagent jamais un
      format de clé, aucun risque de collision entre un `attId` et un `fileId`
      qui se ressembleraient.
    - `session_id` reste **toujours** = `currentConvId`, même pour un
      `file-<id>` : le serveur mcp_docs ne connaît que des sessions de
      conversation (`session_id` keyé sur `conversationId`), pas de notion de
      session de Space. **Conséquence assumée (dette documentée)** : un
      fichier d'espace lu depuis la conversation A puis relu depuis la
      conversation B est poussé (et payé en `content_b64`) **deux fois**, une
      fois par session de conversation — pas de partage de session
      inter-conversation pour un fichier de bibliothèque. Le brief H ne
      promettait pas ce partage ; revisiter seulement si le coût se révèle
      significatif en usage réel.
    - `clearAttachmentPushState`/`_filePushState` restent des tables purement
      en mémoire (comme le reste du hook) : un rechargement de page les vide,
      cohérent avec la session serveur elle-même éphémère.

13bis. **Troisième famille de ref : ressources de session `res_…` (lot K, §4.2).**
    Même généralisation, **toujours pas de second hook** : `_resolveInflationRef`
    reconnaît une troisième forme `RESOURCE_REF_RE` (`res_<base36>`, underscore
    après `res` — PAS un tiret comme att-/file-). Un `res_…` est **directement
    l'id** d'un record du store `resources` : résolution par `getCachedRecord(ref)`
    (le plus simple des trois lookups, sans `getCachedRecordByAttId` ni
    `parseLibraryRef`). **Herméticité par le cache session** : ce cache ne contient
    que les records de la conversation courante (`loadConversationResources`) —
    un `res_…` d'une autre conversation n'y est pas, `getCachedRecord` renvoie
    `null`, la résolution retourne `null` et le serveur répond REF_UNKNOWN. Aucun
    filtre de scope réécrit : le cache EST le filtre.
    - **Troisième table de push distincte** : `_resourcePushState`, clé
      `(conversationId, resId)` (même forme que `_attachmentPushState`, un `res_…`
      porte un `conversationId`) — purgée par `deleteConv` via
      `clearResourcePushState`, comme les attachments (les fichiers d'espace, eux,
      space-scopés, ne sont pas purgés par `deleteConv`).
    - **Provenance web (lot K §4.1).** La source phare d'un `res_…` binaire est
      `web__fetch_resource` : le serveur renvoie deux blocs — un descripteur `text`
      (passthrough → modèle) et un `resource.blob` que `extractResultParts` route
      en `store_binary` → record `res_…` en IDB (canal existant, pas un nouveau).
      Mais la capacité n'est **pas web-only** : tout `res_…` binaire (image
      d'outil, résultat MCP quelconque) devient injectable vers `docs__*`/`js__eval`
      — un blob est un blob.
    - **Provenance texte intégral, `docs__extract` (lot M).** Deuxième source d'un
      `res_…`, mais de **classe `'inline'`** plutôt que binaire : `docs__extract`
      renvoie le texte complet d'un membre de zip (JSON/texte/CSV/XML/NDJSON) en
      `resource.blob` (canal transfert `content_b64`, jamais en contexte modèle —
      c'est le point de l'outil : contourner `docs__read`/`READ_CAP` sans payer de
      tokens). Côté client, `extractResultParts` (resources.js) route ce cas via
      `_isTextualMime(r.mimeType)` (mime `text/*` ou allowlist
      `application/{json,xml,x-ndjson,csv}`) en action `store_inline_from_bytes`
      (M1a, pure) ; `internResourcesFromResult` (M1b) stocke le record en classe
      `'inline'` (via `_storeBlock`, octets décodés de `r.blob` par le canal
      binaire — jamais le texte dans le message `role:'tool'`), puis construit le
      handle modèle avec **`formatInlineHandleForModel`** (resources.js, pur) :
      un **descripteur statique compact** (`[resource id=… mime=… name=… size=…]`)
      + une note « texte adressable par js__eval (blob=res_…) ». Résultat : un
      `res_…` de classe `'inline'`, `js__eval`-adressable
      (`utf8Decode(record.data)` sans branche par classe) et non rendu
      automatiquement à l'écran (`placeToolAck` ignore le rendu bloc pour
      `class === 'inline'`), alors que ses octets ont transité par le canal
      binaire. Le bloc `resource` correspondant est retiré de la queue de rendu D8
      (`retainPendingToolBlocks`) pour éviter un bouton de téléchargement parasite
      sur un handle destiné à `js__eval`.
      - **Piège fermé — jamais de `[resource_ref:…]` pour ce handle.** Contrairement
        au tail `store_binary` (qui pose `_makeResourceRef(id)` + note « présentée »),
        la branche M **n'émet pas** de marqueur `[resource_ref:res_…]`. Raison :
        `assembleToolResultForModel` résout tout `[resource_ref:]` vers un record
        `class:'inline'` en **`utf8Decode(data)` — le contenu ENTIER** — au tour
        *suivant* (`resolveResourceRefs`, pre-pass de `dispatchSend`). Un handle M
        ré-inlinable ré-injecterait donc le membre de zip complet dans le contexte
        à chaque tour (bug initial du lot M : ~5,6 M tokens fantômes dans
        l'inspecteur + `400` sur `streamCompletion` au 2ᵉ tour, dépassement de
        fenêtre). Le descripteur compact de `formatInlineHandleForModel` est
        byte-stable et jamais expansé. Non-régression verrouillée par
        `test-resources.js` (`formatInlineHandleForModel` : assertion « ne contient
        jamais `[resource_ref:` », + contraste avec un ref inline qui, lui, se
        ré-inline). Un blob inline M ne s'atteint QUE par `js__eval`, jamais par
        ré-injection inline — symétrie avec la posture « handle seul » des autres
        familles de ref.
    - **Blocage serveur levé (cross-repo, lot K0).** Avant K, `mcp_docs`
      `validate_ref` (`_REF_RE`) rejetait tout ref hors `att-`/`file-`. K a élargi
      `_REF_RE` à `res_[a-z0-9]+` côté miaou-mcp-servers (commit `91de653`) : le
      serveur reste ref-opaque (type par magic bytes, matérialisation idempotente),
      il ne fait qu'accepter le préfixe. Contrat miroir à tenir synchronisé.

14. **Sélection de l'outil de LECTURE de contenu, sans nom en dur (D7, lot
    Cbis-5 — bug corrigé après retour utilisateur).** Un serveur d'extraction
    documentaire expose typiquement PLUSIEURS outils déclarant tous
    `ref`+`content_b64` (structure/lecture/recherche — mcp_docs :
    `list`/`read`/`search`, les trois partagent le même mécanisme de
    matérialisation `resolve_ref`). Quand c'est le **modèle** qui choisit
    l'outil (hook §4/12, `toolDeclaresAttachmentInflation`), il voit les vrais
    noms et descriptions — aucune ambiguïté, le dispatcher vérifie seulement
    que l'outil CHOISI PAR LE MODÈLE qualifie. Mais l'extraction D7
    (description de fichier de bibliothèque, appel **applicatif direct** sans
    modèle) doit
    choisir tout seul lequel appeler — bug observé : `findDocsInflationTool()`
    prenait le premier outil qualifiant du tableau (`docs__list`, listé avant
    `docs__read` par le serveur), provoquant une erreur ref/contrat du serveur
    (`list` valide son ref différemment de `read`).
    - **Signal de contrat retenu** (déjà réel côté mcp_docs, pas une
      invention) : l'outil de lecture de contenu déclare, en plus de
      `ref`+`content_b64`, au moins un paramètre de bornage d'extrait
      (`char_start` ou `line_start` — pagination d'un texte trop long) et
      **aucun** paramètre `query` (signature d'une recherche, pas d'une
      lecture). `_declaresContentReadSignature(props)` (tools.js, pure)
      encode ce critère ; `findDocsInflationTool()` filtre désormais sur
      `ref && content_b64 && _declaresContentReadSignature(...)`, pas
      seulement `ref && content_b64`.
    - **Convention à respecter par tout futur serveur d'extraction
      documentaire** (brief D/H) : son outil de lecture doit exposer ce
      signal (`char_start`/`line_start`) pour être reconnu par
      `findDocsInflationTool` ; un outil de structure/liste ou de recherche ne
      doit PAS les déclarer, sous peine d'être pris à tort pour l'outil de
      lecture par cette sélection applicative.
    - Le hook §4/12 (`toolDeclaresAttachmentInflation`,
      `callDocsInflatedRemoteTool`) **n'est pas concerné** par ce signal : il
      continue de vérifier seulement `ref`+`content_b64` sur l'outil que le
      modèle a explicitement nommé — aucune ambiguïté à lever côté modèle,
      qui voit le nom réel de l'outil.

Le banc d'essai MCP (`mcp_bench.py`) a été extrait dans le projet
`miaou-mcp-servers`. Procédure de test manuel : `docs/manual-tests.md`.
