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
