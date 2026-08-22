# Lots de fontes (lot S-b, « Garde-robe »)

Troisième axe de présentation, orthogonal aux deux autres :

- **luminosité** — `html[data-theme]` (clair | sombre | système) ;
- **palette** — `html[data-palette]` (`docs/palettes.md`) ;
- **fontes** — `html[data-fonts]` : `graphite` | `atelier` | `chaleur`.

Les trois sont indépendants : changer l'un n'affecte jamais les autres.

## Un lot = une PAIRE

Sans et mono vont ensemble, comme les deux teintes d'une palette. C'est un
choix d'accord : une mono trop large sous une sans étroite déséquilibre les
blocs de code, une différence de hauteur d'x crée une rupture de couleur
typographique. Décision Julien : **lot appairé**, pas deux axes séparés — trois
apparences à vérifier au lieu de neuf, et rien n'empêche deux lots de partager
une mono si besoin.

| Lot | Sans | Mono |
|-----|------|------|
| Graphite (défaut) | Hanken Grotesk | JetBrains Mono |
| Atelier | Source Sans 3 | Source Code Pro |
| Chaleur | Figtree | Fira Code |

`graphite` étant le défaut, il **ne pose aucun attribut** (le bloc `:root` le
porte) ; `applyFonts` retire `data-fonts` pour lui, et une valeur inconnue
retombe dessus — même doctrine que la palette `ambre`.

Le lot par défaut s'appelle « Graphite » et non « Grotesque » : en français le
mot ne dit plus le terme typographique, il dit « ridicule » (arbitrage Julien).

## Chargement : `<link>` en tête, `display=block`, préchargement des lots

Trois mécanismes, chacun réglant un défaut mesuré (bug remonté par Julien : un
saut de police au chargement).

**1. Un `<link>` dans le `<head>` d'`index.html`, pas un `@import` dans le CSS.**
Un `@import` est bloquant *en cascade* : le navigateur ne découvre les URLs des
`.woff2` qu'après avoir téléchargé la feuille Google — mesuré à **+401 ms**
contre +253 ms avec le `<link>`. Deux `preconnect` (googleapis et gstatic,
ce dernier avec `crossorigin`) ouvrent les connexions avant même de connaître
les URLs, les fichiers de fonte venant d'un autre domaine que la feuille.

**2. `display=block`, pas `swap`.** `swap` demande explicitement d'afficher un
repli système puis de permuter — c'est-à-dire de produire le saut. `block`
masque le texte pendant la période de blocage, donc aucun repli n'est jamais
peint.

**3. `prefetchFontLots()` (ui.js), appelé à l'init.** Le `<link>` déclare les six
`@font-face`, mais un navigateur ne télécharge un `.woff2` que lorsqu'un glyphe
le réclame : les familles des lots **inactifs** n'étaient donc pas chargées, et
basculer de lot déclenchait deux fetchs et un saut. `document.fonts.load()` les
force sans rien rendre, **pendant que l'overlay de boot masque encore l'écran**
(plancher 1,8 s) — le coût est invisible et toute bascule ultérieure est
instantanée. Un poids = un fichier : les graisses 400 et 500/600 sont chargées
séparément. Silencieux par construction (préchargement opportuniste) : hors
ligne, on retombe sur le comportement d'avant.

Mesuré après correction, sur réseau lent (300 kb/s, 200 ms de latence) : la
police du lot actif est celle rendue **dès le premier paint**, aucun repli
système n'apparaît, et changer de lot génère **zéro requête**.

**Ajouter un lot** = ajouter ses familles au `<link>` du `<head>` **et** à
`FONT_LOT_FAMILIES` (ui.js). Une famille listée dans l'un mais pas l'autre ne
se chargerait jamais, ou ne serait jamais préchargée.

## Export : rien à faire (statu quo vérifié)

`--sans` et `--mono` sont **déjà** dans `THEME_TOKENS` (ui.js), donc l'export
capture les piles de polices du lot actif sans travail supplémentaire.

En revanche l'export **ne charge aucun fichier de fonte** — ni avant ce lot, ni
après. Une page exportée retombe sur `system-ui` / `Consolas`. Ce n'est pas une
régression introduite ici : c'était déjà le cas avec Hanken Grotesk. Statu quo
assumé (arbitrage Julien), pour deux raisons : un lien Google Fonts rendrait
l'export dépendant du réseau (contraire à l'esprit « page autonome », et
inopérant en visionneuse type Quick Look) ; des fontes en base64 alourdiraient
chaque export de 100–150 Ko, souvent plus que le contenu lui-même.

## Ce qu'une nouvelle mono doit respecter

`--mono` n'est pas décorative dans MIAOU : elle porte les blocs de code, la
sortie Prism, les traces d'acks et **les nombres tabulaires de l'inspecteur de
contexte**. Une famille candidate doit donc :

- fournir les graisses 400 et 500 (utilisées telles quelles) ;
- être à chasse fixe et honorer `font-variant-numeric: tabular-nums`, sinon les
  colonnes de l'inspecteur se désalignent. Le verify le teste en mesurant deux
  chaînes de chiffres différents mais de même longueur.

## Câblage

- `settings.fonts` (défaut `'graphite'`), persistée immédiatement par
  `selectFonts` — modèle `selectTheme`, donc **exclue de `settingsFormDirty`**.
- Multi-onglets : `saveSettings` diffuse les clés modifiées
  (`settings-updated`, piège 24) ; `main.js` ré-applique via la paire
  `applyFonts` + `setFontsUI` — rendu ET segments du drawer (cf.
  `docs/palettes.md`, même règle pour les quatre réglages d'apparence).

## Vérification

`.claude/skills/run-miaou/verify-fonts.mjs` — application de chaque paire sur
le DOM réel, **chargement effectif des six familles** via `document.fonts.check`
(une famille absente retomberait en silence sur `system-ui` : le test le
détecte), orthogonalité des trois axes, persistance et boot, couverture export,
et alignement des chiffres tabulaires.
