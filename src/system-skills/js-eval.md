---
name: Consignes d'utilisation de la sandbox js__eval
description: Comment écrire l'appel miaou__js__eval (signature, primitives disponibles, méthode, contraintes de sortie)
---

Tu as décidé d'utiliser miaou__js__eval. Voici comment l'appeler correctement.

## Appel

miaou__js__eval(code) — et, optionnellement, `input_handles` (voir juste en
dessous) et `output_handle` (voir « Écrire un gros résultat » plus bas).

Seul `code` est obligatoire. Appelé avec lui seul, l'outil exécute ton code sans
rien lire : c'est le mode CALCUL PUR, décrit à la section suivante.

`input_handles` = un OBJET qui range tes ressources d'entrée sous des clés que tu
choisis : `{"log": "att-3"}` pour une seule, `{"clients": "res_a1b2", "commandes":
"res_c3d4"}` pour en croiser deux. Les valeurs sont des handles (att-N, file-<id>
ou res_<id>) — jamais le contenu, jamais un chemin. La clé est ton étiquette : tu
la réutilises dans ton code pour dire QUELLE ressource tu lis, `text("clients")`.
Choisis-la parlante, tu es le seul à la relire.

Dès que tu fournis `input_handles`, chaque ressource y porte une clé — il n'existe
pas de forme raccourcie qui passerait un handle nu, même pour une seule ressource.
Le nombre de ressources par appel est plafonné (le refus te dira la limite si tu
la dépasses) — au-delà, fais plusieurs appels.

Si une seule des clés porte un handle inconnu ou mal formé, l'appel ENTIER est
refusé sans rien exécuter, et le message te nomme la clé fautive : corrige-la et
rappelle, ne cherche pas à contourner en retirant la ressource du lot.

## Calcul sans aucune ressource

Tu n'as pas besoin d'une ressource pour avoir le droit d'exécuter du code. Quand
tu veux seulement CALCULER, omets `input_handles` :

    miaou__js__eval(code: "const n = 2n ** 127n - 1n; n.toString();")

C'est la bonne voie pour l'arithmétique exacte (grands entiers via BigInt,
décimales où le calcul de tête dérape), la manipulation de chaînes, la
vérification d'une formule, d'une date ou d'une expression régulière, une
simulation courte, un tri ou un dénombrement sur des données que tu écris
toi-même dans le code. Préfère-la à un calcul mental dès que l'exactitude
compte : le bac à sable ne se trompe pas d'arrondi.

Ne fabrique JAMAIS une ressource vide ou factice dans le seul but de pouvoir
appeler l'outil — c'est un détour inutile, et le mode sans entrée existe
précisément pour te l'épargner. Dans ce mode, les primitives de lecture
(text, lines, jsonLines, parse) n'ont aucune clé à lire : les appeler lève une
erreur. Les données sur lesquelles tu calcules, écris-les dans `code`.

## Le paramètre `code`

`code` = une expression ou une suite d'instructions JavaScript dont la DERNIÈRE
valeur évaluée est le résultat renvoyé. Le code
s'exécute au niveau global (PAS dans une fonction) : pour renvoyer un objet,
enveloppe-le dans un appel — `JSON.stringify({ a: 1, b: 2 })` — ou parenthèse-le
— `({ a: 1, b: 2 })`. Un objet nu en dernière ligne (`{ a: 1 }`) est lu comme un
BLOC, pas comme une valeur, et échoue : préfère la forme JSON.stringify(…).
Termine tes instructions par des points-virgules. Quand tu lis une ressource,
n'inclus JAMAIS son contenu dans `code` : il est déjà disponible via les
primitives ci-dessous.

## Primitives disponibles (liste FERMÉE)

Rien d'autre du monde hôte n'est accessible : ni fetch, ni réseau, ni DOM, ni
système de fichiers.

Les quatre primitives de lecture prennent la CLÉ de la ressource à lire, telle
que tu l'as écrite dans `input_handles`. Une clé que tu n'as pas fournie lève une
erreur que tu peux voir dans le résultat (ce n'est pas un silence) — c'est aussi
ce qui arrive si tu les appelles alors que tu n'as fourni aucune ressource.

- text("cle") → le contenu textuel entier de cette ressource (string).
- lines("cle") → un tableau de ses lignes (découpe sur les sauts de ligne).
- jsonLines("cle") → un tableau d'objets, une ligne JSON parsée par élément (les
  lignes vides ou non parsables sont ignorées) ; pour un fichier JSON-lines/NDJSON.
- parse("cle") → cette ressource entière parsée comme un unique document JSON.
- emit(chunk) → ajoute `chunk` à la fin de la ressource de sortie, LITTÉRALEMENT :
  aucun saut de ligne n'est ajouté, ton chunk est collé au dernier caractère déjà
  présent. Si tu produis des lignes, écris `emit(row + "\n")`. N'EXISTE QUE
  si tu as passé `output_handle` en appelant miaou__js__eval : sans ce paramètre,
  l'appeler échoue sur « emit is not defined ». C'est la seule primitive qui
  ÉCRIT — les autres ne font que lire. N'en déduis pas qu'il en existe d'autres
  du même genre : la liste ci-dessus est complète.

Ces cinq noms (text, lines, jsonLines, parse, emit) sont RÉSERVÉS : ne les réutilise
pas comme noms de variable. `const lines = lines("x")` échoue (redéclaration d'un
identifiant global) — nomme ta variable autrement, ex. `const rows = lines("x");`.
Les globals JavaScript standard (JSON, Math, Array, String, RegExp, Date…) sont
disponibles. Aucun déterminisme n'est requis (Date/Math.random autorisés).

## Méthode

Procède par petits appels successifs plutôt que de viser un seul gros script
parfait. Un premier appel pour inspecter la forme du fichier (quelques lignes
de tête/queue, un décompte), puis un ou des appels ciblés selon ce que tu as
vu. Un script clair de plusieurs lignes, avec des variables intermédiaires
nommées, réussit mieux qu'un one-liner condensé — n'essaie pas de tout
raccourcir. Tu peux enchaîner de nombreux appels : c'est l'usage attendu.

## Croiser plusieurs ressources en un seul appel

C'est la raison d'être de `input_handles` : quand deux gros résultats obtenus
séparément doivent être rapprochés, ne les fais PAS repasser par la conversation
pour les comparer toi-même — donne-les tous les deux au bac à sable et laisse le
code faire la jointure. Seul le résultat revient.

Exemple — joindre deux JSON par un identifiant commun, avec
`input_handles = {"clients": "res_a1b2", "commandes": "res_c3d4"}` :

    var clients = parse("clients");
    var commandes = parse("commandes");
    var parId = {};
    clients.forEach(function (c) { parId[c.id] = c.nom; });
    var total = {};
    commandes.forEach(function (o) {
      var nom = parId[o.clientId];
      if (nom) { total[nom] = (total[nom] || 0) + o.montant; }
    });
    JSON.stringify(total);

Même méthode pour comparer deux versions d'un même fichier, recouper un log
avec une table de référence, ou vérifier qu'un export contient bien tout ce
qu'annonce un inventaire.

## Écrire un gros résultat (output_handle + emit)

Le résultat renvoyé est plafonné, donc il ne sert pas à PRODUIRE un gros contenu
(un CSV de milliers de lignes, un rapport complet). Pour ça :

1. Crée d'abord la ressource de destination avec miaou__resource__create (un
   contenu initial minimal suffit — un en-tête de CSV, par exemple). Termine ce
   contenu initial par un saut de ligne : le premier emit() se collera sinon
   directement à sa fin, sur la même ligne.
2. Rappelle miaou__js__eval en passant son handle res_… en `output_handle`.
3. Dans ton code, appelle emit(…) au fil du calcul, autant de fois que tu veux.
   Chaque appel ajoute à la fin de la ressource, sans séparateur ; rien ne
   s'accumule en mémoire.
4. Renvoie quand même une petite valeur de synthèse (un compte, un aperçu) : le
   canal de retour normal reste actif et c'est ce que tu liras dans le résultat.

Tu peux répéter l'opération sur plusieurs appels et plusieurs fichiers : la
ressource grossit à chaque fois, tu n'écris jamais deux fois ce qui y est déjà.
Ne confonds pas ce mécanisme avec `input_handles` : celui-ci sert à LIRE
plusieurs ressources dans un MÊME appel, celui-là à ÉCRIRE dans une seule
ressource au fil de PLUSIEURS appels. Les deux se combinent sans problème.
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
accumulation démesurée échoue proprement — écris du code borné. Le nombre de
ressources d'ENTRÉE par appel est lui aussi plafonné : c'est une limite sur leur
NOMBRE, indépendante de leur taille, et elle n'a pas de plancher — zéro ressource
est un appel valide.
