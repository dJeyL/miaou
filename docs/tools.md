# Outils (`tools.js`), acks, et références de conversation

## Registre d'outils

Neuf outils au total dans le tableau `TOOLS` ; `toolsSystemPrompt()` dérive sa
description **du registre** — ne jamais la coder en dur.

**Lecture de l'historique :**
- `get_conversation(id, with_contents=false)` — lit l'**index des résumés**
  (`getSummaryEntry`). Introuvable si pas d'entrée ou tombstone.
- `list_conversations(since?, query?, with_contents=false)` — entrées
  non-tombstone dont `timestamp >= Date.parse(since)`, **exclut toujours la
  conversation courante** (`currentConvId`, global de main.js — accès défensif
  via `typeof … !== 'undefined'` car tools.js est aussi évalué seul par le test
  runner) : « conversations passées » n'inclut pas celle en cours. `since` et
  `query` optionnels, filtres cumulables (since puis query). `query` réutilise
  le **même moteur que la recherche sidebar** (`tokenize` + `scoreSummary`,
  utils.js, seuil `score >= 1`) — mots-clés pèsent 2, mots du résumé/titre
  pèsent 1 ; ce n'est PAS une sous-chaîne exacte. Nom conservé
  (≠ `get_conversations`) pour éviter la quasi-collision singulier/pluriel.

**Écriture directe de souvenirs (chemin direct — instruction explicite) :**
- `create_memory(content)` — écrit immédiatement dans `miaou-memories`, retourne
  l'identifiant généré (utile pour un `update_memory` ultérieur dans le même
  échange).
- `update_memory(id, content)` — correction in-place, pas de tombstone.
- `delete_memory(id)` — tombstone réversible (`suppressed: true`).

**Présentation de ressource :**
- `present_resource(id)` — handler **synchrone** (lookup `_resourceCache`) ; pousse
  un ack `resource_presented` — le rendu du bloc (image, code, téléchargement) est
  délégué à `placeToolAck` (même chemin live et reload via IDB). Renvoie une erreur
  textuelle si l'id est inconnu du cache session.

**Skills (sous-namespace `miaou__skills__`, cf. `docs/skills.md`) :**
- `skills__list()` — méta (`slug`, `name`, `description`) des skills **activés
  uniquement**, depuis le cache mémoire (synchrone). Pousse un ack `skill_list`
  (informatif, sans undo, icône `ICON_LIST` réutilisée de `conversation_list`).
- `skills__read(slug)` — corps Markdown complet d'un skill activé. Contrôles
  introuvable/désactivé sur le cache mémoire = **erreur synchrone** (testable
  QuickJS) ; le contenu vient d'IDB = **handler asynchrone** (renvoie une
  `Promise<string>`). `callInternalTool` détecte un retour thenable et le mappe.
  `api.js` calcule `isMcp` via `parseToolName` (préfixe ≠ `miaou`/`''`), **pas**
  par duck-typing `.then`, sinon cet outil interne async serait pris pour un appel
  distant. Pousse un ack `skill_read` (informatif, sans undo) — nom du skill stocké
  dans `title` (pas `name` : `onEnrichLastAck` écrase `name` avec le nom canonique
  de l'outil pour la réinjection cross-turn).

**Confirmation avant écriture (chemin inféré — fait non explicitement demandé) :**
- `ask_confirmation(question)` — outil **halting** : `runConversation` s'arrête
  immédiatement après, sans pousser de message `tool`/`tool_result` natif. La
  question (+ lead-in éventuel) est réécrite en message assistant texte clair
  (fork B). La reprise se fait au tour suivant via la réponse utilisateur
  (« Oui » / « Non » / correction libre), qui est un message user ordinaire.

## Acks d'outils côté client (`tool-ack`, ex-`memory-ack`)

Mécanisme **générique** couvrant les écritures mémoire, les lectures d'historique
et les appels MCP distants. Chaque handler traçable pousse un descripteur
`{ kind, … }` dans `_pendingToolAcks` (tools.js) — `kind` ∈ `memory_create |
memory_update | memory_delete | conversation_read | conversation_list | mcp_call |
resource_stored | resource_presented | resource_deleted | skill_list | skill_read`.
Les hooks `onEarlyAcks()` et `onToolAcks()` (main.js) consomment la file via
`getPendingToolAcks` / `clearPendingToolAcks` et injectent des messages
`{ role: 'tool-ack', kind, id?, content?, prevContent?, title?, count?, server?,
name?, error?, resolved?, mime?, size?, args?, result?, ts?, group?,
assistantText?, intent?, slug?, convId? }` dans `currentThread`.
⚠ **Trois copies** de cette whitelist de champs coexistent (`onToolAcks`,
`onEarlyAcks` dans main.js, et `openConversation`/`persistCurrent` pour la
persistance) : un champ ajouté à un `kind` doit être répercuté dans **toutes**
les copies pertinentes, sinon il est silencieusement perdu au premier rendu
live ou à la première réouverture (piège déjà payé avec `convId`/`slug`).

Les champs `args` (objet d'arguments), `result` (résultat aplati par
`flattenToolResult`), `ts` (epoch ms de l'appel), `group` (id partagé par
tous les tool_calls d'un même tour modèle) et `assistantText` (texte produit
par le modèle au même tour que les tool_calls, rare) sont **les champs de
réinjection cross-turn** — voir `expandThread` ci-dessous. Ils sont posés
par le hook `onEnrichLastAck` (main.js), appelé après chaque outil par api.js,
et doivent être préservés par `persistCurrent` / `openConversation`.
`intent` (texte de `miaou_intent`) était d'abord réservé à `mcp_call`
(rendu à deux niveaux, cf. `renderLabel`/`renderIntentTwoLevel` ci-dessous) ;
il est désormais capturé pour **tous** les outils internes aussi (`callTool`,
tools.js, branche `miaou`/nue) via `updateLastPendingToolAck` — extrait des
args **avant** le strip de `miaou_intent`, attaché au dernier ack en attente.
Cas particulier : un handler qui pousse son ack **après** résolution d'une
Promise (ex. `skills__read`) ne peut pas être enrichi avant que cette Promise
ne se résolve — `callTool` attend donc cette résolution dans ce cas précis
avant d'attacher `intent`.

Rendu : `mcp_call`, `conversation_list`, `skill_list`, `conversation_read` et
`skill_read` partagent tous le même rendu à deux niveaux quand `m.intent` est
présent — intention en langage naturel (niveau 1, visible) + détail technique
(niveau 2, replié par défaut derrière un chevron `mcp-chevron`), via le helper
`renderIntentTwoLevel(el, intent, detailText, detailBuilder?)` (ui.js). Sans
intent, chaque kind retombe sur son rendu simple d'origine (texte brut ou
breadcrumb direct pour `mcp_call`). La classe `has-intent` (icône alignée en
haut, pas centrée) s'applique dès que `m.intent` est présent, quel que soit
le kind — pas seulement `mcp_call`.
`conversation_read` va plus loin : son détail replié rend le titre de la
conversation sous forme de lien cliquable (`.ack-conv-link`, `onclick =>
openConversation(m.convId)`), donc `convId` doit être renseigné par le
handler (`get_conversation`, tools.js) et préservé dans toutes les whitelists
de champs (voir avertissement ci-dessus).

La table `ACK_KINDS` (ui.js) est **l'unique source de vérité** : par kind,
un `label(m)` (texte brut), une capacité d'annulation `undo` (fonction
`(id) => void`, ou **`null`** = variante informative), une icône SVG statique,
optionnellement `renderLabel(m, labelEl)` pour les kinds nécessitant un rendu DOM
riche (rendu à deux niveaux via `renderIntentTwoLevel`, breadcrumb `<code>` pour
`mcp_call`, lien cliquable pour `conversation_read`), et optionnellement
`expand(m, containerEl)` pour les kinds avec contenu dépliable au clic (chip
« voir »/« masquer » avec rendu paresseux — aucun kind ne l'utilise actuellement ;
le mécanisme est en place pour une extension future).
`buildToolAck` appelle `spec.renderLabel` si présent, sinon `label.textContent` ;
si `spec.expand` est présent et `!m.resolved`, ajoute le chip expandable.
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
  à la reprise d'attente entre tours. **Reload** :
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
  `onToolAcks` pour les acks internes + la mise à jour d'erreur MCP + les blocs D8
  (cf. `docs/mcp.md`).
- **Payload API — `expandThread(currentThread)`** (utils.js, pur, testé QuickJS).
  Remplace l'ancien filtre `!isAckRole`. Acks **enrichis** (champs `args` +
  `result` présents) → expansés en paire `[assistant+tool_calls, tool…]` pour
  réinjecter les résultats d'outils passés dans les tours suivants ; acks
  **legacy** (sans `args`) → élagués comme avant (compat ascendante). Si le
  premier ack d'un groupe porte `assistantText`, le message assistant standalone
  qui le précède immédiatement est absorbé dans le `content` de l'assistant
  expansé pour éviter la duplication. `stampTs(ts, result)` (utils.js) préfixe
  le résultat d'une date absolue immuable pour signaler l'ancienneté au modèle
  sans muter le préfixe d'historique (préserve le KV cache). **Ne jamais**
  recalculer ce stamp à chaque envoi — il est fixé à l'instant de l'appel.
  `ask_confirmation` ne produit jamais d'ack (primitif halting) ; rien à exclure.
  Les acks enrichis ne sont jamais envoyés directement au modèle — c'est
  l'expansion qui génère les messages `role:'tool'` correspondants.
- **Compat legacy sans migration** : les entrées `role:'memory-ack'` (champ
  `ackType`) déjà en storage sont reconnues partout (`isAckRole`, `ackKindOf`
  mappe `ackType` → `memory_*`) et **jamais réécrites** (`persistCurrent` /
  `openConversation` re-sérialisent le rôle et `ackType` tels quels). CSS :
  `.memory-ack` reste un alias de `.tool-ack`.
- Survivent au rechargement (sérialisés par `persistCurrent`, restaurés par
  `openConversation`). Traiter comme un journal d'événements immuable, pas un
  miroir de l'état mémoire. Helpers purs `isAckRole` / `ackKindOf` dans utils.js,
  `ackLabel` dans ui.js (testés QuickJS).

## Références de conversation dans le texte du modèle (`conv_ref`)

Le modèle peut citer une conversation passée (obtenue via `get_conversation`/
`list_conversations`) pour que l'utilisateur puisse l'ouvrir d'un clic — sans
jamais exposer son ID technique en clair dans le texte affiché.

1. **Doctrine `CONV_REF_DOCTRINE`** (tools.js), **toujours injectée** dès que
   des outils existent (même statut que `BINARY_DOCTRINE`, partie de
   `ROOT_SYSTEM_PROMPT`, constante build-time). Demande au modèle d'utiliser le
   marqueur `[conv_ref:ID]` ou `[conv_ref:ID|Titre]` (titre optionnel, connu du
   modèle depuis le JSON de `get_conversation`/`list_conversations`) plutôt que
   d'écrire l'ID en clair (backticks, guillemets, texte brut).
2. **Parsing** : `parseConvRefs(text)` (utils.js, pure, testée) extrait tous les
   marqueurs `{ match, id, title }` d'une chaîne — regex `CONV_REF_RE`, id
   délimité par `|` ou `]` (jamais ces deux caractères), titre optionnel après
   `|`, jamais de `]` non plus (pas de lookahead/lookbehind variable).
3. **Résolution = AVANT `marked.parse`, jamais après.** `resolveConvRefs(text)`
   (ui.js, testée) remplace chaque marqueur par un lien Markdown standard
   `[Titre](#miaou-conv:ID)` avant le rendu Markdown — traiter ça en
   post-traitement HTML casserait, les crochets bruts auraient déjà été
   interprétés par le parseur Markdown comme une syntaxe de lien incomplète.
   Titre : celui du marqueur si fourni, sinon lookup dans l'index des résumés
   (`getSummaryEntry`, storage.js) — **y compris une entrée tombstone**
   (`suppressed:true` ne concerne QUE le résumé/mémoire, cf. piège #6 dans
   `docs/pitfalls-detail.md` : la conversation elle-même reste intacte et
   ouvrable, son titre reste affichable normalement) ; repli sur l'ID brut si
   aucun titre n'est connu par ailleurs. **Conversation réellement supprimée**
   (`deleteConv` → `deleteSummaryEntry`, hard delete des deux, chemin *distinct*
   du tombstone) : la source de vérité pour « ouvrable » est
   **`loadConversation(id)`**, pas la présence d'un résumé (cas limite existant
   où le résumé peut survivre sans la conversation, cf. `get_conversation`).
   Dans ce cas, rendu en **texte barré NON cliquable** `~~Titre (supprimée)~~`
   (Markdown GFM standard, `marked` le rend en `<del>` sans configuration)
   plutôt qu'un lien mort — pas de post-traitement DOM. `renderMd`
   appelle `resolveConvRefs` en tête, avant `marked.parse` — pas `renderUserMd`
   (les messages utilisateur ne contiennent jamais ce marqueur).
4. **Navigation = délégation de clic unique**, posée une fois dans `init()`
   (main.js) sur `#messages` (pas un `onclick` par lien reconstruit à chaque
   rendu) : intercepte `a[href^="#miaou-conv:"]`, bloque si `sending` (pas de
   navigation pendant un stream, même garde que l'édition de message), route
   vers **`selectConv(id)`** — la même fonction que le clic sidebar, qui gère
   déjà le garde `id === currentConvId`, le résumé de sortie
   (`summarizeIfNeeded(leaving)`) et le mode mobile. Un `id` inconnu (conv
   supprimée) est un no-op silencieux (`openConversation` retourne tôt si
   `loadConversation` échoue) — pas de fonction de navigation dédiée créée,
   pas de duplication du chemin existant.
