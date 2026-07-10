# Pièges déjà payés — détail

Développement complet des 23 pièges résumés dans CLAUDE.md. À consulter avant
de toucher au flux de conversation, au streaming, aux résumés/titrage, à
l'édition de message, au patienteur, au raisonnement, au sélecteur de modèle,
ou au KV cache.

1. **Un seul message `role: 'system'`.** Jamais en empiler plusieurs : certains
   backends ne gardent que le premier. `buildSystemMessage()` concatène, dans
   l'ordre : `ROOT_SYSTEM_PROMPT` (constante build-time : `BINARY_DOCTRINE` +
   `MEMORY_DOCTRINE`, toujours injectée si des outils sont présents) ;
   si `includeToolsInSystemPrompt` est vrai, `toolsSystemPrompt()` (énumération
   textuelle des outils, optionnelle) ; puis le prompt système utilisateur
   (persona/préférences, éditable en paramètres).
2. **Injection ≠ appel d'outil.** L'injection de résumés est du *texte* mis dans
   le message système par MIAOU (recherche locale). Les `tool_calls` sont
   déclenchés par le **modèle**. MIAOU n'appelle jamais d'outil de lui-même.
3. **Le résultat d'un outil n'est jamais affiché.** C'est une donnée
   intermédiaire (`role: 'tool'`, `tool_call_id` exact) renvoyée au modèle. La
   boucle `runConversation` (`api.js`) va **toujours jusqu'au `finish_reason:
   'stop'`** avant d'afficher quoi que ce soit. Borne : `MAX_TOURS` tours (pas
   une borne sur le nombre d'outils — tous les `tool_calls` d'un tour sont
   exécutés dans ce tour). **Anti-redemande par échange** : `servedKeys`
   (clé `nom:id` ou `nom:since`) court-circuite un appel déjà servi dans le même
   échange, pour les deux outils.
4. **Agrégation SSE par `index`.** Les `tool_calls` arrivent fragmentés :
   agréger strictement par `tcDelta.index`, ne jamais parser
   `function.arguments` avant la fin du stream, reprendre le `tool_call_id` exact.
   `onToolTour(content)` reçoit le contenu textuel du tour. S'il est non vide,
   l'UI le finalise dans sa propre bulle (persistée dans `currentThread`) et
   ouvre une nouvelle bulle pour le tour suivant ; s'il est vide, elle efface
   le live et repose le patienteur (`resetAssistant`). `wrap` est déclaré
   `let` dans `dispatchSend` pour permettre cette réaffectation.
5. **Pas de résumé sur conversation fraîche/avortée.** Ne résumer (en sortie ou
   au backfill) que si `hasSubstance()` : **≥1 message user ET ≥1 assistant** au
   contenu non trivial (≥8 car.). Le but est d'écarter une conversation à peine
   née ou sans vraie réponse, **pas** d'exiger plusieurs allers-retours — le
   seuil initial ≥2/≥2 (conception d'origine) excluait à tort les
   conversations courantes en 1 Q/R (symptôme : « une seule entrée dans
   miaou-summaries »). Pas de `beforeunload` (non fiable). Le backfill
   (`runBackfill`) s'auto-garde sur la **présence d'URL** seulement (pas sur
   `configured`, qui exige une clef), pour couvrir les endpoints sans auth.
6. **Tombstones.** Supprimer un souvenir pose `suppressed: true` **en conservant
   les données du résumé** (titre, texte, mots-clés, messageCount) — ça ne
   supprime pas la conversation. Une tombstone **compte comme une entrée
   présente** : elle empêche le re-résumé, et recherche/outils ignorent les
   entrées `suppressed`. « Ré-autoriser » retire le flag → **retour instantané à
   l'état d'avant** si les données sont conservées ; sinon (tombstone legacy sans
   données, ou résumé jamais généré) l'UI régénère avec un loader inline sur
   l'item (`restoreSummaryItem`, ui.js) et ne retombe sur la suppression de l'entrée
   (→ candidate au backfill) qu'en cas d'échec.
7. **Parsing défensif des résumés.** Le modèle enrobe parfois son JSON de fences
   ```` ```json ````. `parseSummaryJSON` nettoie puis `JSON.parse` ; en cas
   d'échec → `null`, abandon silencieux, aucune erreur affichée.
8. **Indicateur d'activité** via `bgActivityStart/End` (compteur, gère les
   chevauchements). **Toujours encadrer par `try/finally`** pour que
   `bgActivityEnd()` passe même en cas d'erreur. En pratique, passer par la
   mécanique réutilisable `runBackgroundTask(label, fn)` (main.js) : elle
   encadre une tâche LLM silencieuse par l'indicateur + try/finally + échec
   silencieux (retourne `null`). Titrage (`maybeTitle`) et résumé
   (`summarizeIfNeeded`) en sont deux clients. Le backfill l'enveloppe une fois
   et met à jour le libellé via `bgActivityLabel('résumés n/N')` sans toucher au
   compteur.
9. **Titrage robuste à la navigation.** `maybeTitle` fige `convId`/`thread`
   avant l'appel asynchrone ; au retour, `applyGeneratedTitle` écrit toujours en
   storage + liste, mais ne touche la barre du haut / le `<title>` que si on est
   **encore** sur cette conversation. Le titrage et le résumé tournent en
   arrière-plan (fire-and-forget) : envoi (1ʳᵉ Q/R) → titrage ; sortie de
   conversation → résumé+mots-clés ; démarrage → backfill des non-résumées.
   **Pas de titre provisoire** : tant que le titrage n'a pas abouti, la
   conversation s'affiche « Nouvelle conversation » **partout** — sidebar
   (fallback `c.title || 'Nouvelle conversation'`) et barre du haut (placeholder
   CSS `.conv-title-edit:empty::before`). Ne pas réintroduire de titre tronqué
   du 1ᵉʳ message (hétérogène : il n'apparaissait que dans la barre du haut).
   **`needTitle` : gating à un coup, par conversation.** `maybeTitle` retourne
   immédiatement si `!needTitle`, et le remet à `false` dès qu'il se déclenche
   — un seul essai de titrage automatique par conversation. Trois points
   posent `needTitle` : `ensureConversation` (nouvelle conversation, `!manualTitle`
   si un titre a été saisi à la main avant le premier envoi), `resetToEmpty`
   (toujours `false`), et `openConversation` (réouverture — doit valoir
   `!conv.title`, **pas** `false` inconditionnel : sinon toute conversation
   restée sans titre — stream avorté, réponse sous le seuil `hasSubstance`
   de 8 caractères — reste bloquée sans titre pour toujours, même après
   édition du premier message ou envoi d'un tour supplémentaire, puisque
   `maybeTitle` ne se redéclenchera jamais). Bug payé une fois (fix :
   `needTitle = !conv.title` dans `openConversation`).
   **Régénération manuelle (`regenerateTitle`, bouton topbar).** Chemin
   distinct de `maybeTitle` : ignore `needTitle` (peut retitrer une
   conversation déjà titrée, manuellement ou automatiquement), verrouille le
   titre en lecture seule pendant l'appel (`setTitleEditable(convId, false)`),
   et réutilise `applyGeneratedTitle`/`runBackgroundTask` comme `maybeTitle`.
   Ne touche pas à `needTitle` — un titrage auto ultérieur reste possible
   seulement si la conversation était encore sans titre (cas très rare une
   fois la régénération manuelle appliquée, puisqu'elle pose toujours un titre
   si l'appel réussit).
10. **Arrêt du streaming.** `streamCompletion` ouvre un `AbortController`
    (`_currentAbort`, un seul à la fois) ; `abortStream()` l'annule. Sur
    `AbortError`, on **avale** l'erreur et on retourne le contenu déjà reçu avec
    `aborted: true` (pas de rollback). `runConversation` court-circuite sur
    `result.aborted` **avant** de traiter ou relancer un tour — donc stop coupe
    aussi au milieu d'une boucle d'outils, sans relance. Côté UI, le bouton du
    composer fait office de stop pendant le stream : il **n'est jamais désactivé**
    quand `sending` est vrai (cf. `setSending`/`syncConfigured`), `onSendBtn()`
    route vers `abortStream()`, et `setComposerStreaming(on)` bascule l'apparence
    (`.streaming`, icônes `.ic-send`/`.ic-stop`).
11. **Recherche historique.** Filtre persistant module-level `convSearchFilter`
    (ui.js), appliqué par `renderConvList()` — dont la **signature reste sans
    argument** exprès, pour que tous les appelants existants (sélection, maj
    arrière-plan) le respectent sans le savoir. `searchConversations(q)` renvoie
    un prédicat (sous-chaîne sur le titre **ou** `scoreSummary >= 1` sur le
    résumé non-tombstone) ou `null`. Les en-têtes de section vides disparaissent
    car émis à la volée sur la liste déjà filtrée. Après `clearConvSearch`, on
    `scrollIntoView` la `.conv.active` (elle peut être très ancienne et hors
    écran une fois la liste complète restaurée).
12. **Édition d'un message utilisateur.** `sendMessage` et `editUserMessage`
    partagent **un seul cœur** : `runGenerationFromCurrentThread()` (recherche
    mémoire sur le dernier message user + bannière + dispatch). Ne pas dupliquer
    la logique mémoire/outils. `editUserMessage(index, text)` **tronque**
    `currentThread` après l'index, remplace le contenu, **persiste avant** de
    relancer (sinon un reload à mauvais moment laisse un thread incohérent), puis
    relance par ce cœur. L'index est **recalculé au clic** (`msgIndex` = position
    du `.msg` dans le thread, 1:1 avec `currentThread`), jamais figé au rendu.
    Édition bloquée tant que `sending` (garde dans `onEditMsg`/`enterEditMode`).
    `sendMessage` ET `editUserMessage` passent par `resolveSend(literal)` (async) :
    **chemin UNIQUE** de détection/injection de slash-commande skill (cf.
    `docs/skills.md`), invoqué des deux entrées, pas de double implémentation. Un
    slug invalide à l'édition **n'altère pas le thread** (résolution AVANT
    troncature) : la bulle reste en mode édition. `editUserMessage` **retourne**
    le message d'erreur (au lieu de l'afficher) → `commitEdit` l'affiche **sous la
    zone d'édition** (`.msg-edit-error`), pas sous le composer ; l'erreur s'efface
    à la frappe et la validation réussie reconstruit la bulle. Côté composer,
    l'erreur skill est levée par tout envoi effectif (`clearComposerSkillError`
    dans `sendUserText`). La textarea d'édition et la bulle restaurée par
    `cancelEdit` sourcent **`displayText`** (littéral), jamais le `content` baké —
    sinon fuite du corps de skill (issue corrigée).
13. **Patienteur animé.** Remplace le caret pendant l'attente : un point qui
    pulse (`.waiter-dot`, demeure) + un mot court tiré au hasard sans répéter le
    précédent (`pickWaiterWord`, fondu via `.waiter-word.fade`). `startWaiter`
    pose le markup et lance la rotation ; `stopWaiter` nettoie **les deux
    timers** (`_waiterRotate` l'interval, `_waiterFade` le timeout de mi-fondu)
    — sinon fuite ou changement de mot après coup. Posé en WAITING
    (`startAssistantMessage`) et à la reprise après un tour `tool_calls`
    (`resetAssistant`). Coupé net dès le premier delta `content` (`stopWaiter` en
    tête de `streamInto`) : **jamais patienteur + contenu en streaming
    simultanés**. Le `cursor-blink` reste, lui, le caret de frappe **pendant** le
    streaming — ne pas confondre les deux. La transition CSS `.waiter-word`
    (.28s) doit matcher le délai du `_waiterFade` (280 ms).
14. **Affichage du raisonnement (thinking).** Détection **par observation
    directe** du delta, jamais via `reasoning_effort` : `reasoningDelta(delta)`
    (api.js) lit `reasoning` / `reasoning_content` / `thinking` et renvoie la
    string (**`''` = présence**, capacité détectée) ou `null` (champ absent).
    Agrégé à part dans `streamCompletion` (jamais traité comme du content),
    relayé en live par `onReasoning(full)`, accumulé entre tours via
    `joinReasoning` (un tour `tool_calls` raisonne avant l'appel : **flush dans
    `reasoningAcc` avant d'exécuter l'outil**, pas de parallèle), puis passé à
    `onFinal(content, reasoning)`. Persisté dans un **champ séparé** du message
    (`reasoning`, à côté de `content`) ; `buildMsg`/`assistantHead` le
    re-rendent au reload sans recalcul. UI : icône dans la barre `.meta`
    (révélée par `setReasoning` à la **première substance non vide** — un
    raisonnement `''` ne révèle rien), `toggleReasoning` déplie le bloc
    `.reasoning` (mono, atténué, replié par défaut). Le bloc survit à
    `resetAssistant`/`finalizeAssistant` (ils ne touchent que `.body`).
    **Écart assumé au brief §3** : l'icône est dans l'en-tête du message (au-
    dessus du patienteur), pas littéralement « à côté », pour un seul mécanisme
    de pliage valable en live comme au reload.
15. **Sélecteur de modèle (composer).** Deux notions **strictement séparées** :
    le *modèle par défaut* (`settings.model`, global) et l'*override de
    conversation* (`conv.model`, par conversation, en mémoire via
    `currentConvModel`). `activeModel()` (main.js) résout l'un **ou** l'autre,
    jamais les deux mélangés ; c'est lui qui alimente `dispatchSend` (modèle
    propagé par `runConversation({ model })` → `streamCompletion` `o.model ||
    cfg.model`) et le champ `model` du message assistant produit. Le titrage et
    le résumé (`silentCompletion`) restent sur le **modèle par défaut**.
    `currentConvModel` est remis à `''` par `resetToEmpty` (nouvelle conv →
    défaut), restauré par `openConversation`, persisté par `setConvModel` et
    `persistCurrent`. Liste des modèles **mise en cache pour la session**
    (`loadModelsCached`, ui.js, invalidée si l'URL backend change) : **un seul
    `/models` par session/backend**, pas de re-fetch à chaque ouverture du
    dropdown. Fallback silencieux : si `/models` échoue, le sélecteur **n'appa-
    raît pas** (visibilité = `showModelSelector` **ET** cache non vide, gérée par
    `syncModelUI`) et le défaut reste utilisé. Aucun filtrage des modèles listés
    (un modèle listé peut être non fonctionnel : pas de moyen de le savoir à
    l'avance) ; **pas de retry/fallback** à l'envoi en cas d'erreur — l'erreur
    s'affiche dans la bulle (catch existant de `dispatchSend`). Changer de modèle
    **ne touche jamais** l'historique ; passer le réglage à masqué **ne réinit-
    ialise pas** les overrides déjà posés (`syncModelUI` masque, l'override
    persiste et reste actif). La pastille topbar reflète aussi `activeModel()`
    (identique au défaut quand pas d'override).
16. **Préservation du KV cache (Ollama).** `buildSystemMessage()` ne contient
    que du contenu **statique** : `ROOT_SYSTEM_PROMPT` (toujours, si outils
    présents) + optionnellement `toolsSystemPrompt()` (selon
    `includeToolsInSystemPrompt`) + prompt système utilisateur. Aucune dépendance
    à `Date.now()` ni aux résumés mémoire. Le contenu dynamique (date/heure, nom
    du modèle, bloc mémoire) est regroupé dans `buildContextBlock(matches)` et
    injecté **éphémèrement en préfixe du dernier message `role: 'user'`** dans
    `dispatchSend`, au moment de la construction du payload API — sans modifier
    `currentThread` ni localStorage. Le bloc est enveloppé dans
    `<miaou_context>…</miaou_context>` avec une instruction explicite demandant
    au modèle de ne pas acquitter ni mentionner spontanément ces informations.
    Cela préserve le préfixe `system message + historique[0..N-1]` byte-identique
    d'un tour à l'autre, ce qui permet au KV cache d'Ollama de réutiliser tout ce
    préfixe au lieu de le recalculer. Le dernier message user change de toute
    façon à chaque tour (nouvelle saisie), donc y attacher le contexte dynamique
    n'ajoute aucun coût de cache supplémentaire. Ne pas réintroduire
    `buildContextBlock()` dans `buildSystemMessage()` : le point de divergence
    serait avant tout l'historique, le cache ne profiterait plus à partir du 2ᵉ
    tour.
17. **Persistance des images jointes (content parts → descripteur, brief A
    lot 2).** Un message user portant un attachment `kind:'image'` (composer,
    trombone/drag&drop) est envoyé au modèle en **content parts OpenAI**
    (`[{type:'text',text},{type:'image_url',image_url:{url:'data:<mime>;base64,…'}}]`,
    une part par image, `buildAttachedMessageContent` — resources.js, pure)
    **seulement le tour où il est attaché**. Une fois ce tour terminé — fin
    normale (`onFinal`), tour avorté (`AbortController`, `aborted: true`) ou
    halte (`onHalt`, ask_confirmation) —, `rewriteAttachedUserMessage` (main.js)
    mute en place ce message : son `content` (tableau de parts) devient une
    **string** = les parts texte concaténées + **une ligne de descripteur par
    attachment `kind:'image'`** du message (`collapseAttachedMessageContent`,
    resources.js). C'est une invalidation **délibérée et ponctuelle** du KV
    cache (piège 16 interdit les invalidations *récurrentes*, pas une
    réécriture actée une fois par message) : à partir de ce moment, plus aucun
    base64 ne repart jamais pour cet attachment.

    Format du descripteur, EXACT et BYTE-STABLE (`formatAttachmentDescriptor`) :
    ```
    [attachment att-3: image "diagram.png", 1280x960, 214 kB — content available via miaou__recall_attachment]
    ```
    Dérivé UNIQUEMENT des champs FIGÉS du schéma attachment (`name`, `w`, `h`,
    `size`, posés au lot 1 lors du downscale/stockage) — **jamais recalculé**
    depuis les octets à un tour ultérieur, exactement comme `stampTs` n'est
    jamais recalculé pour un résultat d'outil réinjecté. Le nom `miaou__recall_attachment`
    est un choix acté : le brief d'origine écrivait `miaou__present_resource`,
    mais un outil de ce nom existe déjà dans le registre (`res_…`, id-space
    distinct) — collision signalée à l'audit, résolue par un nom d'outil
    différent (cet outil de rappel lui-même est un lot ultérieur, D4, non
    couvert ici : seul son NOM figure dans le descripteur).

    **Réécriture idempotente** (`collapseAttachedMessageContent` : si `content`
    est déjà une string, no-op) : `rewriteAttachedUserMessage` peut être rejouée
    sans effet, ce qui couvre le cas où plusieurs points d'appel (onFinal,
    onHalt, filet de sécurité en tête de `dispatchSend`) s'exécuteraient sur le
    même message. **Chemin d'abort** : `onFinal` est appelé par `runConversation`
    aussi bien en fin normale qu'après un abort volontaire (`result.aborted`,
    piège 10) — un seul point d'implémentation dans `onFinal` couvre les deux.
    En complément, un filet balaie en tête de `dispatchSend` tout message user
    **antérieur** au dernier (donc pas le message du tour en cours) encore en
    content parts — cas plus rare d'une exception réseau qui aurait
    court-circuité `onFinal` sans passer par le catch de plus haut niveau.

    **Injection texte (D3, attachments `kind:'text'`)** : traitement volontairement
    différent — le texte est injecté au tour d'attache dans un bloc fencé avec
    en-tête nom de fichier (`formatTextAttachmentBlock`) et **persisté tel
    quel, sans réécriture ultérieure** (contrairement aux images) : le texte
    est cheap et sa stabilité dès le premier tour profite déjà au KV cache — un
    aller-retour parts→descripteur n'apporterait rien pour ce cas.

    **Composition avec les slash-skills** : `sendUserText` construit le
    `content` final à partir du texte déjà baké par `resolveSend` (corps de
    skill inclus) — les blocs texte-attachment et les parts image s'ajoutent
    PAR-DESSUS ce texte baké, sans interférence entre les deux mécanismes
    (`displayText` reste le littéral tapé dans les deux cas, piège 12).
18. **Herméticité des Spaces : un seul prédicat, partout (lot C, brief D2).**
    `spaceConvIds(spaceId, convs)` (storage.js, pure — `convs` déjà chargé par
    l'appelant, pas de rechargement caché) est LA seule source de vérité pour
    « cette conversation appartient-elle au Space donné ? ». Tous les sites qui
    doivent respecter l'herméticité passent par elle (ou par une variante
    directe équivalente) — jamais par un filtre `c.spaceId === x` réécrit
    localement, qui finirait par diverger d'un site à l'autre :
    - `renderConvList()` (ui.js) filtre `listAllConversations()` sur
      `c.spaceId === activeSpaceId` avant tout regroupement par section/épinglage.
    - `searchConversations()` (ui.js) n'a pas besoin de connaître le Space : son
      closure filtre un tableau déjà scopé par l'appelant (`renderConvList`).
    - `list_conversations`/`get_conversation` (tools.js) : le modèle ne doit
      **jamais** voir ni référencer une conversation d'un autre Space —
      `get_conversation` sur un id hors-Space répond exactement le même message
      que pour un id inexistant (« Conversation introuvable ou souvenir
      supprimé. ») : **pas d'oracle** qui permettrait de déduire l'existence
      d'une conversation dans un autre Space par la différence de message.
    - Sélection d'injection de résumés : `searchSummaries(queryText, excludeId,
      spaceId)` (api.js) accepte un 3ᵉ paramètre optionnel qui exclut aussi les
      résumés hors-Space — les résumés (`miaou-summaries`) ne portent PAS de
      `spaceId` dupliqué, la jointure se fait via la conversation.
    - Mémoire (brief D3) : `buildMemoryEntriesBlock()` (main.js) injecte
      `listMemoryEntries(['profile', activeSpaceId])` — profile (global) + Space
      actif, jamais les souvenirs d'un autre Space. `create_memory` stampe
      `scope = activeSpaceId` sans exposer de paramètre scope au modèle ;
      `update_memory`/`delete_memory` vérifient `existing.scope === activeSpaceId`
      avant d'agir et répondent « Souvenir introuvable. » sinon — même posture
      sans-oracle que `get_conversation`.
    - **Bibliothèque de fichiers d'espace (lot Cbis)** : `getResourcesBySpace(spaceId)`
      (resources.js, IDB, index `by_space`) et son miroir synchrone
      `getCachedLibraryEntriesBySpace(spaceId)` (scan du cache session
      `_resourceCache`, filtre `rec.kind === 'library' && rec.spaceId === spaceId`)
      sont les points de scoping. `files__list`/`files__read` (tools.js) filtrent
      par `spaceId === activeSpaceId` ; un `file-<id>` étranger ou inconnu répond
      « Fichier introuvable. » — même posture sans-oracle que `get_conversation`/
      les mémoires (pas de distinction de message entre « existe dans un autre
      Space » et « n'existe pas »). Suppression d'un Space (`onDeleteSpaceScreen`,
      ui.js) purge aussi ses fichiers via `getResourcesBySpace` + `deleteResource`
      par entrée ; suppression d'une conversation ne touche JAMAIS les fichiers
      d'espace, y compris ceux promus depuis un attachment de cette conversation
      (ils ont été copiés à la promotion — `deleteResourcesByConversation` filtre
      par `conversationId`, absent sur un record `kind:'library'`, donc déjà
      épargné sans logique dédiée).

    **Résumé ou souvenir orphelin (conversation/entrée sans Space propre
    retrouvable)** : traité comme appartenant au **default Space** — jamais
    visible depuis un autre Space, jamais invisible partout. Concrètement :
    une entrée `miaou-memories` sans `scope` (pré-migration, ou en pratique
    impossible après `migrateSpacesIfNeeded()` mais traité par précaution)
    vaut `DEFAULT_SPACE_ID`, pas `undefined` — comparer `existing.scope !==
    spaceId` directement serait FAUX pour une entrée non encore migrée dans un
    contexte de test qui ne rejoue pas la migration ; il faut normaliser via
    `existing.scope || DEFAULT_SPACE_ID` avant de comparer. Même chose pour un
    résumé `miaou-summaries` dont la conversation associée (`loadConversation`)
    a été supprimée : `conv.spaceId || DEFAULT_SPACE_ID` si `conv` existe,
    sinon `DEFAULT_SPACE_ID` directement — jamais absent de tout Space.

    **Description de Space, pas un system prompt (brief D4, CORRIGÉ).** Le
    champ s'appelle `description` (pas `systemPrompt`) et n'est **JAMAIS un
    remplacement** : `resolveUserSystemPrompt(globalSystemPrompt, space)`
    (main.js, pure) **concatène** la description du Space actif APRÈS le
    prompt système utilisateur global (séparateur `\n\n---\n\n`, si les deux
    sont non vides), exactement comme les autres parts de `buildSystemMessage()`.
    (Le brief D4 d'origine proposait un remplacement — décision inversée
    explicitement par l'utilisateur après implémentation initiale : un Space
    porte une description contextuelle, pas un system prompt de substitution.)
    C'est la SEULE part de `buildSystemMessage()` qui varie d'un Space à
    l'autre — `ROOT_SYSTEM_PROMPT`, `toolsSystemPrompt()`, les doctrines
    intent/skills et le prompt système utilisateur global restent identiques
    quel que soit le Space. Changer de Space actif change donc le system
    message complet (la part ajoutée en fin) : **assumé et documenté**, ça
    invalide le préfixe KV cache (piège 16) au moment du switch — mais le
    message redevient statique tant qu'on reste dans le Space nouvellement
    actif, donc le cache se reconstruit normalement dès le tour suivant.

    **`<miaou_context>` (brief D4, ambiguïté confirmée OUI)** : une ligne
    statique-par-Space « Espace : &lt;nom&gt; » est ajoutée par
    `buildContextBlock()` à côté de Date/Modèle, dès que `getSpace(activeSpaceId)`
    résout un nom — y compris pour le default Space (« Espace : Général »),
    pas de cas spécial masquant la ligne côté modèle (à la différence du badge
    UI topbar, qui lui masque le default Space — deux décisions indépendantes,
    ne pas les confondre).

    **Manifeste de bibliothèque de fichiers (D4, lot Cbis)** : `contextBlockParts()`
    gagne un champ `library: buildLibraryManifestBlock(getCachedLibraryEntriesBySpace(activeSpaceId), space && space.name)`
    (main.js), consommé à la fois par `buildContextBlock()` (injection réelle,
    ajouté après `memories` dans `<miaou_context>`) et par `buildContextManifest()`
    (utils.js, entrée `space_library` — même source unique que les autres
    sous-blocs, pas de second calcul pour le context inspector). `buildLibraryManifestBlock`
    (resources.js, pure) trie par `createdAt` puis `id` (déterministe, byte-stable),
    une ligne d'intro nommant le Space (« Fichiers disponibles dans l'espace
    X : », ou une forme générique si le nom est absent — cf. retour
    utilisateur : sans elle, le modèle recevait la liste sans savoir qu'elle
    concernait spécifiquement le Space actif), puis une ligne par fichier
    `file-<id> — name (mime, size)` + description sur la MÊME ligne si elle
    existe (format confirmé — **PAS un résumé du contenu**, une description de
    ce que le fichier EST, cf. `docs/spaces.md`) ; bibliothèque vide → `''`,
    aucun bloc (pas d'en-tête creux, même logique que les autres sous-blocs, y
    compris l'intro qui n'apparaît jamais seule). Comme la description de
    Space (ci-dessus, sens différent du même mot — ne pas confondre : ici
    « description » qualifie le contenu d'un fichier, plus haut le contexte
    d'un Space — qui gagne elle aussi une intro nommant le Space, même
    retour), ce bloc casse le préfixe KV cache à chaque changement (ajout, suppression, ou atterrissage
    d'une description de fichier D7) — assumé, de même nature qu'un switch de
    Space : statique tant que la bibliothèque du Space actif est inchangée.

    **Synchronicité `contextBlockParts()` (lecture IDB en amont)** : la fonction
    reste synchrone — elle lit `getCachedLibraryEntriesBySpace` sur le cache
    session déjà peuplé, jamais un appel IDB direct. Le peuplement se fait via
    `loadSpaceLibrary(spaceId)` (resources.js, fire-and-forget, symétrique à
    `loadConversationResources`), appelé à `init()` (activeSpaceId initial) et
    dans `pickSpace()` (ui.js, switch de Space). Cache **unifié** avec les
    attachments (`_resourceCache`, pas de second cache dédié) : un record
    library s'y distingue par `kind === 'library'` + `spaceId`, un attachment
    par `attId` + `conversationId` — jamais les deux à la fois sur un même
    record. Conséquence assumée : au tout premier rendu juste après un switch
    de Space, le manifeste peut refléter un cache pas encore peuplé (retard
    d'un tick), identique au comportement déjà existant pour les attachments
    d'une conversation qui vient d'être ouverte.

    **Injection de `<miaou_context>` sur un message en content parts** :
    `dispatchSend` ne peut plus concaténer une string sur `threadMsgs[lastUserIdx].content`
    si celui-ci est un tableau (produirait `[object Object]`) — `prefixTextInContentParts`
    (resources.js) insère le préfixe dynamique DANS la première part `text`
    existante (ou en crée une en tête si le message n'a que des images).

    **Durcissement `generateTitle`/`generateSummary`** (api.js) : ces fonctions
    concaténaient `m.content` en supposant une string — un message en content
    parts aurait produit `"user: [object Object],[object Object]"`.
    `messageTextForSummary` (utils.js) normalise : `displayText` en priorité,
    sinon extraction des SEULES parts `text` d'un tableau de content parts,
    sinon `content` tel quel.

    **Dégradation vision-less (D5)** : si l'endpoint/modèle rejette les content
    parts image (HTTP 400) ou est déjà connu non-vision cette session, MIAOU
    envoie texte + descripteurs à la place et ajoute une ligne dans
    `<miaou_context>` (jamais le system message, piège 16) signalant la
    dégradation — pas de strip silencieux. Cache session scopé **(endpoint,
    modèle)** — pas juste l'URL — sur le modèle de `_reasoningEffortRejected`
    (`_visionRejected`/`isVisionRejected`/`markVisionRejected`, api.js) : un même
    endpoint peut exposer un modèle vision-capable et un autre qui ne l'est
    pas, on ne veut pas dégrader le second sur le rejet du premier. Un SEUL
    rejeu par tour : `streamCompletion` détecte un 400 avec des `image_url`
    dans le payload, marque le flag AVANT l'appel récursif (`degradeVisionMessages`
    + `injectVisionDegradedNote`), puis rejoue — le flag posé empêche une
    boucle si le rejet a une autre cause. Sur les tours suivants (flag déjà
    posé), la dégradation est faite PROACTIVEMENT avant même le premier appel
    réseau, pour ne pas reproduire le même rejet à chaque tour.

19. **Recall d'image : ré-injection via message user synthétique, jamais dans
    `role:'tool'` (brief A2, D3).** Un `recall_attachment` portant sur une image
    ne remet PAS les pixels dans le résultat de l'outil : un tool result est
    `role:'tool'` textuel, et une part image n'y a pas sa place fiable. Le
    handler renvoie donc un tool result *annonciateur* (texte), et l'image
    revient au modèle via un **message user synthétique** porteur de la content
    part image, émis par `expandThread` **après** les tool results du groupe. Ce
    message n'existe pas dans `currentThread` : la dataUrl est reconstruite depuis
    le record en cache par le pré-pass `resolveRecallImages` (resources.js) à
    **chaque** envoi (champ `recallImage` posé sur une *copie* de l'ack), et
    n'est **jamais persistée** — absente d'`ACK_COPY_FIELDS`, seul `attId` l'est
    → byte-stable, KV-safe (piège 16/17).

    Raison du choix (probe 2026-07-05, `mistral-small3.2` sur Ollama) : une part
    image glissée dans un message `role:'tool'` transmet bien les pixels sur
    Ollama MAIS **confabule silencieusement** quand la part est ensuite strippée
    (contexte tronqué, `num_ctx`) — le modèle décrit une image qu'il ne voit
    plus. Le message user, lui, échoue *honnêtement* (« AUCUNE IMAGE ») : on
    préfère un échec visible à une hallucination crédible.

    Corollaire du collapse-timing (piège 17, D2) : la transformation
    image→descripteur ne se fait **jamais entre deux appels d'une même boucle
    d'outils**. Le payload `apiMessages` est construit UNE fois avant la boucle
    `runConversation`, puis seulement complété par push ; le collapse
    (`rewriteAttachedUserMessage`) n'a lieu qu'en `onFinal`/`onHalt`, donc après
    la fin de l'échange — jamais au milieu d'un groupe de tool calls.

20. **Résumé orphelin après suppression concurrente.** `summarizeIfNeeded`
    (main.js), `restoreSummaryItem` (ui.js) et la boucle de `runBackfill`
    (main.js) appellent tous `generateSummary` (LLM, async) puis `saveSummary(id,
    …)`. Si la conversation `id` est supprimée (`deleteConv`) **pendant**
    l'`await`, `deleteSummaryEntry(id)` a déjà tourné et nettoyé (rien à
    nettoyer, le résumé n'existait pas encore) — mais le `saveSummary` qui suit
    la résolution de l'`await` **réécrit** une entrée dans `miaou-summaries`
    pour un `id` absent de `miaou-conversations` : résumé orphelin ressuscité
    après coup. Fix, même pattern que le titrage (piège 9, `setTitleEditable`
    re-checke `convId === currentConvId`) mais orienté existence plutôt que
    navigation : chaque site re-vérifie `loadConversation(id)` juste avant
    `saveSummary`, et n'écrit que si elle existe encore. En complément défensif
    (résidus d'une race déjà survenue avant ce fix, ou d'une interruption avant
    `deleteSummaryEntry` dans `deleteConv`), `pruneOrphanSummariesOnInit()`
    (main.js, appelle la fonction pure `pruneOrphanSummaries(summaries, convs)`
    de storage.js) tourne à chaque `init()`, juste avant `runBackfill()` (sinon
    `backfillCandidates()` verrait une liste faussée par des entrées
    orphelines).

21. **Export HTML standalone : un seul chemin string→HTML à risque.** L'export
    (`renderExportBody`, ui.js) hérite de la sûreté de l'écran UNIQUEMENT parce
    qu'il re-rend le contenu via `renderMd`/`renderUserMd` — les mêmes renderers
    que le DOM live, dont la sortie passe par `sanitizeHtml` (DOMPurify). marked
    laisse traverser le HTML inline produit par le modèle ; c'est la
    sanitisation, pas le rendu, qui empêche un payload reproduit depuis une
    source hostile de s'exécuter. L'export ne doit **jamais** cloner ou stripper
    le `#thread` live à la place : il reconstruit depuis les données.

    `formatToolAcksHtml` (utils.js) est l'EXCEPTION : c'est la seule fonction qui
    concatène directement des chaînes d'origine modèle/outil (`name`, `intent`,
    args JSON, `result`) en HTML, sans passer par marked. `escHtml` y est donc
    **systématique** sur chacune de ces valeurs. Toute future extension de
    l'export qui ajoute un chemin de concaténation string→HTML similaire doit
    `escHtml` de la même façon — c'est la contrepartie de ne pas re-rendre via
    marked (cf. `docs/exports.md`).

22. **`EXPORT_CSS` ne suit PAS les évolutions de `chat.css`/`tools.css`/
    `composer.css`.** C'est une feuille dédiée écrite à la main (audit lot G),
    pas un miroir vivant de l'écran — assumé : un export est un instantané figé.
    **Conséquence** : retoucher une classe réutilisée par l'export (`.msg`,
    `.bubble`, `.reasoning`, `.tool-ack`, `.att-*`, tables, blocs de code) ne
    casse rien silencieusement, mais l'export continue de produire l'**ancien**
    style, et aucun test ne détecte la dérive. Seuls les tokens de couleur
    (`THEME_TOKENS`/`serializeThemeTokens`, voie `getComputedStyle`) restent
    synchronisés automatiquement. Revue manuelle à la charge de qui touche ce CSS :
    vérifier si `EXPORT_CSS` doit suivre (cf. `docs/exports.md`).

23. **Préviz HTML/SVG : la frontière est l'iframe sandbox, aucune autre voie.**
    Le bouton « œil » (`decoratePre`, ui.js) sur les blocs `html`/`svg`
    (`isPreviewableLang`, utils.js) ouvre un aperçu dans un
    `<iframe sandbox="allow-scripts">` **sans `allow-same-origin`** : origine
    opaque, donc aucun accès à localStorage (clefs API !), IndexedDB ou au DOM
    parent — un `<script>` embarqué dans le contenu prévisualisé s'exécute,
    mais confiné. C'est l'exception SANCTIONNÉE à la doctrine `textContent`
    (le seul endroit où du markup d'origine modèle atteint une surface de
    rendu sans sanitisation) ; le brief E (D2) l'a actée. Trois règles en
    découlent :

    - cette iframe ne doit **jamais** gagner `allow-same-origin` (la
      combinaison avec `allow-scripts` annule la sandbox : le contenu
      récupérerait l'origine de la page, donc le localStorage) ;
    - **aucune autre voie** d'injection de markup modèle ne doit être ajoutée
      (le SVG des diagrammes Mermaid est un cas distinct, couvert par la
      sanitisation interne de Mermaid en `securityLevel: 'strict'` — cf.
      `docs/rendering.md`) ;
    - `srcdoc` est posé par **propriété JS** (`frame.srcdoc = …`) sur un
      élément créé par `createElement`, jamais interpolé dans un template
      string HTML — il n'existe donc pas de problème d'échappement d'attribut,
      et il ne faut pas en créer un en « simplifiant » vers du innerHTML.

    L'aperçu est déclenché par un clic explicite uniquement (jamais
    automatique — posture de sécurité ET de coût du brief), et l'export HTML
    standalone n'embarque aucune iframe de préviz.
