# MIAOU

*Mistral Intelligence Available to Orphaned Users*

Client de chat web minimaliste pour dialoguer avec un LLM via une API
compatible OpenAI (URL et clef configurables). La sortie est un **fichier HTML
unique** (`dist/miaou.html`) : pas de serveur applicatif, pas de bundler,
aucune dépendance hors CDN (marked.js, Prism, Google Fonts). On l'ouvre dans un
navigateur, ou on le sert via n'importe quel serveur web statique.

Thème sombre, palette ambre/corail (clin d'œil à Mistral), Hanken Grotesk pour
l'interface, JetBrains Mono pour le code.

## Fonctionnalités

**Chat**

- Streaming SSE contre un endpoint OpenAI-compatible ; le bouton d'envoi devient
  un **stop** pendant la génération (le texte déjà reçu est conservé).
- Patienteur animé pendant l'attente, effacé net au premier fragment de réponse.
- Affichage du raisonnement des modèles thinking-capable : icône dans l'en-tête,
  bloc dépliable alimenté en live, persisté à part du contenu.
- Rendu Markdown + coloration syntaxique (toggle), tables, blocs de code avec
  bouton « copier ».
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
- Souvenirs persistants : le modèle propose création / mise à jour / suppression
  (`propose_memory`, `propose_memory_update`, `propose_memory_delete`) via des
  cartes Accepter/Rejeter ; gestion directe possible dans le drawer ; les
  souvenirs actifs sont réinjectés dans le contexte à chaque envoi.

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
  "api_url":        "http://host-interne/v1",
  "api_model":      "devstral-medium-2507",
  "max_summaries":  3,
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

## Architecture

```
src/
├── html/index.html   squelette + placeholders /* __CSS__ */ et /* __JS__ */
├── css/main.css       thème complet
└── js/
    ├── utils.js       fonctions pures : escHtml, tokenize, scoring, parsing défensif
    ├── storage.js     localStorage : settings, conversations, résumés (tombstones), souvenirs persistants
    ├── tools.js       registre additif d'outils exposés au LLM
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
