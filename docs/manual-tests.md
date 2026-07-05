# Vérification manuelle (réseau)

Les tests automatiques (`tests/runner.py`) ne couvrent que les fonctions pures :
pas de `fetch` réel sous QuickJS. Les chemins réseau, DOM et la boucle
`tool_calls` se vérifient à la main. Avec une vraie configuration, ouvrir
`dist/miaou.html` et passer la liste ci-dessous.

1. **Backfill** : avec des conversations dans l'historique, l'indicateur
   d'activité affiche `résumés n/N` et `miaou-summaries` se remplit.
2. **Mode proposer** : poser une question liée à une conversation passée → la
   bannière mémoire apparaît avec la liste des titres pertinents et leurs dates
   relatives ; « Injecter » fait que la réponse en tient compte ; le fil défile
   vers le bas pour que le message déclencheur reste visible.
3. **Message système unique** : inspecter le payload réseau — un seul message
   `role: 'system'` contenant le prompt configuré et la doctrine mémoire (si des
   outils sont présents). Les résumés, mémoires, date/heure et modèle actif sont
   dans un bloc `<miaou_context>` préfixé au **dernier message `role: 'user'`** —
   pas dans le system. Si `includeToolsInSystemPrompt` est activé, la description
   textuelle des outils s'ajoute au system.
4. **Outil conversation** : question dont le résumé ne suffit pas → le modèle
   appelle `get_conversation` ou `list_conversations`, et on va **jusqu'à la
   réponse finale**, pas seulement jusqu'au résultat de l'outil. Un ou plusieurs
   tool-ack (icône + label) apparaissent dans la bulle assistant, entre l'en-tête
   et la réponse. Les acks de lecture n'ont pas de bouton « annuler ». Rechargement
   → acks toujours présents. Avec `intentTracing` activé et le modèle fournissant
   `miaou_intent`, l'ack `conversation_list`/`conversation_read` (et `skill_list`/
   `skill_read`) passe en rendu à deux niveaux : intention en langage naturel sur
   la première ligne, icône alignée en haut (pas centrée), chevron cliquable qui
   déplie/replie une seconde ligne de détail technique (ex. « 3 conversations
   listées » pour `conversation_list`, ou « Conversation consultée › <titre> »
   pour `conversation_read`). Pour `conversation_read`, le titre dans cette
   ligne de détail est un lien cliquable (couleur héritée, teinte accent au
   survol, pas de soulignement) qui ouvre la conversation référencée — vérifier
   que le clic fonctionne aussi bien juste après l'appel outil (rendu live) qu'après
   rechargement (conversation rouverte depuis l'historique).
4b. **`list_conversations` avec `query`** : demander « cherche dans mes anciennes
    conversations celles qui parlent de X » avec plusieurs conversations résumées
    en historique, dont une pertinente et une non pertinente sur X → le modèle
    appelle `list_conversations` avec `query`, le résultat (visible en ajoutant
    temporairement un `console.log` ou en inspectant le `role:'tool'` dans
    DevTools Network) ne contient que les conversations dont le résumé/titre/
    mots-clés recoupent la requête. La conversation **courante** (celle où la
    question est posée) n'apparaît jamais dans le résultat, même si elle a déjà
    un résumé pertinent en historique — vérifier avec au moins deux tours dans la
    même conversation (pour qu'elle ait le temps d'être résumée par un backfill
    antérieur) avant de reposer la question.
4c. **Lien `conv_ref` cliquable** : à la suite du test 4/4b, si la réponse du
    modèle mentionne une conversation par son titre, vérifier dans le texte
    affiché qu'aucun `[conv_ref:...]` brut n'apparaît, qu'un lien souligné
    affichant le **titre** de la conversation est bien rendu à cet endroit, et
    que cliquer dessus bascule la sidebar/topbar sur cette conversation (comme un
    clic sidebar classique) — y compris déclenchement du résumé de la
    conversation quittée si elle a du contenu substantiel non encore résumé
    (`hasSubstance`, cf. piège #5 de CLAUDE.md). Cliquer pendant un streaming en
    cours (`sending`) → aucune navigation.
4d. **Lien `conv_ref` vers une conversation supprimée** : noter l'id d'une
    conversation résumée (visible dans `localStorage['miaou-summaries']`),
    la supprimer via la sidebar (icône corbeille), puis dans une autre
    conversation demander au modèle de la citer — ou, plus simple, injecter
    directement une réponse assistant contenant `[conv_ref:ID_SUPPRIMÉ|Titre]`.
    Vérifier : le texte s'affiche **barré** (`Titre (supprimée)`, rendu via
    `<del>`, atténué visuellement), **pas de lien cliquable**, aucune navigation
    possible au clic dessus. Vérifier aussi qu'une conversation seulement
    **tombstonée** (souvenir supprimé via « Ré-autoriser » possible, pas
    `deleteConv`) reste, elle, un **lien cliquable normal** — le tombstone ne
    concerne que le résumé/mémoire, jamais la conversation elle-même.
5. **Plusieurs tool_calls par tour** : tous exécutés dans le même tour.
6. **Anti-redemande** : redemander un appel rigoureusement identique dans le même
   échange ne redéclenche pas le handler ; deux appels distincts du même outil
   (ex. deux `create_memory`) sont tous deux servis.
7. **Suppression réversible** : supprimer un souvenir → plus jamais re-résumé,
   même après redémarrage ; « Ré-autoriser » → régénéré au passage suivant.
8. **Souvenirs — chemin direct** : "souviens-toi que X" → le modèle appelle
   `create_memory` immédiatement, narration en un tour (pas de widget). Un
   tool-ack (icône + label + bouton « annuler ») s'insère dans la bulle ; annuler
   supprime définitivement l'entrée. Persiste au rechargement.
   **Chemin inféré** : mentionner un fait non sollicité → le modèle appelle
   `ask_confirmation`, background dim, composer actif (texte libre lève le widget).
   Accepter → `create_memory` + tool-ack. Rejeter → rien écrit.
   `update_memory` : tool-ack avec bouton annuler → rétablit le contenu précédent
   (no-op si `prevContent` absent). `delete_memory` : tool-ack avec bouton annuler
   → lève la tombstone.
9. **Pas de résumé sur conversation fraîche** : créer une conversation, envoyer un
   message, la quitter sans contenu substantiel → aucun résumé généré. La
   conversation courante est exclue des résultats de recherche pour la bannière
   mémoire.
10. **Arrêt du streaming** : lancer une génération longue, cliquer le bouton stop
    → le texte s'arrête et reste affiché, le composer redevient normal, aucune
    erreur loggée (l'`AbortError` est avalé). Stop pendant un appel d'outil
    interrompt sans relancer de tour.
11. **Timeout background** : figer l'endpoint pendant un titrage ou un backfill →
    l'indicateur d'activité s'éteint au bout de ~60 s (abort sur les appels
    silencieux), pas de blocage.
12. **Édition de message** : éditer un message en milieu de fil → tout ce qui
    suit disparaît, la réponse est régénérée (injection mémoire + tool_calls
    actifs). Échap annule. Recharger après édition → thread tronqué persisté.
13. **Sélecteur de modèle** : activer le réglage → le dropdown apparaît dans le
    composer (si `/models` répond). Changer de modèle en cours de conversation
    n'efface pas l'historique ; le choix persiste au rechargement ; une nouvelle
    conversation repart sur le modèle par défaut. Réglage masqué → les overrides
    existants restent actifs. Modèle non fonctionnel → erreur dans la bulle, pas
    de retry silencieux.
14. **Export et téléchargements** : le bouton d'export (topbar, à côté du titre)
    télécharge la conversation complète en Markdown ; il est désactivé pendant le
    streaming. Chaque message assistant finalisé a un bouton de téléchargement
    individuel (absent pendant le streaming, affiché après finalisation). Les blocs
    de code ont deux boutons : copie (feedback visuel ✓ pendant 1,4 s) et
    téléchargement (extension selon le langage déclaré, `.txt` en fallback).
15. **Raisonnement** : avec un modèle qui expose `reasoning`/`thinking`, l'icône
    raisonnement apparaît dans l'en-tête du message dès la première substance non
    vide ; cliquer déplie/referme le bloc monospace atténué. Le bloc persiste au
    rechargement. Déplier/replier le raisonnement d'un message **ancien** (fil
    scrollé vers le haut) ne doit **pas** ramener la vue en bas du fil. Les
    appels silencieux (titrage, résumé) désactivent le raisonnement
    (`reasoning_effort: none`) avec repli transparent si le backend rejette le
    paramètre.
15b. **Sélecteur de raisonnement — rejet et retry** : avec un backend qui rejette
    `reasoning_effort` (ex. devstral via vLLM), choisir un niveau dans la pilule
    du composer et envoyer → la réponse arrive **normalement** (pas de bulle
    d'erreur : `streamCompletion` rejoue la requête sans le paramètre, visible
    dans Network — deux POST, le second sans `reasoning_effort`), puis la pilule
    disparaît pour la suite de la session (endpoint+modèle marqués rejetés).
    Vérifier aussi l'état « défaut » : pilule **grisée** (composer et settings) ;
    tout autre niveau la repasse en accent orange.
16. **Toggle description outils** : activer `includeToolsInSystemPrompt` dans les
    réglages → la description textuelle redondante des outils apparaît dans le
    message système (vérifiable dans le payload réseau). La doctrine mémoire est
    toujours présente indépendamment de ce toggle.
17. **Titrage automatique et régénération manuelle** : nouvelle conversation, 1ʳᵉ
    Q/R → titre auto-généré (barre du haut + sidebar). Provoquer une conversation
    **sans titre** (stop du streaming en cours de réponse via le bouton composer,
    ou réponse assistant trop courte, sous le seuil de substance) → la conversation
    reste « Nouvelle conversation » partout. Sortir de la conversation puis y
    revenir (liste des conversations) : le titre reste absent (pas de retitrage à
    la simple réouverture). Éditer le premier message **ou** envoyer un tour
    supplémentaire dans cette même conversation rouverte → le titrage se déclenche
    normalement après la réponse suivante (régression sinon : titrage bloqué à vie
    pour toute conversation restée sans titre). Bouton de régénération (icône
    topbar à côté du titre, visible au survol de la zone titre) : cliquer sur une
    conversation déjà titrée (manuellement ou automatiquement) → le titre est
    remplacé par un nouveau titre généré ; le titre devient non éditable pendant
    l'appel puis se déverrouille.
18. **Drawer réglages — catégories repliables** : ouvrir les réglages → six
    catégories (Connexion, Modèle & raisonnement, Prompts système, Apparence,
    Mémoire, Outils & extensions), seule « Connexion » ouverte au départ.
    Ouvrir une catégorie replie la précédente (accordéon). Dans « Modèle &
    raisonnement », ouvrir le dropdown du champ Modèle et la pilule de
    raisonnement → les menus débordent de la catégorie **sans être coupés**
    (overflow rétabli après la transition d'ouverture).
19. **Bouton Enregistrer conditionnel** : à l'ouverture des réglages, le bouton
    est grisé (désactivé). Modifier n'importe quel champ persisté à
    l'enregistrement (URL, clef, modèle — y compris via le dropdown —, prompt
    utilisateur, un toggle, le niveau de raisonnement via la pilule, le mode
    « Conversations passées ») → le bouton s'active ; revenir à la valeur
    d'origine → il se re-grise. Changer le **thème** ne l'active pas
    (auto-persisté). Enregistrer → bouton re-grisé. Modifier un champ, fermer
    le drawer sans enregistrer, rouvrir → la saisie est toujours là et le
    bouton toujours actif.
20. **Bouton copier sur les messages** : sur une bulle **user**, survoler → un
    bouton copier apparaît à côté du bouton éditer ; cliquer copie le texte tel
    que tapé (identique au contenu affiché) dans le presse-papier, feedback
    check ~1,4 s. Sur une bulle **assistant**, le bouton copier (dans les
    actions méta, avant le bouton téléchargement) est masqué pendant le
    streaming, apparaît à la finalisation **et** reste opérationnel après
    rechargement ; cliquer copie le markdown source (`body.dataset.raw`), sans
    en-tête ni trace d'acks d'outils. **Message user avec slash-skill** :
    envoyer une commande `/skill ...`, puis copier ce message → le presse-
    papier contient le **littéral tapé** (`/skill ...`), jamais le corps baké
    injecté au modèle.
21. **Régénérer la dernière réponse** : sur la dernière bulle assistant du fil,
    un bouton « Régénérer la réponse » (flèches circulaires, actions méta,
    après copier/télécharger) déclenche sans confirmation une nouvelle
    génération qui **remplace** la réponse (les acks d'outils de l'ancienne
    réponse, s'il y en avait, disparaissent). **Changement de modèle** :
    changer le modèle du composer puis régénérer → la nouvelle réponse utilise
    le nouveau modèle (`activeModel()` au clic). **Réponse précédée d'appels
    d'outils** : régénérer une réponse dont la bulle contient des tool-acks →
    les acks disparaissent avec la réponse, le tour est rejoué proprement.
    **Visibilité** : le bouton n'apparaît que sur la **dernière** bulle
    assistant (absent des bulles antérieures, y compris après avoir régénéré
    une fois — c'est alors la nouvelle dernière bulle qui le porte) ; il est
    masqué sur **toutes** les bulles pendant un streaming en cours.
22. **« Continuer » une réponse incomplète** : côté serveur de test, poser un
    `max_tokens` (ou équivalent) très bas pour forcer une coupe réelle
    (`finish_reason: 'length'`) — envoyer une question qui appelle une réponse
    longue. Vérifier : la bulle assistant affiche le bandeau « Réponse
    incomplète » + bouton « Continuer » juste sous le texte, dès la
    finalisation. **Stop manuel** : sans `max_tokens` bas, interrompre une
    réponse en cours (bouton stop) après quelques tokens → même bandeau +
    « Continuer » sur la bulle figée ; stopper AVANT le premier token → pas de
    bandeau (bulle vide, « Régénérer » suffit). **Continuation** : cliquer « Continuer » → le bandeau
    disparaît, le patienteur reprend dans la **même** bulle (pas de nouvelle
    bulle, pas de nouveau message user), le texte se poursuit par
    concaténation brute (pas de séparateur ajouté) ; à la fin, si la réponse
    est complète, le bandeau ne revient pas. **Re-troncature en chaîne** :
    remettre un `max_tokens` bas, continuer une réponse déjà tronquée une
    première fois → le bandeau réapparaît sur la même bulle (contenu cumulé
    des deux morceaux), « Continuer » de nouveau disponible ; répéter 2-3 fois
    pour vérifier l'absence de dérive (pas de doublon de texte, pas de nouveau
    message dans le fil, ts inchangé après rechargement). **Bandeau sans
    bouton sur message ancien** : après une continuation réussie ou un nouvel
    échange, envoyer un second message — la bulle tronquée devient une bulle
    ancienne : le **texte** « Réponse incomplète » reste affiché dessus, mais le
    bouton « Continuer » est grisé/inactif (seule la **dernière** bulle
    assistant du fil a un bouton actif, même logique que le bouton régénérer).
    **Rendu au reload** : recharger la page sur une conversation contenant un
    message tronqué (dernier ou non) → le bandeau (texte, et bouton si c'est
    la dernière bulle assistant) se rend correctement sans action supplémentaire.

## Agrégation MCP distante (V2)

Banc d'essai : `mcp_bench.py` (extrait dans le projet `miaou-mcp-servers`).
Lancer depuis ce projet puis pointer MIAOU sur `http://127.0.0.1:8767/mcp`.

17. **Ajout & validation d'un serveur** : Paramètres → Serveurs MCP → Ajouter.
    Le transport est un dropdown pilule custom (`cfgPillSelect`, pas de select
    natif) : clic → menu `.model-menu` avec coche sur la valeur courante,
    fermeture au clic ailleurs. Saisir l'URL `…/mcp` → le transport se
    pré-remplit en `streamable-http` (mais
    ne s'écrase plus si on l'a changé à la main). Tenter `name = miaou`, un nom
    avec espace, avec `__`, ou un doublon → message d'erreur, pas d'enregistrement.
    Enregistrer `bench` → la carte passe « ● connecté — N outils ».
18. **Préfixage & registre unique** : ouvrir « Voir les outils exposés » → deux
    namespaces, `miaou` (noms nus `create_memory`, …) et `bench` (`echo`,
    `get_image`, …). Dans le payload réseau, les outils internes sont envoyés
    préfixés `miaou__*`, `ask_confirmation` reste **nu**.
19. **Délégation effective** : « utilise echo pour répéter "salut" » → le modèle
    appelle `bench__echo`, on va jusqu'à la réponse finale. Seul le bloc **text**
    est réinjecté au modèle (`add`/`dns_lookup` renvoient du texte exploité dans
    la réponse).
20. **Cascade non-text (D8)** : demander `bench__get_image` → l'image PNG s'affiche
    inline dans la bulle (pas de markup injecté) et **réapparaît au rechargement**
    (persistée en IDB). Demander `bench__get_json_resource` → aucun bloc de code
    n'apparaît (les réponses JSON sont passées au modèle mais non affichées) ; seul
    le chip « Ressource enregistrée : … » est visible. Un binaire/inconnu → ligne
    « Pièce jointe » + bouton Télécharger (Blob éphémère). Le texte de la réponse
    reste dans tous les cas.
21. **Filtres allow/deny** : sur la carte, mettre `get_image` en « Outils masqués »
    → il disparaît du registre (drawer + sélection). Mettre `echo` seul en
    « Outils autorisés » → seul `echo` reste. Denylist gagne si un outil est dans
    les deux.
22. **Timeout & dégradation** : baisser le timeout à ~1 ms et appeler un outil →
    résultat d'erreur « Délai dépassé », pas de requête fantôme. Couper le serveur
    puis recharger MIAOU → la carte passe « ● injoignable », ses outils
    disparaissent, **le reste de MIAOU fonctionne** (outils internes + autres
    serveurs intacts). Aucun gel.
23. **`sse` différé** : choisir le transport `sse` sur une carte et appeler un
    outil → erreur claire « non implémenté », jamais de demi-câblage.
24. **Ack `mcp_call` — affichage pendant le round-trip** : appeler un outil distant
    (ex. `bench__echo`) → la ligne « 🔧 Appel : `bench` › `echo` » apparaît dans la
    bulle **avant** la réponse, dès le démarrage de l'appel réseau (pas seulement
    après). Plusieurs `tool_calls` dans un même tour → plusieurs lignes distinctes,
    dans l'ordre d'exécution.
25. **Ack `mcp_call` — erreur** : baisser le timeout à ~1 ms et appeler un outil →
    la ligne d'appel vire au rouge (`var(--err)`) après l'échec. La réponse du
    modèle contient le message d'erreur. Recharger → la ligne reste rouge (persisté).
26. **Toggle `showCalls`** : ouvrir la carte en mode édition, désactiver « Afficher
    les appels dans le thread », Enregistrer. Appeler un outil de ce serveur → aucune
    ligne `mcp_call` n'apparaît dans le thread, mais les acks sont bien dans
    `currentThread` (vérifiable en inspectant `localStorage['miaou-conversations']`).
    Réactiver → les appels futurs réapparaissent. Les acks existants déjà dans
    l'historique d'une conversation antérieure restent filtrés tant que `showCalls`
    est `false` (rétroactif). Un serveur supprimé : ses acks antérieurs restent
    visibles (serveur absent → filtre inactif).
27. **Réinjection cross-turn des résultats d'outils** : avec `bench`, demander
    « utilise `dns_lookup` pour résoudre `example.com`, puis dans un message suivant
    demande-lui s'il se souvient du résultat ». Le modèle doit répondre correctement
    au second message sans rappeler l'outil. Vérifier dans le payload réseau
    (DevTools → Network) que le second appel contient, dans `messages`, la paire
    `role:'assistant'` (avec `tool_calls`) + `role:'tool'` (avec un préfixe
    `[Résultat du …]` et l'IP/domaine) — ces messages ne proviennent pas du fil
    affiché, ils sont reconstruits par `expandThread` à l'envoi. Recharger la page
    puis renvoyer un message dans la même conversation → la réinjection fonctionne
    aussi après rechargement (les champs `args`/`result`/`ts`/`group` sont persistés
    dans `localStorage['miaou-conversations']`).

## Stockage de ressources (IndexedDB)

Prérequis : `mcp_bench.py` en cours d'exécution (projet `miaou-mcp-servers`).
Vérifier IndexedDB dans DevTools → Application → IndexedDB → `miaou` → `resources`.

28. **Ressource inline (JSON)** : demander « utilise `get_json_resource` ». Lors de
    l'appel, un chip « Ressource enregistrée : … » apparaît dans la bulle (ack
    `resource_stored`) — **sans bloc de code** (les ressources texte/JSON sont
    stockées mais non affichées automatiquement). Dans IndexedDB, une entrée
    `class: "inline"` est présente avec `mime: "application/json"`. Le champ `result`
    de l'ack (dans `localStorage['miaou-conversations']`) contient le **texte brut
    JSON suivi du descripteur** `[resource id=res_… mime=… name="…" size=…]` — pas
    de base64, pas de `[resource_ref:…]`. Dans le payload réseau du tour suivant, le
    `role:'tool'` contient ce contenu directement (pas de résolution de ref). Le
    modèle voit le JSON complet et l'ID, et peut appeler `miaou__present_resource`
    avec cet ID s'il juge utile d'afficher la ressource.

29. **Ressource binaire (image)** : demander « utilise `get_image` ». Un chip
    « Ressource enregistrée : … » apparaît suivi de l'image inline dans la bulle.
    Dans IndexedDB : `class: "binary"`. Dans le payload réseau, le message `role:'tool'`
    contient le descripteur `[resource id=… mime=image/png name="…" size=…]` suivi
    de la note « La ressource a été présentée à l'utilisateur dans l'interface. » —
    **pas de base64**. Aucun base64 ne circule vers le modèle.

30. **Persistance au rechargement** : effectuer les tests 28 et 29, puis recharger
    la page et rouvrir la conversation. Les chips acks sont toujours là. L'image
    **réapparaît** dans la bulle (rendue par `placeToolAck` depuis IDB, `class:
    "binary"`). Aucun bloc JSON n'apparaît (inline : stocké en IDB mais non
    affiché). Envoyer un nouveau message → dans DevTools Network : le `role:'tool'`
    de la ressource **inline** contient le JSON complet (texte brut direct depuis
    `entry.result`, sans résolution de ref) ; le `role:'tool'` de la ressource
    **binary** contient le descripteur `[resource id=…]` + note « présentée » (ref
    résolue par `resolveResourceRefs` avant `expandThread`). Le préfixe
    `system + historique[0..N-2]` est byte-identique d'une requête à l'autre.

31. **`present_resource`** : après les tests 28/29 (session cache chaud, ou après
    rechargement qui recharge le cache), demander au modèle « utilise
    `miaou__present_resource` avec l'id `res_…` de la ressource JSON ». Le résultat
    d'outil doit être `Ressource présentée à l'utilisateur.` ; un ack
    `resource_presented` (icône + label « Présentée : … ») s'insère dans la bulle ;
    le bloc JSON s'affiche inline dans la bulle. Même chose avec l'image binaire →
    image affichée. Si l'id est inconnu (session cache absent) → résultat
    `Ressource introuvable…`, pas de plantage.

32. **Cascade suppression de conversation** : la poubelle de la sidebar demande
    une **confirmation en deux temps** (premier clic → icône armée en rouge,
    ~2,6 s ; second clic → suppression ; sans second clic, désarmement
    automatique et rien n'est supprimé). Supprimer ainsi une conversation
    contenant des ressources. Dans IndexedDB, toutes les entrées liées à cet `id` de
    conversation ont disparu (vérifier dans DevTools). `localStorage['miaou-summaries']`
    continue de fonctionner normalement pour les autres conversations. Même
    mécanique d'armement sur les boutons « Supprimer » des cartes MCP/API/skills.

33. **Persistance du stockage** : au premier stockage de ressource de la session,
    vérifier dans la console (`console.log`) ou DevTools → Application → Storage que
    `navigator.storage.persist()` a été appelé. Le navigateur peut refuser — MIAOU
    continue de fonctionner sans erreur dans tous les cas.

34. **Byte-identique & KV cache** : dans une conversation avec un résultat inline
    déjà stocké, envoyer deux messages successifs. Dans DevTools Network, comparer
    les payloads des deux requêtes : le préfixe `system + historique[0..N-2]` (dont
    les messages `role:'tool'` re-hydratés des tours antérieurs) doit être identique
    byte-pour-byte entre les deux requêtes — seul le dernier message `role:'user'`
    diffère. Cela valide que le contenu re-hydraté ne change pas d'un tour à l'autre
    (le JSON est congelé au moment du stockage, pas recalculé).

## Skills (stage 1)

35. **CRUD + cache** : Paramètres → Skills → Nouveau skill. Saisir slug `revue`,
    nom, description, un corps Markdown ; Enregistrer. La carte apparaît en vue.
    Recharger la page → le skill est toujours là (IDB). Désactiver le toggle de la
    carte → état persisté au reload. « Modifier » → la textarea se repeuple avec le
    corps (lecture IDB `getSkillRecord`). « Supprimer » → le bouton s'arme
    (« Confirmer ? », rempli rouge, ~2,6 s) → second clic → disparu, hard delete
    (rien au reload) ; sans second clic, le bouton se désarme tout seul.

36. **Validation slug** : tenter d'enregistrer un slug avec espace, `/`, vide, ou
    doublon d'un slug existant → message d'erreur inline dans la carte, pas d'écriture.

37. **Autocomplétion** : taper `/` puis `rev` dans le composer → dropdown des skills
    activés filtrés (slug **ou** name). ↑↓ navigue, Tab/Entrée complète `/revue `
    **sans envoyer**, Échap ferme. Un skill désactivé n'apparaît jamais.

38. **Injection slash (figée)** : envoyer `/revue analyse ce code`. La bulle user
    n'affiche QUE `/revue analyse ce code` (pas le corps). Dans DevTools Network, le
    message `role:'user'` envoyé contient le corps du skill concaténé. Recharger →
    la bulle affiche toujours le littéral seul (`displayText`), le payload réenvoyé
    garde le corps (`content` figé). Éditer ensuite cette skill ou la supprimer → le
    message déjà envoyé reste byte-identique (pas de re-résolution au reload/replay).

39. **Slash invalide** : envoyer `/inconnu` ou `/revue` désactivée → erreur locale
    sous le composer, **aucun message envoyé, aucun tour modèle**, saisie préservée.

39b. **Édition d'un message slash — fuite littéral/injecté** : après le test 38,
    cliquer « Éditer » sur la bulle `/revue …`. La **textarea d'édition affiche le
    littéral** (`/revue analyse ce code`), JAMAIS le corps injecté. « Annuler » → la
    bulle se restaure au littéral seul (pas de fuite du corps). Tout ça est vrai au
    premier rendu, après annulation, et après reload — même champ `displayText`.

39c. **Édition d'un message slash — réinjection à l'envoi** : éditer la bulle en
    gardant/modifiant un `/slug` valide et valider. Dans Network, le message renvoyé
    re-bake avec le contenu **courant** de la skill (modifier la skill entre-temps
    doit se refléter ici — re-résolution, pas le contenu figé d'origine). Éditer
    vers un `/slug` invalide/désactivé → erreur affichée **sous la zone d'édition**
    (PAS sous le composer), **thread inchangé**, la bulle reste en mode édition ;
    l'erreur disparaît dès qu'on retape, et la validation réussie la fait disparaître
    (la bulle d'édition est reconstruite). Éditer vers du texte normal → plus de
    `displayText`, la bulle affiche le texte tel quel. Vérifier que le modèle
    n'appelle PAS `miaou__skills__read` de lui-même pour résoudre un `/slug` édité
    (l'injection client le résout en amont).

39d. **Effacement de l'erreur composer à l'envoi** : taper `/inconnu`, envoyer →
    erreur sous le composer. Corriger en message valide et envoyer → l'erreur
    disparaît (tout envoi effectif lève l'erreur skill du composer).

40. **Chemin langage naturel** : avec au moins un skill activé, demander en langage
    naturel une tâche couverte par un skill (sans `/`). Le modèle doit appeler
    `miaou__skills__list` puis `miaou__skills__read(slug)` → ack « Skill consulté :
    … » (informatif, sans bouton annuler) dans la bulle, et le contenu influence sa
    réponse. Vérifier qu'un skill **désactivé** n'apparaît jamais dans `skills__list`
    et que `skills__read` sur lui renvoie une erreur claire (pas un succès vide).

41. **Réinjection cross-turn d'un skill lu** : après le test 40, poursuivre la
    conversation sur un autre tour. Dans Network, le payload doit contenir le
    `role:'tool'` re-hydraté avec le contenu du skill (via `expandThread`), prouvant
    que le modèle garde l'accès au skill aux tours suivants.

42. **Export Markdown avec traces d'outils** : sur une conversation où le modèle a
    appelé au moins un outil (ex. test 4 ou 27), cliquer le téléchargement de
    conversation (icône topbar) puis le téléchargement d'un message assistant
    individuel (`.msg-dl`, au survol). Dans les deux `.md` générés, vérifier que
    juste avant le texte de réponse du tour figure un bloc `> **Outil appelé :**`
    (ou `Outils appelés (n) :` si plusieurs dans le même tour) avec nom de l'outil,
    `— intent` si le modèle en a fourni un, arguments JSON, et résultat (ou
    `Résultat (erreur)` en cas d'échec MCP). Avec une ressource présentée
    automatiquement (test 29), la note doit donner nom + type MIME **sans**
    embarquer l'image (pas de `data:` dans le fichier). Sur une conversation
    ancienne avec des acks **legacy** (sans `args`, pré-réinjection cross-turn),
    vérifier qu'aucune trace n'apparaît pour ce tour (silencieusement omis, pas
    d'erreur).

43. **Composer sans skill activée** : désactiver ou supprimer tous les skills →
    la légende du composer perd « `/` pour une skill » (elle revient dès qu'un
    skill est réactivé, sans recharger). Envoyer `/inconnu texte` → part comme du
    texte normal, **aucune** erreur « skill inconnue », aucun parsing de slug ;
    l'autocomplétion ne s'ouvre pas sur `/`.

44. **Autocomplete par-dessus les pilules** : avec les sélecteurs de modèle et/ou
    de raisonnement visibles dans le composer, taper `/` → la liste s'ouvre
    **par-dessus** les pilules (elles ne bougent pas, elles sont recouvertes) et
    les libère à la fermeture. Navigation clavier : liste ouverte sans sélection,
    appuyer sur ↑ → sélectionne la **dernière** option (la plus proche du champ),
    ↓ → la première ; les deux bouclent aux extrémités. Même comportement ↑ →
    dernière dans l'autocomplete de la bulle d'édition (liste sous le champ).

45. **« + » topbar sidebar fermée** : fermer la sidebar → logo + nom + bouton `+`
    apparaissent en fondu dans la topbar ; cliquer le `+` crée une nouvelle
    conversation (même effet que « Nouvelle » de la sidebar). Ouvrir la sidebar →
    le `+` disparaît avec le brand et n'est plus cliquable (pas de cible fantôme
    à son ancien emplacement). Au chargement avec un historique **non vide**
    (sidebar ouverte d'office) : aucun flash du brand/`+` avant l'ouverture —
    ils sont masqués en dur tant que `init()` n'a pas posé `.booted` sur `#app`.

46. **Recherche plein texte dans les messages** : avec le seed chargé
    (`tests/dev-seed.html`), taper « ornithorynque » dans la recherche de la
    sidebar (ce mot n'apparaît que dans le contenu d'un message assistant de la
    conversation « Cron — syntaxe et debugging », absent du titre et du résumé)
    → la conversation apparaît dans les résultats. Retirer un caractère pour
    passer à « ornithorynqu » puis tronquer à 2 caractères (ex. « or ») → la
    conversation disparaît (seuil de 3 caractères pour le scan de contenu).
    Effacer la recherche (croix) → la liste complète est restaurée.

## Export / import complet des données (feature E)

47. **Export puis import dans un profil vierge** : avec le seed chargé (ou une
    session comportant plusieurs conversations, souvenirs, skills, ressources et
    serveurs API/MCP), Réglages → catégorie « Données » → « Exporter les
    données » → un fichier `miaou-export-<date>.json` est téléchargé. Ouvrir une
    fenêtre de navigation privée (ou vider localStorage + IndexedDB du profil),
    charger MIAOU à vide, ouvrir la même catégorie → « Importer les données » →
    sélectionner le fichier → le récapitulatif affiche les bons comptes
    (conversations, souvenirs, skills, ressources, serveurs). Cliquer
    « Appliquer » (armé, un premier clic arme, le second dans la fenêtre de
    2,6 s confirme) → rechargement de la page → conversations, souvenirs,
    skills, ressources et serveurs API/MCP sont tous restaurés à l'identique
    (y compris les données binaires d'une ressource image, cf. test 29).
48. **Fichier invalide** : sélectionner un fichier qui n'est pas un export MIAOU
    (JSON quelconque, ou fichier non-JSON) → message d'erreur affiché sous le
    bouton « Importer les données » (pas d'`alert`, pas de recharge de page), le
    récapitulatif ne s'affiche pas.
49. **Arm-confirm** : sur un import valide, cliquer une seule fois sur
    « Appliquer » → le bouton passe en état armé (libellé « Confirmer le
    remplacement ») sans effet ; attendre l'expiration du délai (~2,6 s) → le
    bouton revient à son état initial, aucune donnée n'a été modifiée ; refaire
    la sélection du fichier et cliquer deux fois de suite → le remplacement
    s'applique et la page recharge.
50. **Boutons non liés au dirty/Enregistrer** : ouvrir Réglages, cliquer
    « Exporter les données » → le bouton « Enregistrer » du drawer reste
    désactivé (aucun champ de formulaire n'a été modifié) — l'export n'active
    pas la mécanique dirty.

## Pièces jointes — envoi au modèle et persistance (brief A lot 2)

Nécessite un modèle vision-capable (ex. via un backend qui expose des modèles
multimodaux) pour les tests 51-52 ; 53-54 ne nécessitent qu'un texte quelconque.

51. **Image jointe → le modèle décrit le contenu** : joindre une image (trombone
    ou drag&drop) à un message, envoyer. Dans DevTools → Network, le payload de
    CE tour contient `content` en **tableau** pour le message user
    (`[{type:'text',…},{type:'image_url',image_url:{url:'data:image/…;base64,…'}}]`).
    La réponse du modèle doit correctement décrire l'image (preuve que le
    base64 est bien arrivé).
52. **Tour suivant → payload = descripteur, pas de base64** : dans la même
    conversation, envoyer un second message (sans nouvelle pièce jointe).
    Dans Network, le message user du tour précédent apparaît maintenant en
    `content` **string**, contenant une ligne
    `[attachment att-N: image "nom.ext", LxH, TAILLE — content available via miaou__recall_attachment]`
    — **aucun** `data:image` ni base64 dans tout le payload pour ce message.
    Recharger la page et rouvrir la conversation : la forme persistée
    (`localStorage['miaou-conversations']`) est déjà la string avec descripteur
    (vérifiable directement dans DevTools → Application → Local Storage).
53. **Fichier texte joint → injection directe** : joindre un `.txt`/`.md`/`.py`
    (liste `ATTACHMENT_TEXT_EXTENSIONS`), envoyer. Dans Network, le message user
    de ce tour contient le texte tapé **et** un bloc fencé avec en-tête
    `[attachment att-N: file "nom.ext"]` suivi du contenu du fichier entre
    ` ``` `. Le modèle doit pouvoir répondre sur le contenu du fichier. Tour
    suivant : le même bloc fencé reste identique dans le payload (PAS de
    descripteur pour un attachment texte, contrairement à l'image) —
    comparer les deux payloads octet pour octet sur ce message.
54. **Tour avorté avec image jointe (stop manuel)** : joindre une image,
    envoyer, cliquer stop AVANT ou PENDANT la réponse. Envoyer un message
    supplémentaire dans la même conversation → dans Network, le message user
    qui portait l'image doit apparaître en **string avec descripteur**, jamais
    encore en content parts (la réécriture a bien eu lieu malgré l'abort, pas
    seulement sur une fin normale).
55. **Dégradation vision-less (D5)** : avec un backend/modèle qui rejette les
    `image_url` (400), joindre une image et envoyer. Vérifier dans Network
    qu'un premier POST échoue (400) puis qu'un second POST part automatiquement
    SANS `image_url` (texte + descripteur à la place) et que la réponse arrive
    normalement (pas de bulle d'erreur visible). Le message user de CE tour
    doit contenir, dans le bloc `<miaou_context>` du payload, une phrase
    signalant que les images ont été remplacées par du texte. Envoyer un
    troisième message (sans nouvelle image) dans la même conversation → un
    seul POST cette fois (pas de nouveau 400/retry, le rejet est mémorisé pour
    ce couple endpoint+modèle). Changer de modèle vision-capable sur le même
    endpoint (si disponible) et joindre une image → doit repartir normalement
    en content parts (le flag de rejet ne doit pas avoir contaminé l'autre
    modèle).
56. **`recall_attachment` round-trip (D4 + A2/D3)** : dans une conversation avec
    une image jointe déjà réécrite en descripteur (tour suivant, cf. test 52),
    demander explicitement au modèle de **décrire** l'image (par son `att-N` ou
    en langage naturel — p. ex. « quel texte est écrit sur att-1 ? »). Le modèle
    doit appeler `miaou__recall_attachment`, un ack « Pièce jointe rappelée : … »
    doit apparaître dans le fil avec le bloc image affiché (même rendu que
    `present_resource`). **Point clé A2/D3** : la réponse du modèle doit décrire
    l'image **fidèlement** (pas de confabulation) — la ré-injection (message user
    synthétique porteur de la part image, généré par `expandThread`) fonctionne.
    Vérifier dans l'onglet Network que la requête `/completions` qui suit le
    recall contient bien, **après** le message `role:'tool'`, un message
    `role:'user'` avec une part `image_url` (data URL). Recharger la page et
    rouvrir la conversation : l'ack et son bloc image doivent persister à
    l'identique ; le storage ne doit contenir que `attId` sur l'ack (pas de
    dataUrl `recallImage` persistée — elle est recomputée à chaque envoi).
    Répéter avec un fichier texte joint (le contenu doit revenir en clair, sans
    bloc image ni message synthétique) et, si possible, un binaire non-image (le
    contenu retourné doit être le descripteur + la note « non lisible
    directement », jamais les octets).
57. **Hook d'inflation dispatcher (D6, nécessite un serveur `mcp_docs` — lot D
    miaou-mcp-servers — configuré et activé)** : joindre un fichier binaire
    (ex. PDF), demander au modèle de l'explorer via un outil `docs__*`
    (ex. lister ses pages). Dans Network, le premier appel `tools/call` vers
    ce serveur pour ce `ref` doit porter `content_b64` (et `session_id`) dans
    ses arguments — vérifier qu'ils sont **absents** de l'ack `mcp_call`
    affiché dans le fil (les args visibles/persistés restent les args
    originaux du modèle, sans `content_b64` ni `session_id`). Un second appel
    du modèle sur le **même** `ref` dans le même échange ne doit **plus**
    porter `content_b64` (état « déjà poussé ») mais doit **toujours** porter
    `session_id` (injecté sur chaque appel capable — le serveur en a besoin
    pour localiser sa session). Recharger la page (réinitialise l'état en
    mémoire) et redemander un appel sur ce `ref` dans la même conversation →
    `content_b64` réapparaît dans les args du wire (l'état poussé ne survit
    pas au rechargement, par design). Si possible, simuler une expiration
    TTL côté serveur (ou redémarrer le serveur docs) puis redemander un appel
    sur un `ref` que MIAOU croit déjà poussé → un `REF_UNKNOWN` doit
    déclencher exactement UN rejeu automatique avec le contenu inliné,
    invisible dans le fil : UNE seule ligne d'ack `mcp_call` pour l'échange
    complet, sans classe d'erreur si le rejeu réussit (l'entrée d'ack du
    premier essai est réutilisée par le rejeu — même rendu qu'un rejeu
    `staleSession` ; deux POST visibles dans Network, un seul ack).
58. **Spaces — création et switch (lot C).** Depuis la sidebar, cliquer le
    sélecteur de Space (« Général » par défaut) → menu déroulant. Cliquer
    « + Nouvel espace » → l'écran Space s'ouvre directement, renommer (ex.
    « Perso ») et Enregistrer. Revenir au sélecteur : le nouveau Space
    apparaît dans la liste. Cliquer dessus (pas le crayon) → bascule vers ce
    Space : la sidebar se vide (aucune conversation), le fil se réinitialise
    (écran d'accueil), le badge topbar (sidebar repliée) affiche le nom du
    nouveau Space. Revenir au default Space (« Général ») → le badge
    disparaît (exception assumée, brief D5).
59. **Spaces — herméticité bidirectionnelle.** Dans « Général », créer une
    conversation « Test A ». Basculer vers « Perso », créer « Test B ».
    Vérifier : la sidebar de « Perso » ne montre que « Test B » ; la
    recherche sidebar dans « Perso » ne retrouve jamais « Test A » (titre ou
    contenu) ; demander au modèle (outil `list_conversations`) → ne doit
    lister que « Test B ». Demander explicitement `get_conversation` sur
    l'id technique de « Test A » (si connu) depuis « Perso » → réponse
    « introuvable », identique à un id inventé (pas d'oracle). Rebasculer
    vers « Général » → symétrique (« Test A » visible, « Test B » invisible
    partout).
60. **Spaces — mémoire scopée et promotion.** Depuis « Perso », demander au
    modèle de mémoriser un fait (`create_memory`, chemin direct). Basculer
    vers « Général » : le souvenir ne doit apparaître ni dans l'injection de
    contexte ni dans l'écran Space de « Général ». Retourner dans « Perso »,
    ouvrir son écran → le souvenir est listé avec un bouton « Promouvoir en
    profil ». Cliquer dessus → le souvenir disparaît de la liste de « Perso »
    et apparaît dans Paramètres → Profil (drawer réglages, onglet renommé).
    Vérifier qu'il est désormais injecté quel que soit le Space actif.
61. **Spaces — description ajoutée, pas substituée (D4 corrigé).** Dans
    Paramètres, renseigner un prompt système global non vide. Ouvrir l'écran
    d'un Space, renseigner une description, Enregistrer. Envoyer un message
    dans ce Space et inspecter la requête réseau (payload du message
    `system`) : le prompt global ET la description du Space doivent tous les
    deux être présents (concaténés, séparateur `---`), jamais l'un à la place
    de l'autre. Basculer vers un Space sans description → seul le prompt
    global apparaît.
62. **Spaces — suppression avec cascade (D6).** Créer un Space de test avec
    au moins une conversation et un souvenir. Ouvrir son écran → bouton
    « Supprimer cet espace » affiche les comptes (ex. « Supprimer (1 conv.,
    1 souvenir) »). Premier clic arme le bouton, second clic dans la fenêtre
    confirme : le Space, ses conversations (et leurs pièces jointes IDB) et
    ses souvenirs scopés disparaissent ; si c'était le Space actif, bascule
    automatique vers « Général ». Un souvenir profil créé en parallèle doit
    rester intact. Vérifier qu'aucun bouton de suppression n'existe sur
    l'écran du default Space.
63. **Spaces — export/import round-trip.** Créer un second Space avec du
    contenu, exporter (Paramètres → Données). Importer ce fichier (remplace
    tout l'état local) : vérifier que le second Space, ses conversations et
    ses souvenirs scopés reviennent identiques, et que le Space actif
    persisté (`miaou-active-space`) est cohérent après le `location.reload()`
    de fin d'import.
64. **Flag vision MANUEL par (serveur, modèle) — D5 brief A2** : ce test couvre
    le silent-failure Ollama (F1), que le test 55 (réactif sur 400) ne peut PAS
    attraper. **Diagnostic préalable** — repérer un modèle sans vision : joindre
    une image à un modèle suspect et l'interroger ; si la réponse (ou le
    raisonnement streamé) mentionne un placeholder brut du type `[img-0]` lu
    comme du texte, le build du modèle n'a pas de projecteur vision. Confirmer
    par un curl direct :
    ```bash
    B64=$(base64 -i /chemin/image.jpg | tr -d '\n')
    curl -s http://HOST:11434/v1/chat/completions -H 'Content-Type: application/json' -d '{
      "model":"MODELE","messages":[{"role":"user","content":[
        {"type":"text","text":"Décris cette image."},
        {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,'"$B64"'"}}]}]}' | python3 -m json.tool
    ```
    Une description hors-sujet / la mention d'un placeholder = pas de vision.
    **Réglage** : ouvrir le drawer des serveurs API, éditer la carte du serveur,
    passer le pill « Vision (images) » du modèle concerné sur « Sans vision ».
    Enregistrer. **Vérification** : joindre une image et envoyer. Dans Network,
    un **seul** POST doit partir (pas de 400/retry), **sans** `image_url` — le
    message user porte le texte + le descripteur, et le bloc `<miaou_context>`
    la phrase de remplacement. Recharger la page : le réglage doit persister (le
    storage `miaou-api-servers[].vision` porte `{ "MODELE": false }`). Repasser
    sur « Images activées » : le prochain envoi repart en content parts. Vérifier
    l'isolation : marquer un modèle A « sans vision » ne doit pas dégrader un
    modèle B vision-capable du même serveur (clé par nom de modèle).
65. **Descripteur binaire générique + doctrine docs conditionnelle (brief H)** :
    ce test couvre le déclencheur en AMONT du hook D6 (test 57 couvre l'aval,
    une fois l'outil déjà appelé) — le modèle doit choisir d'appeler l'outil
    docs **spontanément**, sans qu'on le lui demande. Nécessite un serveur
    `mcp_docs` (miaou-mcp-servers) configuré et activé.
    - **Sans serveur docs actif** : joindre un fichier binaire quelconque
      (.docx, .zip, .pdf) à un message, envoyer. Dans Network, le message user
      de ce tour contient une ligne `[attachment att-N: file "nom.ext", <mime>,
      <taille> — binary content, not inlined]` dans sa partie texte (pas de
      content part, contrairement à l'image). Le message système ne doit PAS
      contenir la doctrine docs (chercher `content_b64` dans le payload
      `system` : absent).
    - **Avec serveur docs actif** : même envoi. Le payload `system` doit cette
      fois contenir la doctrine docs (mention de `ref`, `content_b64`, et de
      l'exemple `docs__read`). Sans qu'on demande explicitement d'ouvrir le
      fichier, le modèle doit appeler spontanément un outil `docs__*` (typ.
      `docs__list` puis `docs__read`) avec `ref="att-N"` et restituer le
      contenu extrait dans sa réponse.
    - **Généricité** : répéter avec un type de fichier que le serveur docs ne
      sait PAS ouvrir (ex. un `.bin` arbitraire) — le descripteur émis doit
      être structurellement identique (même format, juste le mime qui change),
      le modèle peut alors soit tenter l'outil (qui répondra une erreur propre
      « type non supporté »), soit s'abstenir : dans tous les cas, pas de
      confabulation de contenu.
    - **Cas réel piégeux (documents tabulaires)** : si le `.docx` joint est un
      formulaire dont tout le contenu est dans un tableau Word (aucun
      paragraphe non-vide) — cas réel rencontré en session — le serveur docs
      doit renvoyer un contenu non-vide (fix côté serveur, `docx_tables`,
      hors périmètre MIAOU mais bloquant pour ce test si le serveur n'est pas
      à jour). Un résultat vide de `docs__read` sur un fichier qui contient
      manifestement du texte signale un bug serveur, pas un problème de
      déclenchement côté MIAOU.

66. **Inspecteur de contexte (brief B)** : le compteur `≈ N tok` apparaît dans
    le composer. Activer plusieurs serveurs MCP + skills autotrigger + quelques
    souvenirs → le total augmente visiblement. Ouvrir le drawer (clic sur le
    compteur) : les segments de la barre empilée et les lignes de la table
    doivent sommer au total affiché. Envoyer un message → le drawer rouvert
    affiche l'en-tête « dernier envoi réel » (pas simulation). Changer de
    conversation ou de Space → le compteur retombe sur une simulation (en-tête
    « simulation du prochain envoi »). Joindre une image → une ligne « Images
    jointes (très approximatif) » apparaît, comptée à une constante fixe (pas
    au poids du base64). Réglages → Modèle & raisonnement → renseigner une
    fenêtre de contexte → le compteur affiche un `%` et passe ambre au-delà de
    80% d'occupation.
