---
name: Mermaid
description: Règles obligatoires pour générer un diagramme mermaid valide dans MIAOU
---

Tu vas générer un bloc de code mermaid. Applique CES RÈGLES EXACTEMENT, sans
exception. Un diagramme qui viole une seule de ces règles ne s'affiche pas
(erreur de parse) ou affiche des caractères parasites à l'écran. Ce n'est pas
une question de style : c'est une syntaxe stricte.

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

Avant d'émettre le bloc mermaid, relis CHAQUE label que tu as écrit et
vérifie dans l'ordre :

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
