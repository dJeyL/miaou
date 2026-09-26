# Compaction du contexte (lot AE)

Compacter une conversation, c'est cesser de transmettre son début au modèle en
le remplaçant par un résumé — pour pouvoir la **poursuivre** sans qu'il
déraille.

Ce document décrit la frontière de compaction, son élagage, l'évacuation des
tool results, les deux gestes utilisateur et la commande `/compact`.

## Pourquoi ce n'est pas un geste de saturation

Le déclencheur n'est pas la fenêtre de contexte qui se remplit. Deux phénomènes
mesurés le précèdent largement :

- **context rot** — la performance décline dès que le contexte s'allonge, à
  tous les paliers, sans attendre la limite (étude Chroma 2025, 18 modèles
  frontières). Un modèle local, moins entraîné au long contexte, décroche plus
  tôt encore ;
- **lost in the middle** — la position de l'information change sa probabilité
  d'être utilisée. Sous ~50 % de remplissage la courbe est en U (début et fin
  privilégiés) ; au-delà, elle s'effondre en simple récence.

Conséquence de design : les seuils de l'industrie (Claude Code à ~83,5 % de la
fenêtre, API Anthropic à 150k tokens) seraient **exactement les mauvais ici**.
La compaction de MIAOU est un geste d'**hygiène**, disponible bien avant toute
contrainte technique, décidé par l'utilisateur qui voit son modèle commencer à
déraper. C'est aussi pourquoi l'affordance se propose à 50 % d'occupation
(`CONTEXT_COMPACTION_HINT_RATIO`), et non au seuil d'alerte de la pilule
(`CONTEXT_WINDOW_WARN_RATIO`, 80 %) : ces deux seuils répondent à deux questions
différentes, et les confondre ferait apparaître la proposition quand il est déjà
trop tard. Un test les tient explicitement distincts.

## La frontière est une entrée du thread

Une compaction pose **une entrée `role: 'compaction'`** dans le thread, portant
le résumé en `content`. Ce n'est pas un message : c'est une **frontière**.

Pourquoi dans le thread et pas en méta de conversation : le thread est la seule
structure que le pur d'émission, le rendu et la persistance lisent déjà
ensemble. Un champ de méta imposerait de passer la frontière en argument à
`expandThread` — qui ne prend aucun autre état — et de la tenir d'accord avec
le thread à chaque mutation.

Les purs qui servent la frontière **elle-même** (`utils.js` — la microcompaction,
plus bas, a les siens ; les projections qui la *consomment* sont plus bas
également) :

| Fonction | Rôle |
|---|---|
| `isCompactionEntry(m)` | reconnaît l'entrée, et elle seule |
| `lastCompactionIndex(thread)` | index de la **dernière** frontière, -1 sinon |
| `formatCompactionMessage(summary)` | enveloppe du message émis sur le fil |

`projectThreadToMessages` la fait survivre au reload par sa branche générique
(`role` + `content`) : aucune ligne à ajouter à sa whitelist.

## L'élagage se fait à l'ÉMISSION

`expandThread` démarre sa boucle **après** la dernière frontière et émet le
résumé en tête, sous forme de message user synthétique.

C'est le **troisième** élagage à l'émission de cette fonction, après l'ack non
réinjectable et l'assistant à content blanc (piège 27) — même doctrine, et ce
n'est pas un hasard : **l'entrée reste dans le thread** (rendu, affordances,
fidélité live/reload), elle ne part juste jamais sur le fil. Rien n'est détruit
(décision AE-2), exactement comme un tombstone de souvenir (piège 6). Ouvrir un
second chemin d'élagage ferait diverger deux prédicats en silence.

### Le message émis est `_synthetic`, obligatoirement

Sans ce marqueur, `lastAuthenticUserIndex` viserait le résumé dès qu'une
compaction termine le fil, et le préfixe éphémère `<miaou_context>` se
collerait dessus au lieu du dernier tour utilisateur réel. Même motif que le
recall d'image (brief A2). Un test le fige.

### L'indexation reste ABSOLUE — et c'est une garde, pas un détail

`enrichedAckGroups` est calculé sur le thread **entier** et `byStart` est
indexé par l'index réel ; seul le point de départ de la boucle bouge. Un
`slice` du tableau en amont serait plus simple à lire et **casserait le
ciblage `findAckByCallId`** (piège 26a) sur les conversations anciennes.

Raison mesurée au lot AE : les ids de `tool_call` des acks **legacy** (sans
champ `group`, d'avant le groupement) dérivent d'un préfixe **positionnel**
`solo:<index>`. Toute insertion en amont les fait changer — sonde : le même ack
rend `0000gq3p9` en position 1 et `0000gq4ji` en position 2. Les acks groupés,
eux, dérivent leur id de la valeur de `group` et sont stables aux deux
positions.

Ce décalage des acks legacy est **antérieur au lot** et n'est déclenché par
rien aujourd'hui (entrée notée dans `next.md`). L'élagage à l'émission ne
l'expose pas — mais un refactor qui « simplifierait » en découpant le tableau
le réveillerait, sur les vieux fils seulement, et silencieusement.

### Byte-stabilité du rejeu

`formatCompactionMessage` ne dérive que du résumé **persisté** : jamais
l'heure, jamais un compte recalculé. Deux `expandThread` successifs sur le même
thread compacté rendent le même payload (invariant 2), donc le rejeu ne
réinvalide pas le KV cache à chaque tour (piège 16).

Le résumé est écrit **une fois**, au geste de compaction, et rejoué à
l'identique ensuite. C'est aussi ce qui impose que la création des ressources
de la microcompaction appartienne au geste et non à `expandThread`, qui est pur
et synchrone (et testé en QuickJS à ce titre).

### Revenir en arrière annule la compaction

`regenerateResponse` tronque le thread après le dernier message user, et
`editUserMessage` après le message édité. La frontière étant posée en FIN de
thread, un tel retour en arrière l'emporte dès qu'il la précède — et le résumé
avec elle : le modèle reçoit de nouveau l'historique qu'elle écartait.
Régénérer juste après avoir compacté suffit à le déclencher, le bouton restant
sur la dernière bulle assistant, qui précède le séparateur.

**Comportement accepté, mais DIT au moment du geste** (décision Julien, revue du
2026-09-22). Il était silencieux, alors qu'il peut faire repasser la
conversation au-dessus de la fenêtre de contexte. Le séparateur qui disparaît
du fil ne suffit pas : c'est précisément une absence qu'il faudrait remarquer.
Le pur `compactionUndoneNotice(thread, keptLength)` (utils.js), évalué AVANT la
troncature, rend le texte ou null ; il distingue la frontière antérieure qui
survit (le modèle repart d'elle) de l'absence de toute frontière (toute la
conversation repart). `showCompactionUndoneBanner` (ui.js) l'affiche dans un
bandeau `.banner` du composer, levé par sa croix, au changement de conversation
et par une nouvelle compaction.

Le signal est DOUBLE, sur suggestion de Julien : AVANT le geste, les boutons
« régénérer » et « éditer » exigent un second clic quand le geste emporterait
une frontière (`onRegenBtn`/`onEditMsg`, ui.js, via `armThenRun` — le même
armement que les suppressions) ; APRÈS, le bandeau. Les deux décident sur le
MÊME pur `compactionUndoneNotice`, et régénérer calcule sa coupe par
`regenerateKeptLength` (utils.js), partagé avec `regenerateResponse` — deux
formules de la coupe divergeraient. L'état armé prend l'**accent de la
palette** et non le rouge `--err` des suppressions : c'est une garde sur un
geste légitime, pas une destruction. Hors frontière emportée, le clic reste
simple.

**« Continuer » une réponse tronquée est, lui, REFUSÉ après une frontière.**
La continuation ne tronque rien : elle rejoue le thread en comptant que le
modèle y voie sa réponse coupée en dernier tour. Une frontière posée après elle
l'élague de l'émission — le modèle ne reçoit que le résumé, et ce qu'il
écrirait serait recollé derrière un texte qu'il n'a pas lu. Le cas est le
premier atteint, le bouton vivant sur la dernière bulle assistant, qui précède
une frontière posée en fin de thread. Pur `compactionFollows(thread, idx)`
(utils.js) : bouton désactivé avec une infobulle qui dit pourquoi
(`syncLastAssistantActions`), et même garde au point de mutation
(`continueTruncated`). Pas de « compaction annulée » ici : il n'y a rien à
annuler, et la suite se demande par un nouveau message.

### Compacter deux fois

Seule la **dernière** frontière est émise : les précédentes sont derrière elle
par construction. Le nouveau résumé REMPLACE donc l'ancien sur le fil — et c'est
pourquoi il doit l'**intégrer** : `projectThreadForCompaction` ouvre la matière
du rédacteur sur le résumé de la frontière précédente (en entier, jamais borné),
et `COMPACTION_PROMPT` demande d'en reprendre ce qui reste valable.

Défaut corrigé en revue le 2026-09-22 : la projection partait APRÈS la frontière
sans le résumé précédent, en supposant que le rédacteur « l'avait déjà sous les
yeux ». Il ne l'a pas — `generateCompactionSummary` ne lui envoie que la
projection. Compacter une seconde fois effaçait donc du contexte, définitivement,
tout ce que la première compaction avait consigné. Cette section se réclamait
alors de l'API Anthropic, qui conserve ses blocs antérieurs verbatim : c'était
l'inverse du code. Le choix retenu (intégrer plutôt qu'empiler) garde un seul
résumé émis, donc un préfixe court et byte-stable.

## Microcompaction des tool results

Second geste du lot : les résultats d'outils volumineux quittent l'historique,
remplacés par une **référence récupérable**.

**AE-5 est ANNULÉ** (décision du 2026-09-22). Le geste était déclenché par le
même bouton que la compaction, où il n'avait **aucun effet observable** :
`expandThread` élague tout ce qui précède la frontière, et la frontière est
posée en FIN de thread — il n'y a donc rien en aval qu'une évacuation puisse
alléger. Elle mutait le thread persisté sans rien changer à ce qui part au
modèle.

Aucun test ne pouvait l'attraper, et c'est la leçon à retenir : les purs de
l'évacuation vérifiaient qu'elle évacue (vrai), ceux de la frontière qu'elle
élague (vrai aussi). Le défaut était dans le **joint** entre les deux (souvenir
`green-check-proves-nothing`). Il a fallu qu'un utilisateur observe un payload
réel après compaction — plus aucun descripteur de ressource escamotée — pour
que la question se pose.

Détachée, l'évacuation retrouve son sens : `evacuateToolResults` (main.js) est
un geste AUTONOME, qui allège les gros résultats **sans** couper l'historique
ni appeler le modèle. C'est le geste LÉGER des deux, d'où sa place au-dessus de
la compaction dans le drawer — les deux affordances y sont rangées par coût
croissant.

### Le seuil, et pourquoi il ne regarde pas le kind

`TOOL_RESULT_EVACUATION_MIN_CHARS` vaut **2 000 caractères**, mesurés sur le
champ `result` **persisté** — pas sur ce qui part au modèle, où
`formatCallMarker` et `stampTs` ajoutent une soixantaine de caractères qui ne
sont pas dans l'ack et ne seraient donc pas évacués.

Le seuil s'applique **uniformément à tous les kinds**. Une liste d'outils
éligibles périmerait au prochain outil ajouté, en silence (souvenir
`hardcoded-until-2nd`) ; la grandeur qui décide est la taille, et elle est la
même pour tout le monde. Sous le seuil, le descripteur qui remplacerait le
contenu (~120 caractères plus la note) coûte davantage que ce qu'il évacue : le
geste serait une perte nette.

`ackNeedsEvacuation` (pur) porte les trois conditions, et la première n'est pas
une question de taille :

| Condition | Pourquoi |
|---|---|
| `ackIsExpandable(ack)` | un ack sans `args`/`name` est **déjà élagué à l'émission** : évacuer son résultat créerait une ressource que rien ne transmet |

La même raison borne la **population** : `evacuationTargets` (pur, seule
définition, lue par l'affordance ET par `microcompactToolResults`) ne balaie que
ce qui suit la dernière frontière de compaction. L'amont n'est jamais émis ;
l'évacuer créait des ressources pour personne et faisait annoncer au bilan un
gain que la pilule ne montrait pas — défaut du joint relevé en revue le
2026-09-22, symétrique de celui qui a fait annuler AE-5.
| `result.length > seuil` | borne **stricte** — à égalité, on ne touche pas |
| pas déjà évacué | `isInlineHandleResult`, passé en argument plutôt que recopié |

### Le marqueur posé est le descripteur STATIQUE

C'est le piège central de cette étape. Il existe deux marqueurs de ressource, et
prendre le mauvais produit **l'inverse exact du but** :

- `[resource_ref:…]` (`RESOURCE_REF_PATTERN`, `_makeResourceRef`) est à
  **EXPANSION** : `assembleToolResultForModel` le résout au tour suivant et
  ré-inline tout le contenu ;
- `[resource id=… mime=… name="…" size=…]` (`RESOURCE_DESC_PATTERN`, posé par
  `formatInlineHandleForModel`) est **STATIQUE**, jamais expansé. **C'est
  celui-ci.**

Piège 26c, souvenir `resource-ref-reinlines` (« sûr en binary, catastrophique en
inline »). Un test le fige, et sa non-vacuité a été mesurée : le motif
`RESOURCE_REF_PATTERN` matche bien ce que la faute produirait.

### La note MIAOU survit, octet pour octet

Un résultat porte parfois une note de queue que MIAOU a concaténée pour le
modèle — `NOT_PRESENTED_NOTE` (« l'utilisateur ne voit PAS ce contenu ») ou
`PRESENTED_NOTE`. Ce n'est pas de l'habillage : c'est du texte qui **conditionne
le comportement du modèle**. L'évacuer avec le corps la ferait disparaître du
contexte en silence, et le modèle supposerait de nouveau que l'utilisateur a le
résultat sous les yeux (souvenir `model-facing-text`, défaut « silence »).

Le corps part donc dans la ressource **sans** sa note ; la note est **recollée
derrière le handle**. La séparation passe par `splitToolResultNoteRaw`, distincte
de `splitToolResultNote` : celle-ci démaquille la note pour l'AFFICHAGE (retire
le `\n` de tête et les crochets), celle-là rend les **octets d'origine**, parce
qu'on recompose un texte destiné au modèle. Réutiliser la version d'affichage
ajouterait des crochets à `PRESENTED_NOTE`, qui n'en porte pas. Deux portées,
donc deux fonctions — même motif que le couple `INLINE_HANDLE_NOTE_PATTERN` /
`isInlineHandleResult`. La **liste** des notes, elle, reste unique.

### Les trois gardes reprises de `resource__from_result`

`microcompactToolResults` (resources.js) est le même geste que son aîné du piège
26, à trois différences près : la décision vient de l'**utilisateur** et non du
modèle, elle porte sur **N acks** et non un seul, et la cible n'est pas adressée
par un `call:…` — donc **pas de `findAckByCallId`**, et pas d'exposition de la
dérive positionnelle des ids `solo:N` décrite plus haut.

- **Jamais `_makeResourceRef`** (cf. ci-dessus).
- **Réentrance** — la population est gelée avant tout `await`, sous forme de
  **références d'objet** et jamais d'index : N awaits se succèdent, donc la
  fenêtre est N fois plus large que chez `resource__from_result`, et un index
  serait faux dès qu'une mutation concurrente décale le tableau. Après chaque
  await, la cible est re-cherchée **par identité** (`indexOf`) ; absente, on
  laisse la ressource valide et on ne réécrit rien (dégradation propre). Le
  prédicat est aussi **re-évalué** à chaque tour de boucle, un geste concurrent
  ayant pu évacuer la cible entre-temps.
- **Idempotence** — `isInlineHandleResult` reconnaît un résultat déjà évacué,
  par ce geste **ou** par `resource__from_result`. Recompacter est sans effet.
  Un test ferme la boucle : la sortie du geste est reconnue par son propre
  prédicat d'idempotence, sans quoi une seconde passe évacuerait le handle.

### L'ack `resource_stored` parasite

`_storeBlock` pousse d'ordinaire un ack `resource_stored` dans
`_pendingToolAcks`. C'est juste pendant un tour d'outils, et **faux ici** :
aucun tour ne tourne, personne ne draine, et ces acks atterriraient dans la
bulle du tour **suivant** — une évacuation s'y présenterait comme un appel
d'outil du modèle, qui n'a rien demandé.

Le geste demande donc à `_storeBlock` de **ne pas l'écrire** (`opts.noAck`).
Une première version relevait la longueur de la file puis la tronquait après
coup ; mais la file est GLOBALE — une génération en vol sur une AUTRE
conversation y pousse ses propres acks pendant les N awaits du geste, et la
troncature pouvait les couper (revue du 2026-09-22). Ne pas écrire dans une
structure commune vaut mieux que défaire ce qu'on y a écrit.

### Ce que le geste n'écrit pas

`microcompactToolResults` **ne persiste rien** et rend le compte des évacuations.
La persistance appartient à l'appelant, qui seul sait dans quelle conversation il
écrit (piège 28) et doit émettre son `syncPost` **post-commit** (piège 24). Ce
raccordement arrive à l'étape 3, avec le geste complet.

### Relire ce qui a été évacué — la moitié qui donne son sens à l'autre

Évacuer ne vaut que si le modèle peut **rouvrir** ce qu'il a rangé : c'est ce
que l'aide promet à l'utilisateur (« une référence que le modèle peut rouvrir à
la demande »). Le chemin est `miaou__recall_attachment(ref="res_…")`, qui sur une
ressource de classe `inline` rend le texte **en clair** (`utf8Decode`, handler de
`recall_attachment` dans tools.js) — l'id se lit dans le handle qui a remplacé le
résultat.

Ce chemin a toujours fonctionné ; ce qui manquait, c'est qu'il soit **dit**.
`RESOURCE_DOCTRINE` n'annonce que `js__eval` (elle traite du rangement, pas de la
relecture), et `ATTACHMENT_DOCTRINE` n'annonçait `res_<id>` que pour **regarder
une image**. Rien de faux dans les deux textes, mais leur conjonction posait une
**exclusivité implicite** : un modèle y lit que `res_…` sert aux images, et rien
ne lui dit qu'une ressource textuelle se relit. Mesuré en conversation réelle le
2026-09-22 — trois tours de tâtonnement, une re-exécution de l'appel d'origine,
puis une conclusion fausse du modèle sur ses propres capacités. Défaut « silence »
puis « capacité inatteignable » (souvenir `model-facing-text`).

Deux corrections, l'une dans le texte permanent, l'autre au point de friction :

- `ATTACHMENT_DOCTRINE` énonce désormais le cas textuel, en le reliant
  explicitement au résultat évacué. C'est du message **système** (caché, payé une
  fois) plutôt qu'un allongement du handle, qui serait repayé sur **chaque**
  résultat évacué **à chaque tour** — et le handle n'est lu qu'au moment où le
  modèle cherche déjà, là où la doctrine est lue avant qu'il ne se trompe.
- Le refus de `resource__from_result` sur un résultat **déjà** ressource **nomme
  la ressource** et dit quoi faire (`inlineHandleResourceId`, tools.js, troisième
  lecteur de la phrase de `formatInlineHandleForModel`). « Ce résultat est déjà
  une ressource. » était vrai et inactionnable : le modèle devait retrouver
  l'id seul, ce qui lui a coûté deux tours.

Vérification de bout en bout : `.claude/skills/run-miaou/verify-evacuated-recall.mjs`
rejoue le scénario complet (évacuer → relire en clair → refus actionnable →
capacité annoncée dans le message système **composé**, jamais dans la constante).
Les cinq contrôles qui gardent ces deux corrections tombent sur le code d'avant,
vérifié ; les autres restent verts, le chemin ayant toujours marché — c'est
précisément la distinction qu'on veut d'eux.

## Le geste de compaction

`compactCurrentConversation` (main.js) est le geste complet : gardes, rédaction
du résumé, frontière, persistance. Il n'évacue **plus** les tool results (AE-5
annulé, cf. ci-dessus) — c'est `evacuateToolResults` qui porte ce geste, seul.

Il rend un **objet** : `{ refusal }`, `{ done }` (bilan chiffré) ou `null`
quand il n'y a rien à dire (parti ailleurs en cours de route). Le protocole
« string = refus » d'origine ne pouvait pas porter le bilan d'après-coup sans
que l'appelant devine lequel des deux il lit. `evacuateToolResults` suit le
même protocole.

### Périmètre : la conversation AFFICHÉE, et elle seule

C'est ce qui neutralise les pièges 28 et 29. `currentThread` EST le thread chaud
de `currentConvId` : pas de `warmConversation`, pas de lecture froide qui
rendrait `messages: []` et ferait écraser l'historique au premier `persistCurrent`.

Le prix de ce périmètre est une **relecture après chaque await** (piège 24 b) :
la rédaction du résumé est un aller-retour réseau de plusieurs secondes (et,
côté évacuation, `microcompactToolResults` enchaîne N awaits IDB). Entre-temps
l'utilisateur peut changer de conversation. Les DEUX gestes vont alors **au
bout** : ils écrivent dans le tableau capturé à l'entrée (`gen.thread`, chaud
par construction) et persistent par `persistGeneration` — cf. « La compaction
OCCUPE la conversation » plus bas. Une première version abandonnait
silencieusement ; l'étape 8 l'a corrigé pour la compaction, la revue du
2026-09-22 pour l'évacuation, qui laissait sinon des ressources orphelines et
des acks mutés que plus rien ne persistait.

### Deux gardes AE-7, jamais une

`compactionRefusal` (pur, utils.js) porte les trois bornes. Les deux premières
sont AE-7 et restent **distinctes**, chacune nommant sa borne : « attends la fin
de la génération » et « attends tes agents » appellent des gestes différents
(précédent `agentSpawnLimitError`). Un test vérifie que les deux messages ne
sont pas le même.

| Borne | Prédicat | Pourquoi |
|---|---|---|
| la conversation est occupée | `reclaimOccupation(convId)` (main.js) | rend la NATURE de l'occupation, que le refus nomme : agent terminé (lecture seule définitive), compaction en vol, génération en vol — `isGenerating`, **jamais `sending`**, reflet d'ÉCRAN (piège 28) —, ou onglet voisin qui écrit (`_peersGenerating`) |
| un agent travaille | `agentBusyRewriteRefusal(convId)` | prédicat partagé (piège 18), relayé tel quel : le compte rendu de l'agent doit revenir dans le fil tel qu'il l'a quitté |
| pas assez de matière | `hasCompactableSubstance(thread)` | sous le plancher, le résumé coûte autant que ce qu'il retire |

Les gardes sont évaluées **au point de mutation**, pas seulement sur le bouton :
griser une affordance ne protège pas un thread (précédent `editUserMessage` et
sa troisième voie fermée).

**Readonly c'est readonly** (revue du 2026-09-22). La première borne n'était
d'abord qu'un booléen `isGenerating` : elle faisait dire « en train de générer…
interromps-la » pendant une compaction (faux deux fois — une compaction ne
s'interrompt pas), et ne voyait ni l'onglet voisin ni l'agent terminé. Or les
boutons du drawer échappent à `setConvReadonly`, qui ne verrouille que le
composer et les actions de message : un onglet pouvait compacter pendant qu'un
autre générait, et un agent terminé se laissait réécrire. `reclaimOccupation`
relit les causes de `applyReadonlyState` À LA SOURCE, au point de mutation. Côté
bouton, seul l'agent terminé grise (état stable, comme l'absence de matière) ;
les autres occupations sont des attentes et restent cliquables.

Le bouton, lui, n'est désactivé que sur **la troisième** de ces bornes, et la
ligne de partage est ce que l'utilisateur peut y faire :

- **les deux premières sont des ATTENTES** — la génération finira, l'agent
  rendra son compte. Un bouton grisé y ferait chercher une panne là où il n'y a
  qu'à patienter, et cliquer apprend quelque chose : le refus **nomme** la
  borne. Il reste donc cliquable.
- **la troisième est un état stable** : une conversation trop courte ne
  s'allongera pas toute seule. Cliquer n'y apprendrait rien que le hint ne dise
  déjà, donc le grisé **décrit** l'état au lieu de masquer une panne.

Le grisé est écrit par `syncCompactionAffordance` et lui seul, depuis
`hasCompactableSubstance` — jamais un second prédicat. `onCompactContext` pose
aussi `disabled`, mais comme garde de **réentrance** pendant la rédaction ; son
`finally` rend la main à la synchro en re-rendant le drawer, ce qui regrise le
bouton après une compaction réussie (il n'y a alors plus de matière).

### La matière compactable se mesure en caractères

`compactableCharCount` (pur) compte la matière NOUVELLE, c'est-à-dire tout ce
qui suit la dernière frontière : c'est elle qui décide s'il y a lieu de
recompacter (le résumé précédent, déjà condensé, n'y entre pas). Le BILAN, lui,
se mesure sur `emittedHistoryCharCount` — résumé précédent compris, puisqu'il
cesse lui aussi d'être émis. Deux
décisions y sont figées :

- **le `result` des acks compte autant que le `content` des messages.** Un tour
  d'outils pèse dans le contexte comme une réponse, et l'ignorer sous-estimerait
  précisément les conversations les plus outillées, celles qu'on veut compacter ;
- **la grandeur est le poids, jamais un nombre de messages.** Deux messages
  portant chacun un gros tool result méritent la compaction, dix messages d'une
  ligne non. Même raisonnement que `TOOL_RESULT_EVACUATION_MIN_CHARS`, et même
  nature de décision : sous `COMPACTION_MIN_CHARS` (2 000), le résumé qui
  remplace coûte au moins aussi cher que ce qu'il retire.

Le cas « rien à élaguer » (conversation vide, ou compactée à l'instant) n'a pas
de prédicat propre : un total de 0 est sous n'importe quel plancher.

### Le résumé est structuré par contrat

`COMPACTION_PROMPT` (api.js) est **distinct de `SUMMARY_PROMPT`**, et pour une
raison de fond, pas de format : celui-ci résume pour RETROUVER une conversation
plus tard (index de recherche, mots-clés), celui-là pour CONTINUER à travailler
dans un fil dont le début ne sera plus transmis. Ce qu'un index peut perdre sans
dommage — une décision intermédiaire, un handle, une piste écartée — est
exactement ce dont la suite a besoin.

Jamais « résume cette conversation » : un résumé libre rend de la prose
narrative qui perd ce dont on a besoin pour reprendre. La checklist imposée est
celle de Claude Code adaptée au domaine de MIAOU — client de chat généraliste,
donc pas de « fichiers touchés » ni d'« état du plan » : intention et sa dérive,
décisions **avec leur motif**, ressources **désignées par leur handle**, échecs,
et ce qui reste en suspens.

Texte adressé au modèle, donc soumis aux défauts connus (souvenir
`model-facing-text`) :

- **destinataire explicite** — « c'est toi qui reprendras à partir de ce
  résumé ». Sans ça le modèle rédige pour un lecteur humain absent et raconte au
  passé ;
- **aucune condition non évaluable** — on ne demande pas ce qui « sera utile
  plus tard » (il ne connaît pas la suite) mais ce qui est établi, en suspens,
  ou a échoué ;
- **pas d'exclusivité implicite** — les rubriques sans objet sont explicitement
  autorisées à être omises, sinon le modèle invente de la matière pour remplir
  un plan qu'il croit obligatoire ;
- **désigner, pas recopier** — recopier le contenu d'un `res_…` dans le résumé
  annulerait le gain du geste. La réinjection relit les sources vives.

`generateCompactionSummary` (api.js) reprend les gardes de `generateSummary` :
**timeout** porté par `silentCompletion` (piège 10 — 90 s ici contre 60, la
matière lue étant la conversation entière), **parsing défensif** par
`parseSummaryJSON` (piège 7, échec → `null`), et l'**indicateur d'activité**
laissé à l'appelant (piège 8, `runBackgroundTask` en try/finally), exactement
comme `summarizeIfNeeded` enveloppe son propre appel.

AE-3 : le rédacteur est le **modèle actif de la conversation**. `activeModel()`
résout déjà `settings.model` contre l'override de conversation (piège 15) — rien
à câbler de plus, et le résumé est écrit par le modèle que la pilule annonce.

**Échec de rédaction → aucune frontière n'est posée.** Une frontière sans résumé
élaguerait l'historique en ne le remplaçant par rien : perte de contexte pure.
Le geste rend un refus qui invite à réessayer, et rien n'est muté.

### Ce que le modèle lit pour rédiger

`projectThreadForCompaction` (pur) diffère de `projectThreadForRecap`
(ci-dessous), qui ne garde que user et assistant : ici les **appels d'outils
sont inclus**, parce qu'ils portent des décisions et des handles dont la suite
dépend (« le CSV est en `res_abc` », « la requête a échoué avec telle erreur »).
Les jeter rendrait le résumé aveugle à la moitié du travail.

Les résultats d'outils sont **bornés dans la projection**, pas dans le prompt :
un seul tool result peut peser plus que toute la conversation. La troncature
**se déclare** (`[…extrait tronqué…]`) pour que le modèle sache qu'il lit un
extrait et ne présente pas une donnée coupée comme complète (défaut « silence »
du souvenir `model-facing-text`).

### Ce que lisent le résumé de recherche et le titrage (`projectThreadForRecap`)

Deux autres appels applicatifs lisent une conversation : `generateSummary` (le
résumé de recherche, storage) et `generateTitle`. Ils partagent le pur
`projectThreadForRecap` (utils.js), et **honorent la frontière** — le résumé de
compaction REMPLACE les messages qu'il couvre.

La différence avec `projectThreadForCompaction` n'est pas cosmétique, elle tient
à la **question posée** : celui-ci part APRÈS la frontière (il s'agit de
*continuer à travailler* ; il reprend toutefois le résumé précédent, que le
nouveau remplacera — cf. « Compacter deux fois »), celui-là
part de la frontière INCLUSE et couvre la conversation **depuis son début** (il
s'agit de la *retrouver* ou de la *titrer*). Sauter la frontière au lieu de la
garder produirait un titre et un résumé amnésiques ; garder le résumé préserve
la couverture complète pour une fraction du coût.

Le libellé d'introduction du résumé est **propre à cette projection**, et
surtout PAS `formatCompactionMessage` : ce dernier s'adresse au modèle en cours
de chat et lui annonce que les messages « ne sont plus transmis » — une notion
de transmission qui n'a aucun sens pour qui doit seulement titrer, et qui
l'inviterait à commenter une lacune plutôt qu'à faire son travail (souvenir
`model-facing-text`, défaut « référentiel implicite »).

Défaut corrigé le 2026-09-22 (signalé en usage réel) : les deux appelants
projetaient le thread BRUT avec un `filter`/`map` inline identique, qui ignorait
l'entrée `role: 'compaction'` comme un rôle inconnu. Après une compaction, ils
renvoyaient donc au modèle l'intégralité des messages que l'utilisateur venait
de faire évacuer — résultat juste, mais en repayant à chaque titrage et à chaque
résumé le contexte qu'on avait compacté.

### L'ordre des opérations, et la persistance unique

1. gardes ;
2. **entrée au registre des générations** (`registerGeneration`, cf. section
   suivante) — après les gardes, jamais avant ;
3. rédaction du résumé (await réseau) ;
4. relecture des gardes (piège 24 b) ;
5. la frontière est poussée dans le thread ;
6. `persistCurrent`, puis `rerenderCurrentThread` ;
7. invalidation du manifeste, bilan, `syncContextCounter` ;
8. **sortie du registre** dans un `finally`.

Il n'y a **pas** d'évacuation de tool results dans cette séquence : AE-5 est
annulé depuis le 2026-09-22 et l'évacuation est un geste autonome
(`evacuateToolResults`). Couplée ici elle n'avait aucun effet observable — tout
ce qui précède la frontière est élagué à l'émission, et la frontière est posée
en fin de thread.

Le `syncPost` post-commit (piège 24 a) est **hérité** :
`persistCurrent` → `saveConversation` → `persistConversation`, qui émet
`conv-updated` sur `tx.oncomplete`. En écrire un second ici ferait un doublon —
c'est le sens de « la persistance appartient à l'appelant » : l'appelant sait
dans quelle conversation il écrit (piège 28), pas qu'il doit rebroadcaster à la
main.

Le re-rendu passe par `rerenderCurrentThread()`, jamais `renderThread` nu
(piège 28).

### Le manifeste du dernier envoi est INVALIDÉ avant la synchro

`_lastContextManifest = null` précède `syncContextCounter()`, dans les deux
gestes d'allègement. Sans cette ligne la pilule et l'inspecteur restent figés
sur le contexte d'AVANT le geste.

La cause est dans `effectiveContextManifest()`, qui rend
`_lastContextManifest || computeContextManifestNow()` : tant que la **photo du
dernier envoi réel** existe, elle gagne. Or ces deux gestes n'envoient rien —
ils allègent ce qui *sera* envoyé. Ils appellent bien `syncContextCounter()`,
qui réaffiche fidèlement une photo périmée.

C'est la règle générale du fichier, pas une exception : les six autres sites
qui périment le manifeste (bibliothèque de Space, MCP, skills, changement de
Space ×2, changement de conversation) écrivent tous cette même ligne juste
avant leur `syncContextCounter()`. Les deux gestes d'AE étaient les seuls à
l'omettre, alors que réduire ce qui sera envoyé est précisément leur objet.

**Pourquoi le défaut a résisté à la reproduction.** Il avait été soupçonné comme
un problème d'onglet MASQUÉ (« la pilule ne se rafraîchit pas quand le geste
finit en arrière-plan »). La visibilité n'y est pour rien : il vaut aussi au
premier plan, drawer ouvert. Ce qui l'a rendu insaisissable, c'est
qu'`openConversation` remet le manifeste à `null` — **changer de conversation
et revenir efface le symptôme**, donc toute tentative de reproduction passant
par la sidebar le rate, et le rate d'une façon qui accuse la visibilité.

Mesuré avant correction : `≈ 13961 tok (43%)` avant *et* après une évacuation,
`≈ 13250 tok (40%)` dès qu'on invalide le manifeste à la main, pour un thread
retombé à 159 caractères.

## La compaction OCCUPE la conversation, sur tous les onglets

*Vaut aussi pour l'évacuation depuis la revue du 2026-09-22* (`kind`
`'evacuation'`, même montage dans `evacuateToolResults`/`runEvacuation`) : elle
n'entrait pas au registre, donc ni verrou local, ni relais aux onglets voisins,
ni aboutissement hors écran. Les sites qui traitent les deux gestes pareil
passent par `isHistoryRewriteKind` ; ceux qui les distinguent (libellé
d'inventaire, motif de refus) par `historyRewriteKind`.

Le geste est une réécriture d'historique de plusieurs secondes. Pendant ce
temps, un onglet voisin peut éditer un message, régénérer, ou lancer sa propre
compaction : les gardes AE-7 protègent l'onglet local, elles ne disent rien aux
autres.

La conversation entre donc au **registre des générations** le temps du geste —
plutôt qu'un second mécanisme de verrou, qui serait le deuxième porteur du même
état (souvenir `concurrent-writers`). Le registre porte déjà tout :

| Ce qu'on obtient | Par quoi |
|---|---|
| readonly chez les pairs | `startGenerationRelay` → `conv-generation-started` → `readonly-on` |
| les deux gardes AE-7 se ferment seules | `isGenerating(convId)` devient vrai — y compris contre une **seconde compaction**, ce qui rend toute garde de réentrance ad hoc redondante |
| badge « working » | `renderConvList` / `syncSpaceUI`, et c'est exact : ça travaille |
| « régénérer » masqué | `syncLastAssistantActions` |

Le `unread` qui en découle est **accepté** (décision Julien, 2026-09-22) :
`unregisterGeneration` pose un non-lu quand la génération finit sans posséder
l'écran. Une conversation compactée pendant qu'on regardait ailleurs portera sa
pastille, et c'est voulu — rien à filtrer, rien à conditionner.

### La « génération dégénérée » : un `kind`, et trois exemptions nommées

L'objet génération a un contrat (`thread`, `abort`, `partial*`, `wrap`) qu'une
compaction ne remplit pas : elle n'a ni stream ni thread propre. Elle est
néanmoins construite par `createGeneration`, **complète**, avec un champ `kind`
(`'stream'` par défaut, `'compaction'` ici) — jamais un littéral ad hoc : ce
qu'elle ne remplit pas, elle le remplit VIDE (`abort: null`, `wrap: null`), de
sorte qu'un consommateur qui déréférence un champ ne plante pas au premier
chemin oublié.

Trois exemptions en découlent, **et trois seulement** :

| Point | Exemption | Pourquoi |
|---|---|---|
| `genOwnsScreen(gen)` | faux pour une compaction | elle ne peint rien : ni bulle, ni stream, ni ack. Le prédicat d'écran reste **unique** — c'est ici qu'on répond, jamais par un test `kind` réécrit chez un consommateur |
| `streamGenerationFor(convId)` | écarte la compaction | filtre du registre par NATURE, consommé par les points de **rebranchement d'écran** (`rerenderCurrentThread`, `openConversation`, les deux `detachGenerationFromScreen`) |
| `abortStream(convId)` | sortie immédiate | pas de stream à interrompre ; sans l'exemption on tomberait sur la branche du stop différé, qui poserait `stopRequested` que personne n'honore et figerait le bouton composer |

`streamGenerationFor` **n'est pas** un second prédicat d'écran. Il répond à une
question de DONNÉES — « cette conversation a-t-elle un thread de travail en
avance sur le storage, sur lequel rebrancher l'affichage ? ». Un stream, oui
(son tour courant n'est persisté qu'à `onFinal`) ; une compaction, non (elle
mute `currentThread` en place). Les consommateurs qui demandent « cette conv
est-elle occupée ? » — gardes AE-7, badges, agents — continuent d'appeler
`generationFor` / `isGenerating` **sans filtre**, et c'est tout l'intérêt de
faire entrer la compaction au registre.

### Le sens du test de `kind` est ASYMÉTRIQUE

`abortStream` teste `gen.kind === 'compaction'` ; `genOwnsScreen` teste
`gen.kind === 'stream'`. Ce n'est pas une inconséquence : on regarde de quel
côté tombe le défaut si le champ manque (fixture, chemin futur qui
construirait l'objet à la main).

- Ne pas interrompre un stream est **silencieux** — il continue de consommer
  sans que personne le voie. Le doute doit donc aller vers « interrompre »,
  d'où `=== 'compaction'`.
- Peindre sur une entrée qui n'a pas de quoi l'être **casse** ; ne pas peindre
  est bénin. Le doute va vers « ne possède pas l'écran », d'où `=== 'stream'`.

Un test QuickJS garde chaque sens, dont un explicitement sur l'entrée sans
`kind`.

### Quitter la conversation pendant le geste ne l'annule plus

Le geste ABOUTIT même si l'écran est parti. Il abandonnait silencieusement
jusqu'au 2026-09-22 — résumé rédigé, appel modèle payé, puis jeté, et
l'utilisateur retrouvait sa conversation sans aucune trace de la compaction
qu'il avait demandée. Une perte de travail, pas un défaut d'affichage.

Cet abandon était **juste** avant l'étape 8 : sa prémisse était que rien ne
protégeait la conversation pendant le geste. Depuis, elle est au registre et
verrouillée sur tous les onglets. Ce qui change en partant n'est donc plus la
sûreté, mais le **référentiel d'écriture** — exactement la scission du
piège 28 :

| Question | Réponse |
|---|---|
| où j'écris ? | `gen.thread`, la référence capturée à l'enregistrement — **jamais** `currentThread`, réaffecté à la conversation d'arrivée par `openConversation` |
| comment je persiste ? | `persistGeneration(gen)` hors écran (écrit dans `gen.convId`, porte `generationWouldTruncate`), `persistCurrent` sinon |
| est-ce que je peins ? | seulement si l'écran affiche ce tableau |

Le piège 29 est neutralisé **sans** `warmConversation` : `gen.thread` a été
capturé alors que la conversation était affichée, donc chaud par construction.

**Le référentiel se décide sur l'IDENTITÉ du tableau, pas sur l'égalité des
ids.** Les deux divergent dans un cas réel : partir puis REVENIR pendant la
rédaction. `openConversation` réaffecte alors `currentThread` depuis le storage
— un tableau NEUF, et non `gen.thread`, puisque `streamGenerationFor` écarte
les compactions du rebranchement. `currentConvId === convId` serait vrai, mais
pousser la frontière dans `currentThread` la poserait dans une copie, et
`persistCurrent` écraserait l'autre. Mesuré : décider sur l'id fait perdre la
frontière et tronque l'historique (3 contrôles rouges). Ce cas rebranche
l'écran par un `openConversation(convId)` après la persistance.

### Deux surfaces annoncent le geste, jamais les deux à la fois

Une compaction en vol peut s'annoncer de deux façons, et elles faisaient
doublon (signalé par Julien, 2026-09-22) :

| Surface | Ce qu'elle dit | Quand elle parle |
|---|---|---|
| indicateur de fond (`.bg-activity`) | « compaction… », **anonyme** : ni où, ni sur quoi | tant qu'on REGARDE la conversation |
| pilule d'activité de topbar | nomme la conversation, y ramène d'un clic | une fois qu'on a NAVIGUÉ ailleurs |

Chacune parle exactement là où l'autre se tait. La pilule se tait d'elle-même
sur la conversation regardée (`resolveAgentCount` : une pastille n'annonce que
ce qu'on ne voit pas) ; l'indicateur, lui, doit être éteint activement — c'est
`syncCompactionActivitySurface`, appelée aux quatre points qui peuvent changer
la réponse (les deux bornes du registre, les deux chemins de navigation).

Le mécanisme est `setBgActivitySuppressed` (ui.js) : un drapeau qui éteint
l'indicateur **sans toucher au compteur**, de sorte qu'une tâche concurrente
(un titrage qui tournerait pendant la compaction) reste comptée et que la levée
du drapeau la retrouve. `syncBgActivity` devient l'écrivain unique de la classe
`.active`, les trois points qui la changeaient passant par lui.

C'est une exception assumée à la nature de `.bg-activity`, qui est global et
anonyme par construction : ses usages historiques (résumé, titrage, description
de fichier) n'ont aucune autre surface, donc la question ne se posait pas.

### La garde post-await teste l'IDENTITÉ, pas la présence

`runCompaction` re-vérifie ses bornes après l'aller-retour modèle (piège 24 b).
La borne « une génération tourne » s'y écrit `generationFor(convId) !== gen`, et
**non** `isGenerating(convId)` : depuis que la compaction est elle-même au
registre, `isGenerating` répondrait vrai *à cause d'elle*, et le geste se
refuserait à lui-même juste avant d'aboutir — motif
`predicate-killed-by-feature`, une borne qui rend faux le prédicat de
continuation lisant la même grandeur.

La question posée reste exactement la même — « quelqu'un d'AUTRE occupe-t-il
cette conversation ? » — mais elle s'exprime par identité plutôt que par
présence. Le registre étant clé par `convId`, il ne peut de toute façon porter
qu'une entrée.

Le désenregistrement est dans un **`finally`**, jamais réparti sur les chemins
de sortie : le geste en a sept (refus, abandon, succès) et son `await` peut
jeter. Sans ce point unique, une conversation resterait verrouillée sur tous
les onglets jusqu'au rechargement de la page.

## Les deux voies de déclenchement

Le geste (`compactCurrentConversation`) a **deux points d'entrée, un seul
corps** : le bouton du drawer d'inspecteur (ci-dessous) et la commande
`/compact` au composer (lot AE étape 4). Les deux appellent la même fonction et
lisent le même refus — aucune garde n'est réécrite côté appelant, elles vivent
toutes au point de mutation.

`/compact` est la première **commande MIAOU**, seconde famille derrière le `/`
du composer jusqu'ici réservé aux skills. Le mécanisme complet (registre
`MIAOU_COMMANDS`, prédicat `matchMiaouCommand`, placement dans `sendMessage` et
non `resolveSend`, réservation du slug AE-9, autocomplétion) est décrit dans
**`docs/skills.md` §2 et §4** — il relève du `/`, pas de la compaction.

Ce qui appartient à ce fichier, ce sont les trois points où la commande touche
au geste :

- **`runMiaouCommand` n'enveloppe PAS l'appel dans `runBackgroundTask`** :
  `compactCurrentConversation` porte déjà le sien autour de la rédaction du
  résumé (piège 8). En imbriquer un second compterait deux fois la même tâche
  dans l'indicateur d'activité.
- **Verrou de réentrance propre à la commande** (`_commandRunning`, main.js).
  `_sendResolving` est relâché avant que la commande ne s'exécute, et la
  rédaction du résumé est un aller-retour réseau de plusieurs secondes : deux
  Entrée rapides poseraient sinon deux frontières. Même raison que le
  `btn.disabled` du bouton de drawer, mais un verrou distinct — les deux voies
  ne partagent pas d'état d'UI.
- **`/compact` + pièces jointes en attente → refus** (décision Julien,
  2026-09-21). Ni jeter la pièce jointe (perte silencieuse), ni envoyer la
  commande comme texte (elle ne s'exécuterait pas). Le refus nomme la raison et
  ne consomme rien — ni la saisie, ni les pièces jointes.

**Jamais par interjection, et par construction.** AE-7 refuse de compacter
pendant une génération ; une interjection n'existe QUE pendant une génération.
L'EXÉCUTION y est donc impossible, et c'est le placement du prédicat dans
`sendMessage` plutôt que dans `resolveSend` qui le garantit — les deux drains
d'interjection re-résolvent le littéral par `resolveSend`.

Le REFUS, lui, n'est pas vide : `enqueueInterjection` et `editUserMessage`
appellent `resolveSend`, qui ne connaît de la commande que sa forme, et
servaient donc `commandFormRefusal` (« elle s'envoie seule ») à qui venait de
l'envoyer seule. Corrigé en revue le 2026-09-22 : ces deux chemins testent
`matchMiaouCommand` AVANT `resolveSend` et servent `commandContextRefusal`
(skills.js), qui nomme la vraie borne — la génération en cours, ou l'édition.
Le cas vide « par construction » décrivait l'exécution ; le lire comme couvrant
aussi le message est ce qui a laissé passer le défaut.

## L'affordance

L'affordance *visible* — celle qui se propose — vit dans le **drawer de
l'inspecteur de contexte** : le seul endroit qui explique *pourquoi* on
compacterait, les barres montrant où va le contexte. `/compact` est l'autre
voie, mais elle ne se propose pas : il faut la connaître (d'où sa mention dans
`help.md`, topics `skills` et `compaction` — ce dernier séparé de `contexte`
le 2026-09-25 —, et dans l'autocomplétion du `/`).
`syncCompactionAffordance` (ui.js) la rafraîchit avec le reste du drawer.

**Toujours visible**, jamais masquée sous le seuil (décision Julien) : un
modèle peut déraper à 30 % d'occupation, et le geste doit rester atteignable.
Au-delà de `CONTEXT_COMPACTION_HINT_RATIO` elle devient seulement **saillante**
(`.is-salient`, l'accent — pas une couleur d'alerte, qui en ferait un incident
à traiter alors que c'est une hygiène proposée). Le remplissage ne conditionne
donc jamais la disponibilité du bouton ; seule l'absence de matière le grise
(cf. les trois bornes plus haut).

AE-1 : elle se **propose**, elle ne se déclenche jamais seule.

### Deux affordances, rangées par coût croissant

Depuis l'annulation d'AE-5, le drawer porte **deux** blocs d'allègement, et
l'évacuation vient EN PREMIER : elle n'appelle pas le modèle, ne coupe rien, et
les résultats restent rouvrables par leur handle. La compaction, qui rédige un
résumé et cesse de transmettre un pan du fil, suit.

Elles partagent leur mécanique d'appel (`runReclaimGesture`, ui.js) —
réentrance, libellé d'attente, refus, bilan, re-rendu — plutôt que d'en tenir
deux copies qui divergeraient au premier ajustement. Elles diffèrent par leur
troisième borne : la compaction demande « assez d'historique »
(`hasCompactableSubstance`), l'évacuation « des résultats assez gros »
(`evacuableToolResults`). Une conversation fournie peut n'avoir aucun résultat
éligible, et une conversation courte avec un seul énorme résultat en a un.

Les DEUX relaient les mêmes bornes AE-7, par le même pur `compactionRefusal`,
qui prend depuis le 2026-09-22 un argument `gesture` nommant le geste refusé :
un refus qui dirait « avant de compacter le contexte » sur un clic d'évacuation
ferait chercher une affordance qu'on n'a pas touchée.

Le glyphe de l'évacuation reprend le **bac** du « télécharger », mais sa flèche
REMONTE et s'échappe par la droite après un coude à 90° : le contenu SORT du
contexte. Ce qui le distingue de ses deux voisins est donc le seul trajet de la
flèche — descendante et pointe en bas pour l'export de conversation, montante
droite et pointe en haut pour l'import de réglages (souvenir
`icon-vocabulary`, une métaphore = un usage). La pointe s'arrête à `x=20` :
plus loin, la jointure arrondie du chevron déborde du `viewBox` et se fait
rogner au rendu. Le premier jet était un maillon de chaîne, écarté avec le
passage de « lien » à « référence » dans le libellé.

### Le bilan est rendu APRÈS coup, jamais promis avant

Aucune des deux affordances n'annonce un gain chiffré avant le clic. Le gain
n'est honnêtement calculable qu'une fois le geste fait : le descripteur qui
remplace un résultat évacué coûte lui-même, et un chiffre promis puis démenti
par la pilule serait pire que pas de chiffre du tout. Avant le geste,
l'évacuation annonce donc un **compte** (« 2 résultats… ») et la compaction ce
qu'elle FAIT, rien de plus.

Après coup, `formatReclaimSummary` (pur) rédige un bilan à partir d'une mesure
avant/après de ce que le thread ÉMET (`emittedHistoryCharCount` : dernier résumé
plus ce qui suit sa frontière — jamais le thread entier, dont l'amont ne part
pas) — « 2 résultats évacués, ≈ 1 421 tok récupérés ». Le « ≈ » n'est pas
décoratif : l'estimation est en chars/4 comme partout ailleurs
(`estimateTokensFromChars`, qui partage la formule d'`estimateTokens` depuis un
COMPTE plutôt qu'une chaîne). Un gain nul ou négatif **se dit** (« contexte
inchangé ») : le cas est réel, et un silence après un geste explicite laisserait
chercher ce qui s'est passé.

Le bilan est posé **par le geste**, avant son `syncContextCounter` — jamais par
ses appelants. Deux raisons : ce `sync` re-rend le drawer s'il est ouvert, donc
un poseur placé après n'aurait aucun effet (défaut attrapé par le verify, qui
lisait le hint d'avant le geste) ; et les deux voies de déclenchement (bouton,
`/compact`) auraient sinon chacune à s'en charger, ce qui laisserait la commande
muette. Il vit dans `_reclaimReports` (ui.js), état de VUE volatil jamais
persisté (souvenir `no-view-state-persisted`), purgé à l'ouverture du drawer et
au changement de conversation — un bilan décrit un geste qu'on vient de faire,
pas un état de la conversation.

**La compaction, elle, persiste son chiffre** sur l'entrée de frontière (champ
`reclaimed`) et l'affiche dans le séparateur du fil. C'est ce qui le rend
lisible sans ouvrir le drawer, et survivant au reload — d'où sa ligne dans les
DEUX whitelists de projection (`projectConvMessages` à la lecture,
`projectThreadToMessages` à l'écriture) : n'en faire qu'une perdrait le chiffre
à l'aller ou au retour. Le suffixe est composé par le pur
`formatCompactionReclaimSuffix`, qui **refuse tout ce qui n'est pas un entier
fini positif** : sa sortie est interpolée dans un template string envoyé à
`innerHTML` (piège 21), et le champ étant persisté, un import ou une donnée de
test peut y mettre n'importe quoi.

### Le seuil se signale par la FORME sur la pilule

La pilule `#ctx-counter` porte un glyphe de compaction au-delà de 50 %
(`syncCompactionHintGlyph`), **pas une couleur** : `ctx-counter-warn` (80 %) et
`ctx-counter-over` (100 %) occupent déjà le registre chromatique, et les trois
seuils ne disent pas la même chose. La couleur dit « limite technique », la
forme dit « hygiène conseillée ».

Le glyphe porte l'**accent**, donc il suit la palette active (ambre / encre /
forêt) comme l'affordance qu'il annonce. Ça ne contredit pas ce qui précède :
l'accent est la couleur d'**identité** de l'interface, pas une couleur de
statut — il ne dit ni alerte ni erreur, et ne mord donc pas sur le registre des
seuils. C'est toujours la FORME qui porte le signal ; la couleur ne fait que le
rendre lisible.

**Exception, et c'est la raison d'être de la règle** : dès que la pilule prend
une couleur de seuil (`ctx-counter-warn`, `ctx-counter-over`), le glyphe
redescend à `currentColor`. Deux couleurs dans une même pilule se liraient comme
deux messages concurrents, et c'est la saturation qui doit gagner — même
arbitrage que le tireté de `.ctx-counter-midturn`, dont la couleur cède aussi.

Sans fenêtre de contexte connue, aucun glyphe — comme le `%` du libellé, absent
lui aussi plutôt qu'arbitraire.

**La visibilité s'écrit sur l'ATTRIBUT `hidden`, jamais sur la propriété.** La
cible est un `<svg>`, et `hidden` est une propriété de `HTMLElement`, **absente
de `SVGElement`** : `el.hidden = false` y crée une propriété JS sur l'objet
**sans retirer l'attribut HTML**, que `[hidden] { display: none !important }`
(base.css) continue d'honorer. Le glyphe reste alors invisible quel que soit le
ratio pendant que tout code lisant `el.hidden` répond « visible ». Défaut payé :
le glyphe n'a jamais été peint entre l'étape 3 et sa correction, sans qu'aucun
contrôle ne le voie — ils lisaient tous la propriété. Corollaire pour les
vérifications : sur cette surface, mesurer la **boîte peinte**, pas l'attribut.

Note de vocabulaire : `--ctx-warn` est un **ambre** (`#b8720a`), pas un jaune.
Le jaune de l'interface (`--pending`, `#d9a441`) est celui de l'attente
d'autorisation MCP, et n'est pas emprunté ici — son commentaire dans `base.css`
interdit justement l'emprunt de token entre domaines.

### Conséquence sur le réglage « fenêtre de contexte »

*(Le champ global décrit ici a été remplacé au lot AF par une fenêtre par
(serveur, modèle), lue sur le serveur ou saisie sur sa fiche, cf.
`docs/model-props.md`. La conséquence décrite reste vraie de la fenêtre
retenue.)*

Ce réglage n'était jusqu'ici qu'un **dénominateur d'affichage**. Il décide
désormais aussi du moment où la compaction est conseillée. Trois textes le
disaient « seulement » utile à l'inspecteur et sont corrigés au même lot : le
hint du champ (`index.html`) et deux passages de `src/help.md` (topics
`contexte` et `interface`). Exclusivité implicite devenue fausse par ajout d'un
cas — le défaut nommé du souvenir `model-facing-text`, et la raison pour
laquelle la règle des énumérations fermées vise aussi les mots comme
« seulement ».

## Rendu dans le fil

`buildCompactionMarker` (acks.js) rend une règle horizontale légendée, avec le
résumé replié dans un `<details>`. Volontairement discret : la métaphore est la
**coupure**, pas la notification — une bannière colorée en ferait un événement
à traiter, alors que l'utilisateur vient de le provoquer.

Ce que cette surface dit importe : les messages d'avant **sont toujours là**,
ce qui a changé est ce que le modèle reçoit. Un libellé laissant croire à une
suppression ferait craindre une perte qui n'a pas lieu.

Le résumé est d'origine **modèle** : rendu par `renderMd` (sortie sanitisée),
jamais par interpolation de chaîne (piège 21).

Les acks en attente sont vidés **avant** le séparateur dans `renderThread`,
sinon ils seraient replacés dans la première bulle assistant d'après la
frontière, à laquelle ils n'appartiennent pas.

## Vérification

Tests QuickJS dans `tests/test-utils.js` (13, lot AE étape 1) : élagage de ce
qui précède, émission en tête, `_synthetic`, deux frontières, byte-stabilité du
rejeu, groupe d'acks conservant son assistant porteur, stabilité des ids de
part et d'autre, non-régression d'un thread sans frontière.

Étape 2 (14 de plus, même fichier) : seuil et sa borne stricte, ack non
expansable jamais évacué, idempotence, **descripteur statique contre
`resource_ref`** (non-vacuité mesurée), survie des deux notes sous leur forme
brute, byte-stabilité du recollage, boucle d'idempotence fermée, nom de
ressource dérivé de l'outil.

Étape 3 (16 de plus, même fichier) : les deux seuils tenus **distincts**, matière
comptant `content` ET `result`, matière comptée après la dernière frontière,
conversation juste compactée sans matière, borne inclusive du plancher, thread
vide sans exception, les deux refus AE-7 **et le fait qu'ils diffèrent**,
priorité de la génération sur l'agent, refus sans matière, absence de refus
nominale, projection portant les appels d'outils, projection partant après la
frontière, troncature qui se déclare, et la boucle fermée entre le geste et les
purs de l'étape 1.

Étape 4 (15 de plus, `tests/test-skills.js` — la commande relève du `/`) :
réservation du slug et son message, réservation lue depuis le registre vivant
(`commandSlugs()`, jamais un cardinal ni un littéral), priorité du refus réservé
sur celui d'unicité, reconnaissance du littéral seul, trim, refus de
`/compact et autre chose`, refus d'un slash hors position 0, refus d'un slug
inconnu et des entrées vides, reconnaissance de chaque slug du registre,
autocomplétion des commandes (préfixe de slug, libellé, saisie vide, non-match),
séparation d'avec `matchSkillCompletions`, et le message de refus de forme.

Non-vacuité mesurée sur les trois contrôles qui portent le lot : fusionner les
deux gardes AE-7 en une seule fait tomber deux tests ; retirer le `result` du
compte de matière en fait tomber un ; retirer la garde de réservation
(`validateSkillSlug`) en fait tomber trois, et relâcher la condition 3 en
« commence par » (`matchMiaouCommand`) en fait tomber un.

Les gestes impurs (`microcompactToolResults`, `compactCurrentConversation`) ne
sont pas couverts par un test pur : ils tiennent dans des `await` sur IDB et le
réseau. Ce qui DÉCIDE en est extrait et testé (`ackNeedsEvacuation`,
`splitToolResultNoteRaw`, `formatEvacuatedToolResult`, `evacuatedResourceName`,
`compactableCharCount`, `hasCompactableSubstance`, `compactionRefusal`,
`projectThreadForCompaction`), conformément au souvenir `extract-pure-over-stub`.

Étape 8 (7 de plus, `tests/test-main.js` — le `kind` vit dans le registre) :
défaut `'stream'` de `createGeneration`, contrat rempli pour une compaction
(`abort`/`wrap` posés VIDES, jamais omis), `genOwnsScreen` faux sur la
conversation affichée **avec son témoin en `'stream'`**, `streamGenerationFor`
qui écarte la compaction pendant qu'`isGenerating` la VOIT — les deux moitiés
dans un même test, parce que c'est leur conjonction qui fait l'étape —, sa
contre-épreuve sur une vraie génération, `abortStream` qui n'interrompt ni ne
pose `stopRequested` sur une compaction, et l'entrée SANS `kind` qui reste
interruptible (asymétrie délibérée, cf. plus haut).

Plus 5 dans `tests/test-agents.js` pour `rootActivityLabel` : les trois
occupations d'une racine, la garde d'ORDRE (une compaction est AU REGISTRE,
donc `working` y est vrai aussi — inverser les deux tests la ferait retomber
sur « génère »), et le fait que les trois libellés soient **distincts**
(souvenir `distinct-labels-joint-assert`).

Non-vacuité mesurée là aussi : trois régressions injectées une à une
(`genOwnsScreen` amputé de son test de `kind`, `streamGenerationFor` rendu
transparent, exemption d'`abortStream` retirée) font tomber **un** test chacune,
celui qui la nomme.

Le **CSS n'est couvert par aucun test pur** : le séparateur, le glyphe de seuil
et l'affordance du drawer se regardent en conditions réelles. C'est l'objet de
`verify-compaction.mjs`, dont les premiers blocs couvrent — séparateur
dans le fil et sa promesse « rien n'est perdu » (les messages d'avant restent
AFFICHÉS, ce que les purs ne voient pas : ils testent l'émission, où ils sont
bien élagués) ; glyphe de seuil dans ses **trois** états, dont « sans fenêtre
connue » ; affordance du drawer, sa saillance mesurée sur la couleur RÉSOLUE
(la classe seule ne prouve que l'exécution du JS, pas que la cascade a suivi)
et le grisé de l'absence de matière avec sa réciproque ; liste du `/` enfin —
ordre des deux familles, distinction visuelle, absence des commandes en édition
de message passé, et la densité de l'étape 5.

Le script lit ses compteurs depuis la **source vivante** (`commandSlugs()`) et
asserte l'**ensemble des slugs**, jamais leur nombre : un cardinal repérime au
prochain ajout et ne dit pas *lequel* manque quand il tombe.

`verify-evacuated-recall.mjs` tient la moitié que celui-ci ne regarde pas : non
pas que le contenu **parte**, mais qu'on puisse le **relire** (cf. « Relire ce
qui a été évacué » plus haut). Il évacue un résultat monté pour l'occasion, le
rappelle par `recall_attachment`, et vérifie que le texte revient **entier** —
marqueurs de début ET de fin, un rappel tronqué passerait sinon —, que le refus
de `resource__from_result` nomme la ressource, et que la capacité est annoncée
dans le message système **composé** (`buildSystemMessage().content`), jamais dans
la constante. Trois pièges de montage y sont payés et commentés sur place :
`ensureConversation()` est obligatoire (le geste sort sur `!currentConvId`, que
`newConversation` remet justement à null), l'ack est une entrée `tool-ack` de
**premier niveau** du thread et non un champ d'assistant, et `callTool` rend la
forme MCP `{ content: [...] }` — un `String(out)` donnerait « [object Object] »
et TOUS les contrôles de contenu passeraient au vert sur du vide. L'id `call:…`
est enfin **demandé** à `enrichedAckGroups` plutôt qu'inventé : il est dérivé, pas
stocké.

Les blocs 6 et 7 (étape 8) jouent en revanche la compaction **de bout en bout**,
ce que les cinq premiers ne pouvaient pas faire. Ce qui a levé l'obstacle n'est
pas un stub réseau mais un stub de `silentCompletion` — le SEUL point d'appel
du modèle sur ce chemin : tout le reste du geste (gardes, registre, frontière,
persistance, bilan) s'exécute pour de vrai.

**Bloc 6 — l'occupation.** Que la conversation entre au registre comme
`'compaction'`, qu'`isGenerating` la voie (gardes, badge « working »), que
l'enveloppe `conv-generation-started` parte sur le canal, que les trois
exemptions tiennent PENDANT le geste, que le verrou LOCAL soit posé puis levé,
que le popover dise « compacte le contexte » et jamais « génère », et que les
deux surfaces d'annonce s'excluent (cf. ci-dessous).

Un contrôle du bloc a dû être réécrit : « aucune bulle fantôme » comptait
d'abord les `.cursor-blink` et les bulles « vides », et restait VERT alors que
le rebranchement était bel et bien déclenché — la bulle qu'ouvre
`startAssistantMessage` porte un patienteur, pas un caret. Le compte de bulles
avant/après le re-rendu, lui, ne peut pas mentir.

**Bloc 7 — la navigation pendant le geste**, dans ses deux variantes (partir et
rester parti ; partir puis revenir). Il vérifie que la frontière est persistée
dans la BONNE conversation, que celle d'arrivée ne reçoit rien (piège 28), que
l'historique n'est pas tronqué (piège 29), et qu'UNE seule frontière est posée.

**Blocs 8 et 9 — les deux défauts du 2026-09-22**, signalés par Julien après
l'étape 8 et tous deux invisibles aux purs, chacun pour une raison propre.

Le **bloc 8** mesure l'appariement bulle `.msg` ↔ entrée de thread après une
frontière. `reindexThreadDom` écartait les seuls acks (`!isAckRole`), or la
frontière n'est pas un ack et ne produit pourtant pas de bulle : elle était
comptée comme entrée à bulle, et tout ce qui suit glissait d'un rang —
l'édition d'un message user chargeait la textarea avec le contenu du SUIVANT,
puis `editUserMessage` refusait silencieusement (`role !== 'user'`), d'où un
« Valider » sans effet. Le prédicat est désormais `entryHasMsgBubble`
(utils.js), couvert par QuickJS ; ce que le script ajoute est le CÂBLAGE, que
les purs ne voient pas — `data-thread-idx`, la textarea, la troncature. Les
bulles sont appariées sur le TEXTE PEINT et non sur l'indice seul : un
appariement décalé coïncide parfois par hasard sur les indices, jamais sur le
contenu.

Le **bloc 9** mesure la pastille « non lu » après une compaction qu'on REGARDE.
`unregisterGeneration` lisait `genOwnsScreen` pour répondre à « la conversation
est-elle sous les yeux ? » : les deux coïncident pour un stream, mais une
compaction en est EXEMPTÉE par construction (elle ne peint rien), donc la
pastille se posait même scrollé au fond, et ne s'effaçait qu'en partant puis
revenant (`openConversation` → `markConvRead`). Le test est maintenant l'écran
lui-même. Le bloc porte sa **réciproque** — la même compaction finie hors écran
doit bien poser la pastille —, sans quoi il passerait aussi sur un code qui
aurait simplement supprimé le marquage ; et il lit le pixel de la pastille en
sidebar, pas seulement `convBadgeState` (un état interne juste avec un rendu qui
traîne laisse la pastille à l'écran).

Non-vacuité mesurée : rejoués contre le code d'AVANT les deux correctifs, ils
tombent à six rouges — quatre au bloc 8, deux au bloc 9 — tous leurs témoins
restant verts.

Reste hors couverture, délibérément : la microcompaction (IDB), et le
multi-onglets réel — un seul `page` ne peut pas observer le pair, `file://` ne
donnant pas de BroadcastChannel partagé entre contextes. La moitié observable
(l'enveloppe part) l'est.

Neuf régressions injectées une à une le confirment non vacu : mesure de hauteur
retirée (2 rouges), grisé sans matière retiré (2), commandes replacées derrière
les skills (1), seuil du glyphe aligné sur celui d'alerte (1), étiquette
« commande » vidée (1), slug rendu à une pile mono écrite en dur (1), **retour
au `el.hidden` sur le `<svg>` du glyphe (4, dont celui qui NOMME la cause)**,
**commentaire CSS re-cassé — la règle disparaît alors du bundle (3)**, et glyphe
gardant l'accent sous saturation (1).

Les deux avant-dernières sont les défauts réellement trouvés à l'étape 5, et
tous deux étaient invisibles à la version initiale du script : elle assertait
`el.hidden` (la propriété qui ment sur un SVG) et n'appelait que
`syncCompactionHintGlyph` en isolation, jamais `syncContextCounter`, le chemin
que l'application emprunte. Les deux corrections sont dans le script.

Sept régressions de plus à l'étape 8, chacune rouge sur les contrôles qui la
nomment : invalidation du manifeste retirée (1) ; enregistrement au registre
retiré (8) ; `genOwnsScreen` amputé (1) ; `streamGenerationFor` rendu
transparent (1) ; verrou local retiré du prédicat (3) et sa levée retirée (3) ;
abandon sur navigation restauré (5) ; référentiel décidé sur l'égalité des
**ids** plutôt que sur l'identité du tableau (3) ; suppression de l'indicateur
de fond désarmée (1).

Quatre d'entre elles sont des défauts RÉELS, trouvés en usage par Julien le
2026-09-22 et non par le script — qui ne les couvrait pas avant qu'ils soient
signalés : la pilule figée, le verrou local manquant, le « génère » du popover,
et l'abandon silencieux sur navigation. Le cinquième (identité vs id) est le
seul que l'implémentation ait anticipé, et sa mesure a confirmé qu'il n'était
pas théorique.
