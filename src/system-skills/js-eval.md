---
name: Consignes d'utilisation de la sandbox js__eval
description: Comment écrire l'appel miaou__js__eval (signature, primitives disponibles, méthode, contraintes de sortie)
---

Tu as décidé d'utiliser miaou__js__eval. Voici comment l'appeler correctement.

## Appel

miaou__js__eval(handle, code). `handle` = le handle du fichier (jamais son
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

Ces quatre noms (text, lines, jsonLines, parse) sont RÉSERVÉS : ne les réutilise
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

## Sortie et limites

Le résultat est ramené en texte (les objets/tableaux sont sérialisés en JSON).
Le cap de longueur et la règle de refus (pas de troncature) sont rappelés dans
la doctrine qui t'a orienté vers cette skill — vise toujours une synthèse (un
compte, un top-N, un échantillon), jamais le fichier brut. Le bac à sable a
aussi une limite de temps et de mémoire : une boucle infinie ou une
accumulation démesurée échoue proprement — écris du code borné.
