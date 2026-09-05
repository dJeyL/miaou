## apercu — vue d'ensemble

MIAOU est un client de chat web pour dialoguer avec un modèle de langage. Tu
discutes avec le modèle en langage naturel ; il peut répondre, raisonner à voix
haute quand il en est capable, afficher du code coloré, dessiner des diagrammes,
et se servir d'outils pour retrouver des informations dans tes conversations
passées, tes souvenirs ou tes fichiers.

Ce que tu peux faire ici :

- **Discuter** avec streaming en direct, arrêter une réponse en cours, éditer un
  de tes messages pour repartir de ce point.
- **Joindre des fichiers** à un message : images, fichiers texte, archives zip,
  PDF, classeurs Excel, documents Word et présentations PowerPoint.
- **Organiser** ton travail en Espaces étanches, chacun avec ses conversations,
  ses fichiers et ses souvenirs.
- **Garder de la mémoire** : le modèle résume tes échanges et peut enregistrer
  des souvenirs durables pour te reconnaître d'une conversation à l'autre.
- **Étendre** le modèle avec des skills (instructions réutilisables) et des
  outils distants (serveurs compagnons, si configurés).
- **Analyser** un ou plusieurs fichiers volumineux (log, JSON, CSV, texte) : le
  modèle peut exécuter du code sur leur contenu pour compter, filtrer, extraire
  ou les croiser entre eux, sans les charger dans le contexte.
- **Exporter** une conversation en Markdown ou en page HTML autonome.
- **Déléguer** : le modèle peut confier une tâche à un agent — une
  sous-conversation autonome qui travaille en parallèle pendant qu'il continue —
  et récupérer son résultat.

Pour en savoir plus sur un sujet précis, demande-moi. Les sujets disponibles :

{{TOPIC_LIST}}


## pieces-jointes — pièces jointes

Tu peux joindre des fichiers à un message avant de l'envoyer : clique sur le
trombone du composer, glisse-dépose un ou plusieurs fichiers n'importe où sur
la zone de conversation (pas seulement sur la barre de saisie), ou colle
directement depuis le presse-papier — une image copiée, ou un fichier copié
depuis l'explorateur de fichiers. Sont exploitables : **images** (le modèle les
voit réellement, s'il gère la vision), **fichiers texte** (leur contenu est
transmis au modèle), **archives zip** (le modèle en liste le contenu et en sort
le fichier qui l'intéresse) et **documents** — PDF, classeurs Excel, documents
Word et présentations PowerPoint — que MIAOU ouvre lui-même, structure d'abord
puis lecture ciblée (voir le sujet `documents`). Les autres fichiers binaires
sont acceptés et conservés, mais le modèle n'en voit que le nom, le type et la
taille tant qu'aucun outil ne sait les ouvrir (voir le sujet `mcp`).

Quelques plafonds, fixés à l'installation : une image ne doit pas dépasser
{{ATTACHMENT_IMAGE_MAX}}, et tu peux en joindre au plus
{{ATTACHMENT_MAX_IMAGES}} par message ; les autres fichiers sont acceptés
jusqu'à {{INLINE_MAX}}. Un fichier au-delà est refusé avec un message qui le
dit, il n'est jamais tronqué en silence.

Une fois envoyées, les pièces jointes apparaissent comme des vignettes sous ton
message. Tu peux les rouvrir : cliquer sur une image l'affiche en plein écran,
et un bouton permet de la retélécharger. Le modèle peut aussi redemander une
pièce jointe d'un message précédent quand il en a besoin pour répondre — et,
plus généralement, se faire remontrer n'importe quelle image dont il dispose,
y compris une qu'il vient de télécharger ou de produire lui-même : afficher une
image dans la conversation ne la lui met pas sous les yeux, il doit la
redemander explicitement.

Les images ne sont envoyées en pleine résolution qu'au moment où tu les joins ;
ensuite le modèle en garde une trace légère plutôt que de recharger les pixels à
chaque tour, pour rester économe. Si tu veux qu'un fichier reste disponible
durablement (pas seulement le temps d'un message), promeus-le dans la
bibliothèque de fichiers de ton Espace — voir le sujet `espaces`.

## documents — documents : PDF, Excel, Word, PowerPoint, zip

Les **archives zip** sont ouvertes par MIAOU lui-même, sans aucun serveur
compagnon : le modèle peut lister les fichiers contenus dans une archive que tu
as jointe ou déposée dans la bibliothèque d'un Espace, puis en sortir celui qui
l'intéresse pour l'analyser — typiquement une archive de logs. Les membres
protégés par mot de passe sont refusés explicitement plutôt que lus de travers.
Un document Office (`.docx`, `.xlsx`, `.pptx`) étant lui aussi une archive,
MIAOU sait l'ouvrir de cette façon — il n'y voit alors que sa mécanique interne,
ce qui ne sert qu'à qui veut justement la voir. Pour en tirer le texte, c'est
l'ouverture par format décrite ci-dessous qui s'applique, et elle est automatique.

Les **PDF** sont lus nativement eux aussi. Le modèle peut en donner la structure
— nombre de pages, sommaire, titre et logiciel d'origine quand le document les
porte — puis en lire une page précise ou une plage, sans jamais avaler le
document entier. Chaque titre du sommaire vient **avec son numéro de page**, ce
qui permet au modèle d'aller droit à la bonne section au lieu de balayer. Sur un
document long, il peut ranger sa lecture dans une ressource et l'interroger par
code plutôt que de la faire défiler.

Une page de PDF peut aussi être **rendue en image** pour que le modèle la regarde
avec sa vision, page par page à sa demande. C'est la réponse aux pages scannées,
mais pas seulement : un schéma, un graphique ou un tableau mis en forme se lisent
souvent mieux à l'œil que dans le texte qu'on en extrait. Ce n'est pas de la
reconnaissance de caractères : MIAOU rend la page, c'est le modèle qui la lit —
un modèle sans vision n'en tire donc rien.

Le même principe joue à l'entrée de la bibliothèque d'un Espace. Quand tu y
déposes un PDF scanné, dont il n'y a par nature aucun texte à extraire, MIAOU
en rend la première page et la donne au modèle pour qu'il en écrive la
description — au lieu de laisser la carte du fichier sans rien. Les **images**
déposées dans une bibliothèque sont décrites de la même façon, en les donnant à
voir. Si le modèle actif s'avère ne pas avoir la vision, la description est
quand même rédigée à partir de ce qui reste (nom, type, structure du document),
et son modèle est noté comme sans vision pour le reste de la session.

L'image n'est **pas affichée dans le fil** : c'est une matière de travail du
modèle, et tu as déjà le document d'origine. Seule la trace de l'appel apparaît,
avec un bouton pour télécharger la page si tu veux la voir. Et si tu veux
vraiment l'avoir sous les yeux dans la conversation, demande-le au modèle : il
sait la ré-afficher.

Les **classeurs Excel** (`.xlsx`) s'ouvrent nativement également. Le modèle
commence par en lister les feuilles avec leurs dimensions, puis lit celle qui
l'intéresse — entièrement, ou sur une plage de cellules précise comme
`Synthèse!A1:C10`. Sur une feuille volumineuse, il ne reçoit d'office que les
premières lignes et sait qu'il doit demander une plage ou ranger la lecture dans
une ressource. Un classeur déposé dans la bibliothèque d'un Espace est décrit par
ses feuilles et un aperçu, plutôt que par son nom seul.

Les **documents Word** (`.docx`) s'ouvrent nativement aussi. Le modèle en liste
d'abord les sections — les titres du document — puis lit celle que tu lui
désignes, ou celle qui lui paraît utile ; lire une section lui donne aussi ses
sous-parties. Les **tableaux sont préservés** et rendus à leur place dans la
section qui les porte, ce qui compte pour un document dont la substance est
souvent tabulaire. Un document déposé dans la bibliothèque d'un Espace est décrit
par ses sections et un aperçu.

Les **présentations PowerPoint** (`.pptx`) s'ouvrent nativement elles aussi, et
c'est le format où MIAOU en voit le plus. Le modèle en liste les slides **dans
l'ordre de la présentation** — pas dans l'ordre des fichiers internes, qui
diffère dès qu'une slide a été déplacée — puis lit celle que tu lui désignes par
son numéro, ou une plage. Chaque slide du listing porte son titre, ou à défaut un
extrait de son texte : sur un deck où presque aucune slide n'est titrée, une
liste de « (sans titre) » ne t'aiderait pas plus qu'elle n'aide le modèle.

Deux choses valent d'être sues sur ce format. Le texte des **formes groupées**
est lu — c'est le cas des organigrammes, où les noms et les rattachements vivent
justement dans des groupes, et où un outil qui ne descend pas dedans perd la
moitié du contenu. Et les **notes de présentateur** sont lues avec leur slide,
clairement séparées d'elle : dans une présentation, les slides portent souvent
des mots-clés et les notes portent le propos.

Une limite à connaître : un PDF, un classeur, un document Word ou une
présentation **protégé par mot de passe** est refusé franchement, MIAOU ne
cherche pas à le déchiffrer.

Le cas de la page **scannée** (une image de page, sans texte dessous), lui, n'est
plus une impasse. MIAOU ne fait toujours pas de reconnaissance de caractères,
mais il signale au modèle que la page est probablement scannée **et** lui propose
de la lui montrer en image — à charge pour lui de la lire, s'il a la vision. Un
modèle qui n'en a pas te dira que la page n'est pas lisible par cette voie,
plutôt que de conclure que le document est vide. Même chose quand un document a
déjà été océrisé avant de t'arriver et que le résultat est mauvais : le modèle
est invité à regarder la page plutôt qu'à raisonner sur un texte truffé
d'erreurs.

Ces ouvertures natives — zip, PDF, Excel, Word, PowerPoint — chargent au premier
usage un composant depuis Internet. **Sans connexion, MIAOU ne peut ouvrir aucun document** ; c'est
le cas où un serveur compagnon reste utile (voir le sujet `mcp`).

Dans l'autre sens, le modèle peut **fabriquer une archive** : quand plusieurs
fichiers se sont accumulés au fil de l'échange — des scripts, des rapports, des
extraits qu'il a produits ou sortis d'une autre archive — il peut les regrouper
en un seul zip que tu récupères d'un clic, plutôt que de te les faire
télécharger un par un. Le bouton de téléchargement apparaît directement dans le
fil, sous la trace de l'outil.

## ressources — analyse par le calcul et ressources

Pour un fichier texte volumineux (un log, un gros JSON, un CSV), le modèle
n'est pas obligé d'en charger tout le contenu : il peut l'**analyser par le
calcul** — compter des lignes, filtrer, agréger, extraire un extrait — en
exécutant du code dans un bac à sable isolé, et ne ramener que le résultat. Utile
pour interroger un fichier trop gros pour tenir dans le contexte. Il peut même
croiser jusqu'à {{JS_EVAL_MAX_INPUTS}} fichiers dans un même calcul — pour
rapprocher deux résultats obtenus séparément sans avoir à les faire repasser par
la conversation. Le calcul est borné dans le temps ({{JS_EVAL_TIMEOUT_S}}
secondes) : une analyse qui n'aboutit pas dans ce délai est interrompue. Si la réponse
ramenée est elle-même trop volumineuse, le modèle est invité à la resserrer
plutôt qu'à déverser le fichier brut — ou, quand il s'agit justement de
**produire** un gros contenu, à l'écrire au fil du calcul dans une ressource,
qui n'a pas cette limite (voir plus bas dans ce sujet).

Le modèle peut aussi ranger lui-même un texte qu'il vient de produire ou de
recomposer (une compilation, un résultat intermédiaire volumineux) sous forme
de ressource, plutôt que de l'écrire en clair dans sa réponse — cette ressource
apparaît alors comme une pièce jointe et peut à son tour être interrogée par le
calcul, comme un fichier que tu aurais joint toi-même.

De la même façon, quand un résultat d'outil volumineux (une longue page web
récupérée, un fichier lu) encombre la conversation, le modèle peut le ranger en
ressource : le contenu lourd disparaît alors de l'historique, remplacé par une
pièce jointe accompagnée d'un court résumé, tout en restant interrogeable par le
calcul. La conversation s'allège sans rien perdre d'exploitable.

Une ressource n'est pas figée une fois créée : le modèle peut la **compléter au
fil de l'eau**, en plusieurs fois. C'est ce qui lui permet de construire un gros
résultat — un CSV assemblé depuis plusieurs sources, un rapport écrit section
par section — sans jamais devoir tout réécrire à chaque étape, et sans buter sur
la taille d'une seule réponse. Il peut y ajouter du texte qu'il rédige, ou faire
écrire directement le code qu'il exécute dans le bac à sable, ligne après ligne.
Ce qui a déjà été écrit reste acquis, y compris si le calcul s'interrompt en
cours de route : tu récupères le travail partiel plutôt que rien. Dans ce cas la
trace de l'outil le dit — elle apparaît en rouge et porte la mention
« interrompu », pour que tu ne prennes pas un fichier arrêté au milieu pour un
fichier fini.

## espaces — Espaces

Les **Espaces** sont des espaces de travail étanches les uns aux autres. Chacun
a ses propres conversations, ses propres pièces jointes et ses propres
souvenirs. Le modèle ne voit et ne peut agir que sur le contenu de l'Espace
actif : aucun outil ne peut lire ou modifier un autre Espace. C'est utile pour
séparer des sujets qui ne doivent pas déborder l'un sur l'autre (travail,
perso, un projet précis…).

Seule exception : la recherche de conversation dans la palette de commandes
(Ctrl/Cmd+K) porte sur tous tes Espaces, pas seulement l'actif — ouvrir un
résultat d'un autre Espace bascule automatiquement dessus (détails : sujet
`interface`).

Le sélecteur d'Espace est en haut de la barre latérale. L'historique « hors
Espace » est lui-même un Espace, appelé « Général » — il n'a rien de spécial.

Chaque Espace peut porter une **description** libre : un contexte propre à
l'Espace, ajouté à tes instructions habituelles quand tu y travailles (il ne
les remplace pas). Pratique pour cadrer un projet sans redéfinir tes réglages à
chaque fois.

Chaque Espace dispose aussi d'une **bibliothèque de fichiers** (onglet
« Fichiers » de la barre latérale) : des fichiers persistants que le modèle peut
consulter à la demande, étanches comme le reste de l'Espace. Tu l'alimentes de
quatre façons : envoi direct — au bouton « Ajouter un fichier » ou en glissant
des fichiers sur le panneau —, promotion en un clic d'une pièce jointe déjà envoyée,
proposition du modèle lui-même, ou dépôt par le modèle d'un fichier qu'il vient
de produire — demande-lui d'enregistrer dans la bibliothèque un CSV, un script
ou un document qu'il a généré, et il le fera sans que tu aies à le récupérer
puis le rejoindre à la main. Quand c'est lui qui en prend l'initiative, il te
demande confirmation avant d'écrire ; quand c'est toi qui le demandes, il
s'exécute directement. Chaque fichier de la liste porte une **icône de
téléchargement** en haut à droite de sa carte, pour le récupérer sur ta machine.

Supprimer un Espace supprime en cascade ses conversations, ses fichiers et ses
souvenirs propres (double confirmation) ; les souvenirs de profil, valables
partout, restent intacts (détails : sujet `memoire`).

Tu peux **déplacer des conversations** d'un Espace à l'autre : sélecteur
d'Espace en haut de la barre latérale → « Déplacer des conversations… »
(visible dès qu'il existe au moins deux Espaces et que l'Espace actif contient
des conversations). Choisis les conversations puis l'Espace de destination.
C'est le seul moyen de faire passer une conversation d'un Espace à l'autre —
les exports (sujet `exports`) ne se réimportent pas. Une conversation dont un
agent travaille en ce moment ne peut pas être déplacée : sa case est grisée le
temps qu'il finisse (sujet `agents`). Les agents inertes, eux, suivent leur
conversation.

## memoire — mémoire et souvenirs

Le modèle peut garder des **souvenirs** durables : des faits sur toi ou sur ton
travail qu'il réutilise d'une conversation à l'autre. Il les écrit sur ton
instruction explicite (« retiens que… »), ou te demande confirmation quand il
infère quelque chose de lui-même — rien n'est enregistré en douce.

Tu gardes la main : un panneau dédié te laisse consulter, modifier ou supprimer
tes souvenirs directement. Les souvenirs actifs sont réinjectés dans le contexte
à chaque message, pour que le modèle en tienne compte.

Les souvenirs appartiennent à l'Espace où ils sont créés (sujet `espaces`) ; ils
suivent donc son étanchéité et sa suppression en cascade. Un souvenir qui doit
rester valable partout peut être promu au **profil** (portée globale, présente
dans tous les Espaces) depuis l'écran de l'Espace.

Le modèle voit les souvenirs de l'Espace courant **et** ceux du profil, et il
peut corriger ou supprimer les uns comme les autres : ce qu'il lit, il peut y
toucher. En revanche il crée toujours dans l'Espace courant — promouvoir un
souvenir au profil reste ton geste, jamais le sien. Les souvenirs des autres
Espaces lui sont, eux, entièrement invisibles.

Chaque écriture de souvenir par le modèle laisse une trace visible dans la
conversation, annulable d'un clic. Il n'existe pas d'outil de lecture : un
souvenir actif est simplement réinjecté dans le contexte à chaque message,
sans trace dans la conversation (mécanisme détaillé au sujet `contexte`).

La mémoire des souvenirs est distincte de la continuité entre conversations
(résumés automatiques) — voir le sujet `historique`.

## historique — historique et recherche

Tes conversations sont **conservées** et rangées dans la barre latérale par
période (aujourd'hui, hier, plus ancien…). Chaque conversation reçoit un titre
généré automatiquement, que tu peux modifier, et tu peux la rouvrir à tout
moment pour reprendre où tu en étais.

Un **libellé apparaît dès ton premier message**, sans attendre : le début de ce
que tu viens d'écrire s'affiche en italique, le temps que le vrai titre arrive.
L'italique signale que ce n'est pas encore un titre. Le titre, lui, est généré
dès l'envoi plutôt qu'à la fin de l'échange — utile quand la réponse prend du
temps (appels d'outils, agents lancés en parallèle), puisque tu retrouves la
conversation par son titre sans attendre. En contrepartie, sur un serveur qui
traite une requête à la fois, ce titrage peut retarder de quelques instants
l'apparition du début de la réponse : le réglage **Titre dès l'envoi**
(Paramètres → Mémoire) permet de le désactiver, auquel cas le titre arrive à la
fin de l'échange comme avant.

Un titre écrit dès l'envoi ne connaît que ta demande, pas la réponse. Il est
donc **repris une fois l'échange terminé**, quand le contenu traité est connu :
le titre définitif est souvent plus précis. Le réglage **Titre régénéré après la
première réponse** (Paramètres → Mémoire) gouverne cette reprise ; désactive-le
si tu préfères garder le premier titre. Quand le titrage dès l'envoi est éteint,
il n'y a rien à reprendre — le titre est alors simplement écrit en fin
d'échange.

Si tu as toi-même nommé la conversation, rien ne vient l'écraser, à aucun
moment.

Un champ de **recherche** filtre l'historique en temps réel, par titre ou par
mots-clés du contenu. La palette de commandes (Ctrl/Cmd+K) propose la même
recherche, elle étendue à tous tes espaces.

Pour la **continuité entre conversations**, MIAOU résume tes échanges en
arrière-plan et réinjecte ces résumés dans le contexte : le modèle garde ainsi
un fil de ce que vous vous êtes déjà dit, sans que tu aies à tout recopier. Le
modèle peut aussi aller chercher lui-même dans ton historique — lister ou
retrouver une conversation passée par mots-clés — quand ta demande le justifie.
La conversation en cours est toujours exclue de ces recherches.

Quand le modèle cite une conversation passée, elle apparaît comme un lien
cliquable affichant son titre ; cliquer dessus l'ouvre directement.

Tu gardes la main sur ces résumés : un panneau dédié te laisse les consulter,
ouvrir la conversation dont chacun provient, ou les supprimer — supprimer un
résumé ne touche jamais à la conversation elle-même, et reste réversible. Il
liste les résumés de l'Espace courant ; ceux des autres Espaces se consultent
depuis chacun d'eux.

Note : cette continuité vaut à l'intérieur d'un Espace ; un Espace ne voit pas
l'historique d'un autre.

## skills — skills

Les **skills** sont des fragments d'instructions réutilisables que tu écris une
fois et rappelles à volonté. Chacune a un mot-clé d'invocation (son « slug »), un
nom, une description et un corps en Markdown. Tu les gères dans un panneau dédié
(Paramètres → Skills) : création, édition, suppression, et un interrupteur pour
activer ou désactiver chacune.

Deux façons de s'en servir :

- **Invocation directe** : tape `/` suivi du slug dans le composer. Le corps de
  la skill est injecté dans le message envoyé (une autocomplétion t'aide au fil de
  la frappe). Ta bulle n'affiche que ce que tu as tapé ; le contenu injecté
  reste en coulisse mais fait bien partie du message. La palette de commandes
  (Ctrl/Cmd+K → « Invoquer une skill ») fait la même chose : elle insère `/slug `
  dans le composer, prêt à envoyer.
- **Découverte par le modèle** : si ta demande en langage naturel correspond à
  une skill activée, le modèle peut décider seul de la consulter. Une trace
  visible signale alors qu'il l'a lue.
- **Création/modification par le modèle** : à ta demande, le modèle peut aussi
  créer une nouvelle skill ou modifier le contenu d'une existante — une trace
  visible signale la création ou la modification. Modifier une skill déjà
  existante lui demande une confirmation explicite avant d'écraser son contenu.
  Les skills système (voir plus bas) échappent à cela : il les voit signalées
  comme telles et ne peut pas les modifier.

Une skill est utile pour un cadrage récurrent : un style de réponse, une
procédure, un gabarit — tout ce que tu répéterais sinon à la main.

**Importer une skill existante** (par exemple une skill écrite pour Claude Code,
avec un cartouche `--- name: … description: … ---` en tête de fichier) :

- **Coller** le texte dans le champ Contenu d'une skill en édition : slug, nom,
  description sont extraits automatiquement du cartouche et pré-remplissent les
  champs (ceux absents du cartouche restent inchangés) ; le cartouche lui-même
  reste dans le contenu.
- **Glisser-déposer** un fichier `.md` sur le panneau Skills, ou **coller un
  fichier `.md` copié** depuis ton explorateur de fichiers : si son cartouche
  correspond à une skill déjà existante (même nom), tu bascules directement en
  édition de cette skill ; sinon une nouvelle skill est créée, prête à nommer et
  enregistrer.

**Skills système** : quelques skills sont fournies par l'application (par
exemple les règles de syntaxe pour générer un diagramme mermaid valide, ou le
mode d'emploi de certains outils avancés). Elles apparaissent en tête du
panneau Skills, dans une liste distincte, repérables à leur badge « Système ».
Toujours actives, non modifiables ni supprimables : un bouton « Consulter »
affiche leur contenu en lecture seule.

## agents — agents

Le modèle peut lancer un **agent** : une sous-conversation autonome à qui il
confie une tâche précise, et qui travaille en parallèle pendant qu'il continue
de te répondre. Quand l'agent a fini, son résultat revient dans votre
conversation et le modèle enchaîne dessus.

Tu n'as rien à configurer : c'est le modèle qui décide, et tu peux aussi le lui
demander (« lance un agent pour analyser ce log pendant qu'on continue »).

**Ce qu'un agent est, concrètement.** Une conversation comme les autres, mais
qui démarre à froid : elle ne connaît rien de votre échange, seulement la tâche
que le modèle lui a écrite. C'est voulu — c'est ce qui lui permet de travailler
sur un gros sujet sans encombrer votre conversation. En contrepartie, le modèle
doit lui rédiger une consigne qui tient toute seule, et il ne délègue donc pas
n'importe quoi : refaire à froid ce qu'il a déjà sous la main lui coûterait plus
cher que de le faire lui-même.

**Les outils.** Le modèle choisit ce qu'il confie à son agent : par défaut, un
agent n'a aucun outil (il peut quand même rédiger, résumer, reformuler,
analyser un texte qu'on lui donne). S'il a besoin de lire un fichier ou de
calculer, le modèle doit le lui accorder explicitement. Un agent ne peut jamais
en lancer un autre.

**Les fichiers.** Un agent ne voit aucun de tes fichiers par défaut — ni ce que
tu as joint à un message, ni la bibliothèque de l'espace. C'est la même logique
que les outils : le modèle nomme ce qu'il confie, fichier par fichier. Donc si
tu joins un document et que tu demandes de le faire analyser par un agent, le
modèle a bien de quoi le lui transmettre — il te le dira s'il ne le fait pas.
L'agent le lit sans le modifier.

**Ce que tu vois.** Une ligne apparaît dans le fil au lancement, avec en clair
ce qui a été demandé à l'agent. Pendant qu'il travaille, la conversation porte
une pastille qui clignote, comme si elle rédigeait elle-même — parce que c'est
bien elle qui travaille, à travers lui. Le compteur d'agents en haut à droite
le compte aussi (voir le sujet `multitache`). Quand il a fini, son résultat
apparaît dans le fil comme un message, et le modèle repart de là.

**Pendant qu'un agent travaille, tu ne peux pas réécrire l'historique de la
conversation** : le crayon d'édition de tes messages et le bouton qui régénère
la dernière réponse sont grisés, et le curseur te le dit au survol. La raison
est que l'agent va revenir déposer son compte rendu dans ce fil, en réponse à
ce qu'il contenait quand il est parti — le tronquer entre-temps ferait atterrir
sa réponse derrière une question qui n'existe plus. Tu gardes la lecture, le
défilement, la copie, et tu peux continuer à écrire normalement : c'est
seulement la réécriture du passé qui attend. Dès que le dernier agent a fini,
ces boutons redeviennent actifs.

Ce message-là arrive **replié** : tu vois la tâche qui avait été confiée et
l'état dans lequel l'agent s'est arrêté, et tu déplies d'un clic si tu veux lire
le compte rendu entier. Un rapport d'agent est souvent long, et il tombe au
milieu de votre échange — le laisser déplié noierait la conversation. Il n'est
pas modifiable **du tout** — et cette fois définitivement, là où le blocage
décrit plus haut se lève tout seul : c'est le compte rendu d'un travail qui a
réellement eu lieu, le réécrire le ferait diverger de ce que l'agent a produit. Tu peux le copier, et ouvrir le fil de l'agent pour voir le
détail.

**Ouvrir un agent.** Le libellé de la ligne est cliquable : il ouvre le fil de
l'agent, où tu vois tout son travail — ce qu'il a cherché, les outils qu'il a
appelés, ce qu'il a répondu. C'est un geste de curiosité ou de débogage, pas
quelque chose que tu as besoin de faire au quotidien. Les agents n'apparaissent
volontairement **pas** dans ta barre latérale ni dans tes recherches : ils
encombreraient ton historique alors qu'ils appartiennent à la conversation qui
les a lancés.

Une fois dans le fil d'un agent, un bandeau en tête te rappelle de quelle
conversation il vient, et te ramène à elle d'un clic — c'est le chemin du
retour, puisque l'agent n'est nulle part dans ta barre latérale. Tant qu'il
travaille, il est aussi listé dans la pastille du compteur d'agents, en haut à
droite, sous la conversation qui l'a lancé : c'est de là que tu peux ouvrir son
fil sans passer par elle (voir le sujet `interface`). En haut, à la
place du titre, tu lis ce qui a été demandé à l'agent : un agent n'a pas de
titre à lui, et ne se renomme pas.

Dans ce fil, tu peux **arrêter** un agent avec le bouton stop, comme n'importe
quelle réponse. Le modèle en est prévenu et sait que c'est toi qui l'as arrêté.

Tant qu'il travaille, tu peux lui écrire comme dans n'importe quelle
conversation : ton message se met en file et lui est transmis à sa prochaine
étape, ce qui te permet de le réorienter sans attendre — utile quand tu vois
qu'il part de travers, alors que la conversation qui l'a lancé, elle, ne verra
que son compte rendu final. S'il finit avant d'avoir atteint cette étape, ton
message reste visible au-dessus du composer sans avoir été envoyé.
**Une fois son travail fini, son fil passe en lecture seule** :
son résultat est déjà remonté à la conversation qui l'a lancé, et celle-ci a
repris sa route — un message envoyé là n'arriverait à personne. Le bandeau du
haut te dit dans quel état il s'est arrêté (terminé, interrompu, en erreur…).
Tu peux toujours le lire, le parcourir et revenir à sa conversation d'origine.
Si tu veux poursuivre le travail, c'est à cette conversation-là qu'il faut le
demander : elle relancera un agent.

**Ce qui les borne.** Trois garde-fous, pour éviter qu'un agent parte
indéfiniment ou qu'ils s'accumulent : au plus {{MAX_AGENTS_PER_CONV}} agents
simultanés par conversation, {{MAX_AGENTS_TOTAL}} toutes conversations
confondues, et un nombre maximum d'étapes qu'un agent peut enchaîner avant
d'être arrêté d'office. Dans ce dernier cas son travail partiel est quand même
transmis, en étant signalé comme incomplet — le modèle sait qu'il ne doit pas le
prendre pour un résultat fini. Ces valeurs sont fixées à l'installation et
peuvent donc différer d'un déploiement à l'autre.

**Suppression.** Un agent vit avec la conversation qui l'a lancé : supprimer
celle-ci supprime ses agents, et arrête ceux qui tournaient encore. Déplacer une
conversation vers un autre Espace emmène ses agents avec elle ; tant que l'un
d'eux travaille, le déplacement est refusé (sa case est grisée), le temps qu'il
finisse.

Comme les réponses en cours, un agent ne survit pas au rechargement de la page.

## mcp — serveurs compagnons MCP

Au-delà de ses fonctions intégrées, MIAOU peut se connecter à des **serveurs
compagnons** (serveurs MCP distants) qui ajoutent des outils au modèle. Pour toi
comme pour le modèle, tout apparaît dans un seul ensemble d'outils : l'usage est
transparent, l'origine ne l'est pas. Les outils venus d'un serveur compagnon
portent un **nom préfixé** par le serveur (par exemple `miaou-proxy__web__…`) ;
le modèle peut donc constater, à la seule lecture de sa propre liste d'outils,
quels serveurs sont branchés et ce qu'ils apportent — il n'a pas besoin d'un
outil dédié pour « lister les serveurs », l'information est déjà sous ses yeux.

Ces serveurs sont **optionnels** : ils n'existent que si tu les as configurés
(Paramètres → Serveurs MCP). Selon ceux que tu ajoutes, le modèle peut par
exemple :

- **Lire une page web** à partir de son adresse, ou **rechercher sur le web**.
- **Extraire le contenu de documents** — mais ce n'est plus nécessaire : les
  archives zip, les PDF, les classeurs Excel, les documents Word et les
  présentations PowerPoint sont désormais tous ouverts par MIAOU lui-même (voir
  le sujet `documents`). Un serveur d'extraction documentaire garde un seul
  usage, qui reste réel : le travail **hors connexion**. L'ouverture native
  télécharge son moteur depuis internet au premier document d'un format donné ;
  sans réseau, elle ne peut pas s'amorcer, là où un serveur local tourne chez
  toi. Si tu travailles souvent déconnecté, c'est la raison de garder ce serveur
  configuré.
- Répondre à des besoins ponctuels (météo, calculs, etc.) selon les serveurs
  disponibles.

Si aucun serveur n'est configuré, ces capacités ne sont simplement pas là ; le
reste de MIAOU fonctionne normalement. Un serveur injoignable est ignoré sans
bloquer les autres.

**Quand un serveur demande une autorisation.** Certains serveurs compagnons
donnent accès à des services qui exigent que tu t'identifies — un espace de
notes, un agenda, une messagerie. Tu n'as pas besoin d'attendre un échec pour
l'apprendre : dès la connexion au démarrage, une pastille apparaît en haut à
droite (« 1 serveur à autoriser ») et t'emmène, d'un clic, sur la liste des
serveurs compagnons.

Là, le serveur concerné reste marqué comme connecté — ses outils sont bien
disponibles — mais son état signale ce qui attend, et une ligne apparaît pour
chaque service à autoriser, avec son bouton **Autoriser**. Le bouton ouvre la
page d'autorisation dans un nouvel onglet ; en revenant sur MIAOU, l'état se
remet à jour tout seul.

Si l'appel a lieu avant que tu aies autorisé, il échoue proprement : la ligne
d'appel devient rouge dans la conversation et porte elle aussi un lien
**Autoriser**. Une fois l'accès accordé, il suffit de redemander la même chose
au modèle. Ce lien-là reste attaché à la conversation : tu peux fermer MIAOU, y
revenir plus tard et cliquer à ce moment-là.

Le modèle, lui, ne peut rien faire de cette étape : il n'a aucun moyen
d'autoriser un accès à ta place, et c'est délibéré. Il se contente de te
signaler que l'action attend ton feu vert, puis continue avec ce qu'il peut
faire sans.

Un détail de sûreté qui vaut d'être connu : quand c'est le serveur lui-même qui
fournit l'adresse complète, MIAOU ne l'affiche que si elle est sécurisée
(`https`) ou qu'elle pointe vers ta propre machine ; dans tout autre cas aucun
lien n'apparaît, la ligne reste rouge avec son message. Le bouton de la liste
des serveurs, lui, ne prend au serveur que la fin de l'adresse : le début est
celui que tu as toi-même saisi en configurant ce serveur.

Pour l'accès au web, le projet compagnon **miaou-mcp-servers** fournit des
serveurs prêts à l'emploi (téléchargement et recherche de pages web) : c'est la
façon recommandée d'ajouter cette capacité à MIAOU. Il fournit aussi un serveur
d'extraction documentaire, qui n'est plus la voie normale d'ouverture d'un
document mais reste le recours hors connexion. Il est open source :
https://github.com/dJeyL/miaou-mcp-servers

## exports — exports et sauvegardes

Tu peux sortir tes conversations de MIAOU de plusieurs manières :

- **Une réponse seule** en Markdown : au survol d'un message du modèle, un
  bouton la télécharge en `.md`.
- **La conversation entière en page HTML autonome** : l'icône de téléchargement
  à droite du titre, en haut. Le fichier obtenu est un instantané complet —
  coloration figée, diagrammes inclus en image — lisible dans n'importe quel
  navigateur sans MIAOU ni connexion. Idéal pour archiver ou partager par mail.
  Les images y sont embarquées et restent cliquables — celles qui apparaissent
  dans le fil, donc pas les pages de PDF rendues pour le modèle
  (cf. `documents`).
- **La conversation entière en Markdown** : la même icône, cliquée en gardant
  **Shift** enfoncé. L'export inclut la trace des outils utilisés à chaque tour.
  Dans un export, les paramètres et résultats de ces appels sont **abrégés** :
  ils sont là pour situer ce qui s'est passé, pas pour rejouer l'appel. Pour le
  détail complet, la loupe de chaque trace ouvre l'inspecteur d'appel dans
  l'application (sujet `traces-outils`).
  Sans clavier, l'entrée `Exporter la conversation (Markdown)` de la palette de
  commandes fait la même chose.

Les pages HTML produites embarquent **les deux thèmes** (clair et sombre). Elles
s'ouvrent sur celui qui était actif au moment de l'export, et un bouton en haut
à droite permet de basculer à la lecture ; ton choix est retenu et s'applique à
tous tes exports, y compris ceux que tu produiras plus tard. Cette bascule
fonctionne **sans JavaScript** : elle marche donc partout, y compris dans les
visionneuses de pièces jointes qui n'exécutent aucun script
(l'aperçu de fichier d'iOS, par exemple). Le réglage **« Export HTML
interactif »** (réglages, section « Apparence ») ne la conditionne pas : activé
par défaut, il ajoute seulement les boutons copier/télécharger sur les blocs de
code, et fait retenir ton choix de thème d'une ouverture à l'autre. Décoché, la
bascule reste disponible, mais le choix n'est plus mémorisé. Les diagrammes,
eux, gardent dans tous les cas les couleurs qu'ils avaient à l'export.

Ces exports sont à sens unique : ce sont des fichiers de lecture, il n'existe
aucune fonction pour réimporter un `.md` ou un `.html` exporté dans MIAOU (ni
pour le remettre dans un Espace — voir le sujet `espaces` pour déplacer une
conversation existante entre Espaces).

**Convertir un fichier Markdown quelconque.** Indépendamment des conversations,
MIAOU sait transformer n'importe quel fichier `.md` en page HTML au même format.
C'est dans les réglages, section « Outils & extensions » : tu choisis un fichier
ou tu le déposes sur la zone prévue, et le `.html` correspondant se télécharge
(même nom, extension changée). Si le document commence par un titre de niveau 1,
celui-ci sert d'en-tête à la page ; sinon la page n'a pas d'en-tête et la date
figure en pied. Cette conversion est purement locale : le modèle n'est pas
sollicité et rien n'est envoyé nulle part.

Côté blocs de code, chaque bloc a ses propres boutons pour **copier** ou
**télécharger** son contenu (avec la bonne extension selon le langage), et les
diagrammes peuvent être exportés en image SVG ou PNG. Sur un bloc **Markdown**,
un bouton supplémentaire le convertit directement en page HTML — même résultat
que la conversion de fichier ci-dessus, sans passer par un `.md` intermédiaire.

## contexte — contexte envoyé au modèle

À chaque message que tu envoies, MIAOU ne transmet pas que ton texte : il y
ajoute automatiquement un **contexte** pour que le modèle réponde en connaissance
de cause. Ce contexte comprend, selon le cas, tes instructions système, la
définition des outils disponibles (y compris ceux des serveurs compagnons), tes
souvenirs actifs (sujet `memoire`), les résumés des conversations passées jugés
pertinents, la date du jour et le manifeste de la bibliothèque de fichiers de
l'Espace (sujet `espaces`). Tout cela part vers l'API **à chaque tour**, en plus
de ton message — donc oui, cela consomme des tokens en entrée, au-delà de ce
que tu as tapé toi-même.

Deux idées à ne pas confondre :

- **Le compteur « ≈ N tok »** (dans le composer) mesure ce qui part réellement.
  Clique-le pour voir la ventilation part par part.
- **La taille de fenêtre de contexte** réglée dans les Paramètres n'est **pas**
  un levier de réduction : c'est le dénominateur qui sert à afficher un taux de
  remplissage (« combien sur le maximum du modèle »). La modifier ne change rien
  à ce qui est envoyé — c'est une jauge, pas un robinet.

Les **vrais leviers** pour alléger ce qui part à chaque tour :

- **Résumés** : leur injection a un mode réglable (automatique, sur proposition,
  ou jamais). En mode « jamais », aucun résumé n'est ajouté au contexte.
- **Souvenirs** : les souvenirs actifs sont réinjectés à chaque message ; en
  supprimer ou en mettre en veille réduit d'autant le contexte.
- **Pièces jointes** : une image ne part en pleine résolution qu'au tour où tu la
  joins, puis MIAOU la réduit à une trace légère (voir pièces jointes) — c'est
  déjà une optimisation intégrée.
- **Serveurs compagnons** : chaque serveur branché ajoute la définition de ses
  outils au contexte. En débrancher un allège la liste d'outils envoyée.

Note sur le **cache KV** : MIAOU est conçu pour que la partie stable du contexte
(instructions système, définitions d'outils) reste **identique octet pour octet**
d'un tour à l'autre, et place le contenu qui varie (date, mémoire, résumés) en
préfixe éphémère du dernier message. Un backend qui gère un cache KV par préfixe
(Ollama, par exemple) peut ainsi réutiliser le calcul de cette partie stable au
lieu de tout recalculer à chaque tour. Changer d'Espace actif, ou modifier tes
instructions système, casse volontairement ce préfixe stable (le contexte change
vraiment) : c'est attendu.

## interface — repères à l'écran

Quelques repères pour te déplacer dans MIAOU :

- **Barre latérale** : le sélecteur d'Espace en haut, puis tes conversations
  rangées par période, avec la recherche. Elle est redimensionnable.
- **Composer** (en bas) : ta zone de saisie. Le bouton d'envoi devient un
  **stop** pendant que le modèle répond — le texte déjà reçu est conservé. Ce
  stop ne concerne que la conversation **affichée** : si d'autres conversations
  travaillent en arrière-plan, elles continuent. Si le modèle est en plein
  appel d'outil au moment du clic, l'arrêt est pris en compte tout de suite
  mais se concrétise à la fin de cet appel (pas de coupure en plein milieu) —
  le bouton se fige le temps d'y arriver, pour t'éviter de recliquer pour rien.
  À côté, le trombone pour joindre des fichiers.
- **Largeur de lecture** : sous le composer, à droite, deux petits boutons
  « – » et « + » élargissent ou resserrent la zone centrale (le fil et le
  composer ensemble). La largeur d'origine est la plus étroite : le « – » est
  éteint tant que tu n'as pas élargi. Ton choix est conservé d'une session à
  l'autre et s'applique à tes autres onglets ouverts.
- **Blocs de code très longs** : un bloc plus haut que l'écran ne pousse plus
  la suite de la conversation hors de portée — il s'arrête à environ 80% de la
  hauteur de lecture et défile à l'intérieur de son propre cadre, son en-tête
  (langage, copier, télécharger) restant visible pendant que tu le parcours.
  Le fichier obtenu par le bouton « télécharger », lui, contient toujours le
  bloc entier, et les pages HTML exportées ne coupent rien.
- **Raisonnement** : pour les modèles qui réfléchissent à voix haute, une icône
  dans l'en-tête du message ouvre un bloc dépliable montrant leur cheminement,
  gardé à part de la réponse.
- **Sélecteur serveur/modèle** (optionnel, à activer dans les Paramètres) :
  change le modèle de la conversation courante sans toucher à ton défaut. Si
  plusieurs serveurs API sont configurés, il liste les modèles de chacun,
  regroupés par serveur ; choisir un modèle d'un autre serveur bascule aussi le
  serveur actif. Un serveur dont la liste de modèles n'a pas pu être récupérée
  apparaît quand même, avec une ligne « Liste indisponible » à cliquer pour
  réessayer. Un serveur peut être « mis de côté » depuis sa fiche (Paramètres →
  Serveurs API) pour ne plus être interrogé ni proposé.
- **Palette de commandes** : appuie sur **Ctrl+K** (ou **Cmd+K** sur Mac) pour
  ouvrir une palette : tape pour filtrer, ↑/↓ pour naviguer, Entrée pour lancer,
  Échap pour fermer. Elle donne accès aux actions courantes sans la souris —
  nouvelle conversation, réglages, souvenirs, résumés, skills, serveurs MCP,
  inspecteur de contexte, bascule de thème et de coloration, export de la
  conversation. Certaines entrées ouvrent un **sous-mode** où la palette filtre
  une liste dédiée : choisir un modèle, invoquer une skill, changer d'espace, ou
  rechercher une conversation — seule exception à l'étanchéité des Espaces
  (sujet `espaces`), cette recherche porte sur tous tes espaces (Échap revient en
  arrière).
  - **Raccourcis directs** : la palette une fois ouverte (champ vide), une seule
    touche lance la commande — la lettre est affichée à gauche de chaque ligne.
    En résumé, `Ctrl/Cmd+K` puis : `N` nouvelle conversation, `F` rechercher une
    conversation, `M` changer de modèle, `K` invoquer une skill, `E` changer
    d'espace, `,` réglages, `P` souvenirs (profil), `R` résumés, `G` gérer les
    skills, `S` serveurs MCP, `C` inspecteur de contexte, `T` thème clair/sombre,
    `H` coloration syntaxique, `D` export Markdown, `W` export HTML.

## apparence — apparence : thème, fontes, couleurs

Ces réglages sont indépendants les uns des autres : ils se combinent librement,
et ton choix est conservé d'une session à l'autre.

- **Thème clair / sombre** et coloration syntaxique se règlent dans les
  Paramètres.
- **Fontes** : trois lots de polices au choix dans les Paramètres — **Graphite**
  (l'aspect d'origine), **Atelier** et **Chaleur**. Chaque lot associe une
  police de texte et une police à chasse fixe (blocs de code) choisies pour
  aller ensemble. Réglage indépendant du thème et de la palette.
- **Palette de couleurs** : trois jeux de couleurs au choix dans les Paramètres
  — **Ambre** (orange sur gris froids, l'aspect d'origine), **Encre** (bleu sur
  bleu-nuit) et **Forêt** (vert jade sur gris-vert). C'est un réglage
  indépendant du thème clair/sombre : chaque palette a sa version claire et sa
  version sombre, et changer l'un ne change pas l'autre.
- **Animations** : un réglage dans les Paramètres
  (Normales / Réduites / Suivre le système) coupe toutes les transitions et
  animations visuelles de l'interface — utile en cas de gêne au mouvement ou de
  préférence pour un affichage instantané. « Suivre le système » s'aligne sur la
  préférence de réduction d'animations de ton OS.

## multitache — travailler en parallèle

MIAOU ne t'oblige pas à attendre : tu peux écrire pendant que le modèle
travaille, lancer plusieurs réponses de front, et suivre ce qui bouge ailleurs
sans perdre ta place.

- **Ajouter en cours de route** : si le modèle travaille (surtout quand il
  enchaîne plusieurs outils), tu peux **taper un message et appuyer sur Entrée
  sans l'interrompre** — il se met en file au-dessus du composer et lui est
  transmis dès la prochaine étape, ce qui te permet de le **réorienter avant
  qu'il ait fini**. Le message en attente reste modifiable (clique dessus pour
  le récupérer dans le composer) ou annulable (la croix). Si tu en mets
  plusieurs, ils partent fusionnés. Le bouton reste un stop pendant ce temps.
  Ce message appartient à **la conversation où tu l'as tapé** : si tu pars
  ailleurs, il ne te suit pas — tu le retrouves en revenant, et il part bien
  dans cette conversation-là, même si tu regardes autre chose au moment où elle
  le reçoit. Chaque conversation a donc sa propre file. Cela vaut aussi dans le
  fil d'un **agent** au travail : tu peux le réorienter pendant qu'il enchaîne
  ses outils, sans passer par la conversation qui l'a lancé (sujet `agents`).
  S'il termine avant d'avoir atteint son prochain point d'étape, ton message
  reste affiché au-dessus du composer, sans être parti : tu peux le copier ou
  l'écarter.
- **Plusieurs réponses à la fois** : quitter une conversation ne l'interrompt
  plus. Tu peux poser une question, partir vers une autre conversation — ou même
  changer d'Espace — pendant que le modèle rédige : il continue, va au bout de
  ses outils, et range sa réponse dans **sa** conversation. Tu la retrouves
  complète en y revenant. Plusieurs conversations peuvent ainsi travailler en
  même temps. Ça ne survit pas au rechargement de la page : recharger pendant
  qu'une réponse arrive la perd (la question, elle, reste).
- **Pastilles d'activité** : un petit point signale ce qui bouge sans que tu
  aies à surveiller.
  - **Point qui clignote** : cette conversation est en train de travailler — soit
    qu'elle rédige une réponse, soit qu'un agent qu'elle a lancé travaille pour
    elle (voir le sujet `agents`).
  - **Point fixe, un peu plus gros** : la réponse est terminée et tu ne l'as pas
    encore vue. Ouvrir la conversation suffit à l'éteindre.
  - Le point apparaît sur la conversation dans la barre latérale, et aussi sur
    le **sélecteur d'Espace** quand l'activité se passe dans un autre Espace
    (déplie-le : chaque Espace concerné porte alors son propre point). Barre
    latérale masquée, il se replie sur l'**icône du menu** en haut à gauche.
  - S'il y a à la fois du terminé-non-vu et du en-cours, le point fixe l'emporte
    sur ces indicateurs de groupe — le détail se lit en dépliant.
  - Ces points sont volatiles : ils disparaissent si tu recharges la page.
- **Compteur d'agents** : en haut à droite, une pastille « 1 agent » / « 3
  agents » indique combien de choses travaillent en ce moment, tous Espaces
  confondus. Un **agent**, ici, c'est toute conversation en train de produire une
  réponse : selon les outils dont il dispose, il peut enchaîner plusieurs étapes
  de lui-même (chercher, lire un fichier, calculer) avant de répondre. Cela
  inclut les **sous-conversations que le modèle lance lui-même** pour une tâche
  précise (voir le sujet `agents`) : si le modèle en lance une pendant qu'il te
  répond, le compteur en indique deux, parce que deux choses travaillent. Une
  conversation qui a lancé des sous-conversations et attend leurs résultats est
  comptée elle aussi : elle a du travail en cours, même si elle n'écrit rien
  pour l'instant. Le compteur n'apparaît que s'il t'apprend quelque chose : une
  seule réponse en cours, que tu es en train de regarder arriver, ne l'affiche
  pas — le bouton stop du composer le dit déjà.
- **Voir ce qui travaille, et y aller** : la pastille du compteur s'ouvre d'un
  clic sur la liste de ce qui est en cours. Les conversations que tu as lancées
  y figurent, et sous chacune, **décalées vers la droite**, les
  sous-conversations qu'elle a elle-même lancées. Chaque ligne dit où elle en
  est, et porte le nom de son Espace quand ce n'est pas celui où tu te trouves.
  Cliquer sur une ligne t'y emmène — en changeant d'Espace au passage si besoin
  — et referme la liste. La même liste s'obtient au clavier par la palette de
  commandes (`Cmd+K`, puis `A`), où tu peux la filtrer en tapant. Elle disparaît
  quand plus rien ne travaille. Les sous-conversations terminées n'y restent
  pas : leur résultat revient à la conversation qui les a lancées, c'est là
  qu'il se lit.
- **Serveurs à autoriser** : en haut à droite également, une pastille « 1
  serveur à autoriser » apparaît quand un serveur compagnon donne accès à un
  service qui attend que tu t'identifies. Elle ouvre la liste des serveurs, où
  chaque accès en attente porte son bouton. Elle n'existe que dans ce cas :
  quand tout est autorisé, rien ne s'affiche. Voir le sujet `mcp`.
- **Plusieurs onglets** : tu peux ouvrir MIAOU dans plusieurs onglets du même
  navigateur ; ils restent synchronisés. Une modification faite dans un onglet
  (nouveau message, titre, réglage, fichier, ou la liste des Espaces quand tu en
  crées, renommes ou supprimes un…) se reflète dans les autres sans rechargement.
  L'Espace **actif**, en revanche, reste propre à chaque onglet : c'est ce que
  tu regardes, pas une donnée partagée — tu peux donc travailler dans deux
  Espaces différents dans deux onglets. Si la même conversation est ouverte à
  deux endroits, un
  bandeau discret le signale. Et si une réponse est en cours de génération dans
  un onglet, la même conversation passe en **lecture seule** dans les autres le
  temps de la réponse — pour éviter deux générations concurrentes qui
  s'écraseraient ; tu peux toujours lire et faire défiler. La synchro est locale
  à ton navigateur (elle ne relie pas deux machines ni deux navigateurs
  différents).

## traces-outils — traces d'outils et inspection

Quand le modèle se sert d'outils, chaque action laisse une trace dans le fil.
Voici ce que tu peux en faire, et comment voir ce qui est réellement envoyé au
modèle.

- **Étapes d'outils** : quand le modèle enchaîne plusieurs actions (mémoire,
  recherche, outils distants…) pour une même réponse, elles s'affichent en
  mode compact — un badge « N étapes » à cliquer pour tout déplier en liste, et
  se replier à nouveau.
- **Récupérer un fichier produit par un outil** : chaque trace d'outil qui porte
  sur un fichier — « Ressource enregistrée », « Ressource présentée », « Pièce
  jointe rappelée » — a une icône de téléchargement à son extrémité. Ça vaut
  aussi pour les fichiers qui ne s'affichent pas dans la conversation (un CSV,
  un JSON produit pour un calcul) : la trace est parfois le seul endroit d'où
  les récupérer. Si le fichier n'est plus disponible, l'icône devient inerte.
- **Voir le détail d'un appel d'outil** : chaque trace d'outil porte une petite
  **loupe** qui ouvre un panneau de détail — ce que le modèle a réellement
  envoyé (les paramètres de l'appel), ce que l'outil a réellement répondu, et de
  quel outil et de quel serveur il s'agit, avec l'heure et l'issue (succès ou
  échec). Rien n'est tronqué, contrairement aux exports. Le contenu est présenté
  selon sa nature plutôt que brut : un code exécuté s'affiche comme du code
  coloré, un JSON est remis en forme et indenté, un paramètre long tenant sur
  plusieurs lignes garde ses retours à la ligne. Si l'appel a produit un
  fichier, le panneau le décrit (nom, identifiant, type, taille), propose de le
  télécharger, et selon ce qu'il est : affiche une image en vignette (clique
  pour l'agrandir), montre le contenu d'un fichier texte, et pour un SVG te
  laisse voir **soit sa source, soit le dessin** (l'icône en forme d'œil).
  Un fichier trop volumineux n'est pas prévisualisé — il reste téléchargeable.
  La loupe n'apparaît que sur les traces dont le détail a été conservé : les
  conversations les plus anciennes peuvent en être dépourvues.
- **Compteur de contexte** : un « ≈ N tok » dans le composer, cliquable, ouvre
  un panneau qui détaille ce qui est envoyé au modèle (tes instructions, les
  outils, la mémoire, les résumés, l'historique, les pièces jointes…) avec une
  estimation du poids de chaque part. Utile pour comprendre ce que « voit » le
  modèle et surveiller le remplissage de la fenêtre de contexte. La taille de
  fenêtre réglée dans les Paramètres est **seulement le dénominateur** de ce
  calcul (le « N tok sur combien ») : c'est un indicateur d'atteinte de la
  limite, pas un filtre — la changer ne réduit ni n'augmente ce qui part
  réellement à l'API. Pour ce qui pèse et comment l'alléger, voir le sujet
  contexte.

## donnees — tes données et leur stockage

MIAOU s'exécute **entièrement dans ton navigateur**. Il n'y a pas de serveur
applicatif MIAOU : tes conversations, tes souvenirs, tes skills, tes Espaces et
tes fichiers sont stockés **localement**, sur ta machine, dans le stockage du
navigateur. Rien n'est envoyé ailleurs que vers l'API du modèle que tu as
configurée (et vers les serveurs compagnons que tu aurais ajoutés).

Le navigateur offre deux emplacements de stockage, et MIAOU se sert des deux
selon la taille de ce qu'il range :

- **Le stockage local** (`localStorage`), petit mais simple, garde ce qui est de
  taille stable : tes réglages, ta clef d'API, tes serveurs API et compagnons,
  la liste de tes Espaces et tes souvenirs.
- **La base de données du navigateur** (`IndexedDB`, base `miaou`), sans limite
  pratique, garde ce qui grossit avec l'usage : **tes conversations** et leurs
  résumés, tes skills, et les fichiers de tes bibliothèques d'Espaces ainsi que
  les pièces jointes de tes messages.

Les conversations ont vécu dans le stockage local jusqu'à ce qu'elles en
saturent la capacité (quelques mégaoctets) ; elles sont désormais dans la base,
et le déménagement se fait tout seul au premier démarrage — il n'y a rien à
faire, et rien ne se perd.

Pour savoir ce que tout cela pèse : **Réglages › Données** affiche l'espace
occupé, la part du quota qu'il représente, et une ventilation par catégorie
(conversations, résumés, fichiers, skills, réglages). Le chiffre est mesuré par
MIAOU en pesant ses propres données ; l'occupation réelle de l'origine est
légèrement supérieure, le navigateur ajoutant ses index et sa propre surcharge.
Pour aller voir dans le menu du navigateur : outils de développement, onglet
« Application » (Chrome) ou « Stockage » (Firefox).

**Sauvegarder et restaurer tout MIAOU.** Réglages › Données propose « Exporter
les données » : un fichier `.zip` qui contient absolument tout — conversations,
résumés, souvenirs, skills, fichiers, Espaces, serveurs et réglages. C'est la
seule vraie sauvegarde, et c'est aussi le seul moyen d'emporter ton MIAOU vers
un autre navigateur ou une autre machine. « Importer les données » le relit et
**remplace l'intégralité** de ce qui est en place (un récapitulatif s'affiche,
avec une confirmation à donner deux fois). Les anciennes sauvegardes `.json`
restent acceptées telles quelles.

Attention à un malentendu que l'archive invite : **compresser n'est pas
chiffrer**. Un `.zip` s'ouvre avec n'importe quel outil, et il contient tes
clefs d'API et tes tokens en clair, exactement comme le `.json` d'avant.
Range-le comme un fichier sensible.

Ne pas confondre avec l'export d'une **conversation** en Markdown ou en HTML
(sujet `exports`) : celui-là produit un document de lecture, qui ne se
réimporte pas.

Il existe une seconde façon de perdre ces données, plus rare que l'effacement
manuel. Par défaut le navigateur range le stockage d'un site en mode
« best-effort » : il le conserve normalement, mais s'autorise à le supprimer
sous forte pression disque, sans prévenir. Le mode « persistant », lui, met le
site à l'abri de ce ménage automatique. MIAOU demande ce mode dès qu'il écrit un
fichier, et c'est le navigateur qui tranche selon ses propres critères —
généralement favorables à un site visité régulièrement, installé comme
application ou mis en favori. Le risque reste faible, et sans commune mesure
avec celui d'un effacement des données de site ; la sauvegarde complète
ci-dessus reste la seule vraie parade.

Conséquences pratiques :

- Tes données restent sur cet appareil et ce navigateur. Changer de navigateur
  ou de machine ne les emporte pas automatiquement. La sauvegarde complète
  (Réglages › Données) est le seul moyen de les emporter.
- Vider les données de site du navigateur efface aussi MIAOU. Pense à
  sauvegarder ce qui compte.
- La clef d'API que tu saisis est conservée localement, en clair. C'est adapté à
  un usage personnel ; pour un contexte exposé, mieux vaut passer par un accès
  protégé côté serveur.

Ce que tu envoies au modèle (tes messages, le contexte injecté) part bien sûr
vers l'API configurée pour être traité — c'est le principe même d'un client de
chat. Ce contexte injecté n'est pas gratuit en tokens ; pour savoir ce qu'il
contient et comment l'alléger, voir le sujet `contexte`. Le reste ne quitte pas
ton navigateur.

## genese — genèse du projet

MIAOU est né d'un besoin concret. Julien L. (alias **dJeyL**) avait au travail,
faute d'accès à mieux, un endpoint « dev only » exposant un modèle — brut, sans
interface digne de ce nom. Plutôt que de s'en contenter, il a décidé d'en faire
un vrai chatbot : intelligent, agréable à utiliser, joli, et bardé de fonctions
qui en jettent — mémoire, Espaces, skills, exports, diagrammes — épaulé par des
serveurs MCP maison pour le web et les documents.

Il ne l'a pas écrit seul : il l'a construit **en binôme avec Claude**
(Anthropic), au fil des versions de modèles, de Sonnet à Fable en passant par
Opus. Lui aux commandes — architecture, décisions, exigences, relectures —
Claude au clavier sur sa dictée. Un projet de bout en bout mené à quatre mains,
dont deux virtuelles.

Côté technique, MIAOU est volontairement minimaliste : **un seul fichier HTML
autonome**, sans framework, sans bundler, sans serveur applicatif — tout tourne
dans le navigateur, en JavaScript pur, contre n'importe quelle API compatible
OpenAI. Les capacités web et documents viennent de serveurs MCP distants
optionnels (le projet compagnon miaou-mcp-servers).

Les deux dépôts sont open source :

- MIAOU (ce client) : https://github.com/dJeyL/miaou
- Serveurs compagnons : https://github.com/dJeyL/miaou-mcp-servers
