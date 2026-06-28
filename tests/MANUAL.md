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
   → acks toujours présents.
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
    rechargement. Les appels silencieux (titrage, résumé) désactivent le
    raisonnement (`reasoning_effort: none`) avec repli transparent si le backend
    rejette le paramètre.
16. **Toggle description outils** : activer `includeToolsInSystemPrompt` dans les
    réglages → la description textuelle redondante des outils apparaît dans le
    message système (vérifiable dans le payload réseau). La doctrine mémoire est
    toujours présente indépendamment de ce toggle.

## Agrégation MCP distante (V2)

Banc d'essai prêt à lancer : `tests/mcp_bench.py` (streamable-http, CORS
ouvert, outils `echo`/`add`/`dns_lookup`/`get_image`/`get_json_resource`).

```bash
uv run tests/mcp_bench.py        # http://127.0.0.1:8765/mcp
```

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
    inline dans la bulle (pas de markup injecté). `bench__get_json_resource` → bloc
    de code JSON surligné. Un binaire/inconnu → ligne « Pièce jointe » + bouton
    Télécharger (Blob éphémère). **Recharger la page → ces blocs disparaissent**
    (non persistés, c'est voulu) ; le texte de la réponse, lui, reste.
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

Prérequis : `tests/mcp_bench.py` en cours d'exécution (`uv run tests/mcp_bench.py`).
Vérifier IndexedDB dans DevTools → Application → IndexedDB → `miaou` → `resources`.

28. **Ressource inline (JSON)** : demander « utilise `get_json_resource` ». Lors de
    l'appel, un chip « Ressource enregistrée : … » apparaît dans la bulle (ack
    `resource_stored`), immédiatement suivi d'un bloc de code JSON surligné (rendu
    directement, sans bouton « voir »). Dans IndexedDB, une entrée `class: "inline"`
    est présente avec `mime: "application/json"`. `localStorage['miaou-conversations']`
    ne contient **pas** de base64 — le champ `result` de l'ack contient le **texte
    brut JSON** (pas une référence `[resource_ref:…]`). Dans le payload réseau du tour
    suivant, le message `role:'tool'` contient ce JSON directement — il provient de
    `entry.result` sans résolution de ref (le texte brut y était déjà).

29. **Ressource binaire (image)** : demander « utilise `get_image` ». Un chip
    « Ressource enregistrée : … » apparaît suivi de l'image inline dans la bulle.
    Dans IndexedDB : `class: "binary"`. Dans le payload réseau, le message `role:'tool'`
    contient le descripteur `[resource id=… mime=image/png name="…" size=…]` suivi
    de la note « La ressource a été présentée à l'utilisateur dans l'interface. » —
    **pas de base64**. Aucun base64 ne circule vers le modèle.

30. **Persistance au rechargement** : effectuer les tests 28 et 29, puis recharger
    la page et rouvrir la conversation. Les chips acks sont toujours là (persistés
    dans `localStorage`). Les blocs image et code JSON **réapparaissent** dans les
    bulles assistantes — ils sont re-rendus par `placeToolAck` depuis IDB (même
    chemin live / reload). Envoyer un nouveau message quelconque → dans DevTools
    Network, vérifier le payload : le `role:'tool'` de la ressource **inline** contient
    le **JSON complet** directement (issu de `entry.result` en localStorage, pas de
    résolution de ref — le texte brut était déjà là) ; le `role:'tool'` de la ressource
    **binary** contient le descripteur `[resource id=…]` + note « présentée » (la ref
    `[resource_ref:res_…]` de `entry.result` a été remplacée par `resolveResourceRefs`
    avant `expandThread`). Le préfixe `system + historique[0..N-2]` est byte-identique
    d'une requête à l'autre.

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
