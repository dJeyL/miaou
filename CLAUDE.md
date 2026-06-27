# CLAUDE.md — MIAOU

Instructions pour travailler dans ce dépôt. Les pièges de conception et les
spécifications de référence sont intégrés directement ci-dessous.

## Ce qu'est le projet

Client de chat web pour API OpenAI-compatible, livré comme **un seul fichier
HTML** (`dist/miaou.html`). On édite `src/`, `build.py` assemble. Pas de runtime,
pas de bundler, pas de Node, pas de modules ES.

## Boucle de travail

```bash
python3 build.py                          # src/ → dist/miaou.html
uv run --with quickjs python tests/runner.py   # tests des fonctions pures
```

**Avant chaque commit :** build si du code a changé, puis tests. Ne jamais
commit ni push sans avoir demandé l'accord explicite de l'utilisateur au préalable.

Python via `uv` exclusivement. `config.json` (copié de `config.sample.json`) est
local et non versionné ; `dist/miaou.html` est versionné intentionnellement.

**Messages de commit en anglais** (le reste des échanges reste en français).

## Pipeline de build (ne pas le réécrire)

`build.py` lit `src/html/index.html` et remplace deux placeholders :
`/* __CSS__ */` (← `src/css/main.css`) et `/* __JS__ */` (← les `src/js/*.js`
concaténés dans l'ordre `JS_ORDER` : `utils, storage, tools, api, ui, main`).
Il substitue aussi **un seul marqueur de config**, `__MIAOU_CONFIG__`, par
l'objet `config.json` entier sérialisé en JSON (JSON ⊂ littéral objet JS, donc
`json.dumps` gère seul quoting/nombres/booléens — pas de marqueur par clef, pas
de distinction guillemets/sans-guillemets). `build.py` échappe `</` dans le
littéral pour ne pas casser le `</script>` porteur. Côté source (`storage.js`),
un **unique point d'injection** :

```js
const BUILD_CONFIG = (function () { try { return __MIAOU_CONFIG__; } catch (e) { return {}; } })();
```

- **Marqueur à occurrence unique, en position de valeur** : `.replace` global,
  donc toute autre occurrence serait substituée aussi.
- **Forme tolérante via `try`** : sources non buildées (tests QuickJS),
  `__MIAOU_CONFIG__` est un identifiant nu → `ReferenceError` attrapée → `{}`.
  (Un `typeof … !== 'undefined'` ne convient pas : la garde elle-même contient
  le marqueur, qui serait substitué → objet dupliqué.)
- Les quatre valeurs dérivées (`REQUIRE_API_KEY`, `MAX_SUMMARIES`,
  `BUILD_API_URL`, `BUILD_API_MODEL`) sont **toutes déclarées dans `storage.js`**,
  juste sous `BUILD_CONFIG`, avec leurs défauts. Elles ne sont **référencées
  ailleurs qu'en corps de fonction** (cf. contrainte `const`/test runner
  ci-dessous) : ne pas les redéclarer dans un autre fichier au top-level.
- `REQUIRE_API_KEY` (défaut `true`) gouverne l'état « configuré » : si `false`,
  le composer se déverrouille avec l'URL seule (clef optionnelle), cf.
  `syncConfigured` (ui.js).

## Contraintes structurelles à respecter

- **Tout est global.** Les fichiers sont collés dans un seul `<script>`. Une
  fonction d'un fichier peut en appeler une d'un autre, mais **uniquement via
  des déclarations `function`** (elles deviennent des globals). Les `const`/`let`
  de portée script ne franchissent **pas** les frontières de fichier dans le
  *test runner* (qui `eval` chaque fichier séparément), même si elles le font
  dans le build concaténé. Conséquence pratique : un `const` partagé entre
  fichiers (ex. `MAX_SUMMARIES`) ne doit être **référencé qu'à l'intérieur de
  corps de fonctions** (exécutés au runtime, après chargement complet), jamais
  au top-level d'un autre fichier.
- **Noms top-level uniques** entre fichiers : le script concaténé est en
  `'use strict'` et une même portée — deux `const`/`let`/`function` homonymes au
  niveau racine cassent le build.
- `'use strict';` est la première instruction de `utils.js` (premier fichier) →
  tout le script est strict. Déclarer chaque variable, pas de global implicite.
- Garde de test obligatoire en fin de `main.js` :
  `if (typeof __TEST_ENV__ === 'undefined') { document.addEventListener('DOMContentLoaded', init); }`
- Les handlers référencés en `onclick=`/`oninput=` inline dans `index.html`
  doivent rester des fonctions globales portant exactement ces noms
  (`sendMessage`, `onSendBtn`, `newConversation`, `openSettings`,
  `onSaveSettings`, `selectSummaryInjectionMode`, `summaryBanner`, `deleteConv`,
  `onConvSearch`, `clearConvSearch`, `onEditMsg`, `switchMemoryTab`,
  `addMemoryEntry`, `deleteMemoryEntry`, `restoreMemoryEntry`,
  `startEditMemoryEntry`, `cancelMemoryEntryEdit`, `saveMemoryEntryEdit`,
  `forgetMemoryEntry`, `undoToolAck`, `downloadConvMd`, `downloadMsgMd`,
  `toggleReasoning`, …). Le bouton « Enregistrer »
  appelle `onSaveSettings()` — à ne pas confondre avec `saveSettings(obj)` de
  `storage.js` (persistance localStorage). Le bouton du composer appelle
  `onSendBtn()` (envoi **ou** stop selon `sending`), jamais `sendMessage()`
  directement.

## Pièges déjà payés (ne pas les ré-introduire)

1. **Un seul message `role: 'system'`.** Jamais en empiler plusieurs : certains
   backends ne gardent que le premier. `buildSystemMessage()` concatène, dans
   l'ordre : le prompt système utilisateur (toujours préservé tel quel) ;
   si `includeToolsInSystemPrompt` est vrai, `toolsSystemPrompt()` (description
   redondante des outils, optionnelle) ; puis `memoryDoctrinePrompt()` (doctrine
   de déclenchement des outils mémoire (`create_memory` / `ask_confirmation`),
   **toujours** injectée si des outils sont présents — non redondante avec le schéma).
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
13. **Patienteur animé.** Remplace le caret pendant l'attente : un point qui
    pulse (`.waiter-dot`, demeure) + un mot court tiré au hasard sans répéter le
    précédent (`pickWaiterWord`, fondu via `.waiter-word.fade`). `startWaiter`
    pose le markup et lance la rotation ; `stopWaiter` nettoie **les deux
    timers** (`_waiterRotate` l'interval, `_waiterFade` le timeout de mi-fondu)
    — sinon fuite ou changement de mot après coup. Posé en WAITING
    (`startAssistantMessage`) et à la reprise après un tour `tool_calls`
    (`resetAssistant`, d'où §4 du brief couvert sans toucher `api.js`). Coupé
    net dès le premier delta `content` (`stopWaiter` en tête de `streamInto`) :
    **jamais patienteur + contenu en streaming simultanés**. Le `cursor-blink`
    reste, lui, le caret de frappe **pendant** le streaming — ne pas confondre
    les deux. La transition CSS `.waiter-word` (.28s) doit matcher le délai du
    `_waiterFade` (280 ms).
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
    que du contenu **statique** : prompt système configuré par l'utilisateur +
    `memoryDoctrinePrompt()` (toujours) + optionnellement `toolsSystemPrompt()`
    (selon `includeToolsInSystemPrompt`). Aucune dépendance à `Date.now()` ni
    aux résumés mémoire. Le contenu dynamique (date/heure, nom du modèle, bloc mémoire) est
    regroupé dans `buildContextBlock(matches)` et injecté **éphémèrement en
    préfixe du dernier message `role: 'user'`** dans `dispatchSend`, au moment
    de la construction du payload API — sans modifier `currentThread` ni
    localStorage. Le bloc est enveloppé dans `<miaou_context>…</miaou_context>`
    avec une instruction explicite demandant au modèle de ne pas acquitter ni
    mentionner spontanément ces informations. Cela préserve le préfixe `system message + historique[0..N-1]`
    byte-identique d'un tour à l'autre, ce qui permet au KV cache d'Ollama de
    réutiliser tout ce préfixe au lieu de le recalculer. Le dernier message user
    change de toute façon à chaque tour (nouvelle saisie), donc y attacher le
    contexte dynamique n'ajoute aucun coût de cache supplémentaire. Ne pas
    réintroduire `buildContextBlock()` dans `buildSystemMessage()` : le point de
    divergence serait avant tout l'historique, le cache ne profiterait plus à
    partir du 2ᵉ tour.

## Stockage (localStorage)

- `miaou-settings` : `{ url, key, model, systemPrompt, highlight, summaryInjectionMode,
  theme, showModelSelector, sidebarWidth, includeToolsInSystemPrompt }`.
  `summaryInjectionMode` ∈ `auto | propose | never`, défaut `propose`. `model` est
  le **modèle par défaut** (global). `showModelSelector` (défaut `false`) n'affecte
  que la visibilité du sélecteur dans le composer. `sidebarWidth` (défaut `264`) est
  la largeur redimensionnable de la sidebar, bornée `[264, 528]` (min = largeur
  d'origine, max = ×2), pilotée via la variable CSS `--sidebar-w`
  (cf. `initSidebarResize`, ui.js) ; pendant le drag, la classe `.resizing` coupe
  la transition de largeur, et la valeur finale est persistée au `mouseup`.
  `includeToolsInSystemPrompt` (défaut `false`) contrôle uniquement l'injection de
  `toolsSystemPrompt()` — la description textuelle redondante des outils. La doctrine
  de déclenchement (`memoryDoctrinePrompt()`) est **toujours** injectée dès que des
  outils sont présents, indépendamment de ce toggle. À activer pour les modèles qui
  lisent mal leur tool schema natif. `buildSystemMessage()` (main.js) conditionne
  l'appel ; `tools.js` reste agnostique du réglage.
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
  (cf. « Agrégation MCP distante » ci-dessous). `name` est l'identité **et** le
  préfixe d'outil (unique, charset `[A-Za-z0-9_-]`, pas de `__`, `miaou` interdit).
  `authorization_token` est stocké **en clair** (posture assumée non-prod).
  `showCalls` (booléen, défaut `true`) contrôle l'affichage des lignes d'appel
  `mcp_call` dans le thread : `false` masque le rendu DOM mais **conserve les acks
  dans l'historique** — toggle de rendu pur, sans effet sur le payload modèle. CRUD
  dans `storage.js` (`loadMcpServers`/`upsertMcpServer`/`deleteMcpServer`/
  `getMcpServer`/`listEnabledMcpServers`). **Aucun état de session/outils distants
  n'est persisté** ici : le cache (`_remoteTools`/`_remoteStatus`, tools.js) est en
  mémoire seule, reconstruit au démarrage.

## Outils (`tools.js`)

Six outils au total dans le tableau `TOOLS` ; `toolsSystemPrompt()` dérive sa
description **du registre** — ne jamais la coder en dur.

**Lecture de l'historique :**
- `get_conversation(id, with_contents=false)` — lit l'**index des résumés**
  (`getSummaryEntry`). Introuvable si pas d'entrée ou tombstone.
- `list_conversations(since?, with_contents=false)` — entrées non-tombstone
  dont `timestamp >= Date.parse(since)`. `since` optionnel. Nom conservé
  (≠ `get_conversations`) pour éviter la quasi-collision singulier/pluriel.

**Écriture directe de souvenirs (chemin direct — instruction explicite) :**
- `create_memory(content)` — écrit immédiatement dans `miaou-memories`, retourne
  l'identifiant généré (utile pour un `update_memory` ultérieur dans le même
  échange).
- `update_memory(id, content)` — correction in-place, pas de tombstone.
- `delete_memory(id)` — tombstone réversible (`suppressed: true`).

**Confirmation avant écriture (chemin inféré — fait non explicitement demandé) :**
- `ask_confirmation(question)` — outil **halting** : `runConversation` s'arrête
  immédiatement après, sans pousser de message `tool`/`tool_result` natif. La
  question (+ lead-in éventuel) est réécrite en message assistant texte clair
  (fork B). La reprise se fait au tour suivant via la réponse utilisateur
  (« Oui » / « Non » / correction libre), qui est un message user ordinaire.

**Acks d'outils côté client (`tool-ack`, ex-`memory-ack`) :**
Mécanisme **générique** couvrant les écritures mémoire, les lectures d'historique
et les appels MCP distants. Chaque handler traçable pousse un descripteur
`{ kind, … }` dans `_pendingToolAcks` (tools.js) — `kind` ∈ `memory_create |
memory_update | memory_delete | conversation_read | conversation_list | mcp_call`.
Les hooks `onEarlyAcks()` et `onToolAcks()` (main.js, décrits ci-dessous)
consomment la file via `getPendingToolAcks` / `clearPendingToolAcks` et injectent
des messages `{ role: 'tool-ack', kind, id?, content?, prevContent?, title?,
count?, server?, name?, error?, resolved? }` dans `currentThread`.
La table `ACK_KINDS` (ui.js) est **l'unique source de vérité** : par kind,
un `label(m)` (texte brut), une capacité d'annulation `undo` (fonction
`(id) => void`, ou **`null`** = variante informative), une icône SVG statique, et
optionnellement `renderLabel(m, labelEl)` pour les kinds nécessitant un rendu DOM
riche (breadcrumb avec `<code>` et séparateur — `mcp_call` uniquement).
`buildToolAck` appelle `spec.renderLabel` si présent, sinon `label.textContent`.
Ajouter un outil traçable = ajouter une ligne à `ACK_KINDS`, pas toucher au renderer.

- **Rendu** : `buildToolAck(m)` (ui.js) construit en `createElement` + `textContent`
  pour toute donnée modèle (label/title/content) ; `innerHTML` réservé à l'icône
  SVG author-controlled. La classe `ack-error` est ajoutée si `m.error` (appel MCP
  en erreur). L'action « annuler » (kinds undoables uniquement) est liée par
  `addEventListener` → `undoToolAck(entry, wrap)` (main.js), qui dispatche via
  `ACK_KINDS[kind].undo(id, entry)`. Sémantique par kind : **create** →
  `forgetMemory` (retire l'ajout) ; **delete** → `restoreMemory` (lève la
  tombstone) ; **update** → ré-écrit `entry.prevContent` via `editMemory` (l'ancien
  contenu, capturé **avant** l'écrasement par le handler `update_memory` et porté
  dans l'ack, car l'édition est in-place sans tombstone). Si `prevContent` manque
  (ack legacy), l'undo d'une édition est **no-op** — jamais de `forgetMemory` sur
  une édition. `forgetMemory`/`restoreMemory` ignorent le 2ᵉ argument. **Pas de
  lookup par `id`** : un create et un delete du même souvenir partagent `entry.id`,
  donc le handler reçoit l'entrée et le nœud DOM exacts (closure de `buildToolAck`) ;
  `entry.id` ne sert qu'à l'opération mémoire.
- **Placement = provenance, DANS la bulle** : les acks s'affichent à l'intérieur
  de la bulle assistant (`.msg.assistant`, colonne flex), **entre l'en-tête**
  (`.meta` : icône + nom du modèle) **et le corps** (`.body` : patienteur puis
  réponse). Helper unique `placeToolAck(wrap, entry)` (ui.js) : `insertBefore(node,
  wrap.querySelector('.body'))`. Pour `mcp_call`, si le serveur a `showCalls ===
  false`, ne pose pas de nœud et retourne `null` — l'entrée reste en `currentThread`
  (toggle de rendu pur). Ordre à l'écran : icône+modèle → acks (au fil des tours) →
  patienteur → réponse. `resetAssistant` ne touchant que `.body`, les acks survivent
  à la reprise d'attente entre tours. **Live** : voir ci-dessous. **Reload** :
  `renderThread` tamponne les acks (qui précèdent l'assistant dans `currentThread`,
  ordre `[user, …acks, assistant]`) et les replace dans la bulle assistant suivante
  via `placeToolAck` ; repli en blocs autonomes s'ils ne précèdent pas un assistant.
- **Timing des hooks live.** Les outils internes sont synchrones : leur ack est
  poussé dans `_pendingToolAcks` à l'intérieur du handler, et `onToolAcks()` vide
  la file **après** l'exécution de tous les outils d'un tour. Les outils MCP distants
  sont asynchrones : `callRemoteTool` pousse l'ack **de manière synchrone** (avant
  son premier `await`), puis api.js appelle `onEarlyAcks()` **avant** d'attendre la
  réponse réseau — la ligne d'appel s'affiche **pendant** le round-trip. Après
  l'`await`, si `isError`, `callRemoteTool` pose `ackEntry.error = true` sur le même
  objet ; `onToolAcks()` le détecte et rétro-applique la classe `.ack-error` + remet
  à jour le label DOM. En pratique : `onEarlyAcks` pour les pré-acks MCP ;
  `onToolAcks` pour les acks internes + la mise à jour d'erreur MCP + les blocs D8.
- **Filtrés** du payload API (`dispatchSend`, via `!isAckRole(m.role)`) — jamais
  envoyés au modèle. Les lectures atteignent le modèle uniquement via le
  `role:'tool'` in-loop de `runConversation`, jamais via l'ack.
- **Compat legacy sans migration** : les entrées `role:'memory-ack'` (champ
  `ackType`) déjà en storage sont reconnues partout (`isAckRole`, `ackKindOf`
  mappe `ackType` → `memory_*`) et **jamais réécrites** (`persistCurrent` /
  `openConversation` re-sérialisent le rôle et `ackType` tels quels). CSS :
  `.memory-ack` reste un alias de `.tool-ack`.
- Survivent au rechargement (sérialisés par `persistCurrent`, restaurés par
  `openConversation`). Traiter comme un journal d'événements immuable, pas un
  miroir de l'état mémoire. Helpers purs `isAckRole` / `ackKindOf` dans utils.js,
  `ackLabel` dans ui.js (testés QuickJS).

## Agrégation MCP distante (V2)

MIAOU est un **client/agrégateur MCP** : il fusionne ses outils internes et ceux
de N serveurs MCP distants en **un seul registre**, invisible au modèle. Les
invariants ci-dessous sont déjà payés — ne pas les ré-introduire de travers.

1. **Le préfixe est une VUE, pas un stockage.** `TOOLS` reste en noms **nus**
   (`create_memory`, …). Le préfixe `miaou__` est ajouté **à l'exposition
   seulement** par `exposedTools()` (consommé par `toolDefinitions()` et
   `toolsSystemPrompt()`). Les outils distants sont mis en cache **déjà préfixés**
   `servername__`. `parseToolName(name)` (utils, pur) splitte sur le **PREMIER**
   `__` uniquement — un `toolName` distant peut lui-même contenir `__`, un
   `split('__')` naïf le corromprait. `groupByNamespace` (pur) projette le nom
   canonique en `{namespace, bareName}` pour le sous-drawer « Voir les outils
   exposés » — rien n'est stocké, tout dérive du nom.
2. **V2 rompt délibérément le byte-identical de V1.** Les outils internes sont
   désormais envoyés au modèle préfixés (`miaou__create_memory`). Assumé : le
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
   vérifie à la main, cf. MANUAL.md).
4. **Transport.** `streamable-http` implémenté (JSON-RPC 2.0 ; un seul endpoint
   POST, réponse JSON **ou** flux SSE `event:message`/`data:` agrégé par
   `readSseJsonRpc`). `sse` legacy **différé** : `mcpRpc` **lève** « non
   implémenté » plutôt que de demi-câbler. Devinette de transport
   (`guessMcpTransport`, pur) = **pré-remplissage seulement**, jamais un override :
   l'UI ne l'applique que si le champ n'a pas été touché (`dataset.touched`).
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
8. **Blocs non-text = UI-only et ÉPHÉMÈRES (D8/D9).** `flattenToolResult` réinjecte
   les blocs `text` tels quels et remplace chaque bloc non-text par un **marqueur
   neutre** (`[image rendue dans l'interface]`, …) — **jamais** le base64 ni un
   fragment. Le marqueur (et non le vide) est délibéré : un message `tool` vide après
   un résultat image-only poussait le modèle à **simuler/encoder** l'image. Les blocs
   `image` / `resource` / binaire sont poussés dans `_pendingToolBlocks` (tools.js),
   drainés par le hook `onToolAcks` (main.js) au même tour que les acks, et rendus
   **dans la bulle assistant** par `placeToolBlocks` (cascade `renderToolBlock` :
   image → `<img>` data-URI ; resource-texte → bloc code surligné Prism via
   `textContent` ; binaire → téléchargement éphémère `downloadFile(b64ToBytes(...))`).
   **Jamais poussés dans `currentThread`, jamais persistés** — ils disparaissent au
   reload (persistance des pièces jointes = futur chantier IndexedDB, hors périmètre).
   DOM-safe : seule exception « HTML-ish » = le `src` data-URI de l'`<img>`, qui
   n'injecte aucun markup. **Deux couches pour DEUX échecs distincts** (pas
   primaire/repli) : le marqueur de `flattenToolResult` empêche le base64
   d'**atteindre** le modèle ; une règle de **formulation** l'empêche de
   **narrer/simuler** l'image même sans déclencheur. Cette règle est une doctrine
   **comportementale transverse** → `toolsDoctrinePrompt()`, **toujours injectée**
   par `buildSystemMessage()` dès que des outils existent, **indépendamment de
   `includeToolsInSystemPrompt`**. Le toggle ne gouverne que l'**énumération** par
   outil (`toolsSystemPrompt()`, token-coûteuse, redondante avec le champ API
   `tools`). Doctrine comportementale = inconditionnelle ; énumération = sous toggle.
   Surtout pas dans `MEMORY_DOCTRINE` (sans rapport avec la mémoire) ni dans une
   entrée par outil. Sans ça, le mode nothink/agentique (toggle off, le plus courant)
   perdrait le garde.
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

## Tests

Squelettes dans `tests/` exécutés par `tests/runner.py` (QuickJS, stubs
navigateur + framework maison). Seules les **fonctions pures** sont couvertes
(pas de `fetch` dans QuickJS) : tokenisation/scoring, les trois états de l'index
de résumés, le registre d'outils, parsing SSE/résumés, **horodatages**
(`formatMessageTime`, `formatFullDateFr`, `formatDateRelative`), **agrégation MCP**
(`parseToolName`, `groupByNamespace`, `guessMcpTransport`, `validateMcpServerName`,
`filterMcpTools`, routage `callTool` interne/erreur, CRUD `miaou-mcp-servers`).
Adapter un squelette est permis si le comportement testé est respecté (un cas l'a
été : `indexOf` vaut 0 pour le premier élément, donc tester la présence avec
`>= 0`, pas `toBeTruthy`). La boucle `tool_calls`, `silentCompletion` et **tout
le chemin MCP distant** (fetch JSON-RPC, SSE réel, AbortController, cascade D8) se
vérifient à la main (checklist dans `tests/MANUAL.md`). Un serveur MCP Python de
banc d'essai versionné est fourni : `tests/mcp_bench.py` (`uv run tests/mcp_bench.py`).

## Export Markdown et téléchargements

- `downloadFile(filename, content, mimeType)` dans `utils.js` : Blob +
  `createObjectURL` + `<a download>` éphémère + clic programmatique +
  `revokeObjectURL`. **N'est pas un outil LLM.** Point d'entrée unique pour
  tout téléchargement côté client (blocs de code, messages, export conversation,
  et futurs backup/import).
- `LANG_TO_EXT` / `langExt(lang)` dans `utils.js` : table langage → extension.
  Fallback `.txt` si le langage est absent ou inconnu.
- Bouton `.code-dl` dans `decoratePre` (ui.js) : posé aux côtés de `.code-copy`,
  télécharge le contenu brut du bloc.
- **`.msg-dl` (bouton download d'un message assistant) porte l'attribut `hidden`
  à la création** (`assistantHead`) et est révélé uniquement par `finalizeAssistant`
  (message live) **et** `buildMsg` (reload depuis storage). Ne jamais l'afficher
  avant finalisation — le contenu est incomplet pendant le streaming.
  Le contenu brut à télécharger est stocké dans `body.dataset.raw`, posé par
  `finalizeAssistant` et `buildMsg` (chemin reload). Si on retouche l'un ou
  l'autre, s'assurer que `dataset.raw` est bien mis à jour.
- **`.conv-dl-btn` (export de la conversation) est désactivé (`disabled`) pendant
  le streaming** via `setSending` (ui.js). CSS : `.conv-dl-btn:disabled` masque
  le bouton. `downloadConvMd()` (main.js) ne garde que les rôles `user`/`assistant`
  (les `tool-ack`/`memory-ack` sont donc exclus) et inclut l'horodatage par message
  si `ts` est défini.
- **`.msg-ts` user est un sibling de `.bubble`**, pas un enfant — `align-items:
  flex-end` du `.msg.user` gère l'alignement à droite. Ne pas le mettre à
  l'intérieur du bubble (sinon il serait exclu/recréé lors des reconstructions
  de `bubble.innerHTML` comme dans `cancelEdit`).

## Horodatages des messages

- `formatMessageTime(ts, now)`, `formatFullDateFr(ts)` et `formatDateRelative(ts, now)`
  dans `utils.js` : fonctions pures, **sans `Intl` ni `toLocaleString`** (déterminisme
  + testabilité QuickJS). Abréviations et noms complets des jours/mois codés en dur
  en français.
- `SHOW_YEAR_AFTER_DAYS = 183` : constante nommée, exprimée en jours (pas en
  mois calendaires), testable par soustraction d'epoch.
- `_startOfDay(d)` : helper interne (minuit local, DST-safe) partagé par
  `formatMessageTime` et `formatDateRelative`. Le delta calendaire se calcule via
  `Math.round((_startOfDay(n) - _startOfDay(d)) / 86400000)` — **`Math.round`, pas
  `Math.floor`** : au passage heure d'été un jour calendaire adjacent dure 23h,
  `floor` le classerait à tort comme « aujourd'hui ».
- `formatMessageTime` distingue le découpage **calendaire** (minuit/minuit) de la
  fenêtre 24h glissante : un message d'hier à 23:50 est « hier » même si < 24h
  se sont écoulées ; un message à 00:10 aujourd'hui est l'heure courte même si
  > 9h se sont écoulées.
- `formatDateRelative` est **date-only** (pas de composante horaire) : tiers
  aujourd'hui / hier / avant-hier / `"3 mars"` / `"12 janvier 2024"`, réutilise
  `SHOW_YEAR_AFTER_DAYS` et `FR_MONTHS_FULL`. Employé par `showSummaryBanner` pour
  les dates des items de la liste.
- `formatFullDateFr` (ex. « jeudi 26 juin 2026 à 14:30 ») est réservé aux
  **tooltips de la sidebar** (`:hover` = contexte de détail, l'année toujours
  présente). Pour les horodatages inline des messages, utiliser `formatMessageTime`.
- Le champ `ts` (epoch ms) est posé par `sendUserText` (user), `onFinal` et
  `onToolTour` (assistant). Absent sur les anciens messages → affichage sans
  horodatage, pas de crash.

## Règle d'or

En cas d'ambiguïté sur un point non couvert ici : **signaler plutôt que deviner**.
Le projet a déjà payé le prix de suppositions hâtives.

> Note : `.bg-activity` n'était pas dans la maquette d'origine et a été implémenté
> en intérimaire. **Avant de le retravailler**, demander les spécifications HTML/CSS
> plutôt que de redessiner à l'aveugle. (`.summary-banner` a depuis reçu une spec et
> une implémentation définitives — cette mise en garde ne le concerne plus.)
