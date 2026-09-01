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

**Nouvelle feature utilisateur → se poser la question « faut-il mettre à jour
`src/help.md` ? »** `src/help.md` est l'aide utilisateur final servie au modèle
par l'outil `miaou__about` (injectée au build, une section par topic). Ce n'est
PAS de la doc dev (`docs/` l'est) : elle décrit ce que l'utilisateur peut faire,
sans internals. Toute capacité visible par l'utilisateur qu'on ajoute, modifie
ou retire doit déclencher cette question — si la réponse est oui, mettre à jour
la section concernée (souvent `interface`, sinon le topic dédié). L'oublier fait
confabuler le modèle sur les fonctionnalités de l'appli. Le contenu est
maintenu à la main, jamais généré depuis `docs/`.

**La question complète n'est pas « ai-je mis à jour `help.md` ? » mais « ai-je
mis à jour `help.md` ET ce qui le contredit maintenant ? »** Écrire le
paragraphe de la nouvelle capacité ne suffit pas : une **énumération fermée**
posée ailleurs dans le fichier (« deux types sont acceptés », « les trois
modes », « seuls X et Y », « uniquement ») devient fausse par le seul ajout d'un
cas, sans que rien ne la touche — le diff du lot ne la montre pas, et relire le
paragraphe ajouté ne la révèle pas non plus. Un modèle qui lit le topic en
entier rencontre le compte fermé AVANT la capacité, et conclut que la capacité
n'existe pas. Après l'ajout, relire la **section entière** et le topic `apercu`,
puis :

```bash
grep -nE "[Dd]eux |[Tt]rois |[Qq]uatre |[Cc]inq |seuls? |uniquement " src/help.md
```

Piège payé **six fois** (déplacement de conversation, bascule de thème d'export,
droits sur les souvenirs de profil, clef de thème, « deux types » du lot V-1, et
les énumérations qui ont oublié PowerPoint au lot V-5). `run_help_enumerations_check`
(runner.py) est le filet automatique sur les compteurs explicites — il ne
remplace pas la relecture, il attrape le cas le plus mécanique.

**Nouvelle feature utilisateur → deuxième question : « faut-il toucher au
`README.md` ? »** Le README est la doc d'**accueil** du dépôt (Forgejo/GitHub) :
ce qu'est MIAOU, comment l'ouvrir, ce qu'on peut en faire. **Une capacité
nouvelle y vaut une ligne, pas un paragraphe** — le mécanisme, les gardes
internes et les compromis vont dans `docs/<domaine>.md`, avec un `cf.` depuis le
README. Test décisif : si la phrase explique *comment c'est fait* plutôt que *ce
que ça permet*, elle n'est pas au bon endroit. Deux exceptions assumées, qui
restent au README parce qu'elles s'adressent à qui arrive sur le dépôt : les
clefs de `config.json` (`docs/build.md` y renvoie explicitement) et
l'avertissement de sécurité non-prod sur le jeton MCP. Piège déjà payé deux fois
(ventilation initiale, puis re-dérive pendant la campagne muscle) : le README
regonfle parce que chaque lot y verse le niveau de détail de son propre brief.

**Le contrôle des énumérations fermées vaut aussi pour le README.** La règle
posée plus haut pour `src/help.md` (« deux types », « les trois modes », « seuls
X et Y ») s'y applique à l'identique, et pour la même raison : un compte fermé
devient faux par le seul ajout d'un cas, sans que rien ne le touche. Le README y
est même plus exposé — il condense en une ligne ce que `help.md` développe en un
paragraphe, donc il énumère plus souvent. Passer le même grep sur les trois
fichiers après tout ajout de capacité **ou toute migration structurelle**
(déplacement de données entre stockages, renommage, fusion — pas seulement une
feature utilisateur visible) :

```bash
grep -nE "[Dd]eux |[Tt]rois |[Qq]uatre |[Cc]inq |seuls? |uniquement " src/help.md README.md CLAUDE.md
```

**Ce grep ne couvre que les compteurs explicites** — il ne voit pas une liste
recopiée en prose (les fichiers de `CSS_ORDER`, les clés d'un store), qui
n'annonce pas son propre compte. Contre celle-là il n'existe pas de grep :
pointer la constante source, ne jamais la recopier. Même réflexe pour un compte
posé loin de ce qu'il compte (« les quatre marqueurs », deux paragraphes plus
bas) : nommer plutôt que compter.

Piège payé le 2026-08-29 : « Trois façons de l'alimenter » pour la bibliothèque
d'Espace, périmé depuis que le modèle peut y déposer un fichier qu'il vient de
produire (une quatrième). `help.md` disait bien « quatre », le README était resté
à trois — l'écart a survécu à plusieurs lots parce que le grep de la règle ne
visait qu'un seul des deux fichiers.

Piège payé le 2026-08-31 : la ligne d'index `docs/storage.md` (section
« Domaines détaillés » plus bas) énumérait encore `miaou-conversations`/
`miaou-summaries` comme clés `localStorage`, alors qu'elles avaient migré vers
IndexedDB au lot U — une migration structurelle, sans feature utilisateur
visible, donc sans déclencheur évident pour relire cette ligne. Le grep ne
visait alors que `help.md`/`README.md` : étendu à `CLAUDE.md` depuis.

Python via `uv` exclusivement. `config.json` (copié de `config.sample.json`) est
local et non versionné ; `dist/miaou.html` est versionné intentionnellement.

**Messages de commit en anglais** (le reste des échanges reste en français) —
**intégralement : sujet ET corps**, y compris un corps long et développé,
au format **Conventional Commits** : `type(scope): sujet à l'impératif`.
Types en usage dans le dépôt : `feat`, `fix`, `refactor`, `docs`, `test`,
`style`, `build`, `chore`. Le **scope est facultatif** — le mettre quand il
situe utilement le changement (domaine fonctionnel : `spaces`, `export`,
`tools`, `sync`, `ui`…, ou namespace d'outil pour un lot qui en livre un),
l'omettre quand le changement est transverse. Le corps du message, lui, est
libre **de forme** (pas de langue) et développé : il explique le pourquoi, pas
le quoi. Piège déjà payé : un corps rédigé en français parce que la session se
déroule en français — la règle de langue couvre le message entier.

## Pipeline de build (ne pas le réécrire — détail : `docs/build.md`)

`build.py` assemble `dist/miaou.html` à partir de `src/html/index.html` par
substitution de placeholders. Ossature à garder en tête ; le **raisonnement fin**
(échappement `</`, `try/catch` vs `typeof`, valeurs dérivées) est dans
`docs/build.md` — le lire avant de toucher au build ou aux points d'injection.

- **`/* __CSS__ */`** ← `src/css/*.css` dans l'ordre `CSS_ORDER` — **l'ordre EST
  la cascade** ; `base` porte l'@import des fontes, `theme-light` reste dernier.
- **`/* __JS__ */`** ← `src/js/*.js` dans l'ordre `JS_ORDER` (`docs.js` porte le
  domaine « ouvrir un document » du lot V, cf. `docs/documents.md` pour la ligne
  de partage avec `utils`).

  **Les deux listes ne sont recopiées nulle part** — la seule énumération est
  celle de `build.py` (constantes en tête de fichier), à lire là-bas. Elles
  l'ont été un temps ici ET dans `docs/build.md`, et ont dérivé exactement comme
  le décrit la règle des énumérations fermées : chaque copie mise à jour
  indépendamment, donc aucune complète (`palette` manquant au CSS ; `docs`,
  `sync`, `agents` au JS). Une liste de fichiers n'annonce pas son propre
  compte : le `grep` des compteurs explicites ne peut pas l'attraper, seule la
  non-duplication protège.
- **`__MIAOU_CONFIG__`** ← `config.json` sérialisé (injecté dans `storage.js`,
  d'où dérivent `REQUIRE_API_KEY`, `MAX_SUMMARIES`, `BUILD_API_URL`,
  `BUILD_API_MODEL`).
- **`__MIAOU_HELP__`** ← `src/help.md` parsé en `{slug: markdown}` (injecté
  dans `tools.js`, alimente `miaou__about` et l'enum `topic`).
- **`__MIAOU_SYSTEM_SKILLS__`** ← `src/system-skills/*.md` (un fichier par
  skill, nom de fichier = slug) parsés en `{slug: {name, description,
  content}}` (injecté dans `skills.js`, upserté en IDB à chaque démarrage par
  `ensureSystemSkills()` — skills non éditables par l'utilisateur, `enabled`/
  `autotrigger` figés à `true`, cf. `docs/skills.md`).

Les commentaires sont retirés au passage (`strip_js_comments`/`strip_css_comments`/
`strip_html_comments`, testés dans `run_build_unit_tests`) : `src/` reste la
référence commentée, `dist/` est compact. Les marqueurs `__MIAOU_*` ci-dessus
sont à **occurrence unique en position de valeur**, avec une garde `try/catch`
côté source pour que les tests QuickJS (sources non buildées) retombent sur
`{}`. **`HELP_CONTENT`
n'entre jamais dans le contexte du modèle** : seul le blurb d'identité et l'enum
de slugs y vont, le contenu des sections arrive en tool result à la demande.

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
- Les handlers câblés depuis l'UI doivent rester des fonctions globales portant
  **exactement** le nom attendu au point de câblage — que ce soit un attribut
  `onclick=`/`oninput=` **statique** dans `index.html`, un attribut **généré**
  en template string dans `ui.js` (ex. `onRegenerateFileDescription`), ou un
  `addEventListener`/callback (ainsi `sendMessage`, `undoToolAck`, `deleteConv`
  ne sont jamais en attribut inline littéral mais restent des globals appelés
  par listener/closure). Renommer/déplacer un tel handler sans mettre à jour son
  câblage casse silencieusement. Deux pièges de nommage à connaître :
  - Le bouton « Enregistrer » appelle `onSaveSettings()` — **pas** `saveSettings(obj)`
    de `storage.js` (persistance localStorage). Il est désactivé tant que le
    formulaire ne diverge pas des réglages persistés (`settingsFormDirty`, ui.js
    — le thème est exclu : auto-persisté par `selectTheme`).
  - Le bouton du composer appelle `onSendBtn()` (envoi **ou** stop selon
    `sending`), jamais `sendMessage()` directement.

## Pièges déjà payés (ne pas les ré-introduire)

Une ligne par piège ci-dessous — **développement complet, exemples et noms de
fonctions dans `docs/pitfalls-detail.md`** (le lire avant de toucher au flux de
conversation, au streaming, aux résumés/titrage, à l'édition de message, au
patienteur, au raisonnement, au sélecteur de modèle, ou au KV cache). Les pièges
16, 18, 21, 24 et 28 sont les **invariants transverses** : ils gouvernent des
frontières traversées par beaucoup de code, donc on peut les enfreindre sans
savoir qu'on entre dans leur domaine. Leur ligne ci-dessous porte pour cette
raison le prédicat et l'interdit, pas seulement l'intitulé — de quoi arrêter le
geste ; le développement est dans la doc pointée.

1. **Un seul message `role: 'system'`.** `buildSystemMessage()` concatène tout
   dans l'ordre (`IDENTITY_BLURB` en tête, … `CODEBLOCK_DOCTRINE`, prompt
   utilisateur, description du Space) ; jamais empiler plusieurs `system`.
2. **Injection ≠ appel d'outil.** L'injection de résumés est du texte ajouté par
   MIAOU ; les `tool_calls` viennent du **modèle** uniquement.
3. **Résultat d'outil jamais affiché avant `finish_reason: 'stop'`.** Borne
   `MAX_TOURS` sur les tours ; anti-redemande via `servedKeys`.
4. **Agrégation SSE par `index`.** Agréger `tool_calls` fragmentés par
   `tcDelta.index` ; ne pas parser `function.arguments` avant fin de stream.
5. **Pas de résumé sur conversation fraîche/avortée.** Seuil `hasSubstance()`
   (≥1 user ET ≥1 assistant ≥8 car.). Backfill gardé sur URL seule.
6. **Tombstones.** Suppression d'un souvenir = `suppressed: true`, données
   conservées ; compte comme entrée présente (empêche re-résumé).
7. **Parsing défensif des résumés.** Nettoyer les fences ` ```json ` avant
   `JSON.parse` ; échec → `null` silencieux.
8. **Indicateur d'activité** via `runBackgroundTask(label, fn)`, toujours
   `try/finally`.
9. **Titrage robuste à la navigation.** `maybeTitle` fige `convId`/`thread` avant
   l'async ; gouverné par `needTitle` (réarmé par `openConversation` si
   `!conv.title`) ; `regenerateTitle` l'ignore et retitre à la demande.
10. **Arrêt du streaming** via `AbortController` unique ; `aborted: true` sans
    rollback, court-circuite le tour suivant. Pendant un tour d'outils
    (`gen.abort` momentanément null), Stop pose `gen.stopRequested` : honoré à
    la frontière de tour suivante, jamais un outil en vol interrompu. Le même
    controller porte le **chien de garde d'inactivité** (`STREAM_IDLE_TIMEOUT_MS`,
    api.js) : réarmé à chaque chunk, il couvre connexion ET flux — sans lui une
    connexion morte sans FIN laisse la génération enregistrée à jamais et
    `isGenerating()` vrai (conversation jamais résumée, payé en prod). Tout
    appel réseau reste borné, sans exception.
11. **Recherche historique.** Filtre persistant `convSearchFilter` ;
    `renderConvList()` reste sans argument exprès.
12. **Édition d'un message utilisateur.** `sendMessage`/`editUserMessage`
    partagent `runGenerationFromCurrentThread()` et `resolveSend(literal)`.
13. **Patienteur animé.** `startWaiter`/`stopWaiter` nettoient deux timers ;
    jamais patienteur + streaming simultanés.
14. **Affichage du raisonnement.** Détection par observation directe du delta
    (`reasoningDelta`), jamais via `reasoning_effort` ; champ séparé `reasoning`.
15. **Sélecteur de modèle (composer).** `settings.model` (défaut global) vs
    `conv.model`/`currentConvModel` (override) séparés ; résolus par
    `activeModel()`.
16. **Préservation du KV cache (Ollama).** `buildSystemMessage()` reste
    **statique** ; tout contenu dynamique (date, mémoire) est injecté en préfixe
    éphémère du dernier message user via `buildContextBlock()`, jamais dans le
    system message. Ce qui compte est la **stabilité d'un tour à l'autre**, pas
    l'immuabilité : modifier un contenu statique invalide le préfixe une fois,
    puis il se re-stabilise — le piège vise les invalidations **récurrentes**.
    Ne pas en faire un veto contre tout changement de contenu statique.
    Cf. `docs/pitfalls-detail.md`.
17. **Persistance des images jointes (content parts → descripteur).** Image en
    content parts OpenAI (`image_url` base64) **seulement au tour d'attache** ;
    ensuite le message user est réécrit **une fois** en string = texte + ligne(s)
    de descripteur byte-stable (`collapseAttachedMessageContent`, idempotente,
    calculée depuis les champs FIGÉS `name`/`w`/`h`/`size`, jamais recalculée
    depuis les octets).
18. **Herméticité des Spaces : un seul prédicat, partout.** `spaceConvIds(spaceId,
    convs)` (storage.js, pure) est LA source de vérité pour « cette conversation
    appartient-elle au Space actif ? » — jamais un filtre `c.spaceId === x`
    réécrit localement. Un id hors-Space répond comme **inexistant** (pas
    d'oracle). Deux exceptions sanctionnées seulement (palette de commandes,
    badges d'activité), toutes deux décidées explicitement.
    Cf. `docs/pitfalls-detail.md` et `docs/spaces.md`.
19. **Recall d'image : ré-injection via message user synthétique, jamais dans
    `role:'tool'`.** Le handler renvoie un tool result annonciateur ; l'image
    revient via un message user synthétique émis par `expandThread`, sa dataUrl
    reconstruite à chaque envoi par `resolveRecallImages` (champ `recallImage`,
    **jamais persisté**) → byte-stable, KV-safe (brief A2/D3). **Corollaire
    V-8 : une image PRODUITE par un outil emprunte ce MÊME chemin**, en portant
    un `attId` (`storeAttachment`, jamais `_storeBlock`) et le même
    `kind:'attachment_recalled'` — le chemin est adressé par `attId`, et en
    ouvrir un second signifierait deux prédicats de ré-injection qui divergent
    en silence. Un champ `origin` distingue les producteurs **pour l'affichage
    seulement** (cf. `docs__render_page`, `docs/documents.md`).
20. **Résumé orphelin après suppression concurrente.** `summarizeIfNeeded`/
    `restoreSummaryItem`/`runBackfill` re-vérifient `loadConversation(id)` juste
    avant `saveSummary` ; `pruneOrphanSummariesOnInit()` nettoie au démarrage.
21. **Export HTML standalone : un seul chemin string→HTML à risque.** L'export
    hérite de la sûreté de l'écran UNIQUEMENT parce qu'il re-rend via
    `renderMd`/`renderUserMd` (sortie passée à `sanitizeHtml`/DOMPurify), jamais
    un clone/strip du `#thread` live. `formatToolAcksHtml` est l'EXCEPTION —
    seule fonction concaténant des chaînes d'origine modèle/outil en HTML :
    `escHtml` y est systématique, et toute extension similaire doit faire de
    même. Cf. `docs/pitfalls-detail.md` et `docs/exports.md`.
22. **`EXPORT_CSS` ne suit PAS `chat.css`/`tools.css`/`composer.css`.** Feuille
    dédiée figée (lot G) : retoucher une classe réutilisée par l'export ne
    propage rien (sauf tokens de couleur via `getComputedStyle`). Revue manuelle
    à la charge de qui touche ce CSS (cf. `docs/exports.md`). **`EXPORT_CSS` et
    `EXPORT_SCRIPT` sont des template literals** : jamais de backtick dans leur
    contenu, commentaires compris (un `` `.body` `` dans un commentaire CSS clôt
    la chaîne — le build passe, mais le chargement du fichier casse en
    `TypeError: not a function`, erreur payée au lot R). Leurs commentaires sont
    retirés au build (ils partaient sinon dans **chaque fichier exporté**) :
    `strip_export_css_comments` / `strip_export_script_comments`. Corollaire pour
    `EXPORT_SCRIPT` : **commentaires `//` en pleine ligne UNIQUEMENT** — sa passe
    ne regarde jamais l'intérieur d'une ligne de code (les échappements y sont
    doublés par le literal, un scanner JS complet n'y lit pas la même chaîne que
    le moteur), donc un bloc `/* */` ou un `//` en fin de ligne survivrait en
    silence. Deux tests de `run_build_unit_tests` gardent la règle sur la source
    réelle (cf. `docs/exports.md`).
23. **Préviz HTML/SVG : la frontière est l'iframe sandbox, aucune autre voie.**
    Markup modèle rendu **uniquement** dans un `<iframe sandbox="allow-scripts">`
    **sans `allow-same-origin`** (`decoratePre`) ; `srcdoc` posé par propriété
    JS, jamais interpolé en template string. Ne jamais ajouter `allow-same-origin`
    ni une autre voie d'injection (cf. `docs/rendering.md`).
24. **Synchro multi-onglets : broadcast POST-commit, relecture APRÈS l'await.**
    (a) Tout `syncPost` de mutation suit le `setItem`/`tx.oncomplete`
    correspondant — jamais avant, et en IDB sur `tx.oncomplete`, **jamais**
    `req.onsuccess`. (b) Un récepteur qui rehydrate relit l'état **après** son
    `await`, jamais un instantané figé avant (bug « toujours en retard d'un
    tour »). Règle générale : tout `await` entre la réception d'un signal et le
    commit du rendu est une fenêtre où le store peut avancer.
    Cf. `docs/pitfalls-detail.md` et `docs/multitab-sync.md`.
25. **Monde guest `js__eval` clos : deux host functions, énumérées, jamais plus.**
    Le JS d'origine modèle tourne dans un bac à sable QuickJS-WASM
    (`runInQuickJs`, tools.js). Surface guest FERMÉE : `__miaou_text(key)`
    (entrée) et, seulement si un `output_handle` est fourni, `__miaou_emit()`
    (sortie) — **jamais `fetch`, DOM, `globalThis` hôte, ni aucun autre pont**,
    symétrique du « jamais `allow-same-origin` » du piège 23. Un test compte les
    `ctx.newFunction` (deux) pour qu'un élargissement soit une décision, pas un
    effet de bord. Trois guards obligatoires (timeout, mémoire, cap de sortie),
    handles VM disposés en `try/finally`, overflow = **refus explicite, pas
    troncature**. `escHtml` impératif à l'export (le `code` vient du modèle,
    exception au piège 21). Cf. `docs/tools.md` (section `js__eval`).
26. **Réécriture d'historique model-triggered (lot O-2).**
    `resource__from_result` mute **en place** le `entry.result` d'un ack passé,
    sur décision du modèle. Trois gardes : source unique de dérivation d'id
    (`enrichedAckGroups`, partagée par l'émission et la résolution — jamais deux
    formules) ; réentrance (cible gelée avant l'`await`, **re-résolue après**) ;
    jamais `_makeResourceRef` (ré-inline tout — piège du lot M), toujours
    `formatInlineHandleForModel`. Cf. `docs/tools.md` (section
    « Matérialisation de ressource model-side »).
27. **Interjection mid-génération : bulle assistant `_acksOnly` matérialisée,
    élaguée à l'émission (lot Q).** Les acks d'un tour interrompu n'ont pas
    d'assistant hôte : on en matérialise un à `content` vide pour que live et
    reload passent par le MÊME chemin, **jamais** une classe DOM hors-thread.
    `expandThread` élague à l'émission tout assistant à content blanc (bruit KV,
    et 400 sur les backends stricts). La bulle user de l'interjection est
    **authentique**, jamais `_synthetic`. Cf. `docs/interjections.md`.
28. **Une génération écrit dans SA conversation, jamais dans l'écran (lot T-1).**
    Trois questions distinctes, chacune avec SON prédicat unique, jamais réécrit
    localement : « où j'écris ? » → `gen.thread`/`persistGeneration`, jamais
    `currentThread`/`persistCurrent` (qui suivent l'écran) ; « est-ce que je
    peins ? » → `genOwnsScreen(gen)`, qui sépare muter le thread (TOUJOURS) de
    refléter dans le DOM (si vrai) ; « dans quel référentiel je réponds ? » →
    `ctx` en argument explicite jusqu'aux handlers (`toolCtx`), jamais une
    globale. Corollaire : `sending` veut dire « la conversation AFFICHÉE
    génère », pas « une génération tourne » (pour ça, `_activeGenerations.size`).
    Tout re-rendu du fil passe par `rerenderCurrentThread()`, jamais
    `renderThread` nu. Cf. `docs/generations.md`.

## Domaines détaillés (`docs/`)

À lire à la demande, selon la zone touchée — pas systématiquement.

**Toute modification d'un `docs/*.md` déclenche la question : « la ligne
d'index ci-dessous le décrit-elle encore correctement ? »** La ligne résume en
quelques mots-clés/décomptes/noms de fonctions le contenu du fichier ; si le
lot change un fait qu'elle cite (clé renommée/déplacée, décompte fermé,
fonction renommée), la relire et la corriger dans le même lot. Piège payé le
2026-08-31, cf. plus haut (§ énumérations fermées) : une migration
structurelle (lot U, `localStorage` → IndexedDB) a laissé la ligne d'index de
`docs/storage.md` fausse pendant plusieurs lots, faute de déclencheur évident.

- **`docs/build.md`** — pipeline de build en détail : concaténation/strip,
  marqueurs `__MIAOU_CONFIG__`/`__MIAOU_HELP__`/`__MIAOU_SYSTEM_SKILLS__`,
  points d'injection et gardes `try/catch`.
- **`docs/pitfalls-detail.md`** — développement complet des pièges 1-24
  ci-dessus, invariants transverses 16/18/21/24 compris. Les pièges 25 à 28 sont
  développés dans leur doc de domaine (`docs/tools.md` pour 25 et 26,
  `docs/interjections.md` pour 27, `docs/generations.md` pour 28).
- **`docs/storage.md`** — schéma `localStorage` (`miaou-settings`,
  `miaou-memories`, `miaou-mcp-servers`, `miaou-api-servers`,
  `miaou-active-api-server`, `miaou-spaces`, `miaou-active-space`) et
  IndexedDB (`skills`, `resources`, `conversations`, `summaries` — ces deux
  derniers migrés depuis localStorage au lot U), plus le format d'export/import
  complet (`.zip` depuis le lot V-3).
- **`docs/tools.md`** — registre d'outils (`tools.js`), mécanisme d'acks
  (`tool-ack`), inspecteur d'appel d'outil (lot Z : loupe par ack,
  `ackHasInspectableDetail`, drawer de détail non tronqué), et références de
  conversation dans le texte du modèle (`conv_ref`).
- **`docs/documents.md`** — documents natifs (lot V, `docs__*`) : les cinq
  formats ouverts sans serveur (zip, PDF, Excel, Word, PowerPoint), artefacts
  CDN et versions gelées, selectors par format, caps de lecture, et la ligne de
  partage `docs.js` / `utils.js` (lot V-7).
- **`docs/context-inspector.md`** — inspecteur de contexte (brief B) : manifeste
  par bloc logique du contexte envoyé au modèle (`buildContextManifest`, pur) et
  totaux chars/tokens, rendu dans le drawer (`renderContextInspector`).
- **`docs/spaces.md`** — Spaces / « Espaces » (lot C) : herméticité (piège 18,
  `spaceConvIds`), default Space, scope `profile` des souvenirs, description de
  Space concaténée au prompt système, bibliothèque de fichiers par Space.
- **`docs/mcp.md`** — agrégation MCP distante (V2) : préfixage, routage,
  transport, timeout, dégradation gracieuse, D5–D10.
- **`docs/skills.md`** — skills stage 1 (CRUD, invocation slash, drawer) et
  stage 2 (autotrigger, doctrine de déclenchement, confirmation).
- **`docs/tests.md`** — ce qui est couvert par `tests/runner.py` (QuickJS) et
  ce qui doit être vérifié à la main (`docs/manual-tests.md`).
- **`docs/exports.md`** — export Markdown et export HTML standalone des
  conversations/messages (incluant traces d'outils) et fonctions d'horodatage.
- **`docs/palettes.md`** — palettes de couleurs (lot S-a) : deux axes
  orthogonaux (luminosité × palette), dérivation HSL des tokens, exceptions
  hors palette (logotype, code inline, sémantiques), condition de gratuité à
  l'export.
- **`docs/fonts.md`** — lots de fontes appairés (lot S-b) : troisième axe de
  présentation, `@import` unique préchargeant les six familles, contraintes
  d'une mono (tabular-nums de l'inspecteur), export en statu quo.
- **`docs/rendering.md`** — rendu enrichi des blocs de code : diagrammes
  Mermaid (lazy-load, cycle de rendu, toggle, thème, posture de sécurité).
- **`docs/command-palette.md`** — palette Ctrl/Cmd+K (lot F) : registre
  déclaratif, sous-modes, intégration clavier, recherche cross-Space assumée.
- **`docs/multitab-sync.md`** — synchro multi-onglets (lot J, BroadcastChannel) :
  protocole d'enveloppe, liste fermée de types, émetteurs/récepteurs, file
  d'attente pendant génération, soft-lock, readonly/heartbeat/TTL, doctrine
  broadcast post-commit + relecture post-await (piège 24).
- **`docs/interjections.md`** — interjections mid-génération (lot Q) : file
  locale de messages tapés pendant une génération, clefée PAR CONVERSATION
  (X-1e) et drainée à la frontière de tour (réaiguillage mid-boucle) ou en fin
  d'échange nominale ; composer en mode file, puces annulables/éditables/
  copiables, bulle assistant matérialisée (`_acksOnly`, piège 27), reflux sur
  fin non-nominale, file échouée quand ni drain ni reflux ne s'appliquent
  (fil d'agent en lecture seule, X-1f).
- **`docs/badges.md`** — badges d'activité (lot T-2) : deux états (working
  pulsant / unread statique), prédicat unique `convBadgeState`, agrégation
  cross-Space assumée, quatre surfaces et leurs points de synchronisation,
  volatilité du non-lu.
- **`docs/agents.md`** — agents (lot X) : sous-conversations lancées par le
  modèle, prédicat de racine `isRootConversation` et les sept exclusions,
  outils `agent__*` et garde de parenté, chemin d'exécution dédié, réveil du
  parent accroché au `finally`, extension et alignement des badges, lecture
  seule d'un agent terminé (`isFinishedAgentConv`) et interjections reçues
  pendant son travail (X-1f).
- **`docs/generations.md`** — générations en vol / multitâche (lot T) : objet
  génération et registre `_activeGenerations` (clé `convId`), deux chemins de
  persistance (`persistCurrent` écran vs `persistGeneration`), projection pure
  partagée `projectThreadToMessages`, rebranchement des données dans
  `openConversation`, `sending` reflet d'écran, abort ciblé par conversation ;
  prédicat unique `genOwnsScreen` et scission des hooks (muter le thread
  toujours / refléter dans le DOM si l'écran est possédé), attache/détache et
  `splitTrailingAcks`, `rerenderCurrentThread` obligatoire pour tout re-rendu.

## Composants UI provisoires (ne pas redessiner sans spec)

Un composant visuel implémenté en intérimaire ne se retravaille pas à l'aveugle :
demander les spécifications HTML/CSS avant de le redessiner. Seul cas restant :
**`.bg-activity`** (indicateur d'activité de fond, `chat.css`, `index.html`,
piloté par `runBackgroundTask`), hors maquette d'origine. (`.summary-banner`
relevait de la même réserve mais a depuis reçu une spec définitive — plus
concerné.)

## Règle d'or

En cas d'ambiguïté sur un point non couvert ici : **signaler plutôt que deviner**.
Le projet a déjà payé le prix de suppositions hâtives.
