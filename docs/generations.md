# Générations (multitâche) — lot T

Une **génération** est un échange en vol (stream SSE + boucle d'outils) qui
appartient à **une conversation**, pas à l'écran. Elle continue de recevoir, de
muter son thread et de persister dans sa conversation même si l'utilisateur
navigue ailleurs — voire change d'Espace.

État d'avancement : **T-1 livré** (T-1a état & persistance, T-1b présentation &
rebranchement, T-1c contexte d'exécution des outils). Reste la **vérification
e2e** — voir « Ce qui n'est pas encore fait » en fin de document.

## Portée de survie

**L'onglet ouvert seulement.** La génération vit en mémoire JS tant que la page
n'est pas rechargée/fermée. **Aucune reprise après reload**, aucun état de stream
partiel persisté : un reload pendant une génération la perd, comme avant le lot.
C'est une décision de lot, pas une limite d'implémentation.

## L'objet génération

`createGeneration(convId, thread, opts)` (main.js) :

```
{ id, convId, spaceId, thread, model, serverName, reasoningEffort,
  convModel, convReasoningEffort, needTitle, abort, status, startedAt }
```

Trois champs méritent une justification :

- **`thread`** — SON tableau de travail. Les hooks de `dispatchSend` le mutent au
  lieu de `currentThread`. Tant que la conversation reste affichée, c'est la
  **même référence** que `currentThread` (pas une copie) : les mutations restent
  donc directement visibles par `renderThread`, exactement comme avant le lot.
- **`spaceId`** — figé au démarrage. Une génération lancée dans l'Espace X reste
  dans le référentiel de X même si l'utilisateur bascule sur Y (herméticité,
  piège 18). Posé par T-1a, **exploité par T-1c**.
- **`needTitle`**, **`convModel`**, **`convReasoningEffort`** — figés au
  démarrage, pour que la fin d'échange ne relise aucune globale d'écran.

## Le registre

`_activeGenerations`, `Map<convId, gen>`. Clé par **`convId`**, pas par `gen.id` :
tous les consommateurs posent la même question — « cette conversation
génère-t-elle ? ». Corollaire **voulu** : deux générations concurrentes sur la
même conversation sont impossibles par construction (un second envoi reste
refusé/mis en file par les interjections, lot Q — arbitrage du brief).

Accesseurs : `generationFor(convId)` et `isGenerating(convId)`. **Un seul
prédicat, jamais réécrit localement** — même discipline que `spaceConvIds`
(piège 18).

Cycle de vie : `registerGeneration(gen)` / `unregisterGeneration(gen)`. Ils
portent aussi le relais multi-onglets et le drain des actions de synchro
différées (voir `docs/multitab-sync.md`). `unregisterGeneration` ne retire du
registre que **si c'est bien cette génération** : une conversation supprimée puis
recréée, ou un enchaînement rapide, ne doit pas faire sauter celle d'une autre.

## Les deux chemins de persistance

| Fonction | Lit | Écrit dans | Pour |
|---|---|---|---|
| `persistCurrent()` | `currentThread` | `currentConvId` | mutations d'**écran** (édition, suppression, troncature) |
| `persistGeneration(gen)` | `gen.thread` | `gen.convId` | mutations de **génération** (tous les hooks) |

**C'est cette séparation qui rend une génération détachée inoffensive.** Sans
elle, une génération sur A appelant `persistCurrent()` après une navigation
écrirait le thread de A dans la conversation affichée B — corruption franche.

Les deux partagent la projection **pure** `projectThreadToMessages(thread)`
(réciproque de `projectConvMessages`), testée en QuickJS. Une seule formule :
deux formules divergentes feraient qu'une conversation persistée en arrière-plan
ne serait pas identique à la même persistée depuis l'écran.

`persistGeneration` **ne ressuscite pas** une conversation supprimée pendant la
génération (`if (!conv) return`) — même posture que `summarizeIfNeeded` (piège 20).

La **doctrine d'écriture unique par échange est inchangée** : `onFinal`/`onHalt`
restent les seuls points d'écriture (plus `onToolTour`). T-1 change seulement *où*
ils écrivent.

## Rebranchement des données (`openConversation`)

Le point de synchronisation dangereux : revenir sur une conversation qui génère.
Son `gen.thread` est **en avance sur le storage** (l'unique écriture a lieu en fin
d'échange), donc relire le storage effacerait visuellement le tour en cours.

`openConversation` consulte donc `generationFor(id)` **après son await** (invariant
read-after-await, piège 24 — une génération peut démarrer ou finir pendant
`loadConversationResources`) et adopte la **même référence de tableau** :

```js
const gen = generationFor(id);
currentThread = gen ? gen.thread : projectConvMessages(conv);
```

Puis `setSending(!!gen)` : composer, bouton stop et mode file des interjections
suivent la conversation **affichée**. Sans cet appel, le composer resterait en
mode « stop » sur une conversation inerte.

## `sending` est un reflet d'écran, pas un compteur global

Depuis T-1a, `sending` répond à « la conversation **affichée** génère-t-elle ? »
— et bascule donc aussi sur un simple changement de conversation. C'est la bonne
question pour ses call-sites (composer, bouton stop, gardes d'édition), qui
concernent tous la conv affichée.

**Bonne question ne veut pas dire question suffisante.** Les gardes d'édition en
sont l'exemple : `sending` y empêche bien de réécrire le fil pendant qu'il
streame **sous les yeux**, mais un parent inerte dont des agents travaillent a
`sending === false` — et réécrire son historique fait atterrir le compte rendu
de l'agent derrière un fil qui ne pose plus la question à laquelle il répond.
`editUserMessage` et `regenerateResponse` cumulent donc `sending` **et**
`hasWorkingAgent` : deux questions distinctes, deux prédicats, aucun des deux ne
subsumant l'autre (cf. `docs/agents.md`, « Réécriture d'historique »). Le
réflexe à garder quand on lit un `if (sending)` : demander si le geste gardé est
sensible à une génération que l'écran ne montre PAS.

**Ne pas en faire un compteur global** (« une génération tourne quelque part ») :
l'affordance globale est portée depuis T-2 par les pastilles d'activité, qui
dérivent du **registre** (`convBadgeState` / `aggregateBadgeState`, cf.
`docs/badges.md`), jamais de `sending`. Deux conséquences déjà tirées :

- Le **relais multi-onglets** ne peut plus s'y accrocher (il suit le cycle de vie
  de la génération) — il lui faut un appariement `-started`/`-ended` stable.
- Le **drain des actions de synchro différées** non plus, et leur **garde** doit
  tester `_activeGenerations.size`, pas `sending`.

## Abort ciblé

L'`AbortController` appartient à la génération (`gen.abort`, posé par
`streamCompletion` via `o.gen`), plus au module (`_currentAbort` supprimé) : un
singleton ferait écraser le controller de la première génération par la seconde —
stopper l'une stopperait l'autre, ou rien.

`abortStream(convId)` (main.js, plus api.js — c'est le registre qui détient les
controllers) cible **une** conversation. Le bouton stop du composer passe
`currentConvId` : il n'interrompt que la génération affichée, les détachées
continuent. Le contenu déjà reçu est conservé, aucun tour n'est relancé (piège 10).

`gen.abort` ne vit que le temps du `fetch` de `streamCompletion` : pendant un
tour d'outils (MCP distant, `js__eval`…), il vaut `null` — rien à annuler dans
l'instant. `abortStream` pose alors `gen.stopRequested = true` ; `runConversation`
(api.js) le consulte à la frontière de tour suivante et sort par le même chemin
que `result.aborted` (l'outil déjà en vol n'est jamais coupé, seul le tour
suivant ne part pas). `setStopping(true)` (ui.js) désactive le bouton composer
et pulse son icône pendant cette attente, pour qu'un reclic soit impossible
plutôt que silencieusement sans effet.

## Présentation : un prédicat, deux temps (T-1b)

Le couplage à l'écran est direct : les hooks appellent `streamInto`,
`placeToolAck`, `finalizeAssistant`… sur une bulle DOM. Après une navigation,
ces appels **ne crashent pas** — ils écrivent dans un sous-arbre détaché. Le
travail est perdu **silencieusement** côté écran.

**`genOwnsScreen(gen)`** (`gen.convId === currentConvId`) est LE prédicat. Un
seul, jamais réécrit localement. Tous les hooks se scindent en deux temps, dans
cet ordre :

1. **muter `gen.thread`** — TOUJOURS ;
2. **refléter dans le DOM** — seulement si `genOwnsScreen(gen)`.

**(1) ne doit jamais dépendre de (2)** : aucune entrée de thread n'est construite
à partir d'une valeur lue dans le DOM.

`gen.wrap` remplace la variable `wrap` en closure — c'est ce qui permet au
détachement de la mettre à `null`.

### Le partiel du tour vit sur la génération

`gen.partialContent` / `gen.partialReasoning`, alimentés par `onDelta`/`onReasoning`.
Avant T-1b, le texte partiel ne vivait **que dans le DOM** (`body.dataset.raw`) :
c'était la seule donnée réellement perdue par un détachement, et donc la seule
que le rebranchement n'aurait pas pu restituer. Remis à zéro à chaque **frontière
de tour** (`onToolTour`), sinon un rebranchement ultérieur ré-afficherait le
texte du tour précédent.

Corollaire non évident : une génération détachée ne doit surtout pas appeler
`streamInto`/`setReasoning`, qui rangent `wrap` dans un **slot de throttle
partagé au module**. Le timer repeindrait alors un nœud orphelin — ou pire,
écraserait le rendu de la génération qui, elle, possède l'écran.

### Rebranchement : le même chemin que le reload

`attachGenerationToScreen(gen)` rend l'historique via **`renderThread`** — le
chemin du reload, jamais une reconstruction dédiée. C'est l'invariant live=reload
du lot Q qui paie ici : la piste « chemin de rendu spécial » avait produit le
`.ack-shell` et une divergence à rustiner.

Une difficulté propre au vol : le fil d'une génération en cours se termine par
les acks du tour **sans l'assistant qui les clôt** (il n'existe qu'à `onFinal`).
`renderThread` rend les acks dans la bulle qui les **suit** ; sans suivant, il
retombe sur sa branche « acks orphelins » et les rend **nus, hors bulle**. D'où
la fonction pure **`splitTrailingAcks(thread)`** (testée QuickJS) : le corps part
au rendu normal, la queue est replacée dans la bulle vive.

`attachGenerationToScreen` restitue ensuite l'état du tour : le patienteur (posé
par `startAssistantMessage`) tient WAITING/TOOLS, et `streamInto(gen.partialContent)`
prend le relais s'il y a déjà du texte (il coupe le patienteur lui-même).

`detachGenerationFromScreen(gen)` met `gen.wrap = null`, arrête le patienteur et
annule les rendus throttlés en vol. **Rien d'autre — surtout pas d'abort.**

### Tout re-rendu du fil passe par `rerenderCurrentThread()`

Un `renderThread(currentThread)` nu détruirait la bulle vive et laisserait
`gen.wrap` sur un nœud orphelin — le stream écrirait dans le vide jusqu'à la fin
du tour, sans erreur visible. Les appelants qui reconstruisent `#thread` de fond
en comble (bascule de coloration, réglages, rehydratation) passent donc par
`rerenderCurrentThread()`, qui reprend le chemin d'attache s'il y a une
génération.

Exception légitime : `editUserMessage` et `regenerateResponse` gardent
`renderThread` nu — ils sont gardés par `if (sending) return`, qui signifie
précisément « la conversation affichée génère », donc le cas ne peut pas se
produire.

### Le patienteur reste mono-écran (piège 13)

`startWaiter`/`stopWaiter` pilotent deux timers de module : ce n'est pas un état
de génération, c'est un état d'**écran**. Règle : **seule la génération qui
possède l'écran pilote le patienteur.** On ne les multiplie pas, on ne les scope
pas par génération.

### La file d'interjections appartient à sa conversation (révisé X-1e)

`_pendingInterjections` est une **`Map<convId, items[]>`**, et `onInterjections`
comme `settleInterjectionQueue` la ciblent par **`gen.convId`** — jamais par
l'écran. Une génération détachée draine donc SA file, et laisse intacte celle de
la conversation affichée.

Ce fut d'abord un **état d'écran** (lot Q) : un tableau unique, gardé par
`genOwnsScreen`. Cohérent tant qu'une génération appartenait à l'affichage, ce
qui a cessé au lot T — et la question « qui va recevoir ce message ? » n'avait
plus de réponse stable, le destinataire changeant avec l'écran. Cf.
`docs/interjections.md` pour le constat de test et la table des quatre cas du
drain A.

Ce qui reste gardé par `genOwnsScreen` dans `onInterjections`, ligne par ligne :
les effets **DOM** (la bulle close, la bulle user peinte, le `wrap` neuf). Muter
le thread a lieu toujours — c'est la scission habituelle.

### Ce qu'une génération détachée perd, délibérément

- Les **blocs d'outils non-textuels** (`placeToolBlocks` : image/ressource
  renvoyée par un MCP). Ils sont éphémères par conception — jamais poussés
  dans le thread ni persistés — donc ni reconstructibles ni rendus au reload.
  Cohérent avec leur nature ; ce n'est pas une régression de T-1b.
- La **carte de confirmation** d'un outil halting (`showConfirmation`). C'est un
  overlay **modal**, et sa réponse part sur la conversation **affichée** :
  l'ouvrir depuis une génération détachée demanderait de répondre pour une
  conversation qu'on ne regarde pas, et enverrait la réponse ailleurs. La
  question, elle, **reste dans le fil** (message assistant persisté) : revenir
  sur la conversation la montre, et y répondre reprend le fil.

## Générations qui DÉMARRENT sans écran : agents et réveil de parent (lot X-1)

Le lot X-1 ajoute deux générations qui démarrent sur une conversation non
affichée : celle d'un **agent** (`runAgentGeneration`, agents.js) et celle d'un
**parent réveillé en arrière-plan** (`runDetachedGeneration`). Elles réutilisent
tout ce qui précède — registre, abort ciblé, `persistGeneration`,
`projectThreadToMessages`.

**Elles démarrent sans écran ; elles ne restent pas sans écran.** X-1 les avait
écrites avec la seule moitié « données » des hooks (aucun `startAssistantMessage`,
aucun `streamInto`, aucun `placeToolAck`), sous la prémisse « un agent ne possède
jamais l'écran par construction ». Cette prémisse était fausse dans le lot même
qui l'écrivait : X-1 rend le fil d'un agent ouvrable (libellé cliquable, popover
d'inventaire, palette), et rien n'empêche de revenir sur un parent pendant que
son réveil tourne — c'est même le geste naturel quand l'agent vient de finir.

Le symptôme était un fil **muet** : `attachGenerationToScreen` rebranchait bien
`gen.wrap`, mais plus aucun hook ne peignait dedans. On voyait le partiel figé à
l'instant du rebranchement, puis un curseur qui clignotait jusqu'au bout. Aucune
donnée perdue (tout était persisté), donc un aller-retour montrait la réponse
complète — ce qui rendait le défaut facile à prendre pour un caprice d'affichage.
Second symptôme, même racine : leur `onEarlyAcks` drainait l'ack MCP de
`_pendingToolAcks` pour le copier dans le fil, si bien que le
`updateLastPendingToolAck` de leur `onEnrichLastAck` enrichissait une file vide.
`args`/`result` n'atteignaient jamais l'entrée persistée, donc
`ackHasInspectableDetail` répondait faux : **pas de loupe d'inspecteur dans un
fil d'agent, ni pendant ni après reload**.

### Les points d'écriture partagés (main.js)

Le correctif ne duplique pas les hooks de `dispatchSend` — ce serait le motif
« deux jeux de hooks corrects séparément qui divergent en silence ». Il factorise
les écritures qu'une génération sans moitié écran effectue, chacune appliquant la
scission du piège 28 (muter toujours, peindre si `genOwnsScreen`) :

| Fonction | Écrit | Peint si l'écran est possédé |
|---|---|---|
| `setGenPartialContent` / `setGenPartialReasoning` | `gen.partialContent` / `…Reasoning` | `streamInto` / `setReasoning` |
| `pushGenToolAck` | entrée `tool-ack` dans `gen.thread` | `placeToolAck`, rend `{entry, node}` |
| `pushGenMessage` | message dans `gen.thread` | bulle, selon `kind` |
| `clearGenLiveBubble` | — | referme la bulle vive d'une sortie non nominale |

`pushGenMessage` a trois `kind`, qui se distinguent par ce qu'ils laissent dans
`gen.wrap` : `'assistant'` finalise et **rouvre** une bulle (le travail
continue), `'user'` insère une bulle utilisateur puis rouvre (interjection,
résultat d'agent réinjecté), `'final'` finalise **sans rouvrir** — la génération
se termine, et une bulle vive de plus resterait en attente de rien. Les deux
premiers laissent donc toujours `gen.wrap` sur une bulle vive, ce que le
rebranchement et les hooks suivants supposent.

`clearGenLiveBubble` couvre les sorties **sans `onFinal`** (stop utilisateur,
borne de tours épuisée, parent supprimé) : sans lui, la bulle vive resterait à
l'écran avec son patienteur en train de tourner pour un travail terminé. Il
retire la bulle si elle n'a jamais rien reçu, et la conserve si elle porte les
acks du tour interrompu — ceux-là sont dans le fil et doivent rester visibles.

Le registre des acks MCP peints avant leur round-trip est lui aussi factorisé
(`createEarlyAckRegistry` / `applyEarlyAckError` / `enrichLastEarlyAck`) :
`dispatchSend` en tenait un en closure, les chemins agents n'en avaient aucun.
La reprise vaut **même sans écran** — elle porte alors sur la seule donnée, qui
est ce qui est persisté et relu.

`dispatchSend` **garde ses propres hooks** : il en fait davantage à chaque point
(manifeste de contexte, affordances différées, carte de confirmation), et les
réécrire par-dessus ces helpers ferait perdre ce surplus.

**Ce qui reste délibérément non peint** : les blocs non-texte d'un outil distant
(image, ressource binaire). Ils ne sont ni poussés dans le fil ni persistés, donc
pas reconstructibles au reload — les peindre dans un fil d'agent affiché ferait
diverger live et reload sur un contenu que le second ne peut pas montrer. Cf.
« Ce qu'une génération détachée perd, délibérément » plus haut.

**Le point neuf, et il viole une prémisse de ce document** : `dispatchSend` part
toujours de l'écran (« un envoi part toujours de la conversation affichée, donc
on possède l'écran ici »). Le réveil d'un parent non affiché ne le peut pas.
D'où deux branches explicites dans `startParentWakeGeneration`, et un prédicat
nommé `parentThreadFor` pour la question dangereuse — `currentThread` (même
référence) si le parent est affiché, `projectConvMessages` sinon. Détail complet
dans `docs/agents.md`.

Un troisième hook rejoint `onInterjections` à la frontière de tour :
`onAgentResults`, sans garde `genOwnsScreen` — un résultat d'agent appartient à
la conversation, pas à l'écran.

## Contexte d'exécution des outils (T-1c)

Un outil s'exécute **pour** une conversation et **dans** un Espace : ceux de la
génération qui l'a demandé, jamais ceux de l'écran. C'est le foyer le plus
insidieux du lot — il ne casse pas visiblement, il donne de **mauvaises
réponses**. Un `conv__get`, `files__list` ou `recall_attachment` lancé par la
génération de A pendant que l'écran affiche B répondait dans le référentiel de
B, herméticité des Spaces comprise : **violation silencieuse du piège 18**.

### Argument explicite, jamais une variable de module

Le contexte transite en **argument** (`ctx`) le long de la chaîne :

```
runConversation (toolExecContext, dérivé de h.gen)
  → callTool(name, args, ctx)
    → callInternalTool(toolName, args, ctx)
      → tool.handler(args, ctx)            ← ctx déjà normalisé
    → callDocsInflatedRemoteTool(…, ctx)
      → _resolveInflationRef(ref, ctx) → resolveHandleRecord(ref, ctx)
```

**Pourquoi pas une variable de module** posée autour de l'appel : trois handlers
sont `async` (`files__promote`, `resource__create`, `resource__from_result`).
Tout état de module relu **après leur premier `await`** verrait le contexte
d'une autre génération — le bug d'origine sous une forme plus difficile à
détecter. Avec un argument, le contexte est capté à l'entrée du handler et ne
peut plus bouger.

### `toolCtx(ctx)` : un seul point de lecture

Normalise et applique le repli sur l'état d'écran pour les appels **hors
génération** (drawer d'outils, tests). Subtilité : `convId: null` explicite est
une **valeur**, pas une absence — une génération sur une conversation pas encore
créée porte `null`, et retomber sur l'écran la ferait répondre ailleurs. D'où le
test sur `!== undefined`, jamais sur la véracité.

### Critère de complétude : une commande, pas une revue

`TOOLS` est un tableau littéral de fonctions flèches : un handler oublié
retomberait **silencieusement** sur la globale. Le critère est donc vérifiable :

```bash
grep -n "currentConvId\|activeSpaceId" src/js/tools.js   # → seulement toolCtx
grep -n "currentConvId\|activeSpaceId" src/js/api.js     # → rien
```

Les 19 gardes défensives `typeof X !== 'undefined' ? X : <défaut>` ont disparu
avec la conversion. Effet de bord favorable **et vérifié** : les handlers scopés
sont désormais couvrables par les tests purs — ce qu'ils n'étaient pas. Les
tests T-1c posent délibérément une globale d'écran **contradictoire** ; ils
échouent si un handler relit la globale (vérifié en injectant la régression).

## Titrage et résumé

- **`maybeTitle(gen)`** prend la génération : le besoin de titrage et le thread
  lui appartiennent, une génération détachée doit pouvoir titrer SA conversation.
  `gen.needTitle` figé au démarrage préserve le piège 9 — la globale d'écran ne
  gouverne plus rien ici.
- **`summarizeIfNeeded(id)`** refuse une conversation qui génère (`isGenerating`).
  Résumer un thread non stabilisé produirait un résumé d'état intermédiaire, et
  le `messageCount` enregistré empêcherait le vrai résumé plus tard. Vaut aussi
  pour la conversation qu'on **quitte** (`selectConv` → `summarizeIfNeeded(leaving)`)
  — précisément le cas que ce lot rend possible.

## Vérification

`.claude/skills/run-miaou/verify-generations.mjs` — stub SSE **gaté par
conversation** (chaque requête est étiquetée par le `CONV-X` de son dernier
message user), ce qui rend N générations concurrentes pilotables : on tient A
ouverte, on navigue, on en lance une sur B, on libère dans l'ordre voulu.

Couvre les scénarios 1, 2, 3, 3bis, 4, 5 et 6 du brief.

Le **scénario 7** (relais lot J) vit dans `verify-multitab-sync.mjs`, qui a déjà
le montage à deux onglets : deux générations en vol sur deux conversations,
chacune verrouille SA conv chez le pair, et la fin de l'une ne libère pas
l'autre. Vérifié non vacuant en réinjectant le relais **scalaire** d'avant T-1 —
le test tombe alors sur la Map et sur le readonly du pair.

Deux pièges d'écriture, payés et consignés dans le script :

- **Les appels silencieux** (titrage, résumé) portent une TRANSCRIPTION en
  payload, donc le `CONV-X` de la conversation : sans les filtrer (`stream !==
  true`), ils sont étiquetés comme des générations et faussent tous les
  comptages.
- **Le tour d'outils doit être gaté AVANT `finish_reason`.** Sans ce gate, il
  partait immédiatement — donc avant le changement d'Espace — et l'outil
  s'exécutait alors que l'écran était encore dans le bon Espace : le scénario 4
  passait **même avec la régression réinjectée**. Vacuité constatée, puis
  corrigée ; le test échoue désormais bien sur les deux assertions quand
  `conv__list` relit la globale.

## Dette : `src/help.md`

T-1 change du **comportement visible par l'utilisateur** — quitter une
conversation ne l'interrompt plus, le bouton stop ne stoppe que ce qui est
affiché — donc la question du réflexe `help.md` se pose (cf. CLAUDE.md).

**Reportée à T-2 délibérément, et SOLDÉE là** : c'est le badge qui rend la
capacité *perceptible*. Documenter « ça continue en arrière-plan » alors
qu'aucun indicateur ne le montre aurait décrit une fonctionnalité invisible, et
un trou de doc se lit comme « impossible ». La section `interface` de
`src/help.md` couvre désormais les trois points (nuance sur le bouton stop,
« Plusieurs réponses à la fois », « Pastilles d'activité ») — cf.
`docs/badges.md`.

## Vérification

- **Vérification e2e — livrée** (`.claude/skills/run-miaou/verify-generations.mjs`).
  T-1 n'a pas de pixel à montrer : son critère est un invariant. Le scénario 4
  (deux générations concurrentes dans deux Espaces appelant chacune un outil
  scopé) est celui qui attrape le foyer 3 — **sans lui, T-1 serait vert et
  faux** ; les tests QuickJS de T-1c couvrent le contrat de `ctx` au niveau
  unitaire, mais **pas** le câblage bout-en-bout. Le relay multi-onglets est
  couvert à part (scénario 7 de `verify-multitab-sync.mjs`).

**Le scoping des registres pendants est tranché** (mesuré, pas raisonné) : les registres pendants
(`_pendingToolAcks` / `_pendingImageInjections` / `_pendingToolBlocks`) restent
des **singletons de module, sans scoping**. Le scénario 3bis du verify construit
le cas redouté — deux générations bloquées ensemble dans leur tour d'outils,
libérées simultanément — et constate qu'elles ne mélangent rien : chaque
conversation porte exactement son ack. Le drain synchrone dans le tour qui les
produit (`onEarlyAcks` avant l'await, `onToolAcks` après) suffit. Ne pas
« corriger » ce qui n'est pas cassé ; si un cas futur les fait diverger, c'est
ce scénario qu'il faut étendre d'abord.
