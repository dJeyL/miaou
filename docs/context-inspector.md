# Context inspector (brief B)

Rend visible la composition du contexte envoyé au modèle : un manifeste par
bloc logique, plus les totaux. Domaine assez distinct pour ne pas polluer
`storage.md`/`tools.md` (choix acté PLAN-B §8).

## Manifeste — schéma

`buildContextManifest(sysParts, dynParts, threadMsgs, toolDefsJson, apiUsage)`
(utils.js, pure, QuickJS-testable) retourne :

```
{ entries: [{ source, label, chars, tokens, images? }],
  totalChars, totalTokens, imageCount, apiUsage }
```

**Les entrées sortent dans l'ordre RÉEL du prompt assemblé par le backend**,
donc par cachabilité décroissante (campagne cache, axe 2) : parts système,
`thread_history`, parts éphémères, `thread_last_user`, `attachment_images` —
avec `tool_definitions` **avant ou après le bloc système selon le backend**.

## Position des définitions d'outils — deux ordres mesurés

Ce n'est **pas une constante**, et ce n'est pas non plus l'ordre des clés du
corps JSON : celui-ci place `messages` avant `tools` (api.js), mais l'ordre des
clés d'un objet ne dit rien de l'ordre d'assemblage côté serveur. S'y fier a
laissé cette entrée mal placée pendant toute la campagne cache.

Protocole commun aux deux mesures — invalider **uniquement la fin du message
système**, `tools` rigoureusement inchangés, et lire
`usage.prompt_tokens_details.cached_tokens`. Il ne dépend **d'aucun état
antérieur** du serveur, contrairement à toute comparaison entre deux requêtes de
formes différentes. `untracked/probe-prompt-order.py` l'automatise.

| Ordre | Backend mesuré | Date | Observation |
|---|---|---|---|
| `tools-first` | Ollama 0.34 (`ornith-1.5-txt:9b`) | 2026-09-14 | après modification de la fin du système, le cache sert **plus** de tokens que le système entier n'en pèse → les tool defs sont en amont |
| `tools-last` | vLLM (`mistral-medium-3-5-0`) | 2026-09-15 | système ~1253 tokens, cache servi après la même modification = 1200, soit **au plus le système lui-même** → les tool defs sont tombées avec lui |

Sur le backend vLLM mesuré, les définitions pesaient 3665 tokens, **75 % du
prompt** : en `tools-last`, tout geste sur le message système (changer d'Espace,
éditer les instructions, brancher un serveur compagnon) les fait recalculer. En
`tools-first`, au contraire, **toucher au message système n'invalide pas les
définitions d'outils**.

Un « contrôle » tentant mais FAUX a été écarté après re-mesure : retirer les
tools met `cached_tokens` à `0` alors que le préfixe système est intact — mais
une requête sans tools est un préfixe DIFFÉRENT, donc une autre entrée de cache,
froide au premier envoi et chaude au suivant (1246 sur 1250). Ce chiffre ne
renseigne que l'historique des requêtes. Le piège est instructif : une mesure à
froid déguisée en résultat, qui allait dans le sens de la conclusion et n'a donc
pas été rejouée. La sonde le signale désormais dans son propre rapport.

La mesure du 2026-09-12 (« la barre 2 s'arrête où finissent les tool defs »)
n'était pas fausse mais INDISCERNABLE : tant que rien ne change dans le système,
système et tools sont servis ensemble et les deux ordres donnent la même barre.
Seule l'invalidation d'un bloc **tardif** du système les sépare.

## D'où vient l'ordre appliqué

Chaque serveur API porte un champ `promptOrder` (`normalizePromptOrder`,
storage.js), lu par `activePromptOrder()` et passé en dernier argument de
`buildContextManifest`. Le défaut est `tools-first`, réglable au build par la
clef `prompt_order` de `config.json` — un déploiement interne qui sait contre
quel backend il tourne arrive ainsi préréglé.

Le réglage est **manuel, et le restera**. La détection automatique a été tentée
puis écartée le 2026-09-15 : aucun en-tête standard ne désigne un backend, un
reverse proxy masque `Server:`, et le seul témoin disponible sur l'infra visée
(`X-Endpoint-Type: vllm`) était **absent d'`Access-Control-Expose-Headers`** —
visible dans les devtools, donc `null` pour `headers.get()` depuis la page. Ne
pas réintroduire un mode « auto » sans un témoin réellement lisible en CORS : le
piège est qu'il « marche » en test manuel et échoue en silence dans l'app.

⚠ **Portée** : chaque ligne du tableau vaut pour un backend, une version, un
modèle. L'ordre d'assemblage est un détail d'implémentation serveur, pas une
garantie du protocole OpenAI. Un troisième backend se **mesure** — il ne se
devine pas, et surtout il ne se renifle pas.
Ce n'est pas un choix de présentation — c'est ce qui donne son sens à la barre
empilée du drawer et à la barre de cache dessinée sur la même échelle : les
blocs qu'un cache par préfixe peut servir sont à gauche, ce qui rouvre le
préfixe à chaque tour est à droite. Réordonner casserait la lecture sans qu'aucun
autre test ne bronche, d'où un test qui garde les positions **relatives** (jamais
une liste recopiée, qui deviendrait fausse au premier ajout de part).

**Corollaire, et c'est le vrai usage de cet écran : une entrée dont la place
surprend est un diagnostic sur le PAYLOAD, jamais un défaut de présentation à
lisser.** L'inspecteur est l'instrument qui donne à voir la structure du
contexte ; quand il montre quelque chose d'inattendu, il a probablement raison.
Trois défauts réels ont été trouvés comme ça le 2026-09-14, aucun des trois
détectable par un test :

- une entrée de bibliothèque apparaissant parmi les parts éphémères a révélé
  que ce bloc était mal placé (il ne changeait qu'à un dépôt de fichier, donc il
  se repayait à chaque tour pour rien) ;
- l'entrée `space` haut dans la liste a révélé que le bloc Espace fermait mal le
  message système, faisant recalculer tout ce qui le suivait à chaque switch
  d'Espace — alors que le piège 1 du CLAUDE.md décrivait le bon ordre depuis
  toujours, et que l'implémentation avait dérivé sans que rien ne le signale ;
- et la proportion servie par la barre de cache, RAPPORTÉE À CE QUE LE TABLEAU
  annonçait, a révélé que `tool_definitions` était lui-même mal placé dans le
  manifeste (cf. plus haut) : un cache qui sert 91 % de l'entrée est impossible
  si la part la plus lourde vient après le bloc qu'on vient de modifier. Ce
  défaut-là se lit dans la COMPARAISON des deux barres, ce qu'aucune des deux ne
  dit seule.

Deux réflexes à s'interdire, parce qu'ils **détruisent le signal** au lieu de le
lire : fusionner deux entrées voisines pour « faire propre » (leur séparation
est précisément ce qui rend un écart visible — la fusion des deux entrées de
bibliothèque avait été envisagée, elle aurait masqué le premier défaut), et
réordonner le manifeste pour qu'il « se lise mieux ». Si l'ordre affiché
déplaît, c'est l'ordre d'INJECTION qu'il faut changer, puis le manifeste suit.

Une entrée par sous-bloc non vide :
- `identity_blurb`, `root_prompt`, `intent_doctrine`, `mcp_instructions`,
  `memories_profile`, `skills_context`, `skills_doctrine`,
  `codeblock_doctrine`, `user_prompt`, `space` — sous-parts du system message
  (`systemMessageParts()`, main.js), dans le même ordre que
  `buildSystemMessage()` les concatène.
- `context_date_model`, `summaries` — sous-parts du contexte dynamique
  (`contextBlockParts()`, main.js). Cette liste dérive : elle doit couvrir
  toutes les clés rendues par `contextBlockParts`, qui est la source.

Le bloc Espace porte aussi la bibliothèque, sous l'une de deux formes
exclusives et co-localisées — le cardinal, ou la liste complète si
`libraryManifestInContext` est actif. Elles partagent l'entrée `space` parce
qu'elles partagent un emplacement. Le **libellé reste court et fixe**
(« Espace actif ») : la colonne est étroite, et y énumérer le contenu du bloc
donnait un libellé qui passait à deux lignes selon l'état. C'est la **tooltip**
qui dit laquelle des deux formes est là. Celle-ci voyage par
`systemMessageParts().libraryForm`, reporté sur le manifeste : elle est **lue,
jamais reniflée** sur le texte produit, et le rendu prend celle du manifeste
(photo du dernier envoi) plutôt que de relire le réglage courant — qui
décrirait sinon un bloc que les chiffres affichés ne mesurent pas.

Chaque `source` doit avoir une entrée dans `CTX_PALETTE` **et** dans
`CTX_EXPLAIN` (ui.js) : sans couleur le segment de barre est invisible, sans
explication le libellé perd sa tooltip — deux dégradations silencieuses. Un test
dérive les sources d'un manifeste réel et vérifie les deux tables, plutôt que de
recopier la liste.
- `tool_definitions` — mesuré depuis `JSON.stringify(toolDefinitions())`,
  **jamais** depuis les messages (le tableau `tools` part séparément de
  `apiMessages` dans l'appel réseau). Sa POSITION dépend du backend — en tête du
  manifeste, ou juste après le bloc système — cf. les deux ordres mesurés en
  haut de ce document.
- `thread_history` / `thread_last_user` — le fil (`expandThread(...)`),
  **scindé au dernier message user AUTHENTIQUE**. La coupe n'est pas cosmétique :
  c'est là que `dispatchSend` injecte le préfixe éphémère, donc là que le payload
  cesse d'être servissable par un cache de préfixe — d'où les parts éphémères
  émises ENTRE les deux entrées. Le prédicat de coupe est
  `lastAuthenticUserIndex(msgs)` (utils.js, pure), **partagé** avec
  `dispatchSend` : deux formules divergeraient en silence, et la barre
  décrirait un découpage que le payload ne suit pas. Un user `_synthetic`
  (recall d'image, brief A2) n'est pas un tour et ne tient donc pas lieu de
  dernier message. Ce qui SUIT le dernier user (tool-acks d'un tour en cours,
  réponse assistant, recall) est compté avec `thread_history` : l'entrée mesure
  un VOLUME de fil, pas un segment contigu du payload. Les parts `image_url`
  d'un content-part array ne sont **jamais** comptées en chars (le base64
  exploserait le total).

  Le champ `byRole` (sous-comptes par rôle) que portait l'ancienne entrée
  `thread` unique a été **retiré** à la scission : aucun rendu ne l'a jamais lu
  depuis le brief B.
- `attachment_images` — `imageCount × IMAGE_TOKENS_ESTIMATE` (constante ; cf. le traitement des images).
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

**La frontière entre ces deux listes est celle du cache, pas une commodité de
rangement** (campagne cache). Y vit en système ce qui ne change qu'à un geste
explicite de l'utilisateur — brancher un serveur MCP, écrire un souvenir,
déposer un fichier, activer une skill, changer d'Espace : autant d'invalidations
**ponctuelles**, que le piège 16 ne vise pas. Reste en éphémère ce qui change
d'un tour à l'autre par construction : l'heure, et les résumés injectés (qui
dépendent du message envoyé).

**Le critère n'est pas « à quelle fréquence ça change » mais « qu'est-ce qui
invalide quoi ».** La première version de la campagne a réparti par fréquence
et s'est retrouvée avec l'Espace décrit à QUATRE endroits — description en fin
de système, note de bibliothèque au milieu, nom de l'Espace et souvenirs en
éphémère. Trois défauts d'un coup : le nom écrit deux fois dont une repayée à
chaque tour ; les souvenirs d'Espace gardés en éphémère au nom d'un motif
(« ils changent au switch de Space ») qui vaut mot pour mot pour la description
de Space, en système depuis le lot C sans que ça pose problème ; et un switch de
Space qui coûtait plusieurs césures de préfixe au lieu d'une. D'où la part
`space` (`buildSpaceBlock`, main.js) : **ce qu'un même geste invalide est
contigu**.

Les souvenirs restent **scindés** par portée — `buildProfileMemoriesBlock`
(part `memories_profile`, transverse) / `buildSpaceMemoriesBlock` (à l'intérieur
du bloc Espace), dont la réunion reste exactement `memoryScopesForSpace`
(piège 18 — la scission est de placement, jamais de portée, et un test le garde).

L'en-tête du bloc Espace **porte le référentiel** : la ligne « Espace : <nom> »
ayant quitté le préfixe éphémère, c'est le seul endroit qui dit encore que ce
qui suit décrit l'Espace COURANT et non un Espace quelconque.

Déplacer une part d'une liste à l'autre **suppose de vérifier ce que sa
position tranchait**. `skills_context` en est le cas type : sa proximité avec le
dernier message user lui faisait gagner un arbitrage contre `DOCS_DOCTRINE`
(incluse dans `root_prompt`), et en système cet arbitrage n'est plus rejoué que
par l'ordre du join — d'où la garde de position dans `buildSystemMessage()` et
son test.

**`space` ferme le message système**, juste après `user_prompt`, et c'est une
seconde garde de position. Deux raisons qui pointent dans le même sens : le
prompt utilisateur est général, la description d'Espace en est un complément
propre à l'Espace actif — elle se lit donc après lui, comme du temps où elle lui
était concaténée (`resolveUserSystemPrompt`) ; et c'est sa place par
cachabilité, un switch d'Espace ou un dépôt de fichier n'invalidant alors rien
de ce qui précède. Le bloc a un temps vécu au milieu du message système, hérité
du regroupement : il y faisait recalculer `skills_context`, `skills_doctrine`,
`codeblock_doctrine` et `user_prompt` à chaque geste sur l'Espace. Un test lit
le **join réel** (pas le manifeste) pour garder cet ordre.

`estimateTokens(str)` = `Math.ceil(str.length / 4)`, seule et unique
définition (estimation de tokens) — remplaçable plus tard par un vrai tokenizer ou un total
API sans toucher les call-sites.

## Deux manifestes

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
jusqu'à `MAX_TURNS`) ne recalculait jamais le manifeste entre deux tours. Si un
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

## Fenêtre de contexte

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

## UI

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
  `dispatchSend`, midTurn=false). PAS sur `oninput` du textarea (décision d'UI : draft
  exclu v1). `openConversation`/`resetToEmpty` remettent aussi
  `_lastContextManifest` à `null` (le dernier envoi réel appartenait à
  l'ancienne conversation) — ce qui fait retomber le hint mi-échange aussi,
  puisqu'il n'est affiché que si `_lastContextManifest` est non-null.
- **Drawer** (`#ctx-drawer`, pattern premier niveau) : en-tête indiquant
  « dernier envoi réel » vs « simulation », barre empilée (`.ctx-bar`, un
  segment par entrée du manifeste, couleurs fixes `CTX_PALETTE` dans ui.js,
  échelle = fenêtre de contexte si connue sinon total courant), table
  label/chars/≈tokens/% (`.ctx-table`), chaque label portant son explication au
  survol (cf. « Explication des parts » plus bas). Rendu par
  `renderContextInspector()`.
- **Réglage fenêtre de contexte** : `#set-contextwindow` (catégorie « Modèle &
  raisonnement »), lu/écrit dans `init`/`onSaveSettings`, participe à
  `settingsFormDirty`.

## Explication des parts

Chaque libellé de la table porte une explication en `title` natif, servie par
`CTX_EXPLAIN` (ui.js) : une clé par `source` produite par
`buildContextManifest`, qui reste LA source de la liste — une entrée sans clé
correspondante s'affiche simplement sans explication (pas de placeholder, pas
d'erreur), donc ajouter une `source` sans l'expliquer dégrade proprement.

Trois décisions à ne pas défaire :

- **Côté rendu, pas dans le manifeste.** `buildContextManifest` est une
  *mesure* (chars/tokens) ; y verser de la prose d'affichage mettrait du texte
  d'interface dans une structure que les tests purs assertent champ par champ.
- **Strictement descriptif.** L'explication dit ce que le bloc CONTIENT, jamais
  comment l'alléger : les leviers de réduction vivent au seul sujet `contexte`
  de `src/help.md`, et les dupliquer ici les ferait diverger au premier réglage
  qui change. Registre impersonnel comme tout texte d'interface (le tutoiement
  est réservé à `help.md`).
- **`escHtml` inconditionnel** sur la valeur, bien qu'elle soit une constante
  littérale hors origine modèle (donc hors piège 21) : on est en position
  d'ATTRIBUT et ces phrases portent des apostrophes. L'échappement reste posé
  pour que le point d'injection ne soit pas déjà ouvert le jour où la valeur
  deviendrait dynamique.

Une explication peut avoir **plusieurs états**, quand le bloc qu'elle décrit en
a. `contextExplainFor(source, libraryForm)` résout `space` contre
`CTX_EXPLAIN_SPACE_VARIANTS` — cardinal, liste complète, ou bibliothèque vide —
et rend la valeur de table pour toute autre source. Deux règles s'y attachent.
La variante est une **phrase entière**, jamais un fragment recollé à la valeur
de table : une substitution partielle redevient muette au premier reword de
`CTX_EXPLAIN.space`, sans que rien ne le signale. Et le test d'alignement
interroge **la fonction dans chacun de ses états**, pas la table seule — sinon
une variante vide passerait inaperçue, la table restant, elle, bien remplie.

Côté CSS (`drawers.css`), `.ctx-label-explained` pose un souligné pointillé
discret et `cursor: help`. **Le pointillé est le signal au repos** : sans lui,
rien n'indique qu'il y a quelque chose à survoler et la tooltip n'est jamais
découverte. Teinte `border-2` et souligné seul, pour qu'il ne se lise pas comme
un lien cliquable — le libellé n'ouvre rien.

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
  avant scaling, cherchée dynamiquement) pour que Σ(entries.tokens hors images)
  === `usage.prompt_tokens` exactement. La scission du fil a retiré `thread`,
  qui était typiquement cette ligne : le résidu se pose désormais ailleurs, ce
  qui ne casse rien parce que la recherche n'a jamais nommé de source. Les tests
  gardent la SOMME, jamais l'identité de la ligne qui absorbe.
- `totalTokens` du manifeste retourné = `usage.prompt_tokens + imageTokens`
  (la ligne images reste HORS budget réel, additionnée telle quelle).
- Drapeau `real: true` posé sur le manifeste — consommé par le rendu pour
  retirer le `≈` du total (jamais des lignes individuelles : la ventilation
  par bloc reste toujours une heuristique proratisée, jamais mesurée par
  l'API).

**Ligne `attachment_images` volontairement exclue** du facteur ET du scaling
(décision actée, PLAN-Bbis §Bbis-2) : c'est une constante conventionnelle
« très approximatif », pas une estimation chars/4 — la mélanger au
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
  reste inchangée : `apiUsage` toujours `null`, jamais calibrée (arbitrage confirmé). Aucun
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
    segment, largeur = `cachedTokens / scale` — **la même échelle que la
    barre 1** depuis l'axe 2 de la campagne cache (voir plus bas).
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

## Les deux barres se lisent ensemble (campagne cache, axe 2)

La barre 2 était dessinée sur une **échelle interne** (`cachedRatio`, soit
cached/prompt) : son 100 % ne désignait rien de repérable sur la barre 1, donc
les deux ne se lisaient pas l'une sous l'autre. Elle est désormais sur la
**même échelle** (`cachedTokens / scale`, où `scale` est la fenêtre de contexte
si connue, sinon le total courant). Formulation de la décision : *le 100 % de la
barre 2 est le X % de la barre 1*.

**On ne dessine AUCUN repère de « frontière théorique du cacheable »**, et on ne
calcule rien de tel. On ne sait pas ce que le backend cache ; prétendre le
savoir mettrait une affirmation fausse sous les yeux de l'utilisateur. Le `%` de
la table, lui, reste inchangé (part de chaque bloc dans le total) — il ne parle
pas de cache.

### ⚠ La barre 2 mesure une QUANTITÉ, pas une position

Sa longueur ne dit **pas** « tout est servi jusqu'à l'entrée sous laquelle elle
s'arrête ». `cached_tokens` est une quantité que le backend aligne sur ses
propres blocs internes, lesquels ne tombent sur aucune frontière de bloc
logique. Mesuré le 2026-09-14 (Ollama 0.34, `ornith-1.5-txt:9b`) en faisant
varier la longueur de la part modifiée : `cached_tokens` reste **figé sur un
palier** — 4890 constant pendant que `prompt_tokens` passait de 5677 à 5701 —
et la valeur du palier dépend de l'historique des requêtes, pas seulement du
contenu envoyé.

Conséquence pour qui lit l'écran : reporter l'abscisse où le segment s'arrête
sur la liste des entrées est une **sur-lecture**, et l'écart se chiffre en
centaines de tokens. Un cas réel du 2026-09-14 : 91 % servis, un segment qui
semblait s'arrêter vers « Doctrine skills », alors que la part réellement
invalidée était le bloc Espace, tout en bas du message système. Ce qui reste
solide dans cette barre est **catégoriel** — servi / pas servi du tout, et les
grands ordres de grandeur —, jamais la position exacte.

La phrase de cette doc qui disait « si le segment s'arrête là où commencent les
parts éphémères, ça se lit sans légende » portait exactement cette
sur-lecture : retirée. Même chose pour la formulation de la mesure du
2026-09-12 (« la barre 2 s'arrête très exactement où finissent les tool defs »),
qui décrivait une coïncidence d'ordre de grandeur comme une frontière au token
près.

Deux conditions d'affichage, et non plus une :

- `cachedTokens` connu (absent sur les backends qui ne le renvoient pas ;
  les versions récentes d'Ollama le font désormais) ;
- **`m.real`**, c'est-à-dire manifeste calibré par `scaleManifestToUsage`.
  Sans calibrage les entrées restent en estimé chars/4 tandis que
  `cachedTokens` est dans l'unité de l'API : superposer deux barres d'unités
  différentes produirait une comparaison muette et fausse. On masque plutôt.

## État

Intégralement livré : noyau pur (estimation, manifeste, accesseur de fenêtre),
câblage à l'assemblage, UI (compteur compact et drawer), puis la capture de
l'usage côté stream et son prorata. Vérification manuelle restante : voir
`docs/manual-tests.md` (#67).
