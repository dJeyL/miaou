# MIAOU

*Mostly Independent Animal, Occasionally Useful*

Client de chat web minimaliste pour dialoguer avec un LLM via une API
compatible OpenAI (URL et clef configurables). La sortie est un **fichier HTML
unique** (`dist/miaou.html`) : pas de serveur applicatif, pas de bundler,
aucune dépendance hors CDN (marked.js, Prism, Google Fonts, et — chargés à la
demande seulement — Mermaid pour les diagrammes et QuickJS-WASM pour le calcul
sandboxé). On l'ouvre dans un navigateur, ou on le sert via n'importe quel
serveur web statique.

Thème sombre et thème clair, palette ambre/corail, Hanken Grotesk pour
l'interface, JetBrains Mono pour le code.

## Fonctionnalités

**Chat**

- Streaming SSE contre un endpoint OpenAI-compatible ; le bouton d'envoi devient
  un **stop** pendant la génération (le texte déjà reçu est conservé).
- **Interjections en cours de génération** : taper un message + Entrée pendant
  que le modèle travaille ne l'interrompt pas — il se met en file au-dessus du
  composer et lui est transmis à la prochaine étape d'outils, permettant de le
  **réorienter avant qu'il ait fini** une longue boucle d'outils. Message en
  attente modifiable (clic → retour au composer) ou annulable ; plusieurs en
  file partent fusionnés. Un arrêt (stop, halte) refait descendre les messages
  en attente dans le composer plutôt que de les envoyer — cf.
  `docs/interjections.md`.
- Patienteur animé pendant l'attente, effacé net au premier fragment de réponse.
- Affichage du raisonnement des modèles thinking-capable : icône dans l'en-tête,
  bloc dépliable alimenté en live, persisté à part du contenu.
- Rendu Markdown + coloration syntaxique (toggle), tables, blocs de code avec
  boutons « copier » et « télécharger » (extension auto selon le langage).
- **Diagrammes Mermaid rendus en place** : un bloc ` ```mermaid ` s'affiche en
  diagramme à la fin du message (jamais pendant le streaming) ; bouton de
  bascule diagramme ↔ source dans l'en-tête du bloc, thème du diagramme suivant
  le thème MIAOU (re-rendu au changement), erreur de syntaxe → source affichée
  avec une notice discrète. Mermaid n'est chargé (CDN) qu'au premier diagramme
  rencontré. Sur le diagramme rendu : lightbox plein écran pan/zoom (molette,
  drag, double-clic pour recentrer, Esc pour fermer) et export en image SVG ou
  PNG (fond opaque du thème actif) — cf. `docs/rendering.md`.
- **Aperçu sandboxé des blocs HTML et SVG** : bouton « œil » dans l'en-tête du
  bloc (clic explicite, jamais automatique) → rendu dans une iframe
  `sandbox="allow-scripts"` sans `allow-same-origin` — le contenu prévisualisé
  ne peut toucher ni localStorage, ni IndexedDB, ni la page. Bouton fermer
  pour revenir à la source ; re-clic = re-rendu depuis la source courante.
- Téléchargement d'une réponse individuelle en `.md` (bouton dans l'en-tête,
  au survol) ; export de la conversation entière en Markdown (icône à droite
  du titre dans la topbar, au survol). Les deux exports incluent une trace
  des appels d'outils du tour (outil, intention, arguments, résultat) juste
  avant la réponse — sans données binaires embarquées pour les ressources
  présentées automatiquement (juste le nom et le type).
- Export de la conversation en **fichier HTML autonome** (icône jumelle, même
  emplacement) : thème et coloration de code figés à l'ouverture, diagrammes
  Mermaid embarqués en SVG statique (source repliée en dessous), lisible sans
  JavaScript, ouvrable hors MIAOU (mail, partage) sans infrastructure —
  cf. `docs/exports.md`.
- Horodatage de chaque message : heure seule (même jour), « hier à HH:MM »,
  date courte ou complète selon l'ancienneté ; tooltip complet dans la sidebar.
- Édition d'un message utilisateur : tronque la suite du fil et régénère depuis
  ce point.
- **Calcul sandboxé sur un fichier (`js__eval`)** : le modèle peut exécuter du
  JavaScript sur le contenu textuel d'un blob client (pièce jointe, fichier de
  bibliothèque, ou ressource `res_…`) dans un bac à sable **QuickJS-WASM** — pour
  compter, filtrer, agréger, extraire — sans jamais charger le fichier entier
  dans le contexte, et ne ramener que le résultat. Monde guest clos (une seule
  fonction hôte, aucun accès réseau/DOM), garde de temps/mémoire, refus explicite
  si la sortie dépasse le plafond. QuickJS-WASM n'est chargé (CDN) qu'au premier
  appel. Cf. `docs/tools.md`.
- **Ressources adressables model-side** : le modèle peut ranger un texte en
  ressource `res_…` — soit un texte qu'il produit lui-même (`resource__create`),
  soit un gros résultat d'outil déjà présent qu'il convertit pour **alléger la
  conversation** (`resource__from_result` : le contenu lourd quitte l'historique,
  remplacé par un handle compact + un court résumé). Ces ressources sont ensuite
  interrogeables par `js__eval` sans repayer leur texte en tokens à chaque tour.
- **Aide intégrée** : le modèle sait ce qu'est MIAOU et ce qu'il sait faire. Un
  court blurb d'identité dans le prompt système et un outil interne
  (`miaou__about`, une aide utilisateur rédigée à la main servie section par
  section) lui permettent de répondre juste aux questions « comment je joins un
  fichier ? », « c'est quoi les Espaces ? », « où sont stockées mes données ? »
  au lieu de confabuler.
- Écran d'accueil aléatoire (emoji + accroche) à chaque nouvelle conversation.
- **Inspecteur de contexte** : compteur `≈ N tok` dans le composer, cliquable ;
  ouvre un drawer détaillant la composition du payload envoyé au modèle (prompt
  racine, outils, prompt utilisateur, mémoire, résumés, historique, pièces
  jointes…) avec une barre empilée et une table chars/tokens/%. Estimation
  chars/4 par défaut, remplacée par les **tokens réels rapportés par l'API**
  (`stream_options.include_usage`) dès qu'un envoi a répondu — tolère les
  backends qui ne le renvoient pas (fallback estimé, sans erreur). Réglage
  optionnel de la fenêtre de contexte (jauge d'occupation) ; 2e barre indiquant
  la part de l'entrée servie par le cache quand le backend la rapporte.
- **Synchronisation multi-onglets** (BroadcastChannel, local au navigateur) :
  plusieurs onglets MIAOU restent synchronisés sans rechargement — un nouveau
  message, un titre, un réglage, un fichier ou la liste des Espaces
  (création/renommage/suppression) se répercute partout. L'Espace **actif**, lui,
  reste propre à chaque onglet (c'est un état de vue, pas une donnée partagée).
  Une conversation ouverte à deux endroits affiche un bandeau
  discret ; si une réponse s'y génère dans un onglet, la même conversation passe
  en **lecture seule** dans les autres le temps de la réponse (pas de générations
  concurrentes qui s'écraseraient). Diffusion **post-commit**, relecture d'état
  **après** l'await — cf. `docs/multitab-sync.md`.

**Historique & mémoire**

- Conversations persistantes (`localStorage`), sidebar à sections temporelles et
  redimensionnable, titres auto-générés et éditables.
- Recherche dans l'historique en temps réel, par titre ou résumé/mots-clés.
- Mémoire conversationnelle : résumés générés en arrière-plan, injection
  contextuelle, et deux outils pour que le modèle aille chercher lui-même —
  `conv__get(id, with_contents=false)` et
  `conv__list(since?, query?, with_contents=false)` (recherche par
  mots-clés/résumé, même moteur que la recherche sidebar ; exclut toujours la
  conversation en cours).
- Quand le modèle cite une conversation passée dans sa réponse, elle apparaît
  comme un **lien cliquable affichant son titre** (jamais l'ID technique) ;
  cliquer dessus l'ouvre directement, comme depuis la sidebar.
- Souvenirs persistants : le modèle écrit directement (`memory__create`,
  `memory__update`, `memory__delete`) sur instruction explicite, ou demande
  confirmation (`ask_confirmation`) pour un fait inféré. Gestion directe
  possible dans le drawer ; les souvenirs actifs sont réinjectés dans le
  contexte à chaque envoi.
- Chaque appel d'outil produit une ligne d'ack visible dans le thread :
  annulable pour les écritures mémoire, informative pour les lectures
  d'historique.

**Espaces**

- Espaces de travail mutuellement hermétiques (sélecteur en tête de sidebar) :
  chaque Space a ses propres conversations, pièces jointes et souvenirs. La
  zone historique hors-Space est elle-même un Space (« Général »), sans cas
  particulier. Le modèle ne voit et ne peut agir que sur le contenu du Space
  actif — aucun outil ne peut lire ou modifier un autre Space.
  Un scope **profil** existe au-dessus des Spaces pour les souvenirs qui
  doivent rester valables partout (promotion manuelle depuis l'écran d'un
  Space).
- Chaque Space peut porter une **description** libre, ajoutée après le
  prompt système utilisateur (jamais en remplacement) — pour un contexte
  propre au Space sans dupliquer les réglages globaux.
- Suppression d'un Space : cascade explicite à double confirmation
  (conversations, pièces jointes et souvenirs scopés supprimés ; les
  souvenirs profil restent intacts).
- **Bibliothèque de fichiers par Space** (écran Space → « Fichiers ») :
  fichiers persistants, hermétiques comme le reste du Space, accessibles au
  modèle via des outils dédiés (lecture seule, herméticité identique aux
  conversations/souvenirs). Trois façons d'alimenter la bibliothèque : upload
  direct, promotion en un clic d'une pièce jointe déjà envoyée, ou promotion
  proposée par le modèle lui-même (toujours soumise à confirmation explicite
  avant écriture). Une description automatique (désactivable) accompagne
  chaque fichier — pas un résumé de son contenu, mais un indice de ce qu'il
  contient pour que le modèle décide s'il vaut la peine de l'ouvrir.

**Skills**

- Fragments d'instructions Markdown réutilisables, gérés dans un drawer dédié
  (Paramètres → Skills) : chaque skill a un `slug` (clé d'invocation), un nom, une
  description et un corps Markdown. Stockés en IndexedDB ; un toggle `enabled` par
  skill. Création/édition/suppression directes (action administrative explicite,
  sans tombstone).
- **Invocation par slash** : taper `/slug` dans le composer injecte le corps du
  skill dans le message envoyé — injection **déterministe et figée** au moment de
  l'envoi (distincte du bloc `<miaou_context>`, recalculé à chaque tour). La bulle
  n'affiche que le texte tapé ; le corps injecté reste invisible côté UI mais fait
  partie du message stocké/envoyé. Autocomplétion au fil de la frappe (skills
  activés uniquement).
- **Découverte par le modèle** : deux outils sous le sous-namespace
  `miaou__skills__` — `miaou__skills__list` (slug + nom + description des skills
  activés) et `miaou__skills__read(slug)` (corps complet). Le modèle décide seul de
  les appeler quand la demande en langage naturel correspond à un skill ; une ligne
  d'ack informative signale la lecture.
- **Création/édition par le modèle** : `miaou__skills__write` permet au modèle de
  créer une skill ou de mettre à jour le corps d'une existante à ta demande ; une
  modification de skill existante passe par une confirmation explicite avant
  écrasement.
- **Import d'une skill Claude Code** : coller un corps portant un cartouche
  `--- name: … description: … ---` en édition pré-remplit slug/nom/description
  depuis le frontmatter ; glisser-déposer (ou coller) un fichier `.md` bascule en
  édition de la skill homonyme si elle existe, sinon en crée une nouvelle.
- **Skills système** : quelques skills sont fournies par l'application, seedées au
  build depuis `src/system-skills/*.md` (règles de syntaxe Mermaid, mode d'emploi
  d'outils avancés). Toujours actives, non éditables/supprimables, listées à part
  avec un badge « Système » et consultables en lecture seule.

**Outils distants (MCP)**

- MIAOU est un **client/agrégateur MCP** : en plus de ses outils internes, il
  délègue les appels qu'il ne sait pas servir à un ou plusieurs serveurs MCP
  distants (HTTP). Pour le modèle il n'y a qu'**un seul registre** ; l'origine de
  chaque outil (interne `miaou__…` vs distant `serveur__…`) est invisible.
- Configuration dans un sous-écran dédié (Paramètres → Serveurs MCP) : cartes
  éditables avec nom (= préfixe), URL, transport (`streamable-http`), jeton bearer
  optionnel, timeout, et listes blanche/noire d'outils. Un serveur injoignable est
  simplement ignoré, le reste continue de fonctionner.
- Les résultats non-textuels d'un outil distant (image, ressource, binaire) sont
  stockés en IndexedDB (persistance locale, sans bloquer `localStorage`) et rendus
  dans la réponse : image inline, code surligné, ou téléchargement éphémère. Les
  ressources texte/JSON sont réinjectées au modèle à chaque tour ; les binaires
  sont représentés par un descripteur statique.
- Les octets récupérés du web (`web__fetch_resource`) et le texte d'un membre
  d'archive (`docs__extract`) atterrissent comme ressources `res_…` de première
  classe : le modèle les passe en entrée aux autres outils `docs__*` ou les
  analyse par le calcul (`js__eval`) sans jamais recopier leur contenu dans la
  conversation.
- Posture de sécurité assumée non-prod : le jeton est stocké en clair dans le
  navigateur (`localStorage`). Pour un usage exposé, passer par un proxy qui
  détient le secret côté serveur.

**Réglages**

- URL, clef, modèle (liste via l'API), prompt système, thème, coloration, mode
  d'injection des résumés, panneau descriptif des outils exposés au modèle.
- Sélecteur de modèle par conversation (optionnel, masqué par défaut) : change le
  modèle de la conversation courante sans toucher au défaut ni à l'historique.
- État configuré / non configuré explicite : le composer se verrouille tant que
  l'API n'est pas renseignée (voir `require_api_key` pour les endpoints sans
  authentification).
- Date/heure et nom du modèle injectés automatiquement dans le contexte.
- **Palette de commandes** (Ctrl/Cmd+K) : overlay type Spotlight, filtrage à la
  frappe, navigation clavier (↑/↓/Entrée/Échap). Registre déclaratif : nouvelle
  conversation, réglages, drawers (souvenirs, résumés, skills, MCP, contexte),
  bascule thème/coloration, export .md/HTML. Sous-modes filtrants pour choisir un
  modèle, invoquer une skill, changer d'espace, ou rechercher une conversation
  (cross-Space, Space actif en tête). Détail : `docs/command-palette.md`.

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
  "default_context_window":  32768
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

## Tests

Fonctions pures testées via QuickJS (pas de `fetch` réel : le réseau se vérifie
à la main, cf. [docs/manual-tests.md](docs/manual-tests.md)). La seule dépendance de
développement est `quickjs`.

Avec `uv` (recommandé) :

```bash
uv run --with quickjs python tests/runner.py
```

Sans `uv` :

```bash
pip install -r requirements-dev.txt
python tests/runner.py
```

Pour exercer la délégation MCP distante (chemin réseau, non couvert par QuickJS),
utiliser le serveur de banc d'essai du projet `miaou-mcp-servers` puis l'ajouter
dans Paramètres → Serveurs MCP. Procédure détaillée dans
[docs/manual-tests.md](docs/manual-tests.md).

## Architecture

```
src/
├── html/index.html    squelette + placeholders /* __CSS__ */ et /* __JS__ */
├── css/*.css          8 feuilles concaténées dans l'ordre CSS_ORDER (base, sidebar,
│                      chat, composer, drawers, tools, responsive, theme-light)
└── js/
    ├── utils.js       fonctions pures : escHtml, tokenize, scoring, parsing défensif, expandThread
    ├── sync.js        synchro multi-onglets (BroadcastChannel) : enveloppe, soft-lock, relais lecture seule
    ├── storage.js     localStorage : settings, conversations, résumés (tombstones), souvenirs persistants
    ├── resources.js   IndexedDB (base `miaou`) : ressources MCP/model-side (`res_…`), bibliothèque de fichiers d'Espace
    ├── skills.js      IndexedDB (store `skills`) : cache mémoire, validation slug, CRUD, skills système seedées, triggers slash
    ├── tools.js       registre d'outils (interne + agrégation MCP distante), dispatcher, client JSON-RPC, `js__eval` (QuickJS-WASM)
    ├── api.js         fetch, SSE, silentCompletion, boucle tool_calls, résumés, recherche
    ├── ui.js          rendu DOM : sidebar, messages, drawers, bannière, indicateur, souvenirs
    └── main.js        init, backfill, câblage, construction du contexte d'appel
```

Pas de modules ES : `build.py` concatène les fichiers dans l'ordre des
dépendances en un seul `<script>` (toutes les fonctions sont globales). Détails
de conception, pièges connus et vocabulaire dans [CLAUDE.md](CLAUDE.md).

## Genèse

Né d'une contrainte au travail (Docker au catalogue mais inutilisable) : un
simple fichier HTML local s'est avéré plus léger, plus sûr et plus maintenable
qu'un conteneur pour ce besoin. Cette itération rapatrie le projet à la maison,
réécrit en entier à partir de la conception validée — aucun code de l'instance
« travail » ici, seulement les spécifications.
