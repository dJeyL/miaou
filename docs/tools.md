# Outils (`tools.js`), acks, et références de conversation

## Registre d'outils

Treize outils dans le tableau `TOOLS` ; `toolsSystemPrompt()` dérive sa
description **du registre** — ne jamais la coder en dur. `ask_confirmation`
(primitif halting, cf. plus bas) est exposé au modèle mais **hors registre** :
il ne figure pas dans `TOOLS` et ne compte pas dans ces treize.

**Lecture de l'historique :**
- `get_conversation(id, with_contents=false)` — lit l'**index des résumés**
  (`getSummaryEntry`). Introuvable si pas d'entrée ou tombstone. **Herméticité
  des Spaces (brief D2, lot C)** : une conversation d'un autre Space que
  `activeSpaceId` répond le même message « Conversation introuvable ou
  souvenir supprimé. » — pas d'oracle qui distinguerait « hors-Space » de
  « n'existe pas ». Un résumé orphelin (conversation supprimée) vaut default
  Space. Cf. piège n°18, `CLAUDE.md`.
- `list_conversations(since?, query?, with_contents=false)` — entrées
  non-tombstone dont `timestamp >= Date.parse(since)`, **exclut toujours la
  conversation courante** (`currentConvId`, global de main.js — accès défensif
  via `typeof … !== 'undefined'` car tools.js est aussi évalué seul par le test
  runner) : « conversations passées » n'inclut pas celle en cours. Filtrée en
  amont par Space actif (même posture d'herméticité que `get_conversation`,
  résumé orphelin = default Space). `since` et
  `query` optionnels, filtres cumulables (since puis query). `query` réutilise
  le **même moteur que la recherche sidebar** (`tokenize` + `scoreSummary`,
  utils.js, seuil `score >= 1`) — mots-clés pèsent 2, mots du résumé/titre
  pèsent 1 ; ce n'est PAS une sous-chaîne exacte. Nom conservé
  (≠ `get_conversations`) pour éviter la quasi-collision singulier/pluriel.

**Écriture directe de souvenirs (chemin direct — instruction explicite) :**
- `create_memory(content)` — écrit immédiatement dans `miaou-memories`, retourne
  l'identifiant généré (utile pour un `update_memory` ultérieur dans le même
  échange). **Stampe `scope = activeSpaceId`** (brief D3) : aucun paramètre
  `scope` exposé au modèle, toujours le Space actif — jamais `'profile'`
  (promotion réservée à une action UI).
- `update_memory(id, content)` — correction in-place, pas de tombstone.
  **Refuse hors-Space** (`existing.scope !== activeSpaceId`, y compris scope
  `'profile'`) avec « Souvenir introuvable. » — même posture sans-oracle que
  `get_conversation`.
- `delete_memory(id)` — tombstone réversible (`suppressed: true`). Même garde
  de scope que `update_memory`.

**Présentation de ressource :**
- `present_resource(id)` — handler **synchrone** (lookup `_resourceCache`) ; pousse
  un ack `resource_presented` — le rendu du bloc (image, code, téléchargement) est
  délégué à `placeToolAck` (même chemin live et reload via IDB). Renvoie une erreur
  textuelle si l'id est inconnu du cache session.

**Rappel de pièce jointe (brief A, lot 3, D4) :**
- `recall_attachment(ref)` — `ref` = `att-N` (id conversation-scopé d'une pièce
  jointe de message, cf. `docs/storage.md`). Handler **synchrone**, lookup
  `getCachedRecordByAttId(ref, currentConvId)` (resources.js — même session
  cache que `present_resource`, peuplé par `loadConversationResources` à
  l'ouverture). Distinct de `present_resource` : id-space différent (`att-N`
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
- `skills__read(slug)` — corps Markdown complet d'un skill activé. Contrôles
  introuvable/désactivé sur le cache mémoire = **erreur synchrone** (testable
  QuickJS) ; le contenu vient d'IDB = **handler asynchrone** (renvoie une
  `Promise<string>`). `callInternalTool` détecte un retour thenable et le mappe.
  `api.js` calcule `isMcp` via `parseToolName` (préfixe ≠ `miaou`/`''`), **pas**
  par duck-typing `.then`, sinon cet outil interne async serait pris pour un appel
  distant. Pousse un ack `skill_read` (informatif, sans undo) — nom du skill stocké
  dans `title` (pas `name` : `onEnrichLastAck` écrase `name` avec le nom canonique
  de l'outil pour la réinjection cross-turn).

**Aide utilisateur (lot I) :**
- `about(topic?)` — sert une section de l'aide utilisateur de MIAOU depuis
  `HELP_CONTENT` (objet `{slug: markdown}` injecté au build depuis `src/help.md`
  par `parse_help_sections`, cf. `CLAUDE.md` section pipeline). Handler
  **synchrone** (const en mémoire) → testable QuickJS. L'`enum` du paramètre
  `topic` dérive de `Object.keys(HELP_CONTENT)` (même source que le contenu, pas
  de drift) ; `required` vide → un `topic` absent **ou inconnu** retombe sur
  `overview` (défaut). Pousse un ack `about_read` (informatif, sans undo, icône
  `ICON_BOOK` réutilisée de `skill_read`/`files_read`, champ `topic`). Le contenu
  d'aide **n'est jamais dans le contexte** : seuls le blurb d'identité
  (`IDENTITY_BLURB`, statique, en tête du system message) et l'`enum` de slugs y
  vont ; les sections n'arrivent qu'en tool result, une par appel. Sous QuickJS
  `HELP_CONTENT` vaut `{}` (marqueur non substitué → enum vide) : les tests du
  parseur couvrent le découpage côté `build.py`, ceux du handler couvrent la
  mécanique (fallback overview, ack) — le lookup positif est garanti par le build
  (dist/ contient les topics).

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
  posture no-oracle que `get_conversation`/`update_memory` : id malformé,
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
  }` uniforme ; deux tables d'état poussé distinctes (`_attachmentPushState`
  clé `(conversationId, attId)`, `_filePushState` clé `(spaceId, fileId)`) —
  pas de format de clé partagé entre les deux familles de refs. `session_id`
  reste **toujours** la conversation courante, même pour un fichier d'espace
  (le serveur mcp_docs ne connaît que des sessions de conversation) : un
  fichier lu depuis une conversation est poussé dans LA session de cette
  conversation — pas de partage de session inter-conversation pour un fichier
  (dette assumée, cf. `docs/mcp.md`).

**Promotion vers la bibliothèque d'espace (lot Cbis, D2 path 3, écriture
model-side unique sur la bibliothèque) :**
- `files__promote(ref, description, name?)` — copie une pièce jointe du tour
  courant (`ref` = `att-N`) dans la bibliothèque du Space actif. `description`
  **obligatoire** (le point de la promotion depuis le contexte est que le
  contenu est déjà lu — pas de résumé de ce contenu, une description de ce
  que le fichier EST, cf. `docs/spaces.md`) ; `name` optionnel
  (défaut : nom du fichier d'origine). Handler **asynchrone** (copie via
  `storeLibraryFile`, resources.js, IDB) : validation des paramètres extraite
  en fonction PURE `validateFilesPromoteArgs` (tools.js) car un handler async
  renvoie toujours un thenable — même sur un retour anticipé avant tout
  `await` — donc jamais résolu synchrone par `callTool` sous QuickJS ; la
  validation doit être testée séparément (cf. `tests/test-tools.js`).
  `ref` inconnu/périmé → « Fichier introuvable. » (même posture no-oracle que
  `files__read`). Copie = nouveau record `kind:'library'`, `source =
  currentConvId` (provenance) ; l'attachment d'origine reste intact (D2
  semantics). Pousse un ack `file_promote` (informatif, **pas d'undo** —
  la promotion est déjà consent-gated en amont, un undo confondrait
  consentement et réversibilité).
- **Consentement — voie B, PAS de généralisation du halting (décision Cbis-4,
  revient sur l'audit §5 après relecture du mécanisme réel).** `files__promote`
  n'est **jamais** un outil halting : `toolIsHalting` reste câblé
  exclusivement sur `ask_confirmation`, aucune modification du primitif
  partagé. Le gate est **doctrinal** : `FILES_DOCTRINE` (tools.js, partie
  inconditionnelle de `ROOT_SYSTEM_PROMPT`, comme `MEMORY_DOCTRINE`) prescrit
  au modèle d'appeler `ask_confirmation` avec un récapitulatif (nom, type,
  taille, description proposée) **avant** tout appel à `files__promote`, puis
  de rappeler avec le **même** `ref`/`description` sur confirmation positive —
  exactement le patron déjà éprouvé pour `create_memory` sur le chemin inféré
  mémoire
  (le modèle rappelle un AUTRE outil après le « Oui », jamais lui-même).
  Pourquoi la voie A (généraliser `toolIsHalting`, `files__promote` lui-même
  halting-puis-exécutant) a été écartée : elle aurait introduit un patron
  inédit — aucun outil existant ne s'auto-rappelle en mode
  halting-puis-exécutant — sur un primitif partagé avec `ask_confirmation`/les
  skills, pour un gain de robustesse marginal (le gate doctrinal est déjà le
  modèle de confiance accepté pour `create_memory`). Conséquence assumée : rien
  n'empêche techniquement un modèle indiscipliné d'appeler `files__promote`
  sans passer par `ask_confirmation` au préalable — le gate n'est pas un
  verrou, c'est une doctrine, comme pour la mémoire inférée.

**Confirmation avant écriture (chemin inféré — fait non explicitement demandé) :**
- `ask_confirmation(question)` — outil **halting** : `runConversation` s'arrête
  immédiatement après, sans pousser de message `tool`/`tool_result` natif. La
  question (+ lead-in éventuel) est réécrite en message assistant texte clair
  (fork B). La reprise se fait au tour suivant via la réponse utilisateur
  (« Oui » / « Non » / correction libre), qui est un message user ordinaire.

## Acks d'outils côté client (`tool-ack`, ex-`memory-ack`)

Mécanisme **générique** couvrant les écritures mémoire, les lectures d'historique
et les appels MCP distants. Chaque handler traçable pousse un descripteur
`{ kind, … }` dans `_pendingToolAcks` (tools.js) — `kind` ∈ `memory_create |
memory_update | memory_delete | conversation_read | conversation_list | mcp_call |
resource_stored | resource_presented | resource_deleted | attachment_recalled |
skill_list | skill_read`.
Les hooks `onEarlyAcks()` et `onToolAcks()` (main.js) consomment la file via
`getPendingToolAcks` / `clearPendingToolAcks` et injectent des messages
`{ role: 'tool-ack', kind, id?, content?, prevContent?, title?, count?, server?,
name?, error?, resolved?, mime?, size?, attId?, args?, result?, ts?, group?,
assistantText?, intent?, slug?, convId? }` dans `currentThread`.
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
handler (`get_conversation`, tools.js) et préservé dans toutes les whitelists
de champs (voir avertissement ci-dessus).

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
  SVG author-controlled. La classe `ack-error` est ajoutée si `m.error` (appel MCP
  en erreur). L'action « annuler » (kinds undoables uniquement) est liée par
  `addEventListener` → `undoToolAck(entry, wrap)` (main.js), qui dispatche via
  `ACK_KINDS[kind].undo(id, entry)`. Sémantique par kind : **create** →
  `forgetMemory` (retire l'ajout) ; **delete** → `restoreMemory` (lève la
  tombstone) ; **update** → ré-écrit `entry.prevContent` via `editMemory` (l'ancien
  contenu, capturé **avant** l'écrasement par le handler `update_memory` et porté
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
  wrap.querySelector('.body'))`. Pour `mcp_call`, si le serveur a `showCalls ===
  false`, ne pose pas de nœud et retourne `null` — l'entrée reste en `currentThread`
  (toggle de rendu pur). Ordre à l'écran : icône+modèle → acks (au fil des tours) →
  patienteur → réponse. `resetAssistant` ne touchant que `.body`, les acks survivent
  à la reprise d'attente entre tours. **Reload** :
  `renderThread` tamponne les acks (qui précèdent l'assistant dans `currentThread`,
  ordre `[user, …acks, assistant]`) et les replace dans la bulle assistant suivante
  via `placeToolAck` ; repli en blocs autonomes s'ils ne précèdent pas un assistant.
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

## Références de conversation dans le texte du modèle (`conv_ref`)

Le modèle peut citer une conversation passée (obtenue via `get_conversation`/
`list_conversations`) pour que l'utilisateur puisse l'ouvrir d'un clic — sans
jamais exposer son ID technique en clair dans le texte affiché.

1. **Doctrine `CONV_REF_DOCTRINE`** (tools.js), **toujours injectée** dès que
   des outils existent (même statut que `BINARY_DOCTRINE`, partie de
   `ROOT_SYSTEM_PROMPT`, constante build-time). Demande au modèle d'utiliser le
   marqueur `[conv_ref:ID]` ou `[conv_ref:ID|Titre]` (titre optionnel, connu du
   modèle depuis le JSON de `get_conversation`/`list_conversations`) plutôt que
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
   où le résumé peut survivre sans la conversation, cf. `get_conversation`).
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
6. **Pas d'affichage du filename dans le header `.code-head`** dans ce lot
   (décision explicite, cf. règle d'or CLAUDE.md sur `.bg-activity` : ne pas
   redessiner un composant visuel sans spec) — le nom n'est utilisé que pour le
   download. `decoratePre` reste le **chemin unique** de décoration des `<pre>`
   (rendu message ET rendu ressource texte en bloc de code, `ui.js:~3701`).
