---
name: Consignes d'utilisation de la sandbox js__eval
description: Comment écrire l'appel miaou__js__eval (signature, primitives disponibles, méthode, contraintes de sortie)
---

Tu as décidé d'utiliser miaou__js__eval. Voici comment l'appeler correctement.

## Appel

miaou__js__eval(handle, code) — et, optionnellement, `output_handle` (voir
« Écrire un gros résultat » plus bas). `handle` = le handle du fichier (jamais son
contenu ni un chemin). `code` = une expression ou une suite d'instructions
JavaScript dont la DERNIÈRE valeur évaluée est le résultat renvoyé. Le code
s'exécute au niveau global (PAS dans une fonction) : pour renvoyer un objet,
enveloppe-le dans un appel — `JSON.stringify({ a: 1, b: 2 })` — ou parenthèse-le
— `({ a: 1, b: 2 })`. Un objet nu en dernière ligne (`{ a: 1 }`) est lu comme un
BLOC, pas comme une valeur, et échoue : préfère la forme JSON.stringify(…).
Termine tes instructions par des points-virgules. N'inclus JAMAIS le contenu du
fichier dans `code` : il est déjà disponible via les primitives ci-dessous.

## Primitives disponibles (liste FERMÉE)

Rien d'autre du monde hôte n'est accessible : ni fetch, ni réseau, ni DOM, ni
système de fichiers.

- text() → le contenu textuel entier du fichier (string).
- lines() → un tableau des lignes du fichier (découpe sur les sauts de ligne).
- jsonLines() → un tableau d'objets, une ligne JSON parsée par élément (les
  lignes vides ou non parsables sont ignorées) ; pour un fichier JSON-lines/NDJSON.
- parse() → le fichier entier parsé comme un unique document JSON.
- emit(chunk) → ajoute `chunk` à la fin de la ressource de sortie. N'EXISTE QUE
  si tu as passé `output_handle` en appelant miaou__js__eval : sans ce paramètre,
  l'appeler échoue sur « emit is not defined ». C'est la seule primitive qui
  ÉCRIT — les autres ne font que lire. N'en déduis pas qu'il en existe d'autres
  du même genre : la liste ci-dessus est complète.

Ces cinq noms (text, lines, jsonLines, parse, emit) sont RÉSERVÉS : ne les réutilise
pas comme noms de variable. `const lines = lines()` échoue (redéclaration d'un
identifiant global) — nomme ta variable autrement, ex. `const rows = lines();`.
Les globals JavaScript standard (JSON, Math, Array, String, RegExp, Date…) sont
disponibles. Aucun déterminisme n'est requis (Date/Math.random autorisés).

## Méthode

Procède par petits appels successifs plutôt que de viser un seul gros script
parfait. Un premier appel pour inspecter la forme du fichier (quelques lignes
de tête/queue, un décompte), puis un ou des appels ciblés selon ce que tu as
vu. Un script clair de plusieurs lignes, avec des variables intermédiaires
nommées, réussit mieux qu'un one-liner condensé — n'essaie pas de tout
raccourcir. Tu peux enchaîner de nombreux appels : c'est l'usage attendu.

## Écrire un gros résultat (output_handle + emit)

Le résultat renvoyé est plafonné, donc il ne sert pas à PRODUIRE un gros contenu
(un CSV de milliers de lignes, un rapport complet). Pour ça :

1. Crée d'abord la ressource de destination avec miaou__resource__create (un
   contenu initial minimal suffit — un en-tête de CSV, par exemple).
2. Rappelle miaou__js__eval en passant son handle res_… en `output_handle`.
3. Dans ton code, appelle emit(…) au fil du calcul, autant de fois que tu veux.
   Chaque appel ajoute à la fin de la ressource ; rien ne s'accumule en mémoire.
4. Renvoie quand même une petite valeur de synthèse (un compte, un aperçu) : le
   canal de retour normal reste actif et c'est ce que tu liras dans le résultat.

Tu peux répéter l'opération sur plusieurs appels et plusieurs fichiers : la
ressource grossit à chaque fois, tu n'écris jamais deux fois ce qui y est déjà.
Si tu as le contenu directement en main (sans calcul à faire dans le bac à
sable), miaou__resource__append fait la même chose sans passer par du code.

Si l'exécution échoue en cours de route (erreur, dépassement de temps), ce qui a
DÉJÀ été émis est conservé dans la ressource — le travail partiel n'est pas
perdu. Relis-la avant de relancer, pour ne pas écrire deux fois la même chose.

## Sortie et limites

Le résultat est ramené en texte (les objets/tableaux sont sérialisés en JSON).
Le cap de longueur et la règle de refus (pas de troncature) sont rappelés dans
la doctrine qui t'a orienté vers cette skill — vise toujours une synthèse (un
compte, un top-N, un échantillon), jamais le fichier brut. Le bac à sable a
aussi une limite de temps et de mémoire : une boucle infinie ou une
accumulation démesurée échoue proprement — écris du code borné.
