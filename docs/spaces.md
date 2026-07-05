# Spaces / « Espaces » (lot C)

Espaces de travail mutuellement hermétiques : un Space regroupe des
conversations (et leurs pièces jointes) et des souvenirs qui lui sont propres.
La zone hors-Space historique est elle-même un Space — le **default Space**
(id fixe `DEFAULT_SPACE_ID`, actuellement `'default'`, nom d'affichage
« Général ») — pas de cas particulier structurel. Un scope `'profile'`
existe **au-dessus** des Spaces pour les souvenirs uniquement : global,
injecté dans tous les Spaces.

Décisions actées (brief C, `untracked/muscle/C-spaces.md` — non versionné,
décisions reprises ici) :
- Nom d'affichage du default Space : « Général ».
- Ligne « Espace : &lt;nom&gt; » dans `<miaou_context>` (visible au modèle).
- Space actif persisté entre sessions (`miaou-active-space`, string brute).
- Badge topbar masqué dans le default Space (posé en C3).

## Schéma (C1 — voir `docs/storage.md` pour le détail complet)

- `miaou-spaces` : `[{ id, name, description?, createdAt }]`. `description`
  (texte libre) est **ajoutée après** le prompt système utilisateur global —
  ce n'est PAS un system prompt de substitution.
- `miaou-active-space` : string brute, id du Space actif.
- Conversations : `spaceId?` (absent = `DEFAULT_SPACE_ID`).
- Souvenirs (`miaou-memories`) : `scope?` (`'profile'` ou un `spaceId`, absent
  = `DEFAULT_SPACE_ID` après migration).
- Migration idempotente `migrateSpacesIfNeeded()` (storage.js), rejouée à
  chaque chargement (`init()`, avant tout rendu) — pas un one-shot.

## Herméticité (C2 — voir piège n°18, `CLAUDE.md`, et `docs/pitfalls-detail.md`)

Prédicat unique `spaceConvIds(spaceId, convs)` (storage.js, pur). Sites
branchés en C2 :
- `renderConvList()` (ui.js) : filtre `listAllConversations()` sur
  `c.spaceId === activeSpaceId`.
- `list_conversations` / `get_conversation` (tools.js) : réponse
  « introuvable » identique à un id inexistant pour toute conversation hors
  Space actif — pas d'oracle. Résumé orphelin (conversation supprimée) traité
  comme default Space.
- Sélection d'injection de résumés : `searchSummaries(text, excludeId,
  spaceId)` (api.js) exclut les résumés hors-Space.
- Mémoire : `buildMemoryEntriesBlock()` injecte scope `'profile'` +
  `activeSpaceId` ; `create_memory` stampe le Space actif ; `update_memory`/
  `delete_memory` refusent hors-Space (« Souvenir introuvable. »).
- Description de Space : `resolveUserSystemPrompt()` — la `description` du
  Space actif est **ajoutée après** le prompt système global (concaténation,
  jamais substitution — brief D4 corrigé). Changer de Space change donc le
  system message (assumé, casse le préfixe KV cache le temps du switch —
  piège 16).
- `<miaou_context>` porte une ligne statique-par-Space « Espace : &lt;nom&gt; »
  (y compris pour le default Space).

## UI (C3)

- **Sélecteur de Space** (`#space-select`, tête de sidebar, au-dessus de la
  recherche) : bouton pilule (`toggleSpaceMenu`) + menu `.model-menu`
  générique (`renderSpaceMenu`, ui.js) — même mécanique que le sélecteur de
  modèle du composer, **pas de `<select>` natif** (règle projet). Chaque ligne
  affiche le nom du Space ; clic sur le nom ou le check → `pickSpace(id)` ;
  crayon (`.space-opt-edit`) → `openSpaceScreen(id)` sans changer de Space
  actif. Ligne finale « + Nouvel espace » → `createSpaceAndOpen()` (génère un
  id, crée le Space nommé « Nouvel espace », ouvre son écran pour saisie
  immédiate du vrai nom).
- **Switch de Space** (`pickSpace`, ui.js) : no-op si déjà actif ; sinon fige
  `currentConvId` avant de le perdre (comme `newConversation`/`selectConv`),
  `activeSpaceId` + persistance (`setActiveSpaceId`), `resetToEmpty()` (fil +
  sidebar vidés/re-rendus dans le nouveau Space), `syncSpaceUI()` (pilule +
  badge), puis `summarizeIfNeeded(leaving)` en arrière-plan sur la
  conversation quittée — même pattern que `newConversation`.
- **Badge topbar** (`#topbar-space-badge`, `.topbar-left`) : même fondu que
  `.topbar-brand` (visible sidebar repliée uniquement, classe
  `.app.booted:not(.sidebar-open)`), **masqué en plus** par `[hidden]` posé
  côté JS (`syncSpaceUI`) quand `activeSpaceId === DEFAULT_SPACE_ID` — deux
  conditions indépendantes qui se cumulent, ne pas les confondre.
- **Écran Space** (`#space-drawer`, pattern sous-drawer MCP) : `openSpaceScreen(id)`
  peuple nom/description, désactive le champ nom et masque le bouton
  suppression si `id === DEFAULT_SPACE_ID` (non renommable-nom-vide, non
  supprimable), rend la liste mémoire scopée (`renderMemoryList('space-memory-list',
  id)`). `onSaveSpaceScreen()` valide un nom non vide (sauf default, dont le
  nom est laissé intact si le champ est vidé par erreur) et persiste via
  `upsertSpace`. **Suppression D6** (`onDeleteSpaceScreen`) : arm-then-run
  (`armThenRun`, même pattern que la poubelle sidebar) avec le libellé du
  bouton portant les comptes (« Supprimer (N conv., M souvenirs) ») ; la
  confirmation exécute la cascade = boucle `deleteConv` sur chaque conversation
  du Space (cascade IDB attachments déjà gérée par `deleteConv`) + `forgetMemory`
  sur chaque souvenir scopé (hard delete, pas de tombstone : le Space entier
  disparaît) + `deleteSpaceEntry`. Si le Space supprimé était l'actif, bascule
  immédiatement vers le default Space (`resetToEmpty` + persistance). Profile
  intact dans tous les cas — jamais touché par cette cascade.
- **Liste mémoire paramétrée** (`renderMemoryList(containerId, scope)`,
  ui.js) : un seul jeu de fonctions pour le drawer réglages (profile,
  `containerId` et `scope` par défaut) et l'écran Space (`scope` = id du
  Space). L'input d'ajout est namespacé par conteneur
  (`mem-add-input-<containerId>`) ; les ids par entrée restent globaux (id de
  souvenir unique). **Promotion Space → profile** (`promoteMemoryEntry`,
  bouton visible uniquement quand `scope !== 'profile'`) : réécrit `scope` en
  place, pas de nouvelle entrée. **Démotion volontairement absente en v1** —
  non-goal, à revalider explicitement si demandée plus tard.
- **Drawer réglages « Souvenirs »** devient l'onglet **Profil** (libellé
  renommé côté HTML et bouton d'ouverture) : gère exclusivement le scope
  `'profile'` (appel `renderMemoryList()` sans argument = défaut) — pas de
  liste mixte, pas de badge de scope à afficher.
- **Création de conversation** : `ensureConversation()` (main.js) stampe
  `spaceId: activeSpaceId` au moment de la création (point unique).
- **Déplacement de conversation entre Spaces : NON-GOAL v1** (herméticité
  d'abord, cf. non-goals ci-dessous).

## Non-goals v1

- Pas de configuration MCP ni de skills par Space (restent globaux).
- Pas de bibliothèque de fichiers partagée par Space (les pièces jointes
  restent par message).
- Pas de déplacement de conversation entre Spaces.
- Pas d'export/import par Space (l'export global inclut les Spaces, cf.
  `docs/storage.md`).
