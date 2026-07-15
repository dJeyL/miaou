---
name: Génération de diagrammes Mermaid
description: Règles obligatoires pour générer un diagramme mermaid valide dans MIAOU
---

Tu vas générer un bloc de code mermaid. Applique CES RÈGLES EXACTEMENT, sans
exception. Un diagramme qui viole une seule de ces règles ne s'affiche pas
(erreur de parse) ou affiche des caractères parasites à l'écran. Ce n'est pas
une question de style : c'est une syntaxe stricte.

## Règle 0 — Le type de diagramme (premier mot) doit exister. N'en invente JAMAIS un

Avant tout label, le premier mot non-commentaire du bloc DÉCLARE le type de
diagramme. Si ce mot-clé n'existe pas dans Mermaid, RIEN ne s'affiche : le parse
échoue immédiatement, avant même de regarder un seul nœud. C'est l'erreur la plus
coûteuse et la plus fréquente — un modèle croit qu'un type « logique » existe et
plaque dessus une syntaxe plausible mais entièrement fantôme.

N'utilise QUE l'un de ces types (liste FERMÉE — tout autre mot-clé est invalide) :

- `flowchart` (ou `graph`) — organigrammes, flux, arbres de décision
- `sequenceDiagram` — échanges chronologiques entre acteurs
- `stateDiagram-v2` — machines à états
- `classDiagram` — classes / relations objet
- `erDiagram` — entités-relations (modèle de données)
- `pie` — camembert (répartition en pourcentages)
- `xychart-beta` — **le SEUL** graphe à axes X/Y : barres ET courbes
- `gantt` — planning temporel
- `mindmap` — carte mentale

Tout mot-clé hors de cette liste est à considérer comme inexistant, même s'il
« sonne juste ». En particulier ces mots-clés n'existent PAS et cassent le
parse : `bar`, `barChart`, `barchart`, `histogram`, `lineChart`, `scatter`,
`plot`, `chart`, `graphBar`. Il n'y a **aucun** type dédié aux barres : les
graphes en barres passent obligatoirement par `xychart-beta` (voir Règle 0bis).

Si le type de données que tu veux représenter n'entre dans aucun de ces neuf
types, ne fabrique pas un type : choisis le plus proche, ou renonce au diagramme
et présente les données en tableau Markdown.

## Règle 0bis — Données quantitatives (barres / courbes) → `xychart-beta`, jamais autre chose

Pour tout graphe de valeurs numériques par catégorie (barres) ou par progression
(courbe), le seul type valide est `xychart-beta`. Sa syntaxe est stricte et ne
ressemble à aucune paire `clé: valeur` : les catégories forment un tableau sur
`x-axis`, les valeurs un tableau sur la même position, dans l'ordre.

- INVALIDE (types et syntaxe inventés) : `bar`, `barChart`, lignes `web: 11`,
  déclarations `x Lignes` / `y Domaine`, `barColor #1e90ff`.
- VALIDE :

```
xychart-beta
    title "Nombre de lignes par domaine"
    x-axis ["web-server", "db-pool", "auth", "cache", "security"]
    y-axis "Lignes"
    bar [11, 6, 6, 5, 3]
```

Le tableau de `x-axis` et le tableau de `bar` (ou `line`) doivent avoir le MÊME
nombre d'éléments, dans le MÊME ordre. Le titre et le libellé d'axe qui
contiennent un espace vont entre guillemets doubles. Pas de couleur en ligne
nue : la couleur relève du thème, pas de la syntaxe du diagramme.

## Règle 1 — Saut de ligne dans un label : `<br/>` UNIQUEMENT

INTERDIT d'écrire les deux caractères `\` puis `n` (backslash-n) dans un
label, même si tu penses que ça produit un saut de ligne. Mermaid ne
l'interprète PAS comme un saut de ligne. Ça reste affiché tel quel, ou ça
casse le parse.

- INVALIDE : `A[Ligne un\nLigne deux]`
- VALIDE : `A["Ligne un<br/>Ligne deux"]`

Aucune autre balise HTML n'est reconnue pour un saut de ligne. `<br>` sans
slash fermant : à éviter, utilise `<br/>`.

## Règle 2 — Un label avec caractère spécial → guillemets doubles autour de TOUT le label

Si un label contient une parenthèse `( )`, une accolade `{ }`, un deux-points
`:`, un point d'interrogation `?`, un point-virgule `;`, une esperluette `&`,
ou tout autre caractère qui n'est pas une lettre/chiffre/espace/tiret, entoure
la totalité du texte du label de guillemets doubles `"..."`.

- INVALIDE : `A[France vs Maroc (2-0)]`
- VALIDE : `A["France vs Maroc (2-0)"]`
- INVALIDE : `F{Type de fichier?}`
- VALIDE : `F{"Type de fichier ?"}`

Ceci s'applique À TOUS les types de nœuds : rectangles `[ ]`, losanges de
décision `{ }`, arrondis `( )`, cercles `(( ))`.

## Règle 3 — Jamais de crochets `[` `]` À L'INTÉRIEUR d'un label

Même si le label est entouré de guillemets doubles, un crochet interne casse
le parse : il ferme la forme du nœud prématurément, les guillemets ne le
neutralisent PAS. Reformule sans crochets — utilise des parenthèses ou un
tiret à la place.

- INVALIDE : `B["Message [attachment att-N]"]`
- VALIDE : `B["Message (attachment att-N)"]`
- VALIDE : `B["Message - attachment att-N"]`

## Règle 4 — Jamais de guillemets doubles À L'INTÉRIEUR d'un label déjà quoté

Deux guillemets doubles imbriqués cassent le parse, même si l'un des deux
ouvre/ferme le label. Reformule sans guillemets internes, ou utilise
l'entité `#quot;` à leur place.

- INVALIDE : `C["Demande : "Analyse les logs""]`
- VALIDE : `C["Demande : Analyse les logs"]`
- VALIDE (si tu dois vraiment garder les guillemets) : `C["Demande : #quot;Analyse les logs#quot;"]`

## Règle 5 — Pas de mise en forme HTML inline

`<b>`, `<i>`, `<em>`, `<strong>`, `<u>`, `<mark>`, `<small>` ne sont PAS
interprétés dans un label : ils s'affichent littéralement comme texte
(`<b>x</b>` apparaît tel quel dans le diagramme). Seul `<br/>` est reconnu
(règle 1). N'utilise aucune de ces balises. MIAOU rend les diagrammes avec
`htmlLabels: false` (labels en `<text>` SVG pur) : c'est pour ça qu'aucune
mise en forme HTML n'a d'effet, quelle que soit la version de mermaid.

## Règle 6 — Nom de fichier sur la fence

Pour un diagramme destiné à être identifiable/téléchargeable, ajoute
`filename=nom.mmd` sur la ligne d'ouverture de la fence, après le langage
mermaid et un espace : `mermaid filename=flux-auth.mmd`. Optionnel pour un
extrait illustratif court sans vocation de fichier. Ce nom sert aussi à
nommer les exports d'image (SVG/PNG) du diagramme dans MIAOU, extension
ajustée automatiquement.

## Checklist avant de produire le bloc final

Avant d'émettre le bloc mermaid, commence par le premier mot, puis relis CHAQUE
label que tu as écrit et vérifie dans l'ordre :

0. Le premier mot est-il un type de la liste fermée de la Règle 0 ? → sinon,
   c'est invalide : corrige le type (pour des barres/valeurs, `xychart-beta`).
1. Est-ce qu'il contient `\n` (backslash-n littéral) ? → remplace par `<br/>`.
2. Est-ce qu'il contient un caractère spécial (`( ) { } : ? ; &`) ? → entoure
   tout le label de guillemets doubles.
3. Est-ce qu'il contient un crochet `[` ou `]` ? → reformule sans crochets.
4. Est-ce qu'il contient un guillemet double interne ? → reformule sans
   guillemets, ou utilise `#quot;`.
5. Est-ce qu'il contient une balise HTML autre que `<br/>` ? → retire-la,
   garde le texte brut.

Si tu n'es pas sûr qu'un label respecte ces 5 points, simplifie le texte du
label plutôt que de prendre le risque : un diagramme qui s'affiche avec un
texte plus court vaut mieux qu'un diagramme cassé.
