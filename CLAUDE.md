# CLAUDE.md — MIAOU

Instructions pour travailler dans ce dépôt. Ce fichier couvre le noyau consulté
à chaque tâche : ce qu'est le projet, la boucle de travail, le pipeline de
build, les contraintes structurelles dures, et la liste des pièges déjà payés
(résumés — développement complet en lien). Les spécifications détaillées par
domaine (stockage, outils, MCP, skills, tests, export/horodatages) sont dans
`docs/` : les lire **avant** de toucher à la zone concernée, pas par défaut.

## Ce qu'est le projet

Client de chat web pour API OpenAI-compatible, livré comme **un seul fichier
HTML** (`dist/miaou.html`). On édite `src/`, `build.py` assemble. Pas de runtime,
pas de bundler, pas de Node, pas de modules ES.

## Boucle de travail

```bash
python3 build.py                          # src/ → dist/miaou.html
uv run --with quickjs python tests/runner.py   # tests des fonctions pures
```

**Avant chaque commit :** build si du code a changé, puis tests. Ne jamais
commit ni push sans avoir demandé l'accord explicite de l'utilisateur au préalable.

Python via `uv` exclusivement. `config.json` (copié de `config.sample.json`) est
local et non versionné ; `dist/miaou.html` est versionné intentionnellement.

**Messages de commit en anglais** (le reste des échanges reste en français).

## Pipeline de build (ne pas le réécrire)

`build.py` lit `src/html/index.html` et remplace deux placeholders :
`/* __CSS__ */` (← `src/css/main.css`) et `/* __JS__ */` (← les `src/js/*.js`
concaténés dans l'ordre `JS_ORDER` : `utils, storage, resources, tools, api, ui, main`).
Il substitue aussi **un seul marqueur de config**, `__MIAOU_CONFIG__`, par
l'objet `config.json` entier sérialisé en JSON (JSON ⊂ littéral objet JS, donc
`json.dumps` gère seul quoting/nombres/booléens — pas de marqueur par clef, pas
de distinction guillemets/sans-guillemets). `build.py` échappe `</` dans le
littéral pour ne pas casser le `</script>` porteur. Côté source (`storage.js`),
un **unique point d'injection** :

```js
const BUILD_CONFIG = (function () { try { return __MIAOU_CONFIG__; } catch (e) { return {}; } })();
```

- **Marqueur à occurrence unique, en position de valeur** : `.replace` global,
  donc toute autre occurrence serait substituée aussi.
- **Forme tolérante via `try`** : sources non buildées (tests QuickJS),
  `__MIAOU_CONFIG__` est un identifiant nu → `ReferenceError` attrapée → `{}`.
  (Un `typeof … !== 'undefined'` ne convient pas : la garde elle-même contient
  le marqueur, qui serait substitué → objet dupliqué.)
- Les quatre valeurs dérivées (`REQUIRE_API_KEY`, `MAX_SUMMARIES`,
  `BUILD_API_URL`, `BUILD_API_MODEL`) sont **toutes déclarées dans `storage.js`**,
  juste sous `BUILD_CONFIG`, avec leurs défauts. Elles ne sont **référencées
  ailleurs qu'en corps de fonction** (cf. contrainte `const`/test runner
  ci-dessous) : ne pas les redéclarer dans un autre fichier au top-level.
- `REQUIRE_API_KEY` (défaut `true`) gouverne l'état « configuré » : si `false`,
  le composer se déverrouille avec l'URL seule (clef optionnelle), cf.
  `syncConfigured` (ui.js).

## Contraintes structurelles à respecter

- **Tout est global.** Les fichiers sont collés dans un seul `<script>`. Une
  fonction d'un fichier peut en appeler une d'un autre, mais **uniquement via
  des déclarations `function`** (elles deviennent des globals). Les `const`/`let`
  de portée script ne franchissent **pas** les frontières de fichier dans le
  *test runner* (qui `eval` chaque fichier séparément), même si elles le font
  dans le build concaténé. Conséquence pratique : un `const` partagé entre
  fichiers (ex. `MAX_SUMMARIES`) ne doit être **référencé qu'à l'intérieur de
  corps de fonctions** (exécutés au runtime, après chargement complet), jamais
  au top-level d'un autre fichier.
- **Noms top-level uniques** entre fichiers : le script concaténé est en
  `'use strict'` et une même portée — deux `const`/`let`/`function` homonymes au
  niveau racine cassent le build.
- `'use strict';` est la première instruction de `utils.js` (premier fichier) →
  tout le script est strict. Déclarer chaque variable, pas de global implicite.
- Garde de test obligatoire en fin de `main.js` :
  `if (typeof __TEST_ENV__ === 'undefined') { document.addEventListener('DOMContentLoaded', init); }`
- Les handlers référencés en `onclick=`/`oninput=` inline dans `index.html`
  doivent rester des fonctions globales portant exactement ces noms
  (`sendMessage`, `onSendBtn`, `newConversation`, `openSettings`,
  `onSaveSettings`, `selectSummaryInjectionMode`, `summaryBanner`, `deleteConv`,
  `onConvSearch`, `clearConvSearch`, `onEditMsg`, `switchMemoryTab`,
  `addMemoryEntry`, `deleteMemoryEntry`, `restoreMemoryEntry`,
  `startEditMemoryEntry`, `cancelMemoryEntryEdit`, `saveMemoryEntryEdit`,
  `forgetMemoryEntry`, `undoToolAck`, `downloadConvMd`, `downloadMsgMd`,
  `toggleReasoning`, …). Le bouton « Enregistrer »
  appelle `onSaveSettings()` — à ne pas confondre avec `saveSettings(obj)` de
  `storage.js` (persistance localStorage). Le bouton du composer appelle
  `onSendBtn()` (envoi **ou** stop selon `sending`), jamais `sendMessage()`
  directement.

## Pièges déjà payés (ne pas les ré-introduire)

Résumés ci-dessous ; développement complet, exemples et noms de fonctions
précis dans **`docs/pitfalls-detail.md`** — le lire avant de toucher au flux
de conversation, au streaming, aux résumés/titrage, à l'édition de message,
au patienteur, au raisonnement, au sélecteur de modèle, ou au KV cache.

1. **Un seul message `role: 'system'`.** Jamais en empiler plusieurs.
   `buildSystemMessage()` concatène `ROOT_SYSTEM_PROMPT` (doctrines build-time,
   toujours injectées si outils présents) + éventuellement `toolsSystemPrompt()`
   + le prompt système utilisateur.
2. **Injection ≠ appel d'outil.** L'injection de résumés est du texte ajouté
   par MIAOU ; les `tool_calls` sont déclenchés par le **modèle** uniquement.
3. **Le résultat d'un outil n'est jamais affiché** avant `finish_reason:
   'stop'`. Borne `MAX_TOURS` sur le nombre de tours, pas d'outils. Anti-
   redemande via `servedKeys` dans le même échange.
4. **Agrégation SSE par `index`.** `tool_calls` fragmentés : agréger par
   `tcDelta.index`, jamais parser `function.arguments` avant fin de stream.
5. **Pas de résumé sur conversation fraîche/avortée.** Seuil `hasSubstance()` :
   ≥1 user ET ≥1 assistant non trivial (≥8 car.). Backfill gardé sur présence
   d'URL seule (pas `configured`).
6. **Tombstones.** Suppression d'un souvenir = `suppressed: true` en conservant
   les données ; compte comme entrée présente (empêche re-résumé).
7. **Parsing défensif des résumés.** Nettoyage des fences ```` ```json ````
   avant `JSON.parse` ; échec → `null`, silencieux.
8. **Indicateur d'activité** via `runBackgroundTask(label, fn)`, toujours
   `try/finally`.
9. **Titrage robuste à la navigation.** `maybeTitle` fige `convId`/`thread`
   avant l'appel async ; pas de titre provisoire (« Nouvelle conversation »
   partout tant que non résolu).
10. **Arrêt du streaming** via `AbortController` unique ; `aborted: true`
    sans rollback, court-circuite avant tout traitement de tour suivant.
11. **Recherche historique.** Filtre persistant `convSearchFilter` ;
    `renderConvList()` reste sans argument exprès.
12. **Édition d'un message utilisateur.** `sendMessage`/`editUserMessage`
    partagent `runGenerationFromCurrentThread()` et `resolveSend(literal)`
    (chemin unique slash-skill, cf. `docs/skills.md`).
13. **Patienteur animé.** `startWaiter`/`stopWaiter` nettoient deux timers ;
    jamais patienteur + streaming simultanés.
14. **Affichage du raisonnement.** Détection par observation directe du delta
    (`reasoningDelta`), jamais via `reasoning_effort`. Champ séparé `reasoning`.
15. **Sélecteur de modèle (composer).** `settings.model` (défaut global) vs
    `conv.model`/`currentConvModel` (override par conversation) strictement
    séparés ; résolus par `activeModel()`.
16. **Préservation du KV cache (Ollama).** `buildSystemMessage()` reste
    statique ; contenu dynamique (date, mémoire) injecté en préfixe éphémère
    du dernier message user via `buildContextBlock()`, jamais dans le system
    message.

## Domaines détaillés (`docs/`)

À lire à la demande, selon la zone touchée — pas systématiquement :

- **`docs/pitfalls-detail.md`** — développement complet des 16 pièges ci-dessus.
- **`docs/storage.md`** — schéma `localStorage` (`miaou-settings`,
  `miaou-conversations`, `miaou-summaries`, `miaou-memories`,
  `miaou-mcp-servers`) et IndexedDB (`skills`, `resources`).
- **`docs/tools.md`** — registre d'outils (`tools.js`), mécanisme d'acks
  (`tool-ack`), et références de conversation dans le texte du modèle
  (`conv_ref`).
- **`docs/mcp.md`** — agrégation MCP distante (V2) : préfixage, routage,
  transport, timeout, dégradation gracieuse, D5–D10.
- **`docs/skills.md`** — skills stage 1 (CRUD, invocation slash, drawer) et
  stage 2 (autotrigger, doctrine de déclenchement, confirmation).
- **`docs/tests.md`** — ce qui est couvert par `tests/runner.py` (QuickJS) et
  ce qui doit être vérifié à la main (`docs/manual-tests.md`).
- **`docs/export-timestamps.md`** — export Markdown des conversations/messages
  (incluant traces d'outils) et fonctions d'horodatage.

## Règle d'or

En cas d'ambiguïté sur un point non couvert ici : **signaler plutôt que deviner**.
Le projet a déjà payé le prix de suppositions hâtives.

> Note : `.bg-activity` n'était pas dans la maquette d'origine et a été implémenté
> en intérimaire. **Avant de le retravailler**, demander les spécifications HTML/CSS
> plutôt que de redessiner à l'aveugle. (`.summary-banner` a depuis reçu une spec et
> une implémentation définitives — cette mise en garde ne le concerne plus.)
