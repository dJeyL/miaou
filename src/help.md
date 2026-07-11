## overview

MIAOU est un client de chat web pour dialoguer avec un modèle de langage. Tu
discutes avec le modèle en langage naturel ; il peut répondre, raisonner à voix
haute quand il en est capable, afficher du code coloré, dessiner des diagrammes,
et se servir d'outils pour retrouver des informations dans tes conversations
passées, tes souvenirs ou tes fichiers.

Ce que tu peux faire ici :

- **Discuter** avec streaming en direct, arrêter une réponse en cours, éditer un
  de tes messages pour repartir de ce point.
- **Joindre des fichiers** à un message : images et fichiers texte.
- **Organiser** ton travail en Espaces étanches, chacun avec ses conversations,
  ses fichiers et ses souvenirs.
- **Garder de la mémoire** : le modèle résume tes échanges et peut enregistrer
  des souvenirs durables pour te reconnaître d'une conversation à l'autre.
- **Étendre** le modèle avec des skills (instructions réutilisables) et des
  outils distants (serveurs compagnons, si configurés).
- **Exporter** une conversation en Markdown ou en page HTML autonome.

Pour en savoir plus sur un sujet précis, demande-moi : pièces jointes, Espaces,
mémoire, historique, skills, outils distants, exports, interface, ou données
personnelles.

## attachments

Tu peux joindre des fichiers à un message avant de l'envoyer : clique sur le
trombone du composer, ou fais un glisser-déposer, ou colle directement une image
depuis le presse-papier. Deux types sont acceptés : **images** (le modèle les
voit réellement, s'il gère la vision) et **fichiers texte** (leur contenu est
transmis au modèle).

Une fois envoyées, les pièces jointes apparaissent comme des vignettes sous ton
message. Tu peux les rouvrir : cliquer sur une image l'affiche en plein écran,
et un bouton permet de la retélécharger. Le modèle peut aussi redemander une
pièce jointe d'un message précédent quand il en a besoin pour répondre.

Les images ne sont envoyées en pleine résolution qu'au moment où tu les joins ;
ensuite le modèle en garde une trace légère plutôt que de recharger les pixels à
chaque tour, pour rester économe. Si tu veux qu'un fichier reste disponible
durablement (pas seulement le temps d'un message), promeus-le dans la
bibliothèque de fichiers de ton Espace — voir le sujet Espaces.

## spaces

Les **Espaces** sont des espaces de travail étanches les uns aux autres. Chacun
a ses propres conversations, ses propres pièces jointes et ses propres
souvenirs. Le modèle ne voit et ne peut agir que sur le contenu de l'Espace
actif : aucun outil ne peut lire ou modifier un autre Espace. C'est utile pour
séparer des sujets qui ne doivent pas déborder l'un sur l'autre (travail,
perso, un projet précis…).

Le sélecteur d'Espace est en haut de la barre latérale. L'historique « hors
Espace » est lui-même un Espace, appelé « Général » — il n'a rien de spécial.

Chaque Espace peut porter une **description** libre : un contexte propre à
l'Espace, ajouté à tes instructions habituelles quand tu y travailles (il ne
les remplace pas). Pratique pour cadrer un projet sans redéfinir tes réglages à
chaque fois.

Chaque Espace dispose aussi d'une **bibliothèque de fichiers** (écran de
l'Espace → « Fichiers ») : des fichiers persistants que le modèle peut consulter
à la demande, étanches comme le reste de l'Espace. Tu l'alimentes de trois
façons : envoi direct, promotion en un clic d'une pièce jointe déjà envoyée, ou
proposition du modèle lui-même (toujours confirmée par toi avant écriture).

Supprimer un Espace supprime en cascade ses conversations, ses fichiers et ses
souvenirs propres (double confirmation) ; les souvenirs de profil, valables
partout, restent intacts.

## memory

Le modèle peut garder des **souvenirs** durables : des faits sur toi ou sur ton
travail qu'il réutilise d'une conversation à l'autre. Il les écrit sur ton
instruction explicite (« retiens que… »), ou te demande confirmation quand il
infère quelque chose de lui-même — rien n'est enregistré en douce.

Tu gardes la main : un panneau dédié te laisse consulter, modifier ou supprimer
tes souvenirs directement. Les souvenirs actifs sont réinjectés dans le contexte
à chaque message, pour que le modèle en tienne compte.

Les souvenirs appartiennent à l'Espace où ils sont créés. Un souvenir qui doit
rester valable partout peut être promu au **profil** (portée globale, présente
dans tous les Espaces) depuis l'écran de l'Espace.

Chaque écriture ou lecture de souvenir par le modèle laisse une trace visible
dans la conversation ; les écritures sont annulables d'un clic.

La mémoire des souvenirs est distincte de la continuité entre conversations
(résumés automatiques) — voir le sujet historique.

## historique

Tes conversations sont **conservées** et rangées dans la barre latérale par
période (aujourd'hui, hier, plus ancien…). Chaque conversation reçoit un titre
généré automatiquement, que tu peux modifier, et tu peux la rouvrir à tout
moment pour reprendre où tu en étais.

Un champ de **recherche** filtre l'historique en temps réel, par titre ou par
mots-clés du contenu.

Pour la **continuité entre conversations**, MIAOU résume tes échanges en
arrière-plan et réinjecte ces résumés dans le contexte : le modèle garde ainsi
un fil de ce que vous vous êtes déjà dit, sans que tu aies à tout recopier. Le
modèle peut aussi aller chercher lui-même dans ton historique — lister ou
retrouver une conversation passée par mots-clés — quand ta demande le justifie.
La conversation en cours est toujours exclue de ces recherches.

Quand le modèle cite une conversation passée, elle apparaît comme un lien
cliquable affichant son titre ; cliquer dessus l'ouvre directement.

Note : cette continuité vaut à l'intérieur d'un Espace ; un Espace ne voit pas
l'historique d'un autre.

## skills

Les **skills** sont des fragments d'instructions réutilisables que tu écris une
fois et rappelles à volonté. Chacun a un mot-clé d'invocation (son « slug »), un
nom, une description et un corps en Markdown. Tu les gères dans un panneau dédié
(Paramètres → Skills) : création, édition, suppression, et un interrupteur pour
activer ou désactiver chacun.

Deux façons de s'en servir :

- **Invocation directe** : tape `/` suivi du slug dans le composer. Le corps du
  skill est injecté dans le message envoyé (une autocomplétion t'aide au fil de
  la frappe). Ta bulle n'affiche que ce que tu as tapé ; le contenu injecté
  reste en coulisse mais fait bien partie du message.
- **Découverte par le modèle** : si ta demande en langage naturel correspond à
  un skill activé, le modèle peut décider seul de le consulter. Une trace
  visible signale alors qu'il l'a lu.

Un skill est utile pour un cadrage récurrent : un style de réponse, une
procédure, un gabarit — tout ce que tu répéterais sinon à la main.

## mcp

Au-delà de ses fonctions intégrées, MIAOU peut se connecter à des **serveurs
compagnons** (serveurs MCP distants) qui ajoutent des outils au modèle. Pour toi
comme pour le modèle, tout apparaît dans un seul ensemble d'outils : l'origine
est transparente.

Ces serveurs sont **optionnels** : ils n'existent que si tu les as configurés
(Paramètres → Serveurs MCP). Selon ceux que tu ajoutes, le modèle peut par
exemple :

- **Lire une page web** à partir de son adresse, ou **rechercher sur le web**.
- **Extraire le contenu de documents** : PDF, fichiers bureautiques (Word,
  Excel, PowerPoint), archives Zip — utile pour interroger un document que tu
  as joint ou déposé dans une bibliothèque d'Espace.
- Répondre à des besoins ponctuels (météo, calculs, etc.) selon les serveurs
  disponibles.

Si aucun serveur n'est configuré, ces capacités ne sont simplement pas là ; le
reste de MIAOU fonctionne normalement. Un serveur injoignable est ignoré sans
bloquer les autres.

Pour l'accès au web et la lecture de documents, le projet compagnon
**miaou-mcp-servers** fournit des serveurs prêts à l'emploi (téléchargement et
recherche de pages web, extraction de PDF et de fichiers bureautiques) : c'est
la façon recommandée d'ajouter ces capacités à MIAOU.

## exports

Tu peux sortir tes conversations de MIAOU de plusieurs manières :

- **Une réponse seule** en Markdown : au survol d'un message du modèle, un
  bouton la télécharge en `.md`.
- **La conversation entière** en Markdown : une icône à droite du titre, en
  haut. L'export inclut la trace des outils utilisés à chaque tour.
- **La conversation en page HTML autonome** : une icône jumelle, au même
  endroit. Le fichier obtenu est un instantané complet — thème et coloration
  figés, diagrammes inclus en image — lisible dans n'importe quel navigateur
  sans MIAOU ni connexion. Idéal pour archiver ou partager par mail. Les images
  y sont embarquées et restent cliquables.

Côté blocs de code, chaque bloc a ses propres boutons pour **copier** ou
**télécharger** son contenu (avec la bonne extension selon le langage), et les
diagrammes peuvent être exportés en image SVG ou PNG.

## interface

Quelques repères pour te déplacer dans MIAOU :

- **Barre latérale** : le sélecteur d'Espace en haut, puis tes conversations
  rangées par période, avec la recherche. Elle est redimensionnable.
- **Composer** (en bas) : ta zone de saisie. Le bouton d'envoi devient un
  **stop** pendant que le modèle répond — le texte déjà reçu est conservé. À
  côté, le trombone pour joindre des fichiers.
- **Compteur de contexte** : un « ≈ N tok » dans le composer, cliquable, ouvre
  un panneau qui détaille ce qui est envoyé au modèle (tes instructions, les
  outils, la mémoire, les résumés, l'historique, les pièces jointes…) avec une
  estimation du poids de chaque part. Utile pour comprendre ce que « voit » le
  modèle et surveiller le remplissage de la fenêtre de contexte.
- **Raisonnement** : pour les modèles qui réfléchissent à voix haute, une icône
  dans l'en-tête du message ouvre un bloc dépliable montrant leur cheminement,
  gardé à part de la réponse.
- **Sélecteur de modèle par conversation** (optionnel) : change le modèle de la
  conversation courante sans toucher à ton défaut.
- **Thème clair / sombre** et coloration syntaxique se règlent dans les
  Paramètres.

## donnees

MIAOU s'exécute **entièrement dans ton navigateur**. Il n'y a pas de serveur
applicatif MIAOU : tes conversations, tes souvenirs, tes skills, tes Espaces et
tes fichiers sont stockés **localement**, sur ta machine, dans le stockage du
navigateur. Rien n'est envoyé ailleurs que vers l'API du modèle que tu as
configurée (et vers les serveurs compagnons que tu aurais ajoutés).

Conséquences pratiques :

- Tes données restent sur cet appareil et ce navigateur. Changer de navigateur
  ou de machine ne les emporte pas automatiquement.
- Vider les données de site du navigateur efface aussi MIAOU. Pense à exporter
  ce qui compte.
- La clef d'API que tu saisis est conservée localement, en clair. C'est adapté à
  un usage personnel ; pour un contexte exposé, mieux vaut passer par un accès
  protégé côté serveur.

Ce que tu envoies au modèle (tes messages, le contexte injecté) part bien sûr
vers l'API configurée pour être traité — c'est le principe même d'un client de
chat. Le reste ne quitte pas ton navigateur.
