# Pièges déjà payés — détail

Développement complet des 16 pièges résumés dans CLAUDE.md. À consulter avant
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
