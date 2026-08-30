# Agents — sous-conversations lancées par le modèle (lot X-1)

Un **agent** est une conversation que le **modèle** démarre pour une tâche
délimitée, qui travaille en parallèle, et dont le résultat revient dans le fil du
parent. Le lot T avait livré le multitâche — des conversations lancées par
l'*utilisateur* qui tournent de front ; X va d'un cran plus loin.

État : **X-1 livré et vérifié e2e** (modèle de données, outils `agent__*`,
exécution, réveil, badges, cycle de vie, doctrine), complété par **X-1b**
(délégation de fichiers), **X-1c** (retour au parent en topbar) et **X-1d**
(accès aux pixels d'une image déléguée) — cf. plus bas. Restent **X-2** (liste
d'agents dans la palette, `Cmd+K` puis `a`) et **X-3** (surfaces d'affichage,
ack enrichi).

## Le mot « agent » s'élargit, il ne se restreint pas

Depuis T-2bis, la pilule de topbar compte les conversations en train de tourner
et les appelle « agents ». X ne change pas ce sens : il l'**étend** aux
sous-conversations. `resolveAgentCount` reste donc juste sans modification —
elle compte simplement plus de choses. Un parent qui génère pendant qu'un de ses
agents travaille affiche « 2 agents », parce que deux choses tournent.

## Stockage : une conversation ordinaire

Décision tranchée à l'esquisse (question structurante 1) : un agent **est** une
conversation, avec un champ `parentConvId`. Cela donne gratuitement la
persistance, le cache RAM à deux étages (U-1), la recherche plein-texte (U-3),
l'export/import v3 (U-4), la synchro multi-onglets (lot J), le rendu de thread,
les pièces jointes.

L'argument décisif n'était pas le coût d'écriture mais le fait que l'énoncé
demande de **consulter** un agent : dès qu'un agent est consultable, c'est une
conversation, et lui refuser ce statut revient à réimplémenter le rendu de
conversation.

Champs ajoutés au record (cf. `docs/storage.md`) :

```
parentConvId?  : string   — id de la conversation parente (absent = racine)
parentCallId?  : string   — id du tool_call d'origine (traçabilité)
agentIntent?   : string   — libellé rédigé par le modèle, tient lieu de titre
agentStatus?   : string   — état TERMINAL seulement : done | exhausted | aborted | stopped | error
agentTurns?    : number   — tours consommés (borne)
agentFiles?    : array    — fichiers délégués (X-1b) : [{alias, recordId, name, mime, size, ref}]
```

**`listAllConversations()` porte `parentConvId` et `agentIntent`.** Cette
projection méta est la seule source de `agentChildrenOf` : les omettre rendrait
tout agent invisible *en tant qu'agent* — donc jamais exclu de la sidebar, du
backfill ni de la recherche, sans qu'aucun test ne le voie. `splitConvRecord`, en
revanche, n'a rien demandé : il copie tous les champs sauf `messages`.

## Le prédicat de racine — un seul, partout

`isRootConversation(conv)` (agents.js, pur) est LA source de vérité. Même
discipline que `spaceConvIds` (piège 18) : **jamais** un `c.parentConvId == null`
réécrit localement. `isAgentConversation` est son contraire nommé, pas une
seconde formule.

Une **chaîne vide n'est pas un parent** : `{ parentConvId: '' }` est une racine.
C'est le cas d'un record legacy ou d'une désérialisation qui pose le champ sans
valeur ; le traiter comme un agent le rendrait invisible partout, en silence.

### Les huit sites d'exclusion

| Site | Fonction | Fichier |
|---|---|---|
| Résumé en vol | `summarizeIfNeeded` | main.js |
| Titrage | `gen.needTitle = false` à la création | agents.js |
| Sidebar (+ recherche plein-texte) | `renderConvList` | ui.js |
| Palette (submode conv) | `cmdkConvItems` | ui.js |
| Outil modèle | `conv__list` | tools.js |
| Backfill au démarrage | `selectBackfillCandidates` | storage.js |
| Orphelins de résumé | `pruneOrphanSummaries` | storage.js |

Les deux dernières sont **le piège**. Sans elles, l'exclusion tient tant que la
page est ouverte et **saute au reload** : un agent jamais résumé en vol
redeviendrait candidat au prochain démarrage. C'est littéralement le motif
`project_second_writer_must_realign_the_first`.

La recherche plein-texte et la recherche sidebar n'ont pas de site propre : elles
se branchent dans `renderConvList` (via `convSearchFilter`) et `cmdkConvItems`
(via `pred`), déjà filtrés en amont.

**`conv__list` garde une garde EXPLICITE** bien qu'un agent n'y arriverait pas de
toute façon (il filtre sur `listSummaryEntries()`, et un agent n'est jamais
résumé). S'appuyer sur cette propriété d'une autre couche ferait dépendre
l'exclusion d'un invariant qu'aucun test ne relie ici.

### Orthogonal à l'herméticité, jamais fusionné

L'exclusion des agents et l'herméticité des Spaces sont **deux questions
distinctes**. Les sites concernés **composent** les deux filtres ; on n'écrit
jamais un prédicat qui répond aux deux — ce serait exactement ce que le piège 18
interdit. Un test dédié couvre la composition, parce que le joint entre deux
fonctions pures est précisément ce qui n'est jamais testé
(`project_pure_functions_compose_unguarded_contract`).

## « Pas trouvable » n'est pas « pas atteignable »

Le parent atteint ses enfants **par id**. Deux granularités :

- **`agent__status(id)`** — « où en es-tu ? » : un état, compact, bon marché.
- **`conv__get(id)`** — « montre-moi comment tu fais tes devoirs » : le fil
  complet, cher en contexte, délibéré.

`conv__get` a donc une **branche agent**, et elle est nécessaire, pas seulement
permissive : un agent n'ayant jamais de résumé, `getSummaryEntry` ne rendrait
rien et la lecture échouerait alors que la décision 3bis l'autorise. Un agent qui
n'est **pas** le sien court-circuite vers « introuvable » avant la branche
résumé — sans ce court-circuit, la réponse différerait selon que l'agent a ou non
un résumé, ce qui serait un oracle.

### La garde de parenté

`resolveOwnedAgent(agentId, ctx)` (agents.js) est le prédicat **unique**,
consommé par les quatre handlers `agent__*` **et** par `conv__get`. Un agent
d'une autre conversation répond **exactement** comme un id inexistant —
`AGENT_NOT_FOUND`, même chaîne, pas d'oracle : même posture que `conv__get`
hors-Space (piège 18).

`ctx` en argument explicite (piège 28) : aucun handler ne lit `currentConvId`.
Le critère reste vérifiable par grep — `tools.js` et `api.js` n'ont aucune
lecture hors `toolCtx`.

## Les quatre outils

| Outil | Rôle |
|---|---|
| `agent__spawn` | lance un agent, rend son id **immédiatement** |
| `agent__status` | état à l'instant T — **consultation, pas polling** |
| `agent__result` | relit un résultat qu'on n'a plus en contexte |
| `agent__abort` | interrompt un agent en cours |

**`agent__status` a failli être coupé** (décision 6, « ne pas multiplier les
outils »), et il est conservé pour une raison **autre** que le polling : la
consultation opportuniste pendant un tour où le parent est déjà actif (il a lancé
trois agents, l'utilisateur lui reparle, il regarde où ils en sont avant de
répondre). D'où la deuxième phrase de sa description — « tu seras prévenu
automatiquement, n'appelle donc pas cet outil pour attendre ». Sans elle, on
retombe sur le tour brûlé pour rien, et un parent dont le tour est fini ne peut
de toute façon rien appeler.

### `tools` : un paramètre, une liste de noms

`agent__spawn` prend une **liste de noms d'outils** — pas un axe « outils » plus
un axe « serveurs MCP » : le modèle ne distingue pas les deux, il voit des noms
préfixés (X-e + X-i fusionnées).

**Défaut : aucun outil.** Le parent doit nommer ce qu'il délègue — c'est
exactement le raisonnement qu'on veut provoquer. Un agent sans outil reste utile
(rédiger, résumer, reformuler) et c'est le moins cher. Un agent qui reçoit tout
le registre est un clone du parent qui coûte autant que lui.

`validateAgentToolList(requested, availableNames)` (pur, testé) : nom inconnu →
refus **listant les noms valides** (referme la découverte sans outil dédié, motif
`docs__read`) ; `agent__spawn` refusé (X-b, pas de petits-enfants).
`agentDelegatableToolNames()` exclut les quatre `agent__*` — les trois autres
parce qu'un agent n'a pas d'enfants à consulter, et annoncer une capacité sans
handle atteignable est un mensonge au modèle.

La restriction opère sur le **payload** : `toolDefinitions(allow, ctx)` filtre, et
les outils non délégués sont **absents** de `body.tools` — pas « appelables et
refusés ». `ask_confirmation` suit la même règle : un agent n'a pas
d'utilisateur à qui poser une question.

### `attachments` : la délégation de fichiers (X-1b)

Le trou fermé ici a survécu à tout X-1 : **un agent n'atteignait aucun fichier du
parent**, et le parent n'avait aucun moyen de lui en passer un.

- `att-N` est **conversation-scopé** (`getCachedRecordByAttId(ref, c.convId)`) :
  l'agent porte SON `convId`, donc un `att-N` du parent y résout `null`.
- `res_<id>` passait — mais **par accident**, le cache session étant global. Rien
  n'annonçait ce chemin au modèle, et le commentaire de `resolveHandleRecord`
  affirmait au contraire que « le cache EST le filtre ».
- `file-<id>` passait **réellement**, le `spaceId` étant hérité, mais n'était
  nommé nulle part : ni dans la description de `agent__spawn`, ni dans le
  cadrage, ni ici. Une capacité sans handle annoncé n'existe pas pour le modèle
  (`project_model_facing_text_indicative_and_reachable`).

Et la voie brute — recopier le contenu dans `prompt` — ne rattrapait rien : le
parent n'a pas les octets d'un binaire, seulement son descripteur.

**Le partage est EXPLICITE**, symétrique de `tools` : le parent NOMME ce qu'il
délègue, défaut **aucun**. Même raisonnement que la trousse, et surtout même
posture que le piège 18 — on **n'élargit pas** le scope de `resolveHandleRecord`,
on lui adjoint une **dérogation bornée à une liste figée au spawn**.

#### Trois décisions de forme

**1. Résolution au spawn, dans le référentiel du parent.** Chaque handle est
résolu une fois, à l'instant du spawn, par le `ctx` du **parent** — le seul
instant et le seul référentiel où il résout quelque chose. Ce qui est figé est
l'**id de record**, stable et sans scope. Jamais une seconde résolution plus
tard, jamais dans le ctx de l'agent.

**2. Réécriture en `res_<id>`.** L'agent voit des alias `res_…` — une famille
qu'il connaît déjà et que tous les outils à handle acceptent. Les deux
alternatives ont été écartées :

- une **quatrième famille** (`agent-N`) aurait imposé `classifyHandleRef`, la
  douzaine de descriptions d'outils qui énumèrent les handles admis, et le grep
  d'énumérations fermées — pour un gain nul ;
- **conserver les handles du parent** aurait **collisionné** : un `att-3` délégué
  et le `att-3` que l'agent s'alloue lui-même s'il appelle `docs__render_page`
  (`reserveAttIdFor`) sont deux records pour un handle, et
  `getCachedRecordByAttId` rend le **premier trouvé**.

`agentDelegatedAlias` est déterministe et sans allocation (substitution de
préfixe). Un test pin la prémisse qui justifie la forme : l'alias produit est bien
classé `'resource'` par `classifyHandleRef`.

**3. Un alias, pas une copie.** Aucun octet n'est dupliqué en IDB : la table
mappe `alias → recordId`, et le record reste celui du parent. L'agent le lit, ne
le modifie pas — ce que garantissent déjà les outils à handle.

#### La borne, et où elle vit

`resolveDelegatedRecordId(handle, files)` (pur) est consulté **en tête** de
`resolveHandleRecord`, avant tout lookup de famille. L'ordre **décide** et n'est
pas une commodité : un alias a la forme d'un `res_…`, donc le lookup `resource`
répondrait le premier — et répondrait `null`, l'alias n'étant l'id d'aucun record.

La dérogation ne s'ouvre **que** pour un agent : `agentDelegatedFilesOf(convId)`
rend `[]` pour toute conversation racine, même si son record portait un
`agentFiles` (cas d'une désérialisation, couvert par un test). Un parent garde
exactement le scope qu'il avait, et le prédicat d'herméticité reste seul maître
du reste.

`agentDelegatedFilesOf` lit **deux sources dans cet ordre** : la génération en
vol (la plus fidèle — c'est elle qui exécute le tour), sinon le record persisté
(agent rechargé, ou consulté hors génération).

#### Le filet de cache, et pourquoi il existe

`resolveHandleRecord` est **synchrone** (elle lit le cache session) alors que le
store est asynchrone. Le cache est garni au spawn — le parent vient d'y résoudre
ces mêmes records — mais **pas nécessairement plus tard** : un
`resources-updated` d'un autre onglet évince (`invalidateResourceCache`, lot J),
et un reload le vide entièrement. Sans filet, un agent perdrait ses fichiers en
cours de vol, **silencieusement et sans reproductibilité**.

`rehydrateAgentDelegatedFiles(files)` (agents.js) est appelée au démarrage de la
génération, juste après `registerGeneration`. Fire-and-forget et idempotente :
elle ne remet en cache que ce qui manque, et un échec IDB laisse simplement le
handle introuvable — dégradation propre, comme un `attId` purgé (piège 19).

#### Refus : nommer le handle fautif, et ne rien déléguer à moitié

Un handle que le parent ne peut pas lui-même adresser → refus **nommant** le
handle. Le silence laisserait le parent croire le fichier transmis **et** l'agent
conclure à son absence : deux récits faux pour un seul geste. Le refus porte sur
**tout le lot** — aucun agent n'est lancé.

Le retour de `agent__spawn` liste `handle parent → alias (« nom »)`. Sans cette
ligne, le parent ne connaîtrait que ses propres handles, que l'agent n'accepte
pas — et ne pourrait pas désigner un fichier dans un prompt de relance.

`buildAgentDelegatedFiles` est **pure et testée** ; le lookup (impur) reste dans
le handler. Même partage que `validateAgentToolList`.

#### Ce que le cadrage annonce

`formatAgentDelegatedFilesBlock` s'intercale entre `AGENT_SCOPE_NOTICE` et
`AGENT_TASK_SEPARATOR` (sorti de la notice pour cela) : la **tâche** doit rester
le dernier texte lu. Chaque ligne porte le **handle atteignable** — annoncer un
fichier sans son handle serait annoncer une capacité sans prise.

Rien de délégué → bloc **vide**, jamais une phrase « aucun fichier » : une phrase
de plus dont l'agent tirerait des conclusions. Un test pin que le message sans
fichier est **byte-identique** à celui d'avant X-1b.

### `intent` : ce qui rend l'ack affichable

Un agent n'étant jamais titré, `intent` **sert de libellé partout**. Il est décrit
au modèle comme « ce que tu demandes à l'agent, en une phrase, tel que tu
l'expliquerais à l'utilisateur — c'est ce libellé qui s'affichera à la place d'un
titre, **parce qu'un agent n'est jamais titré** ». Le « parce que » n'est pas
décoratif (`project_model_written_field_shape_two_levels`) : décrit comme
« intention », le champ produit « Lancement d'un agent ».

**Jamais de normalisation de casse dans le handler** : la casse appartient au
modèle.

### `reasoning_effort` : l'astuce X-h

Le raisonnement n'est **pas dans le fil** — son contenu s'affiche mais n'est pas
renvoyé au tour suivant, et `reasoning_effort` part dans la requête sans jamais
apparaître dans les messages. Le modèle a donc raisonné, mais rien de ce qu'il
relit ne lui dit à quel régime.

La solution retenue : **la description du paramètre annonce comme défaut le
niveau courant de la conversation, sans dire que c'est le sien**. Le modèle lit
une valeur par défaut comme dans n'importe quel schéma. C'est meilleur qu'une
injection dans `buildContextBlock`, qui aurait ajouté au contexte une information
sur **lui-même**, avec une garde reposant sur la qualité de la rédaction (motif
payé en V-8 : un modèle à vision a conclu qu'il ne l'avait pas). L'astuce ne dose
pas ce risque, elle le supprime.

**Le piège de l'astuce** : le défaut doit être **réellement appliqué**.
`agentDefaultReasoningEffort(ctx)` est **une seule fonction** pour la description
et pour le handler — deux formules divergentes seraient
`project_doc_promises_intent_code_never_confronted`, qui n'échoue jamais et qu'un
lot suivant fossilise. Un test dédié le pin, pas une relecture.

Conséquence assumée : `toolDefinitions()` produit une description qui **change
avec le réglage utilisateur**. Invalidation KV **ponctuelle au geste
utilisateur**, cas autorisé par le piège 16 — et déjà le régime d'`intentTracing`.

### Bornes

Deux bornes, pas une, et **le refus nomme celle qui est atteinte** : « 3 agents
déjà sur cette conversation » et « 5 agents au total » appellent des gestes
différents du parent (attendre l'un des siens, ou constater que la machine est
saturée). `agentSpawnLimitError` est pure et testée ; le **câblage** l'est aussi,
parce qu'une borne qui existe sans être appelée est le trou d'orchestration
habituel.

`MAX_AGENTS_PER_CONV` (3), `MAX_AGENTS_TOTAL` (5) et `MAX_AGENT_TURNS` (12)
vivent dans `storage.js` (là où `BUILD_CONFIG` est injecté), dérivées sur le
motif de `MAX_SUMMARIES`, surchargeables par `config.json` — clés documentées
dans `config.sample.json` et au README. Elles ne sont référencées qu'en **corps
de fonction** ailleurs (contrainte de portée inter-fichier).

`countWorkingAgentsTotal()` ne compte **que** les agents, pas
`_activeGenerations.size` : une racine qui génère (l'utilisateur qui discute)
n'occupe pas un slot d'agent.

## Exécution : un chemin dédié

Option (c), tranchée par Julien. `spawnAgent` ne réutilise **pas** `dispatchSend`,
qui lit massivement l'état d'écran (`activeModel`, `currentConvId`,
`currentThread`, `startAssistantMessage`, `setSending`…). Les hooks d'un agent
sont **structurellement plus simples** — jamais d'écran à peindre,
`genOwnsScreen` est faux par construction tant que rien n'ouvre son fil, et X-1
n'en ouvre aucun. Ce n'est pas une copie de `dispatchSend`, c'est sa moitié.

L'extraction d'un `runGeneration` commun est le bon geste **une fois** qu'on aura
vu les deux chemins vivre ; le faire d'emblée serait concevoir l'abstraction
avant d'avoir les deux cas (précédent `docs.js`, extrait après coup en V-7 sans
dommage).

**Contrainte dure : la persistance et la projection restent partagées.**
`persistGeneration` et `projectThreadToMessages` sont appelés tels quels, jamais
réécrits — deux formules de projection divergentes feraient qu'un agent persisté
ne serait pas relisible comme une conversation.

### Modèle, serveur, Space : figés à la naissance

- `spaceId` vient du **ctx**, jamais d'`activeSpaceId` (piège 28) : un agent
  lancé par une génération détachée naît dans le Space de **sa** génération.
  Herméticité héritée et figée (X-a), sans exception.
- `model` / `serverName` sont **hérités du parent** (décision 3, X-f) : de la
  génération parente si elle tourne encore, sinon de l'état résolu au spawn.
  **Jamais relus** d'`activeModel()` — un agent lancé pendant que l'utilisateur
  change l'override du composer reproduirait le bug payé le 2026-08-29.

### Prompt système : celui du parent, à la lettre

`buildSystemMessage()` **tel quel** (X-d). Le motif est le KV cache : un prompt
identique réutilise un préfixe **déjà chaud** ; un prompt « resserré » est un
préfixe **neuf, donc froid**, que chaque agent repaierait intégralement en calcul
— directement du temps sur Ollama. L'intuition « resserré = moins cher » est
vraie en *contexte* et fausse en *calcul* ; ici le calcul l'emporte.

**Mesuré le 2026-08-30, et c'est ce qui rend X-d tenable** : aucune des six parts
de `systemMessageParts()` n'est conditionnée à la présence d'un outil. Les neuf
doctrines d'outils sont concaténées en dur dans `ROOT_SYSTEM_PROMPT`, sans gate.
Restreindre la trousse d'un agent ne fait donc **pas** diverger son prompt
système.

Ce qui reste vrai, et c'est le seul point à tenir : **pas l'historique du
parent**. C'est tout l'intérêt d'un agent d'isoler le contexte — et c'est aussi
ce qui rend le partage de préfixe possible, l'historique étant précisément ce qui
diverge après le système.

### Le décalage de récit, et les trois mesures

Ce que la mesure **ne** prouve pas : que ce que l'agent lit soit cohérent avec ce
qu'il peut faire. Un agent démarre **à froid**, avec une trousse **délibérément
restreinte**, et lit ~10,5 ko de doctrine décrivant un monde plus riche que le
sien.

Le risque n'est pas l'appel invalide — `body.tools` est restreint, un modèle
correct n'appelle pas ce qui n'y est pas. C'est le **décalage de récit** : il peut
parfaitement *annoncer* qu'il va ouvrir le PDF, ou bâtir un plan qui suppose des
outils absents.

Trois mesures, qui composent :

1. **Une phrase de cadrage dans le premier message user** (`AGENT_SCOPE_NOTICE`,
   agents.js). **Pas une liste d'outils** — `body.tools` la porte déjà. La borne
   est d'une autre nature : « tes outils sont ceux de ton payload, et rien
   d'autre ; les doctrines décrivent des capacités de l'application, pas
   nécessairement les tiennes ». C'est la mesure **principale**, en position de
   **dernier texte lu** avant la tâche — donc celle qui désigne le destinataire
   (`project_model_facing_text_indicative_and_reachable`). Coût KV **nul** : le
   premier message user vient après le préfixe système, et l'agent en a un de
   toute façon.
2. **Refus explicite nommant les outils disponibles**, en **filet**, pas en
   mécanisme principal : couvre l'appel *halluciné* vers un outil absent.
3. **L'échec remonte au parent** — le point le plus ferme. Un échec d'outil est
   **non-`isError` délibérément** dans MIAOU
   (`project_tool_failure_lives_in_ack_not_iserror`) : il vit dans l'ack. Si le
   résultat délivré ne portait que le texte final, le parent ne saurait **jamais
   pourquoi** c'est vide, et blâmerait la tâche plutôt que la trousse.
   `collectAgentToolFailures(thread)` dérive la trace des entrées `tool-ack` via
   `ackIsError`, **jamais un second prédicat**.

**Aucune des trois ne touche au prompt système** : X-d tient à la lettre.

Corollaire assumé : un **agent lit `AGENT_DOCTRINE`** alors qu'il n'a jamais
`agent__spawn`. Gater la doctrine rouvrirait exactement la divergence que X-d
ferme. C'est la phrase de cadrage qui l'empêche d'annoncer un lancement
impossible.

## La borne de tours

`gen.agentTurns` est incrémenté à la **frontière de tour** — le seul point que
chaque échange enchaîné traverse. Au-delà de `MAX_AGENT_TURNS` : abort d'office,
statut `exhausted`, et **le résultat partiel est quand même délivré**, avec la
mention explicite.

`exhausted` doit être **distinct** de `done` dans ce qui remonte : un parent qui
reçoit un résultat tronqué en le croyant complet prend une décision fausse — et
c'est exactement le genre d'écart qui ne casse rien de vérifiable.

`shouldStopAgent(turns, max)` est pur et testé.

## Statut : terminal persisté, `running` toujours dérivé

```js
function agentStatus(convId) {
  if (isGenerating(convId)) return 'running';
  const conv = loadConversation(convId);
  return (conv && conv.agentStatus) || 'aborted';
}
```

Un agent `running` interrompu par un **reload** retombe naturellement sur
`aborted` — pas de zombie persisté, sans champ supplémentaire.

**Cinq statuts terminaux**, et les cinq sont distincts dans ce qui remonte au
parent (`AGENT_STATUS_LABELS`, table unique dont les messages dérivent) :

| Statut | Sens |
|---|---|
| `done` | terminé nominalement |
| `exhausted` | borne de tours atteinte — résultat **partiel** |
| `aborted` | interrompu **par le modèle** (`agent__abort`) |
| `stopped` | interrompu **par l'utilisateur** |
| `error` | terminé en erreur |

`aborted` et `stopped` ne se confondent pas : le parent ne réagit pas pareil à
« j'ai arrêté cet agent » et « l'utilisateur a arrêté cet agent ».

## Le réveil du parent

### Le point d'accroche est le `finally`, jamais le chemin nominal

**Mesuré, et pas comme prévu.** L'esquisse et le plan désignaient le **stop
utilisateur** comme le scénario qui prouve cette accroche. Le verify e2e a
réinjecté la régression (délivrance déplacée dans `onFinal`) : ce scénario reste
**vert**. La raison est dans `api.js` — un abort n'échappe pas à la boucle de
`runConversation`, il appelle `onFinal(content, …, 'aborted')` puis retourne. Le
chemin nominal **couvre** donc le stop utilisateur.

Le seul chemin de sortie qui ne voit **jamais** `onFinal` est l'**exception** :
un HTTP non-ok fait lever `streamCompletion`, `runConversation` propage, et
`driveAgentConversation` atterrit dans son `catch` puis son `finally`. C'est
donc l'**erreur backend** qui discrimine, et c'est elle que le verify exerce
(scénario 6quater). Le stop utilisateur garde sa valeur propre — il prouve que
le statut `stopped` remonte, distinct d'`aborted` — mais il ne prouve pas
l'accroche, et le dire évite qu'un lot suivant s'y fie.

`deliverAgentResult(agentConvId, status, thread)` est appelé sur **toute sortie
de génération d'un agent, sans exception** — nominale, avortée par le modèle,
avortée par l'utilisateur, épuisée, en erreur. Le `finally` du cycle de vie est
le seul endroit que tous les cas traversent ; c'est ce qui rend l'invariant
vérifiable au lieu d'être une liste de call-sites à maintenir.

**Pourquoi l'accroche reste le point le plus important du lot.** Le stop utilisateur sur un
agent **existe déjà sans qu'on l'ait décidé** : la capacité utilisateur→agent
étant disponible (décision 8), l'utilisateur ouvre le fil de l'agent — et ce fil
a un composer, donc un bouton stop, qui appelle `abortStream(currentConvId)`.
Accroché au chemin nominal, ce chemin ne notifierait **personne** : le parent
attendrait indéfiniment un réveil qui ne vient pas, pastille pulsante à l'appui —
précisément ce que la section badges déclare « pire que pas de pastille ».

### La forme du message (Q1)

Un **message user authentique** (persisté, visible), portant un champ
`agentResult` qui gouverne **l'affichage seulement** — jamais le routage (ligne
posée au piège 19, corollaire V-8). Jamais `_synthetic` : l'injection
`<miaou_context>` doit pouvoir le viser.

Le précédent qui a tranché : dans l'outillage de Julien, une réponse à
`AskUserQuestion` fait apparaître un « your questions have been answered »
destiné au modèle mais **visible par l'utilisateur**, et c'est acceptable. Une
bulle qu'il n'a pas tapée n'est pas une anomalie tant qu'elle est lisible comme
ce qu'elle est. **X-3 stylera ce flag** ; X-1 le pose et le rend lisible.

### Parent occupé : une file dédiée

`_pendingAgentResults` (`Map<convId, entry[]>`), **distincte** de
`_pendingInterjections`. Les deux sont désormais clefées par conversation
(X-1e a converti la seconde), donc ce qui les sépare n'est plus leur condition
de drain — c'est ce qu'elles **portent** : une interjection est annulable,
éditable, et reflue dans le composer à un arrêt ; un résultat d'agent est un
fait acquis que personne ne retire. Les fusionner ferait qu'un stop utilisateur
refoulerait dans le composer le compte rendu d'un agent — le motif « deux
prédicats corrects séparément qui divergent », appliqué à deux cycles de vie
qu'on aurait confondus parce que leur forme s'est mise à coïncider.

Le drain se fait à la **frontière de tour**, via le hook `onAgentResults`
(api.js), **après** `onInterjections`. Ni l'un ni l'autre n'est gardé par
`genOwnsScreen` : muter le thread a lieu toujours, seul le reflet DOM est
conditionnel.

**Course couverte** : un résultat arrivant **après** la dernière frontière de
tour ne verrait plus jamais de drain. Le `finally` de la génération teste
`hasPendingAgentResults` et déclenche un réveil différé — sans quoi le résultat
resterait en file pour toujours.

### Read-after-await (piège 24 (b))

`deliverAgentResult` contient un `await warmConversation(parentConvId)` — le
parent doit être chaud pour qu'on lise et réécrive ses messages (une conversation
froide rend `messages: []`, et persister par-dessus la viderait). Tout état est
donc **relu après** cet await : le parent a pu démarrer une génération, ou être
supprimé, pendant le chargement.

### Le vrai danger : deux sources pour le thread du parent

`parentThreadFor(parentConvId)` — un prédicat nommé, **une seule expression**,
testée :

- **parent affiché** → `currentThread`, la **même référence** que celle
  qu'`openConversation` a adoptée. Relire le storage produirait un second
  tableau, et le rendu resterait branché sur le premier : le message du réveil
  n'apparaîtrait jamais à l'écran tout en étant persisté.
- **parent non affiché** → `projectConvMessages(loadConversation(id))`.
  `currentThread` désigne alors une **autre** conversation : y pousser le
  résultat le rangerait dans le mauvais fil.

### Démarrer une génération sur une conversation non affichée

Cas que le lot T n'a **jamais exercé** : `dispatchSend` part toujours de l'écran,
son commentaire le dit en toutes lettres. Le réveil viole cette prémisse, d'où
**deux branches explicites** (`startParentWakeGeneration`) :

- **parent affiché** → `dispatchSend`, tel quel. C'est sa prémisse exacte.
- **parent non affiché** → `runDetachedGeneration`, qui n'appelle **jamais**
  `startAssistantMessage` (qui pousserait une bulle dans le DOM d'une autre
  conversation) ni `setSending` (qui basculerait le composer d'une conversation
  qu'on regarde et qui, elle, ne génère pas).

`runDetachedGeneration` partage le corps « données seulement » des hooks d'agent
— ce n'est pas un hasard : un agent **est** une génération sans écran, et un
parent réveillé en arrière-plan aussi. Différences réelles : la trousse d'outils
complète et le titrage conservé.

**Coût KV assumé** : insertion mid-séquence, invalidation **ponctuelle et
volontaire** — corollaire du piège 16, précédent exact du piège 27
(interjections).

## Badges : le parent porte la pastille de son enfant

Un parent qui **ne génère pas lui-même** mais dont **au moins un enfant tourne**
porte `working` — celle qui pulse. Sans cela, lancer un agent rend la
conversation parente **totalement muette** alors qu'il s'y passe quelque chose.

Les agents n'apparaissant pas dans la sidebar, la pastille de l'enfant n'a
**aucune surface propre** : c'est le parent qui la porte, ce qui confirme que
l'extension est nécessaire et non redondante.

`hasWorkingAgent(convId, convs)` (agents.js) est le prédicat, consommé par
`convBadgeState` **et** par les gardes de suppression/déplacement. `convs` est
optionnel et propagé par les agrégats, qui balaient déjà toutes les conversations
— sans lui le balayage deviendrait quadratique.

### Les trois prédicats sont ALIGNÉS (décision X-1, étape 7)

Jusqu'au lot X, `spaceBadgeState` et `aggregateBadgeState` itéraient
`_activeGenerations` **directement** et ne passaient jamais par `convBadgeState`,
alors que le commentaire de celui-ci affirmait depuis T-2 que les trois en
dérivent : vrai au sens de la **sémantique**, faux au sens de l'**appel**. Un
commentaire qui affirme un invariant tient lieu de vérification et empêche de la
faire (`project_comment_asserting_invariant_ages_like_test`).

Ils en dérivent désormais **réellement**. Deux raisons de trancher pour
l'alignement plutôt que pour « nommer l'écart » :

1. **Le coût, mesuré et non supposé** : les deux agrégats appelaient **déjà**
   `listAllConversations()` pour leur branche `unread`. Balayer les mêmes
   conversations pour le `working` ne change pas l'ordre de grandeur — la raison
   qui aurait justifié l'écart (« itérer le registre est moins cher ») ne tient
   pas.
2. Sans alignement, le `working` d'un **parent** à enfant actif serait invisible
   des deux agrégats. Le résultat aurait été **fortuitement correct** — un enfant
   en vol est lui-même une entrée du registre, dans le Space de son parent (X-a)
   — mais fortuit n'est pas juste : le jour où X-a bougerait, l'écart deviendrait
   un bug silencieux.

Un `Set` de conversations déjà vues évite qu'une génération soit comptée deux
fois. `resolveActivityBadge` réduisant une liste d'états, `working` reste
`working` : aucun troisième état n'apparaît.

**`unread` n'est PAS étendu au parent.** L'enfant qui finit réveille le parent,
qui **regénère** — son `working` reprend seul. Un `unread` en plus produirait une
pastille fixe sur une conversation qui redémarre dans la seconde.

**Rafraîchissement** : `renderConvList()` + `syncSpaceUI()` au **spawn** et à
**toute fin d'agent, y compris anormale** (`refreshAgentBadges`, appelé depuis
`deliverAgentResult` sur tous ses chemins de sortie). Une pastille qui pulse pour
un travail mort est pire que pas de pastille.

## Cycle de vie

### Suppression du parent : cascade, et abort d'abord

`deleteConv` résout les enfants **avant** de supprimer le parent (après,
`parentConvId` pointerait sur un record disparu), les **aborte activement**, puis
les supprime par le même `deleteConv` — ainsi leurs ressources et leur index
suivent exactement le chemin d'une conversation ordinaire.

L'abort actif n'est pas une précaution de corruption : `persistGeneration` ne
ressuscite pas une conversation supprimée (piège 20), donc rien ne se
corromprait. Mais l'agent **continuerait à tourner et à consommer**, en silence,
pour un parent qui n'existe plus. Laisser la persistance échouer sans bruit n'est
pas une garde, c'est une fuite.

### Déplacement : refus si un enfant tourne, emport sinon

Les deux moitiés sont nécessaires. Sans le **refus**, un agent en vol resterait
dans l'ancien Espace et continuerait de répondre dans un référentiel que son
parent a quitté — l'agent orphelin de référentiel que le piège 18 interdit. Sans
l'**emport**, la même chose arrive aux agents inertes. Ensemble, elles suppriment
la fenêtre au lieu de la garder sous une garde subtile.

Trois points d'UI :

1. La case d'une conversation à enfant actif est **grisée** (`convItemEl`), avec
   la **raison dans son `title`** — une case inerte sans explication se lit comme
   un bug.
2. Elle est **exclue de la présélection**, et **dans cet ordre** : `enterMoveMode`
   présélectionne la conversation affichée, donc griser sans exclure produirait
   une case **cochée et grisée** — une sélection irrétractable, dans une barre
   annonçant « 1 conversation » derrière un bouton qui échouerait.
3. `renderMoveBar` compte `_moveSelection.size` : l'ensemble vide retombe
   naturellement sur le cas ordinaire « rien de sélectionné ».

**La garde est re-lue au commit**, pas héritée du rendu : un agent peut démarrer
pendant que le mode sélection est ouvert (fenêtre de réentrance X-a, même famille
que `project_await_reentrancy_guard`).

## La doctrine de déclenchement

Split **QUAND / COMMENT**
(`project_doctrine_extraction_quand_comment_split`, cas déjà tranché pour
`js__eval`) : le déclencheur en dur dans `ROOT_SYSTEM_PROMPT`
(`AGENT_DOCTRINE`, court, inconditionnel, KV-safe), le mode d'emploi en skill
système `src/system-skills/agents.md`.

`AGENT_DOCTRINE` porte quatre éléments, dans cet ordre : quand lancer, le
**motif** de ne pas le faire, la disqualification des faux signaux, l'interdiction
de confabuler. Le motif doit être **vérifiable** plutôt qu'asserté — « un agent
redémarre à froid, avec rien de cette conversation » est quelque chose que le
modèle peut confronter à sa propre situation ; « n'abuse pas des agents » ne peut
être qu'obéi ou ignoré.

**Le calibrage est le vrai travail**, entre deux bornes documentées :

- **trop insistant** → le modèle n'en lance **jamais**, demande explicite
  comprise (motif V-8 : une borne générique écrase une obligation spécifique
  posée ailleurs, et un bloc recalculé chaque tour bat le prompt système) ;
- **trop discret** → il n'ose pas, parce que rien ne lui dit qu'il peut
  (`project_model_facing_text_indicative_and_reachable`).

Trois règles de rédaction appliquées littéralement : **indicatif**, jamais une
condition à évaluer sur soi-même (« si tu penses que c'est trop long pour toi »
produit l'abstention) ; permission énoncée **avant** l'interdiction, pour que le
texte ne se lise pas comme un veto ; capacité annoncée = **handle atteignable**
(« tu seras prévenu » n'est dit que parce que `deliverAgentResult` existe — un
test pin cette paire).

**Aucune constante chiffrée** dans la doctrine ni dans la skill
(`project_no_hardcoded_constant_in_system_skill_md`) : les bornes vivent dans le
JS et se font connaître par leur message de refus, qui les nomme.

**Assumé d'avance** : la doctrine rendra un modèle correct discipliné, pas un
modèle faible. Pour les autres, la garde est **technique** — borne de tours et
borne d'agents simultanés. Ne pas durcir le texte pour compenser : c'est ce
durcissement qui produit le modèle qui n'ose plus.

La skill couvre : rédiger un `prompt` autosuffisant (test de l'enveloppe fermée,
avec la **forme de sortie** comme point le plus souvent oublié), choisir la
trousse, ce que dit chaque statut, et — pendant côté parent de la mesure 3 —
**qu'un outil manquant n'est pas une tâche échouée** : relancer avec la trousse
corrigée plutôt que conclure à l'échec.

## Ce qui n'est PAS fait (X-1)

Non-goals tranchés à l'esquisse :

- **Pas d'arborescence dans la sidebar** (décision 5, « sans regret »). Un agent
  n'est presque jamais quelque chose qu'on *navigue* ; l'ack dans la conversation
  parente est le bon endroit. Cet argument est tenu par la boucle de navigation
  ci-dessous : l'ack ne serait « le bon endroit » que s'il menait effectivement
  quelque part, et qu'on puisse en revenir.
- **Pas de reprise après reload** (cohérent avec la décision transverse du lot T).
- **Pas de petits-enfants** (X-b).
- **Pas d'interjection parent → enfant** (décision 8, temporisée) : séduisant,
  mais à décider **après** le mécanisme de reprise — décidé dans l'autre ordre on
  obtient le micro-management par défaut.
- **Pas de suppression d'un agent seul** : il est supprimé avec son parent (X-c).
  À rouvrir avec X-2/X-3.
- **Pas d'agent sur un autre modèle ou serveur que le parent** (décision 3,
  question structurante 4 **reportée** — l'instruction est conservée dans
  l'esquisse, ne pas la refaire).

## Navigation parent ↔ agent (élargissement X-1)

Un agent n'apparaît nulle part (huit sites d'exclusion) : sans affordance
dédiée, il est donc *inatteignable* depuis l'interface, et une fois atteint on
n'en revient pas. La boucle est fermée par deux gestes symétriques, plus un
libellé.

**L'aller** existait déjà : `renderAgentAckLabel` (ui.js) rend le libellé des
quatre acks `agent__*` cliquable vers `openConversation`. Une seule formule pour
les quatre — quatre copies divergeraient précisément sur la cliquabilité, qui
fait toute la valeur de l'affordance.

**Le retour** est un bandeau en tête de fil (`#agent-banner`, `syncAgentBanner`)
— **doublé depuis X-1c d'un bouton de topbar**, cf. la section dédiée plus bas.
Le bandeau porte en même temps l'information « ceci est un agent » et le **nom**
du parent, que le bouton (icône seule) ne peut pas porter. Il vit dans
`.messages` avant `.thread`, donc il scrolle avec le fil plutôt que de voler de
la hauteur en permanence, et il est contraint à `var(--col)` comme `.thread` —
sans quoi il occuperait toute la largeur de `.messages` et se désolidariserait du
fil sur grand écran. C'est précisément ce défilement qui a motivé X-1c : une
affordance qui sort de vue ne peut pas être la seule issue.

Le parent est **relu à chaque appel** plutôt que mémorisé : il peut avoir été
renommé depuis le spawn. S'il a été supprimé, le bandeau reste affiché **sans
lien** — l'information « ceci est un agent » demeure vraie, et un lien mort
serait pire qu'une absence de lien.

### `convLabel` : le libellé, un seul prédicat

Un agent n'est jamais titré (`title: ''` figé au spawn, exclusion 3ter) et la
description d'`agent__spawn` **promet au modèle** que son `intent` « s'affichera
dans la conversation à la place d'un titre ». Sans consommateur, cette promesse
était un mensonge : la topbar lisait `conv.title` nu et affichait « Nouvelle
conversation » sur tout agent (`project_doc_promises_intent_code_never_confronted`
— la doc ne mentait sur rien et n'échouait jamais).

`convLabel(conv)` (agents.js, pure) est LE prédicat : `title`, sinon `agentIntent`
si c'est un agent, sinon `''`. Il rend `''` et **jamais le placeholder**, parce
que le fallback appartient à chaque surface — la topbar veut `''` pour laisser
parler son `:empty::before`, `document.title` veut « Nouvelle conversation ».
Les mélanger ferait remonter un placeholder là où un champ vide est attendu. Et
il ne lit `agentIntent` que sur un agent : sur une racine, ce champ résiduel
ferait apparaître un libellé fantôme.

### Les deux voies d'écriture du titre se ferment ensemble

Si `convLabel` préfère `title` quand il existe, alors laisser l'utilisateur
écrire un `title` sur un agent créerait **deux libellés concurrents** pour la
même conversation : celui des acks (l'intent) et celui de la topbar. Ils
divergeraient en silence. Les deux voies sont donc fermées d'un coup :

- `setTitleEditableForConv` (ui.js) ferme le `contenteditable`. À ne pas
  confondre avec `setTitleEditable` (main.js), verrou **transitoire** le temps
  d'un titrage async : les deux écrivent le même attribut, mais celui-ci est
  reposé à chaque ouverture, donc il gagne au switch — ce qui est le bon ordre,
  un agent n'étant de toute façon jamais titré.
- `syncConvDownloadBtn` masque « Régénérer le titre ». Fermer l'une sans l'autre
  déplacerait simplement le problème.

Enfin `resetToEmpty` remet les deux à zéro : ce chemin ne passe pas par
`openConversation`, donc sans reset explicite, quitter un agent par « Nouvelle
conversation » laisserait son bandeau et son titre verrouillé sur un écran vide.

Reste à faire dans le lot :

- **X-2** — liste d'agents dans la palette (`Cmd+K` puis `a`, raccourci déjà
  réservé en T-3a), et pilule « X agents » cliquable.
- **X-3** — surfaces d'affichage : ack enrichi qui reflète l'état d'un agent en
  cours. Demande une **spec visuelle de Julien avant codage** (règle des
  composants UI provisoires).
## Le bouton de retour en topbar (X-1c)

Le bandeau seul ne suffit pas : il **défile avec le fil** et disparaît dès qu'on
descend. Or un agent n'apparaît ni en sidebar ni dans la recherche — c'est donc
un écran dont l'unique issue sortait de vue. Une affordance qu'il faut retrouver
en remontant n'est pas une issue.

`.conv-parent-btn` (index.html, `.topbar-mid`) occupe **l'emplacement exact du
bouton de retitrage**, et la place est libre par construction : ce dernier est
masqué sur un agent depuis X-1 (`syncLastAssistantActions`), parce qu'écrire un
`title` sur un agent créerait deux libellés concurrents avec son `agentIntent`.
Les deux ne coexistent jamais.

**Chevron gauche seul.** Vérifié contre le vocabulaire d'icônes (une métaphore =
un usage) : la paire `< >` est réservée au code (`ICON_CODE`, js__eval) et le
chevron **bas** au repli (`ICON_CHEVRON_DOWN`). Un chevron gauche seul n'entre en
collision avec aucun des deux. La variante « chevron + nom du parent » a été
écartée sur un coût nommable : `.topbar-mid` est capé à `46vw` et partagé avec le
titre de l'agent, qui est l'`intent` rédigé par le modèle — souvent long.

**Toujours visible, et c'est une exception assumée.** Ses deux voisins sont
révélés au survol (asymétrie déjà documentée comme un choix utilisateur, « ne pas
harmoniser »). Celui-ci est à opacité 1 en permanence, et le CSS porte la
raison. Il n'est pas non plus masqué pendant le streaming : quitter le fil d'un
agent qui travaille est précisément ce qu'on veut pouvoir faire — la génération
appartient à sa conversation, pas à l'écran (piège 28).

**Un seul appel pilote les deux surfaces.** Le bouton est câblé **depuis
`syncAgentBanner`**, avec le même parent relu. Deux surfaces qui répondent à la
même question ne dérivent pas leur réponse de deux formules (discipline de
`convLabel` et de `spaceConvIds`). Sans cela, un parent supprimé laisserait le
bouton mener à une conversation inexistante pendant que le bandeau annonce sa
disparition.

Asymétrie **voulue** dans ce cas précis : le bandeau **reste** (il porte le texte
qui explique), le bouton **disparaît**. Une affordance permanente et inerte au
clic est pire qu'absente.

**Readonly : navigation, pas mutation.** `body.conv-readonly` grise
`.conv-retitle-btn` avec les boutons d'édition ; `.conv-parent-btn` en est
volontairement exclu. Le readonly neutralise les mutations — un pair qui génère
sur ce fil ne doit pas y enfermer l'utilisateur.

Pas d'attribut `onclick` littéral : la cible dépend du parent, posée en
`.onclick` par `syncAgentBanner`. **Un seul mécanisme de câblage**, jamais les
deux.

## Regarder une image déléguée (X-1d)

Déléguer un fichier ne suffisait pas à ce qu'un agent puisse **regarder** une
image. Signalé depuis l'usage réel : l'agent tenait le handle et passait ses
tours à tenter de lire un PNG avec `js__eval`. Ce n'était pas une trousse
incomplète — **aucune liste d'outils n'y aurait rien changé**.

### Trois causes, dont deux antérieures au lot X

**(a) `recall_attachment` était hors du résolveur unique.** X-1b a raccordé
`resolveHandleRecord` en le présentant comme LA source de vérité. C'était vrai de
ce qu'il résout, faux de ce qui le contourne : `recall_attachment` gardait son
propre `getCachedRecordByAttId(ref, ctx.convId)`. Un `att-N` délégué restait donc
inatteignable — et c'est le **seul** outil qui mène aux pixels. Vérifier qu'un
résolveur unique est branché ne remplace pas l'**inventaire de ses
contournements**.

**(b) Aucun `attId` sur une image de `_storeBlock`.** Le seul chemin qui met des
pixels dans un contexte est celui du piège 19, adressé **par `attId`**. Une image
téléchargée par `fetch_url` passe par `_storeBlock`, qui n'en attribue aucun
(seul `storeAttachment` le fait) : elle était structurellement hors du chemin,
**y compris pour le parent**. Trou antérieur à tout le lot X, jamais vu parce que
le seul cas exercé était la pièce jointe utilisateur, qui en a un par
construction.

**(c) La doctrine.** `BINARY_DOCTRINE` disait « les images sont affichées
directement dans l'interface » — vrai **pour l'utilisateur**, lu par le modèle
comme « je les vois ». `js__eval` devenait alors la seule action pensable sur un
handle d'image. La doctrine dit désormais **à qui** l'image est présentée, nomme
l'outil qui donne les pixels, et interdit de lire un binaire comme du texte. Même
motif que le « te la montre » de `docs__render_page` (V-8) : le dernier texte lu
désigne le destinataire.

### Le fix

`recall_attachment` accepte les **trois familles** de handle via
`resolveHandleRecord` — la délégation X-1b s'applique donc gratuitement — et
**alloue un `attId` à la volée** quand le record n'en a pas, pour rejoindre le
chemin unique du piège 19. Un seul outil, un seul chemin de ré-injection.

Le handler est devenu **async** (l'allocation impose une écriture IDB). La partie
décidable est extraite en helper pur `recallableImageError`, testable QuickJS —
même motif que `validateFilesPromoteArgs`.

Deux alternatives écartées sur coût nommable : un outil dédié `image__view`
ajouterait un neuvième outil (décision 6 : « ne pas multiplier ») **et** un second
producteur de pixels à garder aligné ; attribuer un `attId` dès le stockage
consommerait des numéros pour des images jamais rappelées et ne corrigerait pas
(a).

### `conversationId` n'est jamais réécrit — d'où `recordId` sur l'ack

Le record délégué appartient à la conversation qui l'a stocké. Le réaffecter à
l'agent **volerait le fichier au parent**. Conséquence : `attId` et
`conversationId` peuvent désigner deux conversations différentes, et le couple
`(attId, convId)` — qui servait de clef à `resolveRecallImages` — **ment** dès
qu'un agent rappelle un fichier délégué : le record garde le convId du parent,
l'ack vit dans le fil de l'agent, le filtre répond `null`.

Symptôme : les pixels arrivaient au tour courant et **disparaissaient au
rechargement**. L'ack porte donc désormais **`recordId`** — une **identité**, là
où le couple est un attribut pratique
(`project_cache_key_must_be_identity_not_handy_attribute`) — et
`resolveRecallImages` le préfère, avec repli sur l'ancien lookup pour les acks
antérieurs. Champ ajouté à **`ACK_COPY_FIELDS`** (source unique).

### Ce qui reste ouvert

- **Le lien outil ↔ fichier n'est pas contrôlé.** Déléguer une image sans
  `recall_attachment` reproduit exactement le mode d'échec rapporté. La skill
  `agents` le dit (« confier un fichier ne remplace pas la trousse »), rien ne le
  vérifie — un contrôle automatique devrait deviner quel outil va avec quel mime.
- **`resource__present` ne passe toujours pas par `resolveHandleRecord`** : il
  résout par `getCachedRecord` nu. Sans conséquence connue (il affiche, il ne
  ramène rien au contexte), mais c'est le dernier consommateur de handle hors du
  résolveur unique.

## Le fil d'un agent terminé est en lecture seule (X-1e)

Un agent qui a rendu son résultat ne reçoit plus de message. Sans ce verrou, un
message envoyé dans son fil partait **dans le vide** : le parent a déjà reçu son
compte rendu et repris sa route, personne ne lit plus ce fil, et l'utilisateur
croyait relancer l'agent.

**Le prédicat**, unique : `isFinishedAgentConv(convId)` (main.js) — un agent
(`isAgentConversation`) dont `agentStatus(convId) !== 'running'`. Il DÉRIVE de
`agentStatus`, qui reste LA source de vérité (`running` dérivé du registre, sinon
un des cinq terminaux) plutôt que d'en réécrire la logique. **Aucune exception
parmi les cinq** : `done`, `exhausted`, `aborted`, `stopped` et `error` ont tous
en commun que `deliverAgentResult` a notifié le parent et que la génération est
finie. Distinguer ici ferait un second prédicat de statut, concurrent du premier.
Un agent rechargé (aucun statut, aucune génération) retombe sur `aborted` : le
fil est fermé, ce qui est correct — il ne repartira jamais.

**Deux causes composées, un seul setter.** `applyReadonlyState()` (main.js)
compose `_peersGenerating.size > 0` (readonly cross-onglets, J5 — cause
TEMPORAIRE) et `isFinishedAgentConv(currentConvId)` (cause DÉFINITIVE). C'est la
discipline de `refreshTabBanner` juste à côté, et pour la même raison :
`setConvReadonly` est un setter booléen, deux appelants qui poseraient chacun
leur cause se marcheraient dessus — le sweeper TTL libérant un pair rouvrirait
le composer d'un agent terminé.

**Trois points de synchronisation** : `openConversation` (on affiche un agent
déjà fini), `refreshAgentBadges` (l'agent finit **sous les yeux** de
l'utilisateur, qui le regardait travailler) et `resetPeerState` (déjà câblé pour
la cause J5). Le premier et le deuxième sont ceux que X-1e ajoute.

**Ce qui reste permis** : lecture, scroll, et le **retour au parent** — le
readonly ne neutralise que les MUTATIONS, et `.conv-parent-btn` est
explicitement hors de la liste CSS (composer.css) depuis X-1c. Enfermer
l'utilisateur dans un fil qu'il ne peut plus quitter serait pire que le défaut
corrigé.

**L'affordance** : le bandeau d'agent porte le statut
(`#agent-banner-status`, posé par `syncAgentBanner`). Sans lui, la lecture seule
serait un composer grisé **sans cause lisible** — l'utilisateur conclurait à une
panne. Le libellé vient d'`AGENT_STATUS_UI_LABELS` (agents.js), table **séparée**
d'`AGENT_STATUS_LABELS` : celle-ci s'adresse au MODÈLE, où « interrompu par toi »
désigne le modèle qui a appelé `agent__abort` ; le lecteur humain y lirait qu'on
lui attribue un appel d'outil qu'il n'a pas fait. `running` n'affiche rien (un
agent au travail a son composer ouvert, il n'y a rien à expliquer).

**Bug préexistant révélé au passage.** `driveAgentConversation` n'appelait pas
`setSending` dans son `finally`, contrairement à `driveDetachedConversation`. En
regardant un agent finir, le composer gardait le placeholder « Le modèle
travaille — Entrée ajoute à la file… » et son bouton stop. Invisible jusqu'ici ;
la lecture seule le rendait criant (composer verrouillé ET annonçant un travail
en cours). Corrigé au même endroit et de la même façon que le chemin détaché.

**Corollaire sur les interjections** : `enqueueInterjection` refuse la mise en
file dans une conversation d'agent — un agent câble `onInterjections: () => null`
(son drain B ne tire jamais) et n'a pas de drain A. La file y serait sans issue.
Le refus vise la fenêtre où l'agent **travaille encore**, seul moment où
`sending` est vrai sur son fil ; l'après-coup est couvert par la lecture seule.

## La réponse d'agent dans le fil du parent (X-1e)

L'entrée poussée dans le parent (`buildAgentResultEntry`) est un message `user`
par construction, mais elle ne se lit pas comme tel : c'est un **compte rendu**,
pas une réplique. Deux conséquences, portées par le champ `agentResult` qu'elle
porte déjà (X-1 le posait pour l'affichage seulement — c'est exactement l'usage).

**Repliée par défaut.** `agentResultBodyHtml` (ui.js) rend un `<details>` NATIF
fermé, dont le `<summary>` porte l'intent et le statut. Un rapport d'agent est
long (tâche confiée, identifiant, outils en échec, réponse entière) et il tombe
**au milieu** de l'échange du parent : déplié, il noie la conversation. L'en-tête
est imbriqué DANS le `<summary>` (pas en frère) — c'est ce qui rend tout le
bandeau cliquable, repli comme dépli, **sans JS** (piège `<details>`/`<summary>`).
Le libellé porte l'**intent** plutôt qu'un « Réponse d'agent » générique : replié,
c'est la seule chose lisible, et c'est la question à laquelle le bloc répond.

Le bloc sort du gabarit de bulle (pleine largeur, aligné à gauche, fond de
surface) : un rapport de plusieurs paragraphes entassé dans 80 % de colonne collé
à droite serait illisible. Le **footer** (copie + horodatage) est en revanche
rétabli à droite (`justify-content: flex-end`) — l'étirement neutralise le
`align-items: flex-end` du parent qui l'y poussait.

**Non modifiable.** Le réécrire ferait diverger le fil du parent de ce que
l'agent a réellement produit, sans que rien ne le signale : deux versions d'un
même résultat, et aucun moyen de savoir laquelle est la vraie. **Trois voies
fermées ensemble**, parce qu'une garde d'affichage ne protège pas un thread :
le bouton `.msg-edit` n'est pas posé (`buildMsg`), `enterEditMode` retourne tôt
(ui.js), et `editUserMessage` refuse (main.js) — c'est cette dernière qui compte,
les deux premières ne protègent que le clic. La **copie** reste offerte : c'est
de la lecture.

**Export.** Le markup vient de la MÊME fonction que l'écran
(`agentResultBodyHtml`, appelée par `renderExportBody`) : deux formules donneraient
deux structures, donc deux CSS à maintenir en parallèle — raison de plus quand la
feuille, elle, est déjà distincte et figée (piège 22). Le repli fonctionne dans un
export **non interactif** : `<details>` est natif, aucun JS requis. L'`escHtml` sur
intent et statut y est impératif — chaînes d'origine modèle (piège 21).

## Le drawer des outils exposés montrait `agent__spawn` vide (X-1e)

Défaut trouvé en test (Julien) : dans « Voir les outils exposés »,
`miaou__agent__spawn` s'affichait **sans description ni paramètre**, seul outil
du drawer dans ce cas.

Cause : dans `TOOLS`, l'entrée porte `description: ''` et un `inputSchema` vide
— sa définition réelle est construite par `agentSpawnToolDef` (elle annonce le
`reasoning_effort` courant comme défaut, astuce X-h). Or la substitution vivait
dans `toolDefinitions`, chez l'**appelant**. Le payload modèle la voyait ; le
drawer, qui lit `exposedTools()`, ne la voyait pas.

La résolution est remontée dans `exposedTools(ctx)` : ce qu'une fonction nommée
« outils exposés » rend doit être ce qui est réellement exposé, pour tous ses
lecteurs. Un consommateur qui doit connaître une exception pour obtenir la vraie
valeur est un consommateur qui l'oubliera — et c'est exactement ce qui s'était
produit. `toolDefinitions` continue de passer son `ctx`, la source reste unique
(un test pin l'égalité des deux chemins).

## Tests

`tests/test-agents.js` (QuickJS). Couverture pure : prédicat de racine et ses cas
limites, `agentChildrenOf`, la **composition** `spaceConvIds ∘ isRootConversation`,
les exclusions de backfill et d'orphelins, `validateAgentToolList`, les deux
bornes (pures **et câblées**), `shouldStopAgent`, les cinq statuts terminaux
distincts, la trace d'échecs d'outils, `parentThreadFor` dans ses deux branches,
la file dédiée, `convBadgeState` étendu et l'**équivalence des trois prédicats**,
le défaut de `reasoning_effort` **réellement appliqué**, la garde de parenté
(agent étranger et inexistant → message identique), la restriction de payload, la
cascade de suppression avec abort actif, et le déplacement (exclusion de
présélection, emport, réentrance).

Le lancement **effectif** d'un agent est couvert (conversation créée, thread
initial, Space hérité du ctx, libellé non normalisé) : tester qu'une fonction de
borne existe sans tester que le handler l'appelle est exactement le trou
d'orchestration que ce projet a déjà payé
(`project_quickjs_tests_dont_cover_orchestration_scope`).

Le harnais a gagné trois stubs à cette occasion — `insertBefore`, `Intl`, les
timers — parce que ces chemins n'avaient jamais été empruntés par un test.

**`projectThreadToMessages` porte `agentResult`** (`tests/test-main.js`) : deux
tests, l'un pour la survie du champ, l'autre pour qu'un message user ordinaire
n'en gagne pas — cf. « Un bug trouvé au premier lancement » ci-dessous.

**X-1e** ajoute : `isFinishedAgentConv` (les cinq statuts terminaux ferment le
fil, l'agent au travail non, une racine jamais — la garde qui empêche la cause
de déborder), la file d'interjections clefée (deux conversations indépendantes,
un drain qui ne touche pas l'autre, la clef vidée plutôt que laissée à un
tableau vide), `agentResultBodyHtml` (fermé par défaut, en-tête DANS le
`<summary>`, intent porté, `escHtml` sur les chaînes modèle, libellé UI et non
celui du modèle), et `exposedTools` (définition dynamique résolue, égalité avec
le payload modèle, outil statique inchangé en contrôle).

Ce qui reste **non couvrable en QuickJS** : le câblage bout-en-bout
spawn → exécution → réveil → badge, et pour X-1e le rail d'interjections, le
verrou de composer, le repli au clic et le rendu d'export. C'est l'objet du
verify e2e (`verify-agents.mjs` pour X-1, `verify-x1e.mjs` pour X-1e).

## La vérification e2e

`.claude/skills/run-miaou/verify-agents.mjs` (Playwright), sur le montage de
`verify-generations.mjs` : **stub SSE gaté par conversation**, ce qui rend N
générations concurrentes pilotables. Deux marqueurs coexistent — `MARK-<T>` sur
les messages user d'une racine, `AGENT-<T>` planté dans le `prompt` d'un agent
(donc présent dans le premier message de son fil). **`AGENT-` prime** : le
message de réveil emporte le texte final de l'agent dans le fil du parent, et
sans cette priorité un tour du parent réveillé serait compté comme un tour de
l'agent.

Les scénarios : spawn non bloquant ; badge du parent **et des deux agrégats** ;
réveil parent inerte ; réveil parent occupé (file dédiée + drain à la frontière
de tour) ; **herméticité** depuis une génération détachée ; **erreur backend** ;
stop utilisateur ; suppression du parent ; déplacement bloqué ; exclusions avec
`conv__get` qui répond quand même au parent ; navigation parent ↔ agent (X-1c
y ajoute le bouton de topbar) ; **délégation de fichiers** (X-1b) ; **image
regardée par un agent** (X-1d). Le compte n'est volontairement pas écrit : une
énumération fermée devient fausse au prochain ajout sans que rien ne la touche.

**Fixtures représentatives** : deux Espaces nommés en plus du défaut, un témoin
résumé dans chacun, une conversation à huit messages d'historique. Un verify sur
un profil vide validerait un cas qui n'existe pas en usage réel.

### Ce que la non-vacuité a appris

Chaque scénario a vu sa régression réinjectée dans `src/`, le bundle reconstruit
et le script relancé. La plupart font tomber leur scénario ; les cas où la
mesure a **démenti l'attente** valent plus que les autres :

1. **Délivrance déplacée sur le chemin nominal** → le stop utilisateur reste
   vert. Développé plus haut (« Le point d'accroche est le `finally` ») : c'est
   ce qui a fait écrire le scénario d'erreur backend.
2. **Agrégats de badge non alignés sur `convBadgeState`** (l'écart d'avant X-1)
   → le scénario de badge reste vert. La génération de l'enfant est elle-même
   au registre, dans l'Espace de son parent (X-a) : l'agrégat retombe juste
   **pour la mauvaise raison**. C'est le « fortuitement correct » donné plus
   haut comme deuxième motif de l'alignement — le verify le **constate** au lieu
   de le supposer, via un sous-contrôle qui retire l'entrée de l'enfant du
   registre et vérifie que les deux prédicats s'éteignent ensemble.

3. **Bouton « Régénérer le titre » ouvert sur un agent** (élargissement
   navigation) → le contrôle reste vert **une première fois**, mais parce que le
   bouton était déjà caché à l'écran précédent, pas parce que la garde agissait :
   au moment du clic l'agent était encore en vol, donc son fil n'avait aucune
   bulle assistant. Un troisième vert pour la mauvaise raison, dans un scénario
   écrit *après* avoir appris le motif — il ne suffit pas de le connaître. Le
   contrôle a été doublé d'une assertion « l'agent a bien une réponse assistant »,
   qui échoue si la prémisse disparaît.

Le tableau complet des régressions vit en tête du script, pas ici : il décrit un
**résultat de mesure** daté, qui doit être relu au même endroit que le montage
qui l'a produit.

### Un bug trouvé au premier lancement

`agentResult` ne survivait pas à `projectThreadToMessages` — une **whitelist**,
pas une copie. Le champ était écrit par `buildAgentResultEntry` et perdu à la
sauvegarde suivante. Rien ne cassait : le réveil arrivait, se lisait, partait au
modèle ; seul le discriminant d'affichage disparaissait, si bien qu'après un
reload la bulle était indiscernable d'un message tapé par l'utilisateur — et
X-3 aurait stylé un champ qui n'existe plus au rechargement.

Même forme que la projection méta de `listAllConversations` que le lot avait
déjà payée : le réflexe « quelle whitelist ? » était bon, la cible restait à
vérifier. Deux tests purs le pinnent désormais.

### Un second bug trouvé en vérifiant (X-1d), et comment

Les pixels d'une image déléguée arrivaient au tour courant mais **pas au
rechargement** (cause développée plus haut : le couple `(attId, convId)`).

Ce qui l'a révélé mérite d'être gardé, parce que le signal était **la faiblesse
d'une régression**, pas son échec. La régression « pas d'allocation d'`attId` »
ne faisait tomber que **deux assertions de forme**, les pixels arrivant toujours.
Une régression qui tombe moins fort qu'attendu dit que le contrôle mesure autre
chose que ce qu'on croit : ici, que l'`attId` ne sert **pas** au tour courant
(l'injection y porte la dataUrl, il n'y est qu'une étiquette) mais aux envois
**ultérieurs**, où `resolveRecallImages` reconstruit l'image depuis l'ack
persisté. Le contrôle de rechargement ajouté pour cette raison a immédiatement
échoué.

Sans lui, le scénario était vert et l'image aurait disparu silencieusement du fil
au reload — la classe de bug qui ne se voit qu'en usage réel.
