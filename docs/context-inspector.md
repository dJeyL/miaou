# Context inspector (brief B)

Rend visible la composition du contexte envoyé au modèle : un manifeste par
bloc logique, plus les totaux. Domaine assez distinct pour ne pas polluer
`storage.md`/`tools.md` (choix acté PLAN-B §8).

## Manifeste — schéma

`buildContextManifest(sysParts, dynParts, threadMsgs, toolDefsJson, apiUsage)`
(utils.js, pure, QuickJS-testable) retourne :

```
{ entries: [{ source, label, chars, tokens, images?, byRole? }],
  totalChars, totalTokens, imageCount, apiUsage }
```

Une entrée par sous-bloc non vide :
- `root_prompt`, `tools_system`, `intent_doctrine`, `skills_doctrine`,
  `docs_doctrine`, `user_prompt` — sous-parts du system message
  (`systemMessageParts()`, main.js), dans le même ordre que
  `buildSystemMessage()` les concatène.
- `context_date_model`, `memories`, `summaries`, `skills_context` — sous-parts
  du contexte dynamique (`contextBlockParts()`, main.js).
- `tool_definitions` — mesuré depuis `JSON.stringify(toolDefinitions())`,
  **jamais** depuis les messages (le tableau `tools` part séparément de
  `apiMessages` dans l'appel réseau).
- `thread` — agrégat du fil (`expandThread(...)`), plus `byRole` (sous-comptes
  par rôle). Les parts `image_url` d'un content-part array ne sont **jamais**
  comptées en chars (le base64 exploserait le total).
- `attachment_images` — `imageCount × IMAGE_TOKENS_ESTIMATE` (constante, D3).
  `entry.label` reste `'Images jointes'` (texte fonctionnel, pas de mention
  d'approximation) : la note « très approximatif » n'est ajoutée qu'à
  l'affichage, une seule fois, par `renderContextInspector()` (ui.js) — ne pas
  la remettre dans `label` (bug payé : les deux couches la portaient, produisant
  « Images jointes (très approximatif) (très approximatif) » dans la table du
  drawer). Vision étant model-dependent et inconnaissable côté client, aucun
  autre calcul n'est tenté.
- `apiUsage` — crochet réservé (non-goal v1) : repassé tel quel si fourni,
  jamais calculé ici. Alimenté plus tard par `usage` renvoyé en fin de stream
  (`stream_options.include_usage`, absent sur certains backends dont Ollama).

`estimateTokens(str)` = `Math.ceil(str.length / 4)`, seule et unique
définition (D2) — remplaçable plus tard par un vrai tokenizer ou un total
API sans toucher les call-sites.

## Deux manifestes (B4)

- **Dernier envoi réel** : `_lastContextManifest` (global de session, main.js),
  posé par `dispatchSend` juste après construction de `apiMessages`, à partir
  des mêmes sous-parts que le payload réellement envoyé (résumés inclus). Bug
  payé : cette capture précède la boucle d'outils (`runConversation`) — sans
  recapture, elle ne voyait ni les tool-acks ni la réponse assistant produits
  pendant le tour, sous-évaluant le compteur d'environ 50 % juste après un
  échange avec outils (jusqu'au prochain envoi ou switch de conversation, qui
  remettent `_lastContextManifest` à `null` et font retomber sur la simulation
  — recalculée, elle, sur le thread complet). Fix : `recomputeLastContextManifest(matches)`
  (main.js) rejoue le calcul sur `currentThread` (désormais complet) et
  réaffecte `_lastContextManifest` ; appelée dans `onFinal`/`onHalt` (y compris
  le chemin `isContinuation`) juste avant `syncContextCounter()`.
  Deuxième bug payé, symétrique : `_lastContextManifest` est aussi (re)posé en
  DÉBUT de tour, dans `dispatchSend`, juste avant l'appel réseau (le nouveau
  message user, attachments inclus, y entre déjà) — mais `syncContextCounter()`
  n'y était pas appelée, donc la pilule restait au total du tour précédent
  pendant tout le streaming, alors que le drawer, ouvert au clic à ce moment-là,
  recalculait `effectiveContextManifest()` à la volée et affichait déjà le
  nouveau total (incluant p. ex. une image tout juste jointe) → pilule et
  drawer désynchronisés tant que la réponse n'était pas terminée. Fix :
  `syncContextCounter()` ajoutée juste après cette capture dans `dispatchSend`.
- **Simulation à froid** : `computeContextManifestNow()` (main.js), rejoue les
  mêmes fonctions pures HORS envoi, avec `matches=[]` (les résumés injectés ne
  sont pas rejouables hors déclenchement d'envoi réel). Purement lecture :
  ne modifie ni `currentThread` ni `localStorage`.

Le compteur compact et le drawer préfèrent `_lastContextManifest` s'il existe,
sinon retombent sur la simulation — avec un en-tête indiquant lequel des deux
est montré. Ce en-tête (`renderContextInspector`, ui.js) distingue quatre cas :
mi-échange (boucle d'outils en cours, cf. ci-dessous) ; dernier envoi réel ;
simulation faute d'envoi depuis le rechargement de la conversation
(`currentThread.length > 0`) ; simulation car conversation réellement vide.
Le premier libellé de repli historique ("aucun message envoyé encore") était
trompeur après un rechargement d'historique : il ne testait que la variable
volatile `_lastContextManifest`, pas la présence réelle de messages.

### Recalcul mi-échange (boucle d'outils)

Bug payé, distinct du précédent : même avec la recapture en fin de tour
(`onFinal`/`onHalt`), un échange qui enchaîne PLUSIEURS tours d'outils
(`runConversation`, api.js, boucle tant que `finish_reason === 'tool_calls'`,
jusqu'à `MAX_TOURS`) ne recalculait jamais le manifeste entre deux tours. Si un
outil renvoyait beaucoup de volume (ex. lecture de fichier volumineuse),
l'utilisateur ne le voyait dans la pilule/le drawer qu'une fois l'échange
ENTIER terminé — potentiellement après plusieurs allers-retours ayant déjà
saturé le contexte, sans qu'il puisse intervenir (interrompre, ajuster) avant.

Fix : `recomputeLastContextManifest(matches, true)` + `syncContextCounter()`
appelés dans `onToolAcks` (`dispatchSend`, main.js) — hook déjà existant,
déclenché après CHAQUE tour d'outils (tool-acks poussés dans `currentThread`),
avant que la boucle ne relance un nouvel appel réseau. `expandThread` tolère un
thread se terminant par un groupe de tool-acks sans réponse assistant qui le
clôt (pas de lookahead exigeant une suite) : le recalcul est sûr même en plein
milieu d'une boucle. Second paramètre `midTurn` (`true` depuis `onToolAcks`,
`false`/absent depuis `onFinal`/`onHalt`) posé sur le nouveau global
`_lastContextManifestMidTurn`, distinct de `_lastContextManifest` — permet à
l'UI de savoir si le total affiché est encore provisoire (le tour suivant
peut le faire évoluer) ou définitif (échange terminé).

Effets UI : pilule avec bordure en tirets (`.ctx-counter-midturn`, composer.css)
tant que `_lastContextManifestMidTurn` est vrai, et hint dédié dans le drawer
(« Échange en cours (outils) — total provisoire, va encore évoluer. »),
prioritaire sur le hint "dernier envoi réel". `_lastContextManifestMidTurn`
n'est PAS remis à `false` explicitement à l'ouverture d'une conv/reset : ces
points remettent `_lastContextManifest` à `null` (cf. plus bas), qui fait
retomber `effectiveContextManifest()` sur la simulation — le hint mi-échange
ne peut apparaître que si `_lastContextManifest` est non-null.

## Fenêtre de contexte (D5, B1-a)

`contextWindowFor(model)` (storage.js) lit `loadSettings().contextWindow` (champ
global unique, `''` = inconnu) ; `model` est ignoré en v1 mais fait partie de la
signature pour basculer plus tard vers une map (serveur, modèle) sans toucher
les call-sites. `CONTEXT_WINDOW_WARN_RATIO = 0.8` (utils.js) : seuil d'occupation
au-delà duquel la pilule passe ambre (`.ctx-counter-warn`) ; à 100 % ou plus
(`ratio >= 1`), elle passe rouge (`.ctx-counter-over`) à la place — les deux
classes sont mutuellement exclusives (`syncContextCounter`, ui.js).

Si le réglage est vide, repli sur `BUILD_DEFAULT_CONTEXT_WINDOW` (storage.js) —
lu depuis `BUILD_CONFIG.default_context_window` (config.json, même mécanisme
que `MAX_SUMMARIES`/`BUILD_API_URL`), `0` = pas de défaut de build (comportement
d'origine, `contextWindowFor` renvoie `null`). Valeur suggérée dans
`config.sample.json` : `32768`.

## UI (B3)

- **Compteur compact** : `#ctx-counter` dans `.composer-selectors` (à droite des
  pills modèle/raisonnement), `≈ N tok` (+ `%` si `contextWindowFor` connu,
  classe `.ctx-counter-warn` entre `CONTEXT_WINDOW_WARN_RATIO` et 100 %,
  `.ctx-counter-over` à 100 % ou plus, `.ctx-counter-midturn` — bordure en
  tirets, cumulable avec les deux précédentes — tant que le total affiché est
  un recalcul mi-échange). Ouvre le drawer au clic (`openContextInspector`).
- **`syncContextCounter()`** (ui.js) : recalcule le libellé depuis
  `effectiveContextManifest()` (= `_lastContextManifest` sinon simulation).
  Câblé à `openConversation`, `resetToEmpty` (donc `newConversation`,
  `pickSpace`), `onSaveSettings`, à CHAQUE tour d'outils (`onToolAcks` dans
  `dispatchSend`, midTurn=true) et en fin de tour (`onFinal`/`onHalt` dans
  `dispatchSend`, midTurn=false). PAS sur `oninput` du textarea (D4/B3 : draft
  exclu v1). `openConversation`/`resetToEmpty` remettent aussi
  `_lastContextManifest` à `null` (le dernier envoi réel appartenait à
  l'ancienne conversation) — ce qui fait retomber le hint mi-échange aussi,
  puisqu'il n'est affiché que si `_lastContextManifest` est non-null.
- **Drawer** (`#ctx-drawer`, pattern premier niveau) : en-tête indiquant
  « dernier envoi réel » vs « simulation », barre empilée (`.ctx-bar`, un
  segment par entrée du manifeste, couleurs fixes `CTX_PALETTE` dans ui.js,
  échelle = fenêtre de contexte si connue sinon total courant), table
  label/chars/≈tokens/% (`.ctx-table`). Rendu par `renderContextInspector()`.
- **Réglage fenêtre de contexte** : `#set-contextwindow` (catégorie « Modèle &
  raisonnement »), lu/écrit dans `init`/`onSaveSettings`, participe à
  `settingsFormDirty`.

## État

B1, B2, B3 livrés. Vérification manuelle restante : voir
`docs/manual-tests.md`.
