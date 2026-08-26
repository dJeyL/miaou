---
name: Bibliothèque de fichiers
description: Doctrine de déclenchement pour déposer un fichier dans la bibliothèque persistante de l'espace
---

Doctrine de déclenchement pour miaou__files__promote (bibliothèque de fichiers
de l'espace) :

N'appelle JAMAIS miaou__files__promote de ta propre initiative sans le
consentement décrit plus bas.

DEUX SOURCES POSSIBLES pour le paramètre `ref` :

1. Une pièce jointe du tour courant (att-N) — un fichier que l'utilisateur a
   joint à la conversation.
2. Une ressource de session (res_…) — y compris une ressource que TU as
   toi-même créée avec miaou__resource__create. C'est le chemin pour déposer
   dans la bibliothèque un contenu que tu as produit : crée d'abord la
   ressource, puis promeus le handle res_… qu'elle te renvoie. Passe alors un
   `name` explicite, avec l'extension attendue (une ressource créée sans nom
   s'appelle « resource », ce qui fait un mauvais nom de fichier).

Un handle file-<id> est refusé : le fichier est déjà dans la bibliothèque.

FORME DE LA DESCRIPTION — elle est affichée telle quelle sur la carte du
fichier dans l'interface, et relue à chaque tour dans le manifeste de la
bibliothèque : c'est une phrase, pas une étiquette. Écris-la comme telle,
commençant par une MAJUSCULE et terminée par un point, en une ou deux phrases
maximum. Elle dit ce que le fichier EST et à quoi il sert, jamais un résumé de
son contenu.

- Bien : « Jeu de données de test pour la validation du parseur CSV. »
- Mal : « jeu de données de test » (pas de majuscule, pas de point).
- Mal : « Contient 10 lignes dont Julien, Anne-Sophie, Samuel… » (résumé du
  contenu, pas description du fichier).

CONSENTEMENT — deux cas, à distinguer avant d'agir :

- L'utilisateur vient de te demander explicitement de déposer ce contenu dans
  la bibliothèque de l'espace (« ajoute ça à la bibliothèque », « promeus ce
  fichier », « garde-le dans l'espace ») : la demande EST le consentement.
  Appelle directement miaou__files__promote, sans repasser par
  ask_confirmation — reposer la question serait une friction inutile.
- Tu identifies de toi-même qu'un contenu mériterait d'être conservé (contenu
  de référence, réutilisable au-delà de cette conversation), sans que
  l'utilisateur l'ait demandé : appelle d'abord ask_confirmation avec une
  question qui inclut LITTÉRALEMENT le nom du fichier, son type, sa taille
  approximative, et la description que tu proposes de stocker (ce que le
  fichier EST, pas son contenu) : « Tu veux que j'ajoute « nom_fichier » à la
  bibliothèque de l'espace, avec cette description : « … » ? ». SEULEMENT si
  l'utilisateur confirme positivement au tour suivant, appelle
  miaou__files__promote avec les MÊMES ref, description et name (si fourni) que
  ceux annoncés dans la question — ne reformule pas la description entre la
  question et l'appel. Si l'utilisateur décline, n'appelle pas l'outil et
  n'insiste pas.

Dans les deux cas : ne JAMAIS affirmer avoir ajouté un fichier à la
bibliothèque si tu n'as pas appelé miaou__files__promote avec succès dans ce
même tour.
