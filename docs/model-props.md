# Propriétés déclarées des modèles (lot AF)

MIAOU lit ce que le backend **déclare** de chaque modèle au lieu de le faire
saisir ou de le deviner après un échec. Il s'agit de la fenêtre de contexte
et des capacités (vision, outils, raisonnement). Deux chemins les
alimentent : `/models`, que tout backend OpenAI-compatible sert, et la racine
native d'Ollama (`/api/tags`, `/api/show`, `/api/ps`), seule à porter la
fenêtre et les capacités chez lui.

## Formes mesurées

Aucune n'est devinée depuis une identité de backend : on lit la **forme** de
la réponse, comme pour `promptOrder` (`docs/context-inspector.md`).

- **`/v1/models` au schéma Mistral** (relevé sur des modèles Mistral servis
  par vLLM derrière une passerelle). `max_context_length` est à plat sur
  l'entrée. `capabilities` est un **objet de booléens**, avec des noms
  propres à Mistral : `function_calling` pour les outils, `reasoning` pour le
  raisonnement, `completion_chat`, `vision`… Un vLLM nu expose
  `max_model_len` et aucune capacité.
- **`/api/tags` d'Ollama.** `capabilities` y est une **liste de chaînes**,
  qui **sous-déclare** : pour les GGUF, `tools` et `thinking` manquent
  (mesuré sur Ollama 0.34.2, `ornith-1.5:9b` y donne `completion, vision`,
  et `/api/show` `tools, thinking, completion, vision`). On la lit donc **en
  positif seulement** : une capacité présente vaut `true`, une absente vaut
  « inconnu ». La fenêtre vient de `details.context_length`, qui n'existe
  que pour les GGUF.
- **`/api/show` d'Ollama**, pour un modèle à la fois. Sa liste de capacités
  **fait autorité**. La fenêtre est dans `model_info`, sous une clé préfixée
  par l'architecture (`qwen35.context_length`, `gemma4.context_length`).
  L'architecture ne se déduit **pas** du nom du modèle : on la lit dans
  `general.architecture`, et à défaut on cherche par suffixe. Le champ texte
  `parameters` peut porter un `num_ctx` fixé dans le Modelfile. La fenêtre
  qu'il fixe est rendue à part (`contextConfigured`), parce qu'elle n'a pas
  le statut d'un maximum.
- **`/api/ps` d'Ollama** donne la fenêtre **réellement servie**, pour les
  seuls modèles chargés. Un modèle absent est froid, ce qui ne veut pas dire
  « sans fenêtre ».

`/v1/models` d'Ollama ne porte que les ids : il rend un record entièrement
inconnu.

## Tri-état : « non reconnu » n'est pas « absent »

Chaque capacité vaut `true`, `false` ou `null` (inconnu). `false` ne se
déduit **que** d'une déclaration dont la forme est reconnue, c'est-à-dire
qui contient au moins un nom connu, qu'il ait un équivalent consommé
(`MODEL_CAP_ALIASES`) ou non (`MODEL_CAP_KNOWN_OTHER` : `completion`,
`embedding`…). Une forme inconnue, une liste vide ou un objet aux noms
étrangers rendent `null` partout.

La règle protège d'un défaut déjà payé. La première version de la sonde de
découverte ne lisait que la forme liste, et concluait « ce backend ne
déclare aucune capacité » alors qu'elle ne savait pas lire sa déclaration.
Dans l'application, le même défaut griserait la pièce jointe image d'un
modèle qui voit. La protection a une limite : elle
porte sur la déclaration entière, pas sur chaque nom. Si une déclaration
reconnue désigne la vision par un nom absent de la table, la vision sort
`false`. La table d'alias est donc un point de confiance : y ajouter un
alias dès qu'un backend en montre un nouveau.

## Les purs (`api.js`)

- `normalizeModelCaps(raw, positiveOnly)` : liste ou objet → `{vision,
  tools, thinking}` tri-état. `positiveOnly` sert à `/api/tags`.
- `extractModelContextMax(obj)` → `{value, key}` ou `null`. Il essaie
  d'abord les clés à plat (`MODEL_CONTEXT_FLAT_KEYS`), puis
  `<general.architecture>.context_length`, puis toute clé en
  `.context_length`. Il ne retient que des entiers strictement positifs.
- `modelPropsFromOpenAIModels(json)`, `modelPropsFromOllamaTags(json)` →
  `{id: record}`. `modelPropsFromOllamaShow(json)` → un record.
  `servedContextsFromOllamaPs(json)` → `{nom: tokens}`.
- Un **record** a la forme `{contextMax, contextSource, contextConfigured,
  caps}`. `contextSource` nomme l'endpoint et la clé lue
  (`models:max_context_length`, `tags:context_length`,
  `show:qwen35.context_length`) : c'est ce que l'inspecteur de contexte
  affichera.
- `mergeModelProps(base, over)` : ce que `over` sait remplace ce que `base`
  savait, et une inconnue de `over` n'efface jamais un connu. C'est ce qui
  combine `/api/tags` (en positif) et `/api/show` (qui fait autorité).

Les tests (`tests/test-api.js`) utilisent des réponses **réelles** élaguées
des deux backends. Seul `/api/ps` est reconstruit sur sa forme documentée,
parce qu'aucun modèle n'était chargé au relevé.

## Persistance

`fetchModelList` (api.js) rend `{ids, props}` depuis le **même** appel
`/models`. La réponse portait déjà tout, et on n'en gardait que `id`.
`fetchModels` reste la variante qui ne rend que les ids, pour la carte
serveur en édition. `loadServerModels` (ui.js) persiste les props à chaque
lecture réussie, dans la clé `miaou-model-props`. Le schéma et les règles de
fusion sont décrits dans `docs/storage.md`. `modelPropsFor(server, modelId)`
est le lecteur : il rend toujours un record, entièrement inconnu à défaut.

La règle de fusion (`mergeModelProps`) fait qu'une relecture n'efface jamais
ce qu'elle ne sait pas. C'est ce qui permet de lire `/v1/models` sur Ollama,
qui ne rend que des ids, sans perdre ce que `/api/show` avait appris.

## Chemin natif d'Ollama

`/v1/models` d'Ollama ne porte que des ids. Le reste est sur la racine
native, qu'on **dérive** de l'URL configurée en retirant `/v1`
(`ollamaNativeRoot`). Une URL qui ne finit pas par `/v1` ne se sonde pas. Le
code est dans ui.js, à côté de `loadServerModels` ; les purs et le fetch
borné (`fetchOllamaNative`, 15 s, qui rend `null` sur tout échec) sont dans
api.js.

**Qui est un Ollama.** À chaque chargement réussi de la liste,
`readOllamaNative` tente `GET /api/tags`. Une réponse de forme `{models: [...]}`
(`isOllamaTagsResponse`, liste vide comprise) désigne un Ollama. Tout le
reste vaut « pas un Ollama » : 404 d'une passerelle, refus CORS d'un Ollama
exposé sans `OLLAMA_ORIGINS`, panne. L'état est de **session**, par serveur et
par empreinte d'endpoint (`_ollamaNative`, comme `_modelsById`), et il est
reconsidéré à chaque chargement de la liste. Hors d'un Ollama reconnu, aucune
autre lecture native ne part, et surtout pas une sonde après chaque appel.
Coût assumé sur les autres backends : un `GET /api/tags` par chargement de
liste, que le navigateur journalise en console quand il rend 404.

**Quoi, quand.** Tout est non attendu par le chargement de la liste : la
liste, et le verdict de santé que `probeBackend` en tire, ne patientent pas
derrière ces appels.
- **Chargement de la liste** (démarrage, sonde de santé, réessai) :
  `/api/tags` en positif, `/api/ps` (un appel pour tous les modèles chargés),
  et `/api/show` du **seul modèle actif**, et pour le seul serveur actif.
  Ouvrir le menu des modèles charge les autres serveurs sans leur coûter de
  `/api/show`.
- **Changement de modèle** : `ensureActiveModelShown`, appelée en fin de
  `syncModelUI` parce que tout changement de modèle y passe. Elle lit
  `/api/show` du nouveau modèle actif s'il ne l'a pas été depuis la dernière
  lecture de la liste (`shown`, remis à zéro à chaque lecture). Mémoïsée,
  elle est sans effet au re-rendu : la lecture qui aboutit rappelle
  `syncModelUI`, qui trouve le modèle déjà lu.
- **Après un appel au modèle** (AF-2) : `noteModelCalled(url, model)`, appelée
  à la fin d'un appel réussi par les **deux seuls points réseau** vers
  `/chat/completions`, `silentCompletion` et `streamCompletion` — jamais chez
  leurs appelants. Le moteur vient de charger le modèle, donc `/api/ps` le
  liste. Bornes : rien si le modèle a déjà une mesure de cette session, au plus
  une lecture par (serveur, modèle) et par session (`psDone`), et un verrou de
  lecture en vol par serveur (`psBusy`) pour que titrage, résumé et chat
  finissant ensemble n'en déclenchent qu'une. Un Stop compte : le modèle a été
  chargé.
- **Glyphe de la fiche serveur** (`onRefreshApiCard`, main.js) : recharge la
  liste (par `probeBackend` pour le serveur actif, dont c'est aussi le verdict
  de santé), attend la lecture native qui suit (`e.native`), et pour une
  fiche non active lit `/api/show` de son modèle par défaut.

**Appariement des noms.** Ollama sert `llama3` comme `llama3:latest`. Les
lectures natives s'écrivent sous l'id **listé** par `/v1/models`, apparié sur
la forme complète des deux côtés (`ollamaFullModelName`, `alignOllamaNames`) ;
un nom natif sans id listé est ignoré. En lecture, `modelPropsEntry` retombe
sur la forme complète quand le nom exact manque : un modèle saisi `llama3`
retrouve ainsi le record de `llama3:latest`.

**Écriture.** `recordModelProps` superpose les records au persisté par
`mergeManyModelProps`, sans élaguer. Une mesure `/api/ps` est datée
(`servedRecords`) ; un modèle absent de `/api/ps` (froid) ne l'efface pas, et
seule une nouvelle mesure la remplace. Chaque écriture rafraîchit pilule,
inspecteur, marque de vision et sélecteur de raisonnement (`syncModelUI`), et
les fiches serveur, sauf une fiche en cours d'édition, qu'un re-rendu viderait
(`onModelPropsChanged`).

**Limite, dite franchement.** Redémarrer Ollama pour changer sa config
décharge tous les modèles, et aucune API n'expose `OLLAMA_CONTEXT_LENGTH` sans
charger le modèle. Au reload qui suit, MIAOU affiche la dernière mesure
persistée (« dernière mesure ») et la corrige après le premier appel au
modèle. Si Ollama recharge un modèle avec une autre fenêtre en cours de
session, la mesure reste figée jusqu'au reload ou au glyphe. Précharger le
modèle au démarrage mesurerait tout de suite, mais occupe de la VRAM et peut
en évincer un autre : écarté.

## Fenêtre de contexte : chaîne de précédence

Le pur `resolveContextWindow(record, userOverride, buildDefault,
sessionStart)` (storage.js) rend `{value, source, at}`. Les sources, de la
plus sûre à la plus théorique :

| `source`      | valeur                                                  |
|---------------|---------------------------------------------------------|
| `served-now`  | servie, lue sur `/api/ps` pendant cette session         |
| `configured`  | `num_ctx` du Modelfile (`/api/show`)                    |
| `served-last` | servie, dernière mesure d'une session antérieure        |
| `user`        | saisie pour ce modèle sur la fiche du serveur           |
| `declared`    | maximum déclaré (`/models`, `/api/tags`, `/api/show`)   |
| `build`       | `default_context_window` de `config.json`               |

Quelques justifications :
- **Une mesure n'est jamais écrasée par une saisie.** Sur Ollama, une
  saisie oubliée masquerait sinon une vraie mesure.
- **La saisie passe devant le maximum déclaré.** C'est le seul moyen de
  corriger une passerelle qui coupe plus bas qu'elle ne déclare, sur un
  backend où rien n'est jamais mesuré.
- **`num_ctx` du Modelfile passe devant une mesure persistée.** C'est la
  valeur qu'Ollama applique au chargement, avant `OLLAMA_CONTEXT_LENGTH`
  (mesuré : `num_ctx 65536` contre `OLLAMA_CONTEXT_LENGTH=32768`, `/api/ps`
  rend 65536). Elle est relue à chaque chargement de la liste, donc plus
  fraîche qu'une mesure d'une session antérieure. `OLLAMA_CONTEXT_LENGTH`,
  lui, n'est exposé par aucune API.
- **Une mesure date de la session courante** si son `at` est postérieur à
  `MODEL_PROPS_SESSION_START`, posé au chargement de la page. Le record
  porte la mesure dans `served: {value, at}`.

`contextWindowInfo(model, server?)` compose la chaîne pour le serveur actif
par défaut, et `contextWindowFor(model)` en rend la seule valeur. Côté
libellés (ui.js, purs) :
- `contextWindowSourceLabel` qualifie une valeur mesurée de « réelle », et
  une valeur annoncée ou saisie de « théorique » ;
- `formatContextWindowLine` est la ligne de l'inspecteur ;
- `contextWindowCardHint` est le hint du champ de la fiche serveur. Il est
  calculé sur la chaîne SANS saisie ni défaut de build, parce qu'il doit
  dire ce que devient une saisie face à ce que le serveur dit de lui-même :
  une mesure prime sur elle, un maximum déclaré lui cède. Il suit le modèle
  saisi sur la fiche, comme la pilule de vision.

## Vision et raisonnement déclarés

**Vision.** `resolveModelVision(declared, manualOff)` (storage.js, pur) :
- une capacité **déclarée** fait foi dans les deux sens, flag manuel compris.
  On ne force pas la vision contre une déclaration, ni ne la retire à un
  modèle déclaré voyant ;
- si elle est inconnue, le flag manuel « Sans vision » de la fiche serveur
  décide ;
- sinon, on envoie les images, comme avant le lot.

`modelVisionState(server, model)` compose les deux sources et rend
`{enabled, source}`. `serverModelVisionEnabled` en reste le prédicat unique
pour l'envoi (`dispatchSend`), la description de fichier et `files__read`.
Brancher la déclaration là, et non à chacun de ces sites d'appel, suffit à
les couvrir tous. Les caches réactifs (`_visionRejected`, sur un 400) restent
en filet.

Sur la fiche serveur, quand la vision est déclarée, la pilule « Sans
vision » cède la place à un libellé figé (« Lit les images » / « Ne lit pas
les images »). Elle reste dans le DOM et porte le flag manuel tel qu'il est
persisté : enregistrer la fiche ne le modifie donc pas.

**Marque de vision.** Un appareil photo apparaît dans le bouton de modèle du
composer (`#composer-model-vision`) et en queue de ligne du menu des modèles
(`ICON_CAMERA`), seulement pour `source === 'declared' && enabled`. Rien ne
s'affiche pour une vision inconnue. Pourquoi l'appareil photo et pas l'œil :
l'œil est déjà pris (aperçu des blocs html/svg, consultation dans les acks),
et le cadre-montagne est réservé aux images produites par MIAOU. Le bouton
de modèle n'existe que si le sélecteur est activé dans les réglages : la
marque n'est donc visible qu'avec lui. Quand elle est affichée, le budget de
caractères du libellé lui réserve sa place (`COMPOSER_MODEL_VISION_PX`).

**Raisonnement.** `reasoningEffortBlocked(url, model)` (api.js) est vrai si
l'endpoint a rejeté `reasoning_effort` pendant la session, ou si le serveur
actif déclare le modèle sans raisonnement. C'est le prédicat unique de
l'envoi (`streamCompletion`) et du sélecteur (`syncReasoningUI`, désormais
appelé en fin de `syncModelUI`). Bloqué, le sélecteur se masque **sans
toucher au niveau enregistré sur la conversation** : c'est l'envoi qui
s'abstient. L'ancien rendu remettait ce niveau à zéro et le persistait, ce
qui, une fois `syncReasoningUI` appelé depuis `syncModelUI`, effaçait le
niveau d'une conversation à sa simple ouverture si son modèle était
bloqué. La capacité déclarée ne pilote jamais
l'**affichage** du raisonnement, qui se détecte sur le delta (piège 14).

**Outils.** `tools: false` n'empêche rien : les outils partent quand même.
La capacité est seulement affichée dans l'inspecteur (`formatModelCapsLine`).

## Vérification

Le câblage DOM est hors de portée de QuickJS : la fiche serveur, la ligne de
l'inspecteur et le recalcul de la pilule depuis `syncModelUI`. Il est
vérifié par `.claude/skills/run-miaou/verify-model-context-window.mjs`
(backend `/models` stubé au schéma Mistral). Le script accepte
`VERIFY_DIST=<build>` pour être rejoué sur un build antérieur. Sur celui
d'avant la fenêtre par modèle, les contrôles 3 à 11 passent au rouge.

Le chemin natif d'Ollama est vérifié par `verify-model-ollama-native.mjs`,
avec un Ollama et une passerelle au schéma Mistral stubés : racine sans
`/v1`, un seul `/api/show` et pour le modèle actif saisi sans étiquette,
écriture sous l'id `:latest`, relecture de `/api/ps` après un échange et pas
après le second, `/api/show` au changement de modèle et pas au retour, glyphe
de la fiche, et rien d'autre que `/api/tags` vers la passerelle. Sur le build
d'avant l'étape, neuf contrôles sur onze passent au rouge. Les verify des
étapes précédentes stubent `/api/tags` en 404 depuis cette étape.

La vision et le raisonnement déclarés sont vérifiés par
`verify-model-capabilities.mjs`, qui couvre l'appareil photo (bouton et
menu), le libellé figé de la fiche, la ligne de capacités, le sélecteur de
raisonnement, et le corps réellement envoyé (`reasoning_effort` absent pour
un modèle déclaré sans raisonnement, malgré le défaut des réglages). Il
vérifie aussi que le niveau de raisonnement d'une conversation survit à un
passage par un modèle bloqué et à la réouverture après rechargement. Rejeu :
sur le build d'avant l'étape, les contrôles propres à la déclaration passent
au rouge. Sur une version qui remettait le niveau à zéro en masquant le
sélecteur, seul ce dernier contrôle tombe, et c'est lui qui l'a attrapée.
