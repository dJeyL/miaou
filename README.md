# MIAOU

*Mostly Independent Animal, Occasionally Useful*

Client de chat web minimaliste pour dialoguer avec un LLM via une API
compatible OpenAI (URL et clef configurables). La sortie est un **fichier HTML
unique** (`dist/miaou.html`) : pas de serveur applicatif, pas de bundler,
aucune dépendance hors CDN (marked.js, Prism, Google Fonts, et — chargés à la
demande seulement — Mermaid pour les diagrammes, QuickJS-WASM pour le calcul
sandboxé, fflate pour les archives zip et les présentations PowerPoint, pdf.js
pour les PDF, SheetJS pour les classeurs Excel et mammoth pour les documents
Word). On l'ouvre dans
un navigateur, ou on le sert via n'importe quel serveur web statique.

L'apparence se règle sur trois axes indépendants : luminosité (sombre, clair ou
selon le système), palette de couleurs (ambre, encre ou forêt) et lot de fontes
appairées (Hanken Grotesk/JetBrains Mono, Source Sans 3/Source Code Pro, ou
Figtree/Fira Code).

## Fonctionnalités

**Chat**

- Streaming SSE contre un endpoint OpenAI-compatible ; le bouton d'envoi devient
  un **stop** pendant la génération (le texte déjà reçu est conservé).
- **Interjections en cours de génération** : taper un message pendant que le
  modèle travaille ne l'interrompt pas — il se met en file et lui est transmis à
  la prochaine étape d'outils, pour le réorienter avant qu'il ait fini. Message
  en attente modifiable ou annulable, et rattaché à sa conversation (chacune a
  sa file, y compris le fil d'un agent au travail) — cf.
  [docs/interjections.md](docs/interjections.md).
- **Générations en parallèle** : une réponse en cours appartient à sa
  conversation, pas à l'écran. Naviguer ailleurs (ou changer d'Espace) ne
  l'interrompt pas, et plusieurs peuvent tourner de front ; des pastilles
  signalent l'activité et les réponses non lues — cf.
  [docs/generations.md](docs/generations.md) et [docs/badges.md](docs/badges.md).
- **Agents** : le modèle confie une tâche délimitée à une sous-conversation
  autonome, qui travaille en parallèle avec les seuls outils et fichiers qu'il
  lui délègue, et dont le résultat lui revient dans le fil — replié, et non
  modifiable. Le fil d'un agent passe en lecture seule une fois son travail
  rendu — cf. [docs/agents.md](docs/agents.md).
- Affichage du raisonnement des modèles thinking-capable, dans un bloc dépliable
  alimenté en direct.
- Rendu Markdown, coloration syntaxique, tables, blocs de code avec « copier » et
  « télécharger ».
- **Diagrammes Mermaid** rendus en place, avec bascule diagramme ↔ source,
  lightbox pan/zoom et export SVG/PNG — cf. [docs/rendering.md](docs/rendering.md).
- **Aperçu des blocs HTML et SVG** dans une iframe isolée, sur clic explicite —
  cf. [docs/rendering.md](docs/rendering.md).
- Export d'une réponse ou d'une conversation entière en **Markdown**, ou en
  **fichier HTML autonome** lisible sans JavaScript et partageable hors MIAOU.
  Les traces d'appels d'outils sont incluses — cf. [docs/exports.md](docs/exports.md).
- **Conversion Markdown → HTML** de n'importe quel fichier `.md` au même format,
  purement locale, sans passer par le modèle.
- Horodatage de chaque message, relatif puis absolu selon l'ancienneté.
- Édition d'un message utilisateur : tronque la suite du fil et régénère depuis
  ce point.
- **Calcul sandboxé sur des fichiers** : le modèle exécute du JavaScript sur le
  contenu de pièces jointes, de fichiers de bibliothèque ou de ressources pour
  compter, filtrer, agréger — ou croiser plusieurs d'entre eux dans un même
  calcul — sans les charger dans le contexte, et en ne ramenant que le résultat —
  cf. [docs/tools.md](docs/tools.md).
- **Écriture incrémentale d'une ressource** : le modèle complète une ressource
  existante au fil de plusieurs tours, ou la fait écrire ligne à ligne par le
  code du bac à sable, pour produire un gros contenu sans le réécrire à chaque
  étape ni buter sur la taille d'une réponse — cf.
  [docs/tools.md](docs/tools.md).
- **Archives zip** : le modèle ouvre un zip pour en lister les membres et en
  extraire un, ou regroupe plusieurs fichiers produits au fil de l'échange en une
  archive téléchargeable depuis le fil — cf. [docs/tools.md](docs/tools.md).
- **PDF** : le modèle en lit la structure (sommaire avec ses numéros de page) et
  les pages, ou s'en fait rendre une en image pour la lire avec sa vision — page
  scannée, schéma, graphique —, sans serveur — cf.
  [docs/documents.md](docs/documents.md).
- **Classeurs Excel** : le modèle en liste les feuilles et en lit une plage de
  cellules, sans serveur — cf. [docs/tools.md](docs/tools.md).
- **Documents Word** : le modèle en liste les sections et en lit une, tableaux
  compris, sans serveur — cf. [docs/tools.md](docs/tools.md).
- **Présentations PowerPoint** : le modèle en liste les slides dans l'ordre de la
  présentation et en lit une, notes de présentateur comprises, sans serveur —
  cf. [docs/tools.md](docs/tools.md).
- **Ressources adressables** : le modèle range un texte de côté — qu'il l'ait
  produit ou qu'il convertisse un gros résultat d'outil pour alléger la
  conversation — et le réinterroge ensuite sans repayer son contenu en tokens à
  chaque tour.
- **Aide intégrée** : le modèle sait ce qu'est MIAOU et ce qu'il sait faire, et
  consulte une aide utilisateur rédigée à la main plutôt que de confabuler sur
  « comment je joins un fichier ? » ou « c'est quoi les Espaces ? ».
- Écran d'accueil aléatoire à chaque nouvelle conversation.
- **Inspecteur de contexte** : compteur de tokens dans le composer, cliquable,
  détaillant la composition du payload envoyé au modèle avec une jauge
  d'occupation — cf. [docs/context-inspector.md](docs/context-inspector.md).
- **Synchronisation multi-onglets** (locale au navigateur) : messages, titres,
  réglages, fichiers et Espaces se répercutent partout sans rechargement. Une
  conversation ouverte à deux endroits passe en lecture seule le temps d'une
  réponse, pour éviter deux générations concurrentes — cf.
  [docs/multitab-sync.md](docs/multitab-sync.md).

**Historique & mémoire**

- Conversations persistantes (IndexedDB), sidebar à sections temporelles et
  redimensionnable, titres auto-générés et éditables.
- Recherche dans l'historique en temps réel, par titre ou résumé/mots-clés.
- Mémoire conversationnelle : résumés générés en arrière-plan, injection
  contextuelle, et deux outils pour que le modèle aille chercher lui-même dans
  les conversations passées.
- Quand le modèle cite une conversation passée, elle apparaît comme un **lien
  cliquable affichant son titre** (jamais l'ID technique) ; cliquer dessus
  l'ouvre directement.
- Souvenirs persistants : le modèle écrit sur instruction explicite, ou demande
  confirmation pour un fait inféré. Gestion directe possible dans le drawer ; les
  souvenirs actifs sont réinjectés dans le contexte à chaque envoi.
- Chaque appel d'outil produit une ligne d'ack visible dans le thread :
  annulable pour les écritures mémoire, informative pour les lectures.
- Inspecteur d'appel : une loupe sur chaque ack ouvre le détail complet et non
  tronqué de l'appel — paramètres, résultat, méta, et la ressource produite
  (aperçu selon son type, téléchargement) — cf. [docs/tools.md](docs/tools.md).

**Espaces**

- Espaces de travail mutuellement hermétiques : chaque Space a ses propres
  conversations, pièces jointes et souvenirs. Le modèle ne voit et ne peut agir
  que sur le contenu du Space actif. Un scope **profil** existe au-dessus, pour
  les souvenirs qui doivent rester valables partout.
- Chaque Space peut porter une **description** libre, qui vient compléter le
  prompt système sans le remplacer.
- Suppression d'un Space : cascade explicite à double confirmation.
- **Bibliothèque de fichiers par Space** : fichiers persistants et hermétiques,
  accessibles au modèle en lecture seule. On l'alimente par upload direct,
  promotion d'une pièce jointe déjà envoyée, promotion proposée par le modèle
  (toujours soumise à confirmation), ou dépôt par le modèle d'un fichier qu'il
  vient de produire.
- Un fichier déposé est **décrit automatiquement** pour que le modèle sache s'il
  vaut la peine d'être ouvert. Quand il n'y a pas de texte à extraire — PDF
  scanné, image —, l'image est donnée à voir au modèle, avec repli sur une
  description sans image si le modèle s'avère sans vision.

Détail : [docs/spaces.md](docs/spaces.md).

**Skills**

- Fragments d'instructions Markdown réutilisables, gérés dans un drawer dédié :
  slug, nom, description et corps Markdown, avec un toggle d'activation.
- **Invocation par slash** : taper `/slug` dans le composer injecte le corps du
  skill dans le message envoyé, avec autocomplétion au fil de la frappe.
- **Découverte et écriture par le modèle** : il liste et lit seul les skills
  activées quand la demande y correspond, et peut en créer ou en modifier à ta
  demande (une modification passe par une confirmation explicite).
- **Import d'une skill Claude Code** : coller ou déposer un `.md` portant un
  cartouche `--- name: … description: … ---` pré-remplit l'édition.
- **Skills système** fournies par l'application : toujours actives, non
  éditables, consultables en lecture seule.

Détail : [docs/skills.md](docs/skills.md).

**Outils distants (MCP)**

- MIAOU est un **client/agrégateur MCP** : en plus de ses outils internes, il
  délègue les appels qu'il ne sait pas servir à un ou plusieurs serveurs MCP
  distants. Pour le modèle il n'y a qu'un seul registre.
- Configuration dans un sous-écran dédié : nom (= préfixe), URL, transport, jeton
  bearer optionnel, timeout, listes blanche/noire d'outils. Un serveur
  injoignable est simplement ignoré, le reste continue de fonctionner.
- Les résultats non-textuels (image, ressource, binaire) sont stockés localement
  et rendus dans la réponse ; les octets récupérés du web ou extraits d'une
  archive deviennent des ressources de première classe, analysables par le calcul
  sandboxé.
- Posture de sécurité assumée non-prod : le jeton est stocké en clair dans le
  navigateur (`localStorage`). Pour un usage exposé, passer par un proxy qui
  détient le secret côté serveur.

Détail : [docs/mcp.md](docs/mcp.md).

**Réglages**

- URL, clef, modèle (liste via l'API), prompt système, thème, coloration, mode
  d'injection des résumés, panneau descriptif des outils exposés au modèle.
- Apparence à trois axes indépendants : luminosité, palette de couleurs et lot de
  fontes — cf. [docs/palettes.md](docs/palettes.md) et [docs/fonts.md](docs/fonts.md).
- Sélecteur de modèle par conversation (optionnel, masqué par défaut) : change le
  modèle de la conversation courante sans toucher au défaut.
- État configuré / non configuré explicite : le composer se verrouille tant que
  l'API n'est pas renseignée (voir `require_api_key` pour les endpoints sans
  authentification).
- Date/heure et nom du modèle injectés automatiquement dans le contexte.
- **Sauvegarde complète** de tout l'état (conversations, souvenirs, skills,
  fichiers, Espaces, réglages) en une archive `.zip`, réimportable — cf.
  [docs/storage.md](docs/storage.md).
- **Palette de commandes** (Ctrl/Cmd+K) : filtrage à la frappe et navigation
  clavier sur toutes les actions, avec des sous-modes pour choisir un modèle,
  invoquer une skill, changer d'Espace ou rechercher une conversation — cf.
  [docs/command-palette.md](docs/command-palette.md).

## Build

`build.py` (stdlib pure, aucune dépendance) assemble `src/` en un seul HTML.

```bash
cp config.sample.json config.json   # première fois, puis éditer
python3 build.py                    # → dist/miaou.html
```

`config.json` est local et **non versionné** — chacun renseigne sa propre
URL/clef/modèle. `dist/miaou.html` est en revanche **versionné intentionnellement**
pour pouvoir le récupérer directement depuis l'UI web du dépôt sans relancer le
build.

### Configuration (`config.json`)

```json
{
  "api_url":                 "http://host-interne/v1",
  "api_model":               "gemma4:26b-nvfp4",
  "max_summaries":           3,
  "require_api_key":         true,
  "chat_temperature":        0.7,
  "default_context_window":  32768,
  "max_agents_per_conv":     3,
  "max_agents_total":        5,
  "max_agent_turns":         12,
  "repo_url":                "https://github.com/dJeyL/miaou"
}
```

- `api_url` / `api_model` : valeurs **par défaut** injectées dans le HTML. Elles
  ne sont qu'un point de départ ; les réglages saisis dans l'UI (stockés en
  `localStorage`) priment. La clef API n'est jamais mise dans `config.json`,
  elle se saisit dans le drawer Paramètres.
- `max_summaries` : nombre maximum de résumés injectés simultanément dans le
  contexte (défaut 3).
- `require_api_key` : gouverne l'état « configuré ». Par défaut (`true`), le
  composer exige URL **et** clef. À `false`, l'URL seule suffit — pour un
  endpoint sans authentification.
- `chat_temperature` : température des envois de chat (défaut `0.7`). Ne
  concerne que la conversation : les appels internes (titrage, résumé,
  description de fichier) gardent leur propre valeur, plus basse. Une valeur
  non numérique est ignorée (retour à `0.7`).
- `default_context_window` : taille de fenêtre de contexte (en tokens) utilisée
  par défaut tant que l'utilisateur n'a rien saisi dans les réglages. `0` ou
  absent = inconnue (aucune valeur par défaut appliquée).
- `max_agents_per_conv` / `max_agents_total` : bornes d'agents simultanés —
  par conversation (défaut 3) et toutes conversations confondues (défaut 5).
  Un refus nomme celle qui est atteinte.
- `max_agent_turns` : nombre d'échanges qu'un agent peut enchaîner avant d'être
  arrêté d'office (défaut 12). Son travail partiel est quand même transmis.
- `repo_url` : URL liée sur le mot « MIAOU » dans le footer des exports HTML
  (conversations et Markdown convertis). **Trois états distincts** : clef
  **absente ou `null`** → lien vers le dépôt public
  (`https://github.com/dJeyL/miaou`) ; chaîne **vide** → « MIAOU » reste du
  simple texte, sans lien (cas d'un fork interne qu'on ne veut pas exposer) ;
  chaîne **non vide** → lien vers cette URL. Figée au build : rien ne permet de
  la changer depuis l'UI.

## Tests

Fonctions pures testées via QuickJS ; la seule dépendance de développement est
`quickjs`.

```bash
uv run --with quickjs python tests/runner.py     # avec uv (recommandé)
pip install -r requirements-dev.txt && python tests/runner.py
```

Le réseau (envois réels, délégation MCP distante) n'est pas couvert par QuickJS
et se vérifie à la main : procédures dans
[docs/manual-tests.md](docs/manual-tests.md).

## Architecture

Pas de modules ES : `build.py` concatène `src/css/*.css` et `src/js/*.js` dans
un ordre fixe, en un seul `<script>` où toutes les fonctions sont globales.

Conception, découpage des fichiers, pièges connus et vocabulaire :
[CLAUDE.md](CLAUDE.md), qui indexe les documents de domaine de
[docs/](docs/).

## Genèse

Né d'une contrainte au travail (Docker au catalogue mais inutilisable) : un
simple fichier HTML local s'est avéré plus léger, plus sûr et plus maintenable
qu'un conteneur pour ce besoin. Cette itération rapatrie le projet à la maison,
réécrit en entier à partir de la conception validée — aucun code de l'instance
« travail » ici, seulement les spécifications.
