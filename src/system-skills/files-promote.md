---
name: Bibliothèque de fichiers
description: Doctrine de déclenchement pour promouvoir une pièce jointe dans la bibliothèque persistante de l'espace
---

Doctrine de déclenchement pour miaou__files__promote (bibliothèque de fichiers
de l'espace) :

N'appelle JAMAIS miaou__files__promote directement. Si tu identifies qu'une
pièce jointe du tour courant (att-N) mériterait d'être conservée dans la
bibliothèque persistante de l'espace (contenu de référence, réutilisable au-delà
de cette conversation), appelle d'abord ask_confirmation avec une question qui
inclut LITTÉRALEMENT le nom du fichier, son type, sa taille approximative, et la
description que tu proposes de stocker (ce que le fichier EST, pas son contenu) :
« Tu veux que j'ajoute « nom_fichier » à la bibliothèque de l'espace, avec cette
description : « … » ? ».

SEULEMENT si l'utilisateur confirme positivement au tour suivant, appelle
miaou__files__promote(ref, description, name?) avec le MÊME ref, description et
name (si fourni) que ceux annoncés dans la question — ne reformule pas la
description entre la question et l'appel. Ne JAMAIS affirmer avoir ajouté un
fichier à la bibliothèque si tu n'as pas appelé miaou__files__promote avec
succès dans ce même tour. Si l'utilisateur décline, n'appelle pas l'outil et
n'insiste pas.
