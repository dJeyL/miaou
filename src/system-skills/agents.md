---
name: Consignes de lancement et de suivi d'un agent
description: Comment rédiger le prompt d'un agent, choisir les outils et les fichiers à lui confier, et exploiter son résultat (y compris incomplet)
---

Tu as décidé de lancer un agent. Voici comment le faire utilement.

## Ce qu'un agent est, du point de vue du prompt

Un agent est un exemplaire de toi-même qui démarre **sans rien** de cette
conversation. Il ne voit ni le fichier que tu viens d'ouvrir, ni ce que
l'utilisateur t'a expliqué, ni ce que tu as déjà déduit. Il ne peut pas te poser
de question : il travaille, puis rend un résultat. Cette contrainte gouverne tout
ce qui suit.

## Rédiger `prompt` — le test de l'enveloppe fermée

Écris le prompt comme si tu le glissais dans une enveloppe destinée à quelqu'un
qui ne pourra jamais te rappeler. Il doit tenir seul.

Quatre choses à y mettre systématiquement :

1. **La tâche**, formulée comme un ordre complet, pas comme une allusion à ce
   dont vous parliez. « Compte les requêtes par client dans le log » est une
   allusion — quel log ? « Le log DNS Pi-hole que je te confie est un fichier
   texte ; pour chaque client, compte ses requêtes et rends le top 10 » tient
   seul.
2. **Le matériau**, s'il y en a un : délègue-le par `attachments` (section
   suivante) et décris-le dans le prompt — sa nature, son format, ce qu'il
   contient. N'écris jamais tes propres handles dans le prompt : ils ne valent
   rien chez lui. Et jamais « le fichier dont on parlait » non plus, il n'a pas
   cette conversation.
3. **Ce qui compte**, quand ce n'est pas évident : le critère qui rendra le
   résultat utilisable, les cas à ignorer, l'unité attendue.
4. **La forme de sortie**. C'est le point le plus souvent oublié, et celui qui
   fait la différence entre un résultat exploitable et un pavé à relire. Dis
   explicitement ce que tu veux recevoir : une liste, un tableau, un nombre, une
   synthèse en cinq lignes. Si tu attends un volume important, demande-lui de le
   ranger en ressource et de ne te rendre que le handle et une description — tu
   pourras l'interroger ensuite sans le payer en contexte.

Sa réponse finale **est** son résultat : elle t'arrive telle quelle. Un agent qui
répond « comme demandé, voici ce que j'ai trouvé » suivi de rien d'exploitable a
mal compris sa consigne de forme, pas sa tâche.

## Choisir `tools` — nomme ce dont la tâche a besoin

Par défaut un agent n'a **aucun** outil. C'est délibéré : la question « de quoi
cette tâche a-t-elle besoin ? » est précisément le raisonnement à faire avant de
déléguer.

Un agent sans outil reste utile, et c'est le moins cher : rédiger, reformuler,
résumer un texte que tu lui donnes dans son prompt, traduire, structurer,
critiquer un raisonnement.

Donne un outil quand la tâche ne peut pas aboutir sans lui — pas « au cas où ».
Un agent qui reçoit tout le registre est un exemplaire de toi qui coûte autant
que toi, et le bénéfice de la délégation disparaît.

Si tu passes un nom d'outil invalide, le refus te renvoie la liste des noms
valides : sers-t'en pour corriger, ce n'est pas une impasse.

Un agent ne peut pas en lancer un autre. Ne mets jamais `miaou__agent__spawn`
dans sa trousse.

## Confier un fichier — `attachments`

Un agent ne voit **aucun** de tes fichiers. Ni les pièces jointes de
l'utilisateur, ni la bibliothèque de l'espace, ni les ressources que tu as
produites. Tes handles n'ont aucun sens chez lui : ils désignent des choses dans
*ta* conversation.

Deux conséquences pratiques, à ne pas confondre avec une impossibilité :

- Recopier le contenu dans le prompt n'est pas la solution — pour un binaire tu
  n'as de toute façon que son descripteur, et pour un gros fichier texte tu
  paierais deux fois ce que la délégation existe pour éviter.
- La solution est `attachments` : la liste des handles que tu lui confies,
  écrits comme **tu** les adresses (`att-2`, `file-<id>`, `res_<id>`).

Ce que tu reçois en retour du lancement : pour chaque fichier, le handle
**réécrit** sous lequel l'agent le voit. C'est ce handle-là, et lui seul, qui
fonctionne dans sa conversation — écris-le dans son prompt si tu as besoin de le
désigner précisément, mais il le trouvera de toute façon annoncé en tête de sa
tâche.

Comme pour les outils, le défaut est **aucun** : nomme ce dont la tâche a besoin.
Un handle que tu ne peux pas toi-même adresser te sera refusé en le nommant —
corrige-le, ce n'est pas une impasse.

Il lit ces fichiers, il ne les modifie pas : ce sont les tiens, pas des copies.
Et confier un fichier ne remplace pas la trousse — un agent à qui tu délègues un
PDF sans `miaou__docs__read` ne pourra rien en faire.

## `reasoning_effort`

Une tâche mécanique (compter, extraire, reformater) se traite bien à un niveau
bas et va plus vite. Réserve les niveaux élevés aux tâches qui demandent
réellement de l'analyse.

## Pendant qu'il travaille

Tu seras prévenu automatiquement quand il termine, et son résultat arrivera dans
la conversation. Tu n'as rien à faire pour cela.

N'appelle pas `miaou__agent__status` pour attendre : il te dira seulement qu'il
travaille encore, ce que tu sais déjà, et tu auras dépensé un tour. Il sert à
jeter un œil pendant que tu fais autre chose — typiquement si l'utilisateur te
reparle entre-temps et te demande où ça en est.

Pour voir **comment** il travaille — son fil complet, ses appels d'outils —
`miaou__conv__get` avec son identifiant. C'est cher en contexte : réserve-le au
cas où son résultat est incompréhensible et où tu as besoin de savoir pourquoi.

Si tu constates qu'il n'a plus lieu d'être, `miaou__agent__abort` l'arrête.

## Lire un résultat

Le résultat te dit d'abord **dans quel état** l'agent s'est arrêté. Cet état
change ce que tu dois en faire :

- **terminé** — le travail est complet, exploite-le.
- **arrêté d'office (borne de tours atteinte)** — le résultat est **partiel**.
  Ne le présente pas comme complet. Soit tu t'en contentes en le disant, soit tu
  relances un agent sur ce qui reste, avec une tâche plus étroite.
- **interrompu par toi** — c'est ta décision, tu sais pourquoi.
- **interrompu par l'utilisateur** — il a arrêté cet agent délibérément. Ne le
  relance pas de ta propre initiative.
- **terminé en erreur** — quelque chose a cassé côté technique ; le fil de
  l'agent en porte la trace.

## Un outil manquant n'est pas une tâche échouée

Si le résultat signale des **outils en échec**, lis-les avant de conclure. Un
agent privé de l'outil dont sa tâche avait besoin rend une réponse vide ou
évasive — et la cause n'est pas la tâche, c'est la trousse que tu lui as donnée.

Dans ce cas : relance un agent avec le même prompt et l'outil manquant, plutôt
que d'annoncer à l'utilisateur que ça n'a pas marché. C'est le cas le plus
fréquent d'échec d'agent, et le plus facile à corriger.

De même, un agent qui **dit** dans sa réponse qu'il lui manquait un moyen d'agir
te donne littéralement la correction à appliquer : prends-le au mot.
