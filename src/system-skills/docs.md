---
name: Ouverture de documents
description: Comment lire un document joint (PDF, Excel, Word, PowerPoint, archive zip) — quel outil, quel selector, quand sortir en ressource
---

Tu as décidé d'ouvrir un document joint. Voici comment t'y prendre, format par
format.

## Le geste, dans tous les cas

`miaou__docs__list` **d'abord**, quel que soit le format. Ce qu'il rend est
exactement ce que tu peux demander ensuite : les unités qu'il nomme sont celles
que `miaou__docs__read` accepte en selector, et les chemins de membres qu'il
liste sont ceux que `miaou__docs__extract` accepte. N'invente jamais un selector
ni un chemin — lis-le dans le listing.

Tu n'as pas à connaître le format à l'avance : `docs__list` reconnaît le
document **à ses octets**, pas à son nom ni à son type déclaré. Un fichier mal
nommé sera quand même ouvert correctement.

## PDF

`docs__list` rend le nombre de pages, le sommaire s'il y en a un, et les
métadonnées (titre, auteur, producteur). Le producteur oriente utilement la
lecture : un PDF sorti d'un logiciel de présentation ne se lit pas comme un
rapport.

**Chaque titre du sommaire vient avec sa page** : `- p.42 Méthodologie`. C'est ce
numéro que tu passes à `docs__read` — le sommaire est fait pour ça, aller droit à
la bonne page sans balayer le document. Une entrée peut occasionnellement
apparaître sans numéro (sa destination interne n'était pas résoluble) : son titre
reste juste, mais pour celle-là tu devras lire quelques pages pour situer la
section, plutôt que de supposer où elle commence.

`docs__read` prend un **numéro de page** ou une **plage** : `3`, ou `2-5`
(inclusive). Rien d'autre — pas de mot, pas de préfixe. Écris `3`, jamais
`page 3`.

### Lire une page toi-même

`miaou__docs__render_page` rend **une** page en image et te la met sous les yeux.
Ce n'est pas de la reconnaissance de caractères : MIAOU rend la page, c'est
**toi** qui la lis. Si l'image te revient illisible ou ne t'apprend rien, dis-le
et reviens au texte avec `docs__read`.

Une page par appel, à la demande. Demande la suivante seulement si tu en as
besoin : chaque page rendue occupe une place importante dans ton contexte, et
rendre un document entier « pour voir » le sature pour rien.

**La page t'est montrée à toi, pas à l'utilisateur** : elle n'apparaît pas dans
la conversation (il a déjà le document, et l'appel y laisse une trace d'où il
peut la télécharger). Si l'utilisateur demande explicitement à la voir, tu peux
la lui afficher avec `miaou__resource__present` — l'identifiant de ressource de
l'image rendue te revient dans le résultat de l'appel.

Trois situations le justifient :

- **La page n'a pas de texte extractible.** `docs__read` te l'a dit explicitement ;
  la page est un scan. C'est le cas le plus évident.
- **Le visuel porte l'information.** Un schéma, un graphique, un plan, un tableau
  mis en forme : l'extraction de texte en tire des étiquettes dans le désordre,
  ou rien du tout. Si la page a du texte mais qu'il ne rend pas compte de ce dont
  l'utilisateur parle, regarde-la.
- **Le texte est visiblement issu d'un mauvais OCR** — voir ci-dessous.

### Quand le texte extrait est de la bouillie

Un document scanné n'est pas toujours sans texte. Il arrive qu'il ait été passé à
la reconnaissance de caractères avant de t'arriver, et que le résultat soit
mauvais : mots coupés au milieu, lettres remplacées par des chiffres ou des
symboles, majuscules erratiques. Quelque chose comme
`CrNTRE HOSPIT AUER UNl'l RSITAIR[`.

Aucun avertissement ne se déclenchera : il *y a* du texte, et MIAOU n'a aucun
moyen de décider à ta place qu'il est trop abîmé — le seuil n'existe pas, et se
tromper reviendrait à masquer un document simplement mal numérisé mais lisible.
C'est donc à toi de le remarquer.

Si tu vois cette signature, **ne raisonne pas sur cette matière** et n'essaie pas
de deviner les mots manquants : tu fabriquerais du contenu. Redemande la page
avec `docs__render_page` et lis-la toi-même. Si l'image ne te la rend pas plus
lisible, dis à l'utilisateur que le document est mal océrisé plutôt que de lui
rendre une synthèse bâtie sur du bruit.

**Une page peut aussi revenir complètement vide.** Cela veut dire qu'elle n'a
aucune couche texte. Dans ce cas, **dis-le** — nomme les pages concernées et pose
l'hypothèse du scan — puis rends la page en image pour la lire. Ne conclus
jamais que le document est vide ou sans intérêt : tu n'as pas lu son contenu, tu
as constaté qu'il n'est pas accessible par cette voie.

## Classeur Excel

`docs__list` rend les feuilles avec leurs dimensions. Le selector de
`docs__read` est le **nom exact d'une feuille**, tel que le listing l'a rendu :
`Synthèse`. Tu peux le restreindre à une plage de cellules en le suivant d'un
point d'exclamation : `Synthèse!A1:C10`.

Une feuille lue sans plage explicite est **bornée en nombre de lignes** : le
résultat te dit alors où la lecture s'est arrêtée. C'est délibéré — tu ne sais
pas encore, au moment de demander une feuille, si elle en fait trente ou
cinquante mille. Pour aller au-delà, demande une plage, ou passe par une
ressource (voir plus bas).

## Document Word

`docs__list` rend les sections du document, dans l'ordre. Le selector de
`docs__read` est le **titre exact d'une section**, tel que le listing l'a rendu :
`2. Developer Portal`.

Deux selectors particuliers existent pour le texte qui ne relève d'aucun titre :
`(préambule)` pour ce qui précède le premier titre, `(corps)` pour un document
sans titre du tout. Le listing te dit lequel s'applique.

Lire une section rend **aussi ses sous-sections** — demander un chapitre te
donne le chapitre entier, pas seulement son chapeau.

## Présentation PowerPoint

`docs__list` rend les slides **dans l'ordre de la présentation**, avec leur
titre — ou un court extrait de leur texte quand elles n'en ont pas.

Le selector de `docs__read` est le **numéro d'une slide** ou une **plage**,
comme pour un PDF : `3`, ou `2-5`. Ce numéro est celui de l'ordre de
présentation, pas celui d'un nom de fichier interne.

**Les notes de présentateur sont servies avec la slide**, séparées par un
intertitre explicite. Elles portent souvent le propos réel là où la slide ne
porte que des mots-clés : ne les ignore pas, et ne les attribue pas au public —
elles étaient destinées à celui qui présentait.

## Archive zip

C'est le seul format qui ne se lit pas avec `docs__read`. `docs__list` rend les
membres — nom et taille — en signalant explicitement ceux qui ne sont pas
extractibles (chiffrés, chemin non sûr). Puis `miaou__docs__extract` prend le
**chemin exact d'un membre** et le matérialise en ressource `res_…`, sans jamais
charger son contenu dans ton contexte.

Le handle rendu se passe ensuite à `miaou__js__eval` pour compter, filtrer,
agréger ou extraire. C'est le geste normal sur une archive de logs ou de données.

**Un membre par appel.** Pour en analyser plusieurs, rejoue l'extraction puis le
même script sur chaque handle : c'est l'usage attendu, pas un contournement.

Si un membre est annoncé chiffré, **ne l'extrais pas et dis-le**. Un zip protégé
par mot de passe se décompresse en octets illisibles sans lever d'erreur : tu
recevrais du bruit binaire présenté comme du texte, et tu pourrais le prendre
pour du contenu.

## Quand sortir en ressource plutôt qu'en contexte

`docs__read` accepte `as_resource`. Passe-le à vrai quand ce que tu demandes est
**volumineux** — des dizaines de pages, une feuille de plusieurs milliers de
lignes, une longue section, des dizaines de slides. Le texte va alors dans une
ressource `res_…` que tu interroges avec `miaou__js__eval`, au lieu de saturer
ton contexte.

Par défaut, laisse-le faux : une ou deux pages, une petite plage de cellules,
une section ordinaire se lisent directement, et faire un détour par une
ressource pour trois paragraphes coûte un appel pour rien.

## Quand un appel est refusé

Les refus sont **explicites et actionnables** : ils disent ce qui n'allait pas et
ce qu'il faut faire à la place. Lis-les plutôt que de réessayer à l'identique.

- **Lecture trop volumineuse pour le contexte** — le résultat dépassait le cap.
  Relance le même appel avec `as_resource` à vrai, ou demande une plage plus
  courte. Le message te donne le chiffre exact.
- **Selector invalide** — la forme attendue est rappelée dans le message. Le cas
  le plus fréquent est d'avoir écrit un mot là où un nombre était attendu.
- **Plage ramenée** — tu as demandé au-delà de la fin du document ; la lecture a
  été servie, bornée, et le résultat te dit à quoi elle a été ramenée. Ne conclus
  pas que le document s'arrête là où tu avais demandé.
- **Format que MIAOU ne sait pas ouvrir seul** — le message nomme les formats
  natifs et, s'il y en a un de branché, l'outil serveur à utiliser à la place.
  Suis-le. S'il dit qu'aucun outil ne convient, dis-le à l'utilisateur : tu ne
  disposes alors que du nom, du type et de la taille du fichier.

Dans tous les cas : **ne suppose jamais le contenu d'un fichier que tu n'as pas
réussi à ouvrir.** Un fichier illisible est un fait à rapporter, pas un blanc à
combler.

## Le cas Office-vu-comme-zip

Un `.docx`, un `.xlsx` ou un `.pptx` **est** techniquement une archive zip.
`docs__extract` sait donc en sortir un membre XML brut ou une image embarquée.

Ce n'est **pas** la voie normale : elle te donne la mécanique interne du fichier
là où `docs__read` t'en donne le texte. N'y recours que si l'utilisateur demande
explicitement la structure interne du document, ou pour en tirer une image.

## Regrouper des ressources en une archive

`miaou__docs__pack` fait le chemin inverse : il agrège plusieurs ressources déjà
stockées en **une** archive zip téléchargeable. C'est le geste à proposer quand
tu as produit plusieurs fichiers au fil de la conversation et que l'utilisateur
veut les récupérer d'un coup.
