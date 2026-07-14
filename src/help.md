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
- **Analyser** un fichier volumineux (log, JSON, CSV, texte) : le modèle peut
  exécuter du code sur son contenu pour compter, filtrer ou extraire, sans
  charger le fichier entier dans le contexte.
- **Exporter** une conversation en Markdown ou en page HTML autonome.

Pour en savoir plus sur un sujet précis, demande-moi : pièces jointes, Espaces,
mémoire, historique, skills, outils distants, exports, interface, contexte
envoyé au modèle, données personnelles, ou la genèse du projet.

## attachments

Tu peux joindre des fichiers à un message avant de l'envoyer : clique sur le
trombone du composer, glisse-dépose un ou plusieurs fichiers n'importe où sur
la zone de conversation (pas seulement sur la barre de saisie), ou colle
directement depuis le presse-papier — une image copiée, ou un fichier copié
depuis l'explorateur de fichiers. Deux types sont acceptés : **images** (le
modèle les voit réellement, s'il gère la vision) et **fichiers texte** (leur
contenu est transmis au modèle).

Une fois envoyées, les pièces jointes apparaissent comme des vignettes sous ton
message. Tu peux les rouvrir : cliquer sur une image l'affiche en plein écran,
et un bouton permet de la retélécharger. Le modèle peut aussi redemander une
pièce jointe d'un message précédent quand il en a besoin pour répondre.

Les images ne sont envoyées en pleine résolution qu'au moment où tu les joins ;
ensuite le modèle en garde une trace légère plutôt que de recharger les pixels à
chaque tour, pour rester économe. Si tu veux qu'un fichier reste disponible
durablement (pas seulement le temps d'un message), promeus-le dans la
bibliothèque de fichiers de ton Espace — voir le sujet Espaces.

Pour un fichier texte volumineux (un log, un gros JSON, un CSV), le modèle
n'est pas obligé d'en charger tout le contenu : il peut l'**analyser par le
calcul** — compter des lignes, filtrer, agréger, extraire un extrait — en
exécutant du code dans un bac à sable isolé, et ne ramener que le résultat. Utile
pour interroger un fichier trop gros pour tenir dans le contexte. Si le résultat
demandé est lui-même trop volumineux, le modèle est invité à le resserrer plutôt
qu'à déverser le fichier brut.

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

Note : cette continuité vaut à l'intérieur d'un Espace ; un Espace ne voit pas
l'historique d'un autre.

## skills

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

## mcp

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
- **Extraire le contenu de documents** : PDF, fichiers bureautiques (Word,
  Excel, PowerPoint), archives Zip — utile pour interroger un document que tu
  as joint ou déposé dans une bibliothèque d'Espace. Pour un fichier texte ou
  JSON contenu dans une archive Zip, le modèle peut aussi en récupérer le
  contenu intégral sans le recopier dans la conversation, puis l'analyser par
  le calcul (voir pièces jointes) — pratique pour travailler sur un fichier
  d'archive sans le rapatrier entièrement à l'écran.
- Répondre à des besoins ponctuels (météo, calculs, etc.) selon les serveurs
  disponibles.

Si aucun serveur n'est configuré, ces capacités ne sont simplement pas là ; le
reste de MIAOU fonctionne normalement. Un serveur injoignable est ignoré sans
bloquer les autres.

Pour l'accès au web et la lecture de documents, le projet compagnon
**miaou-mcp-servers** fournit des serveurs prêts à l'emploi (téléchargement et
recherche de pages web, extraction de PDF et de fichiers bureautiques) : c'est
la façon recommandée d'ajouter ces capacités à MIAOU. Il est open source :
https://github.com/dJeyL/miaou-mcp-servers

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

## contexte

À chaque message que tu envoies, MIAOU ne transmet pas que ton texte : il y
ajoute automatiquement un **contexte** pour que le modèle réponde en connaissance
de cause. Ce contexte comprend, selon le cas, tes instructions système, la
définition des outils disponibles (y compris ceux des serveurs compagnons), tes
souvenirs actifs, les résumés des conversations passées jugés pertinents, la date
du jour et le manifeste de la bibliothèque de fichiers de l'Espace. Tout cela
part vers l'API **à chaque tour**, en plus de ton message — donc oui, cela
consomme des tokens en entrée, au-delà de ce que tu as tapé toi-même.

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
  modèle et surveiller le remplissage de la fenêtre de contexte. La taille de
  fenêtre réglée dans les Paramètres est **seulement le dénominateur** de ce
  calcul (le « N tok sur combien ») : c'est un indicateur d'atteinte de la
  limite, pas un filtre — la changer ne réduit ni n'augmente ce qui part
  réellement à l'API. Pour ce qui pèse et comment l'alléger, voir le sujet
  contexte.
- **Raisonnement** : pour les modèles qui réfléchissent à voix haute, une icône
  dans l'en-tête du message ouvre un bloc dépliable montrant leur cheminement,
  gardé à part de la réponse.
- **Sélecteur de modèle par conversation** (optionnel) : change le modèle de la
  conversation courante sans toucher à ton défaut.
- **Thème clair / sombre** et coloration syntaxique se règlent dans les
  Paramètres.
- **Étapes d'outils** : quand le modèle enchaîne plusieurs actions (mémoire,
  recherche, outils distants…) pour une même réponse, elles s'affichent en
  mode compact — un badge « N étapes » à cliquer pour tout déplier en liste, et
  se replier à nouveau.
- **Animations** : un réglage dans les Paramètres
  (Normales / Réduites / Suivre le système) coupe toutes les transitions et
  animations visuelles de l'interface — utile en cas de gêne au mouvement ou de
  préférence pour un affichage instantané. « Suivre le système » s'aligne sur la
  préférence de réduction d'animations de ton OS.
- **Palette de commandes** : appuie sur **Ctrl+K** (ou **Cmd+K** sur Mac) pour
  ouvrir une palette : tape pour filtrer, ↑/↓ pour naviguer, Entrée pour lancer,
  Échap pour fermer. Elle donne accès aux actions courantes sans la souris —
  nouvelle conversation, réglages, souvenirs, résumés, skills, serveurs MCP,
  inspecteur de contexte, bascule de thème et de coloration, export de la
  conversation. Certaines entrées ouvrent un **sous-mode** où la palette filtre
  une liste dédiée : choisir un modèle, invoquer une skill, changer d'espace, ou
  rechercher une conversation (dans tous tes espaces — Échap revient en arrière).
  - **Raccourcis directs** : la palette une fois ouverte (champ vide), une seule
    touche lance la commande — la lettre est affichée à gauche de chaque ligne.
    En résumé, `Ctrl/Cmd+K` puis : `N` nouvelle conversation, `F` rechercher une
    conversation, `M` changer de modèle, `K` invoquer une skill, `E` changer
    d'espace, `,` réglages, `P` souvenirs (profil), `R` résumés, `G` gérer les
    skills, `S` serveurs MCP, `C` inspecteur de contexte, `T` thème clair/sombre,
    `H` coloration syntaxique, `D` export Markdown, `W` export HTML.
- **Plusieurs onglets** : tu peux ouvrir MIAOU dans plusieurs onglets du même
  navigateur ; ils restent synchronisés. Une modification faite dans un onglet
  (nouveau message, titre, réglage, Espace, fichier…) se reflète dans les autres
  sans rechargement. Si la même conversation est ouverte à deux endroits, un
  bandeau discret le signale. Et si une réponse est en cours de génération dans
  un onglet, la même conversation passe en **lecture seule** dans les autres le
  temps de la réponse — pour éviter deux générations concurrentes qui
  s'écraseraient ; tu peux toujours lire et faire défiler. La synchro est locale
  à ton navigateur (elle ne relie pas deux machines ni deux navigateurs
  différents).

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
chat. Ce contexte injecté n'est pas gratuit en tokens ; pour savoir ce qu'il
contient et comment l'alléger, voir le sujet contexte. Le reste ne quitte pas
ton navigateur.

## genesis

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
