# Skills (stage 1 + stage 2 autotrigger)

Fragments d'instructions Markdown réutilisables. **Stage 1** : skill
mono-fichier, CRUD + drawer, invocation slash déterministe, et chemin langage
naturel via deux outils. **Stage 2** ajoute l'**autotrigger** : un booléen par
skill qui la fait lister chaque tour dans un bloc de contexte dynamique, pour
découverte proactive par le modèle sans appel préalable à `skills__list`.
**Hors périmètre stage 1+2** (ne pas amorcer) : skills multi-fichiers (stage 3),
primitive `ask_*` dédiée. Logique dans `skills.js` (helpers purs + cache mémoire
+ couche IDB).

1. **Stockage = IDB store `skills`** (base `miaou` v2, keyPath `slug`) :
   `{ slug, name, description, enabled, content, autotrigger }`. `autotrigger`
   (stage 2, défaut `false` — **opposé** de `enabled`) : pas de bump de version
   IDB pour ce seul ajout (schemaless, absence == `false`). Le **cache mémoire**
   (`_skillsCache`, méta SANS `content`, projection `_skillMeta` — couvre
   désormais `autotrigger`) alimente l'autocomplétion (filtrage synchrone par
   frappe, ne peut pas attendre IDB). `content` n'est lu en IDB qu'à
   l'**invocation** (slash ou `skills__read`) et à l'**entrée en édition**
   (`getSkillRecord`). Les CRUD IDB (`putSkill`/`deleteSkillDb`/
   `toggleSkillEnabled`) synchronisent le cache ; `loadSkillsCache` le peuple au
   démarrage (fire-and-forget dans `init`). Suppression = **hard delete** (pas de
   tombstone : action administrative explicite de l'utilisateur, ≠ écriture mémoire
   inférée où « undo ≠ consentement »).

2. **Invocation slash = injection côté client, ≠ `<miaou_context>`.** Détection +
   validation + injection vivent dans **`resolveSend(literal)`** (main.js, async),
   **chemin UNIQUE partagé par `sendMessage` ET `editUserMessage`** — jamais deux
   implémentations. **Garde d'entrée : aucune skill activée
   (`listEnabledSkills()` vide) → aucun parsing de slug, aucun blocage** — un
   `/mot` même en position 0 part comme du texte normal (l'erreur « skill
   inconnue » n'a pas de sens quand il n'existe aucune skill à connaître). La
   légende « `/` pour une skill » du composer suit la même condition : span
   `#composer-hint-skill`, visible seulement s'il existe ≥1 skill activée
   (`syncSkillHintUI`, ui.js — synchronisée après `loadSkillsCache` au démarrage
   et à chaque CRUD via `renderSkills`). `findSlashTriggers` (pur) repère les
   `/<slug>` du texte ; pour chacun, lookup cache : slug absent/désactivé →
   `{ ok:false, error }` → erreur composer locale (`showComposerSkillError`),
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

3. **Autocomplétion** (`onComposerInput` → `matchSkillCompletions`, activés
   uniquement, match slug **ou** name) : ouverte tant qu'on tape le slug
   (`cmd.rest` vide), navigation clavier dans `onComposerKey` (↑↓ Tab Entrée Échap),
   sélection complète `/slug ` **sans envoyer**.
   - **Instance composer superposée, pas en flux** : `#skill-ac` est DANS
     `.input-wrap` (`position: relative`), en absolu au-dessus de l'input
     (`bottom: calc(100% + 8px)`, `z-index: 30`) — elle **recouvre** les pilules
     de sélecteurs à l'ouverture au lieu de les décaler vers le haut. L'instance
     de la bulle d'édition (classe `.skill-ac` sans l'id) reste en flux, sous le
     champ.
   - **Entrée dans la liste par ↑ sans sélection = DERNIÈRE option**
     (`moveSkillAcSelection`) : l'arithmétique modulaire depuis l'index -1
     donnerait l'avant-dernière. Vaut pour les deux contextes (composer et bulle
     d'édition).

4. **Chemin langage naturel = `skills__list` + `skills__read` + `skills__write`**
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

5. **Drawer `#skills-drawer`** (`.drawer-wide`, plus large pour éditer le corps) :
   cartes vue/édition en `createElement`/`textContent` (jamais `innerHTML` pour les
   données). Rendu dans `ui.js` (`renderSkills`/`buildSkillCard`), persistance dans
   `main.js` (`onSaveSkillCard`/`onDeleteSkillCard`/`onToggleSkill`), comme le
   pattern MCP. `validateSkillSlug` (pur) : non vide, pas d'espace/`/`, charset
   `[A-Za-z0-9_-]`, longueur ≤ 48, unicité. Toggle `autotrigger` (stage 2) en
   section édition uniquement (`.skill-autotrigger`), à côté du toggle `enabled`
   existant ; lu par `onSaveSkillCard` comme `enabled`.
   - **Import de cartouche au collage** (`.skill-content`, listener `paste`) :
     `parseSkillFrontmatter` (skills.js, pur) détecte un bloc `---\n…\n---` en
     tête du texte collé (format Claude Code, ex. skill Claude Code) et
     pré-remplit `slug` (slugifié via `slugifySkillName`) + `name` depuis la clé
     `name`, `description` depuis `description`, et **inverse**
     `disable-model-invocation` vers le toggle `autotrigger` (approximation
     assumée : pas d'équivalent MIAOU exact à « désactiver l'invocation modèle »,
     `autotrigger` est le champ le plus proche disponible). Le **cartouche reste
     dans le contenu collé** (jamais retiré) — seul le formulaire est pré-rempli.
     Une clé absente du cartouche laisse le champ formulaire correspondant
     inchangé. Extraction factorisée dans `applySkillFrontmatterToCard(scope, text)`
     (ui.js), partagée avec l'import de fichier ci-dessous.
   - **Import de fichier `.md` : drag&drop OU copier-coller Finder/Explorateur,
     sur tout le drawer (`#skills-drawer`)**, pas seulement la liste — zone large,
     pattern `.dragover` identique au composer (`composer.css`/`drawers.css`).
     Filtre `isMarkdownFile` (nom `.md`/`.markdown`/`.txt` ou type
     `text/markdown`/`text/plain`) : tout autre fichier glissé/collé est ignoré
     silencieusement. Lecture via `file.text()`. Routage décidé par
     `resolveSkillDropTarget(fm, existingSlugs)` (skills.js, pur) :
     - pas de cartouche, ou cartouche sans `name` → **création**, nouvelle card
       vide (slug à saisir).
     - cartouche avec `name` dont le slug slugifié **matche une skill
       existante** → **édition** de cette skill (bascule sur sa card).
     - sinon → **création**, slug pré-rempli par le `name` slugifié.
     Orchestré par `ingestSkillMarkdownFile(text)` (main.js) : ferme toute card
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

6. **Autotrigger (stage 2) : listing dynamique, SIBLING de `<miaou_context>`, pas
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
     `create_memory`, où la question seule suffit au tour suivant). Pour une
     skill, le corps lu peut faire plusieurs paragraphes : au tour suivant
     (« Oui »), le modèle ne l'a plus, doit le relire, reconfirme → boucle sans
     jamais agir (observé en pratique). Retiré, pas contourné : lire une skill
     n'a pas d'effet de bord, agir dessus n'en a pas non plus par nature (ce
     sont des instructions, pas une action irréversible), et l'utilisateur voit
     l'appel `skills__read` dans l'ack. Garde anti-narration (`_TAIL`) : ne pas
     prétendre avoir appliqué une skill sans avoir appelé `skills__read` dans
     le même tour.
