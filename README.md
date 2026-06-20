# MIAOU

*Mistral Intelligence Available to Orphaned Users*

Client de chat web minimaliste pour dialoguer avec un LLM via une API
compatible OpenAI (URL et clef configurables). La sortie est un **fichier HTML
unique** (`dist/miaou.html`) : pas de serveur applicatif, pas de build runtime,
aucune dépendance hors CDN (marked.js, Prism, Google Fonts). On l'ouvre dans un
navigateur, ou on le sert via un reverse proxy si on veut.

Dark theme, palette ambre/corail (clin d'œil à Mistral), Hanken Grotesk pour
l'interface, JetBrains Mono pour le code.

## Fonctionnalités

- Chat streamé (SSE) contre un endpoint OpenAI-compatible. Le bouton d'envoi
  devient un **stop** pendant la génération : un clic interrompt le flux, le
  texte déjà reçu est conservé.
- **Patienteur animé** pendant l'attente : un point qui pulse suivi d'un mot
  court tiré au hasard (fondu CSS), qui s'efface net au premier fragment de
  réponse. Reste actif entre un appel d'outil et la reprise du streaming.
- **Affichage du raisonnement** (modèles thinking-capable) : si le backend
  expose un champ `reasoning`/`thinking` dans le flux, une icône discrète
  apparaît dans l'en-tête du message ; un clic déplie un bloc collapsible (mono,
  atténué) alimenté en live. Le raisonnement est persisté à part du contenu et
  reste dépliable après rechargement. Détection par simple observation du flux
  (aucune configuration par modèle, aucun recours à `reasoning_effort`).
- Rendu Markdown + coloration syntaxique (toggle), tables, blocs de code avec
  bouton « copier ».
- Historique des conversations persistant (`localStorage`), sidebar animée avec
  sections temporelles (le libellé de chaque conversation du jour affiche son
  heure `HH:MM` plutôt que « aujourd'hui », redondant avec l'en-tête de section),
  titres auto-générés et éditables (Échap annule). Si
  l'utilisateur personnalise le titre avant le premier message, il est conservé
  tel quel — l'auto-titre ne l'écrase pas. Tant que le titrage en arrière-plan
  n'a pas abouti, la conversation s'affiche « Nouvelle conversation » partout.
- **Recherche dans l'historique** : barre en tête de sidebar, filtrage en temps
  réel par titre (sous-chaîne) ou par résumé/mots-clés ; les sections vides se
  masquent.
- **Sidebar redimensionnable** : glisser le bord droit ajuste la largeur (entre
  la largeur d'origine et le double) ; la valeur est persistée (`localStorage`).
- **Édition d'un message utilisateur** : au survol d'une bulle, action « éditer »
  ; valider tronque la suite du fil et relance la génération à partir de ce
  point (même chemin que l'envoi normal : mémoire + outils).
- Paramètres : URL, clef, modèle (liste via l'API, scroll vers le modèle actif à
  l'ouverture), prompt système, coloration, mode mémoire, gestion des souvenirs,
  panneau descriptif des outils exposés au modèle.
- **Sélecteur de modèle par conversation** (optionnel, masqué par défaut, activé
  dans les paramètres) : un dropdown dans le composer, peuplé depuis `/models`,
  permet de changer de modèle pour la conversation courante sans toucher au
  modèle par défaut ni à l'historique. Le choix vaut pour tous les messages
  suivants de cette conversation ; une nouvelle conversation retombe sur le
  modèle par défaut. Liste mise en cache pour la session ; si `/models` échoue,
  le sélecteur n'apparaît pas (fallback silencieux sur le modèle par défaut).
- Démarrage en état « Nouvelle conversation » avec focus sur le composer.
- Écran d'accueil à chaque nouvelle conversation : emoji + accroche + sous-titre
  tirés aléatoirement, disparaissent dès le premier message.
- Date/heure courantes et nom du modèle injectés automatiquement dans le premier
  bloc du message système (le modèle sait qui il est et quand il est).
- État configuré / non configuré explicite (le composer se verrouille tant que
  l'API n'est pas renseignée).
- Backfill de modèle au démarrage : les messages assistant sans attribut `model`
  reçoivent rétroactivement le modèle actuellement configuré.
- **Mémoire conversationnelle** : résumés générés automatiquement en
  arrière-plan, recherche par mots-clés, injection contextuelle dans le prompt,
  et deux outils exposés au modèle pour qu'il aille chercher lui-même ce dont il
  a besoin :
  - `get_conversation(id, with_contents=false)` — une conversation précise
    (résumé+mots-clés par défaut, messages complets si `with_contents=true`) ;
  - `list_conversations(since, with_contents=false)` — les conversations actives
    depuis une date ISO 8601.

## Build

Le projet n'a pas de runtime : `build.py` (stdlib pure, aucune dépendance) assemble `src/` en un seul HTML.

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
- `require_api_key` : si `false`, le composer se déverrouille dès que l'URL est
  renseignée, sans exiger de clef. Défaut `true`.

## Tests

Fonctions pures testées via QuickJS (pas de `fetch` réel : le réseau se vérifie
à la main, cf. ci-dessous). La seule dépendance de développement est `quickjs`.

Avec `uv` (recommandé) :

```bash
uv run --with quickjs python tests/runner.py
```

Sans `uv` :

```bash
pip install -r requirements-dev.txt
python tests/runner.py
```

## Vérification manuelle (réseau)

Avec une vraie configuration, ouvrir `dist/miaou.html` et vérifier :

1. **Backfill** : avec des conversations dans l'historique, l'indicateur
   d'activité affiche `résumés n/N` et `miaou-summaries` se remplit.
2. **Mode proposer** : poser une question liée à une conversation passée → la
   bannière mémoire apparaît, « Injecter » fait que la réponse en tient compte.
3. **Message système unique** : inspecter le payload réseau — un seul message
   `role: 'system'`, blocs concaténés (outils / prompt système / résumés).
4. **Outil** : question dont le résumé ne suffit pas → le modèle appelle
   `get_conversation` (ou `list_conversations`), et on va **jusqu'à la réponse
   finale**, pas seulement jusqu'au résultat de l'outil.
5. **Plusieurs tool_calls par tour** : tous exécutés dans le même tour.
6. **Anti-redemande** : redemander un id déjà fourni dans le même échange ne
   redéclenche pas le handler.
7. **Suppression réversible** : supprimer un souvenir → plus jamais re-résumé,
   même après redémarrage ; « Ré-autoriser » → régénéré au passage suivant.
8. **Pas de résumé sur conversation fraîche** : créer une conversation, envoyer
   un message, la quitter sans contenu substantiel → aucun résumé généré.
9. **Arrêt du streaming** : lancer une génération longue, cliquer le bouton stop
   → le texte s'arrête et reste affiché, le composer redevient normal, aucune
   erreur loggée (l'`AbortError` est avalé). Stop pendant un appel d'outil
   interrompt sans relancer de tour.
10. **Édition de message** : éditer un message en milieu de fil → tout ce qui
    suit disparaît, la réponse est régénérée (injection mémoire + tool_calls
    actifs). Échap annule. Recharger après édition → thread tronqué persisté.
11. **Sélecteur de modèle** : activer le réglage → le dropdown apparaît dans le
    composer (si `/models` répond). Changer de modèle en cours de conversation
    n'efface pas l'historique ; le choix persiste au rechargement ; une nouvelle
    conversation repart sur le modèle par défaut. Réglage masqué de nouveau → les
    conversations gardent leur override. Modèle non fonctionnel sélectionné →
    l'erreur s'affiche dans la bulle, pas de retry silencieux.

## Architecture

```
src/
├── html/index.html   squelette + placeholders /* __CSS__ */ et /* __JS__ */
├── css/main.css       thème complet
└── js/
    ├── utils.js       fonctions pures : escHtml, tokenize, scoring, parsing défensif
    ├── storage.js     localStorage : settings, conversations, index de résumés (tombstones)
    ├── tools.js       registre additif d'outils exposés au LLM
    ├── api.js         fetch, SSE, silentCompletion, boucle tool_calls, résumés, recherche
    ├── ui.js          rendu DOM : sidebar, messages, drawers, bannière, indicateur, souvenirs
    └── main.js        init, backfill, câblage, construction du contexte d'appel
```

Pas de modules ES : `build.py` concatène les fichiers dans l'ordre des
dépendances en un seul `<script>` (toutes les fonctions sont globales). Détails
de conception et pièges connus dans [CLAUDE.md](CLAUDE.md).

## Note sur l'état « configuré »

Le composer se déverrouille quand URL et clef sont toutes deux présentes.
Pour un endpoint sans authentification, passer `"require_api_key": false` dans
`config.json` : seule l'URL sera alors requise.

## Genèse

Né d'une contrainte au travail (Docker au catalogue mais inutilisable) : un
simple fichier HTML local s'est avéré plus léger, plus sûr et plus maintenable
qu'un conteneur pour ce besoin. Cette itération rapatrie le projet à la maison,
réécrit en entier à partir de la conception validée — aucun code de l'instance
« travail » ici, seulement les spécifications.
