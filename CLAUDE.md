# CLAUDE.md — MIAOU

Instructions pour travailler dans ce dépôt. Les pièges de conception et les
spécifications de référence sont intégrés directement ci-dessous.

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
concaténés dans l'ordre `JS_ORDER` : `utils, storage, tools, api, ui, main`).
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
  `onSaveSettings`, `selectMemoryMode`, `memoryBanner`, `deleteConv`,
  `onConvSearch`, `clearConvSearch`, `onEditMsg`, …). Le bouton « Enregistrer »
  appelle `onSaveSettings()` — à ne pas confondre avec `saveSettings(obj)` de
  `storage.js` (persistance localStorage). Le bouton du composer appelle
  `onSendBtn()` (envoi **ou** stop selon `sending`), jamais `sendMessage()`
  directement.

## Pièges déjà payés (ne pas les ré-introduire)

1. **Un seul message `role: 'system'`.** Jamais en empiler plusieurs : certains
   backends ne gardent que le premier. `buildSystemMessage()` concatène, dans
   l'ordre, la description des outils, le prompt système utilisateur, puis le
   bloc résumés. Le prompt système utilisateur est **toujours préservé tel quel**.
2. **Injection ≠ appel d'outil.** L'injection de résumés est du *texte* mis dans
   le message système par MIAOU (recherche locale). Les `tool_calls` sont
   déclenchés par le **modèle**. MIAOU n'appelle jamais d'outil de lui-même.
3. **Le résultat d'un outil n'est jamais affiché.** C'est une donnée
   intermédiaire (`role: 'tool'`, `tool_call_id` exact) renvoyée au modèle. La
   boucle `runConversation` (`api.js`) va **toujours jusqu'au `finish_reason:
   'stop'`** avant d'afficher quoi que ce soit. Borne : `MAX_TOURS` tours (pas
   une borne sur le nombre d'outils — tous les `tool_calls` d'un tour sont
   exécutés dans ce tour). **Anti-redemande par échange** : `servedKeys`
   (clé `nom:id` ou `nom:since`) court-circuite un appel déjà servi dans le même
   échange, pour les deux outils.
4. **Agrégation SSE par `index`.** Les `tool_calls` arrivent fragmentés :
   agréger strictement par `tcDelta.index`, ne jamais parser
   `function.arguments` avant la fin du stream, reprendre le `tool_call_id` exact.
   Ne rien afficher tant que `finish_reason` n'est pas connu et `'stop'` (le
   content d'un tour `tool_calls` est partiel/vide). Le rendu live (`onDelta`)
   est révoqué via `onToolTour()` si le tour s'avère être un `tool_calls`.
5. **Pas de résumé sur conversation fraîche/avortée.** Ne résumer (en sortie ou
   au backfill) que si `hasSubstance()` : **≥1 message user ET ≥1 assistant** au
   contenu non trivial (≥8 car.). Le but est d'écarter une conversation à peine
   née ou sans vraie réponse, **pas** d'exiger plusieurs allers-retours — le
   seuil initial ≥2/≥2 (conception d'origine) excluait à tort les
   conversations courantes en 1 Q/R (symptôme : « une seule entrée dans
   miaou-summaries »). Pas de `beforeunload` (non fiable). Le backfill
   (`runBackfill`) s'auto-garde sur la **présence d'URL** seulement (pas sur
   `configured`, qui exige une clef), pour couvrir les endpoints sans auth.
6. **Tombstones.** Supprimer un souvenir pose `suppressed: true` **en conservant
   les données du résumé** (titre, texte, mots-clés, messageCount) — ça ne
   supprime pas la conversation. Une tombstone **compte comme une entrée
   présente** : elle empêche le re-résumé, et recherche/outils ignorent les
   entrées `suppressed`. « Ré-autoriser » retire le flag → **retour instantané à
   l'état d'avant** si les données sont conservées ; sinon (tombstone legacy sans
   données, ou résumé jamais généré) l'UI régénère avec un loader inline sur
   l'item (`restoreMemory`, ui.js) et ne retombe sur la suppression de l'entrée
   (→ candidate au backfill) qu'en cas d'échec.
7. **Parsing défensif des résumés.** Le modèle enrobe parfois son JSON de fences
   ```` ```json ````. `parseSummaryJSON` nettoie puis `JSON.parse` ; en cas
   d'échec → `null`, abandon silencieux, aucune erreur affichée.
8. **Indicateur d'activité** via `bgActivityStart/End` (compteur, gère les
   chevauchements). **Toujours encadrer par `try/finally`** pour que
   `bgActivityEnd()` passe même en cas d'erreur. En pratique, passer par la
   mécanique réutilisable `runBackgroundTask(label, fn)` (main.js) : elle
   encadre une tâche LLM silencieuse par l'indicateur + try/finally + échec
   silencieux (retourne `null`). Titrage (`maybeTitle`) et résumé
   (`summarizeIfNeeded`) en sont deux clients. Le backfill l'enveloppe une fois
   et met à jour le libellé via `bgActivityLabel('résumés n/N')` sans toucher au
   compteur.
9. **Titrage robuste à la navigation.** `maybeTitle` fige `convId`/`thread`
   avant l'appel asynchrone ; au retour, `applyGeneratedTitle` écrit toujours en
   storage + liste, mais ne touche la barre du haut / le `<title>` que si on est
   **encore** sur cette conversation. Le titrage et le résumé tournent en
   arrière-plan (fire-and-forget) : envoi (1ʳᵉ Q/R) → titrage ; sortie de
   conversation → résumé+mots-clés ; démarrage → backfill des non-résumées.
   **Pas de titre provisoire** : tant que le titrage n'a pas abouti, la
   conversation s'affiche « Nouvelle conversation » **partout** — sidebar
   (fallback `c.title || 'Nouvelle conversation'`) et barre du haut (placeholder
   CSS `.conv-title-edit:empty::before`). Ne pas réintroduire de titre tronqué
   du 1ᵉʳ message (hétérogène : il n'apparaissait que dans la barre du haut).
10. **Arrêt du streaming.** `streamCompletion` ouvre un `AbortController`
    (`_currentAbort`, un seul à la fois) ; `abortStream()` l'annule. Sur
    `AbortError`, on **avale** l'erreur et on retourne le contenu déjà reçu avec
    `aborted: true` (pas de rollback). `runConversation` court-circuite sur
    `result.aborted` **avant** de traiter ou relancer un tour — donc stop coupe
    aussi au milieu d'une boucle d'outils, sans relance. Côté UI, le bouton du
    composer fait office de stop pendant le stream : il **n'est jamais désactivé**
    quand `sending` est vrai (cf. `setSending`/`syncConfigured`), `onSendBtn()`
    route vers `abortStream()`, et `setComposerStreaming(on)` bascule l'apparence
    (`.streaming`, icônes `.ic-send`/`.ic-stop`).
11. **Recherche historique.** Filtre persistant module-level `convSearchFilter`
    (ui.js), appliqué par `renderConvList()` — dont la **signature reste sans
    argument** exprès, pour que tous les appelants existants (sélection, maj
    arrière-plan) le respectent sans le savoir. `searchConversations(q)` renvoie
    un prédicat (sous-chaîne sur le titre **ou** `scoreSummary >= 1` sur le
    résumé non-tombstone) ou `null`. Les en-têtes de section vides disparaissent
    car émis à la volée sur la liste déjà filtrée. Après `clearConvSearch`, on
    `scrollIntoView` la `.conv.active` (elle peut être très ancienne et hors
    écran une fois la liste complète restaurée).
12. **Édition d'un message utilisateur.** `sendMessage` et `editUserMessage`
    partagent **un seul cœur** : `runGenerationFromCurrentThread()` (recherche
    mémoire sur le dernier message user + bannière + dispatch). Ne pas dupliquer
    la logique mémoire/outils. `editUserMessage(index, text)` **tronque**
    `currentThread` après l'index, remplace le contenu, **persiste avant** de
    relancer (sinon un reload à mauvais moment laisse un thread incohérent), puis
    relance par ce cœur. L'index est **recalculé au clic** (`msgIndex` = position
    du `.msg` dans le thread, 1:1 avec `currentThread`), jamais figé au rendu.
    Édition bloquée tant que `sending` (garde dans `onEditMsg`/`enterEditMode`).
13. **Patienteur animé.** Remplace le caret pendant l'attente : un point qui
    pulse (`.waiter-dot`, demeure) + un mot court tiré au hasard sans répéter le
    précédent (`pickWaiterWord`, fondu via `.waiter-word.fade`). `startWaiter`
    pose le markup et lance la rotation ; `stopWaiter` nettoie **les deux
    timers** (`_waiterRotate` l'interval, `_waiterFade` le timeout de mi-fondu)
    — sinon fuite ou changement de mot après coup. Posé en WAITING
    (`startAssistantMessage`) et à la reprise après un tour `tool_calls`
    (`resetAssistant`, d'où §4 du brief couvert sans toucher `api.js`). Coupé
    net dès le premier delta `content` (`stopWaiter` en tête de `streamInto`) :
    **jamais patienteur + contenu en streaming simultanés**. Le `cursor-blink`
    reste, lui, le caret de frappe **pendant** le streaming — ne pas confondre
    les deux. La transition CSS `.waiter-word` (.28s) doit matcher le délai du
    `_waiterFade` (280 ms).
14. **Affichage du raisonnement (thinking).** Détection **par observation
    directe** du delta, jamais via `reasoning_effort` : `reasoningDelta(delta)`
    (api.js) lit `reasoning` / `reasoning_content` / `thinking` et renvoie la
    string (**`''` = présence**, capacité détectée) ou `null` (champ absent).
    Agrégé à part dans `streamCompletion` (jamais traité comme du content),
    relayé en live par `onReasoning(full)`, accumulé entre tours via
    `joinReasoning` (un tour `tool_calls` raisonne avant l'appel : **flush dans
    `reasoningAcc` avant d'exécuter l'outil**, pas de parallèle), puis passé à
    `onFinal(content, reasoning)`. Persisté dans un **champ séparé** du message
    (`reasoning`, à côté de `content`) ; `buildMsg`/`assistantHead` le
    re-rendent au reload sans recalcul. UI : icône dans la barre `.meta`
    (révélée par `setReasoning` à la **première substance non vide** — un
    raisonnement `''` ne révèle rien), `toggleReasoning` déplie le bloc
    `.reasoning` (mono, atténué, replié par défaut). Le bloc survit à
    `resetAssistant`/`finalizeAssistant` (ils ne touchent que `.body`).
    **Écart assumé au brief §3** : l'icône est dans l'en-tête du message (au-
    dessus du patienteur), pas littéralement « à côté », pour un seul mécanisme
    de pliage valable en live comme au reload.
15. **Sélecteur de modèle (composer).** Deux notions **strictement séparées** :
    le *modèle par défaut* (`settings.model`, global) et l'*override de
    conversation* (`conv.model`, par conversation, en mémoire via
    `currentConvModel`). `activeModel()` (main.js) résout l'un **ou** l'autre,
    jamais les deux mélangés ; c'est lui qui alimente `dispatchSend` (modèle
    propagé par `runConversation({ model })` → `streamCompletion` `o.model ||
    cfg.model`) et le champ `model` du message assistant produit. Le titrage et
    le résumé (`silentCompletion`) restent sur le **modèle par défaut**.
    `currentConvModel` est remis à `''` par `resetToEmpty` (nouvelle conv →
    défaut), restauré par `openConversation`, persisté par `setConvModel` et
    `persistCurrent`. Liste des modèles **mise en cache pour la session**
    (`loadModelsCached`, ui.js, invalidée si l'URL backend change) : **un seul
    `/models` par session/backend**, pas de re-fetch à chaque ouverture du
    dropdown. Fallback silencieux : si `/models` échoue, le sélecteur **n'appa-
    raît pas** (visibilité = `showModelSelector` **ET** cache non vide, gérée par
    `syncModelUI`) et le défaut reste utilisé. Aucun filtrage des modèles listés
    (un modèle listé peut être non fonctionnel : pas de moyen de le savoir à
    l'avance) ; **pas de retry/fallback** à l'envoi en cas d'erreur — l'erreur
    s'affiche dans la bulle (catch existant de `dispatchSend`). Changer de modèle
    **ne touche jamais** l'historique ; passer le réglage à masqué **ne réinit-
    ialise pas** les overrides déjà posés (`syncModelUI` masque, l'override
    persiste et reste actif). La pastille topbar reflète aussi `activeModel()`
    (identique au défaut quand pas d'override).

16. **Préservation du KV cache (Ollama).** `buildSystemMessage()` ne contient
    que du contenu **statique** : prompt système configuré par l'utilisateur +
    `toolsSystemPrompt()`. Aucune dépendance à `Date.now()` ni aux résumés
    mémoire. Le contenu dynamique (date/heure, nom du modèle, bloc mémoire) est
    regroupé dans `buildContextBlock(matches)` et injecté **éphémèrement en
    préfixe du dernier message `role: 'user'`** dans `dispatchSend`, au moment
    de la construction du payload API — sans modifier `currentThread` ni
    localStorage. Cela préserve le préfixe `system message + historique[0..N-1]`
    byte-identique d'un tour à l'autre, ce qui permet au KV cache d'Ollama de
    réutiliser tout ce préfixe au lieu de le recalculer. Le dernier message user
    change de toute façon à chaque tour (nouvelle saisie), donc y attacher le
    contexte dynamique n'ajoute aucun coût de cache supplémentaire. Ne pas
    réintroduire `buildContextBlock()` dans `buildSystemMessage()` : le point de
    divergence serait avant tout l'historique, le cache ne profiterait plus à
    partir du 2ᵉ tour.

## Stockage (localStorage)

- `miaou-settings` : `{ url, key, model, systemPrompt, highlight, memoryMode,
  theme, showModelSelector, sidebarWidth }`. `memoryMode` ∈ `auto | propose |
  never`, défaut `propose`. `model` est le **modèle par défaut** (global).
  `showModelSelector` (défaut `false`) n'affecte que la visibilité du sélecteur
  dans le composer. `sidebarWidth` (défaut `264`) est la largeur redimensionnable
  de la sidebar, bornée `[264, 528]` (min = largeur d'origine, max = ×2), pilotée
  via la variable CSS `--sidebar-w` (cf. `initSidebarResize`, ui.js) ; pendant le
  drag, la classe `.resizing` coupe la transition de largeur, et la valeur finale
  est persistée au `mouseup`.
- `miaou-conversations` : tableau `[{ id, title, timestamp, updatedAt?, messages, model?,
  pinned? }]`. `updatedAt` (optionnel) est le timestamp du dernier `persistCurrent` ;
  absent sur les anciennes conversations (tri/affichage tombent alors sur `timestamp`).
  `model` (optionnel) est l'**override de modèle de la conversation**
  — à ne **jamais** confondre avec le champ `model` de chaque message assistant
  (quel modèle a produit *cette* réponse, cf. backfill modèle). `pinned`
  (optionnel, bool) épingle la conversation : `renderConvList()` regroupe les
  épinglées dans une section **Épinglé** (singulier assumé) en tête de liste,
  retirées de leur tranche temporelle ; toggle via `toggleConversationPin(id)`
  (storage) exposé par le handler global `togglePin(id)` (main.js).
- `miaou-summaries` : objet indexé par id de conversation. Trois états : résumé
  présent / tombstone (`suppressed: true`) / absent (candidat au backfill).

## Outils mémoire (`tools.js`)

Deux outils, additifs (un 3ᵉ s'ajoute au tableau `TOOLS`, `toolsSystemPrompt()`
le liste tout seul) :

- `get_conversation(id, with_contents=false)` — lit l'**index des résumés**
  (`getSummaryEntry`), pas la conversation brute : retourne résumé+mots-clés par
  défaut, plus les messages complets si `with_contents=true`. Introuvable si pas
  d'entrée ou tombstone.
- `list_conversations(since, with_contents=false)` — entrées non-tombstone
  (`listSummaryEntries`) dont `timestamp >= Date.parse(since)`. Date ISO 8601
  requise, erreur explicite si invalide.

Nom conservé `list_conversations` (et non `get_conversations`) pour éviter la
quasi-collision singulier/pluriel avec `get_conversation`, qui fait trébucher
les modèles à l'appel. `toolsSystemPrompt()` dérive sa
description **du registre** — ne jamais la coder en dur.

## Tests

Squelettes dans `tests/` exécutés par `tests/runner.py` (QuickJS, stubs
navigateur + framework maison). Seules les **fonctions pures** sont couvertes
(pas de `fetch` dans QuickJS) : tokenisation/scoring, les trois états de l'index
de résumés, le registre d'outils, parsing SSE/résumés. Adapter un squelette est
permis si le comportement testé est respecté (un cas l'a été : `indexOf` vaut 0
pour le premier élément, donc tester la présence avec `>= 0`, pas `toBeTruthy`).
La boucle `tool_calls` et `silentCompletion` se vérifient à la main (cf. README).

## Règle d'or

En cas d'ambiguïté sur un point non couvert ici : **signaler plutôt que deviner**.
Le projet a déjà payé le prix de suppositions hâtives.

> Note : `.memory-banner` et `.bg-activity` n'étaient pas dans la maquette
> d'origine — le mode mémoire et la vue souvenirs ont été construits dans le
> design system existant. `.memory-banner` et `.bg-activity` ont été implémentés
> en intérimaire. **Avant de les retravailler**, demander les spécifications
> HTML/CSS plutôt que de redessiner à l'aveugle.
