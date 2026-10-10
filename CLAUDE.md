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
**La publication est une question à part** : le push sur `origin` (qui déploie)
et la synchro GitHub se demandent chacun par une question dédiée,
posée APRÈS que l'utilisateur a pu tester — jamais déduits de l'approbation du
travail, même quand la liste approuvée mentionne le push. S'arrêter après les
commits.

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

**La règle vaut aussi dans les scripts de vérification** (`.claude/skills/
run-miaou/*.mjs`), et c'est là qu'elle est le moins surveillée : aucun grep ne
les vise, et un compte y a la forme d'une assertion, donc il *semble* vérifié.
Rejeu complet de la suite le 2026-09-05 : cinq scripts rouges sur ce seul motif
(`=== 5` pour « 2 skills seedées + 3 système » alors qu'il y en a cinq,
`count === 3` pour le namespace `resource__` que `resource__append` avait porté
à quatre). Ne pas ré-incrémenter le nombre — il repérime au prochain ajout.
Le lire depuis la source vivante (`Object.keys(SYSTEM_SKILLS_CONTENT).length`),
ou remplacer le cardinal par l'**ensemble des noms attendus**, qui a l'avantage
de dire *lequel* manque quand il tombe : un compte nu ne le dit pas.

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
  de partage avec `utils` ; `mcp.js` porte le côté DISTANT de l'agrégation MCP —
  client JSON-RPC, handshake, `callRemoteTool` — là où ce qui COMPOSE interne et
  distant reste dans `tools.js`, cf. `docs/mcp.md` ; `mcp-skills.js` porte les
  purs des skills SERVIES par un serveur MCP — intégrité (SHA-256, frontmatter
  strict), à distinguer de `skills.js`, qui porte les skills locales, cf.
  `docs/skills.md` ; `export.js` porte les
  exports standalone et la conversion `.md` — pièges 21 et 22 —, cf.
  `docs/exports.md` ; `acks.js` porte le rendu des traces d'outils et
  l'inspecteur d'appel, cf. `docs/tools.md` ; `multitab.js` porte la couche
  APPLICATIVE de la synchro multi-onglets — réception, soft-lock, relais
  readonly —, là où `sync.js` garde le noyau pur et l'adaptateur, cf.
  `docs/multitab-sync.md` ; `pwa.js` porte ce qui ne s'active qu'en page
  servie — enregistrement du service worker, cf. `docs/pwa.md`).

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
- **`__MIAOU_HELP_LABELS__`** ← les libellés lisibles des titres de `src/help.md`
  (`## slug — libellé`), parsés en `{slug: libellé}` par la MÊME passe
  (`parse_help_sections`, qui rend un couple). Injectés dans `tools.js` ; ils
  composent au runtime la liste des sujets d'`apercu` via le jeton
  `{{TOPIC_LIST}}` — ajouter ou scinder une section suffit à l'y annoncer, là où
  la liste rédigée en prose devenait fausse en silence (cf. `docs/build.md`).
- **`__MIAOU_LOGO_SVG__`** ← `src/svg/cat.svg`, injecté **inline** aux TROIS
  surfaces de logo du template (boot, sidebar, topbar) : seul l'inline laisse le
  CSS de la page atteindre yeux et sourcils. Les ids internes sont suffixés par
  instance (`url(#gB)` résoudrait sinon sur la première copie du document) et le
  compte est vérifié — le build ÉCHOUE si le nombre d'occurrences a bougé.
  `__MIAOU_LOGO_DATA__` ← le même fichier en data-URI base64 (injecté dans
  `main.js`, d'où `LOGO_SRC` pour favicon/glyphe du fil/export). Cf.
  `docs/backend-health.md` pour la raison du montage et l'impasse `<use>`.
- **`__MIAOU_SYSTEM_SKILLS__`** ← `src/system-skills/*.md` (un fichier par
  skill, nom de fichier = slug) parsés en `{slug: {name, description,
  content, userInvocable}}` (injecté dans `skills.js`, upserté en IDB à chaque
  démarrage par `ensureSystemSkills()` — skills non éditables par
  l'utilisateur, `enabled`/`autotrigger` figés à `true`, absentes de
  l'autocomplétion du `/` sauf `metadata.user-invocable: true`, cf.
  `docs/skills.md`).

- **`__MIAOU_BUILD_ID__`** ← empreinte du contenu de `miaou.html`, calculée
  sur un second assemblage à horodatage neutre (un rebuild identique rend le
  même id) ; injectée dans `storage.js` (`BUILD_ID`, compte vérifié au build)
  et écrite dans `dist/version.json`. Le build dépose aussi dans `dist/` le
  manifeste et les icônes PWA de `src/pwa/` ; les PNG viennent de
  `scripts/make-icons.py` (uv), gardés par une empreinte du logo
  (cf. `docs/build.md`, `docs/pwa.md`).

Les commentaires sont retirés au passage (`strip_js_comments`/`strip_css_comments`/
`strip_html_comments`, testés dans `run_build_unit_tests`) : `src/` reste la
référence commentée, `dist/` est compact. Les marqueurs `__MIAOU_*` injectés dans le JS
sont à **occurrence unique en position de valeur**, avec une garde `try/catch`
côté source pour que les tests QuickJS (sources non buildées) retombent sur une
valeur neutre. `__MIAOU_LOGO_SVG__` est l'exception et déroge aux deux points :
il est injecté dans le HTML, et délibérément à occurrences MULTIPLES — leur
nombre est vérifié au build plutôt que supposé (cf. `LOGO_INSTANCES`). **`HELP_CONTENT`
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
- **Infobulle = `setTip(el, …)` / `tipAttrs(…)` dans un gabarit / `data-tip`
  dans `index.html`, jamais `title`** (lot AH). Le point d'écriture unique donne
  aussi leur nom accessible aux boutons-icônes : il lit le porteur au moment de
  l'appel, donc l'infobulle se pose APRÈS le contenu et l'`aria-label` d'auteur ;
  dans un gabarit, passer `{ text }` pour un porteur qui affiche du texte, et
  l'`aria-label` d'auteur en `{ ariaLabel }` plutôt qu'à côté. Lire une infobulle
  = `getTip`. Filet : `run_native_title_check` (runner.py). L'export garde le
  natif. Cf. `docs/tooltips.md`.

## Coût en contexte (tout ajout de texte adressé au modèle se pèse)

Un outil, une doctrine, une consigne ajoutée au prompt système sont **payés à
chaque tour de chaque conversation**. Le contexte fixe (définitions d'outils +
prompt racine) pèse ~47 000 caractères ≈ 12 000 tokens : c'est le plancher de
toute conversation, avant le moindre message. Trois règles avant d'y ajouter
quoi que ce soit.

**1. Mesurer sur la sortie composée, jamais sur la source.** Le seul point de
mesure juste des définitions d'outils est `JSON.stringify(toolDefinitions())` —
celui qu'utilise déjà `buildContextManifest`. Compter sur le registre `TOOLS`
sous-évalue de ~38 % : `agent__spawn` y porte une description VIDE (la vraie est
construite au vol par `agentSpawnToolDef`) et `miaou_intent` est ajouté par
`toolDefinitions()` au moment de composer. Plus simple encore : l'inspecteur de
contexte affiche la grandeur, le croire lui plutôt qu'un calcul maison.

**2. Une propriété de schéma est payée une fois PAR OUTIL.** Le facteur ~35
transforme une phrase anodine en poste budgétaire : `miaou_intent`, avec un
`title` et une description d'une ligne, coûtait 4 620 caractères — 12 % des
définitions — pour redire ce qu'`INTENT_DOCTRINE` énonce **une fois** dans le
message système, en mieux. Toute consigne générale vaut mieux dans une doctrine
que répétée dans chaque schéma ; ne rédiger dans un schéma que ce qui est propre
à CE paramètre.

**3. Placer selon la cachabilité, pas selon la taille.** Le message système et
le tableau `tools` sont servis par le cache KV du backend (mesuré, cf.
`docs/context-inspector.md` et le § du piège 16) ; le préfixe éphémère et tout
tool result ne le sont pas. Conséquences pratiques :
- raccourcir **en place** est toujours un gain ;
- **déplacer vers l'aval** (sortir un texte de description vers une skill, dont
  le contenu revient en tool result) est en général une perte : on troque un
  coût caché contre un coût récurrent, plus un tour d'aller-retour ;
- rendre **dynamique** un bloc statique coûte une invalidation à chaque bascule
  — acceptable pour un geste rare, jamais pour ce qui change d'un tour à l'autre
  (piège 16).

**Extraire vers une skill système obéit à un critère précis, pas à la taille.**
Une skill porte le COMMENT ; le QUOI — la capacité existe — doit rester annoncé
quelque part d'inconditionnel, sinon un modèle qui n'ouvre pas la skill ignore
que la capacité est là. Et la migration n'est sûre que si la skill est **SUR le
chemin** : une doctrine qui impose nommément sa lecture avant le premier appel
(`DOCS_DOCTRINE`, `JS_EVAL_DOCTRINE`, `AGENT_DOCTRINE` le font, et
`<miaou_skills_context>` exempte explicitement ce cas de son « aucune skill
n'est obligatoire »). Sur un outil ordinaire, resserrer la rédaction sur place.
Deux tests QuickJS gardent cette règle sur `js__eval` — les lire avant de couper
une description.

**Une doctrine en double branche `<X>` / `<SANS_X>` se re-vérifie à chaque
passage d'une capacité en natif.** La branche négative n'est légitime que si la
condition est satisfiable, donc si les outils cités sont DISTANTS. Dès qu'ils
entrent dans le registre `TOOLS` (const build-time, exposée à tous les tours),
elle décrit un état inatteignable et fait arbitrer au modèle ce que
l'application tranche déjà. Payé sur `DOCS_DOCTRINE`, dont la branche est restée
morte plusieurs lots après le passage des lecteurs en natif (V-1) ;
`WEB_DOCTRINE` garde la sienne à bon droit, ses outils étant distants. Le cas
d'un **agent** à trousse restreinte n'est pas un contre-exemple : il est couvert,
mieux, par `AGENT_SCOPE_NOTICE` (agents.js).

Le récit détaillé des trois campagnes d'optimisation, avec les chiffres, les
gardes posées et les effets de bord à surveiller, est dans
`untracked/context-optimization.md` (non versionné).

## Pièges déjà payés (ne pas les ré-introduire)

Une ligne par piège ci-dessous — **développement complet, exemples et noms de
fonctions dans `docs/pitfalls-detail.md`** (le lire avant de toucher au flux de
conversation, au streaming, aux résumés/titrage, à l'édition de message, au
patienteur, au raisonnement, au sélecteur de modèle, ou au KV cache). Les pièges
16, 18, 21, 24, 28 et 29 sont les **invariants transverses** : ils gouvernent des
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
   `MAX_TOURS` sur les tours ; répétition d'un appel identique BORNÉE
   (`callCounts`/`TOOL_REPEAT_MAX`), jamais interdite — un outil qui observe un
   état vivant se re-sonde avec les mêmes arguments.
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
    **La faute symétrique coûte autant** et ne se voit pas : laisser en éphémère
    un bloc qui ne change qu'à un geste explicite (consignes MCP, souvenirs de
    profil, liste des skills autotrigger). Collé au dernier message user, il
    GLISSE derrière chaque nouvel envoi — donc il n'est structurellement jamais
    servi par un cache par préfixe, même en ne bougeant pas de toute la
    conversation. Le critère est « change-t-il d'un TOUR à l'autre ? », pas
    « peut-il changer ? » : à cette dernière question tout répond oui, et on
    range alors tout du mauvais côté. Corollaire à vérifier avant de déplacer un
    bloc : **sa position tranchait peut-être quelque chose** (cf. la garde
    d'ordre de `skillsContext` dans `buildSystemMessage()`).
    Cf. `docs/pitfalls-detail.md` et `docs/context-inspector.md`.
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
    d'oracle). Exceptions sanctionnées seulement, chacune décidée explicitement :
    palette de commandes, badges d'activité, et toasts menant à une
    conversation (lot AG).
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
    la chaîne — erreur payée deux fois, au lot R puis en corrigeant le
    débordement des tableaux). Le build **échoue** désormais dessus
    (`check_export_literal_integrity`, appelée avant tout strip) : auparavant il
    passait, et c'est le chargement qui cassait sur une `SyntaxError` pointant
    une ligne du bundle sans rapport avec la source. Y citer du code se fait en
    terme nu, sans délimiteur. Leurs commentaires sont
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
    commit du rendu est une fenêtre où le store peut avancer. (c) Pour
    localStorage, (a) ne suffit PAS : émettre après le `setItem` ne garantit
    pas que le pair VOIE l'écriture quand le message arrive (mesuré, rafale de
    réglages) — un type adossé à localStorage est donc aussi relu sur
    l'événement `storage` (`storageEventDecision`, sync.js).
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
    `renderThread` nu. **Corollaire payé au lot X, puis en prod : « cette
    génération ne possède jamais l'écran » n'est JAMAIS une propriété de
    construction**, seulement l'état du moment — un fil d'agent s'ouvre, on
    revient sur un parent réveillé. Une génération écrite sans moitié peinture
    (`onDelta` en affectation nue) devient donc muette dès qu'on la regarde
    travailler, et son `onEarlyAcks` sans registre de reprise prive ses acks MCP
    de la loupe. Les points d'écriture partagés de main.js
    (`setGenPartialContent`, `pushGenToolAck`, `pushGenMessage`) portent la
    scission une fois pour toutes : les appeler, jamais muter `gen.thread`/
    `gen.partial*` à côté. Cf. `docs/generations.md`.
29. **Lire le thread d'une conversation NON AFFICHÉE exige de l'avoir
    réchauffée.** L'étage 2 du cache est borné (`CONV_MESSAGES_LRU_MAX`) :
    `loadConversation` d'une conversation évincée rend `messages: []` **par
    contrat**, exactement comme une conversation réellement vide — les deux sont
    indistinguables pour qui ne lit que `messages`. Tout code qui lit un thread
    pour le réécrire doit donc faire `await warmConversation(id)` AVANT, puis
    relire après l'await (piège 24 (b)). Sans ça, il pousse dans un tableau vide
    et le premier `persistGeneration` **détruit l'historique**, silencieusement
    et sans rien à récupérer. Payé le 2026-09-07 sur
    `wakeParentWithPendingAgentResults`, qui n'avait pas repris le réchauffage
    de son frère `deliverAgentResult`. Deux filets, ni l'un ni l'autre
    substituable à la règle : `conversationMessageCount(id)` (étage 1, permanent)
    pour poser la question « vide ou pas chargée ? », et `generationWouldTruncate`
    qui fait refuser à `persistGeneration` toute écriture plus courte que la base.
    Cf. `docs/agents.md`, `docs/storage.md` et `docs/generations.md`.

## Domaines détaillés (`docs/`)

À lire à la demande, selon la zone touchée — pas systématiquement.

**Une ligne d'index dit QUAND ouvrir la doc, jamais CE QU'ELLE CONTIENT** : le
domaine, les zones de code et les gestes qui doivent la faire lire, et quelques
noms pivots qui servent de mots de reconnaissance. **Plafond de lignes par
entrée** : `ENTRY_MAX_LINES`, vérifié par `run_docs_index_check` (runner.py),
qui exige aussi le tri par nom de doc. Tout ce qui ne tient pas dedans va dans
la doc elle-même. Une interdiction qui doit arrêter le geste SANS qu'on ouvre la
doc n'a pas sa place ici : c'est un piège, à monter dans la section précédente.

Pourquoi cette forme : l'index a d'abord résumé le contenu de chaque doc, et la
règle « le lot qui modifie une doc relit sa ligne » s'appliquait en ajoutant à
chaque fois une clause « porte aussi… ». La section a doublé en un mois (383 →
562 lignes, la moitié du fichier, une entrée à 97 lignes). Une ligne qui dit
quand lire ne périme qu'avec le PÉRIMÈTRE de la doc (domaine scindé ou fusionné,
nouveau fichier source, fonction pivot renommée) — c'est le seul cas où la
relire. Piège d'origine payé le 2026-08-31 (cf. § énumérations fermées) : une
ligne qui énumérait des clés `localStorage` migrées depuis vers IndexedDB.

- **`docs/agents.md`** — agents (sous-conversations lancées par le modèle) :
  `isRootConversation`, outils `agent__*`, réveil du parent (piège 29),
  gardes de cycle de vie (`hasWorkingAgent`, `agentBusyRewriteRefusal`),
  lecture seule d'un agent terminé, `convLabel`, inventaire (`agentInventory`).
- **`docs/backend-health.md`** — santé du backend API et ce qu'on en montre :
  pastille de la pilule modèle (`resolveBackendHealth`, `syncConnDot`), sonde
  de reprise, verdicts posés par les appels, et le chat soucieux (`cat.svg`
  inline, `resolveLogoExpression`, `syncWorriedLogo`). Le versant MCP est dans
  `docs/mcp.md`.
- **`docs/badges.md`** — badges d'activité working/unread : prédicat unique
  `convBadgeState`, agrégation cross-Space, surfaces et points de synchro,
  persistance du non-lu (`miaou-unread`) et sa portée (racines seulement).
- **`docs/build.md`** — avant de toucher `build.py`, un point d'injection
  `__MIAOU_*`, les strips de commentaires, les jetons `{{NOM}}` de `help.md`
  (`resolveHelpPlaceholders`), le WARN de clef de `config.json`, les fichiers
  voisins de `dist/` ou l'empreinte `__MIAOU_BUILD_ID__`.
- **`docs/command-palette.md`** — palette Ctrl/Cmd+K : registre déclaratif,
  sous-modes, clavier, recherche cross-Space assumée, item à deux étages et
  surlignage (`applyHighlight`).
- **`docs/compaction.md`** — compaction du contexte et évacuation des tool
  results : frontière `role: 'compaction'` et ses projections, gestes du drawer
  et `/compact`, gardes d'occupation, occupation par le `kind` `'compaction'` et ses
  exemptions. À lire avant de toucher `expandThread`, `projectThreadFor*`,
  `compactCurrentConversation` ou `evacuateToolResults`.
- **`docs/context-inspector.md`** — avant de toucher `buildContextManifest`,
  l'ordre du join de `buildSystemMessage()` (gardes de position), `promptOrder`,
  ou d'ajouter un contenu CONDITIONNEL à un bloc de `systemMessageParts()` —
  libellé et tooltip doivent décrire le bloc DANS CET ÉTAT.
- **`docs/documents.md`** — documents natifs `docs__*` (formats de
  `DOC_READERS`), artefacts CDN et `loadCdnScript`, selectors et caps de
  lecture, ancres d'images PowerPoint/Excel, rendu des feuilles Excel, parsing
  en Web Worker (graphe clos des purs injectés), partage `docs.js` / `utils.js`.
- **`docs/exports.md`** — export Markdown et export HTML standalone des
  conversations et messages (traces d'outils comprises), `EXPORT_CSS` et
  `EXPORT_SCRIPT` (pièges 21 et 22), fonctions d'horodatage.
- **`docs/fonts.md`** — lots de fontes appairés : `@import` unique, contraintes
  d'une mono (tabular-nums de l'inspecteur), export en statu quo.
- **`docs/generations.md`** — générations en vol (piège 28) : registre
  `_activeGenerations`, `persistCurrent` contre `persistGeneration` et sa garde
  anti-troncature, `genOwnsScreen`, points d'écriture partagés
  (`pushGenToolAck`…), étape annoncée (`setGenPhase`), et le non-vu du bouton
  « aller tout en bas » reporté sur le badge.
- **`docs/interjections.md`** — messages tapés pendant une génération : file
  par conversation, drain à la frontière de tour ou en fin d'échange, puces du
  composer, bulle `_acksOnly` (piège 27), reflux et file échouée.
- **`docs/mcp.md`** — agrégation MCP distante (`mcp.js` contre `tools.js`) :
  transport, handshake et révision 2026-07-28 (`server/discover`,
  `mcpProbeVerdict`), contrats d'erreur `REF_UNKNOWN` et
  `AUTHORIZATION_REQUIRED`, `_meta`, consignes `instructions`, pastille et
  reprise, skills servies (`skills/list`).
- **`docs/model-props.md`** — propriétés déclarées des modèles (fenêtre,
  capacités, niveaux de raisonnement) lues dans les réponses `/models`,
  `/api/tags`, `/api/show`, `/api/ps` ; `resolveContextWindow`,
  `resolveModelVision`, `reasoningEffortBlocked` ; chemin natif d'Ollama ;
  catalogue de modèles de la fiche serveur et menu de modèle du composer.
- **`docs/multitab-sync.md`** — synchro multi-onglets (BroadcastChannel) :
  avant d'ajouter un type de message, un émetteur ou un récepteur ; liste
  fermée de types, soft-lock, readonly/heartbeat, doctrine du piège 24, relecture
  sur événement `storage` (`storageEventDecision`).
- **`docs/palettes.md`** — palettes de couleurs : deux axes (luminosité ×
  palette), dérivation HSL des tokens, exceptions hors palette, gratuité à
  l'export, et échelle de paliers redéfinie par sous-arbre.
- **`docs/pitfalls-detail.md`** — développement complet des pièges 1-24, à lire
  avant d'entrer dans leur domaine. Les pièges 25 à 29 sont développés dans leur
  doc de domaine (`docs/tools.md` pour 25 et 26, `docs/interjections.md` pour
  27, `docs/generations.md` pour 28, `docs/agents.md` et `docs/storage.md` 29).
- **`docs/pwa.md`** — MIAOU installable et servi sous `/app/` par le proxy MCP :
  manifeste, service worker (`src/pwa/sw.js`), détection de nouvelle version
  (`checkForNewVersion`, `reloadBlockReason`), Réglages › Application, Ctrl+N
  dans l'appli installée, `theme-color` (`syncThemeColor`).
- **`docs/rendering.md`** — rendu des blocs de code (Mermaid, hauteur bornée),
  débordement des grands tableaux (`--table-bleed`, `wrapWideTables`), rendu
  par blocs pendant le streaming (`renderStreamBlocks`).
- **`docs/skills.md`** — skills locales (CRUD, slash, drawer, autotrigger),
  skills système, commandes MIAOU derrière le `/` (`MIAOU_COMMANDS`,
  `matchMiaouCommand`, posé dans `sendMessage` et jamais `resolveSend`),
  autocomplétion, skills servies par MCP (`mcp-skills.js` : intégrité,
  approbation, lecture).
- **`docs/spaces.md`** — Espaces : herméticité (piège 18, `spaceConvIds`),
  Space par défaut, scope `profile` des souvenirs, description de Space
  concaténée au prompt système, bibliothèque de fichiers par Space.
- **`docs/storage.md`** — avant de toucher une clé `localStorage`, un store
  IndexedDB (schéma, version, `releaseSupersededDb`), l'export/import `.zip`, la
  recherche plein-texte et ses extraits (`buildExcerpt`), le cache à deux étages
  (froide = `messages: []`, `conversationMessageCount`) ou un échec d'écriture
  (`noteStorageWriteFailure`, stockage plein).
- **`docs/tests.md`** — ce que couvre `tests/runner.py` (QuickJS) et ce qui se
  vérifie à la main (`docs/manual-tests.md`) ; fixtures et serveur factice des
  verify Playwright (`stub-backend.js`, `launchIsolated`), `assumeSkillsRead`.
- **`docs/toasts.md`** — toasts : critère « état sur la surface passive, front
  en toast », API `showToast`/`dismissToast`, `TOAST_GLYPHS`, file et placement
  purs (`toastQueueUpsert`, `toastPlacement`), a11y.
- **`docs/tools.md`** — avant de toucher le registre `TOOLS`, un handler, la
  lecture de skill imposée (`requiresSkill`), les acks et l'inspecteur d'appel,
  les marqueurs de référence (`resolveRefMarkers`, `web_ref`), `js__eval`
  (piège 25), `resource__from_result` (piège 26) ou la microcompaction des tool
  results.
- **`docs/tooltips.md`** — infobulles MIAOU qui remplacent `title` :
  `setTip`/`getTip`/`tipAttrs`, règle ARIA (`tipAriaRule`), délais, masquage,
  placement, exclusions (export natif, tactile), filet `run_native_title_check`.
- **`docs/usage-stats.md`** — statistiques de tokens : collecte aux deux seuls
  points réseau (`purpose` chez l'appelant), `modelCallCounts`, store
  `usage_stats` en agrégat, drawer et échelles glissantes, graphe par bacs
  (`usageBins`, `usageBinTotals`).

## Règle d'or

En cas d'ambiguïté sur un point non couvert ici : **signaler plutôt que deviner**.
Le projet a déjà payé le prix de suppositions hâtives.
