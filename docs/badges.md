# Badges d'activité (lot T-2)

Deuxième sous-lot du lot T. T-1 a rendu possible qu'une génération survive à la
navigation ; T-2 la rend **perceptible**. Sans indicateur, une génération qui
continue en arrière-plan reste, du point de vue de l'utilisateur, une
conversation partie dans les ténèbres — c'est l'affordance minimale sans
laquelle T-1 est invisible.

## Deux états, une métaphore

| État | Sens | Taille | Opacité | Animation |
|------|------|--------|---------|-----------|
| `working` | une génération est en vol sur cette conversation | 5px | .45 (état bas de `waiter-pulse`) | `waiter-pulse`, 1s, infinie |
| `unread` | la génération a fini pendant qu'on regardait ailleurs | 7px | 1 | aucune |

Les deux états sont **mutuellement exclusifs dans le temps** (working → unread
→ rien) et se distinguent par le **mouvement**, jamais par la couleur : la
distinction survit donc aux daltonismes et au contraste faible.

**La pastille EST le `.waiter-dot`** du patienteur (chat.css) — pas « le même
genre de chose », littéralement le même objet, avec la même sémantique (« ça
travaille »), le même token `--accent` (qui suit palette ET thème sans un octet
de configuration), et la même keyframe. Une métaphore = un usage.
`.activity-dot` (sidebar.css) n'ajoute que ce qui diffère : les marges, le
`display: inline-block` (voir pièges ci-dessous) et les deux états.

Deux pistes ont été écartées, motifs consignés dans le brief : orange/vert
invariables (casse le lot S — une pastille orange fixe hurlerait dans Encre et
se confondrait avec l'accent dans Ambre) et couple de couleurs par palette (six
valeurs à maintenir, doublées par thème, plus une famille de tokens à étendre à
chaque nouvelle palette).

### Opacité de `working` : héritée, pas déclarée

`.activity-dot.working` ne déclare **pas** d'opacité. `waiter-pulse` la pilote
(état bas `.45`), et une déclaration statique serait de toute façon écrasée par
l'animation : elle mentirait au lecteur du CSS sans rien changer au rendu. Le
brief demandait `.55` ; réutiliser la keyframe telle quelle — ce que le même
brief demande explicitement, plutôt qu'écrire une jumelle — impose son `.45`.
L'écart est invisible et la contrainte forte l'emporte.

### Reduced-motion : aucune perte

Le kill-switch global (`html[data-motion="reduced"]`, base.css) fige
`animation-duration` à `0.01ms` — **jamais `none`** (doctrine lot N :
préserver le firing de `transitionend`). `waiter-pulse` ayant son état **bas**
à 0%/100%, la pastille working s'y fige exactement sur l'état voulu par la
spec. **Aucune règle locale n'est nécessaire** : working et unread restent
distincts par la taille ET l'opacité, le mouvement n'étant qu'un renfort.

Note de mesure : `getComputedStyle().animationDuration` normalise `0.01ms` en
`'1e-05s'` — comparer la valeur numérique, pas la chaîne.

## Prédicats — un seul, jamais réécrit

Même discipline que `spaceConvIds` (piège 18) : chaque question a UNE fonction.

- **`convBadgeState(convId)`** (main.js) — l'état d'une conversation. Ordre
  volontaire : `working` l'emporte sur `unread` (une conversation qui a du
  non-lu et qui regénère affiche l'activité en cours, information la plus
  fraîche).
- **`spaceBadgeState(spaceId)`** (main.js) — l'état d'un Espace, agrégé.
- **`aggregateBadgeState(excludeSpaceId)`** (main.js) — l'agrégat multi-Espaces.
- **`resolveActivityBadge(states)`** (utils.js, **pure et testée**) — la règle
  de résolution : `unread` présent → `'unread'` ; sinon `working` présent →
  `'working'` ; sinon `null`.

**Pas de troisième état visuel.** Une pastille « unread + working » serait un
vocabulaire supplémentaire, qui n'existerait qu'en agrégation. Le détail se lit
au dépliage, où chaque ligne porte son propre état.

## Le non-lu est VOLATILE

`_unreadConvs` (main.js) est un `Set` en mémoire, vidé au reload. **Aucune
persistance, aucune clé localStorage, aucun champ sur la conversation** — c'est
exactement la portée de survie des générations elles-mêmes (T-1 décision 1) :
une génération ne survit pas au reload, son « non lu » non plus.

- **Marquage** : dans `unregisterGeneration`, et seulement si
  `!genOwnsScreen(gen)` — une réponse qu'on a regardée arriver n'est pas « non
  lue ». Le prédicat d'écran reste celui de T-1, jamais un test réécrit. Il est
  évalué **après** le retrait du registre, pour que `convBadgeState` bascule sur
  `unread` et pas sur un `working` résiduel.
- **Effacement** : `markConvRead(id)` dans `openConversation`. **Ouvrir la
  conversation suffit** (décision de lot) — pas de sémantique de lecture par message
  ni de « bas du fil atteint » : MIAOU n'en a nulle part ailleurs, en introduire
  une ici serait disproportionné.

## Quatre surfaces

| Surface | Porteur | Portée | Synchronisation |
|---------|---------|--------|-----------------|
| Ligne de conversation | `convItemEl` (ui.js) | la conversation | `renderConvList()` reconstruit tout |
| Ligne d'Espace (menu déplié) | `renderSpaceMenu` (ui.js) | cet Espace | reconstruit à chaque ouverture |
| Sélecteur replié | `#space-select-btn` | **hors** Espace actif | `syncActivityBadges()` |
| Hamburger | `#sidebar-toggle` | **tout**, Espace actif compris | `syncActivityBadges()` |

Les deux premières sont reconstruites intégralement à chaque rendu : aucun état
DOM à préserver. Les deux dernières vivent en permanence dans le DOM, d'où
`syncActivityBadges()`, appelée par `syncSpaceUI()`.

Points d'appel : `registerGeneration` et `unregisterGeneration` (main.js)
appellent `renderConvList()` **et** `syncSpaceUI()` ; `openConversation` aussi,
après `markConvRead`.

`applyActivityBadge(el, state)` (ui.js) est **le seul point d'écriture DOM** des
quatre surfaces : l'apparence est entièrement portée par le CSS, ce qui garantit
qu'aucune surface ne dérive. Ne jamais concaténer les classes dans une template
string — ce serait un deuxième chemin.

### Le corollaire du dépliage

**Une seule règle** : la pastille apparaît sur chaque ligne d'Espace
effectivement concernée. « Déplacement » et « dédoublement » ne sont pas deux
traitements au choix, mais les deux apparences de cette règle unique selon le
nombre d'Espaces concernés.

Corollaire à ne pas rater : la pastille ne reste à côté du libellé de l'Espace
**courant** que si celui-ci a lui-même du working/unread. Sinon elle quitte
cette position au dépliage — elle n'y était que comme **agrégat de ce qui se
passe ailleurs**. L'état replié et l'état déplié répondent à deux questions
différentes (« y a-t-il de l'activité ailleurs ? » vs « où exactement ? ») ; le
libellé du courant n'est pas un porteur privilégié.

**Le masquage du déclencheur au dépliage est porté par le CSS**
(`.space-select:has(.space-menu.show)`), pas par un rappel de
`syncActivityBadges()` : la fermeture du menu a plusieurs points d'entrée
(`toggleSpaceMenu`, clic sur une ligne, clic extérieur, Échap…) et il suffirait
d'en oublier un pour figer la pastille dans un état faux. La classe `.show` du
menu est déjà la source de vérité — même ressort que le masquage du hamburger
sous `.app.sidebar-open`.

### Le hamburger agrège tout

Sidebar repliée, l'utilisateur ne voit ni la liste des conversations ni le
sélecteur : c'est le **seul** indicateur disponible. Le restreindre à l'ailleurs
laisserait muette une conversation active de l'Espace courant, précisément celle
qu'il ne peut pas voir.

Sidebar **ouverte**, la pastille s'efface — l'information est alors lisible à sa
source, la redonder au point d'entrée ferait clignoter deux objets pour un seul
fait. **Ce masquage est porté par le CSS** (`.app.sidebar-open`, même mécanique
que `.topbar-brand` et `.topbar-space-badge`), pas par un test JS : il n'existe
aucun événement pour observer `sidebar-open`, et laisser la cascade s'en charger
supprime le besoin de câbler la synchro dans `toggleSidebar` /
`closeSidebarMobile` / `closeSidebarViaEscape`.

**`topbar-space-badge` n'est PAS concerné** : il reste ce qu'il est (nom du
Space actif, masqué en default Space, brief C, UI).

## Extension du lot X-1 : un parent dont un agent travaille

`convBadgeState` répond `working` si la conversation génère **ou** si l'un de ses
agents génère (`hasWorkingAgent`, agents.js). Les agents n'ayant aucune surface
propre — ils sont exclus de la sidebar — la pastille de l'enfant est portée par
le parent, ce qui rend l'extension nécessaire et non redondante.

**Les deux agrégats dérivent désormais RÉELLEMENT de `convBadgeState`**, ce que
le commentaire de celui-ci affirmait depuis T-2 tout en itérant
`_activeGenerations` directement : vrai au sens de la sémantique, faux au sens de
l'appel. L'alignement a été tranché sur mesure et non sur principe — les deux
agrégats appelaient déjà `listAllConversations()` pour leur branche `unread`,
donc l'argument de coût qui aurait justifié l'écart ne tenait pas. Sans lui, le
`working` d'un parent aurait été invisible des agrégats, avec un résultat
fortuitement correct (l'enfant est lui-même dans le registre, dans le Space de
son parent) mais pour la mauvaise raison. Détail : `docs/agents.md`.

`unread` n'est **pas** étendu au parent : l'enfant qui finit le réveille, donc il
regénère et son `working` reprend seul.

## Compteur d'agents (lot T-2bis)

Les pastilles répondent **surface par surface** ; aucune ne répond « combien au
total ? ». La pilule `#agent-count` (`.topbar-right`, à côté de
`.bg-activity`) le fait.

**Ce n'est PAS une évolution de `.bg-activity`.** Celui-ci compte des tâches
techniques courtes et invisibles via `runBackgroundTask` — titrage, résumé,
connexion MCP, description de fichier, export HTML — et **aucune génération n'y
passe** (`dispatchSend` ne l'appelle jamais). Deux objets, deux natures, deux
pilules voisines ; les fusionner serait une erreur de catégorie. Leur
cohabitation est rare (les tâches de fond durent < 1 s).

**Le mot « agent » est un choix produit assumé** (Julien, 2026-08-23), contre
une réserve initiale de l'implémenteur. Deux raisons l'ont invalidée : `A` sera
le raccourci de la palette en T-3a (le terme est déjà engagé ailleurs, l'éviter
ici créerait deux vocabulaires pour un même objet), et l'autonomie est réelle
— avec `js__eval`, les outils MCP et les skills en autotrigger, une génération
enchaîne des tours d'outils sans intervention. « Agent » décrit ce qui se passe.

### Règle d'apparition — pure et testée

`resolveAgentCount(total, screenOwned)` (utils.js) :

```
total === 0                → 0   (rien)
total === 1 && screenOwned → 0   (redondant avec le composer en mode stop)
sinon                      → total
```

**Le nombre affiché est TOUJOURS le total**, jamais `total - 1` : afficher
« 2 agents » quand trois tournent serait un piège à confusion. La règle porte
sur le **seuil d'apparition**, pas sur le comptage. `formatAgentCountLabel(n)`
porte le singulier/pluriel, séparément, pour rester testable sans DOM.

### Câblage

`syncAgentCount()` (ui.js) dérive du **registre** (`_activeGenerations.size`) et
de `isGenerating(currentConvId)` — **jamais de `sending`**, qui est un reflet
d'écran depuis T-1 et bascule sur un simple changement de conversation
(piège 28).

Appelée depuis `syncSpaceUI()` (donc `registerGeneration`,
`unregisterGeneration`, `openConversation`) **et directement depuis
`resetToEmpty`** : partir à l'accueil fait passer une génération unique hors
écran — donc de masquée à affichée — sans que le Space change, `syncSpaceUI`
n'y étant pas appelé.

Le compte est **cross-Space** (comme le hamburger) : relève de l'exception
d'herméticité ci-dessous, mais n'expose qu'un **nombre** — strictement moins que
les pastilles, qui donnent le nom de l'Espace.

**La pastille de cette pilule est surdimensionnée à 7px avec halo**, contre
5px sans halo ailleurs. Même raisonnement que sur le hamburger : elle y est
seule de son espèce (aucune voisine pour donner l'échelle du couple
working/unread), mais avec un voisin immédiat très présent — le point de
connexion de `.model-pill` (7px, plein, `box-shadow`). À 5px / .45 elle
paraissait maigre par comparaison. La distinction working/unread n'a de toute
façon aucun objet ici : **le compteur ne compte que du working**, seule
l'animation porte le sens.

**Préfigure T-3** : la pilule est structurée pour recevoir un handler de clic
(ouverture du drawer des tâches de fond) sans réécriture. En T-2bis elle n'est
pas cliquable, il n'y a rien à ouvrir.

## Herméticité — deuxième exception sanctionnée au piège 18

Peupler les pastilles d'agrégation agrège l'état de **tous** les Espaces : une
lecture cross-Space, légitime (c'est le sens même de l'affordance) mais qui doit
être traitée comme telle. C'est la deuxième exception du projet, après le
submode « recherche de conversation » de la palette (lot F).

Portée strictement bornée : on expose l'**existence** d'une activité et le **nom
de l'Espace**, jamais un titre de conversation ni un contenu. Un Espace reste
hermétique quant à ce qu'il contient ; on ne divulgue que le fait qu'il
travaille. La source du working est `gen.spaceId` (figé au démarrage, T-1) ;
jamais un filtre `c.spaceId === x` réécrit hors de `spaceBadgeState` /
`aggregateBadgeState`.

`aggregateBadgeState` dérive du **registre** et de `listAllConversations()`, pas
d'une itération sur `loadSpaces()` : une conversation dont l'Espace a été
supprimé resterait sinon invisible du hamburger, qui doit être exhaustif.

## Pièges rencontrés

- **`display: inline-block` obligatoire sur `.activity-dot`.** `.waiter-dot`
  vit normalement en enfant flex (donc blockifié d'office). La pastille
  d'activité est aussi posée dans des contextes non-flex, où un `<span>` inline
  ignorerait `width`/`height` : elle disparaîtrait sans la moindre erreur.
- **Une pastille seule se juge sur son voisinage, pas dans l'absolu.** Deux
  fois le même constat : sur le hamburger (2,75px de rendu contre une icône de
  17px) et dans la pilule du compteur (5px/.45 contre le point de connexion
  7px plein à halo). Hors de la liste où working et unread se comparent l'un à
  l'autre, les valeurs nominales ne veulent plus rien dire — regarder ce qu'il
  y a à côté.
- **Le hamburger : caler sur l'icône, pas sur le bouton.** Le bouton fait 32px,
  son SVG 17px centré. Un ancrage sur le coin du bouton pose la pastille dans la
  marge, où elle flotte sans se rattacher à rien (mesuré, pas déduit).
- **Taille imposée sur le hamburger.** La pastille y est seule (aucune voisine
  pour donner l'échelle) et la version working, prise en plein `scale(.55)` de
  `waiter-pulse`, ne mesure que **2,75px de rendu** — une poussière contre
  l'icône. `getBoundingClientRect` inclut la transformation : mesurer, pas
  supposer. La distinction working/unread y reste portée par le mouvement et
  l'opacité.
- **Détourage.** `box-shadow: 0 0 0 2px var(--topbar-bg)` : la pastille
  chevauche l'icône, et sans séparation elle se lit comme un trait de plus du
  hamburger. C'est le détourage qui la fait exister, pas sa taille (l'agrandir
  la rendrait criarde).
- **`.model-opt` — zone morte (bug payé lot C).** Le handler de clic couvre
  **toute la ligne**, jamais un enfant `span` seul. La pastille est insérée dans
  la ligne sans handler propre : elle ne recrée pas le trou. Couvert par le
  verify.

## Vérification

- **Unitaire** — `resolveActivityBadge` : 10 tests (`tests/test-utils.js`),
  dont l'absence de troisième état et la tolérance aux valeurs nulles/inconnues.
  `resolveAgentCount` / `formatAgentCountLabel` : 10 tests (T-2bis), dont
  « affiche le total, jamais total-1 » et le singulier.
- **Playwright** — `.claude/skills/run-miaou/verify-badges.mjs`, stub SSE gaté
  par conversation (repris de `verify-generations.mjs`) : working sur la ligne,
  unread hors écran, absence d'unread sous les yeux, non-lu au niveau
  conversation, agrégation cross-Space repliée et dépliée, corollaire du
  dépliage, agrégation du hamburger et masquage CSS, apparence mesurée
  (tailles, opacités, keyframe, couleur commune), reduced-motion, zone morte.

Deux points de méthode payés en écrivant ce verify :

1. **`pickSpace`, pas `followSpace`.** `pickSpace` est le geste utilisateur de
   changement d'Espace (il vide le fil via `resetToEmpty`) ; `followSpace` est
   la variante « suivre une conversation déplacée », qui garde le fil ouvert.
   L'utiliser laisse `currentConvId` sur la conversation de l'autre Espace, donc
   `genOwnsScreen` vrai, donc aucun unread : le scénario ne teste rien.
2. **Vérifier le déclencheur PENDANT que le menu est ouvert**, pas seulement les
   lignes du menu. La première version du verify lisait l'état des lignes et en
   concluait que le corollaire du dépliage tenait — alors que la pastille d'agrégat
   restait affichée à côté du libellé du courant, où elle se lit à tort comme
   SON état. Trou signalé par Julien sur capture (2026-08-23) ; deux assertions
   ajoutées (déclencheur masqué menu ouvert, revenu menu fermé), régression
   réinjectée pour les valider.
3. **Il faut un cas où « tout » et « ailleurs » divergent.** La régression
   « sélecteur replié qui n'exclut plus l'Espace actif » passait initialement
   inaperçue : aucun scénario ne construisait le cas « activité DANS l'Espace
   courant, rien ailleurs ». Ajouté depuis, et vérifié en réinjectant la
   régression.

Toutes les régressions injectées (unread ignorant l'écran, priorité inversée
dans `resolveActivityBadge`, non-lu retiré, exclusion supprimée) sont bien vues.

## Non-goals (T-2)

- Pas de compteur de messages non lus (un état binaire suffit).
- Pas de navigation directe vers une conversation d'un autre Espace en un geste
  — cliquer un Espace bascule, comme aujourd'hui (T-3).
- Pas de toast ni de notification active (T-4).
- Pas de son.
