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

## Bibliothèque de fichiers d'espace (lot Cbis)

Non-goal v1 (ci-dessous) **levé** : chaque Space a sa propre bibliothèque de
fichiers, hermétique comme le reste (piège 18), persistante à travers les
conversations. Distincte des pièces jointes de message (lot A, `att-N`,
ephémères — restent inchangées) : la bibliothèque est le chemin persistant.

- **Stockage** : store IDB `resources` réutilisé (pas de store dédié, pas de
  clé localStorage), discriminant `kind:'library'` + `spaceId`, index `by_space`
  (IDB v3). Détail complet : `docs/storage.md`.
- **Ingestion** — trois chemins :
  1. **Upload direct** depuis l'écran Space (section « Fichiers »,
     `ingestLibraryFile`, main.js) — mêmes caps que les pièces jointes (image
     1536px q0.85, texte ≤200 kB inline, binaire tel quel).
  2. **Promotion utilisateur** : action « Ajouter à la bibliothèque de
     l'espace » sur un attachment de message déjà envoyé (chip, `.att-promote`,
     `promoteAttachmentToLibrary`, ui.js) — copie immédiate, pas de gate (déjà
     une action utilisateur explicite), l'attachment d'origine reste intact.
  3. **Promotion modèle** via l'outil `miaou__files__promote(ref, description,
     name?)` — **consent-gated en amont**, voie B (voir ci-dessous).
- **Accès modèle (lecture)** : `miaou__files__list` / `miaou__files__read`,
  read-only, scopés au Space actif (`getCachedLibraryEntriesBySpace`), même
  posture no-oracle que `get_conversation` sur id étranger/inconnu. Lecture
  binaire routée via le hook d'inflation mcp_docs généralisé (att-N ou
  file-<id>, cf. `docs/mcp.md`). Détail : `docs/tools.md`.
- **Contexte** : manifeste compact (`buildLibraryManifestBlock`) injecté dans
  `<miaou_context>` si la bibliothèque du Space actif est non vide — une ligne
  d'intro nommant le Space (« Fichiers disponibles dans l'espace X : »), puis
  une ligne par fichier, description incluse si elle existe. Alimente aussi le
  context inspector (entrée `space_library`). Détail : pitfalls-detail.md,
  piège 18.
- **Consentement de la promotion modèle — voie B (décision Cbis-4).** Le
  primitif halting existant (`ask_confirmation`) n'est **jamais** auto-rappelé
  par le même outil dans la base actuelle : le modèle l'appelle, obtient
  « Oui »/« Non » en texte, puis rappelle un AUTRE outil pour exécuter
  (`create_memory` sur le chemin inféré mémoire, l'action d'une skill après
  confirmation). La voie A envisagée initialement (généraliser `toolIsHalting`
  pour que `files__promote` soit lui-même halting-puis-exécutant) aurait
  introduit un patron inédit, non éprouvé, sur un primitif partagé — écartée
  après relecture du mécanisme réel. **Voie B retenue** : `files__promote`
  reste un outil ordinaire (jamais halting), le gate est **doctrinal**
  (`FILES_DOCTRINE`, tools.js, toujours injectée dans `ROOT_SYSTEM_PROMPT`) —
  le modèle doit appeler `ask_confirmation` avec un récapitulatif (nom, type,
  taille, description proposée) avant tout appel à `files__promote`, et
  rappeler ensuite avec le MÊME `ref`/`description`. Conséquence assumée : le
  gate repose
  sur la discipline du modèle, pas sur un verrou technique côté handler —
  exactement le même modèle de confiance que pour `create_memory` sur le
  chemin inféré, pas une régression de posture.
- **Suppression** : cascade de suppression de Space purge aussi ses fichiers
  (`getResourcesBySpace` + `deleteResource` par entrée) ; suppression d'une
  conversation ne touche jamais les fichiers d'espace, y compris ceux promus
  depuis elle (copiés, provenance informationnelle via `source`).
- **Non-goals v1 (bibliothèque)** : pas de suppression/mise à jour de fichier
  par le modèle (seule la promotion est un write model-side), pas de partage
  inter-Space, pas de versioning/dédup/dossiers/tags/renommage, pas de
  pagination de `files__list`.

### Descriptions de fichiers (D7, lot Cbis-5)

Transforme le manifeste de métadonnées froides en index sémantique — même
posture que les résumés de conversation (`summarizeIfNeeded`/
`miaou-summaries`), pas le même contenu : **ce n'est pas un résumé du
contenu du fichier**, c'est une description de ce que le fichier EST (nature,
sujets couverts, structure) pour que le modèle juge s'il doit l'ouvrir
(`files__read`) avant de s'en servir — un résumé condenserait l'information,
une description aide à décider de la lire ou non. Revu après retour
utilisateur (le prompt initial produisait un résumé exploitable seul, pas une
aide à la décision de lecture).

- **Trigger à l'ingestion, jamais un daemon.** `describeFileIfNeeded(fileId,
  onStatus, force?)` (main.js) est appelée une fois par fichier :
  - upload direct (D2 path 1, `onSpaceFilesSelected`) — fire-and-forget après
    le re-render de la liste, un appel par fichier, indépendants entre eux ;
  - promotion utilisateur (D2 path 2, `promoteAttachmentToLibrary`) —
    fire-and-forget, aucun statut par carte affiché immédiatement (pas d'écran
    Space ouvert à cet instant), visible à la prochaine ouverture ;
  - **jamais** pour la promotion modèle (D2 path 3, `files__promote`) : la
    `description` y est déjà fournie par le modèle et stockée telle quelle (A3
    confirmé), une génération D7 supplémentaire serait un doublon.
  Pas de queue, pas de retry : un échec laisse le fichier sans description,
  plus une action manuelle « (re)générer » sur la carte
  (`onRegenerateFileDescription`, paramètre `force=true` — ignore le toggle ET
  une description déjà présente).
- **Extraction** : texte (`class:'inline'`) → contenu déchiffré, tronqué à
  `FILE_DESCRIPTION_EXTRACT_MAX_CHARS` (8 kB, proposition A5 confirmée) ;
  binaire → **appel direct** à `mcpRpc` via `findDocsInflationTool()` +
  `extractBinaryFileTextForDescription()` (tools.js) — **PAS** le hook
  dispatcher `callDocsInflatedRemoteTool` du §4/D3 : celui-ci est conçu pour un
  tool_call du **modèle** (pousse un ack visible, dépend d'une conversation en
  cours), alors qu'une description D7 est une opération applicative en
  arrière-plan, sans ack, potentiellement hors de toute conversation ouverte
  (upload direct). `findDocsInflationTool()` reproduit la même détection sans
  nom en dur (`ref`+`content_b64` déclarés) mais retourne `(server, toolName)`
  pour un appel `mcpRpc(server, 'tools/call', …)` direct ; `session_id`
  synthétique `'lib-description-' + fileId` (pas un id de conversation —
  l'ingestion n'en a pas forcément une). Image → skip v1 systématique (pas de
  modèle vision dédié, décision D7 actée) — pas d'erreur, juste l'absence de
  description.
  **Bug corrigé après retour utilisateur** : un serveur d'extraction expose
  souvent plusieurs outils déclarant `ref`+`content_b64` (mcp_docs :
  `list`/`read`/`search`) — le premier trouvé n'est pas forcément celui qui
  lit du contenu. `findDocsInflationTool()` filtre désormais aussi sur
  `_declaresContentReadSignature` (présence de `char_start`/`line_start`,
  absence de `query`), cf. `docs/mcp.md` point 14 pour le détail complet et la
  convention à respecter par tout futur serveur d'extraction.
- **Appel de description** : `silentCompletion` + `NOTHINK_PARAMS` (api.js),
  prompt constant dédié `FILE_DESCRIPTION_PROMPT` (**distinct** de
  `SUMMARY_PROMPT`, qui cible une conversation en JSON summary+keywords, et
  sémantiquement distinct d'un résumé — cf. plus haut) — sortie texte libre,
  cap strict ≤ 2 phrases, interdiction explicite des expressions temporelles
  relatives (la description atterrit dans le manifeste `<miaou_context>`,
  byte-stable tant qu'elle ne change pas — piège 18/16). Stockée dans
  `record.description` via `capFileDescription` (cap dur 240 car., cf.
  `docs/storage.md`).
- **Réglage** : `describeFiles` (storage.js `DEFAULT_SETTINGS`, **défaut
  `true`**, décidé), case dans le drawer réglages (« Descriptions de
  fichiers »), rejoint `settingsFormDirty`. **Pas de model picker** (décidé) :
  la génération de description utilise le modèle de chat actif
  (`activeApiConfig`) — le coût de contention multi-modèle est accepté (YAGNI,
  revisiter seulement si ça gêne en usage réel).
- **Statut par carte** (`renderSpaceFilesList`/`setFileDescriptionStatus`,
  ui.js) : « description en cours… » sur la ligne d'excerpt + bouton désactivé
  pendant le calcul, puis contenu (`done`) ou retour à l'état neutre avec
  bouton « Générer une description » (`failed`) — pas de message d'erreur
  intrusif, cohérent avec la posture « dégradé, jamais bloquant ».

## Non-goals v1

- Pas de configuration MCP ni de skills par Space (restent globaux).
- Pas de déplacement de conversation entre Spaces.
- Pas d'export/import par Space (l'export global inclut les Spaces, cf.
  `docs/storage.md`).
