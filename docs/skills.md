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
   implémentations. `parseSlashCommand` (pur) → si `/<slug>` : lookup cache ; slug
   absent/désactivé → `{ ok:false, error }` → erreur composer locale
   (`showComposerSkillError`), **aucun envoi, aucun tour modèle, thread inchangé** ;
   sinon `getSkillContent` (IDB) puis `bakeSkillMessage(littéral, content)` =
   `littéral + '\n\n' + corps` → `{ ok:true, content:baké, isSkill:true }`.
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

4. **Chemin langage naturel = `skills__list` + `skills__read`** (cf. `docs/tools.md`).
   Additif au registre `miaou__` existant — ne renomme aucun outil. C'est
   un **tool_result normal** (passe par la généralisation tool-ack, contenu
   disponible au modèle dès ce tour ET réinjecté cross-turn via `expandThread`),
   **pas** par l'injection figée du slash.

5. **Drawer `#skills-drawer`** (`.drawer-wide`, plus large pour éditer le corps) :
   cartes vue/édition en `createElement`/`textContent` (jamais `innerHTML` pour les
   données). Rendu dans `ui.js` (`renderSkills`/`buildSkillCard`), persistance dans
   `main.js` (`onSaveSkillCard`/`onDeleteSkillCard`/`onToggleSkill`), comme le
   pattern MCP. `validateSkillSlug` (pur) : non vide, pas d'espace/`/`, charset
   `[A-Za-z0-9_-]`, longueur ≤ 48, unicité. Toggle `autotrigger` (stage 2) en
   section édition uniquement (`.skill-autotrigger`), à côté du toggle `enabled`
   existant ; lu par `onSaveSkillCard` comme `enabled`.

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
     utiliser une skill listée, appeler `miaou__skills__read(slug)`.
     **Règle de confirmation, RÉSOLUE côté client, jamais une condition posée au
     modèle** : `confirmSkillAutoUse` est un réglage `localStorage`, invisible au
     modèle — lui demander de « vérifier si le réglage est actif » serait
     incohérent (rien dans son contexte ne porte cette valeur). `tools.js`
     découpe donc la doctrine en trois constantes (`SKILL_DOCTRINE_BASE`,
     `SKILL_DOCTRINE_CONFIRM_ON`/`_OFF`, `SKILL_DOCTRINE_TAIL`) ;
     `skillDoctrinePrompt()` lit `loadSettings().confirmSkillAutoUse` et assemble
     la version déjà tranchée — le modèle ne reçoit jamais qu'une seule
     instruction sans branche, cohérente avec l'état réel du toggle au moment de
     l'appel. Variante ON : appeler `ask_confirmation` (nu) **après** la lecture
     et **avant** d'agir, uniforme sur les deux chemins de découverte (listing
     dynamique ou `skills__list`), mais **ne s'applique jamais** à l'invocation
     slash (`/slug` = consentement déjà explicite, `skills__read` n'est jamais
     appelé sur ce chemin). Variante OFF : agir directement sur le résultat de
     `skills__read`. Garde anti-narration commune aux deux variantes (`_TAIL`) :
     ne pas prétendre avoir appliqué une skill sans avoir appelé `skills__read`
     dans le même tour.
   - **Réglage global `confirmSkillAutoUse`** (`miaou-settings`, défaut `true`) :
     toggle dans le drawer Paramètres (`#set-confirm-skill-autouse`), dans le champ
     « Skills » (pas le champ « outils »), juste après le bouton « Gérer les
     skills » — propriété spécifique aux skills, pas un toggle global d'outils
     comme « Traces en langage naturel ». C'est la valeur que `skillDoctrinePrompt()`
     lit pour choisir la variante de doctrine à injecter (cf. ci-dessus).
