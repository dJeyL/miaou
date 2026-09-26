# Santé des services et ce qu'on en montre

Ce que MIAOU sait de l'état des services dont il dépend — le backend API qui
répond, les serveurs MCP compagnons —, et comment cet état arrive à l'écran.

Le domaine tient en une discipline : **un prédicat pur par question, et un seul
écrivain par surface.** Les deux questions ne se confondent pas —
« qu'affiche-t-on ? » et « que retente-t-on ? » ont déjà des réponses
divergentes côté MCP (une erreur masque une attente à l'affichage, mais les deux
se retentent), et le backend suit le même découpage.

Le versant MCP — pastille de topbar, sévérités, reprise par serveur — est
documenté dans `docs/mcp.md` ; ce fichier porte le backend API et ce qui
compose les deux.

## Pastille de connexion (pilule modèle)

La pastille de la pilule modèle (`#conn-dot`, topbar) dit si le serveur actif
est joignable. Trois états, portés par un prédicat pur unique
(`resolveBackendHealth`, utils.js) :

| État | Condition | Rendu |
|---|---|---|
| `unconfigured` | pas d'URL, ou pas de clef alors que `REQUIRE_API_KEY` | rouge, infobulle « API non configurée » puis « Ouvrir les paramètres » (deux étages) |
| `down` | configuré, dernier verdict observé en échec | rouge, infobulle « Backend injoignable » |
| `ok` | configuré, et rien d'observé en échec | vert |

**« Pas configuré » n'est pas « ne répond pas », et c'est le cœur du prédicat.**
Les deux sont rouges mais appellent des gestes opposés — ouvrir les réglages
contre attendre/relancer le serveur —, et les confondre envoie l'utilisateur au
mauvais endroit. C'est aussi ce qui interdit de sonder en `unconfigured` : une
requête sans clef sur un endpoint qui en exige une rend 401, qu'on lirait comme
une panne alors que c'est un réglage manquant.

**Un seul écrivain.** `syncConnDot` (ui.js) est le seul à toucher le DOM de la
pastille, et il ne prend pas d'argument : sa seule source est le prédicat. Le
verdict, lui, entre par `noteBackendProbe(ok)`, point d'écriture unique de
`_backendProbe`. Avant ce lot ils étaient deux, à sémantiques divergentes —
`syncConfigured` repeignait en vert sur le seul critère « url et clef
renseignées », effaçant un rouge légitime dès qu'on passait dans les réglages.
`syncConfigured` dérive désormais son propre `configured` du MÊME prédicat
(« pas `unconfigured` »), plutôt que de réécrire le test.

**Reprise active.** `probeBackend()` (main.js) réutilise `/models` via
`loadServerModels(server, true)` — aucune requête d'un nouveau genre : c'est
l'appel déjà fait au démarrage et à chaque changement de serveur, dont l'échec
était jusqu'ici avalé en silence par `prefetchModels`. Le `force: true` est
**impératif** : `loadServerModels` sert un cache de session par serveur, et sans
forçage la sonde répondrait « ok » depuis une entrée mise en cache AVANT la
panne. Elle ne rejette jamais (l'échec est mémorisé dans l'entrée), donc le
verdict se lit sur `_modelsEntryOf(server).error` **après** l'await, jamais sur
un instantané pris avant (piège 24 (b)).

**Le premier contact compte aussi.** `prefetchModels()` (main.js), appelé au
démarrage et à chaque changement de serveur, pose le même verdict : sans ça un
backend DÉJÀ mort à l'ouverture laissait la pastille au vert optimiste
(`probe: null`) jusqu'au premier retour de focus — la panne ne se voyait qu'en
quittant la fenêtre et en revenant. Le verdict n'y est posé que si un serveur
est configuré : sur une install neuve l'état doit rester `unconfigured`, qui
envoie aux réglages plutôt que vers un serveur à attendre.

`maybeProbeBackend()` est branchée sur `visibilitychange` ET `focus`, aux côtés
de `recheckMcpServers` et pour la même raison : le premier ne couvre que le
changement d'onglet, alors qu'on relance un backend en console sans jamais
cacher la fenêtre. L'éligibilité est tranchée par le pur `shouldProbeBackend`
(jamais en `unconfigured`, sans délai en `down`, throttlé en `ok` par
`API_PROBE_MIN_INTERVAL_MS`) — même découpage que `shouldRecheckMcpServer` :
« qu'affiche-t-on ? » et « que retente-t-on ? » sont deux questions distinctes.

**Sans cette reprise, la pastille ne reverdissait qu'au prochain échange
réussi** : après une panne réparée, elle restait rouge tant qu'on n'envoyait pas
de message. Le signal disait « le dernier échange a échoué » là où sa forme —
une pastille d'état permanente — promet « le backend est joignable ».
Non-régression : `verify-backend-health.mjs` (cycle vert → rouge → vert sans
envoi, sur un vrai serveur HTTP local éteint puis rallumé).

## Le chat soucieux (logo)

Quand un service ne répond plus, le logo du chat fronce les sourcils. Même
information que les pastilles, mais portée par une surface qu'on regarde sans
la chercher — la pastille dit *où* est le problème, le chat dit *qu'il y en a
un*.

**Une source SVG, trois sorties.** `src/svg/cat.svg` est la forme du chat,
versionnée et diffable, sourcils compris. Le build (`build.py`) en dérive :

- `__MIAOU_LOGO_SVG__`, injecté **inline** aux trois surfaces du template
  (boot, sidebar, topbar). Inline est la condition de tout le reste : le CSS de
  la page atteint `.eye`, `.brow`, `.mouth` — ce qu'un `<img src="data:">` ne
  permet pas, son contenu étant opaque aux sélecteurs.
- `__MIAOU_LOGO_DATA__`, le data-URI base64 (`LOGO_SRC`, main.js) pour les
  trois points où un nœud SVG n'est pas une option : `<link rel="icon">`, le
  glyphe de source du fil (ui.js) et l'export standalone. Il porte **toujours**
  le chat normal — un favicon soucieux n'apporte rien, et un export ne doit pas
  figer un incident passé.

Deux gardes au build, chacune payée par un défaut qu'elle rend impossible :
les ids internes du SVG sont **suffixés par instance** (`gB-1`, `gB-2`, `gB-3`),
sans quoi les trois `url(#gB)` résoudraient tous sur la première copie du
document — masquer le boot viderait le dégradé des deux autres ; et le compte
d'instances est **vérifié** (`LOGO_INSTANCES`), le build échouant s'il a bougé,
parce qu'une surface ajoutée sans son logo sort autrement un build vert.

**`<use>`/`<symbol>` a été écarté, et ne doit pas être réessayé.** Le clone
d'un `<use>` vit dans un shadow DOM que les sélecteurs de la page ne traversent
pas : l'animation de clin du boot, calée à la main pour synchroniser Chrome et
Safari, cesserait de s'appliquer. C'est la même contrainte qui justifiait
historiquement le doublon SVG inline / base64, lequel disparaît ici sans rien
perdre puisque les deux sorties viennent désormais du même fichier.

**Prédicat unique, `resolveLogoExpression(backendHealth, mcpSeverity,
storageFull)`** (pur, utils.js), qui rend `'ok'`, `'worried'` ou `'storage'`
(troisième expression, cf. plus bas). Il compose les versants sans en ouvrir
un nouveau. Trois décisions y sont portées :

- Le stockage plein PRIME sur le froncement quand les deux coexistent : une
  perte de données est irréversible, un service revient.

- `unconfigured` ne fronce PAS. Le soucieux dit « quelque chose est cassé » ;
  une install neuve n'est pas cassée, elle est vide — accueillir le premier
  lancement par une grimace ferait lire un état normal comme une panne.
- Côté MCP, seul `error` compte (au moins un serveur injoignable). Une attente
  d'autorisation est une action à faire, pas une panne : sa pastille jaune la
  porte déjà, et le chat doublerait un signal qui n'a pas la même urgence.

**Écrivain DOM unique, `syncWorriedLogo()`** (ui.js) : une classe par
expression sur `<body>`, `miaou-worried` ou `miaou-storage`, qui s'excluent et
pilotent les trois surfaces à la fois. Il s'accroche aux deux synchros déjà
obligatoires — `syncConnDot` pour le backend, `syncAuthorizationPending` pour
le MCP — et au front de l'état de stockage (`setStorageFull`, storage.js), à
aucun autre signal : tout point qui change la santé d'un service passe déjà par
l'une des deux synchros, et l'état de stockage n'a que cet écrivain. Le retrait
emprunte le même chemin que la pose, les deux classes étant recalculées en
entier à chaque appel.

**Un appel d'outil MCP qui échoue au transport retombe sur le statut du
serveur** (`noteMcpCallFailure`, mcp.js), avec sa réciproque sur appel réussi
(`noteMcpCallSuccess`). Sans elles l'information se perdait : `_remoteStatus`
n'est écrit qu'aux mutations de configuration, donc un serveur tombant **en
cours de conversation** restait marqué `ok` — le modèle lisait « Failed to
fetch » dans son tool result et l'utilisateur n'avait aucun signal. La ligne de
partage est transport / applicatif (drapeau `err.applicative`, posé là où une
erreur JSON-RPC est reçue) : un outil inconnu ou un refus d'autorisation
**prouvent** que le serveur répond, et les traiter en panne rendrait le chat
soucieux pour un appel malformé.

**Au boot, le plancher d'affichage est allongé quand le chat est soucieux**
(`BOOT_MIN_WORRIED_MS`, 3s contre 1.8s) : une expression qui apparaît en fin de
course ne serait pas vue. Il l'est pour les deux expressions, froncement et
stockage plein.

Deux précautions vont avec, et les deux ont été payées. La classe est relue **à
l'échéance**, jamais au moment d'armer le timer : `finishBoot` est appelée en
fin d'`init()`, donc avant que `prefetchModels` et `reconnectMcpServers` —
lancées sans être attendues — aient conclu ; un plancher calculé là serait figé
sur un état encore vierge (piège 24(b)). Et le plancher nominal pouvant expirer
**avant** le verdict, un sursis borné lui est accordé (`BOOT_MAX_WAIT_MS`,
2.6s) tant que `_healthSettled` est faux. Sans lui le chat fronçait
systématiquement trop tard pour un serveur MCP dont la connexion met ~2s à être
refusée — défaut constaté en usage réel, invisible en local où le refus est
immédiat.

On accorde un sursis, on ne **suspend** pas : au-delà de la borne l'overlay part
quoi qu'il arrive, sinon un serveur qui pend (timeout applicatif réglable
jusqu'à des dizaines de secondes) tiendrait l'écran de démarrage en otage. Si le
diagnostic tombe après, la topbar prend le relais, les trois surfaces portant la
même classe. Non-régression : `verify-boot-worried.mjs`, dont le serveur de
fixture échoue **après un délai calibré**. Le délai est fabriqué et non subi :
un port fermé est refusé en quelques centaines de millisecondes sur la machine
de développement, donc dans la fenêtre où même le code défectueux affichait le
fronçage — alors que la latence d'un refus dépend entièrement de
l'environnement. Le banc doit produire la fenêtre qu'il veut tester plutôt que
d'espérer la rencontrer.

## Fronts annoncés en toast (lot AG)

L'état reste porté par le chat et les pastilles ; ses FRONTS sont annoncés par
un toast — panne (`ok → down`, erreur de service, 8 s, clic vers le drawer des
serveurs) et retour (« rétabli », 5 s, affiché même si l'erreur a été fermée).
Détection par diff d'instantanés aux deux mêmes synchros que le chat
(`syncHealthToasts`, pur `healthFronts`) : cf. `docs/toasts.md`.

## Troisième expression : sourcils horizontaux (stockage plein, lot AG)

Quand une écriture IndexedDB échoue sur le quota, le chat prend des sourcils
horizontaux, plus larges et symétriques : il dit « les données ne sont plus
enregistrées » là où le froncement dit « un service ne répond pas ». L'état vient
de `isStorageFull()` (cf. `docs/storage.md`) : diffusé à tous les onglets, levé
par une suppression, jamais persisté.

**L'écart porte sur les sourcils seuls.** La bouche est celle du froncement,
déjà quasi plate : une autre bouche ne se verrait qu'en taille boot, et
l'expression vise sidebar et topbar.

**CSS seul, sur les tracés existants** (`body.miaou-storage`, base.css) — pas de
géométrie ajoutée à `cat.svg`, donc rien à suffixer ni à recompter. Chaque
sourcil du SVG est incliné d'environ 13,13° : la rotation inverse le remet à
plat, `scaleX(1.25)` l'allonge, et un `translate` le recale. Deux pièges payés
sur maquette : allongés depuis leur centre, les deux traits refermaient leur
écart de 4 unités et se rejoignaient en un monosourcil ; et commuter
l'origine de transformation vers l'extrémité intérieure, qui corrigeait ça,
aurait fait SAUTER le sourcil au lieu de le faire glisser (une origine ne
s'anime pas). L'origine reste donc au centre, et le `translate` compense
(±0.98 horizontalement, +0.52 verticalement : une demi-unité sous le centre du
tracé, hauteur calée avec Julien aux trois tailles).

**L'état doit être lisible sans animation.** Le kill-switch reduced-motion
coupe transitions et clin : l'information est donc dans la POSITION des
sourcils, jamais dans le mouvement qui y mène. Corollaire pour qui retouche le
CSS : une valeur d'arrivée se juge à l'arrêt, pas pendant la transition.
