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

## Usage API réel (Bbis)

`streamCompletion` (api.js) pose `stream_options: { include_usage: true }` dans
le body, inconditionnel — les backends qui ne le connaissent pas l'ignorent
silencieusement (aucun cas de rejet 400 observé ; si ça survenait, à traiter
comme `reasoning_effort`, pas anticipé/YAGNI). Le dernier chunk SSE émis avec ce
flag porte `chunk.usage` et `choices: []` — capturé **avant** le filtrage sur
choix vide existant (`if (!choice) continue`), donc indépendant de la présence
de `choices`. `usage` est `null` si absent (backend qui ignore le flag, ex.
beaucoup de configs Ollama) — tolérance totale, même posture que
`reasoning_effort`/vision.

`streamCompletion` renvoie désormais `{ ..., usage }`. `runConversation`
(api.js) le repasse aux hooks terminaux en **4e argument optionnel objet**
(non cassant pour les call-sites existants) : `onFinal(content, reasoning,
finishReason, { usage })`, `onToolAcks({ usage })`, `onHalt(leadIn, question,
{ usage })`. Chaque tour de la boucle produit son propre `result.usage` —
**dernier tour reçu**, jamais sommé (cohérent avec
`recomputeLastContextManifest(matches, midTurn)`, déjà en place pour
l'estimé).

Les appels non-conversationnels (titrage, résumé, description de fichier
d'espace) passent tous par `silentCompletion` (non streamé) — exclus
mécaniquement, aucune liste d'exclusion à maintenir.

Le câblage de `usage` vers `_lastContextManifest` (2e barre cache, UI) est
décrit dans les sections suivantes une fois posé (Bbis-3).

## Prorata sur l'estimé (Bbis)

`scaleManifestToUsage(manifest, usage)` (utils.js, pure, QuickJS-testable) —
calibre un manifeste ESTIMÉ (chars/4) sur l'`usage.prompt_tokens` réel :

- **Fallback = manifeste inchangé** si `usage` est `null`, `usage.prompt_tokens`
  absent, ou si le total scalable (hors ligne images, cf. ci-dessous) est ≤ 0 —
  aucune erreur, aucun log, même posture que reasoning_effort/vision.
- `factor = usage.prompt_tokens / (totalTokens_estimé - imageTokens)` : chaque
  entrée (sauf `attachment_images`) est multipliée par `factor` et arrondie.
- **Résidu d'arrondi** reporté sur la plus grosse ligne (par tokens estimés
  avant scaling, typiquement `thread`) pour que Σ(entries.tokens hors images)
  === `usage.prompt_tokens` exactement.
- `totalTokens` du manifeste retourné = `usage.prompt_tokens + imageTokens`
  (la ligne images reste HORS budget réel, additionnée telle quelle).
- Drapeau `real: true` posé sur le manifeste — consommé par le rendu pour
  retirer le `≈` du total (jamais des lignes individuelles : la ventilation
  par bloc reste toujours une heuristique proratisée, jamais mesurée par
  l'API).

**Ligne `attachment_images` volontairement exclue** du facteur ET du scaling
(décision actée, PLAN-Bbis §Bbis-2) : c'est une constante conventionnelle
« très approximatif » (D3), pas une estimation chars/4 — la mélanger au
calibrage la ferait paraître doublement fausse. Le `prompt_tokens` réel
inclut déjà le coût vision réel côté backend, non ventilable côté client ;
la ligne reste affichée à part, toujours en estimé.

`usageDerived(usage)` (utils.js, pure) extrait `{ inTokens, outTokens,
cachedTokens, cachedRatio }` depuis `usage` — nulls tolérés à chaque niveau
(`usage` absent, ou `prompt_tokens_details.cached_tokens` absent comme sur la
plupart des backends Ollama). Évite au code de rendu de re-décoder la forme
brute de l'API inline.

L'application du prorata a lieu à la **capture** (`dispatchSend`/
`recomputeLastContextManifest`, Bbis-3), pas au rendu : `_lastContextManifest`
porte déjà les tokens réels quand disponibles, pilule et drawer lisent la
même valeur sans recalcul.

## Câblage + UI réel/estimé (Bbis-3)

- **`applyUsageToLastManifest(usage)`** (main.js) : calibre
  `_lastContextManifest` via `scaleManifestToUsage`, appelée APRÈS
  `recomputeLastContextManifest(matches[, midTurn])` dans les trois hooks de
  `runConversation` (`onToolAcks`, `onFinal` — les deux branches continuation
  et normale —, `onHalt`). Séparation volontaire : `recomputeLastContextManifest`
  reste toujours l'estimé pur (rejoue le thread), le scaling est une passe
  optionnelle appliquée après, jamais fusionnée dedans (elle est aussi appelée
  sans usage disponible). `computeContextManifestNow()` (simulation à froid)
  reste inchangée : `apiUsage` toujours `null`, jamais calibrée (A5). Aucun
  reset explicite de l'usage n'est nécessaire au switch de conv : `_lastContextManifest
  = null` (déjà fait) suffit à retomber sur la simulation estimée.
- **Pilule** (`syncContextCounter`, ui.js) : `≈` retiré si `m.real`, gardé
  sinon. Occupation/`%`/classes warn-over inchangées (déjà calculées sur
  `m.totalTokens`, réel ou estimé indifféremment). Rafraîchit aussi le drawer
  (`renderContextInspector()`) s'il est déjà ouvert (`#ctx-drawer.show`) —
  sinon son contenu restait figé sur l'état au moment de l'ouverture pendant
  toute une boucle d'outils ou un streaming, désynchronisé de la pilule qui,
  elle, se met à jour en continu.
- **Drawer** (`renderContextInspector`, ui.js) :
  - En-tête (`#ctx-source-hint`) distingue maintenant quatre cas : mi-échange ;
    dernier envoi réel avec usage (« tokens rapportés par l'API ») ; dernier
    envoi réel sans usage (« estimation, pas d'info backend ») ;
    simulation.
  - Barre 1 (`#ctx-bar`) inchangée dans sa logique — les tokens affichés sont
    déjà réels si `scaleManifestToUsage` est passé, l'occupation en tient
    compte automatiquement.
  - Barre 2 cache (`#ctx-bar-cache`, index.html, masquée par défaut) : un seul
    segment, largeur = `cachedRatio` (échelle interne à l'entrée, PAS celle de
    la fenêtre de contexte) — rendu/masqué selon `usageDerived(m.apiUsage).cachedTokens`.
  - Table : lignes toujours `≈` (jamais mesurées par bloc, même proratisées) ;
    le TOTAL seul perd le `≈` si `m.real`. Ligne « Réponse (sortie) »
    (`.ctx-output`, `completion_tokens`) ajoutée après le total quand connue —
    hors barres, hors somme d'entrée (la sortie n'occupe pas le contexte
    d'ENTRÉE).
- **CSS** (`drawers.css`) : `.ctx-bar-cache` (6px, collée à 2px sous `.ctx-bar`,
  segment teinté `#5fb3d9`) ; `.ctx-table tr.ctx-output` (italique, teinte
  atténuée) — même schéma que `.ctx-total`, pas de surcharge `theme-light.css`
  nécessaire (`CTX_PALETTE` existante n'en a pas non plus).
- **Pas d'affichage de la sortie dans la pilule elle-même** (décision par
  défaut, PLAN-Bbis) : la pilule reste une mesure d'occupation d'ENTRÉE, la
  sortie ne vit que dans le drawer.

## État

B1, B2, B3 livrés. Bbis-1 (capture usage côté stream), Bbis-2 (prorata pur) et
Bbis-3 (câblage + UI) livrés. Vérification manuelle restante : voir
`docs/manual-tests.md` (#67).
