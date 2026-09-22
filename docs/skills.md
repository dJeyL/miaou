# Skills (stage 1 + stage 2 autotrigger + skills système)

Fragments d'instructions Markdown réutilisables. **Stage 1** : skill
mono-fichier, CRUD + drawer, invocation slash déterministe, et chemin langage
naturel via deux outils. **Stage 2** ajoute l'**autotrigger** : un booléen par
skill qui la fait lister chaque tour dans un bloc de contexte dynamique, pour
découverte proactive par le modèle sans appel préalable à `skills__list`. Un
troisième axe (non numéroté en stage) ajoute les **skills système** : skills
non éditables/supprimables par l'utilisateur, dont le contenu vit dans
`src/system-skills/*.md` et est injecté au build (cf. §8 ci-dessous).
**Hors périmètre stage 1+2** (ne pas amorcer) : skills multi-fichiers (stage 3),
primitive `ask_*` dédiée. Logique dans `skills.js` (helpers purs + cache mémoire
+ couche IDB).

**Depuis le lot AE, ce fichier ne couvre plus seulement les skills** : le `/` du
composer porte une seconde famille, les **commandes MIAOU** (`/compact`), qui
n'en sont pas. Elles vivent ici parce qu'elles partagent la saisie, la
reconnaissance et l'autocomplétion — pas le stockage ni le mécanisme
d'injection. Cf. §2, et `docs/compaction.md` pour le geste qu'elles déclenchent.

1. **Stockage = IDB store `skills`** (base `miaou` v2, keyPath `slug`) :
   `{ slug, name, description, enabled, content, autotrigger, system }`.
   `autotrigger` (stage 2, défaut `false` — **opposé** de `enabled`) : pas de
   bump de version IDB pour ce seul ajout (schemaless, absence == `false`).
   `system` (défaut `false`, même logique schemaless) marque une skill système
   — cf. §8. Le **cache mémoire** (`_skillsCache`, méta SANS `content`,
   projection `_skillMeta` — couvre `autotrigger` et `system`) alimente
   l'autocomplétion (filtrage synchrone par frappe, ne peut pas attendre IDB).
   `content` n'est lu en IDB qu'à l'**invocation** (slash ou `skills__read`) et
   à l'**entrée en édition** (`getSkillRecord`). Les CRUD IDB (`putSkill`/
   `deleteSkillDb`/`toggleSkillEnabled`) synchronisent le cache ;
   `loadSkillsCache` le peuple au démarrage (fire-and-forget dans `init`).
   Suppression = **hard delete** (pas de tombstone : action administrative
   explicite de l'utilisateur, ≠ écriture mémoire inférée où « undo ≠
   consentement ») — s'applique aux skills utilisateur ; une skill système
   n'expose pas de bouton Supprimer (cf. §8).

2. **Le `/` porte DEUX familles depuis le lot AE : skills et commandes MIAOU.**
   Cette section décrivait l'invocation slash comme propre aux skills ; elle ne
   l'est plus. Une **commande** (`MIAOU_COMMANDS`, skills.js — registre EN LISTE
   dès la première entrée, jamais un littéral comparé sur place) n'a ni record
   IDB, ni contenu injecté, ni card dans le drawer : elle déclenche un geste de
   l'application. `/compact` est la première (cf. `docs/compaction.md`).
   - **Le prédicat est `matchMiaouCommand` (pur) : « le littéral trimé vaut
     EXACTEMENT `/<slug>` »**, plus serré que l'`atStart` de
     `findSlashTriggers` — `/compact et au fait, …` n'est PAS une commande.
   - **Il vit dans `sendMessage`, AVANT l'appel à `resolveSend`, jamais dedans.**
     `resolveSend` a **six** appelants, dont deux drains d'interjection
     (`main.js` et `agents.js`) qui re-résolvent le littéral à la frontière de
     tour : y placer le prédicat rendrait `/compact` exécutable par
     interjection, alors qu'AE-7 refuse de compacter pendant une génération et
     qu'une interjection n'existe QUE pendant une génération. L'exécution doit
     rester impossible **par construction**, pas rattrapée par une garde. Le
     REFUS, en revanche, a son chemin : `enqueueInterjection` et
     `editUserMessage` testent `matchMiaouCommand` avant `resolveSend` et
     servent `commandContextRefusal` (la vraie borne), jamais
     `commandFormRefusal` (qui accuserait la forme d'une commande bien formée). Ce placement règle du
     même coup le court-circuit « aucune skill activée » : une commande n'est pas
     une skill et n'a pas à en hériter.
   - **Une seule exception à ce court-circuit**, dans `resolveSend` : un slug de
     commande en position 0 mal formé (`/compact et …`) doit sortir en refus
     **même sans aucune skill activée**, sinon il partirait silencieusement au
     modèle comme du texte sur l'install la plus courante. Le message
     (`commandFormRefusal`, pur, source unique — `resolveSend` le dérive à deux
     endroits) nomme la contrainte de FORME plutôt que « skill inconnue », qui
     serait faux : le slug est connu, c'est son emploi qui ne l'est pas.
   - **Jamais en édition d'un message passé** (condition 2) : l'édition EST une
     réécriture d'historique, déjà sous la garde AE-7 — y accepter une commande
     qui en déclenche une autre n'aurait pas de sens. Voir le discriminant
     d'autocomplétion au §4.
   - **Réservation du slug (AE-9)** : `validateSkillSlug` refuse tout slug du
     registre, **avant** le test d'unicité (sinon une skill homonyme déjà en base
     rendrait « déjà utilisé », qui n'explique rien) et avec un message qui dit
     POURQUOI. Deux points d'application couvrent les trois voies d'entrée du
     brief : `onSaveSkillCard` (main.js — **l'import y passe**, drop et paste ne
     font que pré-remplir la card, ils n'écrivent rien) et `skills__write`
     (tools.js, chemin modèle).
   - **Skill `compact` DÉJÀ en base** : la garde ne la voit jamais. Décision
     (Julien, 2026-09-21) : simple **signalement**, pas de renommage automatique
     — un texte sur sa card dans le drawer (`.skill-view-shadowed`,
     `buildSkillCard`). Dans le drawer et **pas** au composer : c'est là que
     l'utilisateur peut agir (renommer) ; au composer ce serait au pire moment,
     il veut compacter, pas arbitrer un conflit de nom. La skill continue de
     fonctionner par `skills__read` et l'autotrigger, seul son slash est pris.
   - **Exécution** : `runMiaouCommand(slug)` (main.js), dispatch par slug.
     Aucun message n'est poussé, rien ne part au modèle. Verrou `_commandRunning`
     propre au geste — `_sendResolving` est relâché avant, et la rédaction du
     résumé de compaction est un aller-retour réseau : deux Entrée rapides
     poseraient sinon deux frontières (même raison que le `btn.disabled` de
     l'affordance du drawer).
   - **La légende « / » du composer est devenue inconditionnelle.** Elle
     disparaissait sans skill activée, et disait « pour une skill » : les deux
     sont faux depuis qu'une commande existe sans aucune skill. C'est désormais
     son TEXTE qui suit l'état (`syncSkillHintUI`), et l'appel est posé **hors**
     de la chaîne `ensureSystemSkills().then(loadSkillsCache)` — derrière elle,
     un échec IDB laisserait la légende cachée à jamais alors que `/compact`
     marcherait.

3. **Invocation slash (skills) = injection côté client, ≠ `<miaou_context>`.** Détection +
   validation + injection vivent dans **`resolveSend(literal)`** (main.js, async),
   **chemin UNIQUE partagé par `sendMessage` ET `editUserMessage`** — jamais deux
   implémentations. **Garde d'entrée : aucune skill activée
   (`listEnabledSkills()` vide) → aucun parsing de slug, aucun blocage** — un
   `/mot` même en position 0 part comme du texte normal (l'erreur « skill
   inconnue » n'a pas de sens quand il n'existe aucune skill à connaître) —
   **sauf le slug d'une commande MIAOU mal formé**, seule exception, cf. §2.
   La légende du composer (span `#composer-hint-skill`, `syncSkillHintUI`,
   ui.js) ne suit **plus** cette condition depuis le lot AE : elle est
   inconditionnelle et c'est son libellé qui varie (§2). `findSlashTriggers` (pur) repère les
   `/<slug>` du texte ; pour chacun, lookup cache : slug absent/désactivé →
   `{ ok:false, error }` → erreur composer locale (`showComposerError`),
   **aucun envoi, aucun tour modèle, thread inchangé** ; sinon `getSkillContent`
   (IDB) puis `bakeSkillMessage(littéral, resolved)` encadre chaque corps résolu
   de marqueurs `--- skill: slug --- ... --- /skill: slug ---` →
   `{ ok:true, content:baké, isSkill:true }`.
   - Le **content baké** est **stocké dans `content`** du message user et **figé au
     niveau RENDU/REPLAY** : `renderThread`/`openConversation` ne re-résolvent
     JAMAIS. Mais une **édition est un nouvel envoi** → `resolveSend` re-résout le
     contenu **COURANT** de la skill (pas le figé d'origine) : éditer/supprimer la
     skill entre deux envois se reflète sur le message réédité, pas sur les anciens.
   - Le **littéral seul va dans `displayText`** : **source unique** de la bulle
     (`renderThread`), de la textarea d'édition et de la bulle restaurée
     (`enterEditMode`/`cancelEdit`), de l'export et de la recherche mémoire. Ne
     JAMAIS sourcer ces chemins depuis `content` (fuite du corps injecté — bug payé).
   - `sendUserText(text, bakedContent?)` porte les deux champs. `displayText`/`slug`
     sérialisés par `persistCurrent`, restaurés par `openConversation` (qui
     **normalise** l'ancien champ `display` → `displayText`, données de test
     antérieures au renommage). **Chemin strictement distinct** de
     `buildContextBlock`/`miaou_context` (lui recalculé et préfixé à chaque tour).

4. **Autocomplétion** (`onComposerInput` → `matchSkillCompletions`, activés
   uniquement, match slug **ou** name) : ouverte tant qu'on tape le slug
   (`cmd.rest` vide), navigation clavier dans `onComposerKey` (↑↓ Tab Entrée Échap),
   sélection complète `/slug ` **sans envoyer**.
   - **Instance composer superposée, pas en flux** : `#skill-ac` est DANS
     `.input-wrap` (`position: relative`), en absolu au-dessus de l'input
     (`bottom: calc(100% + 8px)`, `z-index: 30`) — elle **recouvre** les pilules
     de sélecteurs à l'ouverture au lieu de les décaler vers le haut. L'instance
     de la bulle d'édition (classe `.skill-ac` sans l'id) reste en flux, sous le
     champ.
   - **Sa hauteur maximale est MESURÉE à l'ouverture**, pas fixée en CSS
     (`fitSkillAutocompleteHeight`, ui.js, appelée par `renderSkillAutocomplete`
     **après** `removeAttribute('hidden')` — un panneau caché n'a pas de
     géométrie). Le `max-height: 220px` de `.skill-ac` reste le plancher de
     l'instance d'édition, qui n'est pas ancrée pareil. Motif : ancrée en
     absolu, l'instance du composer ne connaît pas en CSS la place libre
     au-dessus d'elle — `vh` mesure le viewport, pas l'ancre — alors que la
     hauteur du composer varie (pièces jointes, rail d'interjections, saisie
     multiligne). Mesuré avant correction : 11 options = ~395 px comprimés dans
     220 px **alors que 445 px étaient libres**, et les dernières options
     passaient sous le pli, dont `/compact`. Recalculée à chaque peinture, donc
     jamais périmée — c'est ce qui la distingue d'une constante relevée.
   - **Densité de LISTE, pas de contenu** (lot AE étape 5). Le pas de ligne
     valait 36 px (`padding: 8px`, `gap: 10px`, 13 px) : le CSS était respecté
     — mesuré, il n'y avait aucun écart avec sa déclaration — mais réglé comme
     un bloc de texte alors que c'est une liste qu'on parcourt à la flèche.
     Ramené à ~27 px. Le slug est en `var(--mono)` : il déclarait sa pile
     **en dur** et échappait donc à l'axe des lots de fontes (`docs/fonts.md`).
   - **Entrée dans la liste par ↑ sans sélection = DERNIÈRE option**
     (`moveSkillAcSelection`) : l'arithmétique modulaire depuis l'index -1
     donnerait l'avant-dernière. Vaut pour les deux contextes (composer et bulle
     d'édition).
   - **Les commandes MIAOU s'y ajoutent, sous un discriminant explicite**
     (lot AE). `updateSkillAutocomplete` reçoit un état `{ ta, box, index,
     trigger }` et les deux contextes ont **exactement la même forme** : rien à
     l'intérieur ne permettrait de les distinguer. Le composer (`_composerAc`)
     porte donc `commands: true`, que l'état de la bulle d'édition n'a pas —
     c'est ce qui tient la condition 2 du § 4.7 (jamais de commande en édition
     d'un message passé). Nommé d'après la CAPACITÉ et non le contexte
     (`isComposer`), qui inviterait à y brancher d'autres différences.
   - **Commandes EN TÊTE de la liste, skills ensuite.** L'ordre inverse avait
     été posé d'abord et réfuté à la première capture : les commandes sont
     **bornées** (registre build-time), les skills une liste **ouverte**, donc
     mettre l'ouverte devant pousse la bornée sous le pli dès qu'il y a plus de
     quelques skills — `/compact` était invisible sans défiler. Ce qui est borné
     passe devant ce qui ne l'est pas. Conséquence assumée : `acceptSkillAcSelection`
     prend la première option à défaut de sélection, donc Entrée sur un `/` nu
     complète une commande — elle insère, elle n'envoie pas.
   - **`matchCommandCompletions` est DISTINCTE de `matchSkillCompletions`**, et
     l'appelant concatène. Verser les commandes dans la seconde les ferait
     apparaître dans le sous-mode `skill` de la palette de commandes
     (`cmdkModeItems`, ui.js), qui n'appelle qu'elle — un test fige la
     séparation. Les commandes ne sont proposées qu'**en position 0** : ailleurs
     elles suggéreraient une capacité inatteignable, puisque la reconnaissance à
     l'envoi exige le littéral seul.
   - **Distinction visuelle** : `.skill-ac-opt.is-command` et une étiquette
     « commande » (`.skill-ac-tag`, vocabulaire repris de `.root-prompt-badge` /
     `.skill-system-badge`). Deux signaux plutôt qu'un — l'étiquette reste
     lisible sans la couleur. Les afficher identiques ferait croire à une skill
     `compact` éditable dans le drawer.

5. **Chemin langage naturel = `skills__list` + `skills__read` + `skills__write`**
   (cf. `docs/tools.md`). Additif au registre `miaou__` existant — ne renomme
   aucun outil. C'est un **tool_result normal** (passe par la généralisation
   tool-ack, contenu disponible au modèle dès ce tour ET réinjecté cross-turn via
   `expandThread`), **pas** par l'injection figée du slash. `skills__write` crée
   ou modifie une skill (`putSkill`, async) : modifier un slug existant exige
   `overwrite:true` explicite (sinon erreur, aucune écriture) — le modèle ne peut
   pas écraser une skill par accident. Merge partiel en modification (champs
   omis = valeur existante conservée) ; `autotrigger` **non exposé** au modèle
   (reste un toggle utilisateur du drawer, préservé tel quel depuis
   l'enregistrement existant). Ack `skill_write` informatif, sans undo — même
   posture que la suppression (hard delete, pas de tombstone : action
   explicite).

6. **Drawer `#skills-drawer`** (`.drawer-wide`, plus large pour éditer le corps) :
   cartes vue/édition en `createElement`/`textContent` (jamais `innerHTML` pour les
   données). Rendu dans `ui.js` (`renderSkills`/`buildSkillCard`), persistance dans
   `main.js` (`onSaveSkillCard`/`onDeleteSkillCard`/`onToggleSkill`), comme le
   pattern MCP. `validateSkillSlug` (pur) : non vide, pas d'espace/`/`, charset
   `[A-Za-z0-9_-]`, longueur ≤ 48, unicité. Toggle `autotrigger` (stage 2) en
   section édition uniquement (`.skill-autotrigger`), à côté du toggle `enabled`
   existant ; lu par `onSaveSkillCard` comme `enabled`.
   - **Import de cartouche au collage** (`.skill-content`, listener `paste`) :
     `parseSkillFrontmatter` (skills.js, pur) détecte un bloc `---\n…\n---` en
     tête du texte collé (format **Agent Skills**, celui de Claude Code) et
     pré-remplit le formulaire. Le **cartouche reste dans le contenu collé**
     (jamais retiré) — seul le formulaire l'est. Une clé absente du cartouche
     laisse le champ formulaire correspondant inchangé. Extraction factorisée
     dans `applySkillFrontmatterToCard(scope, text, filename)` (ui.js), partagée
     avec l'import de fichier ci-dessous.

     **`name` du cartouche EST le slug**, pas un libellé libre : le format amont
     le contraint au charset d'un identifiant et l'aligne sur le nom du dossier
     porteur du `SKILL.md`. MIAOU le lit donc comme tel, ce qui rend une skill
     trouvée sur Internet importable sans saisie. Le format n'a en revanche
     **aucun champ de libellé humain** : MIAOU en pose un sous `metadata:` /
     `title:`, seul espace que le format laisse libre (Claude Code ignore
     `metadata:`), et jamais en clé racine — un `title:` racine est ignoré, pour
     ne pas inventer une divergence de format. Sans lui, le nom d'affichage est
     dérivé du slug (`skillDisplayNameFromSlug`) plutôt que laissé vide.
     `description` alimente `description`, et `disable-model-invocation` est
     **inversé** vers le toggle `autotrigger` (approximation assumée : pas
     d'équivalent MIAOU exact à « désactiver l'invocation modèle »,
     `autotrigger` est le champ le plus proche disponible).

     La résolution slug + nom est portée par **`resolveSkillIdentity(fm,
     filename)`** (skills.js, pur), source unique pour les trois chemins
     d'import — ne pas re-slugifier `fm.name` localement.
   - **Import de fichier `.md` : drag&drop OU copier-coller Finder/Explorateur,
     sur tout le drawer (`#skills-drawer`)**, pas seulement la liste — zone large,
     pattern `.dragover` identique au composer (`composer.css`/`drawers.css`).
     Filtre `isMarkdownFile` (nom `.md`/`.markdown`/`.txt` ou type
     `text/markdown`/`text/plain`) : tout autre fichier glissé/collé est ignoré
     silencieusement. Lecture via `file.text()`. Le **nom du fichier** est
     transmis avec le texte : il sert de repli de slug quand le cartouche n'a pas
     de `name` (`skillSlugFromFilename` — `SKILL.md` rend une chaîne vide, ce nom
     conventionnel ne portant aucune information, l'identité vivant alors dans le
     dossier que le navigateur ne nous donne pas). Routage décidé par
     `resolveSkillDropTarget(fm, existingSlugs, filename)` (skills.js, pur), sur
     le slug résolu par `resolveSkillIdentity` :
     - slug résolu (cartouche, à défaut nom de fichier) qui **matche une skill
       existante** → **édition** de cette skill (bascule sur sa card).
     - sinon → **création**, slug pré-rempli par le slug résolu — vide si rien
       n'est dérivable, laissé à la saisie.
     Orchestré par `ingestSkillMarkdownFile(text, filename)` (main.js) : ferme toute card
     restée ouverte (`renderSkills()`), cible/crée la card, pose le contenu
     intégral dans `.skill-content` **avant** d'appeler
     `applySkillFrontmatterToCard` — **ne passe jamais par `enterSkillEdit`**
     (celui-ci recharge l'ancien contenu depuis IDB de façon asynchrone : appeler
     les deux dans le mauvais ordre écraserait le texte importé une fois la
     promesse résolue).
     - **Paste-fichier DANS une card déjà en édition** (focus dans sa
       `.skill-content`) : intercepté par le listener de CETTE textarea
       (`getAsFile()` + `file.text()`, plus fiable qu'attendre que le navigateur
       pose le texte nativement — comportement non garanti pour un vrai `File`
       copié depuis le Finder), avec `stopPropagation()` pour ne **pas**
       remonter au listener `paste` du drawer et déclencher un second routage
       (sinon double-traitement : la card courante ET potentiellement une
       bascule vers une autre skill).

7. **Autotrigger (stage 2) : listing dynamique, SIBLING de `<miaou_context>`, pas
   une section dedans.** `getAutotriggerSkillsMeta()` (skills.js, pure) filtre le
   cache sur `enabled === true && autotrigger === true` et projette
   `{slug, name, description}` (même forme que `skills__list`, fonction
   **distincte** — ne touche pas à cet outil ni à son filtre). Si non vide,
   `buildSkillsContextBlock()` (main.js) sérialise en bloc `<miaou_skills_context>`,
   concaténé en préfixe du dernier message user **à côté de** (pas dans)
   `buildContextBlock()`/`<miaou_context>` — recalculé à chaque tour depuis le
   cache courant, exactement comme `<miaou_context>` : un changement
   `enabled`/`autotrigger` entre deux tours se reflète au tour suivant sans
   cas particulier. Vide → bloc omis (pas de tokens pour une liste vide).
   **Ne passe jamais** par `resolveSend`/`bakeSkillMessage` (chemin slash stage 1,
   figé à l'envoi, persisté dans `currentThread`) : ce bloc-ci est éphémère,
   jamais stocké. `miaou__skills__read` (stage 1, inchangé) reste le seul moyen
   d'en charger le contenu, que la skill soit découverte via ce listing ou via
   `skills__list`.
   - **« Aucune n'est obligatoire » comporte une EXCEPTION NOMMÉE, et elle n'est
     pas cosmétique.** Le texte du bloc dissuade de lire une skill « au cas où »
     (mémoire `project_weak_model_discovery_tool_oversweep` : Devstral balayait
     tous les topics). Mais deux doctrines du prompt système **exigent** une
     lecture avant un geste précis — `DOCS_DOCTRINE` (« avant ton PREMIER appel à
     un outil `miaou__docs__*` ») et `FILES_PROMOTE_DOCTRINE`. Les deux textes se
     contredisaient frontalement, et **ce bloc gagnait** : recalculé à chaque
     tour, il est plus proche du dernier message user que le prompt système.
     Payé en test réel (gemma-4-e4b, 2026-08-29) — le modèle a listé la skill
     `docs` dans son raisonnement, a statué « the available skills context
     includes docs », ne l'a pas lue, puis a inventé le selector `'scanned2'` (le
     titre du document) là où la skill dit « un numéro, jamais un mot ». Un tour
     perdu sur exactement ce que la lecture aurait évité. Le bloc réserve donc
     désormais le cas d'une doctrine qui nomme la skill ; la dissuasion générale
     reste **entière**. Ne pas la généraliser en « lis ce qui te semble utile » :
     le balayage reviendrait. Deux tests gardent les deux moitiés.
   - **Doctrine de déclenchement** (tools.js) : injectée par `skillDoctrinePrompt()`
     dans `buildSystemMessage()` (main.js) — gating **vivant**, sur le modèle de
     `intentDoctrinePrompt()`/`INTENT_DOCTRINE` (≠ `MEMORY_DOCTRINE`/
     `BINARY_DOCTRINE`, concaténées de façon inconditionnelle dans la constante
     build-time `ROOT_SYSTEM_PROMPT`). Gate sur `getAutotriggerSkillsMeta().length`
     (pas sur la présence de l'outil `skills__read`, toujours vrai depuis le
     stage 1 — gater là-dessus aurait rendu le bloc inconditionnel en pratique).
     Contenu : le listing est informatif (pas une obligation d'usage) ; pour
     utiliser une skill listée, appeler `miaou__skills__read(slug)`, puis agir
     directement sur le résultat — **jamais** de `ask_confirmation` après
     `skills__read` (ex-réglage `confirmSkillAutoUse`, retiré). Le halting
     `ask_confirmation` jette tout le tour courant, y compris le résultat de
     `skills__read` (cf. `onHalt`, api.js/main.js — mécanisme fork B conçu pour
     `memory__create`, où la question seule suffit au tour suivant). Pour une
     skill, le corps lu peut faire plusieurs paragraphes : au tour suivant
     (« Oui »), le modèle ne l'a plus, doit le relire, reconfirme → boucle sans
     jamais agir (observé en pratique). Retiré, pas contourné : lire une skill
     n'a pas d'effet de bord, agir dessus n'en a pas non plus par nature (ce
     sont des instructions, pas une action irréversible), et l'utilisateur voit
     l'appel `skills__read` dans l'ack. Garde anti-narration (`_TAIL`) : ne pas
     prétendre avoir appliqué une skill sans avoir appelé `skills__read` dans
     le même tour.

8. **Skills système : non éditables, source = `src/system-skills/*.md`.** Une
   skill système (`system: true` sur le record IDB) sert à documenter une
   capacité de l'application elle-même (ex. la syntaxe mermaid, cf. ci-dessous)
   sans dupliquer ce contenu à la main dans une constante JS ni le rendre
   éditable par erreur. Elle **réutilise tout le mécanisme stage 1+2 existant**
   (invocation slash, `skills__list`/`skills__read`, autotrigger, listing
   `<miaou_skills_context>`) : le **filtrage** de ces fonctions ne traite pas
   `system` — elles sélectionnent sur `enabled`/`autotrigger` seuls, une skill
   système est listée et lue comme les autres. En revanche les deux surfaces
   d'**énumération** le *signalent* au modèle, parce que l'immuabilité est
   sinon invisible avant l'échec de `skills__write` (ou pire, promise à
   l'utilisateur) : `skills__list` rend un champ `system: true` (annoncé dans
   sa description d'outil), et `<miaou_skills_context>` préfixe la ligne d'un
   marqueur `[système]` + une phrase d'explication ajoutée **seulement si** au
   moins une skill système figure dans le bloc (`buildSkillsContextBlock`,
   `main.js` ; `getAutotriggerSkillsMeta` propage le champ). La description de
   `skills__write` énonce le refus en amont plutôt que de le laisser découvrir
   par l'erreur.
   - **Fichiers source** : un fichier par skill système dans
     `src/system-skills/<slug>.md` — le **nom de fichier (sans extension) est
     le slug**, la clé IDB. Cartouche frontmatter en tête (`name`,
     `description`, `metadata:`/`title:` — mêmes clés que l'import utilisateur,
     `parseSkillFrontmatter`, mais parsé côté build par
     `parse_system_skill_file`, `build.py`) puis le corps Markdown complet.
     **`name` doit être ÉGAL au nom de fichier** : le build ÉCHOUE sinon, ce qui
     attrape le renommage de fichier sans mise à jour du cartouche — il
     passerait sinon en silence et livrerait un fichier non conforme au format
     à qui le partage. Le libellé humain est sous `metadata:`/`title:`, et il
     compte : `buildSkillsContextBlock` (main.js) l'envoie au modèle à **chaque
     tour**, les skills système étant toutes autotrigger. Sans `title`, il est
     dérivé du slug (`system_skill_display_name`, miroir Python de
     `skillDisplayNameFromSlug`).
     **Pas de clé `autotrigger`/`enabled`** : une skill système n'expose AUCUN
     réglage, cf. upsert ci-dessous.
   - **Injection au build** : `load_system_skills()` (`build.py`) lit tous les
     `.md` du dossier, sérialise `{slug: {name, description, content}}` en
     JSON, remplace le marqueur `__MIAOU_SYSTEM_SKILLS__` dans `assemble_js()`
     — même mécanisme que `__MIAOU_CONFIG__`/`__MIAOU_HELP__` (marqueur unique
     en position de valeur, échappement `</`). Côté source,
     `SYSTEM_SKILLS_CONTENT` (`skills.js`, tout en haut du fichier) porte la
     garde `try/catch` habituelle → `{}` pour les tests QuickJS (sources non
     buildées).
   - **Upsert inconditionnel à l'init** : `ensureSystemSkills()` (`skills.js`,
     appelée depuis `init()`, `main.js`, **avant** `loadSkillsCache()`) réécrit
     `name`/`description`/`content`/`system:true` en IDB à **chaque
     démarrage**, pour chaque slug de `SYSTEM_SKILLS_CONTENT` — le fichier
     source est la seule source de vérité, aucune dérive IDB persistante n'est
     possible. `enabled` ET `autotrigger` sont **figés à `true`** (une skill
     système ne se désactive jamais et reste toujours proposée
     proactivement — **aucun réglage utilisateur possible**, pas de toggle
     dans le drawer, cf. `buildSystemSkillCard` ci-dessous).
   - **Protection en écriture** : `miaou__skills__write` (`tools.js`) refuse
     toute écriture sur un slug dont la méta cache porte `system: true` —
     erreur explicite, avant même la vérification `overwrite`. Le modèle ne
     peut ni créer un slug système par collision, ni le modifier.
   - **Drawer** : `renderSkills()` (`ui.js`) sépare la liste en deux groupes —
     skills système en tête (via `buildSystemSkillCard`, badge « Système »,
     `.skill-card--system`), skills utilisateur ensuite (`buildSkillCard`
     inchangé). Une carte système n'a **aucune section édition** et **aucun
     toggle enabled** (toujours activée, cf. ci-dessus) : seul un bouton
     **Consulter/Fermer** (libellé qui suit l'état, `toggleSystemSkillContent`)
     est rendu. Consulter bascule un panneau `.skill-system-content`, contenu
     chargé depuis IDB (`getSkillRecord`) au premier clic puis mis en cache DOM
     (`dataset.loaded`), rendu via `renderMd()` (marked.js + sanitize, même
     pipeline que les messages de chat) — jamais de `textarea` éditable. CSS
     dédié et resserré (`drawers.css`, police 11.5px vs 14px pour `.body` en
     bulle de chat) plutôt que partagé avec `chat.css` (même piège que
     `EXPORT_CSS`, CLAUDE.md #22 : une feuille dédiée ne suit pas les évolutions
     de `.body`, revue manuelle à la charge de qui y touche).
   - **Skill système `mermaid`** (`src/system-skills/mermaid.md`) : règles de
     syntaxe strictes pour générer un diagramme mermaid valide (labels avec
     `<br/>` uniquement pour un saut de ligne, quoting des caractères
     spéciaux, interdiction des crochets/guillemets/balises HTML internes à un
     label, convention `filename=` pour les exports d'image). Contenu déplacé
     depuis `CODEBLOCK_DOCTRINE` (`tools.js`, ex-v2/v3) : cette constante,
     injectée inconditionnellement dans `buildSystemMessage()`, ne garde plus
     que la convention `filename=nom.ext` générique à tout langage, et renvoie
     vers `miaou__skills__read('mermaid')` pour la syntaxe — cf.
     `docs/rendering.md`. `autotrigger: true` (défaut du parseur, non modifié)
     la liste dans `<miaou_skills_context>` dès qu'elle est activée, donnant au
     modèle sa disponibilité sans avoir à durcir un slug en dur dans une
     doctrine statique.

9. **Skills système extraites de `ROOT_SYSTEM_PROMPT` (`files-promote`,
   `js-eval`, `docs`)** — même mécanisme que `mermaid`, appliqué à trois des
   sept doctrines statiques de `tools.js` (cf. `docs/tools.md` pour la composition
   complète de `ROOT_SYSTEM_PROMPT`), avec un traitement différent selon la
   fréquence d'usage attendue :
   - **`files-promote`** (`src/system-skills/files-promote.md`) : doctrine de
     déclenchement **entière** déplacée (gate `ask_confirmation`, format exact
     de l'appel `miaou__files__promote`). Usage assez rare (promotion d'une
     pièce jointe en bibliothèque d'espace persistante) pour que le QUAND et le
     COMMENT soient indissociables — il n'y a pas de réflexe fréquent à
     préserver dans le prompt racine. `FILES_DOCTRINE` (`tools.js`) ne garde
     qu'un pointeur court vers `miaou__skills__read('files-promote')`.
   - **`js-eval`** (`src/system-skills/js-eval.md`) : seul le **COMMENT** est
     déplacé (signature d'appel exacte, primitives fermées `text`/`lines`/
     `jsonLines`/`parse`, méthode par petits appels successifs). Le **QUAND**
     (cas d'usage — gros fichier joint, fallback quand `docs__read` refuse un
     fichier trop volumineux — et la contrainte de cap de sortie chiffrée)
     reste dans `JS_EVAL_DOCTRINE` (`tools.js`) : c'est le réflexe de
     déclenchement, à ne pas dégrader en le rendant conditionnel à un appel
     `skills__read`. Le cap numérique (`JS_EVAL_OUTPUT_CAP`) n'est délibérément
     **pas dupliqué** dans le `.md` (valeur non chiffrée dans la skill, qui
     renvoie vers la doctrine pour l'exactitude) — éviter qu'une mise à jour de
     la constante laisse un chiffre obsolète dans un fichier Markdown. Décision
     assumée d'invalider une fois le préfixe KV cache (piège 16, CLAUDE.md) en
     réduisant `JS_EVAL_DOCTRINE` : c'était la plus grosse des sept doctrines du
     prompt racine, le gain de contexte par tour l'emporte sur le coût
     ponctuel.
   - **`docs`** (`src/system-skills/docs.md`, lot V-7) : même partage que
     `js-eval` — seul le **COMMENT** part (forme du selector format par format,
     quand passer `as_resource`, comment lire chaque refus, le cas
     Office-vu-comme-zip, `docs__pack`). Le **QUAND** reste dans
     `DOCS_DOCTRINE` : qu'un fichier binaire joint n'est pas lisible
     directement, que MIAOU ouvre seul cinq formats (zip, PDF, Excel, Word,
     PowerPoint), que le geste est `docs__list` d'abord, et que le natif prime
     sur le serveur. **La liste des cinq formats reste en doctrine
     délibérément** : sans elle, un modèle ne sait pas qu'un `.pptx` s'ouvre, et
     la skill qu'il ne lirait jamais ne le lui apprendrait pas.
     `DOCS_DOCTRINE` passe de 2 769 à 1 869 caractères, et le schéma
     `docs__read` de 1 966 à 1 421 — total `docs__*` en contexte permanent :
     6 723 → 5 278.
     Comme pour `js-eval`, **aucune constante chiffrée dans le `.md`** (cap de
     sortie, borne de lignes Excel, cap de section Word) : la skill dit que le
     message de refus donne le chiffre, ce qui est vrai de tous les refus.
     Même arbitrage KV cache que `js-eval` : `DOCS_DOCTRINE` était devenue la
     plus grosse doctrine du prompt racine, l'invalidation ponctuelle est
     assumée contre un gain récurrent.
     Deux descriptions d'outils n'ont **pas** été allégées, et c'est un choix :
     `docs__list` (721 car.) et `docs__pack` (684 car.) sont du QUAND —
     l'énumération de ce que rend un listing est ce qui fait qu'un modèle sait
     quoi en attendre.
     **Point d'attention pour la suite** : le sous-lot V-8 (rendu image des
     pages PDF) doit **mettre à jour cette skill**, pas en créer une autre ni
     ajouter à la doctrine — c'est le critère qui a fait choisir une skill
     unique plutôt qu'une par format.
