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

## Agrégation MCP distante (V2)

Banc d'essai : `mcp_bench.py` (extrait dans le projet `miaou-mcp-servers`).
Lancer depuis ce projet puis pointer MIAOU sur `http://127.0.0.1:8767/mcp`.

17. **Ajout & validation d'un serveur** : Paramètres → Serveurs MCP → Ajouter.
    Saisir l'URL `…/mcp` → le transport se pré-remplit en `streamable-http` (mais
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

32. **Cascade suppression de conversation** : supprimer via la sidebar une conversation
    contenant des ressources. Dans IndexedDB, toutes les entrées liées à cet `id` de
    conversation ont disparu (vérifier dans DevTools). `localStorage['miaou-summaries']`
    continue de fonctionner normalement pour les autres conversations.

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
    corps (lecture IDB `getSkillRecord`). « Supprimer » → confirm natif → disparu,
    hard delete (rien au reload).

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
