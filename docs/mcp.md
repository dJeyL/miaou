# Agrégation MCP distante (V2)

MIAOU est un **client/agrégateur MCP** : il fusionne ses outils internes et ceux
de N serveurs MCP distants en **un seul registre**, invisible au modèle. Les
invariants ci-dessous sont déjà payés — ne pas les ré-introduire de travers.

**Où vit ce code.** Le côté **distant** est dans `src/js/mcp.js` (chargé avant
`tools.js` dans `JS_ORDER`) : protocole et état de session (`_remoteTools`/
`_remoteStatus`), client JSON-RPC (`mcpRpcAttempt`/`mcpRpc`/`readSseJsonRpc`),
sonde d'ère et handshake (`probeMcpEra`/`connectMcpServer`/`disconnectMcpServer`,
point 20), marqueurs de refus
d'autorisation et `callRemoteTool`. Ce qui **compose** interne et distant reste
dans `tools.js` — `exposedTools` (elle lit `TOOLS`), le dispatcher `callTool`/
`callInternalTool`, le hook d'inflation `callDocsInflatedRemoteTool` et les
doctrines. La frontière est « parle au réseau » contre « décide où router » :
une fonction qui a besoin de `TOOLS` n'est pas du MCP distant.

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
4. **Transport : `streamable-http`, et lui seul** (JSON-RPC 2.0 ; un seul
   endpoint POST, réponse JSON **ou** flux SSE `event:message`/`data:` agrégé
   par `readSseJsonRpc`). Le transport HTTP+SSE historique (GET `EventSource`
   plus endpoint POST séparé) a été d'abord différé, puis **abandonné** : la
   spec MCP l'a déprécié au profit de streamable-http, et un upstream qui ne
   parlerait que lui se branche derrière le proxy MCP, qui fait le pont — pas
   dans un client navigateur, où il serait le plus coûteux à porter (deux
   canaux, CORS sur le GET long). Le champ `transport` des cartes a disparu
   avec sa pilule et la devinette d'URL qui pouvait choisir d'elle-même
   l'option non implémentée. Une carte ancienne qui le porte encore le perd à
   sa prochaine normalisation (`normalizeMcpServer`) ; d'ici là il est inerte.
   Côté `config.json`, la clef `transport` d'une entrée de `mcp_server`/`mcp_servers` lève
   désormais le WARN de clef inconnue au build.
   Sur ce transport, deux révisions de protocole coexistent depuis le lot AM :
   le handshake `initialize` à session (ère `legacy`) et la révision 2026-07-28
   sans session (ère `modern`). Même endpoint, même POST, même lecture JSON ou
   SSE ; ce qui change par requête est décrit au point 20.
5. **Timeout via `AbortController`.** Chaque appel `mcpRpc` arme un
   `setTimeout` → `abort()` ; sur abort, résultat `{ isError: true }` au
   message clair. Sans ça le champ `timeout_s` serait décoratif. **Tout le
   domaine MCP compte en SECONDES** (clef de config, champ de carte, défaut) ;
   `mcpRpcAttempt` est le SEUL point de conversion vers les millisecondes, au
   contact de `setTimeout`. Les cartes d'avant ce changement portent un
   `timeout` en ms, migré à la lecture par `mcpTimeoutSeconds` (utils, pur) —
   sur le NOM du champ, jamais sur un seuil de valeur, et dans
   `normalizeMcpServer` plutôt qu'en passe de démarrage pour couvrir aussi
   l'import d'un `.zip` exporté avant. `Mcp-Session-Id`
   capturé sur l'`initialize` et renvoyé sur les appels suivants, **en legacy
   seulement** : en moderne il n'est ni envoyé ni capturé (point 20). Le délai
   dépassé lève une erreur marquée `timeout`, que la sonde d'ère lit pour NE PAS
   se replier (lot AM).
6. **Dégradation gracieuse.** `connectMcpServer` (sonde `server/discover` →
   en legacy initialize → notification initialized → tools/list → préfixe +
   filtre + cache) **ne lève jamais** vers
   l'appelant : tout échec marque le serveur en erreur et **n'expose aucun** de
   ses outils ; le reste du registre (interne + autres serveurs) tient. Un mauvais
   backend ne gèle pas MIAOU. Connexion au démarrage via `reconnectMcpServers`
   (fire-and-forget dans `init`), et à chaque save de carte.
7. **Filtres `toolAllowlist`/`toolDenylist` au merge** (`filterMcpTools`,
   pur, appliqué dans `connectMcpServer` après `tools/list`). **Denylist gagne**
   en conflit ; allowlist vide → tout passe. Portent sur le nom **nu**.
7b. **Acks `mcp_call` (visibilité des appels dans le thread).** Chaque appel
   `callRemoteTool` pousse un ack `{ kind:'mcp_call', server, name }` dans
   `_pendingToolAcks` **de manière synchrone** (avant le premier `await`), ce qui
   permet à `onEarlyAcks` de le peindre **pendant** le round-trip. Le champ `server`
   (= premier segment, l'identité du serveur) identifie le serveur d'origine.
   `name` est le nom complet `a__b__c`, découpé sur **chaque** `__` pour le breadcrumb
   (segments vides ignorés). Sur erreur, `callRemoteTool` pose `ackEntry.error = true`
   sur l'objet partagé ; `onToolAcks` rétro-applique `.ack-error` sur le nœud DOM
   déjà rendu. Ces acks sont persistés dans `currentThread` / IndexedDB (champs
   `server`, `name`, `error`) et restaurés au reload. Ils sont filtrés du payload
   modèle par le filtre rôle existant — aucune liste blanche par kind à maintenir.
   **Toujours affichés** dans le thread, sans toggle de masquage — posture de
   transparence de MIAOU.
8. **Blocs non-text = données persistées en IDB, rendu via IDB au reload.**
   `callRemoteTool` pousse tous les blocs non-text reçus du serveur dans
   `_pendingToolBlocks` (tools.js). `internResourcesFromResult` (api.js) intercepte
   le résultat **avant** `flattenToolResult` :
   - Blocs **inline** (`resource.text`) → stocke en IDB (persistance, accès via
     `resource__present`) ; appelle `retainPendingToolBlocks` pour retirer le bloc de
     la queue de rendu (pas d'affichage automatique côté UI) ; pousse dans le résultat le
     texte brut **suivi de `NOT_PRESENTED_NOTE`** (composition par
     `formatInlineTextForModel`, resources.js, pure et testée) — le modèle reçoit le
     contenu, et l'information qu'il est **le seul** à l'avoir sous les yeux.
     - **Pourquoi la note.** Cette branche est la seule où un contenu **substantiel**
       part au modèle sans que rien ne soit affiché : le bloc est retiré de la queue de rendu,
       et le seul signal visible est le chip `resource_stored` (« Ressource
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
   seule fois**. Échec du ré-handshake ou du rejeu → propagé → dégradation gracieuse. Jamais
   de re-sonde préventive, jamais plus d'une tentative (pas de boucle sur un serveur
   mort). `initialize`/notifications passent par `mcpRpcAttempt` directement → pas de
   récursion.
   **Ordre préservé par le lot AM** : depuis que le corps d'une réponse non 2xx
   est lu (point 20), le 404 avec session détenue se tranche sur le statut SEUL,
   AVANT cette lecture (`isMcpStaleSessionResponse`, pur) — le ré-handshake ne
   dépend donc pas de ce que le serveur écrit dans sa réponse. **Legacy
   seulement** : la révision 2026-07-28 n'a pas de session, `staleSession` y est
   inatteignable et `mcpReinitialize` n'a rien à faire.
10. **Auth : posture ASSUME (non-prod).** `authorization_token` en clair dans
    localStorage. Décision consciente : tout ce que JS lit, un XSS le lit ; un
    chiffrement client a besoin d'une clef client → ne protège rien. Le correctif
    prod est un **proxy** (token côté serveur) — mentionné comme la voie, **non
    implémenté en V2**. Caveat sobre affiché dans la carte serveur.
    **Suite donnée (campagne AB, point 14 ci-dessous)** : `mcp_proxy` détient
    désormais les jetons OAuth des serveurs tiers sur disque, et MIAOU ne
    manipule plus qu'un bearer opaque vers ce proxy local. Le caveat reste
    valable pour ce bearer-là.
11. **Le sous-écran « Serveurs MCP » est un drawer à part** (`#mcp-drawer`, cartes
    éditables construites en `createElement`/`textContent`), pas une ligne de plus
    dans le drawer Paramètres déjà chargé. `validateMcpServerName` (pur) refuse
    espace, `__`, `miaou`, et les doublons.

11b. **Serveurs pré-configurés au build (`mcp_servers` / `mcp_server` de
    `config.json`).** Un déploiement d'équipe veut livrer un bundle déjà branché
    sur son ou ses proxys MCP sans faire saisir les cartes à chacun. Deux clefs,
    **exclusives** : `mcp_servers` (tableau) et le singulier historique
    `mcp_server` (objet, tableau toléré), lues en `BUILD_MCP_SERVERS`
    (storage.js). Le build **échoue** si les deux sont posées
    (`check_mcp_server_keys`, build.py), valeur nulle comprise : ni la fusion
    (un singulier oublié en migrant livrerait un serveur en double) ni la
    préférence (l'autre clef ignorée en silence) n'est une lecture juste. Le
    délai s'y nomme `timeout_s`, comme le champ de la carte. Le jeton n'est
    **jamais écrit dans `config.json`** : l'entrée nomme une variable
    d'environnement (`authorization_token_env`), que le build résout en
    `authorization_token` (`resolve_mcp_token_env`, build.py) et dont
    l'absence le fait échouer — un `authorization_token` en clair aussi. La
    config est sérialisée dans `dist/miaou.html`, versionné et publié : le
    secret n'entre que dans le bundle du build qui définit la variable (le
    déploiement), et reste lisible par qui reçoit CE fichier. Comme l'URL, un
    jeton changé dans un build ultérieur n'atteint pas une carte déjà seedée.

    Le seed se fait **une fois par serveur de config**, gardé par sa propre clef
    `miaou-mcp-seeded` : `miaou-mcp-servers` existe déjà chez tout utilisateur
    ayant ouvert le drawer, elle ne peut donc pas servir de marqueur comme
    `miaou-api-servers` le fait pour les serveurs API. La sentinelle est la
    **liste des serveurs de config déjà traités** (`[{ name, url }]`), pas un
    drapeau : un serveur ajouté à la config d'un build ultérieur arrive chez
    les installations existantes, un serveur déjà traité n'est jamais
    réinséré. Entre dans la liste toute entrée valide rencontrée, insérée ou
    écartée parce qu'une carte équivalente existait — sans quoi supprimer
    cette carte la ferait revenir au démarrage suivant. Une entrée invalide
    (sans URL, nom refusé) n'y entre PAS : c'est une faute de config, et la
    consigner brûlerait par son URL le seed de la version corrigée. Config
    vide → rien n'est écrit.

    L'ancienne valeur `'1'` (drapeau d'avant les serveurs multiples, qui ne
    disait pas QUELS serveurs il couvrait) est lue comme une liste vide
    (`parseMcpSeededSentinel`) : tout serveur de config sans carte équivalente
    est alors inséré. Prix assumé : une carte seedée sous l'ancien drapeau puis
    supprimée revient une fois — indiscernable d'un serveur nouveau, et le
    second serveur n'arriverait sinon jamais chez les installations existantes.

    Conséquences assumées : une carte seedée puis supprimée ne revient pas, et
    changer l'URL d'un serveur dans un build ultérieur ne la propage PAS aux
    installations existantes (le nom suffit à reconnaître l'entrée déjà
    traitée ; propager serait un re-seed récurrent, qui annulerait les
    suppressions).

    Le plan est pur et testé : `mcpSeedPlan(configured, existing, seeded)`
    (utils) rend `{ insert, seeded }` — il retire les entrées déjà traitées
    (même nom OU même URL qu'une entrée de la sentinelle) puis délègue à
    `mcpSeedCandidates(configured, existing)`, qui écarte tout candidat ayant
    un équivalent **par nom** (le nom est le préfixe d'outil, donc l'identité)
    ou **par URL** au sens de `mcpUrlIdentity` — trim, casse, slash final, et
    rien de plus : l'équivalence d'hôtes (`localhost` vs `127.0.0.1`) serait une
    devinette sur un déploiement qu'on ne connaît pas. Les candidats sont aussi
    dédupliqués entre eux, et un nom invalide est écarté plutôt que de créer
    une carte au préfixe cassé. `miaou-mcp-seeded` n'est **pas** dans
    `EXPORT_KEYS` : c'est un marqueur d'installation, pas une donnée
    utilisateur — l'exporter empêcherait un import sur machine neuve de
    recevoir le seed de son propre build.

    Les verify Playwright neutralisent le seed en posant la sentinelle à
    `seededMcpSentinel()` (`stub-backend.js`), composée depuis le
    `config.json` local : `'1'` ne neutralise plus rien.

12. **Hook d'inflation dispatcher pour les pièces jointes (brief A — moitié
    client du lot D `mcp_docs`).** `callTool` route désormais les appels
    distants via `callDocsInflatedRemoteTool(server, toolName, args, intent)`
    (tools.js), point d'accroche juste avant `callRemoteTool` (mcp.js). But : injecter
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
    - **Contrat d'erreur partagé `REF_UNKNOWN`** (brief D, transport et ingestion) : porté par le
      serveur dans `error.data.code` (JSON-RPC 2.0, `code` reste l'entier
      protocolaire, `data` est le slot applicatif). `mcpRpcAttempt` attache
      `err.data = msg.error.data` ; `callRemoteTool` le recopie dans
      `result.errorCode` sur le chemin `catch` (jamais persisté — lu
      synchrone par l'appelant immédiat, pas dans `ACK_COPY_FIELDS`).
      `_isRefUnknownError(result)` teste `result.errorCode ===
      REF_UNKNOWN_ERROR_CODE` (constante unique, mcp.js) — **jamais** une
      recherche de sous-chaîne dans le texte d'erreur (fragile, dépendrait de
      la formulation libre du message serveur).
    - Si l'état local dit « déjà poussé » mais le serveur répond
      `REF_UNKNOWN` (ex. session serveur expirée par TTL malgré notre table
      client) : **un seul rejeu** avec le contenu inliné, même discipline
      « un seul rejeu » que le ré-handshake `staleSession` (point 9
      ci-dessus), mais implémentée à un niveau **au-dessus** de `mcpRpc` (le
      le hook d'inflation vit dans `callDocsInflatedRemoteTool`, pas dans `mcpRpc` lui-même
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
      (même famille que le bloc texte des fichiers texte : pas de content part, pas de
      rewrite ultérieur nécessaire — un binaire n'a aucun octet à envoyer).
      Le modèle voit systématiquement la pièce, quel que soit le type de
      fichier et indépendamment de la présence d'un serveur `mcp_docs` —
      c'est délibéré (nommage par capability, pas par type en dur).
    - Le **guidage** (« comment » ouvrir la pièce) est porté séparément par
      `DOCS_DOCTRINE` (tools.js). Elle était conditionnelle au lot H
      (`docsDoctrinePrompt()` / `anyToolDeclaresAttachmentInflation()`, injectée
      seulement si un outil du registre distant déclarait `ref`+`content_b64`) ;
      **le lot V-1 l'a rendue statique et inconditionnelle**, intégrée à
      `ROOT_SYSTEM_PROMPT`, et les deux helpers ont disparu. Motif : des outils
      d'ouverture **natifs** (`docs__list`/`docs__extract`) sont désormais
      toujours présents, et surtout un prompt système indexé sur l'état de
      branchement MCP bougerait à chaque connexion/déconnexion de serveur —
      invalidation KV récurrente, précisément ce que vise le piège 16.
      La conditionnalité est **lue par le modèle** (motif `WEB_DOCTRINE`, deux
      blocs balisés) et le cas dégradé est rattrapé par l'outil :
      `docsUnsupportedFormatMessage()` (tools.js) lit `findDocsInflationTool()`
      **au moment de l'appel** et nomme le serveur réellement branché, ou dit
      qu'il n'y en a aucun. Nommage toujours par **critère** (« un outil
      déclarant `ref` et `content_b64` ») **et exemple** (`docs__read`) : le
      prompt reste correct si l'utilisateur renomme son serveur MCP docs.
      **Attention à l'homonymie depuis V-4** : le `docs__read` cité ici est
      l'outil **serveur** (celui qui déclare `content_b64`) ; MIAOU en a
      désormais un **natif** du même nom, sans `content_b64`. Les préfixes
      racines les séparent (`miaou__docs__read` face à
      `miaou-proxy__docs__read`) — c'est la décision 1 du lot V, qui reprend
      délibérément les noms du serveur pour que la bascule natif/serveur reste
      invisible au modèle. Le critère `ref`+`content_b64` reste donc le seul
      discriminant fiable côté code.
      La phrase binaire d'`ATTACHMENT_DOCTRINE` (inconditionnelle) a été nuancée
      en conséquence (« pas lisible directement, sauf si un outil d'extraction
      est disponible ») plutôt que de rester catégorique comme avant le lot D.
      Depuis que les lecteurs sont natifs (lot V), la condition était toujours
      vraie : la phrase renvoie désormais sans réserve aux outils de
      `DOCS_DOCTRINE`, qui la suit dans le message système (2026-09-25).

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
      (pure) ; `internResourcesFromResult` stocke le record en classe
      `'inline'` (via `_storeBlock`, octets décodés de `r.blob` par le canal
      binaire — jamais le texte dans le message `role:'tool'`), puis construit le
      handle modèle avec **`formatInlineHandleForModel`** (resources.js, pur) :
      un **descripteur statique compact** (`[resource id=… mime=… name=… size=…]`)
      + une note « texte adressable par js__eval (blob=res_…) ». Résultat : un
      `res_…` de classe `'inline'`, `js__eval`-adressable
      (`utf8Decode(record.data)` sans branche par classe) et non rendu
      automatiquement à l'écran (`placeToolAck` ignore le rendu bloc pour
      `class === 'inline'`), alors que ses octets ont transité par le canal
      binaire. Le bloc `resource` correspondant est retiré de la queue de rendu
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

14. **Sélection de l'outil de LECTURE de contenu, sans nom en dur (lot
    Cbis-5 — bug corrigé après retour utilisateur).** Un serveur d'extraction
    documentaire expose typiquement PLUSIEURS outils déclarant tous
    `ref`+`content_b64` (structure/lecture/recherche — mcp_docs :
    `list`/`read`/`search`, les trois partagent le même mécanisme de
    matérialisation `resolve_ref`). Quand c'est le **modèle** qui choisit
    l'outil (hook §4/12, `toolDeclaresAttachmentInflation`), il voit les vrais
    noms et descriptions — aucune ambiguïté, le dispatcher vérifie seulement
    que l'outil CHOISI PAR LE MODÈLE qualifie. Mais l'extraction de contenu
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

15. **Contrat d'erreur `AUTHORIZATION_REQUIRED` (campagne AB).** Deuxième code
    machine du même slot applicatif que `REF_UNKNOWN` (point 12), et détecté par
    la même discipline : **égalité de constante** sur `error.data.code`, jamais
    une sous-chaîne du message. `AUTHORIZATION_REQUIRED_ERROR_CODE` vit dans
    `utils.js`, à côté du prédicat qui la lit.
    - **Ce que porte `error.data`** : `code`, `upstream` (nom du serveur amont
      qui a refusé) et `authorization_url` (**éventuellement `null`** — le proxy
      peut n'avoir aucun parcours à proposer). `error.message` est de la prose
      destinée à l'humain : affichable, **jamais parsée**.
    - **Deux formes d'`authorization_url`, et il faut les deux.** Le proxy
      publie un **chemin relatif** (`/authorize/{name}`) depuis son lot AB-4 :
      l'URL absolue qu'il publiait avant était celle d'un parcours OAuth
      **avorté**, qui menait à un callback orphelin. MIAOU compose donc
      l'origine lui-même (voir point 16). La forme **absolue** reste servie :
      des acks persistés en portent, et un serveur non-proxy pourrait en
      renvoyer. Chacune a sa garde — c'est le point clé, cf. point 16.
    - **MIAOU modélise la notion d'upstream** depuis le lot AB-5, ce que ce
      document niait explicitement jusque-là. La raison est la **granularité** :
      MIAOU raisonne en serveur configuré (une carte, une URL, une entrée de
      `_remoteStatus`), `mcp_proxy` en upstreams agrégés (N derrière une seule
      URL). Tant que `upstream` ne servait qu'à **nommer** un refus dans un
      libellé, l'ignorer était gratuit ; dire « ce serveur marche, mais deux des
      choses qu'il agrège attendent une autorisation » impose de les nommer, les
      compter et les adresser. Cf. point 16.
    - **Persistance, contrairement à `REF_UNKNOWN`.** Ce dernier reste sur
      `result.errorCode`, éphémère par construction : son unique consommateur
      (le hook §12) le lit en synchrone pour décider d'un rejeu. Un refus
      d'autorisation, lui, appelle une action de l'**utilisateur**, qui peut
      quitter la conversation et y revenir : `errorCode`, `authorizationUrl` et
      `upstream` passent donc par l'**ack**, via `ACK_COPY_FIELDS`
      (`applyAuthorizationRefusal` / `clearAuthorizationRefusal`, mcp.js —
      posés ensemble, retirés ensemble ; le rejeu qui réussit les efface comme
      il efface `error`, sans quoi un lien périmé subsisterait sous un appel
      redevenu vert).
    - **Garde d'URL, appliquée à l'AFFICHAGE.** `authorizationUrlOrigin`
      (utils.js, pure) n'accepte que `https:` vers un hôte quelconque, ou
      `http:` vers un loopback **littéral** (`127.0.0.1`, `[::1]`,
      `localhost`) ; refuse userinfo, caractères de contrôle, port non
      numérique, et tout le reste. Refus = **aucun lien affiché**, jamais de
      repli sur un lien nu. Le verdict est rendu à chaque affichage et non à
      l'écriture : un ack relu du stockage (ou écrit par une version antérieure)
      repasse par la même garde. C'est la seule URL d'origine **réseau** que
      MIAOU rende cliquable, d'où la liste fermée.
    - **Rendu** : `ackAuthorizationTarget(m, mcpServerUrl)` (prédicat unique,
      utils.js) gate un lien « Autoriser » sur l'ack, avec l'origine en clair à
      côté. Son second argument est l'URL configurée du serveur d'où vient
      l'ack, nécessaire pour composer un chemin relatif ; l'ack porte pour cela
      `mcpServer` (le **nom**, pas l'URL — celle-ci est résolue à l'affichage
      par `_ackMcpServerUrl`, acks.js, pour qu'un ack relu pointe là où le proxy
      est aujourd'hui). Sans serveur résoluble, un chemin relatif ne donne
      **aucun lien** : une affordance ne se devine pas. Construit
      par API DOM, `href` posé par **propriété** (aucun chemin string→HTML, cf.
      piège 21), `rel="noopener noreferrer"`. **Absent des deux exports**, comme
      le bouton de téléchargement et la loupe. Cf. `docs/tools.md`.
    - **Texte au modèle** : `formatAuthorizationRefusalForModel` (mcp.js,
      pure) complète le message serveur. Celui-ci est à l'impératif sans
      destinataire (« Ouvrir ce lien… ») et se lit comme une consigne AU MODÈLE,
      qui n'a aucun outil pour autoriser — et n'en aura pas, ce serait une
      initiative modèle là où seul l'utilisateur consent. Le complément dit donc
      explicitement qui agit, que le lien est **déjà affiché** (rien à
      transmettre), et que l'échec est **temporaire**. L'URL n'y est **pas
      répétée** : elle serait alors deux fois dans le contexte, dont une dans une
      phrase que le modèle pourrait recopier en réponse — remettant un lien
      d'origine réseau sur un chemin de rendu dépourvu de la garde ci-dessus.
    - **Doctrine permanente, en plus du tool result.** `AUTHORIZATION_DOCTRINE`
      (tools.js, partie inconditionnelle de `ROOT_SYSTEM_PROMPT`) dit ce que la
      situation EST, là où le tool result dit quoi FAIRE. Sans elle, un modèle
      qui rencontre « autorisation OAuth » comble avec ce qu'il connaît —
      « vérifie ta configuration MCP », « ton token d'API est-il renseigné ? » —
      et envoie l'utilisateur déboguer une panne qui n'existe pas
      (confabulation observée en production le 2026-09-07, **malgré** un tool
      result correct : `help.md` couvre pourtant le sujet, mais le modèle ne le
      lit que s'il appelle `miaou__about`, ce qu'il ne fait pas quand il croit
      avoir compris). Elle écarte donc les fausses pistes **nommément** — dire
      seulement « ce n'est pas une panne » le laisse libre de proposer quand
      même le mauvais remède. Statique et inconditionnelle comme ses voisines :
      la conditionner à la présence de serveurs MCP la rendrait dynamique d'un
      tour à l'autre (piège 16) pour trois phrases.
    - **Pas de rejeu automatique** : la génération se termine normalement.

16. **Surface `_meta` : savoir avant l'échec (campagne AB-5).** Le contrat du
    point 15 est un contrat de **récupération** : il ne se déclenche qu'une fois
    un appel refusé. Tant qu'il était seul, la seule façon pour l'utilisateur de
    découvrir qu'une autorisation manquait était que le modèle échoue — et la
    carte MCP affichait « ● Connecté — 34 outils » pour un proxy dont six
    refuseraient.
    - **Le véhicule** : `tools/list` porte un `_meta` sous la clé
      `miaou/unauthorized_upstreams` (`UNAUTHORIZED_UPSTREAMS_META_KEY`,
      utils.js), énumérant `{name, authorize_path}`. Il arrive dans le **même
      objet** que `listed.tools`, donc sans requête ni changement de transport.
      Contrat publié par `miaou-mcp-servers` (son `CLAUDE.md`, section « Où l'on
      autorise, et à qui on le dit ») : **clé absente** quand il n'y a rien à
      signaler, jamais un tableau vide ; **liste** dès la première version, un
      proxy pouvant avoir N upstreams en attente.
    - **Extraction défensive, sans exception.** `unauthorizedUpstreamsFromList`
      (utils.js, pure) rend **toujours un tableau**. `connectMcpServer` dégrade
      gracieusement par contrat — tout ce qui y lève marque le serveur en erreur
      et masque **tous** ses outils : une surface facultative ne doit jamais
      pouvoir déclencher ça. Une entrée sans nom est écartée ; une entrée sans
      chemin est **conservée** (elle s'affiche, sans action) — savoir qu'il faut
      autoriser reste utile même sans savoir où cliquer, même doctrine que
      l'ack sans lien.
    - **État** : posé sur `_remoteStatus[name].unauthorizedUpstreams`, dont il
      partage exactement la durée de vie et l'origine (session, reconstruit à
      chaque connexion). La branche d'erreur de `connectMcpServer` réécrit
      l'objet **en entier**, donc l'information disparaît à la déconnexion —
      comportement voulu.
    - **Garde de COMPOSITION, distincte de la garde d'URL.**
      `composeAuthorizationUrl(serverUrl, path)` (utils.js, pure) compose
      l'origine de `server.url` avec le chemin du proxy. **Ce n'est pas**
      `authorizationUrlOrigin` et il ne faut pas l'y renvoyer : celle-ci défend
      contre une URL **dictée par un tiers** dans un message d'erreur (modèle de
      menace du point 15), alors qu'ici l'origine est celle que l'**utilisateur**
      a saisie dans le drawer — lui appliquer la garde de l'ack sous-entendrait
      qu'elle vient d'ailleurs. Ce qui reste à garder est plus étroit et c'est le
      **chemin**, qui vient du réseau : enraciné (`/`), jamais protocol-relative
      (`//autre.hote/x` changerait d'hôte), sans schéma, sans caractère de
      contrôle. L'origine vient de `server.url` et **jamais du proxy**, qui ne
      connaît que son loopback d'écoute et publierait une adresse injoignable
      derrière un reverse proxy.
    - **Rendu** : `mcpStatusPill` (utils.js, pure) rend l'état ET le libellé de
      la pill de carte — **quatrième état** `pending`, ni `ok` ni `err` : le
      serveur est connecté, ses outils sont listés, et certains refuseront.
      Extrait de `renderMcpCard` où il était composé inline, précisément parce
      que c'est le cas qu'on rend mal. Sous la pill, une ligne par upstream avec
      un **bouton** (pas un lien nu : l'affordance de l'ack est discrète parce
      qu'elle s'insère dans une ligne d'erreur, ici l'action est franche, et
      l'origine n'a pas à être affichée puisqu'elle est celle de la carte).
    - **Pastille de topbar** : `resolveAuthorizationPending` (utils.js, pure)
      décide de l'apparition et du libellé, `syncAuthorizationPending` (ui.js)
      applique — même séparation que `resolveAgentCount`/`syncAgentCount`. Elle
      compte des **serveurs**, pas des upstreams : elle dit combien de cartes
      ouvrir, le détail vit dans la carte. Son clic (`onAuthPendingClick`, ui.js)
      mène à ces cartes comme le clic d'un toast qui nomme un serveur
      (`revealServerCard`, cf. `docs/toasts.md`) : toutes celles qu'elle compte
      sont signalées, la première dans l'ordre du drawer est amenée en vue. La
      liste est relue AU CLIC (`pending.servers`), jamais mémorisée au rendu.
    - **Deux compteurs, deux mots.** La pastille dit « 1 **serveur** à
      autoriser » et la carte « 2 **services** à autoriser » : les comptes ne
      portent pas sur la même chose (les cartes à ouvrir d'un côté, les upstreams
      d'un proxy de l'autre), et le même mot à quelques pixels d'écart
      désignerait deux niveaux. « Service » est le mot que `src/help.md` emploie
      déjà pour ce à quoi un serveur compagnon donne accès — pas un terme forgé
      pour l'occasion. Les tests QuickJS épinglent les deux libellés, et
      `verify-authorization-pending.mjs` les vérifie côte à côte sur le même
      écran : c'est ce qui empêche l'un de dériver vers l'autre. Sœur de `.agent-count`, jamais un
      enrichissement de `.model-pill` (état du backend LLM : deux domaines dans
      un composant lu en permanence se confondraient). Sa pastille ne **pulse
      pas** — `.agent-count` anime parce qu'elle dit « ça travaille », ici rien
      ne travaille, quelque chose attend.
    - **Point de synchronisation** : accroché aux **deux** fonctions de rendu
      des cartes (`renderMcpServers` ET `renderMcpServersIfOpen`), jamais à
      chacun des sites qui mutent l'état MCP. Ceux-ci sont nombreux (connexion,
      déconnexion, sauvegarde, suppression, toggle, boot, revérification) et
      convergent tous vers un rendu : en câbler sept laisserait le huitième
      mentir en silence. `renderMcpServersIfOpen` garde son propre appel parce
      qu'elle tourne au boot avec le drawer fermé, et que la pastille n'a pas à
      attendre qu'on ouvre un drawer pour signaler.
    - **Retour d'autorisation** : rien ne prévient MIAOU qu'un parcours a
      abouti — il se déroule dans un autre onglet, entièrement côté proxy, qui
      n'a aucun canal retour. `recheckMcpServers` (main.js) réagit au **retour
      de focus**, seul signal disponible et exact : c'est le moment où
      l'utilisateur revient. **Pas de polling.** Elle ne reconnecte que les
      serveurs **en défaut** — reconnecter tout à chaque retour d'onglet serait
      un effet de bord non demandé sur le chemin le plus fréquent de
      l'application (cf. point 18 pour l'élargissement aux serveurs en erreur et
      le second signal).

17. **Consignes de portée serveur (`instructions` de l'InitializeResult, ou du
    DiscoverResult en moderne).** Les
    seuls champs qu'un client relaie au modèle par outil sont `name`,
    `description`, `inputSchema`. Une consigne valant pour un serveur **entier**
    (« lis telle documentation avant d'utiliser ces outils ») n'avait donc
    d'autre issue que d'être recopiée à l'identique dans N descriptions, où elle
    ne discrimine aucun outil et n'aide ni à choisir ni à appeler. `instructions`
    est le seul emplacement du protocole à cette portée. Champ **standard MCP**,
    pas une extension maison — et une piste « `preflight_skill` dans le `_meta`
    par outil » a été évaluée puis écartée côté serveur : `_meta` est un canal
    serveur→**client**, il n'a aucune place dans le format de requête d'un
    fournisseur de LLM. Ne pas y revenir.
    - **Lecture** : `connectMcpServer` recevait déjà le résultat d'`initialize`
      et le **jetait** — seul l'en-tête `Mcp-Session-Id` de la même réponse était
      lu. Le champ est **optionnel et absent chez la majorité des serveurs** :
      lecture défensive, aucun log, aucune branche d'erreur, exactement la
      posture du point 16. Posé sur `_remoteStatus[name].instructions`, dont il
      partage durée de vie et origine. **Deux sources selon l'ère** (lot AM) :
      `init.instructions` en legacy, `discover.instructions` en moderne — même
      contenu, mesuré sur le proxy — lues par le même pur `mcpInstructionsFrom`.
      Tout l'aval (`mcpInstructionSources`, bloc système) est inchangé.
    - **Injection dans le message SYSTÈME** (révision de la campagne cache ;
      voir ci-dessous pourquoi la décision initiale est inversée).
      `buildMcpInstructionsBlock` (utils.js, pure) est appelée depuis
      `systemMessageParts` (main.js), qui place le bloc
      `<miaou_mcp_instructions>` après la doctrine intent et avant les souvenirs
      de profil.
    - **Pourquoi l'inversion.** La version initiale plaçait ce bloc dans le
      préfixe éphémère en invoquant le piège 16, au motif que les consignes
      « apparaissent et disparaissent au branchement/débranchement d'un serveur,
      à un ré-handshake, au renommage d'une carte ». Le raisonnement confondait
      **varier** et **varier à chaque tour** : ces trois événements sont des
      gestes explicites de l'utilisateur, rares et isolés — chacun invalide le
      préfixe **une fois**, puis il se re-stabilise. Le piège 16 dit en toutes
      lettres que ce qui compte est la stabilité d'un tour à l'autre, pas
      l'immuabilité, et qu'il vise les invalidations **récurrentes** : il ne
      couvrait donc pas ce cas. Le coût du placement éphémère, lui, était bien
      récurrent — le bloc étant collé au dernier message user, il **glissait**
      derrière chaque nouvel envoi et n'avait structurellement jamais l'occasion
      d'être servi par un cache par préfixe, quand bien même son contenu
      n'aurait pas bougé de toute la conversation.
    - **Le préambule du proxy est FAUX D'UN CRAN une fois passé par MIAOU**, et
      c'est toute la raison du parsing. Le proxy écrit « les outils sont
      préfixés `<serveur>__<outil>` » : littéralement vrai pour un client qui
      lui parle en direct, faux pour MIAOU qui re-préfixe du slug de la carte et
      expose `<slug>__<serveur>__<outil>`. **MIAOU est le seul à connaître ce
      slug** — choisi par l'utilisateur, renommable à tout moment — et c'est
      exactement pourquoi le proxy ne le porte pas en configuration : l'y mettre
      dupliquerait une donnée qui vit côté client, avec dérive garantie au
      premier renommage. `splitMcpInstructionSections` (pure) sépare donc
      préambule et sections `## <nom>` ; le préambule reçu est **ignoré** (il ne
      porte que cette convention), les corps de section passent **verbatim** —
      c'est du texte d'auteur, MIAOU n'en réécrit que le cadre. **Une seule
      retouche du corps** : tout jeton ENTRE ACCENTS GRAVES qui commence par
      `<serveur>__` reçoit le préfixe de carte (`rewriteMcpUpstreamToolPrefixes`,
      mcp-skills.js, appliquée par `mcpInstructionSectionsForServer`, donc aux
      deux surfaces). Sans elle, le bloc des skills que le proxy génère (« avant
      tout appel d'un outil `bench__…` ») contredisait à chaque tour le titre de
      section `<slug>__bench`. Bornée aux accents graves : la prose (« les outils
      bench ») et les URI ne bougent pas. Le préambule, lui, reste jeté.
    - **Le rattachement compte autant que l'injection.** Plusieurs serveurs
      peuvent publier ; un bloc dont on ne sait plus à quels outils il s'applique
      est **pire qu'absent** — le modèle appliquerait à tous une règle qui n'en
      couvre qu'une partie. `mcpInstructionSectionsForServer` (pure) titre chaque
      section du **préfixe réel** : `<slug>__<serveur>` pour un agrégateur,
      `<slug>` seul pour un serveur unitaire (dont les outils sont
      `<slug>__<outil>`). C'est un **préfixe, jamais un nom d'outil complet** :
      la consigne porte sur tout ce qui commence par là.
    - **Le cas unitaire tient sans branche dédiée** : un texte sans aucune
      entête `## ` tombe entièrement dans la part préambule, que
      `mcpInstructionSectionsForServer` reprend sous le slug. Il n'y a pas de
      convention à respecter pour un serveur qui n'agrège rien.
    - **Source** : `mcpInstructionSources` (mcp.js) lit `_remoteStatus`, **pas
      la config** — une consigne n'existe que pour un serveur dont le handshake a
      abouti. Un serveur en erreur n'expose aucun outil (dégradation gracieuse) :
      injecter ses consignes décrirait l'usage d'outils absents, pire que le
      silence.
    - **Coût visible** : entrée `mcp_instructions` du manifeste de contexte
      (« Consignes des serveurs MCP »), avec sa couleur dans `CTX_PALETTE`.
      Aucun réglage : le bloc est vide quand personne ne publie, donc zéro token
      dépensé pour le cas majoritaire.
    - **Lisible à l'écran** : le sous-drawer « Voir les outils exposés » affiche
      la consigne **en tête de la section du serveur qu'elle couvre**
      (`buildToolNsInstructions`, ui.js), rendue en Markdown. L'index
      `mcpInstructionsByPrefix` (utils.js, pure) est clefé par le **préfixe
      d'outil**, c'est-à-dire exactement le `namespace` que `groupByNamespace`
      rend au drawer : le rendu fait un lookup direct, il ne reconstruit aucun
      nom. Surtout, il passe par `mcpInstructionSectionsForServer` comme le bloc
      injecté — **un seul découpage pour les deux surfaces**. Deux découpages
      parallèles divergeraient en silence et l'écran deviendrait un témoin
      trompeur de ce que le modèle reçoit réellement ; un test QuickJS vérifie
      cette équivalence sur le contenu, pas seulement sur les clefs. Le texte
      venant d'un serveur distant, il traverse `renderMd` (marked + DOMPurify)
      et jamais une concaténation de chaînes — même posture que pour le markdown
      du modèle (piège 21).
    - **Témoin de bout en bout** : `mcp_bench` publie une consigne demandant au
      modèle de clore sa réponse par « banc d'essai bench — résultat non
      contractuel » après tout usage d'un outil `bench`. Cette ligne ne peut pas
      être produite par hasard : sa présence après un appel `bench` prouve
      **lecture ET rattachement** ; son apparition après un appel à un autre
      serveur prouverait le rattachement défaillant.

18. **Reprise d'un serveur tombé : trois surfaces, un seul prédicat de défaut.**
    Le point 16 traitait l'autorisation manquante ; un serveur simplement
    **injoignable** (proxy pas encore démarré, machine réveillée, VPN coupé)
    n'avait lui aucune reprise : la seule issue était d'ouvrir le drawer et de
    sauvegarder la carte pour forcer un handshake. Trois affordances, de la plus
    explicite à la plus passive :
    - **Glyphe de reconnexion par carte** (`onRefreshMcpCard`, main.js). Présent
      sur toute carte **enregistrée et activée**, pas seulement en erreur : le
      geste sert autant à réparer qu'à **relire la liste d'outils** d'un serveur
      sain dont le proxy vient de gagner un upstream — sans lui, rafraîchir
      exigeait de sauvegarder la carte, donc de simuler une modification. Le
      bouton se désarme pendant le handshake (deux clics lanceraient deux
      `connectMcpServer` concurrents, le second écrasant le statut du premier) et
      n'est jamais réarmé à la main : le `renderMcpServers()` final reconstruit
      la carte. Le serveur est relu par `getMcpServer(name)` et non capturé à la
      construction de la carte — un autre onglet a pu changer l'URL entre-temps.
    - **Reprise au retour de l'utilisateur**, sur **DEUX** signaux et non un :
      `visibilitychange` ne couvre que le changement d'onglet, or un serveur MCP
      se démarre **en console** — le navigateur reste visible tout du long,
      l'onglet ne se cache jamais. Sans `window` `focus`, le cas d'usage
      principal (« je lance le proxy, je reviens ») ne déclencherait rien. Le
      recouvrement des deux est sans conséquence : `recheckMcpServers` ne fait
      rien quand aucun serveur n'est éligible. Le choix de qui l'est vit dans un
      pur, `shouldRecheckMcpServer(status, lastAttempt, now, minIntervalMs)` :
      un serveur **en défaut** (erreur ou upstream à autoriser) est retenté
      **sans délai** — c'est le cas d'usage, on lance le proxy et on revient, et
      un throttle le rendrait muet juste après l'échec qu'on veut réparer ; un
      serveur **sain** l'est au plus une fois par `MCP_RECHECK_MIN_INTERVAL_MS`
      (2 min), ce qui permet de relire sa liste d'outils — un proxy peut gagner
      un upstream sans rien dire — sans transformer chaque retour de fenêtre en
      handshake, qui était la réserve du point 16. Un serveur `connecting` n'est
      jamais relancé (une tentative est en vol).

      Le throttle est **par serveur**, porté par `_mcpLastAttempt` (mcp.js) —
      registre **séparé** de `_remoteStatus` et non un champ de plus : la branche
      d'erreur de `connectMcpServer` réécrit ce dernier EN ENTIER, donc un
      horodatage posé dessus serait perdu à chaque échec, c'est-à-dire
      exactement là où il faut savoir quand on a essayé. Il est écrit à
      l'**entrée** de `connectMcpServer` (deux retours rapprochés pendant un
      handshake lent doivent voir la tentative en cours) et effacé par
      `disconnectMcpServer` (un serveur recréé sous le même nom hériterait sinon
      du throttle de son prédécesseur). Un horodatage global, lui, ferait qu'un
      serveur ajouté à l'instant bloquerait la vérification de tous les autres.

      Elle n'utilise **pas** `pending.servers` pour
      choisir quoi reconnecter : ce champ ne porte que le niveau de sévérité
      affiché, alors qu'il faut ici retenter les deux. La pastille répond à
      « qu'affiche-t-on ? », pas à « que retente-t-on ? ».
    - **Pastille de topbar, une seule pour deux sévérités.**
      `resolveAuthorizationPending` rend désormais une `severity` (`error` >
      `pending`) et n'affiche que le niveau le plus haut, `servers` ne listant
      que celui-ci. Décision explicite : l'attente d'autorisation est **masquée**
      tant qu'un serveur est KO. Elle redevient visible dès la réparation, sans
      rien à réconcilier — la pastille est **recalculée** à chaque rendu depuis
      `mcpStatusSnapshot()` et ne mémorise aucun état (un test épingle la
      transition). Le motif : l'utilisateur mené au drawer par la rouge y voit de
      toute façon la cause de la jaune sur la carte voisine. Côté DOM,
      `syncAuthorizationPending` **retire** les deux classes avant de poser celle
      qui vaut : sans le retrait, une pastille passée d'erreur à attente
      resterait rouge — précisément la transition qu'on veut voir se produire.
      L'infobulle a quitté le markup pour la même raison : deux écrivains pour un
      attribut, dont l'un ne s'exprime qu'au boot. Elle est posée par `setTip`
      APRÈS le libellé (la règle ARIA lit le texte visible au moment de
      l'appel), en deux étages quand un serveur est injoignable (lot AH).

19. **`_meta` d'un appel `tools/call` : métadonnées de page (lot AI).** Un
    précédent distinct du point 16, qui lit le `_meta` de `tools/list` : ici
    c'est celui du RÉSULTAT d'un appel, canal hors modèle d'un outil vers
    l'application. `fetch_url` (`mcp_web`, miaou-mcp-servers) y pose
    `_meta["miaou/web"] = { title, site_name, canonical_url, favicon }`, tous
    facultatifs, clé préfixée `miaou/` comme `miaou/unauthorized_upstreams`
    (anti-collision dans l'espace partagé `_meta`). `favicon` est une data-URL
    matricielle plafonnée à 16 Ko encodés côté serveur. Rien de tout cela
    n'entre dans `content` : le modèle cite une URL et n'a pas besoin du titre,
    qu'il paierait sinon à chaque tour.
    - **Chemin** : `callRemoteTool` (mcp.js) relaie `result._meta` sur ce qu'il
      rend ; api.js en extrait ce qu'il sait lire par `webMetaFromResult`
      (utils.js, pure — textes aplatis et bornés, URL restreinte à http(s),
      favicon revalidée par `isSafeIconSrc` : un serveur n'est pas de confiance)
      et le passe à `onEnrichLastAck`, qui le pose sur l'ack en `webMeta`.
    - **Trois hooks, une liste** : `onEnrichLastAck` existe en trois copies
      (écran dans main.js ; agent et parent réveillé dans agents.js). Elles
      recopiaient à la main la même liste de champs ; elles passent désormais
      toutes par `ackEnrichmentFields` (utils.js), sans quoi `webMeta` aurait
      manqué aux fils d'agent.
    - **Persistance** : `webMeta` est dans `ACK_COPY_FIELDS`. Il reste hors
      émission par construction (`expandThread` n'envoie que `result` et
      `args`). Il ne sert qu'au libellé et à l'infobulle des pastilles de source
      (`webSourceRegistry`, cf. `docs/tools.md`), jamais à la provenance. Pas de
      dédoublonnage des favicons par domaine : stockage par ack, borné.
    - **Second usage, `miaou/search`** : `search` et `image_search` de
      `mcp_web` posent `_meta["miaou/search"] = { engine }`, le moteur qui a
      répondu dans leur chaîne de repli (`brave`, `ollama`, `ddg`). Clé
      distincte de `miaou/web`, pour ne pas passer pour un en-tête de page
      vide ; absente quand aucun moteur n'a répondu (le résultat n'est alors
      qu'un texte d'échec). Le même nom figure dans le JSON servi au modèle,
      mais c'est `_meta` qui fait foi pour l'affichage. Même chemin que
      `webMeta` : `searchEngineFromResult` (utils.js, pure — identifiant court
      sans espace, sinon `null`), champ d'ack `searchEngine` (dans
      `ACK_COPY_FIELDS` et `ackEnrichmentFields`), rendu en queue de la ligne
      technique par `refreshAckTail` (cf. `docs/tools.md`).

20. **Révision 2026-07-28 : sonde d'ère et repli sur `initialize` (lot AM).**
    La révision 2026-07-28 supprime le handshake et la session : chaque requête
    porte sa version, et le serveur se découvre par `server/discover`. Les
    serveurs anciens (SDK 1.x, et tout upstream tiers) ne la parlent pas. MIAOU
    parle donc les deux, et tranche **par serveur, à chaque connexion**.
    - **Ère en mémoire seulement** : champ `era` (`'modern'` |
      `'legacy'`) de `_remoteStatus[name]`, même durée de vie que `sessionId`,
      avec `protocolVersion` (la révision effectivement parlée : 2026-07-28, ou
      celle que rend l'`initialize`). Persister économiserait une requête mais
      figerait un verdict : un serveur mis à jour resterait legacy.
    - **Sonde** : `probeMcpEra` envoie `server/discover` en moderne
      (`opts.era` force l'ère avant qu'elle soit connue), **via `mcpRpc`** comme
      toute méthode. Les verify qui stubent `mcpRpc` par nom de méthode rendent
      `{}` à celle-ci, ce qui vaut repli : ils couvrent le chemin legacy sans
      retouche. Verdict par le pur `mcpProbeVerdict`, calé sur
      `client/_probe.py` du SDK en **liste d'exclusion** — tout ce qui n'est pas
      une preuve positive (`supportedVersions` contenant 2026-07-28) se replie,
      sauf trois échecs francs : délai dépassé (un serveur muet ne répondra
      pas mieux à `initialize`), 401/403 (l'authentification ne dépend pas de
      l'ère), et `-32022` dont `data.supported` ne contient aucune version de
      handshake (`MCP_HANDSHAKE_PROTOCOL_VERSIONS`). **Écart délibéré avec le
      SDK** : un échec réseau (`TypeError` de `fetch`, marqué `network`) se
      replie aussi, parce que dans un navigateur un CORS qui refuse les nouveaux
      en-têtes est indiscernable d'un serveur éteint. Mesuré sur un 1.x à CORS
      restreint : le préflight échoue. Un serveur réellement éteint échoue alors
      deux fois, vite ; un 1.x à CORS restreint affiche le refus en rouge dans
      la console à chaque connexion — bruit, pas défaut.
    - **Ce que porte une requête moderne** : construit en UN point,
      `mcpRequestShape` (pur), appelé par `mcpRpcAttempt` seul — l'appel direct
      de tools.js (description de fichier de bibliothèque) en hérite sans
      retouche. En-têtes `MCP-Protocol-Version`, `Mcp-Method`, et `Mcp-Name`
      pour une méthode à cible (`MCP_NAME_BEARING_METHODS` ; MIAOU émet
      `tools/call` et `resources/read` — point 21 —, et le proxy refuse en 400
      `-32020` un `Mcp-Name` absent ou différent de l'URI, mesuré), valeur passée par `encodeMcpHeaderValue` (port de
      `encode_header_value` : enveloppe `=?base64?…?=` hors ASCII imprimable,
      sans quoi `fetch` lève sur un nom accentué). Enveloppe `params._meta`
      (`io.modelcontextprotocol/protocolVersion`, `…/clientCapabilities` vide —
      l'extension Skills n'exige aucune capacité client —, `…/clientInfo`), `params` COPIÉ et jamais
      muté, un `_meta` existant conservé. Ni `Mcp-Session-Id`, ni
      `initialize`, ni `notifications/initialized`. `Mcp-Param-*` n'est pas
      émis : un upstream tiers qui annoterait `x-mcp-header` serait refusé (hors
      périmètre).
    - **Legacy inchangé, sans en-tête de version**, bien que 2025-06-18
      l'exige : un serveur dont le CORS a fait échouer la sonde refuserait le
      même en-tête ici, et le repli casserait là où il sert.
    - **Corps des réponses non 2xx, dans les deux ères.** `mcpRpcAttempt` levait
      `HTTP <statut>` sans lire le corps : message perdu, `applicative` faux, et
      `noteMcpCallFailure` déclarait **injoignable** un serveur qui venait de
      répondre. Défaut latent en legacy, bloquant en moderne, où toute erreur de
      dispatch arrive en 400/404 avec un corps JSON-RPC — **mesuré : y compris
      `AUTHORIZATION_REQUIRED`, qui arrive en 400** (en 200 en legacy). Le
      corps est désormais lu (`readMcpErrorBody`, JSON annoncé seulement, ne lève
      jamais) et l'erreur construite comme sur un 200 par `mcpHttpFailure` /
      `mcpJsonRpcError` (purs) : `message`, `data` (contrats du point 12 et du
      point 15 intacts), `applicative`, plus `rpcCode` et `status` que lit la
      sonde. Session morte d'abord, cf. point 9. REF_UNKNOWN, lui, arrive en 200
      dans les deux ères.
    - **Changement d'ère en cours de vie** : rien d'automatique. Une
      requête moderne vers un serveur redescendu en 1.x reçoit 400 « Missing
      session ID », affiché comme erreur ; la reconnexion (glyphe, retour de
      focus, point 18) refait la sonde. Un rejeu calqué sur `staleSession`
      manquerait de signal propre : ce 400 ne dit pas « je suis legacy ».
    - **Visibilité** : la révision parlée est dans l'infobulle de la pill
      de carte (`mcpStatusPill` rend `tip`, serveur connecté seulement), pour le
      diagnostic. Pas de `help.md` : aucune capacité nouvelle pour
      l'utilisateur.
    - **Ignoré pour l'instant** : `capabilities` du DiscoverResult hors
      `extensions` (lue pour les skills, point 21),
      `_meta["io.modelcontextprotocol/serverInfo"]` (la clé
      apparaît aussi dans le `_meta` de `tools/list` et `tools/call`, que
      `unauthorizedUpstreamsFromList` et `webMetaFromResult` ignorent puisqu'ils
      ne lisent que leur propre clé), `ttlMs`/`cacheScope`, et
      `resultType: "input_required"` (MIAOU ne déclarant ni elicitation ni
      sampling, le serveur refuse en `-32021`, lu comme erreur applicative).
    - **Tests** : les purs en QuickJS (test-tools.js, une ligne de verdict par
      cas) ; le chemin async ne l'est pas (point 3). Vérifié sur le fil contre
      le proxy migré (branche moderne, AUTHORIZATION_REQUIRED entre deux proxys)
      et contre un serveur SDK 1.28.1 (repli sur 400, port fermé, `staleSession`
      par redémarrage). Le repli sur `TypeError` de CORS ne se voit que dans un
      navigateur.

21. **Skills servies par le serveur (extension `io.modelcontextprotocol/skills`).**
    Un serveur peut servir des skills (format Agent Skills, une ressource MCP par
    fichier, `skill://…`) et en exiger une avant l'appel de ses outils. Le
    transport est l'extension standard (spec : `specification/stable/skills.mdx`
    du dépôt `modelcontextprotocol/ext-skills`) ; l'**obligation** est un ajout
    privé de miaou-mcp-servers (`_meta["miaou/requiresSkill"]` par outil, contrat
    dans son `docs/miaou-contract.md`). Les purs vivent dans `mcp-skills.js`
    (intégrité, catalogue, approbations, lecture), le réseau ici, la lecture et
    la garde dans `tools.js` (cf. `docs/tools.md`, `docs/skills.md`).
    - **Déclaration** : présence de la CLÉ dans
      `capabilities.extensions` du DiscoverResult (`mcpDeclaresSkillsExtension`) —
      la valeur publiée est un objet vide, mesuré. Ère moderne seulement : un
      `initialize` legacy ne publie jamais `extensions`, même s'il annonce
      `resources`. État `_remoteStatus[name].skillsDeclared`.
    - **Catalogue** : `skills/list` à la connexion (`listMcpSkills`, curseur
      suivi au plus `MCP_SKILLS_LIST_MAX_PAGES` fois), entrées validées et
      normalisées par `normalizeMcpSkillEntry` (URI, dernier segment = `name`,
      manifeste complet, bornes de la spec 512 fichiers / 16 Mio), rangées dans
      `_remoteStatus[name].skillCatalogue`. **Métadonnées seulement** : aucun
      contenu n'est lu à la connexion (la spec l'interdit). Une entrée invalide
      reste au catalogue avec son `problem`, pour que la fiche dise pourquoi.
      Un échec de `skills/list` rend `null` et ne fait **jamais** échouer la
      connexion : les outils sont servis, la garde reste ouverte.
    - **`_meta` des outils** : `requiresSkill` (URI relative au serveur) est
      gardé sur l'entrée de `_remoteTools` ; le reste est toujours jeté. L'outil
      de **repli** de lecture (marque `_meta["miaou/skillsFallback"]`, jamais son
      nom) est retiré de `_remoteTools` à la connexion (`shouldHideMcpTool`),
      donc aussi du drawer des outils — **seulement** si l'extension est
      déclarée : sans elle (legacy), il est le seul chemin de lecture et reste.
      Mesuré sur le proxy avec bench : 709 caractères de définitions en moins.
    - **Lecture réseau** : `fetchMcpSkillEntry` (`skills/get`, entrée FRAÎCHE,
      jamais gardée entre deux lectures — c'est l'approbation, liée au
      manifeste, qui tient lieu d'« entrée détenue » de la spec) et
      `readVerifiedMcpSkillFile` (`resources/read`, liste blanche du manifeste,
      taille puis SHA-256, frontmatter du SKILL.md). Ni l'une ni l'autre
      n'approuve rien : la lecture par le modèle exige l'approbation, le lecteur
      de la fiche (geste de l'utilisateur) non. Forme mesurée : `skills/get`
      enveloppe l'entrée sous `skill`, `skills/list` la donne nue
      (`mcpSkillEntryFromResult` accepte les deux).
    - **Identité** : (libellé de carte, URI), jamais l'URI seule ni le `name`,
      ni `serverInfo.name`. `mcpSkillCatalogues()` rend les catalogues clefés
      par carte, pour la résolution d'une lecture et la garde.
    - **Upstreams stdio et http du proxy** : le proxy les aborde en legacy et
      ne relaie pas leurs skills ; rien à faire côté MIAOU.
    - **Vérifié** : `verify-mcp-skills.mjs` (modèle stubé, proxy réel avec
      bench), rouge contre le code d'avant.

## `mcp_docs` : un fallback offline, pas un serveur de base (lot V-4)

Le lot V a rapatrié dans le navigateur ce que `mcp_docs` savait faire — le zip
(V-1), le PDF (V-4), l'Office (V-5 : Excel, Word, PowerPoint). **La parité est
atteinte depuis la clôture de V-5** : plus aucun format connu ne dépend du
serveur, et sur deux points le natif le dépasse (les headings multi-locale de
mammoth, le texte des shapes groupées d'un `.pptx`). La trajectoire **n'est pas**
pour autant la disparition du serveur : elle a été corrigée le 2026-08-28
(décision 6 de `V-4-PLAN.md`).

**Le serveur reste intact et devient un fallback offline désactivé par défaut.**
La raison est une limite que le rapatriement ne peut pas franchir : les
artefacts natifs (pdf.js, mammoth, SheetJS, fflate, QuickJS) sont des
**requêtes CDN**. Hors ligne, MIAOU n'ouvre aucun document — là où `mcp_docs`,
serveur local, le fait très bien. Le serveur n'est donc pas un héritage à
retirer une fois le travail fini : c'est **la réponse au cas sans réseau**, et
elle n'a pas d'équivalent client.

Ce que ça implique, et qui n'est **pas** de la cosmétique de documentation :

- **Le natif est le chemin nominal.** `DOCS_DOCTRINE` (v6 depuis V-5 étape 3, où
  sa puce « voir du côté serveur » a **entièrement disparu**, le PowerPoint en
  étant le dernier occupant) dit explicitement de **préférer le natif** quand un
  même outil existe des deux côtés. Sans cette phrase, un modèle qui voit `miaou__docs__read` **et**
  `miaou-proxy__docs__read` tire au sort — les deux répondent au même nom, seul
  le préfixe racine change (décision 1 du lot, délibérée).
- **Rien n'est supprimé côté serveur.** Aucune ligne retirée de
  `servers/mcp_docs/`, `pymupdf` reste déclarée. Un sous-lot qui rapatrie une
  capacité ne la retire jamais du serveur.
- **La dépendance réseau est une information utilisateur**, pas seulement
  développeur : `src/help.md` la porte (sections `pieces-jointes` et `mcp`),
  parce qu'un utilisateur hors connexion doit comprendre pourquoi son PDF ne
  s'ouvre plus et quoi faire. Depuis V-5 étape 3, la section `mcp` de `help.md`
  ne présente plus l'extraction documentaire comme une capacité qu'un serveur
  apporte, mais comme un **recours hors connexion** : c'est le seul usage qui lui
  reste, et le taire ferait de la rétrogradation un enterrement silencieux.
- **Le dépôt voisin le présente comme tel — fait à la clôture de V-5**
  (2026-08-29). Le défaut vivait dans **`config.sample.json`** (et nulle part
  ailleurs : ni script de lancement, ni valeur en dur) : son entrée `docs` porte
  désormais `_disabled: true`, avec le commentaire qui dit *pourquoi* et comment
  la réveiller. Le `README.md` du dépôt gagne une section
  « `mcp_docs` : obsolète, mais conservé pour le hors-connexion » (liée depuis le
  tableau des serveurs), et son `CLAUDE.md` un encadré au-dessus de la section du
  serveur — celui-là visant une session future, à qui il dit explicitement de
  **ne pas faire le ménage** dans un package qui ne sert plus par défaut. Rien
  n'a été supprimé côté serveur : code, tests et dépendances sont intacts
  (369 tests passent).

Le banc d'essai MCP (`mcp_bench.py`) a été extrait dans le projet
`miaou-mcp-servers`. Procédure de test manuel : `docs/manual-tests.md`.
