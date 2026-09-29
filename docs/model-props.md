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
`loadServerModels` (ui.js) persiste les props à chaque
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
- `contextWindowCardHint` est le hint du champ « Fenêtre de contexte » du
  panneau de chaque ligne du tableau des modèles. Il est calculé sur la
  chaîne SANS saisie ni défaut de build, parce qu'il doit dire ce que devient
  une saisie face à ce que le serveur dit de lui-même : une mesure prime sur
  elle, un maximum déclaré lui cède.

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

Dans le panneau d'une ligne du tableau des modèles, quand la vision est
déclarée, le choix « Activée / Sans vision » cède la place à un libellé figé
(« Lit les images » / « Ne lit pas les images ») : le flag manuel n'a alors
aucun effet, et rien ne l'écrit.

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

## Catalogue de modèles (fiche serveur)

La partie VUE de chaque fiche serveur porte un tableau repliable,
« Modèles (N) · k au menu » (`buildApiCatalogue`, ui.js). Il remplace les champs
« Modèle par défaut », « Vision » et « Fenêtre de contexte » du formulaire, qui
ne sert plus qu'au nom, à l'URL, à la clef, à la disponibilité et à l'ordre de
l'inspecteur. Une fiche neuve n'a pas
de tableau avant son premier enregistrement : il faut une URL pour lister.

**Ce qu'il montre.** Une ligne par entrée de `serverModelEntries`, dans l'ordre
de `modelTableOrder` (défaut, affichés, masqués ; filet pointillé avant les
masqués, atténués). Par ligne : le défaut (bouton rond), le nom et sa marque
(« ajouté à la main », « absent de la liste »), trois capacités tri-état
(appareil photo, clé, bulle de pensée ; « ? » pour une inconnue, appareil
barré pour un « Sans vision » réglé à la main), la fenêtre, la case « Menu »
(cochée et grisée pour le défaut, grisée pour un défaut absent) et le glyphe
« barres », qui ouvre les statistiques filtrées sur le serveur ET le modèle
(`openUsageStats({serverId, model})`). La fenêtre est la valeur résolue par
`resolveContextWindow` avec un défaut de build à 0 : le tableau dit ce qu'on
sait de CE modèle, « ? » sinon, jamais le repli commun. Forme compacte par
`formatContextWindowCompact` (puissances de 1024), valeur exacte et source en
infobulle, saisie en couleur de texte pleine. Au-delà de dix lignes, un champ
filtre sur le nom du modèle (`modelFilterMatches`, le serveur étant celui de la
fiche). La liste vient du cache de session (`_modelsById`) ; en erreur, le
tableau reste affiché avec les modèles ajoutés à la main et un « Réessayer ».

**Dépli.** Tout tableau arrive replié : une liste de quarante modèles dépliée
d'office noierait le drawer. Le titre porte le compte dès que la liste est en
cache (celle du serveur actif l'est dès le démarrage). Déplier un tableau dont
la liste n'est pas chargée la charge (`apiCatalogueEnsureList`) : c'est le seul
chemin qui charge la liste d'un serveur mis de côté, que `loadAllServerModels`
ignore. L'état déplié tient pour la session, pas au-delà.

**Gestes immédiats** (`onApiModel*`, main.js), tous par
`applyApiServerModelsPatch` : relecture de l'enregistrement frais
(`getApiServer`) et écriture dans la foulée, sans await entre les deux, puis
re-rendu du seul catalogue de la fiche (`refreshApiCatalogue`), du libellé de
connexion et du composer. Après un geste, les lignes qui changent de place
glissent vers la nouvelle (`apiCatalogueSlideRows`, FLIP par l'API Web
Animations, 180 ms), sauf sous le réglage « Animations » coupé
(`motionReduced`) ; la frappe dans le filtre et les re-rendus complets ne
s'animent pas. Les gestes sont des purs de storage.js qui rendent
les champs à écrire, un refus, ou null :
- défaut : écrit `model` ; choisir un masqué le rend visible, l'ancien défaut
  reprend l'état que dit sa liste d'exceptions ;
- case « Menu » : `toggleModelVisibility` bascule l'appartenance aux
  exceptions du mode courant ;
- « Tout afficher » / « Tout masquer » : changent le mode ET vident les
  exceptions, d'où un bouton armé (clic de confirmation) ;
- ajout à la main (`addHandcraftedModel`) : refusé si le nom est déjà une
  ligne, en le nommant (un défaut absent peut être ajouté) ; en mode « tout
  masquer », le modèle est inscrit dans les exceptions pour arriver au menu, et
  en mode « tout afficher » une ancienne exception ne le masque pas ;
- retrait (`removeHandcraftedModel`) : sort aussi le nom des exceptions ; sur
  le modèle par défaut, refus qui dit de cocher d'abord un autre défaut, sans
  armer le bouton.

**Composer et palette.** Le menu du composer et la palette passent par le même
pur, `modelMenuChoices` (storage.js) : par serveur sélectionnable,
`modelMenuOrder` sur `serverModelEntries`, filtré par `modelFilterMatches` sur
le nom du modèle OU du serveur. Le modèle actif de la conversation est passé en
`pinnedModel` pour le seul serveur actif : masqué, il reste proposé. Au
composer, le défaut vient en tête de son groupe, marqué « défaut » en accent ;
le modèle masqué montré est marqué « masqué » (couleur d'attente), un modèle
ajouté à la main « à la main » ; les marques sont en texte. Un défaut absent de
la liste n'est pas proposé. Une liste en erreur ou en chargement laisse ses
modèles ajoutés à la main sous la note d'état. La visibilité du sélecteur
(`syncModelUI`) compte ce que le serveur actif propose, modèles à la main
compris et masqués exclus.

Le champ de filtre du composer est toujours visible, hors de la zone qui
défile (`composerModelMenuSkeleton`), et reçoit le focus à l'ouverture ; il
repart vide à chaque ouverture. ↑ ↓ déplacent la ligne désignée (classe `kb`,
partie de la ligne en usage), Entrée la choisit. Échap vide d'abord le filtre,
puis ferme le menu et rend le focus au bouton : un niveau par pression, consommé
par le champ, donc invisible à la cascade globale. Les re-rendus asynchrones
(listes des autres serveurs, réessai) ne réécrivent que la liste. Ce menu
devient visible sans transition de `visibility` (composer.css) : pendant la
transition héritée de `.model-menu`, il reste `hidden` et refuse le focus.

**Panneau de ligne.** Le chevron de chaque ligne déplie un panneau
(`buildApiModelPanel`), plusieurs pouvant être ouverts à la fois :
- vision : choix « Activée / Sans vision » (`setModelVisionOff`), seulement
  quand le serveur ne déclare pas la vision, un libellé figé sinon ;
- fenêtre saisie (`setModelContextWindow` : un entier strictement positif la
  pose, tout le reste la retire), appliquée au bouton « Appliquer » ou à
  Entrée, JAMAIS au blur ; le brouillon est tenu dans l'état de vue et le hint
  est `contextWindowCardHint` ;
- « Lire les propriétés » : `/api/show` de ce seul modèle
  (`readOllamaShowOnDemand`, qui relit même si ce modèle l'a déjà été depuis
  la dernière lecture de liste), offert seulement sur un serveur reconnu comme
  Ollama (`ollamaRecognized`) et pas sur un défaut absent ; persisté comme
  toute lecture native, puis `onModelPropsChanged`. Un échec se dit sous le
  bouton ;
- « Retirer », pour un modèle ajouté à la main.

Ces deux réglages ont quitté le formulaire de la fiche, qui ne règle plus
aucun modèle : `onSaveApiCard` reprend `model`, `vision` et `contextWindows`
de l'enregistrement frais.

**État de vue hors du DOM.** `_apiCatalogueView` (ui.js), par serveur : déplié,
filtre, lignes ouvertes, bouton armé, brouillons d'ajout et de fenêtre, lectures
en cours, refus affiché. La liste
des fiches est réécrite en entier par `renderApiServers` (gestes de fiche,
lecture native via `onModelPropsChanged`, synchro multi-onglets) : cet état y
survit, et le champ qui avait le focus le retrouve avec son curseur (clé
`data-cat-focus`, `apiCatalogueFocusSnapshot` / `apiCatalogueFocusRestore`),
de même que le défilement du drawer. L'armement vit dans cet état et non sur le
nœud (à la différence d'`armThenRun`), pour la même raison. Aucun champ du
tableau n'écrit au blur : un re-rendu qui retire un champ focalisé ne peut donc
pas enregistrer un brouillon.

## Vérification

Le câblage DOM est hors de portée de QuickJS : le panneau de ligne du tableau
des modèles, la ligne de l'inspecteur et le recalcul de la pilule depuis
`syncModelUI`. Il couvre aussi le brouillon de fenêtre quitté sans valider,
qui n'écrit rien même après un re-rendu complet de la liste. Il est
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
menu), le libellé figé du panneau de ligne et l'appareil barré d'un « Sans
vision » manuel, la ligne de capacités, le sélecteur de
raisonnement, et le corps réellement envoyé (`reasoning_effort` absent pour
un modèle déclaré sans raisonnement, malgré le défaut des réglages). Il
vérifie aussi que le niveau de raisonnement d'une conversation survit à un
passage par un modèle bloqué et à la réouverture après rechargement. Rejeu :
sur le build d'avant l'étape, les contrôles propres à la déclaration passent
au rouge. Sur une version qui remettait le niveau à zéro en masquant le
sélecteur, seul ce dernier contrôle tombe, et c'est lui qui l'a attrapée.

Le catalogue de modèles est vérifié par `verify-model-catalogue.mjs` : trois
serveurs stubés (un Ollama reconnu, un agrégateur en mode « tout masquer », un
serveur mis de côté dont le défaut est absent de sa liste). Il couvre le dépli
(tout replié à l'ouverture, liste chargée au dépli), le contenu des lignes,
chaque geste lu dans le store (premier clic d'un bouton armé sans écriture,
armement qui survit au re-rendu, refus du retrait du défaut), le panneau
(vision, fenêtre à Entrée, `/api/show` d'une ligne relu à chaque clic et absent
hors d'un Ollama), l'état de vue après un re-rendu complet et après l'écriture
d'un SECOND onglet (brouillon de fenêtre focalisé ni écrit ni perdu), la reprise
de l'enregistrement frais par le formulaire, le menu du composer au clavier
(filtre focalisé, re-rendu qui ne touche pas au champ, Échap en deux temps),
la palette et la visibilité du sélecteur. Rejeu : rouge sur le build d'avant le
catalogue ; rouge aussi sous chacune de ces régressions injectées, la fenêtre
écrite au blur, la restauration du focus retirée, Échap non consommé par le
filtre, et la palette qui liste sans le prédicat.

Ce qu'il ne couvre pas : l'écriture d'un pair re-rend toute la liste des fiches
et referme un formulaire de fiche ouvert (comportement antérieur au catalogue,
non traité) ; le contrôle de reprise de l'enregistrement frais écrit donc dans
le store sans broadcast, dans l'onglet même.
