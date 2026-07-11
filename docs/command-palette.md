# Palette de commandes (lot F)

Overlay Ctrl/Cmd+K : filtrage à la frappe d'une liste d'actions, navigation
clavier complète, sous-modes. Détail d'implémentation ; lire avant de toucher au
registre, aux sous-modes, ou à l'intégration clavier.

## Vue d'ensemble

- **Ouverture** : Ctrl+K (Windows/Linux) / Cmd+K (macOS). Le raccourci est un
  listener global unique (`document.addEventListener('keydown')`, ui.js, à côté
  de la cascade Escape). `preventDefault` couvre la barre de recherche du
  navigateur (Firefox). Ignoré si Alt ou Shift est aussi enfoncé. Ré-appuyer
  ferme (toggle).
- **Overlay** : `#cmdk-overlay` (index.html) = backdrop + boîte centrée (input
  `#cmdk-input` + liste `#cmdk-list` + `#cmdk-empty`). `hidden` par défaut. Ce
  n'est **pas** un `.drawer` latéral : section CSS dédiée `src/css/palette.css`
  (ajoutée à `CSS_ORDER` après `tools.css`, avant `responsive.css`).
- **Navigation** : ↑/↓ (borné, wrap), Entrée (lance la sélection), clic
  (`mousedown` + `preventDefault` pour ne pas perdre le focus de l'input),
  Échap (recule d'un sous-mode, sinon ferme). Focus piégé sur l'input ; à la
  fermeture, focus rendu au composer (`#composer-text`).

## Registre déclaratif (`COMMANDS`, ui.js)

Un tableau d'entrées `{ id, key?, label, keywords[], hint?, enabled?, run() }`.
**Ajouter une commande = ajouter une entrée**, aucun code de palette touché.

- `run()` : l'action. Appelle une fonction globale existante (contrainte
  inline-handler du projet — toutes les cibles sont des `function` globales) ou
  entre dans un sous-mode via `enterCmdkSubmode(mode)`.
- `enabled()` (optionnel) : masque l'entrée hors contexte (liste courte). Ex.
  export → `!!currentConvId` ; switch model → `_modelsCache` non vide ; invoke
  skill → `listEnabledSkills().length` ; switch space → `loadSpaces().length > 1`.
- `key` (optionnel) : lettre de raccourci direct (cf. section « Raccourcis »).
  Affichée en badge à GAUCHE de la ligne (`.cmdk-item-key`). Doit être unique
  entre commandes.
- `hint` (optionnel) : annotation à droite (`✓` dans les sous-modes).
- `keywords[]` : matchés par `scoreCommand` en plus du label (synonymes fr/en).

## Raccourcis par commande (mode raccourci vs filtre)

Chaque commande racine porte une `key`. La palette a deux états en mode racine,
distingués visuellement et par placeholder :

- **Mode raccourci** (défaut à l'ouverture, champ vide) : une lettre lance
  DIRECTEMENT la commande correspondante (`cmdkKeyCommand`, `enabled()` réévalué
  à la frappe). Les badges de touche sont teintés orange (`.cmdk-list.cmdk-
  shortcuts`, `color-mix` sur `--accent`). Placeholder : « Taper un raccourci… ».
- **Mode filtre** : taper **Espace** (champ vide) l'AVALE (`preventDefault`,
  champ reste vide) et arme `_cmdkFilterArmed` → les lettres filtrent désormais
  la liste au lieu de lancer un raccourci. Badges neutres. Placeholder :
  « Filtrer les commandes… ». **Réarmement** : vider le champ repasse en mode
  raccourci (invariant « champ vide = raccourcis », Espace le contourne à chaque
  fois). Escape désarme d'abord (retour raccourci) avant de fermer.

Raison du design (décision Julien 2026-07-11) : « r » est ambigu — raccourci
« Résumés » ou début de filtre « réglages » ? L'Espace initial désambiguïse
sans réserver de modificateur (les Ctrl/Cmd+lettre directs se heurtent aux
raccourcis navigateur N/T/W/F/S/P). Grille des touches : cf. `src/help.md`
topic `interface` (source user-facing). Les touches n'ont PAS à éviter les
réservations navigateur : ce sont des frappes simples APRÈS l'ouverture par
Ctrl/Cmd+K, pas des raccourcis globaux.

Les deux bascules ont une commande dédiée plutôt qu'un appel direct au handler :

- **Thème** (`toggleThemeLightDark`) : alterne `light`↔`dark` via `selectTheme`
  (ignore `auto` — on force une valeur explicite). `selectTheme` persiste seul.
- **Coloration** (`toggleHighlightFromPalette`) : `onToggleHighlight()` **lit la
  checkbox DOM** (`#set-highlight`) et serait un no-op depuis la palette ; on
  inverse d'abord `checked`, puis on délègue le re-render à `onToggleHighlight`.

## Sous-modes (`_cmdkMode`)

Machine à états légère : `'root' | 'model' | 'skill' | 'conv' | 'space'`. Entrer
un sous-mode vide l'input, change le placeholder (`CMDK_PLACEHOLDERS`) et rend la
liste dédiée. Échap (`closeCommandPaletteViaEscape`) revient à `root` avant de
fermer. `cmdkModeItems(query)` route selon `_cmdkMode` et renvoie des items
`{ label, note?, hint?, run() }` :

- **model** : `_modelsCache` (peut être vide → l'entrée racine est `enabled`-gated).
  Pick → `pickComposerModel` (override conversation, même chemin que le sélecteur
  composer). `✓` sur le modèle actif (`activeModel`).
- **skill** : `matchSkillCompletions(query)`. Pick → `insertSkillIntoComposer`
  (insère `/slug ` dans le composer + focus + `onComposerInput`). **N'invoque
  jamais directement** : l'invocation reste au composer (chemin slash-skill
  unique, `docs/skills.md`).
- **space** : `loadSpaces()`. Pick → `pickSpace`. `✓` sur le Space actif.
- **conv** : voir ci-dessous.

## Sous-mode « recherche de conversation » — percée cross-Space assumée

**Décision Julien 2026-07-11.** Contrairement à la recherche sidebar (scopée au
Space actif, `spaceConvIds`), le sous-mode conversation de la palette est
**volontairement cross-Space** — c'est la SEULE voie qui perce l'herméticité
(`CLAUDE.md` piège 18, exception sanctionnée).

`cmdkConvItems(query)` (ui.js) :

1. **Filtrage** : réutilise le prédicat de la sidebar `searchConversations(q)`
   (titre / résumé / contenu ≥ 3 car.) appliqué à `listAllConversations()`
   (**tous** les Spaces, pas `spaceConvIds`).
2. **Score** local léger : titre inclut la requête → 3, sinon → 1. Suffisant
   pour départager dans un groupe de Space (le classement inter-Space est imposé
   par l'étape 3, pas par le score).
3. **Tri** : `rankConvResults(scored, getActiveSpaceId())` (utils.js, pure,
   testée) — clef à deux niveaux : **Space actif d'abord** (même à score
   inférieur), puis score décroissant, puis ordre stable.
4. **Annotation** : chaque ligne d'un autre Space porte le nom de son Space
   (`note`, rendu en `textContent`). Les lignes du Space actif ne sont pas
   annotées.
5. **Pick** : si la conversation est dans un autre Space, **suivre** ce Space
   (`followSpace`) *avant* `selectConv` — jamais afficher un fil hors du Space
   actif.

## Fonctions pures (utils.js, testées QuickJS)

- `scoreCommand(queryTokens, cmd)` — substring + word-boundary sur `label` +
  `keywords`. Frontière de mot du label +3 ; substring label +2 ; keyword exact/
  préfixe +2 ; substring keyword +1. Requête vide → 0.
- `filterCommands(commands, query)` — tokenize, score, garde > 0, tri stable
  score desc. Requête vide → liste inchangée (ordre du registre). **N'évalue pas
  `enabled()`** (le filtrage de disponibilité est fait en amont, impur).
- `rankConvResults(results, activeSpaceId)` — cf. sous-mode conv, étape 3.

Tests : `tests/test-utils.js` (`scoreCommand`, `filterCommands`,
`rankConvResults`).

## Rendu

`renderCommandList(query)` construit la liste par `createElement` +
`textContent` — **jamais `innerHTML`** : les labels contiennent des données
utilisateur (titres de conversation, noms d'espace). Doctrine `textContent`
du projet.

## Intégration Escape (ordre)

`closeCommandPaletteViaEscape()` est branché **en tête** de la cascade Escape
(ui.js), avant la lightbox : Échap recule d'un sous-mode (ou désarme le filtrage),
sinon ferme la palette. Aucune autre entrée de la cascade n'est modifiée.

## Non-goals v1

Pas de commandes définies par l'utilisateur, pas d'historique/récents. **Ouverture**
par Ctrl/Cmd+K seul (pas d'alias global Ctrl+Shift+P). Les raccourcis PAR COMMANDE
(section « Raccourcis ») sont des frappes simples APRÈS ouverture, pas des
raccourcis globaux — ils n'étendent pas la surface de collision navigateur.
