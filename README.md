# MIAOU

*Mostly Independent Animal, Occasionally Useful*

Client de chat web minimaliste pour dialoguer avec un LLM via une API
compatible OpenAI (URL et clef configurables). La sortie est un **fichier HTML
unique** (`dist/miaou.html`) : pas de serveur applicatif, pas de bundler,
aucune dépendance hors CDN (marked.js, Prism, Google Fonts). On l'ouvre dans un
navigateur, ou on le sert via n'importe quel serveur web statique.

Thème sombre et thème clair, palette ambre/corail, Hanken Grotesk pour
l'interface, JetBrains Mono pour le code.

## Fonctionnalités

**Chat**

- Streaming SSE contre un endpoint OpenAI-compatible ; le bouton d'envoi devient
  un **stop** pendant la génération (le texte déjà reçu est conservé).
- Patienteur animé pendant l'attente, effacé net au premier fragment de réponse.
- Affichage du raisonnement des modèles thinking-capable : icône dans l'en-tête,
  bloc dépliable alimenté en live, persisté à part du contenu.
- Rendu Markdown + coloration syntaxique (toggle), tables, blocs de code avec
  boutons « copier » et « télécharger » (extension auto selon le langage).
- Téléchargement d'une réponse individuelle en `.md` (bouton dans l'en-tête,
  au survol) ; export de la conversation entière en Markdown (icône à droite
  du titre dans la topbar, au survol).
- Horodatage de chaque message : heure seule (même jour), « hier à HH:MM »,
  date courte ou complète selon l'ancienneté ; tooltip complet dans la sidebar.
- Édition d'un message utilisateur : tronque la suite du fil et régénère depuis
  ce point.
- Écran d'accueil aléatoire (emoji + accroche) à chaque nouvelle conversation.

**Historique & mémoire**

- Conversations persistantes (`localStorage`), sidebar à sections temporelles et
  redimensionnable, titres auto-générés et éditables.
- Recherche dans l'historique en temps réel, par titre ou résumé/mots-clés.
- Mémoire conversationnelle : résumés générés en arrière-plan, injection
  contextuelle, et deux outils pour que le modèle aille chercher lui-même —
  `get_conversation(id, with_contents=false)` et
  `list_conversations(since?, with_contents=false)`.
- Souvenirs persistants : le modèle écrit directement (`create_memory`,
  `update_memory`, `delete_memory`) sur instruction explicite, ou demande
  confirmation (`ask_confirmation`) pour un fait inféré. Gestion directe
  possible dans le drawer ; les souvenirs actifs sont réinjectés dans le
  contexte à chaque envoi.
- Chaque appel d'outil produit une ligne d'ack visible dans le thread :
  annulable pour les écritures mémoire, informative pour les lectures
  d'historique.

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

## Build

`build.py` (stdlib pure, aucune dépendance) assemble `src/` en un seul HTML.

```bash
cp config.sample.json config.json   # première fois, puis éditer
python3 build.py                     # → dist/miaou.html
```

`config.json` est local et **non versionné** — chacun renseigne sa propre
URL/clef/modèle. `dist/miaou.html` est en revanche **versionné intentionnellement**
pour pouvoir le récupérer directement depuis l'UI web du dépôt sans relancer le
build.

### Configuration (`config.json`)

```json
{
  "api_url":         "http://host-interne/v1",
  "api_model":       "gemma4:26b-nvfp4",
  "max_summaries":   3,
  "require_api_key": true
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

## Tests

Fonctions pures testées via QuickJS (pas de `fetch` réel : le réseau se vérifie
à la main, cf. [tests/MANUAL.md](tests/MANUAL.md)). La seule dépendance de
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
[tests/MANUAL.md](tests/MANUAL.md).

## Architecture

```
src/
├── html/index.html   squelette + placeholders /* __CSS__ */ et /* __JS__ */
├── css/main.css       thème complet
└── js/
    ├── utils.js       fonctions pures : escHtml, tokenize, scoring, parsing défensif
    ├── storage.js     localStorage : settings, conversations, résumés (tombstones), souvenirs persistants
    ├── resources.js   IndexedDB : stockage/réhydratation des ressources MCP non-textuelles
    ├── tools.js       registre d'outils (interne + agrégation MCP distante), dispatcher, client JSON-RPC
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
