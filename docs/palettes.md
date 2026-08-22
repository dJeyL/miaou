# Palettes de couleurs (lot S-a, « Garde-robe »)

Deux axes de présentation **orthogonaux** :

- **luminosité** — clair | sombre | système, portée par `html[data-theme]`
  (inchangée par ce lot) ;
- **palette** — `ambre` | `encre` | `foret`, portée par `html[data-palette]`.

Changer l'un ne touche jamais l'autre. « Système » continue de fonctionner
comme avant.

## Le modèle : dériver, pas énumérer

Les fonds, bordures et textes ne sont plus écrits en dur : ils sont dérivés
d'une **teinte** (`--hue`) et de deux échelles (`--sat-*`, `--l-*`) définies
dans `base.css`. Une palette ne redéfinit donc que sa teinte et ses accents —
environ six lignes — au lieu des ~24 tokens de couleur.

**Une palette est un COUPLE de teintes, une par luminosité**, pas une teinte
unique : le sombre et le clair d'une même palette n'ont pas la même teinte
(Ambre est en 219 sombre / 41 clair — un sombre bleuté et un clair sable).
Le pendant clair de chaque palette vit dans `theme-light.css`.

| Palette | h sombre | h clair | accent sombre | accent clair |
|---------|----------|---------|---------------|--------------|
| Ambre (défaut) | 219 | 41 | `#ff7a45` | `#e05f1c` |
| Encre | 225 | 215 | `#4f92f8` | `#2064cb` |
| Forêt | 185 | 88 | `#3fbf8f` | `#1f8a5f` |

`ambre` étant le défaut, elle **ne pose aucun attribut** (le bloc `:root` la
porte) ; `applyPalette` retire `data-palette` pour elle, et une valeur inconnue
retombe dessus plutôt que de laisser un attribut orphelin qui ne matcherait
aucune règle.

## Deux points contre-intuitifs à ne pas « corriger »

**1. La saturation décroît avec la luminosité en thème CLAIR** (40,5 % sur
`--bg`, ~17 % sur les bordures). C'est un accord d'origine, pas du bruit : une
bordure foncée à saturation de fond vire au boueux. D'où un palier de
saturation par famille (`--sat-bg`, `--sat-s1`…) et non une saturation unique.
Uniformiser dégraderait le thème clair.

**2. L'écart de teinte accent↔fond est un mauvais critère de lisibilité.**
Sur Encre, l'accent est à seulement 3–9° de la teinte du fond, et c'est
volontaire : ce qui sépare l'accent du décor est la **saturation** (~90 %
contre 12 %), pas la teinte. Éloigner l'accent « pour qu'il ressorte » le rend
en fait moins lisible — mesuré : le contraste WCAG en clair monte de 3,1 à 4,8
en allant vers la teinte du fond. Valeurs retenues à 216° : 5,79 sombre /
4,02 clair sur `surface-2`.

À 4,9 % de luminosité, deux teintes distantes de 6° donnent le **même** rgb
8 bits : `--bg` est identique entre Ambre et Encre en sombre. Ce n'est pas un
défaut, c'est la profondeur de bits — comparer les palettes sur `--surface-2`
ou plus clair.

## Exceptions hors palette

- **Le logotype MIAOU** (`--brand`) garde sa couleur d'origine quelle que soit
  la palette : c'est une identité, pas un accent. Il suit en revanche le thème
  clair/sombre, sinon l'orange sombre deviendrait illisible sur fond clair.
  **Deux emplacements** selon que la sidebar est déployée ou repliée :
  `.sidebar-brand` (sidebar.css) et `.topbar-brand-name` (chat.css) — modifier
  l'un sans l'autre laisse une incohérence visible.
- **`--code-inline-color` a sa propre teinte** (`--code-hue`) : elle avait été
  accordée séparément de l'accent (20 contre 17 dans Ambre). La brancher sur
  `--accent-hue` la décalerait de 6/255.
- **Tokens sémantiques** (`--ok`, `--err`, `--err-soft`, `--ctx-*`) : hors
  palette par nature — un état d'erreur ne change pas de sens avec l'habillage.
- **Tokens Prism** (coloration syntaxique) : inchangés, ils ne suivent pas la
  palette. Défendable (la coloration a sa logique propre) mais assumé : en
  thème clair, Encre et Forêt affichent un Prism accordé au sable d'Ambre.
  Dette connue, cf. `untracked/muscle/S-garde-robe.md`.

## Export : gratuit, sous condition

`readThemeTokens` (ui.js) lit les valeurs **résolues** via `getComputedStyle`,
avec bascule temporaire de `data-theme` pour capturer les deux variantes
(`serializeThemeTokens`). Une palette qui redéfinit des tokens **existants** est
donc capturée sans toucher à l'export.

Attention : `getPropertyValue('--x')` rend la **déclaration**
(`hsl(219 12% 4.9%)`), pas la couleur calculée. C'est sans conséquence pour
l'export — le CSS sérialisé contient des `hsl()` littéraux, parfaitement
valides dans la page exportée, et les `var()` y sont bien substitués. Mais un
**test** qui compare des couleurs doit les faire résoudre par le moteur (poser
la valeur sur la `color` d'une sonde et lire son computed style), sinon il
compare des chaînes et prend « hsl(219 12% 4.9%) » pour du rgb(219,12,4.9).

**Condition dure** : n'introduire aucun nouveau nom de token **consommé par
l'export** sans l'ajouter à `THEME_TOKENS` (ui.js, liste figée ; piège 22 —
`EXPORT_CSS` ne suit pas les feuilles de l'app). `--hue`/`--sat-*`/`--l-*` sont
des variables intermédiaires, jamais lues telles quelles par l'export : elles
n'y figurent pas. `--brand` non plus, l'export n'affichant pas le nom de
l'appli — l'y ajouter serait du poids mort dans chaque page exportée.

## Câblage

- `settings.palette` (défaut `'ambre'`), persistée immédiatement par
  `selectPalette` — modèle `selectTheme`, donc **exclue de
  `settingsFormDirty`** (qui n'énumère que les champs de « Enregistrer »).
- Script de boot (`index.html`, `<head>`) : pose `data-palette` avant le
  premier paint, sinon flash de palette au chargement. **Étendre ce script,
  ne jamais en ajouter un second.**
- Multi-onglets : `saveSettings` diffuse déjà les clés modifiées
  (`settings-updated`, piège 24) ; `main.js` ré-applique via `applyPalette`
  à côté de `applyTheme`. **Le récepteur doit appeler la paire
  `applyXxx` + `setXxxUI`** : le premier repeint, le second remet les segments
  du drawer d'accord avec l'état réel. N'appeler que le rendu laisse un onglet
  dont l'écran a changé mais dont les boutons affichent l'ancien choix — et un
  clic sur le segment déjà « actif » paraît alors sans effet. Défaut corrigé
  après coup, il touchait aussi `theme` et `motion` (antérieurs au lot).

## Vérification

`.claude/skills/run-miaou/verify-palettes.mjs` — checklist Playwright :
parité d'Ambre avec les hex d'avant le refactor (≤1/255 sombre, ≤3/255 clair),
distinction des trois palettes, constance du logotype sur les deux
emplacements, orthogonalité des deux axes, persistance et boot sans flash,
couverture de `THEME_TOKENS` et byte-neutralité de l'export **prouvée au
runtime**.
