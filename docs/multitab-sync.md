# Synchronisation multi-onglets (lot J)

Couche de signalisation inter-onglets via `BroadcastChannel` (API native, même
origine + même navigateur, zéro dépendance). Objectif : plusieurs onglets MIAOU
ouverts sur la même origine ne divergent plus silencieusement (écriture d'un
onglet invisible ailleurs jusqu'au reload ; deux générations concurrentes sur la
même conversation qui s'écrasent).

**État d'avancement** : J1 livré (noyau pur + adaptateur, non branché). J2–J6 à
venir — voir `untracked/muscle/PLAN-J.md`.

## Portée (V1)

- **Invalidation de cache** : un onglet qui écrit (localStorage ou IndexedDB)
  notifie les autres ; ils rafraîchissent l'UI affectée. Nuance issue de l'audit
  (`AUDIT-J.md §0`) : **aucune lecture de localStorage n'est mémoïsée** dans
  MIAOU — pour ces stores il n'y a rien à « invalider », c'est un signal de
  **re-render**. Les seuls vrais caches RAM périmables sont `_resourceCache`
  (resources IndexedDB) et `_skillsCache` (skills IndexedDB).
- **Soft-lock (awareness, pas enforcement)** : ouvrir une conversation déjà
  ouverte ailleurs informe l'utilisateur, sans bloquer.
- **Propagation des réglages** : un changement de réglage global se reflète dans
  les autres onglets.
- **Readonly relay** : une génération en cours sur la conversation affichée
  ailleurs verrouille l'édition localement (bandeau + inputs désactivés), avec
  heartbeat + TTL contre le crash de l'émetteur.

Hors périmètre : pas de Web Locks / élection de leader, pas de résolution de
conflit, pas de sync cross-device (BroadcastChannel est same-browser), pas de
miroir de streaming token-à-token.

## Architecture (`src/js/sync.js`)

Placé juste après `utils.js` dans `JS_ORDER` (build.py **et** tests/runner.py —
la liste est dupliquée). Deux sections nettes :

### Noyau pur (QuickJS-testable)

Aucun effet de bord, aucune référence à `BroadcastChannel`/`window`. Testé dans
`tests/test-sync.js`.

- `SYNC_PROTOCOL_VERSION` (= 1) — un pair recevant un `v` différent ignore.
- `SYNC_CHANNEL_NAME` (= `'miaou-sync'`) — canal unique.
- `SYNC_MESSAGE_TYPES` — **liste fermée** des types (doctrine « closed lists »).
- `makeEnvelope(type, tabId, payload)` — assemble `{ v, type, tabId, payload }`,
  payload manquant → objet vide (schéma stable).
- `validateEnvelope(obj)` — renvoie l'enveloppe normalisée ou `null` (v/type/tabId
  invalides → ignore silencieux).
- `routeMessage(env, ctx)` — décision **déclarative** `{ action, … }` sans effet
  de bord, à partir de `ctx = { tabId, currentConvId, activeSpaceId }`.
  L'exécution (re-render, bandeau, readonly…) est faite par le câblage impur
  (J3+). `routeMessage` présélectionne « conv affichée ? » ; l'herméticité de
  Space (piège 18, via `spaceConvIds`) reste à la charge du câblage impur.
- `generateTabId(rand)` — id d'onglet, `rand` injecté, préfixe `tab_`, jamais
  `Date.now()` seul (piège B1).

### Adaptateur impur (navigateur uniquement)

No-op silencieux si `BroadcastChannel` est absent (contexte `file://` de l'export
G, navigateur ancien) — MIAOU se comporte comme aujourd'hui.

- `syncTabId()` — id stable de cet onglet (résolu une fois).
- `initSyncChannel()` — construit le canal, idempotent, `try/catch` (origine
  opaque). Renvoie `true` si actif.
- `syncPost(type, payload)` — émet ; no-op si canal inactif. L'appelant garantit
  la **durabilité** avant d'appeler (voir doctrine ci-dessous).
- `syncOnMessage(handler)` — branche le handler applicatif (validé), construit le
  canal. Pas de self-loopback (BroadcastChannel ne renvoie pas ses propres
  messages ; on n'en rajoute aucun).

## Enveloppe

```js
{
  v: 1,                    // version de protocole
  type: string,            // dans SYNC_MESSAGE_TYPES (liste fermée)
  tabId: string,           // id aléatoire par onglet (rand injecté)
  payload: object          // schéma par type (voir ci-dessous)
}
```

Type ou `v` inconnu → ignoré silencieusement (compatibilité ascendante).

## Types de message (liste fermée)

| type | payload | comportement récepteur (décision `routeMessage`) |
|------|---------|--------------------------------------------------|
| `conv-updated` | `{ convId, spaceId, reason? }` | affichée → `rehydrate` ; sinon → `render-list` |
| `conv-deleted` | `{ convId, spaceId }` | affichée → `conv-gone` ; sinon → `render-list` |
| `space-changed` | `{ spaceId }` | `space-list` |
| `settings-updated` | `{ keys }` | `apply-settings` |
| `resources-updated` | `{ ids, convId? }` | `invalidate-resources` |
| `skills-updated` | `{}` | `reload-skills` |
| `full-reload` | `{}` | `full-reload` (import/reset) |
| `conv-opened` | `{ convId, tabId }` | affichée → `soft-lock` ; sinon `ignore` |
| `conv-closed` | `{ convId, tabId }` | `soft-unlock` (du tabId émetteur) |
| `conv-generation-started` | `{ convId, tabId }` | affichée → `readonly-on` ; sinon `ignore` |
| `conv-generation-ended` | `{ convId, tabId }` | affichée → `readonly-off` ; sinon `ignore` |

### Émetteurs (J2 — livré)

Émission au plus près de l'écriture, **post-commit** (voir doctrine plus bas).

| Site (fonction) | Store | Type émis | Payload |
|-----------------|-------|-----------|---------|
| `saveSettings` (storage.js) | localStorage | `settings-updated` | `{ keys: Object.keys(obj) }` |
| `saveApiServersRaw` (storage.js) | localStorage | `settings-updated` | `{ keys: ['api-servers'] }` |
| `setActiveApiServerId` (storage.js) | localStorage | `settings-updated` | `{ keys: ['active-api-server'] }` |
| `saveMcpServers` (storage.js) | localStorage | `settings-updated` | `{ keys: ['mcp-servers'] }` |
| `saveConversation` (storage.js) | localStorage | `conv-updated` | `{ convId, spaceId }` |
| `deleteConversation` (storage.js) | localStorage | `conv-deleted` | `{ convId, spaceId }` (si existait) |
| `toggleConversationPin` (storage.js) | localStorage | `conv-updated` | `{ convId, spaceId }` |
| `moveSelectedConversations` (main.js) | localStorage | `conv-updated` × N | un par id déplacé, `{ convId, spaceId: cible }` |
| `saveSpaces` (storage.js) | localStorage | `space-changed` | `{}` (liste rechargée en entier) |
| `putResource` (resources.js) | IndexedDB | `resources-updated` | `{ ids: [id], convId }` (sur `tx.oncomplete`) |
| `deleteResource` (resources.js) | IndexedDB | `resources-updated` | `{ ids: [id], convId: null }` (sur `tx.oncomplete`) |
| `deleteResourcesByConversation` (resources.js) | IndexedDB | `resources-updated` | `{ ids: [...], convId }` (sur `tx.oncomplete`, si non vide) |
| `putSkill` (skills.js) | IndexedDB | `skills-updated` | `{}` (sur `tx.oncomplete`) |
| `deleteSkillDb` (skills.js) | IndexedDB | `skills-updated` | `{}` (sur `tx.oncomplete`) |
| `applyImportedData` (main.js) | les deux | `full-reload` | `{}` (une fois, avant `location.reload()`) |

**Ne diffusent PAS** (décidés, pas des oublis) :
- `miaou-active-space` (`setActiveSpaceId`) — état **par onglet** ; deux onglets
  peuvent légitimement être sur des Espaces différents.
- Résumés (`saveSummary`, tombstones, `deleteSummaryEntry`) — aucune surface UI
  cross-onglet à rafraîchir en V1 (l'index des résumés n'est pas rendu en direct).
- `migrateSpacesIfNeeded` / `migrateApiServersIfNeeded` / `backfillMessageModels`
  au boot — le canal est construit (`initSyncChannel`) **après** ces migrations
  dans `init()`, donc `syncPost` y est un no-op (aucun broadcast de démarrage
  parasite).
- Souvenirs (`saveMemory`/`editMemory`/`suppressMemory`/`restoreMemory`/
  `forgetMemory`) — même raisonnement que les résumés : le drawer souvenirs est
  relu à chaque ouverture, pas de surface UI cross-onglet à rafraîchir en
  direct (« ne pas broadcaster l'invisible »). Contrairement aux résumés, ce
  store a un chemin d'écriture model-triggered (`memory__create`/`update`/
  `delete`), mais `<miaou_context>` relit l'état frais au tour suivant.

**Init du canal** : `syncOnMessage(handleSyncMessage)` est appelé dans `init()`
(main.js) juste après `loadApiServers()` et `backfillMessageModels()`, après
toutes les migrations de boot. Il branche le récepteur ET construit le canal
(via `initSyncChannel`). Avant ce point le canal est null → `syncPost` no-op →
aucun broadcast de démarrage parasite.

**Bruit d'import assumé** : pendant `applyImportedData`, la réinsertion émet des
`resources-updated`/`skills-updated` en rafale avant le `full-reload` final —
inoffensif, les pairs rechargent de toute façon.

### Récepteurs (J3 — livré)

`handleSyncMessage(env)` (main.js) reçoit l'enveloppe **déjà validée**, appelle
`routeMessage` (pur) avec `{ tabId, currentConvId, activeSpaceId }`, puis
`applySyncDecision(d)` exécute l'effet impur :

| `action` (routeMessage) | Effet (applySyncDecision) |
|-------------------------|---------------------------|
| `rehydrate` | conv affichée modifiée ailleurs → `openConversation(currentConvId)` (byte-stable, piège 17). `openConversation` **relit `conv.messages` APRÈS son `await`** (`projectConvMessages`) et abandonne si un appel plus récent l'a supplanté (jeton `_openConvSeq`) — piège 24(b). **Différé** si `sending` (queue). |
| `render-list` | `renderConvList()` (scopé Space actif, piège 18). |
| `conv-gone` | conv affichée supprimée ailleurs → `resetToEmpty()` (émetteur a déjà persisté ; pas de re-suppression). Différé si `sending`. |
| `space-list` | `syncSpaceUI()` + `renderConvList()`. Le Space actif local ne change pas. |
| `apply-settings` | `applySyncedSettings(keys)` : re-render serveurs/sélecteur/thème/surlignage selon les clés, **sans toucher au draft ni au thread** (A1). Sur `active-api-server` (bascule de serveur) : lève l'override de modèle de la conv affichée (`currentConvModel=''`, **en mémoire seul** — l'émetteur a déjà persisté/broadcasté via son `setConvModel('')`) et `prefetchModels()` (refetch cache modèles du nouveau serveur), sinon `activeModel()` resterait collé sur l'ancien modèle (piège 15). |
| `invalidate-resources` | `invalidateResourceCache(ids)` ; si conv affichée concernée et `!sending` → `loadConversationResources` + `renderThread`. |
| `reload-skills` | `loadSkillsCache()` ; `renderSkills()` si drawer ouvert (`isSkillsDrawerOpen`), sinon `syncSkillHintUI`. |
| `full-reload` | `location.reload()`. |
| `soft-lock` | pair affiche la même conv → l'ajouter à `_peersOnConv`, afficher le bandeau, **re-signaler** si pair nouveau (handshake borné). J4. |
| `soft-unlock` | pair a fermé/quitté → retirer de `_peersOnConv`/`_peersGenerating` ; bandeau masqué si plus aucun pair. J4. |
| `readonly-on` / `readonly-off` | J5 (no-op en J4). |
| `ignore` / `ignore-self` | rien. |

**Queue pendant génération locale** (brief §4.3) : `rehydrate`/`conv-gone` sur la
conv affichée pendant que `sending===true` ne s'appliquent pas immédiatement
(écraseraient `currentThread` en mutation). Ils sont mis dans `_pendingSyncActions`
(coalescés : la dernière re-hydratation gagne, l'état persisté est relu au drain),
puis rejoués par `drainPendingSync()` appelé depuis `setSending(false)` (ui.js —
point de fin **unique**, couvre succès/erreur/abort).

**Pas de boucle de broadcast** : `apply-settings` relit `loadSettings()` sans
réécrire ; aucun récepteur ne persiste en réaction (donc aucune ré-émission).
BroadcastChannel ne renvoie pas ses propres messages, et `routeMessage` filtre en
plus `ignore-self` (défense en profondeur, jamais atteint en pratique).

**Cas limites assumés V1** :
- Space actif de CET onglet supprimé dans un autre → reste sélectionné localement
  jusqu'à une action locale (pas de réconciliation forcée — `miaou-active-space`
  n'est pas diffusé).
- Notice riche sur `conv-gone` (« supprimée ailleurs ») : reléguée à l'infra
  bandeau de J4 ; J3 fait un retour à l'accueil non destructif.

## Soft-lock (J4 — livré)

Awareness non-bloquante : quand la même conversation est ouverte dans ≥2 onglets,
chacun affiche un bandeau informatif (« aussi ouverte dans un autre onglet »).

**Émission** (main.js) :
- `announceConvOpened(convId)` → `conv-opened { convId, tabId }` en fin
  d'`openConversation`, **uniquement sur un vrai switch** (`id !== currentConvId`
  à l'entrée) — une re-hydratation (récepteur `rehydrate` rappelle
  `openConversation` sur la même conv) n'émet pas.
- `announceConvClosed(convId)` → `conv-closed { convId, tabId }` à l'entrée
  d'`openConversation` (switch), dans `resetToEmpty`, et sur `pagehide`/
  `beforeunload` (best-effort ; le vrai filet anti-crash est le TTL de J5).

**État récepteur** : `_peersOnConv` (Set de tabIds tenant la conv **affichée**),
vidé à chaque changement de conv (`resetPeerState`). Le bandeau (`refreshTabBanner`)
est visible tant que le set est non vide ; le readonly (J5) prime via
`_peersGenerating`.

**Handshake borné** : sur `conv-opened` d'un pair **inconnu** pour la conv
affichée, on l'ajoute ET on **ré-émet** notre propre `conv-opened` (pour que le
pair récemment ouvert nous connaisse). Le garde « pair nouveau » (`!_peersOnConv.has`)
borne l'échange : une fois chacun dans le set de l'autre, plus de re-signalement.
Convergent aussi à 3+ onglets, jamais de boucle infinie.

**Anatomie CSS factorisée** : le bandeau `#tab-banner` réutilise la base
`.banner` (composer.css), extraite lot J des trois usages qui la partageaient
(`.summary-banner`, `.move-bar`, `.tab-banner`). La base porte les 7 propriétés
communes + `.banner.show` ; chaque variante ne porte que sa marge/son layout
interne. **`EXPORT_CSS` (ui.js) ne contient aucun bandeau** → rien à propager
(piège 22 respecté nativement), mais si un bandeau y était ajouté un jour, la
factorisation `.banner` ne s'y refléterait pas automatiquement.

## Readonly relay + heartbeat (J5 — livré)

Empêche deux générations concurrentes silencieuses sur la même conversation : un
onglet qui génère verrouille en lecture seule la même conv dans les autres onglets.

**Émission** (main.js, couplée à `setSending` — point de fin **unique**, ui.js) :
- `startGenerationRelay(convId)` au `setSending(true)` : émet
  `conv-generation-started` + arme un **heartbeat** (`setInterval`,
  `SYNC_HEARTBEAT_MS = 5000`) qui ré-émet `-started`.
- `stopGenerationRelay()` au `setSending(false)` (couvre succès/erreur/abort via
  le `finally` du flux) : coupe le heartbeat + émet `conv-generation-ended`.
  Idempotent. Aussi appelé sur `pagehide`/`beforeunload` (best-effort).
- Discipline **deux timers** (piège 13) : `_genHeartbeatTimer` est distinct des
  timers du patienteur (`startWaiter`/`stopWaiter`) ; ne jamais les confondre.

**Réception** (main.js) :
- `readonly-on` (message initial OU heartbeat) : ajoute le `tabId` à
  `_peersGenerating`, horodate (`_peerHeartbeatAt[tabId]`), arme le balayage TTL
  (`armTtlSweeper`), active le readonly. **Idempotent** : un heartbeat répété
  rafraîchit juste l'horodatage. Un onglet ouvert **pendant** une génération se
  verrouille ici, au premier heartbeat (pas besoin d'avoir vu le `-started` initial).
- `readonly-off` : retire le `tabId` ; le readonly se lève quand plus aucun pair
  ne génère. **Relance en outre une rehydratation** du fil affiché
  (`openConversation`, si la conv correspond et `!sending`, sinon différée via la
  queue) : on **ne se repose pas** sur le seul `conv-updated` émis à la
  persistance, car son arrivée peut précéder l'écriture effective de la réponse
  côté pair (piège 24(b) — voir plus bas). Idempotent, byte-stable (piège 17).

**TTL anti-crash** (`SYNC_HEARTBEAT_TTL_MS = 10000`, soit 2×N — A5) : le balayage
(`armTtlSweeper`, `setInterval`) retire tout pair dont le dernier heartbeat date
de plus de 10 s (émetteur crashé sans `-ended`), lève le readonly, s'auto-arrête
quand `_peersGenerating` est vide.

**Readonly UI** (`setConvReadonly`, ui.js) : classe `body.conv-readonly` +
désactivation composer. Le CSS (composer.css) grise le composer et neutralise
(`pointer-events:none`) les boutons de mutation (`.msg-edit`, `.msg-regen`,
`.msg-continue`, `.conv-retitle-btn`). **Lecture + scroll intacts** (A6). Le
readonly est **indépendant de `sending`** (état de génération LOCALE) : à la
levée, le composer est restauré selon `configured`, jamais sur `sending` seul.

**Priorité bandeau** : `refreshTabBanner` fait primer le readonly (« réponse en
cours dans un autre onglet — lecture seule ») sur le soft-lock (« aussi ouverte
dans un autre onglet »).

**`help.md`** : passe unique à J5 (décision Julien 2026-07-11) — topic `interface`,
entrée « Plusieurs onglets » décrivant toute la synchro d'un bloc.

## Doctrine du piège 24 : broadcast post-commit **et** relecture post-await

Deux invariants jumeaux (érigés en **piège 24** de `CLAUDE.md`, détail complet
dans `docs/pitfalls-detail.md`).

### (a) Émission POST-commit

Un émetteur ne diffuse **jamais** avant que l'écriture soit durable :

- **localStorage** : après `setItem` (synchrone, immédiatement durable).
- **IndexedDB** : sur `tx.oncomplete`, **pas** `req.onsuccess` — `onsuccess`
  signale que la requête a réussi dans la transaction, pas que la transaction
  est validée sur disque. Un pair qui relirait le store sur un broadcast
  prématuré verrait l'ancien état (audit A7). En J2 : ajouter un `tx.oncomplete`
  dédié **sans toucher** au `resolve(req.onsuccess)` existant.

Le payload ne porte que des **identifiants** ; le récepteur relit le store. D'où
l'importance que l'émission ne devance pas l'écriture.

### (b) Relecture POST-await côté récepteur

Le pendant côté réception, payé par un bug « le dernier tour n'apparaît dans
l'autre onglet qu'après navigation ». `openConversation` (chemin de
rehydratation) contient un `await` (`loadConversationResources`). Construire
`currentThread` **avant** cet await le fige : un `saveConversation` d'un pair
survenu **pendant** l'await — typiquement la réponse assistant persistée juste
après `conv-generation-ended` — est alors perdu, et le fil reste en retard d'un
tour (visible seulement à la navigation/reload suivante, qui relit le store).

Trois mesures concordantes (main.js) :

1. **Relecture post-await** : `openConversation` ne projette `conv.messages`
   (`projectConvMessages`, pur, testé) qu'**après** l'await ; avant, simple
   contrôle d'existence. Capte tout `saveConversation` concurrent.
2. **Jeton de séquence** `_openConvSeq` : un appel supplanté pendant son await
   abandonne avant d'écrire `currentThread`/DOM (le plus récent, qui relit le
   store le plus frais, gagne). Réentrance bornée.
3. **Filet `readonly-off`** : à la fin de génération d'un pair, relance une
   rehydratation plutôt que de se reposer sur le seul `conv-updated` final.

Règle générale : **tout `await` entre la réception d'un signal de synchro et le
commit du rendu est une fenêtre où le store peut avancer — relire après l'await,
jamais figer avant.**

## Dégradation

`typeof BroadcastChannel === 'undefined'` (ou construction qui lève sur origine
opaque) → adaptateur no-op, aucun changement de comportement. L'export HTML
standalone (lot G/Gbis) ouvert via `file://` doit rester pleinement fonctionnel
hors-ligne : il emprunte le même chemin no-op.

## Tests

- **QuickJS** (`tests/test-sync.js`) : noyau pur — enveloppe, validation
  (v/type/tabId, payload manquant), routage par type, self-loopback, génération
  d'id. L'adaptateur impur (BroadcastChannel absent sous QuickJS) n'est pas
  couvert ici.
- **Manuel / Playwright** (à venir, J6) : scénarios deux-onglets de la checklist
  §7 du brief — voir `docs/manual-tests.md`.
