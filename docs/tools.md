# Outils (`tools.js`), acks, et références de conversation

## Registre d'outils

Vingt-huit outils dans le tableau `TOOLS` ; leur description au modèle dérive
**du registre** (`toolDefinitions()`) — ne jamais la coder en dur.
`ask_confirmation` (primitif halting, cf. plus bas) est exposé au modèle mais
**hors registre** : il ne figure pas dans `TOOLS` et ne compte pas dans ces
vingt-huit.

**Lecture de l'historique :**
- `conv__get(id, with_contents=false)` — lit l'**index des résumés**
  (`getSummaryEntry`). Introuvable si pas d'entrée ou tombstone. **Herméticité
  des Spaces (brief D2, lot C)** : une conversation d'un autre Space que
  `activeSpaceId` répond le même message « Conversation introuvable ou
  souvenir supprimé. » — pas d'oracle qui distinguerait « hors-Space » de
  « n'existe pas ». Un résumé orphelin (conversation supprimée) vaut default
  Space. Cf. piège n°18, `CLAUDE.md`.
- `conv__list(since?, query?, with_contents=false)` — entrées
  non-tombstone dont `timestamp >= Date.parse(since)`, **exclut toujours la
  conversation courante** (`currentConvId`, global de main.js — accès défensif
  via `typeof … !== 'undefined'` car tools.js est aussi évalué seul par le test
  runner) : « conversations passées » n'inclut pas celle en cours. Filtrée en
  amont par Space actif (même posture d'herméticité que `conv__get`,
  résumé orphelin = default Space). `since` et
  `query` optionnels, filtres cumulables (since puis query). `query` réutilise
  le **même moteur que la recherche sidebar** (`tokenize` + `scoreSummary`,
  utils.js, seuil `score >= 1`) — mots-clés pèsent 2, mots du résumé/titre
  pèsent 1 ; ce n'est PAS une sous-chaîne exacte.

**Écriture directe de souvenirs (chemin direct — instruction explicite) :**
- `memory__create(content)` — écrit immédiatement dans `miaou-memories`, retourne
  l'identifiant généré (utile pour un `memory__update` ultérieur dans le même
  échange). **Stampe `scope = activeSpaceId`** (brief D3) : aucun paramètre
  `scope` exposé au modèle, toujours le Space actif — jamais `'profile'`
  (promotion réservée à une action UI).
- `memory__update(id, content)` — correction in-place, pas de tombstone.
  **Refuse hors-Space** (`existing.scope !== activeSpaceId`, y compris scope
  `'profile'`) avec « Souvenir introuvable. » — même posture sans-oracle que
  `conv__get`.
- `memory__delete(id)` — tombstone réversible (`suppressed: true`). Même garde
  de scope que `memory__update`.

**Présentation de ressource :**
- `resource__present(id)` — handler **synchrone** (lookup `_resourceCache`) ; pousse
  un ack `resource_presented` — le rendu du bloc (image, code, téléchargement) est
  délégué à `placeToolAck` (même chemin live et reload via IDB). Renvoie une erreur
  textuelle si l'id est inconnu du cache session.

**Rappel de pièce jointe (brief A, lot 3, D4) :**
- `recall_attachment(ref)` — `ref` = `att-N` (id conversation-scopé d'une pièce
  jointe de message, cf. `docs/storage.md`). Handler **synchrone**, lookup
  `getCachedRecordByAttId(ref, currentConvId)` (resources.js — même session
  cache que `resource__present`, peuplé par `loadConversationResources` à
  l'ouverture). Distinct de `resource__present` : id-space différent (`att-N`
  vs `res_...`), paramètre `ref` (pas `id`) — collision de nom évitée
  volontairement (décision actée lot 2, cf. handover). Comportement par
  `kind` du record : **image** → **les pixels SONT ré-injectés au modèle**
  (brief A2 / D3, voie (b) validée par probe le 2026-07-05 : la voie (a) — part
  image dans le message `role:'tool'` — transmet bien les pixels sur Ollama mais
  **confabule silencieusement** quand la part est strippée ; la voie (b) échoue
  honnêtement « AUCUNE IMAGE », d'où le choix). Le handler renvoie un tool result
  **textuel annonciateur** (« Image att-N ré-affichée… son contenu suit dans le
  message suivant ») et pousse un ack `attachment_recalled`. La ré-injection
  proprement dite est un **message user synthétique** porteur de la part image,
  **généré à la volée par `expandThread`** (utils.js, pur) et inséré APRÈS tous
  les tool results du groupe — jamais un entry `currentThread` persisté. La
  dataUrl est posée sur une copie de l'ack (champ `recallImage`) par le pré-pass
  **`resolveRecallImages`** (resources.js, navigateur) qui la reconstruit depuis
  le record en cache (`arrayBufferToBase64(record.data)`) à **chaque** envoi —
  byte-stable (dérivée du record figé), **jamais persistée** (absente
  d'`ACK_COPY_FIELDS`, seul `attId` l'est). Branché dans `dispatchSend` :
  `expandThread(resolveRecallImages(resolveResourceRefs(currentThread)))`. Record
  purgé du cache → pas de `recallImage` → aucun message synthétique émis, seul le
  tool result textuel subsiste (dégradation propre). L'ack pousse aussi le bloc
  image affiché à l'utilisateur via `placeToolAck` (lookup par `attId` **pas**
  par `id` — seule différence de contrat avec `resource_presented`) ; **texte**
  (`record.class === 'inline'`) → renvoie le contenu déchiffré en clair
  (`utf8Decode`) ; **binaire** → renvoie `formatResourceDescriptor(...)` + note
  « contenu non lisible directement » (les futurs outils `docs__*` du lot D
  restent la voie d'extraction pour ce cas). Erreur textuelle si `ref` inconnu du
  cache session ou absent de la conversation courante. La forme cross-turn
  **persistée** reste le descripteur (`formatAttachmentDescriptor`, resources.js,
  piège n°17) : le message user d'origine porte toujours le descripteur `att-N`,
  la ré-injection image n'est que transitoire (recomputée par le pré-pass, jamais
  écrite). `servedKeys` (api.js) court-circuite un recall rigoureusement identique
  répété dans le même échange (clé `nom:arguments`) : acceptable, l'image ré-injectée
  plus haut est encore dans le contexte de l'échange. Doctrine dédiée
  `ATTACHMENT_DOCTRINE` (tools.js, partie de `ROOT_SYSTEM_PROMPT`) : distincte de
  `BINARY_DOCTRINE` (qui couvre les ressources produites par un outil, pas les
  fichiers attachés par l'utilisateur). Elle est calée sur l'implémentation
  réelle : fichier texte → contenu toujours inline (D3, ne jamais rappeler) ;
  image → rappel qui **ré-injecte les pixels** dans le contexte (et ré-affiche à
  l'utilisateur), interdiction de décrire une image « de mémoire » sans l'avoir
  rappelée ; binaire → descripteur seul.

**Skills (sous-namespace `miaou__skills__`, cf. `docs/skills.md`) :**
- `skills__list()` — méta (`slug`, `name`, `description`) des skills **activés
  uniquement**, depuis le cache mémoire (synchrone). Pousse un ack `skill_list`
  (informatif, sans undo, icône `ICON_LIST` réutilisée de `conversation_list`).
- `skills__read(slug)` — corps Markdown complet d'une skill activée. Contrôles
  introuvable/désactivé sur le cache mémoire = **erreur synchrone** (testable
  QuickJS) ; le contenu vient d'IDB = **handler asynchrone** (renvoie une
  `Promise<string>`). `callInternalTool` détecte un retour thenable et le mappe.
  `api.js` calcule `isMcp` via `parseToolName` (préfixe ≠ `miaou`/`''`), **pas**
  par duck-typing `.then`, sinon cet outil interne async serait pris pour un appel
  distant. Pousse un ack `skill_read` (informatif, sans undo) — nom de la skill stocké
  dans `title` (pas `name` : `onEnrichLastAck` écrase `name` avec le nom canonique
  de l'outil pour la réinjection cross-turn).
- `skills__write(slug, name?, description?, content?, enabled?, overwrite?)` —
  crée ou modifie une skill. Slug existant sans `overwrite:true` → erreur claire,
  **aucune écriture** (garde-fou anti-écrasement accidentel). En modification,
  merge partiel : tout champ omis (`name`/`description`/`content`/`enabled`)
  conserve la valeur actuelle, lue depuis IDB (`getSkillRecord`, async) avant
  écriture. `autotrigger` n'est **pas** exposé au modèle (réservé au toggle
  utilisateur du drawer, stage 2) : toujours préservé tel quel depuis
  l'enregistrement existant, `false` par défaut en création — comme `putSkill`.
  Nouvelle skill activée par défaut (`enabled` omis → `true`). Contrôles
  slug/existence sur le cache mémoire (synchrone, `validateSkillSlug`/
  `getSkillMeta`) ; lecture de l'existant + écriture via `putSkill` (async,
  pattern `skills__read`). Pousse un ack `skill_write` (informatif, sans undo —
  cohérent avec l'absence de tombstone sur `deleteSkillDb`) portant `created`
  (bool) pour distinguer création/modification dans le libellé.

**Aide utilisateur (lot I) :**
- `about(topic?)` — sert une section de l'aide utilisateur de MIAOU depuis
  `HELP_CONTENT` (objet `{slug: markdown}` injecté au build depuis `src/help.md`
  par `parse_help_sections`, cf. `CLAUDE.md` section pipeline). Handler
  **synchrone** (const en mémoire) → testable QuickJS. L'`enum` du paramètre
  `topic` dérive de `Object.keys(HELP_CONTENT)` (même source que le contenu, pas
  de drift) ; `required` vide → un `topic` absent **ou inconnu** retombe sur
  `apercu` (défaut). Pousse un ack `about_read` (informatif, sans undo, icône
  `ICON_BOOK` réutilisée de `skill_read`/`files_read`, champ `topic`). Le contenu
  d'aide **n'est jamais dans le contexte** : seuls le blurb d'identité
  (`IDENTITY_BLURB`, statique, en tête du system message) et l'`enum` de slugs y
  vont ; les sections n'arrivent qu'en tool result, une par appel. Sous QuickJS
  `HELP_CONTENT` vaut `{}` (marqueur non substitué → enum vide) : les tests du
  parseur couvrent le découpage côté `build.py`, ceux du handler couvrent la
  mécanique (fallback apercu, ack) — le lookup positif est garanti par le build
  (dist/ contient les topics).
- `about_search(query)` — cherche des mots-clefs (séparés par des espaces) dans
  `HELP_CONTENT` et renvoie les topics qui les contiennent TOUS (ET logique,
  pas OU — un OU noierait le résultat dès 2-3 mots courants), chacun avec un
  tableau `excerpts` : **un extrait par occurrence** de chaque mot-clef (~100
  caractères de rayon, ellipses `…` aux bords coupés), pas seulement la
  première occurrence du premier mot-clef — correction post-lot suite à un cas
  observé (Mistral, query « fichier Markdown HTML » sur `exports`) où centrer
  sur le 1er hit ratait le paragraphe pertinent plus loin dans la section, et
  le modèle concluait à tort à l'absence d'une fonctionnalité pourtant
  documentée. Fenêtres qui se chevauchent fusionnées en un seul extrait ;
  plafond `HELP_SEARCH_MAX_EXCERPTS` (5) par topic — au-delà, `truncated: true`
  signale qu'il reste des occurrences non montrées. La description de l'outil
  rend explicite que les extraits sont indicatifs et qu'il faut appeler
  `about(topic)` pour lire la section entière avant de conclure à une absence.
  Délègue à `searchHelpContent(helpContent, query)` (utils.js, **pure**, ne lit
  aucun global — même garantie que `buildContextManifest`) : le handler ne fait
  que lui passer `HELP_CONTENT` et sérialiser le résultat en JSON. `query` vide
  → `toolFail`. Aucun résultat → message explicite plutôt qu'un tableau vide
  silencieux. Pousse un ack `about_search` (informatif, sans undo, icône
  `ICON_LIST`, champs `query`/`count` — `count` = nombre de topics matchés, pas
  d'extraits) — pensé comme un préalable à `about` : trouver le bon `topic`
  sans lister tous les sujets ni deviner.

**Bibliothèque de fichiers d'espace (lot Cbis, read-only v1) :**
- `files__list()` — entrées de la bibliothèque de l'**espace actif uniquement**
  (`getCachedLibraryEntriesBySpace(activeSpaceId)`, cache session unifié avec
  les attachments — cf. `docs/storage.md`) : `{ id: file-<id>, name, mime,
  size, source }`. Pas de pagination v1. Pousse un ack `files_list` (informatif,
  sans undo, icône `ICON_LIST` réutilisée de `skill_list`/`conversation_list`).
- `files__read(id)` — `id` = `file-<id>` (obtenu via `files__list`, cf.
  `libraryRefFromId`/`parseLibraryRef`, resources.js). Handler **synchrone**,
  lookup `getCachedRecord(parseLibraryRef(id))` puis vérification
  `record.kind === 'library' && record.spaceId === activeSpaceId` — même
  posture no-oracle que `conv__get`/`memory__update` : id malformé,
  inconnu, ou d'un **autre Space** répondent tous « Fichier introuvable. »,
  aucune distinction de message. Comportement par mime : **texte** (`class ===
  'inline'`) → contenu en clair (`utf8Decode`, mêmes caps que lot A) ; **image**
  → soumise au flag vision `serverModelVisionEnabled(activeApiServer(),
  activeModel())` — sur un modèle sans vision, posture explicite (« ne peut pas
  être présenté… pas de capacité de vision »), jamais de placeholder muet ; v1
  ne ré-injecte pas les pixels depuis cet outil (contrairement à
  `recall_attachment` — pas de besoin identifié pour l'instant, même mécanisme
  transposable si un besoin se confirme) ; **binaire** (PDF/Office/zip) →
  descripteur + renvoi explicite vers les outils mcp_docs (le modèle enchaîne
  via `files__read` puis les outils de lecture de documents, comme pour un
  attachment de message). Pousse un ack `files_read` (informatif, sans undo,
  icône `ICON_BOOK` réutilisée de `skill_read`).
- **Nom d'outil avec double underscore interne** (`files__list`/`files__read`,
  comme `skills__list`/`skills__read`) : `parseToolName` (utils.js) splitte sur
  le **premier** `__` seulement, donc le nom exposé au modèle
  (`miaou__files__list`) reste sans ambiguïté (`serverPrefix='miaou'`,
  `toolName='files__list'`). **Piège en test/debug direct** : appeler
  `callTool('files__list', …)` **sans** le préfixe `miaou__` route à tort vers
  un serveur MCP distant nommé `files` (le split se ferait alors sur `files` /
  `list`) — toujours tester/appeler avec le nom complet `miaou__files__list`
  (cf. `tests/test-tools.js`, même piège déjà présent pour `skills__*`).
- **Hook d'inflation généralisé (§4 audit Cbis)** : la lecture d'un fichier
  binaire de bibliothèque passe par `callDocsInflatedRemoteTool` (tools.js),
  **le même hook que pour les attachments de message** (brief H), pas un
  second mécanisme. Généralisation : `_resolveInflationRef(ref)` reconnaît
  `att-N` (résolution par `getCachedRecordByAttId`, conversation-scopée) OU
  `file-<id>` (résolution par `getCachedRecord` + vérification `spaceId`,
  Space-scopée) et renvoie un objet `{ record, sessionId, isPushed, markPushed
  }` uniforme. **Depuis le lot L, le lookup record lui-même est factorisé dans
  `resolveHandleRecord(ref)`** (tools.js — source unique « quel record derrière
  ce handle », les trois branches sans push-state), au-dessus de la
  classification pure `classifyHandleRef(ref)` → `'att'|'file'|'resource'|null`
  (réutilise les trois `*_REF_RE`, jamais dupliquées). `_resolveInflationRef`
  **consomme** `resolveHandleRecord` et n'ajoute QUE le descripteur push-MCP
  (sessionId + tables) par famille — refactor à comportement constant, mêmes
  deux tables d'état poussé distinctes (`_attachmentPushState`
  clé `(conversationId, attId)`, `_filePushState` clé `(spaceId, fileId)`) —
  pas de format de clé partagé entre les deux familles de refs. `session_id`
  reste **toujours** la conversation courante, même pour un fichier d'espace
  (le serveur mcp_docs ne connaît que des sessions de conversation) : un
  fichier lu depuis une conversation est poussé dans LA session de cette
  conversation — pas de partage de session inter-conversation pour un fichier
  (dette assumée, cf. `docs/mcp.md`).
  - **Troisième famille `res_…` (lot K)** : le même hook reconnaît aussi
    `RESOURCE_REF_RE` (`res_<base36>`, underscore) — un `res_…` est directement
    l'id d'un record (`getCachedRecord(ref)`), scopé conversation par le cache
    session (herméticité). Troisième table `_resourcePushState` clé
    `(conversationId, resId)`, purgée par `deleteConv`. Source phare : les octets
    d'une ressource web transférés par `web__fetch_resource` et matérialisés en
    `res_…` binaire (lot K §4.1) — mais tout `res_…` binaire est injectable, pas
    seulement web. Détail complet : `docs/mcp.md` point 13bis.

**Promotion vers la bibliothèque d'espace (lot Cbis, D2 path 3, écriture
model-side unique sur la bibliothèque) :**
- `files__promote(ref, description, name?)` — copie un contenu dans la
  bibliothèque du Space actif. **Deux familles de `ref` acceptées (lot V)** :
  `att-N` (pièce jointe du tour courant) et `res_<id>` (ressource de session).
  La seconde ouvre le **dépôt d'un contenu produit par le modèle** :
  `resource__create` puis `files__promote` sur le handle renvoyé — le chemin
  qui manquait pour qu'un CSV/script généré en réponse puisse atterrir dans la
  bibliothèque sans aller-retour manuel par la machine de l'utilisateur.
  `file-<id>` est **refusé explicitement** (« déjà dans la bibliothèque »),
  pas traité en introuvable : aucune question d'herméticité ici, et un refus
  muet laisserait le modèle croire à une copie. Pour une ressource créée sans
  nom (défaut `resource`), passer un `name` explicite avec extension — la
  skill système le prescrit. `description`
  **obligatoire** (le point de la promotion depuis le contexte est que le
  contenu est déjà lu — pas de résumé de ce contenu, une description de ce
  que le fichier EST, cf. `docs/spaces.md`) ; `name` optionnel
  (défaut : nom du fichier d'origine). Handler **asynchrone** (copie via
  `storeLibraryFile`, resources.js, IDB) : validation des paramètres extraite
  en fonction PURE `validateFilesPromoteArgs` (tools.js) car un handler async
  renvoie toujours un thenable — même sur un retour anticipé avant tout
  `await` — donc jamais résolu synchrone par `callTool` sous QuickJS ; la
  validation doit être testée séparément (cf. `tests/test-tools.js`). C'est
  elle qui porte la **décision de famille** (`classifyHandleRef`), le handler
  ne faisant plus que le lookup.
  Résolution du record par `resolveHandleRecord` (source de vérité unique
  handle → record, partagée avec `js__eval` et l'inflation docs), **jamais**
  un `getCachedRecordByAttId` réécrit sur place : l'herméticité (piège 18)
  est héritée gratuitement, le cache session étant lui-même le filtre.
  `ref` inconnu/périmé → « Fichier introuvable. » (même posture no-oracle que
  `files__read`). Copie = nouveau record `kind:'library'`, `source =
  currentConvId` (provenance) ; l'attachment ou la ressource d'origine reste
  intact (D2 semantics). Pousse un ack `file_promote` (informatif, **pas
  d'undo** — la promotion est déjà consent-gated en amont, un undo confondrait
  consentement et réversibilité).
- **Consentement — voie B, PAS de généralisation du halting (décision Cbis-4,
  revient sur l'audit §5 après relecture du mécanisme réel).** `files__promote`
  n'est **jamais** un outil halting : `toolIsHalting` reste câblé
  exclusivement sur `ask_confirmation`, aucune modification du primitif
  partagé. Le gate est **doctrinal** : il prescrit au modèle d'appeler
  `ask_confirmation` avec un récapitulatif (nom, type, taille, description
  proposée) **avant** tout appel à `files__promote`, puis de rappeler avec le
  **même** `ref`/`description` sur confirmation positive — exactement le
  patron déjà éprouvé pour `memory__create` sur le chemin inféré mémoire (le
  modèle rappelle un AUTRE outil après le « Oui », jamais lui-même). Depuis
  l'extraction en skill système (cf. `docs/skills.md` §8), le corps complet de
  cette doctrine vit dans `src/system-skills/files-promote.md` — `FILES_DOCTRINE`
  (tools.js, toujours partie inconditionnelle de `ROOT_SYSTEM_PROMPT`, comme
  `MEMORY_DOCTRINE`) ne garde plus qu'un pointeur court vers
  `miaou__skills__read('files-promote')`.
  **Consentement conditionnel (lot V)** : le gate ne couvre que les promotions
  dont le modèle prend l'initiative. Si l'utilisateur vient de demander le
  dépôt explicitement, la demande vaut consentement et le modèle appelle
  directement `files__promote` — la skill système distingue les deux cas.
  Voir `docs/spaces.md`.
  Pourquoi la voie A (généraliser `toolIsHalting`, `files__promote` lui-même
  halting-puis-exécutant) a été écartée : elle aurait introduit un patron
  inédit — aucun outil existant ne s'auto-rappelle en mode
  halting-puis-exécutant — sur un primitif partagé avec `ask_confirmation`/les
  skills, pour un gain de robustesse marginal (le gate doctrinal est déjà le
  modèle de confiance accepté pour `memory__create`). Conséquence assumée : rien
  n'empêche techniquement un modèle indiscipliné d'appeler `files__promote`
  sans passer par `ask_confirmation` au préalable — le gate n'est pas un
  verrou, c'est une doctrine, comme pour la mémoire inférée.

**Confirmation avant écriture (chemin inféré — fait non explicitement demandé) :**
- `ask_confirmation(question)` — outil **halting** : `runConversation` s'arrête
  immédiatement après, sans pousser de message `tool`/`tool_result` natif. La
  question (+ lead-in éventuel) est réécrite en message assistant texte clair
  (fork B). La reprise se fait au tour suivant via la réponse utilisateur
  (« Oui » / « Non » / correction libre), qui est un message user ordinaire.

**Compute sandboxé sur un blob client (lot L, `js__eval`) :**
- `js__eval(input_handles, code, output_handle?)` — exécute du JavaScript **écrit par le modèle** dans
  un bac à sable **QuickJS-WASM** sur le contenu **textuel** d'**une à
  `JS_EVAL_MAX_INPUTS` ressources** (lot L-2), chacune référencée par handle
  (`att-N` / `file-<id>` / `res_<id>`) sous une **clé choisie par le modèle**,
  **sans jamais charger les octets bruts dans le contexte du modèle**. Cas
  d'usage : interroger un gros fichier (log, JSON-lines, CSV, texte volumineux) —
  compter, filtrer, agréger, extraire un sous-ensemble — quand le lire en entier
  serait inutile ou impossible ; et, depuis L-2, **croiser plusieurs ressources**
  dans une même exécution (jointure de deux résultats d'outils, comparaison de
  deux versions). Un `res_<id>` peut désormais provenir de `docs__extract` (lot M,
  cf. `docs/mcp.md` point 13bis) : le texte complet d'un membre de zip, transféré
  par le canal binaire mais stocké en classe `'inline'` — `js__eval` ne
  distingue pas cette provenance de `web__fetch_resource`, la décode identique. Handler **asynchrone** (lazy-load de l'engine + exécution VM) →
  renvoie une `Promise<string>` mappée par `callInternalTool` (précédent
  `skills__read`). Contrôles synchrones d'abord (forme de
  `input_handles` — objet non vide, non tableau, ≤ `JS_EVAL_MAX_INPUTS` clés —,
  `code` manquant → messages d'erreur testables QuickJS) ; puis, **par clé** et
  dans l'ordre d'insertion, `classifyHandleRef` / `resolveHandleRecord` (impur,
  cache session → herméticité piège 18, handle hors-scope = « introuvable », pas
  d'oracle) / `utf8Decode(record.data)` (contenu textuel, AL3), agrégés dans un
  objet `texts` passé à `runInQuickJs(texts, code)`.
- **Entrée : `input_handles`, objet de handles nommés (lot L-2).** L'`inputSchema`
  déclare `input_handles` et `code` requis. `input_handles` est un **objet**
  `{clé: handle}` de **1 à `JS_EVAL_MAX_INPUTS`** (= 4) entrées ; la clé porte
  l'intention du modèle (« quelle ressource je croise avec quelle autre ») et
  c'est elle qu'il réutilise dans son code (`text("clé")`), pas le handle.
  Renversement **assumé** du YAGNI posé au lot L et réaffirmé au lot Y (« un seul
  handle d'entrée, le modèle itère ») : le cas qui l'invalide est arrivé — deux
  gros JSON obtenus par deux outils différents, impossibles à **croiser** sans
  faire transiter l'un des deux par le contexte, c'est-à-dire exactement ce que
  `js__eval` existe pour éviter. Pas de forme scalaire conservée en parallèle
  (breaking change assumé) : deux syntaxes seraient deux choses à documenter au
  modèle, et une clé obligatoire même à une seule ressource garde une seule
  grammaire d'appel. Le modèle ne fournit **jamais** le contenu ni un chemin : le
  contenu vient des primitives guest. Le paramètre **optionnel** `output_handle`
  (lot Y) est une ressource de **sortie**, indépendante des entrées — rien
  n'interdit qu'un handle soit à la fois lu en entrée et écrit en sortie (relire
  un CSV commencé pour savoir où reprendre est un usage légitime).
- **Refus TOTAL sur clé fautive.** La **première** clé dont le handle est vide,
  malformé (`classifyHandleRef` → `null`) ou non résoluble arrête l'appel **avant
  tout `runInQuickJs`** ; le message **nomme la clé** (et le handle qu'elle
  portait). Pas d'exécution partielle : un code écrit pour croiser deux
  ressources et n'en recevant qu'une produirait un résultat faux d'apparence
  valide — bien pire qu'un refus. Même doctrine que le refus de cap en sortie.
- **Surface guest FERMÉE** (`JS_EVAL_GUEST_PRELUDE`, tools.js) : quatre primitives
  de **lecture** définies en **JS pur côté guest** au-dessus d'UNE seule host
  function `__miaou_text(key)` (le seul pont host→guest d'entrée) — `text(key)`
  (contenu entier), `lines(key)` (découpe sur `\n`, miroir de `splitLines`),
  `jsonLines(key)` (une ligne JSON parsée par élément, lignes vides/invalides
  ignorées), `parse(key)` (document JSON entier). Le lot L-2 a **élargi la
  signature** de cette host function (un argument `key`), **jamais ajouté une
  seconde** : le compte de `ctx.newFunction` dans `runInQuickJs` reste à **deux**,
  et un test le garde (piège 25). La clé est **obligatoire**, y compris à une
  seule ressource ; la mémoïsation guest passe du scalaire `__t` à un objet
  indexé par clé (chaque ressource n'est marshalée qu'une fois, même relue
  plusieurs fois). Une clé absente de `input_handles` lève une **exception
  catchable côté guest** — protocole `{ error: ctx.newError(...) }` de
  quickjs-emscripten (`ctx.throwError` n'existe pas en 0.32.0, vérifié en spike
  sur la version gelée) — jamais un `undefined` silencieux. Plus les globals JS standard. **RIEN d'autre** : ni
  `fetch`, ni réseau, ni DOM, ni `globalThis` hôte. Discipline de marshaling : une
  seule valeur traverse (la string), tout le reste est du JS guest — pas de
  marshaling manuel de tableaux/objets (coûteux, source de fuites de handles).
  Depuis le lot Y, une **cinquième** primitive, `emit(chunk)`, s'ajoute à cette
  liste — la seule d'**écriture**, et la seule addition à la surface fermée du
  piège 25 (cf. « Écriture incrémentale » plus bas).
- **Trois guards** (`runInQuickJs`, tools.js, dispose de tous les handles en
  `try/finally`) : `setInterruptHandler` wall-time (timeout `JS_EVAL_TIMEOUT_MS`
  = 10 s → boucle infinie tuée ; 2 s à l'origine, puis 5 s après qu'un
  `split('\n')` + regex + agrégation sur un log de 21 Mo réel a dépassé 2 s,
  puis 10 s au lot V-1 quand le cap d'entrée a doublé), `setMemoryLimit`
  (`JS_EVAL_MEM_BYTES` = 256 Mo, contrepartie aval de `MAX_INLINE_BYTES`
  (utils.js) = 64 Mo — les deux portées ensemble au lot V-1, un test d'ancrage
  sur la source réelle garde le rapport ≥ 4× →
  OOM catchable, tab intact), et cap de sortie `JS_EVAL_OUTPUT_CAP` = 20000 chars
  appliqué **après** dump via `checkOutputCap` (utils.js, pure).
- **Refus, pas troncature (§3).** Sortie > cap → **message de refus explicite**
  renvoyé comme tool result texte **non-erreur** (pas `isError`, pour que le
  modèle re-cible dans le même tour, borné par `MAX_TOURS`) : « ta sortie fait N
  chars > cap M, réduis-la (compte/top-N/échantillon) ». Throw guest / timeout /
  OOM → également un result texte cadré (« erreur d'exécution … vérifie ton
  code »), pas `isError`.
- **Ack `js_eval`** poussé **après résolution** (pattern `skills__read`) :
  `{ kind:'js_eval', inputHandles, ok, outLen, code }` — `inputHandles` est l'objet
  `{clé: handle}` **brut** (lot L-2, remplace le `handle` scalaire du lot L) : la
  mise en forme est un problème d'affichage, pas de collecte. Informatif, **pas
  d'undo** (pur compute, aucune écriture d'état). La ligne de thread annonce
  seulement les entrées **résumées** par `jsEvalHandlesSummary` (utils.js, pure —
  handle nu à une clé, « N ressources (clés…) » au-delà ; partagée avec les
  exports, jamais réécrite localement) et l'issue (`ICON_CODE`) — **le code exécuté n'est PAS rendu dans le thread**
  (brief §3 : la doctrine no-silent-action vise les écritures d'état inférées, pas
  le compute pur). Le `code` n'est capté que **dans l'ack, pour l'export**
  (`formatToolAcksHtml`/`_formatToolCallMd`, champ `code` rendu COMPLET, non
  tronqué contrairement aux args). Les **deux** formats d'export énumèrent en
  revanche les entrées **clé par clé** (`clé=handle`) là où le thread live les
  résume : un export est une archive, son lecteur doit pouvoir rattacher chaque
  clé du code à son handle. Champs dans `ACK_COPY_FIELDS` (utils.js) :
  `inputHandles` y a été **ajouté** sans retirer `handle`, toujours porté par les
  acks `docs_list`/`docs_read` — la whitelist est partagée entre kinds.
- **Sécurité — parenté piège 23 (iframe sandbox), nouveau piège CLAUDE.md.** Le
  monde guest est **clos** : surface vide par défaut, on n'injecte QUE
  `__miaou_text` (élargi à un argument au lot L-2, pas dédoublé) + le prélude. **Ne JAMAIS** y injecter `fetch`, un accès DOM, un
  pont vers le host au-delà des primitives énumérées, ni ré-exposer `globalThis`
  hôte — l'équivalent QuickJS du « jamais `allow-same-origin` ». Le `code` est
  d'origine **modèle** : dans l'export (`_formatToolCallHtml`), `escHtml` est
  impératif (exception piège 21). Depuis L-2, les **clés** de `input_handles` le
  sont aussi (le modèle les écrit) : chaque fragment clé et handle passe par
  `escHtml` **individuellement**, jamais une concaténation échappée après coup. L'engine est chargé en lazy-load calqué sur
  Mermaid (`ensureQuickJs`, ui.js — promesse mémoïsée, reset-on-reject) mais
  l'échec CDN **ne se dégrade PAS en silence** : il se propage en erreur d'outil
  propre (un compute demandé qui ne peut tourner doit le dire). Artefact figé :
  `quickjs-emscripten@0.32.0/dist/index.global.min.js` (IIFE `window.QJS`, WASM
  `RELEASE_SYNC` inliné, un seul `<script src>` — spike L0, cf. `AUDIT-L.md`).
- **Guidage des modèles — pièges du mode global (skill système `js-eval`, ex-
  `JS_EVAL_DOCTRINE`).** Le code modèle est évalué en **mode global** (pas dans
  une fonction — l'enveloppe IIFE a été retirée car elle supprimait la
  completion-value). Ce mode expose trois pièges que des modèles moins solides
  déclenchent en boucle (constaté sur des exports réels : mistral tâtonnait ~10
  tours là où gemma4 réussissait du premier coup) — c'est de la **doctrine**,
  jamais un changement du harnais d'évaluation (fragile, cf. bug IIFE) :
  1. **Collision de noms** — `const lines = lines()` → `invalid redefinition of
     global identifier` (les primitives sont des globals). La skill liste les
     quatre noms réservés ; `_jsEvalErrText` **accole en plus un hint** au message
     d'erreur brut (qui ne nomme ni l'identifiant ni la cause).
  2. **Objet nu final** — `{ a: 1 }` en dernière ligne est lu comme un **bloc**, pas
     une valeur → `expecting ';'`. La skill impose `JSON.stringify({…})` ou
     `({…})` (ce que gemma4 fait spontanément).
  3. **ASI** — instructions sans point-virgule + `const` en mode global →
     `ReferenceError: X is not initialized`. La skill réclame les points-virgules.
  La skill incite aussi à **enchaîner plusieurs petits appels** (inspecter puis
  cibler) plutôt qu'un gros script unique, et à ne PAS raccourcir vers un one-liner
  (contre-productif : le problème n'est jamais la longueur mais la forme du retour).
  C'est pourquoi `MAX_TOURS` (api.js) est passé de 20 à 40, puis **de 40 à 100**
  (2026-09) : un usage sain de `js__eval` consomme légitimement beaucoup de
  tours, et le plafond de 40 était atteint **fréquemment** en usage quotidien
  intensif — à ce stade la borne ne protège plus d'une boucle folle, elle coupe
  du travail en cours.
  Depuis l'extraction en skill système (cf. `docs/skills.md` §8), ce guidage
  (le COMMENT) vit dans `src/system-skills/js-eval.md` ; `JS_EVAL_DOCTRINE`
  (tools.js) ne garde que le QUAND (cas d'usage, fallback `docs__read`, cap de
  sortie chiffré) et un pointeur `miaou__skills__read('js-eval')` — décision
  volontaire d'invalider une fois le préfixe KV cache (piège 16) en réduisant
  cette doctrine, la plus grosse des sept de `ROOT_SYSTEM_PROMPT`, jugée plus
  coûteuse à garder entière sur chaque tour qu'à payer une fois l'invalidation.

**Matérialisation de ressource model-side (lot O, étendue au lot Y) :**
- `resource__create(content, name?, mime?)` — le modèle range un texte qu'il
  fournit **directement dans l'appel** en ressource `res_…` classe `'inline'`,
  via `_storeBlock` (brique existante depuis les lots K/L/M, rien de neuf côté
  stockage). Handler asynchrone : `validateResourceCreateArgs` (tools.js, pure,
  testable QuickJS malgré le handler async — même motif que
  `validateFilesPromoteArgs`) vérifie `content` non vide en amont, le site de
  sortie pousse l'échec via `toolFail` (non-`isError`, cf. section acks). Succès
  → renvoie **toujours** `formatInlineHandleForModel(id, mime, record)` — jamais
  `_makeResourceRef`/`[resource_ref:…]` : ce marqueur, résolu par
  `assembleToolResultForModel` en `utf8Decode(data)` au tour suivant pour un
  record `'inline'`, ré-inlinerait tout le contenu dans le contexte (le piège
  `resource_ref` payé au lot M, ~5,6M tokens fantômes). L'ack `resource_stored`
  est déjà poussé par `_storeBlock`, aucun ack supplémentaire à câbler ici.
- `resource__from_result(ref, description, name?)` (lot O-2) — convertit un
  **résultat d'outil déjà présent dans l'historique** en ressource `res_…`
  `'inline'`, ET **allège le contexte** : le gros contenu quitte l'historique,
  remplacé par le handle compact + la `description` (résumé fourni par le modèle,
  qui a lu le contenu). Deux outils distincts plutôt qu'un seul bimodal :
  `content` (mode libre) et `ref` vers un tool result passé sont deux paramètres
  dont la présence s'exclut, contrainte que JSON Schema ne porte pas nativement ;
  deux `inputSchema` pleinement contraints (`resource__from_result` requiert `ref`
  ET `description`, sans condition) évitent ce trou de validation et lèvent
  l'ambiguïté pour des modèles qui tâtonnent déjà sur la forme (`js__eval`
  ci-dessus). Mécanique :
  - **Adressage `[call:…]`** : `expandThread` (utils.js) préfixe le `content` de
    chaque tool result réinjecté par `formatCallMarker(id)` = `[call:<id>]\n`, où
    `<id>` est le `tool_call_id` déjà dérivé (`_hashId9(prefix + '\x00' + k)`).
    Byte-stable → coût KV **permanent et constant** (le marqueur grossit le
    préfixe d'un montant fixe sur TOUS les tours à outils, sans l'invalider),
    distinct de l'invalidation ponctuelle de la conversion (ci-dessous). Ce
    marqueur est ajouté **à l'émission uniquement**, jamais stocké dans l'ack.
  - **Source unique de dérivation** : `enrichedAckGroups(thread)` (utils.js, pure)
    regroupe les acks enrichis et dérive les ids ; `expandThread` (émission) ET
    `findAckByCallId` (résolution) la consomment — jamais deux formules, sinon
    dérive de ciblage muette. `findAckByCallId(thread, callId)` accepte le hash
    nu ou la forme `[call:…]`, renvoie `{ ack, group, k, callId }` ou `null`.
    Le `prefix` de `_hashId9` est la valeur de `group` (source api.js, unique
    par tour) pour les acks groupés, et `solo:<start>` (index du groupe dans le
    thread) pour les acks **« solo » legacy** sans `group` — d'avant le
    groupement. Le préfixe positionnel garantit un id distinct par ack solo dans
    un même fil (un préfixe `'solo'` constant les faisait tous collisionner :
    `tool_call_id` dupliqués côté payload, `findAckByCallId` renvoyant le premier
    match, donc réécriture du mauvais ack). Il change les ids émis pour ces
    vieux threads : marqueurs `[call:]` **non persistés** (pas de casse de
    données), seule invalidation = le KV cache de ces fils, une fois.
  - **Réentrance** (mémoire `await_reentrancy_guard`) : la cible est résolue et
    gelée AVANT l'`await _storeBlock`, puis **re-résolue APRÈS** ; si la cible a
    disparu (suppression/navigation concurrente) ou est déjà un handle, on ne
    réécrit pas mais on renvoie quand même le handle (la ressource est valide —
    dégradation propre).
  - **Idempotence** : `isInlineHandleResult(result)` détecte qu'un `result` est
    déjà une sortie de `formatInlineHandleForModel` → refus propre via `toolFail`
    (« Ce résultat est déjà une ressource. »), pas de double matérialisation.
  - **Réécriture d'historique** : le SEUL champ muté est `entry.result` de l'ack
    ciblé (= `handle + ' — ' + description`) ; `result` est déjà dans
    `ACK_COPY_FIELDS`, rien à whitelister. `persistCurrent()` durabilise et émet
    `conv-updated` post-commit (piège 24, via `saveConversation`). Le **rendu UI**
    de l'ack d'origine ne lit pas `result` (kinds `mcp_call`/`files_read`/…
    rendent depuis `intent`/breadcrumb/titre) → inchangé. Sûreté anti-`resource_ref`
    identique à `resource__create` : **toujours** `formatInlineHandleForModel`,
    jamais `_makeResourceRef`.
  - **Type de contenu** : `internResourcesFromResult` tourne AVANT
    `flattenToolResult` (api.js) — un blob binaire est déjà un handle dans
    `entry.result`, donc la conversion ne rencontre que du **texte aplati** (le
    cas visé : gros `fetch_url`/`docs__read`). Aucune garde de type à ajouter.
- **Doctrine `RESOURCE_DOCTRINE`** (tools.js, inconditionnelle comme
  `JS_EVAL_DOCTRINE`) : porte le QUAND commun aux **trois** outils —
  `resource__create` pour un texte que le modèle vient de produire/recomposer,
  `resource__from_result` pour un tool result déjà en contexte qui l'encombre,
  `resource__append` (lot Y) pour prolonger une ressource déjà créée. Posée dès
  le commit de `resource__create` en couvrant DÉJÀ le second outil (pas encore
  livré) : le texte de doctrine est stable, évite une deuxième invalidation du
  préfixe KV cache (piège 16) à l'arrivée de `resource__from_result`. La clause
  `resource__append` est la **seconde** invalidation ponctuelle de ce bloc,
  assumée pour la même raison qu'à l'origine : une clause de plus dans le bloc
  existant, jamais un deuxième bloc doctrinal. Le QUOI de chaque outil (dont le
  renvoi vers `js__eval` pour l'exploitation du handle) reste dans sa propre
  description, pas dans la doctrine — pas de duplication.

### Écriture incrémentale d'une ressource (lot Y)

`resource__create` est *create-only* (tout le contenu en un appel) et le seul
retour de `js__eval` est une string bornée par `JS_EVAL_OUTPUT_CAP`. Un modèle
qui devait **produire** un gros contenu par morceaux n'avait donc qu'une voie :
relire et réécrire l'intégralité à chaque étape — O(n²) caractères transmis sur
n étapes. Le lot Y ouvre la voie manquante, sous deux formes qui partagent la
même primitive de stockage.

- `resource__append(id, content)` — ajoute `content` **à la fin** d'une ressource
  `res_…` existante. `id` et `content` requis, ni `mime` ni `name` (le record
  existe déjà) : outil séparé plutôt qu'un mode de `resource__create`, pour la
  même raison qu'au lot O — les formes de paramètres divergent, et deux
  `inputSchema` pleinement contraints valent mieux qu'une exclusivité que JSON
  Schema ne sait pas exprimer. Retourne le handle **inchangé** (via
  `formatInlineHandleForModel`, jamais `_makeResourceRef` — piège du lot M) suivi
  du nombre de caractères ajoutés.
- **Garde de famille** — `resource__append` n'accepte que la famille `resource`
  (`classifyHandleRef(id) !== 'resource'` → refus). `att-N` et `file-<id>` sont
  refusés **au niveau du schéma** (`validateResourceAppendArgs`, pure, testée) :
  ce ne sont pas des records `_storeBlock`, leur cycle de vie diffère (une pièce
  jointe est figée, un fichier de bibliothèque est un dépôt utilisateur), et les
  accepter pour échouer plus profond serait moins clair qu'un refus nommant le
  format attendu.
- **Shape de stockage : read-concat-rewrite, pas d'append en place.** Le store
  IDB `resources` n'offre aucun patch partiel (`putResource` fait un `put`
  intégral, `record.data` est un `ArrayBuffer` entier) — le coût est donc
  O(taille totale) par appel, **assumé** : le gain visé est le contexte du modèle
  (ne pas repayer le déjà-écrit en tokens), pas le coût de stockage local.
- **Noyau pur / wrapper impur** (`resources.js`) : `appendTextToRecord(record,
  extraText, cap?)` porte le décodage/concaténation/réencodage ET la garde de
  taille, sans IDB, donc testable en QuickJS (motif
  `project_extract_pure_helper_over_idb_stub`) ; elle rend un **nouvel** objet
  record, sans muter l'entrée. `_appendBlock(id, extraText)` en est le wrapper
  impur (lecture du cache session, `putResource`, `_cacheRecord`,
  `requestPersistence`, ack `resource_appended`). Le `cap` injectable n'existe
  que pour les tests ; aucun appelant de production ne le passe.
- **Garde d'entrée vs capacité aval** : le plafond de l'append est
  `MAX_INLINE_BYTES` — le même que celui du blob adressable par `js__eval`. Sans
  lui, des appends répétés fabriqueraient une ressource que l'outil aval
  refuserait de lire. Le dépassement est un **refus explicite**, jamais une
  troncature, et il est vérifié **avant** de matérialiser les octets (le contrôle
  porte sur des tailles).
- **`js__eval(handle, code, output_handle?)` + `emit(chunk)`** — quand
  `output_handle` (un `res_…` créé au préalable par `resource__create`) est
  fourni, la cinquième primitive guest devient disponible et écrit dans cette
  ressource au fil du calcul. La cible est **explicite**, jamais créée
  implicitement par le guest : les décisions de cycle de vie (`mime`, `name`)
  n'ont pas leur place dans du code modèle, et l'entrée suit déjà cette forme
  (un handle, pas « crée-moi quelque chose à lire »).
- **Pont dédié, jamais une extension de `__miaou_text`** (piège 25) : `emit` est
  bâti sur une **seconde** host function, `__miaou_emit`, posée par un
  `ctx.newFunction` distinct et disposée dans le même `try/finally`. Le pont
  d'entrée reste ce qu'il était ; on en ouvre un second, explicitement, pour la
  sortie. Aucun autre pont — un test compte les `ctx.newFunction` de
  `runInQuickJs` pour que l'ajout d'un troisième ne passe pas inaperçu.
- **Bufferisation HOST-side, jamais guest-side.** Chaque `emit(chunk)` marshale
  immédiatement le chunk vers un tableau JS **local à l'appel** (jamais un état
  de module : deux générations concurrentes peuvent exécuter du `js__eval` en
  parallèle, piège 28) ; rien ne s'accumule dans la VM, dont la mémoire est
  bornée par `JS_EVAL_MEM_BYTES` et déjà partagée avec le texte d'entrée — y
  accumuler la sortie recréerait le plafond que la feature existe pour lever. Le
  buffer part ensuite en **un seul** `_appendBlock` : un append par `emit()`
  redonnerait le O(n²) qu'on corrige, simplement déplacé côté host.
- **`runInQuickJs` ne touche pas au stockage.** Elle rend le buffer tel quel dans
  `emitted` ; c'est le handler `js__eval` qui décide d'écrire. La VM reste de la
  plomberie sans dépendance IDB.
- **Flush INCONDITIONNEL** : `emitted` est renseigné sur **tous** les chemins de
  retour — succès, refus de cap, throw guest, timeout, OOM — et le handler écrit
  dans tous les cas. Ce n'est pas une troncature déguisée : la doctrine « refus
  explicite, pas troncature » porte sur le **canal de retour**, pas sur du
  travail déjà produit. 900 lignes émises avant un timeout valent mieux que rien.
- **Écriture partielle : dite au modèle ET à l'utilisateur.** Le flush crée un
  état qu'il faut signaler des deux côtés, sinon on livre en silence un fichier
  qui s'arrête au milieu. Côté modèle, le result texte dit que la ressource est
  **incomplète** et l'invite à la relire avant de reprendre (pas seulement « N
  caractères ajoutés », qui se lit comme un succès). Côté utilisateur, l'ack
  `resource_appended` porte `ok: false` → `ackIsError` le rend rouge, et son
  libellé ajoute « interrompu » **sans retirer** le décompte — contrairement au
  « (refusé) » de `js_eval`/`docs_pack` qui remplace la queue informative : ici
  ce qui a été écrit avant l'interruption est précisément ce qui a été **sauvé**,
  l'effacer cacherait l'information utile. Aucun mécanisme neuf : `ok` était déjà
  dans `ACK_COPY_FIELDS` et `ackIsError` ne branche jamais par `kind`.
- **`ok: false` ne veut pas dire « l'écriture a échoué ».** `_appendBlock` est
  atomique — il écrit tout le buffer ou rien. Ce qui est partiel est le **calcul**
  qui l'a produit. D'où la garde qui compte : `partial` vaut
  `!r.ok && r.reason === 'error'`, **jamais** `!r.ok`. Un refus de cap
  (`reason: 'cap'`) signifie que le code est allé au bout et que seul le retour
  texte a été refusé : l'écriture est **complète**, et la peindre en rouge serait
  un faux positif. Seul l'appelant connaît cette distinction, d'où le paramètre
  passé à `_appendBlock` plutôt qu'une déduction locale.
- **`emit` absent quand `output_handle` l'est.** La primitive n'est PAS définie
  dans le prélude sans handle de sortie : un `ReferenceError: 'emit' is not
  defined` remonte au modèle par le chemin d'erreur guest normal et lui dit
  exactement ce qui manque. Une primitive toujours présente mais no-op
  documenterait un comportement muet qui inviterait à l'appeler sans handle, et
  perdrait le travail en silence. Le prélude `emit` vit donc dans une constante
  **séparée** (`JS_EVAL_EMIT_PRELUDE`), concaténée conditionnellement.
- **`readOnlyHint: false` inconditionnel sur `js__eval`** — l'outil écrit dès
  qu'un `output_handle` est fourni. JSON Schema ne sait pas conditionner une
  annotation à la présence d'un paramètre optionnel, et un hint qui **ment** dans
  un mode d'usage réel est pire qu'un hint légèrement pessimiste dans l'autre.
  L'annotation était `true` depuis le lot L ; c'est une correction, pas un choix
  nouveau.
- **`output_handle` validé AVANT l'exécution** : famille + existence, mêmes
  gardes que `resource__append`. Un handle de sortie invalide échoue sans faire
  calculer la VM pour rien, et sans exposer un `emit()` qui n'aurait nulle part
  où écrire.
- **Adressage par ID DE RECORD, jamais par le handle.** `_appendBlock` reçoit
  `record.id` (le résultat de `resolveHandleRecord`), pas la chaîne fournie par
  le modèle : dans un agent, un `res_…` peut être un **alias** délégué au spawn
  (`resolveDelegatedRecordId`, lot X-1b) qui n'est l'id d'aucun record — le
  relire par handle échouerait. `resolveHandleRecord` reste le résolveur unique
  et c'est **son résultat** qui adresse l'écriture.
- **Agents : déléguer, c'est confier** (décision Julien, 2026-08-31). La table de
  délégation figée au spawn ouvrait un droit de **lecture** sur les ressources
  que le parent a nommées ; depuis le lot Y elle ouvre du même geste un droit
  d'**écriture** — un agent peut `resource__append`/`emit` dans une ressource
  déléguée, et l'écriture atterrit dans le record du parent. Ce n'est pas un
  élargissement de scope : `agentDelegatedFilesOf` rend `[]` pour toute
  conversation racine, et la table ne contient que ce que le parent a
  explicitement nommé — un alias non délégué reste « introuvable ». Aucun code
  de délégation n'a été modifié par le lot Y ; le comportement est celui dont
  l'append hérite en passant par `resolveHandleRecord`.
- **Ack `resource_appended`** (poussé par `_appendBlock`) : parallèle à
  `resource_stored`, informatif, sans undo, même icône (`ICON_PACKAGE` — c'est la
  même métaphore « ranger dans une ressource », l'action se distingue par le
  libellé). Porte `appendedLen` (caractères **ajoutés**) ET `size` (total après
  ajout) : seul le couple dit ce qui vient de se passer. C'est le **seul** ack de
  l'appel — d'où son entrée dans `ackDownloadTarget`, sans laquelle la ressource
  complétée n'aurait aucune affordance de téléchargement (contrairement à
  `docs__pack`/`docs__extract`, qui laissent `_storeBlock` pousser un
  `resource_stored` porteur du bouton). L'ack `js_eval` d'un run avec
  `output_handle` gagne `outputHandle` et `appendedLen` ; les trois champs sont
  dans `ACK_COPY_FIELDS`, jamais recopiés à la main.

**Ouverture native de documents (lot V, `docs__*`) :**
- `docs__list(ref)` — structure d'un document (membres d'archive, pages et
  sommaire d'un PDF, feuilles d'un classeur, sections d'un document Word, slides
  d'une présentation), **sans en rendre le contenu**.
- `docs__extract(ref, path)` — matérialise **un** membre d'archive en ressource
  `res_…` adressable par `js__eval`.
- `docs__read(ref, selector, as_resource?)` — lecture **par unité** d'un PDF,
  d'un classeur, d'un document Word ou d'une présentation.
- `docs__render_page(ref, page)` — rend **une** page de PDF en image et la montre
  au modèle, pour qu'il la lise avec sa vision (page scannée, OCR trop abîmé,
  schéma ou graphique). Ce n'est pas de l'OCR : MIAOU rend, le modèle lit.
- `docs__pack(refs, name?)` — agrège N ressources en **une** archive zip
  téléchargeable.

**Le détail est dans `docs/documents.md`** : formats et artefacts CDN, versions
gelées, forme des selectors par format, caps de lecture, table `DOC_READERS`,
descripteurs de bibliothèque, et la ligne de partage `docs.js` / `utils.js`
(lot V-7).

## Agents (`agent__*`, lot X-1)

Quatre outils — `agent__spawn`, `agent__status`, `agent__result`, `agent__abort`
— qui permettent au modèle de confier une tâche à une sous-conversation
autonome. Ils partagent une **garde de parenté unique** (`resolveOwnedAgent`,
agents.js), également consommée par la branche agent de `conv__get` : un agent
d'une autre conversation répond **exactement** comme un id inexistant, sans
oracle.

`toolDefinitions(allow, ctx)` a gagné deux paramètres à cette occasion : une
**liste blanche** qui restreint le payload d'un agent aux seuls outils délégués
(ils sont **absents** de `body.tools`, pas « appelables et refusés » —
`ask_confirmation` compris), et un `ctx` pour les descriptions dynamiques. La
description d'`agent__spawn` est construite à chaque appel parce qu'elle annonce
le niveau de raisonnement courant comme défaut ; ce défaut et son application
côté handler viennent d'**une seule fonction**, `agentDefaultReasoningEffort`.

**La résolution de cette définition dynamique vit dans `exposedTools(ctx)`, pas
dans `toolDefinitions`** (déplacée en X-1e). Dans `TOOLS`, `agent__spawn` porte
`description: ''` et un `inputSchema` vide — sa vraie définition est
`agentSpawnToolDef`. Tant que la substitution se faisait chez l'appelant, le seul
consommateur qui la voyait était le payload modèle : le drawer « Voir les outils
exposés », qui lit `exposedTools()`, affichait `agent__spawn` **sans description
ni paramètre**, comme un outil vide (constat de test Julien, X-1). La fonction
s'appelle `exposedTools` : ce qu'elle rend doit être ce qui est réellement
exposé, pour **tous** ses lecteurs — un consommateur qui doit connaître une
exception pour obtenir la vraie valeur est un consommateur qui l'oubliera.

Doctrine de déclenchement : `AGENT_DOCTRINE`, statique et inconditionnelle dans
`ROOT_SYSTEM_PROMPT` ; mode d'emploi en skill système `agents`. Détail complet :
`docs/agents.md`.

## Acks d'outils côté client (`tool-ack`, ex-`memory-ack`)

Mécanisme **générique** couvrant les écritures mémoire, les lectures d'historique
et les appels MCP distants. Chaque handler traçable pousse un descripteur
`{ kind, … }` dans `_pendingToolAcks` (tools.js) — `kind` ∈ `memory_create |
memory_update | memory_delete | conversation_read | conversation_list | mcp_call |
resource_stored | resource_presented | attachment_recalled |
skill_list | skill_read | skill_write | files_list | files_read | file_promote |
about_read | js_eval | tool_failed`.
Les hooks `onEarlyAcks()` et `onToolAcks()` (main.js) consomment la file via
`getPendingToolAcks` / `clearPendingToolAcks` et injectent des messages
`{ role: 'tool-ack', kind, id?, content?, prevContent?, title?, count?, server?,
name?, error?, resolved?, mime?, size?, attId?, args?, result?, ts?, group?,
assistantText?, intent?, slug?, convId?, message? }` dans `currentThread`.
La whitelist de champs est **unique** : `ACK_COPY_FIELDS` + `copyAckFields`
(utils.js), partagée par les quatre sites de copie (`onToolAcks`/`onEarlyAcks`
dans main.js pour le rendu live, `openConversation`/`persistCurrent` pour la
persistance). Ajouter un champ à un `kind` = **une ligne** dans
`ACK_COPY_FIELDS` — historiquement trois copies manuelles divergentes, un champ
oublié était silencieusement perdu au premier rendu live ou à la première
réouverture (piège payé avec `convId`/`slug`). `error`/`resolved` sont copiés
en sémantique truthy, les autres champs en présence (`!= null`).

Les champs `args` (objet d'arguments), `result` (résultat aplati par
`flattenToolResult`), `ts` (epoch ms de l'appel), `group` (id partagé par
tous les tool_calls d'un même tour modèle) et `assistantText` (texte produit
par le modèle au même tour que les tool_calls, rare) sont **les champs de
réinjection cross-turn** — voir `expandThread` ci-dessous. Ils sont posés
par le hook `onEnrichLastAck` (main.js), appelé après chaque outil par api.js,
et doivent être préservés par `persistCurrent` / `openConversation`.
`intent` (texte de `miaou_intent`) était d'abord réservé à `mcp_call`
(rendu à deux niveaux, cf. `renderLabel`/`renderIntentTwoLevel` ci-dessous) ;
il est désormais capturé pour **tous** les outils internes aussi (`callTool`,
tools.js, branche `miaou`/nue) via `updateLastPendingToolAck` — extrait des
args **avant** le strip de `miaou_intent`, attaché au dernier ack en attente.
Cas particulier : un handler qui pousse son ack **après** résolution d'une
Promise (ex. `skills__read`) ne peut pas être enrichi avant que cette Promise
ne se résolve — `callTool` attend donc cette résolution dans ce cas précis
avant d'attacher `intent`.

Rendu : `mcp_call`, `conversation_list`, `skill_list`, `conversation_read` et
`skill_read` partagent tous le même rendu à deux niveaux quand `m.intent` est
présent — intention en langage naturel (niveau 1, visible) + détail technique
(niveau 2, replié par défaut derrière un chevron `mcp-chevron`), via le helper
`renderIntentTwoLevel(el, intent, detailText, detailBuilder?)` (ui.js). Sans
intent, chaque kind retombe sur son rendu simple d'origine (texte brut ou
breadcrumb direct pour `mcp_call`). La classe `has-intent` (icône alignée en
haut, pas centrée) s'applique dès que `m.intent` est présent, quel que soit
le kind — pas seulement `mcp_call`.
`conversation_read` va plus loin : son détail replié rend le titre de la
conversation sous forme de lien cliquable (`.ack-conv-link`, `onclick =>
openConversation(m.convId)`), donc `convId` doit être renseigné par le
handler (`conv__get`, tools.js) et préservé dans toutes les whitelists
de champs (voir avertissement ci-dessus).

### Téléchargement de la ressource désignée par un ack (lot V)

Quatre kinds d'ack désignent un fichier récupérable : `resource_stored`,
`resource_presented`, `attachment_recalled`, et `resource_appended` (lot Y —
seul ack de son appel, donc porteur du bouton, cf. « Écriture incrémentale »).
Chacun porte un bouton icône
`.ack-dl` placé après le label et avant `undo` (c'est une action sur la **cible**
de l'ack, pas sur l'ack).

**Prédicat unique : `ackDownloadTarget(m)`** (utils.js, pur, testé). Seule source
de vérité de « cet ack désigne-t-il une ressource téléchargeable ? » — ne jamais
réécrire une liste de kinds ailleurs. Il renvoie une **cible typée**, pas un id
nu, parce que les deux familles ne se résolvent pas par la même clé :

| `by` | clé | résolution |
|---|---|---|
| `'resource'` | `id` | cache session, **puis** `getResource` (IDB) |
| `'attachment'` | `attId` + `convId` | `getCachedRecordByAttId` — cache session **seul** |

L'asymétrie est structurelle : il n'existe pas d'accès IDB indexé par `attId`.
Le cache étant peuplé par `loadConversationResources` à l'ouverture de la
conversation, le cas nominal est couvert ; sinon dégradation gracieuse
(`markAckDlUnavailable` : bouton inerte, jamais retiré du DOM — l'ack reste vrai,
la ressource *a* été enregistrée).

**Pourquoi sur l'ack et pas seulement sur le bloc.** Les blocs rendus sous un ack
portaient déjà des affordances de téléchargement (`renderBinaryBlock`, le chrome
de `decoratePre`, la lightbox), mais seulement **quand un bloc est rendu** — ce
qui laissait trois trous : `resource_stored` de classe `inline` (aucun bloc),
`resource_stored` binaire en live (bloc délégué à `placeToolBlocks`), et
`attachment_recalled` non-image. Cas le plus visible : un CSV produit par un
outil part en `store_inline_from_bytes`, dont le bloc est **délibérément retiré**
de la file d'affichage (`retainPendingToolBlocks`, resources.js — on ne veut pas
afficher un blob destiné à `js__eval`). L'ack était alors le seul témoin, sans
aucun moyen de récupérer le fichier. Le bouton sur la ligne d'ack comble ce trou
sans revenir sur cette décision.

**Nommage : `resourceDownloadName(name, mime)`** (utils.js, pur, testé). Le nom
d'une ressource est d'origine **modèle ou outil** — potentiellement vide, absurde
ou sans extension, contrairement à un attachment utilisateur issu d'un vrai
fichier. D'où une extension dérivée du **mime** (`mimeExt`, table `MIME_TO_EXT` +
replis génériques `image/<x>` et `+xml`/`+json`), et non d'un langage de fence
comme `sanitizeDownloadName`/`langExt`. Les deux nommeurs partagent désormais
`sanitizeFileStem` (assainissement sans suffixage) et `hasFileExt` : l'ordre
compte, assainir **avant** de suffixer — sur un nom réduit à des points (`'...'`),
suffixer d'abord produit `'....csv'`, que le strip de points de tête ramène à
`'.csv'`, un fichier caché. Limite assumée : on suit le mime déclaré, donc un CSV
annoncé `text/plain` par le modèle se télécharge en `.txt` (le nom du record
prime s'il porte déjà l'extension).

**Absent des exports** (piège 21) : un HTML standalone n'a ni IDB ni globals
MIAOU. Le bouton est construit dans `buildToolAck` (chemin DOM live) uniquement ;
`formatToolAcksHtml` est inchangée.

### Échecs d'outils : `tool_failed` et `toolFail()`

**Tout échec d'un outil natif pousse un ack.** Un handler qui sort en erreur ne
retourne JAMAIS sa chaîne nue : il passe par `toolFail(toolName, message)`
(tools.js), qui pousse un ack `{ kind: 'tool_failed', name, message, error: true }`
**et** renvoie le message — le site d'appel reste une ligne
(`return toolFail('memory__update', 'Souvenir introuvable.')`).

Le retour est la chaîne **inchangée** : le tool result envoyé au modèle est
byte-identique à ce qu'il était avant l'introduction de ces acks (aucun effet sur
le comportement du modèle ni sur le KV cache). Un ack est une trace **purement
UI** — son contenu n'entre jamais dans le contexte. `toolFail` ajoute le préfixe
`miaou__` en un seul endroit ; les sites d'appel passent le nom **nu** du handler.

Historiquement, ces échecs étaient **totalement invisibles** : le handler faisait
`return 'Souvenir introuvable.'` sans pousser d'ack. Le modèle recevait bien
l'erreur en tool result, mais l'appel n'apparaissait nulle part dans le fil (pas
un ack blanc — *aucun* ack), et il **disparaissait aussi de la réinjection
cross-turn** (`expandThread` ne réinjecte que les acks porteurs d'`args`) : au tour
suivant le modèle ne voyait plus qu'il avait essayé et raté, ce qui l'invitait à
retenter à l'identique. Corollaire réglé au passage : `onEnrichLastAck`
(sans `minLength`) enrichissait alors l'ack de l'outil **précédent** du même tour
avec les `name`/`args`/`result` de l'outil échoué — même famille que le piège B5.

Deux nuances à connaître avant d'ajouter un site d'échec :

- **Échec métier ≠ échec technique.** Les échecs métier (« Souvenir introuvable »)
  ne sont **pas** des `isError` : le modèle doit pouvoir se corriger sans que la
  boucle d'outils soit coupée. Les trois `isError` de `callInternalTool` (outil
  inconnu, throw d'un handler = bug) poussent eux aussi un `tool_failed` — avant,
  le plus anormal était le plus muet : un plantage JS ne laissait aucune trace.
- **Le court-circuit anti-redemande pousse aussi un `tool_failed`.** Quand
  `servedKeys` (api.js, piège n°3) court-circuite un tool_call identique à un
  appel déjà servi dans l'échange, aucun handler ne tourne — donc aucun ack par
  le chemin normal. `pushDuplicateCallAck(name, message)` (tools.js) pousse la
  trace : même forme que `toolFail`, mais `name` arrive déjà canonique (nom
  exact du tool_call, interne ou distant) — pas de préfixe ajouté. api.js
  enchaîne avec `onEnrichLastAck` (args/result/ts/group) pour la fidélité
  reload/export.
- **Échec APRÈS le push d'un ack : marquer, ne pas repousser.** Si le handler a
  déjà poussé son ack métier et échoue ensuite (seul cas actuel : `files__read` sur
  une image, modèle sans vision — le fichier a bien été lu, c'est sa *présentation*
  qui échoue), ne pas appeler `toolFail` (il pousserait un SECOND ack : le fil
  afficherait « fichier lu » puis « échec » pour un unique appel). Marquer l'ack
  existant : `updateLastPendingToolAck({ error: true })` — il vire au rouge en
  gardant sa trace. Même logique pour `js__eval`, dont les échecs d'exécution
  (cap, throw guest) gardent leur ack `js_eval` porteur du code et de `ok: false` ;
  seules ses sorties *précoces* (avant exécution) passent par `toolFail`.

Les **échecs MCP distants** ne passent pas par `toolFail` : ils gardent leur kind
`mcp_call` (avec son breadcrumb) et sont colorés via `error`, posé par
`callRemoteTool`. Dans tous les cas, la couleur est décidée par le prédicat unique
`ackIsError` (voir Rendu ci-dessous).

La table `ACK_KINDS` (ui.js) est **l'unique source de vérité** : par kind,
un `label(m)` (texte brut), une capacité d'annulation `undo` (fonction
`(id) => void`, ou **`null`** = variante informative), une icône SVG statique,
optionnellement `renderLabel(m, labelEl)` pour les kinds nécessitant un rendu DOM
riche (rendu à deux niveaux via `renderIntentTwoLevel`, breadcrumb `<code>` pour
`mcp_call`, lien cliquable pour `conversation_read`), et optionnellement
`expand(m, containerEl)` pour les kinds avec contenu dépliable au clic (chip
« voir »/« masquer » avec rendu paresseux).
`buildToolAck` appelle `spec.renderLabel` si présent, sinon `label.textContent` ;
si `spec.expand` est présent et `!m.resolved`, ajoute le chip expandable.

> **⚠️ `expand` est DORMANT / non branché (audit F, 2026-07-10).** Aucun
> `ACK_SPEC` ne définit `expand:` → le bloc correspondant de `renderAck` (ui.js)
> ne s'exécute **jamais**, les classes `.ack-expand`/`.ack-expand-content` n'ont
> aucun style CSS, et `presentResourceFromChip` (ui.js, le `spec.expand` attendu)
> n'est appelée nulle part. Chaîne à moitié écrite puis jamais câblée, **conservée
> sciemment** comme jalon d'une feature « déplier une ressource stockée depuis son
> ack ». Pour l'activer : poser `expand: presentResourceFromChip` sur le spec
> `resource_stored` ET styler `.ack-expand*`. Ne pas la croire vivante en lisant
> le code.
Ajouter un outil traçable = ajouter une ligne à `ACK_KINDS`, pas toucher au renderer.

- **Rendu** : `buildToolAck(m)` (ui.js) construit en `createElement` + `textContent`
  pour toute donnée modèle (label/title/content) ; `innerHTML` réservé à l'icône
  SVG author-controlled. La classe `ack-error` est ajoutée si **`ackIsError(m)`**
  (utils.js, pure) — prédicat UNIQUE partagé avec les deux exports
  (`_formatToolCallMd`/`_formatToolCallHtml`), qui couvre **deux** signaux jamais
  fusionnés dans l'objet persisté : `m.error === true` (appel MCP distant en
  erreur, posé par `callRemoteTool`) **ou** `m.ok === false` (`js__eval` : refus de
  cap ET plantage guest). Ce second signal existe parce que, côté modèle, ces deux
  cas ne sont volontairement **pas** des `isError` (result texte cadré, pour laisser
  le modèle se re-cibler sans couper la boucle d'outils) : l'échec n'est donc porté
  que par l'ack. Tester `m.error` seul laissait les `js__eval` en échec en blanc ;
  tester `!m.ok` serait un faux positif sur tout ack ne portant pas le champ, d'où
  la comparaison stricte à `false`. L'action « annuler » (kinds undoables uniquement) est liée par
  `addEventListener` → `undoToolAck(entry, wrap)` (main.js), qui dispatche via
  `ACK_KINDS[kind].undo(id, entry)`. Sémantique par kind : **create** →
  `forgetMemory` (retire l'ajout) ; **delete** → `restoreMemory` (lève la
  tombstone) ; **update** → ré-écrit `entry.prevContent` via `editMemory` (l'ancien
  contenu, capturé **avant** l'écrasement par le handler `memory__update` et porté
  dans l'ack, car l'édition est in-place sans tombstone). Si `prevContent` manque
  (ack legacy), l'undo d'une édition est **no-op** — jamais de `forgetMemory` sur
  une édition. `forgetMemory`/`restoreMemory` ignorent le 2ᵉ argument. **Pas de
  lookup par `id`** : un create et un delete du même souvenir partagent `entry.id`,
  donc le handler reçoit l'entrée et le nœud DOM exacts (closure de `buildToolAck`) ;
  `entry.id` ne sert qu'à l'opération mémoire.
- **Placement = provenance, DANS la bulle** : les acks s'affichent à l'intérieur
  de la bulle assistant (`.msg.assistant`, colonne flex), **entre l'en-tête**
  (`.meta` : icône + nom du modèle) **et le corps** (`.body` : patienteur puis
  réponse). Helper unique `placeToolAck(wrap, entry)` (ui.js) : `insertBefore(node,
  wrap.querySelector('.body'))`. Ordre à l'écran : icône+modèle → acks (au fil des tours) →
  patienteur → réponse. `resetAssistant` ne touchant que `.body`, les acks survivent
  à la reprise d'attente entre tours. **Reload** :
  `renderThread` tamponne les acks (qui précèdent l'assistant dans `currentThread`,
  ordre `[user, …acks, assistant]`) et les replace dans la bulle assistant suivante
  via `placeToolAck` ; repli en blocs autonomes s'ils ne précèdent pas un assistant.
- **Repli à deux étages (ticker, brief N) — LIVE-ONLY.** `placeToolAck` route
  chaque nœud `.tool-ack` vers un groupe (`wrap._ackGroup`, ui.js), créé
  paresseusement au 1er ack de la bulle et posé **avant** `.body`, transparent
  tant que `count < 2` (pas de re-parent au franchissement du seuil). État pur
  testable QuickJS : `ackGroupReduce(state, action)` (`arrive` / `toggleMode` /
  `toggleSlot`), dérivées `ackGroupIsCompact`/`ackGroupCount`/`ackGroupVisibleAck`.
  Compact : un slot montre le dernier ack, arrivée animée en ticker vertical
  (`transform: translateY`, jamais de layout) sauf reduced-motion (dry swap).
  Liste : tous les acks empilés (`.ack-list`, rebuild depuis `state.acks` à
  l'ouverture — un ack a pu arriver pendant que le groupe était compact, donc
  jamais append à `.ack-list` sur le moment), chevrons individuels inchangés
  (`renderIntentTwoLevel`). Un seul badge pilule persistant (« N étapes » /
  « ▴ N étapes », `aria-expanded`), toggle animé par agrandissement/repli
  vertical SIMULTANÉS des deux panneaux (`animateGroupPanelSwap`, appelée
  APRÈS `renderAckGroup` — le sortant garde son contenu DOM intact sous
  `hidden`, le mode compact ne vide jamais `.ack-list`) : hauteur du sortant
  mesurée AVANT le re-render, les deux `height` animées dans le même rAF
  (jamais de séquencement repli-puis-agrandissement, qui laissait voir un
  flash de groupe vide). Transition posée seulement pendant l'anim, jamais en
  permanence. Indépendant du ticker, sauté si reduced-motion. Expansion du slot
  (`slotExpanded`) synchronisée par délégation de clic sur `.ack-slot`
  (`renderIntentTwoLevel` garde son toggle DOM self-contained, inchangé) — hérite
  à l'ack suivant sans toucher à `buildToolAck`. `placeToolAck(wrap, entry,
  animate)` : `animate=false` au reload (`renderThread`), pas d'animation pour
  une reconstruction. État **tab-local éphémère**, rien en IDB, rien broadcast
  (lot J) ; export HTML **inchangé** (le repli ne concerne que le rendu live,
  `renderExportBody`/`EXPORT_CSS`/`formatToolAcksHtml` n'y touchent pas). Réglage
  **Animations** associé (`storage.js` `motion`, `'normal'|'reduced'|'system'`) :
  accessor `motionReduced()`, gate `html[data-motion="reduced"]`, même doctrine
  que `data-theme` (jamais `@media` seul).
- **Timing des hooks live.** Les outils internes sont synchrones : leur ack est
  poussé dans `_pendingToolAcks` à l'intérieur du handler, et `onToolAcks()` vide
  la file **après** l'exécution de tous les outils d'un tour. Les outils MCP distants
  sont asynchrones : `callRemoteTool` pousse l'ack **de manière synchrone** (avant
  son premier `await`), puis api.js appelle `onEarlyAcks()` **avant** d'attendre la
  réponse réseau — la ligne d'appel s'affiche **pendant** le round-trip. Après
  l'`await`, si `isError`, `callRemoteTool` pose `ackEntry.error = true` sur le même
  objet ; `onToolAcks()` le détecte et rétro-applique la classe `.ack-error` + remet
  à jour le label DOM. En pratique : `onEarlyAcks` pour les pré-acks MCP ;
  `onToolAcks` pour les acks internes + la mise à jour d'erreur MCP + les blocs D8
  (cf. `docs/mcp.md`).
- **Payload API — `expandThread(currentThread)`** (utils.js, pur, testé QuickJS).
  Remplace l'ancien filtre `!isAckRole`. Acks **enrichis** (champs `args` +
  `result` présents) → expansés en paire `[assistant+tool_calls, tool…]` pour
  réinjecter les résultats d'outils passés dans les tours suivants ; acks
  **legacy** (sans `args`) → élagués comme avant (compat ascendante). Si le
  premier ack d'un groupe porte `assistantText`, le message assistant standalone
  qui le précède immédiatement est absorbé dans le `content` de l'assistant
  expansé pour éviter la duplication. `stampTs(ts, result)` (utils.js) préfixe
  le résultat d'une date absolue immuable pour signaler l'ancienneté au modèle
  sans muter le préfixe d'historique (préserve le KV cache). **Ne jamais**
  recalculer ce stamp à chaque envoi — il est fixé à l'instant de l'appel.
  Le format est **ISO 8601 en heure locale avec offset explicite**
  (`[Résultat du 2026-06-26T14:30+02:00]`, via `isoLocalStamp`/`isoOffset`,
  purs et testés) — **jamais** un horodatage sans zone : le corps du résultat
  vient d'un outil quelconque et peut porter ses propres heures dans un autre
  référentiel (cas payé : un MCP météo annonçant de l'UTC, préfixé d'une heure
  locale muette → le modèle mélangeait les deux). Le préfixe est un canal
  machine→machine, jamais affiché à l'utilisateur : sa lisibilité française n'a
  aucune valeur, son absence d'ambiguïté en a. `isoOffset` **inverse le signe**
  de `getTimezoneOffset()` (qui rend les minutes à soustraire pour obtenir UTC).
  `ask_confirmation` ne produit jamais d'ack (primitif halting) ; rien à exclure.
  Les acks enrichis ne sont jamais envoyés directement au modèle — c'est
  l'expansion qui génère les messages `role:'tool'` correspondants.
- **Compat legacy sans migration** : les entrées `role:'memory-ack'` (champ
  `ackType`) déjà en storage sont reconnues partout (`isAckRole`, `ackKindOf`
  mappe `ackType` → `memory_*`) et **jamais réécrites** (`persistCurrent` /
  `openConversation` re-sérialisent le rôle et `ackType` tels quels). CSS :
  `.memory-ack` reste un alias de `.tool-ack`.
- Survivent au rechargement (sérialisés par `persistCurrent`, restaurés par
  `openConversation`). Traiter comme un journal d'événements immuable, pas un
  miroir de l'état mémoire. Helpers purs `isAckRole` / `ackKindOf` dans utils.js,
  `ackLabel` dans ui.js (testés QuickJS).

### Inspecteur d'appel d'outil (lot Z)

Surface de **consultation** du détail d'un appel : arguments envoyés, résultat
reçu, code exécuté, méta, et la ressource produite. Ouvert par une **loupe**
(`.ack-inspect`, `ICON_INSPECT`) posée sur chaque ack éligible, dans un drawer
`#inspect-drawer` (`.drawer-wide`, 620px).

**Rien n'est collecté par ce lot.** `args`, `result`, `code`, `ts`, `server`,
`intent` sont déjà persistés sur l'entrée par `ACK_COPY_FIELDS` — l'inspecteur
ne fait que présenter ce qui était déjà là, y compris sur des conversations
anciennes. Aucun changement de schéma, aucun effet sur le contexte modèle ni sur
le KV cache. Corollaire : ce que l'inspecteur peut montrer est exactement ce que
la whitelist retient — un champ qui n'y est pas n'est pas inspectable.

- **Éligibilité** : `ackHasInspectableDetail(m)` (utils.js, pure) — prédicat
  UNIQUE, jamais un test de `kind` dans ui.js. Porte sur la PRÉSENCE des champs,
  pas sur la famille d'outil : ce qui rend un ack inspectable n'est pas ce qu'il
  a fait, c'est qu'on ait gardé de quoi le montrer. Un ack legacy (poussé hors
  d'un tool_call, ou antérieur à l'enrichissement) répond faux et n'affiche
  aucune loupe — pas de drawer vide.
- **Listener sur le NŒUD, jamais en délégation.** En mode compact, un seul
  `.tool-ack` est dans le DOM ; les autres sont **détachés** et ne vivent que
  comme valeurs de `ackNodeOf` (WeakMap). Une délégation au niveau du groupe ne
  verrait jamais les acks masqués — c'est-à-dire précisément les appels
  intermédiaires d'un enchaînement, le besoin qui a motivé le lot. Les nœuds
  détachés survivent intacts, listeners compris.
- **Identité par l'objet.** La closure capture l'ENTRÉE, jamais `m.id` (non
  unique : un create et un delete du même souvenir le partagent). Idem pour la
  garde de fenêtre d'await du volet ressource (`_inspectEntry !== m`).
- **Ordre des icônes** : `.ack-dl` PUIS `.ack-inspect`. La loupe est en dernière
  position, donc à la même abscisse d'un ack à l'autre ; l'ordre inverse la
  décalait sur les seules lignes porteuses d'un téléchargement, cassant
  l'alignement de la colonne dans un groupe déplié.
- **Frontière string→HTML (piège 21)** : tout ce qui est affiché est d'origine
  modèle ou serveur distant. `textContent` ou `escHtml` dans un `<pre>`, jamais
  `renderMd`, jamais d'interpolation en template string. C'est le SECOND chemin
  à risque du projet après `formatToolAcksHtml` — toute extension de
  l'inspecteur hérite de cette contrainte.
- **Frontière de rendu (piège 23)** : un SVG est affiché en **source**, et son
  aperçu passe par le bouton `decoratePre` existant, donc par l'iframe
  `sandbox="allow-scripts"` sans `allow-same-origin`. Aucune seconde voie de
  rendu n'est ouverte ; jamais de SVG d'origine modèle injecté dans le DOM du
  drawer.
- **Présentation par nature, pas brute** : `inspectValueShape` (multiligne →
  bloc), `inspectResultShape` (JSON ré-indenté s'il parse, texte brut sinon),
  `inspectLangForMime` (langue Prism dérivée de `mimeExt`, source unique).
  Toutes pures, testées QuickJS.
- **Volet ressource** : désigné par `ackDownloadTarget` (prédicat unique partagé
  avec le bouton de téléchargement de l'ack). Quatre présentations décidées par
  `inspectResourcePresentation(mime, size)` — vignette (image bitmap), source +
  aperçu sandboxé (SVG), bloc colorisé (autre textuel), descripteur seul
  (binaire opaque) — le téléchargement étant offert dans les quatre cas, via
  `downloadAckResource` (donc `resourceDownloadName` : assainissement PUIS
  extension depuis le mime). Le record résolu **prime** sur les champs de l'ack
  (celui-ci en est une copie potentiellement plus ancienne).
- **`_isTextualMime` (resources.js) est LE prédicat de textualité**, celui qui
  décide déjà du stockage inline vs binary : `inspectResourcePresentation` s'y
  branche plutôt que d'en écrire un second, qui divergerait (ressource stockée
  inline mais jugée binaire à l'affichage). Il est injectable en 3e paramètre
  **pour les tests seulement** — utils.js est évalué seul par le runner, donc
  sans injection cette branche serait morte sous QuickJS et un test vert ne
  prouverait rien d'elle.
- **Nommage des téléchargements de blocs** : chaque bloc pose un
  `data-filename` sur son `<code>`, que `decoratePre` lit déjà — sans lui, tout
  snippet sort en « miaou-snippet.<ext> » alors que l'information est sous les
  yeux. Le nom est `<préfixe>-<quoi>`, composé par `_inspectBlockName(m, what)`
  — **jamais** concaténé sur un site d'appel, sinon la formule diverge entre les
  quatre blocs. Le préfixe (`_inspectNamePrefix`) est le **dernier segment du
  nom d'outil** (`splunk__search` → `search`, `miaou__js__eval` → `eval`),
  replié sur le kind pour un ack sans nom. Il est **systématique**, et c'est là
  qu'il gagne son coût : deux outils exposant tous deux un paramètre `query`
  produiraient sinon deux `query.txt` qui s'écrasent dans le dossier de
  téléchargements — on obtient `search-query.txt` et `list-query.txt`. D'où :
  `<outil>-<clé>` pour un argument multiligne, `<outil>-code` pour le code
  `js__eval`, `<outil>-resultat` pour la réponse. **Seule exception** : une
  ressource garde le nom de son **record** (figé au stockage, déjà spécifique et
  portant son extension) ; seul son repli est préfixé. Le nom traverse
  `sanitizeDownloadName` chez `decoratePre` : une valeur d'origine modèle n'a
  pas besoin d'une précaution supplémentaire au point de pose.
- **Cap de prévisualisation** (`INSPECT_PREVIEW_MAX_BYTES`) : au-delà, **refus
  explicite** + téléchargement, jamais de troncature silencieuse — un extrait
  qui se ferait passer pour le tout est exactement le défaut de l'export que
  cet inspecteur existe pour corriger.
- **Résolution asynchrone** : le descripteur et le bouton sont peints
  immédiatement depuis l'ack ; la prévisualisation arrive après résolution
  cache→IDB. L'ouverture du drawer ne dépend d'aucun `await`.
- **Exports NON touchés** (décision d'ouverture). `_formatToolCallMd` /
  `_formatToolCallHtml` gardent leur troncature à 300 caractères, et la loupe
  est absente des exports comme l'est `.ack-dl` (un HTML standalone n'a ni IDB
  ni globals MIAOU). Un export byte-identique avant/après est un contrôle de
  non-régression du lot.
- **Chrome des blocs de code partagé** : `.inspect-body pre` est joint aux
  sélecteurs `.body pre` / `.tool-block pre` de `chat.css` (fond, bordure,
  padding, couleur, `overflow-x`), plutôt que restylé. Un bloc absent de cette
  liste hérite de la couleur de texte de son conteneur sur le fond de code :
  illisible tant que Prism ne recolore pas, donc invisible sur `language-text`
  et vu seulement sur les langues colorisées — défaut effectivement observé et
  corrigé au lot.
- **Enregistré dans `_drawerStack`** via `trackDrawer` (qui transmet les
  arguments, donc `openToolInspector(entry)` garde sa signature) : sans quoi
  Escape fermerait le drawer du dessous.

Vérification : `.claude/skills/run-miaou/verify-tool-inspector.mjs` (45
contrôles — poignée présente/absente, groupe compact et liste, alignement des
icônes, volets empilés, densité, multiligne, `js__eval`, quatre présentations
de ressource, propriété du scroll et en-tête de bloc épinglé, nommage préfixé
des téléchargements, Escape).

## Références de conversation dans le texte du modèle (`conv_ref`)

Le modèle peut citer une conversation passée (obtenue via `conv__get`/
`conv__list`) pour que l'utilisateur puisse l'ouvrir d'un clic — sans
jamais exposer son ID technique en clair dans le texte affiché.

1. **Doctrine `CONV_REF_DOCTRINE`** (tools.js), **toujours injectée** dès que
   des outils existent (même statut que `BINARY_DOCTRINE`, partie de
   `ROOT_SYSTEM_PROMPT`, constante build-time). Demande au modèle d'utiliser le
   marqueur `[conv_ref:ID]` ou `[conv_ref:ID|Titre]` (titre optionnel, connu du
   modèle depuis le JSON de `conv__get`/`conv__list`) plutôt que
   d'écrire l'ID en clair (backticks, guillemets, texte brut).
2. **Parsing** : `parseConvRefs(text)` (utils.js, pure, testée) extrait tous les
   marqueurs `{ match, id, title }` d'une chaîne — regex `CONV_REF_RE`, id
   délimité par `|` ou `]` (jamais ces deux caractères), titre optionnel après
   `|`, jamais de `]` non plus (pas de lookahead/lookbehind variable).
3. **Résolution = AVANT `marked.parse`, jamais après.** `resolveConvRefs(text)`
   (ui.js, testée) remplace chaque marqueur par un lien Markdown standard
   `[Titre](#miaou-conv:ID)` avant le rendu Markdown — traiter ça en
   post-traitement HTML casserait, les crochets bruts auraient déjà été
   interprétés par le parseur Markdown comme une syntaxe de lien incomplète.
   Titre : celui du marqueur si fourni, sinon lookup dans l'index des résumés
   (`getSummaryEntry`, storage.js) — **y compris une entrée tombstone**
   (`suppressed:true` ne concerne QUE le résumé/mémoire, cf. piège #6 dans
   `docs/pitfalls-detail.md` : la conversation elle-même reste intacte et
   ouvrable, son titre reste affichable normalement) ; repli sur l'ID brut si
   aucun titre n'est connu par ailleurs. **Conversation réellement supprimée**
   (`deleteConv` → `deleteSummaryEntry`, hard delete des deux, chemin *distinct*
   du tombstone) : la source de vérité pour « ouvrable » est
   **`loadConversation(id)`**, pas la présence d'un résumé (cas limite existant
   où le résumé peut survivre sans la conversation, cf. `conv__get`).
   Dans ce cas, rendu en **texte barré NON cliquable** `~~Titre (supprimée)~~`
   (Markdown GFM standard, `marked` le rend en `<del>` sans configuration)
   plutôt qu'un lien mort — pas de post-traitement DOM. `renderMd`
   appelle `resolveConvRefs` en tête, avant `marked.parse` — pas `renderUserMd`
   (les messages utilisateur ne contiennent jamais ce marqueur).
4. **Navigation = délégation de clic unique**, posée une fois dans `init()`
   (main.js) sur `#messages` (pas un `onclick` par lien reconstruit à chaque
   rendu) : intercepte `a[href^="#miaou-conv:"]`, bloque si `sending` (pas de
   navigation pendant un stream, même garde que l'édition de message), route
   vers **`selectConv(id)`** — la même fonction que le clic sidebar, qui gère
   déjà le garde `id === currentConvId`, le résumé de sortie
   (`summarizeIfNeeded(leaving)`) et le mode mobile. Un `id` inconnu (conv
   supprimée) est un no-op silencieux (`openConversation` retourne tôt si
   `loadConversation` échoue) — pas de fonction de navigation dédiée créée,
   pas de duplication du chemin existant.

## Nom de fichier proposé par le modèle pour un bloc de code (`filename=`)

Le bouton « Télécharger » d'un `<pre>` (posé par `decoratePre`, ui.js) propose
par défaut un nom générique `miaou-snippet.<ext>` (`langExt(lang)`, utils.js).
Le modèle peut fournir un nom explicite sur la ligne d'ouverture de la fence.

1. **Doctrine `CODEBLOCK_DOCTRINE`** (tools.js), **toujours injectée**
   (`systemMessageParts()`/`buildSystemMessage()`, main.js), **inconditionnellement**
   — contrairement aux six doctrines de `ROOT_SYSTEM_PROMPT` (gouvernées par
   `TOOLS.length`) : générer un codeblock n'a aucun rapport avec la présence
   d'outils. Demande au modèle le format `filename=nom.ext` après le langage,
   séparé par un **espace** (pas une virgule — cf. point 2), sans espace dans le
   nom, avec extension. Depuis le lot E3 (`v2`), la doctrine demande aussi le
   `filename=` sur les blocs `mermaid` (ex. `flux-auth.mmd`) : il nomme les
   exports d'image du diagramme, extension remplacée côté application par
   `diagramImageName` (utils.js — cf. `docs/rendering.md`). Constante
   build-time (`v2`), même statut KV cache
   (piège #16) que `ROOT_SYSTEM_PROMPT` : une modification invalide le préfixe
   une fois au déploiement. **Bug payé à l'introduction de cette doctrine** :
   `dispatchSend` (main.js, chemin d'envoi réel) ne construisait PAS le message
   système via `buildSystemMessage()`, mais recopiait localement sa formule de
   concaténation (`[sysParts.root, ..., sysParts.user].filter(Boolean).join(...)`)
   — ajouter `sp.codeblock` dans `buildSystemMessage()` seule ne suffisait donc
   pas, la doctrine restait absente du payload réel malgré un test QuickJS vert
   (le test ne couvre que `buildSystemMessage()`, jamais appelée en prod).
   Corrigé en faisant de `buildSystemMessage(sp)` la fonction réutilisée par
   `dispatchSend` (paramètre `sp` optionnel pour éviter un second appel de
   `systemMessageParts()`, `sysParts` restant par ailleurs nécessaire à
   `buildContextManifest` plus loin dans la même fonction) — un seul point de
   concaténation désormais, conforme à l'audit §6 déjà énoncé mais pas respecté
   dans les faits.
2. **Pourquoi l'espace, pas la virgule.** marked 12.0.0 prend `^\S*` sur l'info
   string pour construire la classe `language-xxx` (renderer par défaut,
   vérifié en désassemblant le bundle CDN). `python, filename=foo.py` (virgule
   collée) produit `class="language-python,"` → Prism ne reconnaît pas le
   langage → coloration cassée. `python filename=foo.py` (espace) produit
   `class="language-python"` correct, mais le renderer par défaut ignore
   silencieusement le reste de l'info string (le filename est perdu) — d'où le
   renderer custom au point 3.
3. **Parsing** : `parseCodeFenceInfo(info)` (utils.js, pure, testée) sépare
   `{ lang, filename }` — `lang` = premier segment `^\S*`, **virgule terminale
   retirée** (tolérance à l'ancienne forme cassée, non-régression) ; `filename`
   cherché dans le reste via `filename=valeur` ou `filename="valeur avec espaces"`
   (guillemets retirés).
4. **Rendu = renderer marked custom**, posé une fois via `marked.use({ renderer:
   { code } })` (ui.js, près de la config Prism), signature `code(text, lang,
   escaped)` — reprend le corps du renderer par défaut (échappement identique,
   pas de double-échappement) en ajoutant l'attribut `data-filename` sur le
   `<code>`, **jamais dans la classe**. Pur/déterministe. S'applique aussi à
   `renderUserMd` (même instance `marked` globale, souhaité : un message
   utilisateur collé peut porter un codeblock nommé).
5. **Consommation au download** : `decoratePre` lit `code.getAttribute('data-filename')`,
   passe par `sanitizeDownloadName(name, lang)` (utils.js, pure, testée) —
   retire séparateurs de chemin (`/`, `\`), caractères de contrôle, points de
   tête (anti path-traversal ceinture-bretelles ; `downloadFile` n'écrit que via
   `<a download>`, pas de risque serveur, mais un nom absurde ne doit pas être
   proposé) ; suffixe `.<langExt>` si l'extension est absente (filet de
   sécurité, la doctrine demande l'extension au modèle). Chaîne vide en sortie
   → repli sur `miaou-snippet.<ext>`. Si `data-filename` absent : comportement
   inchangé.
5bis. **Bloc de ressource présenté par MIAOU** (`renderResourceText`, ui.js) :
   ce `<pre>` n'est pas issu d'une fence du modèle, donc **aucun `filename=`
   n'existe** pour l'alimenter — il retombait sur `miaou-snippet.txt`, perdant
   à la fois le nom choisi par le modèle à la création de la ressource et
   l'extension du mime. `renderResourceText` pose donc lui-même le
   `data-filename` que `decoratePre` lira, calculé par le nommeur **partagé**
   `resourceDownloadName(uri, mimeType)` (cf. section « Nommage » plus haut) —
   pas une seconde règle de nommage. Le nom transite par `resource.uri`, que
   `makeResourcePresentBlock` (resources.js) renseigne désormais pour la classe
   `inline` comme il le faisait déjà pour la classe `binary`. Le nom étant déjà
   extensionné, `sanitizeDownloadName` de l'étape 5 le laisse intact.
   L'étiquette de langage du même bloc vient de `mimeToLang` (ui.js), qui
   connaît `csv` : un `text/csv` s'affiche `csv` et non plus `text`.
6. **Pas d'affichage du filename dans le header `.code-head`** dans ce lot
   (décision explicite, cf. « Composants UI provisoires » dans
   `CLAUDE.md` : ne pas redessiner un composant visuel sans spec) — le nom n'est utilisé que pour le
   download. `decoratePre` reste le **chemin unique** de décoration des `<pre>`
   (rendu message ET rendu ressource texte en bloc de code, `ui.js:~3701`).
