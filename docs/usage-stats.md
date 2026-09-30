# Statistiques de consommation de tokens (lot AJ)

MIAOU additionne ce que chaque appel de complétion a consommé, d'après les
compteurs renvoyés par l'API (`usage`), et le garde par jour, serveur, modèle et
nature d'appel. Ce fichier décrit la collecte, puis la consultation et son
graphe.

Code : `src/js/usage-stats.js` (purs et point d'enregistrement), stockage dans
`storage.js` (`recordModelUsage`, `readAllUsageStats`), accroche dans `api.js`.

## Ce qui est compté

**Tout appel de complétion, aux deux seuls points réseau** : `streamCompletion`
(chat, agents, parent réveillé) et `silentCompletion` (titrage, titrage précoce,
résumé, compaction, description de fichier, astuce « Le saviez-vous »). Aucun
appelant n'enregistre lui-même : il passe seulement sa nature (`purpose`), que le
point réseau ne peut pas deviner.

**Un tour = un appel.** Un échange à cinq tours d'outils fait cinq appels, et
chacun est compté. C'est l'inverse de l'inspecteur de contexte, qui ne garde que
l'usage du dernier tour (lot Bbis) : ici chaque requête est facturable, donc
chaque requête compte. L'enregistrement se fait dans `streamCompletion` même,
sans passer par les hooks de `runConversation`.

**Prédicat de comptage : `modelCallCounts({ answered, aborted, refused })`**, le
même aux deux points réseau.

| Issue de l'appel | Compté ? | Tokens |
|---|---|---|
| Réponse 2xx | oui | ceux de `usage`, ou « non mesuré » s'il manque |
| Interrompu (Stop, chien de garde du stream, timeout de `silentCompletion`), même avant les en-têtes | oui | non mesuré |
| Corps 2xx illisible (`silentCompletion`), ou flux 2xx coupé par une erreur qui n'est pas un abort (connexion réinitialisée en plein flux, hook de peinture qui lève) | oui | non mesuré |
| Refus HTTP (non-2xx), même interrompu pendant la lecture du corps d'erreur | non | — |
| Erreur réseau (le `fetch` lève autre chose qu'un abort) | non | — |

Un appel interrompu **avant** la réponse compte, parce que sur un long prefill
certains backends n'envoient leurs en-têtes qu'au premier token : le calcul a eu
lieu. Le prix est qu'on ne distingue pas ce cas d'une requête jamais reçue ; on
le compte comme « non mesuré » plutôt que de sous-compter en silence.

**Rejeux internes.** `streamCompletion` rejoue sans `reasoning_effort` ou sans
images sur un refus (4xx), `silentCompletion` enchaîne la cascade NOTHINK et le
rejeu vision sur un refus aussi. Le refus n'est pas compté, le rejeu l'est par sa
propre invocation. Dans `streamCompletion`, le rejeu est un `return` placé AVANT
le point d'enregistrement : l'appel extérieur n'enregistre rien.

**Hors périmètre** : les lectures de propriétés de modèle (`/models`,
`/api/tags`, `/api/show`, `/api/ps`, cf. `docs/model-props.md`) ne sont pas des
complétions et ne consomment pas de tokens ; l'évacuation des tool results
(`docs/compaction.md`) n'appelle pas le modèle.

## Nature d'appel (`purpose`)

Chaîne libre posée par l'appelant, **sans liste fermée** : une nature future
s'enregistre sans toucher au code de collecte. Un appel qui l'oublie tombe dans
`'other'` (`normalizeUsagePurpose`), qui reste visible dans les données : l'oubli
se voit au lieu de disparaître. `runConversation` relaie `h.purpose` à
`streamCompletion`.

Natures posées aujourd'hui : relever `grep -n "purpose:" src/js/*.js` plutôt que
de se fier à une liste recopiée ici. Deux choix qui ne se lisent pas dans le
code : le réveil d'un parent par ses agents (`driveDetachedConversation`) est du
`chat` et non de l'`agent`, puisque c'est la conversation du parent qui
travaille ; le titrage précoce (`early-title`) reste distinct du titrage
(`title`), parce qu'une fusion ne se défait pas.

La nature est enregistrée mais pas encore exploitée à l'écran.

## Serveur crédité

`activeApiConfig()` ne porte pas l'id du serveur. Les deux points réseau lisent
donc `activeApiServer()` **au début de l'appel, au même instant que sa config** :
lu en fin d'appel (comme le fait `noteModelCalled`), un changement de serveur
actif pendant une génération attribuerait la consommation au mauvais serveur.

Le nom du serveur est gardé à chaque enregistrement (`serverName`, réécrit à
chaque fusion, donc toujours le dernier connu). Il ne sert qu'une fois le serveur
supprimé : tant qu'il existe, l'écran affiche le nom du serveur vivant, lu par
id, et un renommage ne pose aucune question.

## Stockage

Store IndexedDB `usage_stats` (base `miaou` v5), keyPath composé
`['day', 'serverId', 'model', 'purpose']`, composé par le seul
`usageStatsKey`. **Un agrégat, pas un journal** : le volume reste de l'ordre
d'une entrée par jour et par combinaison active.

```
{ day, serverId, model, purpose, serverName,
  calls, unmeasured, inTokens, cachedTokens, cachedKnownCalls, outTokens }
```

- `day` : jour calendaire LOCAL, `YYYY-MM-DD` (`localDayKey`), figé à la **fin**
  de l'appel. Un appel à cheval sur minuit compte le jour où il se termine.
- `calls` : toutes les requêtes comptées, mesurées ou non.
- `unmeasured` : celles qui n'ont rapporté aucun compteur principal
  (`prompt_tokens` et `completion_tokens` absents tous les deux). Elles
  n'apportent aucun token. Si un seul des deux est présent, l'appel est mesuré et
  l'autre compte pour 0.
- `cachedKnownCalls` : appels mesurés dont `cached_tokens` était **renseigné**,
  zéro compris. Un `0` est une mesure, un champ absent n'en est pas une. C'est ce
  qui permettra de distinguer « n/d » (aucun appel connu) d'un total partiel
  (une partie seulement), sans stocker de booléen ambigu. Ollama renvoie
  `cached_tokens` depuis au moins sa version 0.34.
- Tokens de raisonnement : compris dans `outTokens` là où le backend les compte
  dans `completion_tokens`, jamais ventilés.

Décodage de l'usage par `usageDerived` (utils.js), le même que l'inspecteur :
`usageStatsDelta` en tire l'incrément d'un appel, `mergeUsageStatsRecord` le
somme dans le record (champs sommés : `USAGE_STATS_SUM_FIELDS`, source unique).

**Écriture** : `recordModelUsage` fait le `get` et le `put` dans UNE transaction
`readwrite`, ce qui sérialise deux onglets qui génèrent en même temps (en
localStorage, la lecture-modification-écriture de l'un écraserait l'incrément de
l'autre). Elle ne rejette jamais et n'est jamais attendue : une statistique ratée
ne retarde ni ne fait échouer une génération. Un échec passe par
`noteStorageWriteFailure` dans `tx.onabort`, donc un quota plein pose l'état
« stockage plein » comme toute autre écriture (`docs/storage.md`).

**Export et import** : les records voyagent dans la sauvegarde complète, sous
`idb.usageStats`, et l'import les remplace intégralement, par rien si la
sauvegarde n'en porte pas (`docs/storage.md`, § Export / import). Leur poids a
sa ligne dans le rapport de stockage (Réglages › Données).

**Diffusion entre onglets** : chaque écriture commitée émet `usage-updated`
(payload vide, sur le `tx.oncomplete` de `recordModelUsage`, piège 24 (a)) ; le
récepteur relit le store si son drawer est affiché, par le même chemin qu'un
appel local (`docs/multitab-sync.md`). Longtemps écartée (« aucun onglet
n'affiche ces chiffres en continu ») : elle ne l'est plus depuis que le drawer
se rafraîchit en place.

**Écriture sans ack ni trace dans le fil**, et c'est voulu : la règle « pas
d'écriture silencieuse en arrière-plan » vise le contenu écrit à l'initiative du
modèle (souvenirs, fichiers). Ces statistiques sont une télémétrie locale de
l'application, jamais un outil du modèle.

## Consultation

Drawer `#usage-drawer` (`drawer-wide`), rendu par `renderUsageStats`
(usage-stats.js), styles dans `src/css/usage-stats.css`.

**Entrées** : la palette (touche `u`), le bouton « Statistiques d'usage » de
Réglages › Connexion, le glyphe « barres » de chaque fiche du drawer des
serveurs API (`.api-usage`, absent d'une fiche neuve comme la relecture), qui
ouvre la vue **filtrée sur ce serveur**, et le même glyphe sur chaque ligne du
tableau des modèles de la fiche (`.api-model-usage`), filtrée sur le serveur ET
le modèle (`openUsageStats({serverId, model})` ; un modèle sans statistiques
retombe sur « tous les modèles »). Le glyphe est réservé à cet usage. Le
drawer s'ouvre par-dessus les réglages et les serveurs sans rien fermer ; il
est suivi par `trackDrawer` (ui.js), donc Échap le referme seul. Il est déclaré
APRÈS le drawer des serveurs dans `index.html` : à z-index égal, c'est l'ordre
du DOM qui le fait passer devant.

**Relecture complète à chaque ouverture** (`readAllUsageStats`), jeton de
séquence contre une ouverture qui en double une autre. **Relecture en place**
tant que le drawer est affiché : `noteModelUsage` enchaîne sur la promesse de
`recordModelUsage`, résolue au `tx.oncomplete` (relire avant le commit relirait
l'état d'avant), et appelle `scheduleUsageStatsRefresh` — regroupement de
`USAGE_REFRESH_DELAY_MS`, une boucle d'outils enregistrant un appel par tour et
la fin d'un échange plusieurs d'affilée (titrage, résumé). `refreshUsageStatsIfShown`
ne fait rien drawer fermé, reprend le jeton de l'ouverture SANS l'incrémenter
(une ouverture ou une fermeture pendant la lecture la rend obsolète), conserve
filtres et échelle choisie (des globales) et la position de défilement, et se
reporte tant qu'un menu de pilule est ouvert — le re-rendu reconstruit les
pilules et refermerait le menu sous le pointeur. Les écritures d'un autre
onglet arrivent par `usage-updated` et empruntent le même chemin.

**Filtres** : serveur (« Tous les serveurs », les serveurs vivants dans l'ordre
des réglages sous leur nom vivant, puis ceux qui n'existent plus mais ont des
statistiques, sous leur dernier `serverName` et marqués « supprimé » —
`usageServerOptions`), modèle (« Tous les modèles » et ceux du serveur choisi —
`usageModelOptions`), échelle. Pilules `cfgPillSelect`, jamais de select
natif. La nature d'appel n'est pas un filtre.

**Échelles** (`USAGE_SCALES`, ordre croissant) : 1 semaine, 1 mois (défaut),
3 mois, 6 mois, 1 an. Fenêtres **glissantes**, comptées à rebours depuis
aujourd'hui (`usageScaleWindow`, bornes incluses) :

- 1 semaine : les sept derniers jours ;
- 1 mois : du lendemain du même quantième le mois précédent jusqu'à
  aujourd'hui (mois calendaire glissant, pas 30 jours) ;
- 3 mois : 13 semaines pleines, 91 jours — trois mois glissants font entre 89
  et 92 jours, et des bacs hebdomadaires de largeur égale restent comparables ;
- 6 mois et 1 an : six et douze mois glissants.

Un quantième absent du mois d'arrivée (un 31 qui recule sur avril, un 29-31 sur
février) est ramené au dernier jour du mois (`usageAddMonths`, année
bissextile comprise), toujours calculé depuis la date d'origine : le repli d'un
mois court ne se propage pas aux suivants. **Toute l'arithmétique porte sur des
dates civiles** (`Date.UTC` sur les clefs de jour), jamais sur des horodatages
locaux, qu'un changement d'heure décalerait d'un jour ; seul « aujourd'hui »
vient de l'heure locale, et il arrive en argument de chaque pur.

**Échelles proposées** (`availableUsageScales`) : la première dès qu'il y a
des données, chaque suivante seulement si la plus ancienne donnée de la
SÉLECTION précède le début de la précédente — sinon elle montrerait la même
chose en plus large. Défaut « 1 mois » s'il est proposé, sinon la plus grande
proposée (`resolveUsageScale`). L'échelle CHOISIE est gardée à part de
l'échelle affichée : un filtre qui la rend indisponible affiche le repli, et le
choix revient de lui-même quand le filtre change encore.

**Totaux** (`usageTotals`, champs de `USAGE_STATS_SUM_FIELDS`) : requêtes,
entrée, dont cache, sortie, non mesurés, sur la fenêtre. Une ligne par couple
(serveur, modèle), entrée décroissante, et la ligne de total dès qu'il y a plus
d'une ligne ; une seule ligne sinon (le total la répéterait). Les nombres
passent en notation compacte au-delà de 9 999 (`formatUsageCount` : trois
chiffres significatifs, unités k, M, G, arrondi qui change d'unité en
atteignant 1 000), valeur exacte en infobulle (`usageExactCount`), en mono
réduit : exacts, cinq colonnes de centaines de millions ne laissaient presque
rien au nom du modèle. Le cache suit `usageCacheState` :

| État | Condition | Affichage |
|---|---|---|
| `unknown` | aucun appel mesuré n'a renseigné le cache | « n/d », infobulle |
| `partial` | une partie des appels mesurés seulement | valeur + `*`, infobulle qui dit combien |
| `known` | tous les appels mesurés | valeur |

**Modèles homonymes** (décision du 2026-09-29) : un même nom de modèle servi
par deux serveurs (travail et maison) fait deux lignes, jamais une. La clef de
`usageTotals` est le COUPLE. Le graphe, lui, ne ventile pas par modèle
(§ Graphe) : il somme les mêmes enregistrements, et sa somme égale le total. Le
serveur n'est affiché que sur les noms partagés par plusieurs serveurs **des
lignes affichées** (`sharedName`, calculé après la fenêtre), en second texte
atténué dans la cellule du modèle, sous le libellé de la pilule serveur (nom
vivant, ou dernier nom marqué « supprimé »). Sous un filtre serveur, il n'y en
a jamais, par construction. Contrepartie assumée : le libellé d'une ligne
change dès qu'un second serveur sert le même modèle dans la fenêtre.

Le **filtre modèle reste par nom** (`usageModelOptions`, homonyme listé une
fois) : sous « Tous les serveurs », choisir un modèle homonyme montre une ligne
par serveur et le total, ce qui compare le même modèle d'un serveur à l'autre.
Une option par couple aurait fait doublon avec le filtre serveur. C'est pour ce
cas que le total ne dépend plus de « Tous les modèles ».

**Menus des filtres** : à la largeur de leur contenu (au moins celle de la
pilule, plafonnée), et non calés sur la pilule comme la base `.model-menu` ; le
corps du drawer est étiré à toute sa hauteur, sans quoi, avec un tableau court,
la boîte qui défile était plus basse que le menu ouvert et en rognait la fin.
Ouvrir une pilule referme celle qui l'était (`cfgPillSelect`, donc pour
toutes ses consommatrices) : le fermeur global au clic épargne tout clic dans
une `.cfg-pill-select`, y compris celui qui ouvre la voisine.

Les appels non mesurés n'entrent pas dans cette question : ils ont leur propre
colonne. Tout le texte du tableau est posé en `textContent` (noms de modèle
d'origine backend) ; les infobulles passent par `setTip`.

## Graphe

Dessiné entre la ligne de période et le tableau (`buildUsageChart`), sur la
même sélection et la même fenêtre (dessin arbitré le 2026-09-29,
lot AJ).

**Panneaux** : entrée, sortie, requêtes, empilés sur le MÊME axe du temps,
chacun titré et gradué. Pas d'axe double : sur un mois réaliste la sortie pèse
quelques pour cent de l'entrée, et ses barres, sur l'échelle de l'entrée,
resteraient collées à la ligne de base. L'entrée empile trois segments de bas
en haut : hors cache, servie par le cache, cache non renseigné ; les requêtes,
mesurées puis non mesurées. Une légende ne nomme que les segments présents
dans la période. **Pas de ventilation par modèle dans le graphe** :
elle ferait perdre la décomposition du cache (deux axes de couleur ne tiennent
pas dans une barre) et exigerait des couleurs catégorielles attachées au
modèle ; le tableau et le filtre modèle font ce travail.

**Bacs** (`usageBins(win, scaleId)`) : un par jour (« 1 semaine », « 1 mois »),
par 7 jours (« 3 mois », 13 bacs), par mois glissant au quantième (« 6 mois »,
« 1 an »). Comptés à rebours depuis la fin de la fenêtre, dans l'ordre
chronologique ; chaque bac mensuel est calculé DEPUIS aujourd'hui
(`usageAddMonths(end, -k)`), jamais en chaînant, pour que le repli d'un
quantième absent ne se propage pas et que deux bacs voisins restent contigus.
Un test de propriété le vérifie sur deux années de « aujourd'hui ». Sous
« 1 an », les bacs antérieurs à la première donnée restent vides à gauche :
c'est la fenêtre glissante, et l'échelle n'est proposée que si les données
dépassent « 6 mois ».

**Agrégation** (`usageBinTotals(records, bins)`) : les champs de
`USAGE_STATS_SUM_FIELDS` par bac, plus la décomposition de l'entrée. Chaque
ENREGISTREMENT (jour, serveur, modèle, nature) est classé à part par
`usageCacheState` : cache renseigné, même partiellement, → part hors cache et
part en cache (le cache borné à l'entrée) ; jamais renseigné → tout en « non
renseigné ». Classer le bac d'un bloc verserait dans « non renseigné » un
modèle qui renseigne son cache dès qu'un voisin du même jour ne le fait pas.
L'état de cache d'un BAC, lui, est celui du tableau (`usageCacheState` sur ses
sommes) : l'astérisque de l'infobulle a le même sens que celle du tableau. La
somme des bacs égale le total du tableau sur la même fenêtre (test).

**Repères calendaires** (`calendarMarkers(bins, granularity)`) : position en
fraction de la largeur des bacs, au prorata du jour dans son bac (bord gauche
du jour marqué). Mois (1ers) toujours, semaines (lundis) aux seules échelles
au jour ; un 1er qui tombe un lundi est un repère de mois ; rien au bord
gauche du graphe. Aux échelles au jour et à la semaine, un filet dans chaque
panneau, le mois un cran plus marqué ; aux échelles au mois, chaque bac
contient un 1er et un filet par bac ferait une seconde grille : une coche sur
l'axe seulement. Libellés (`usageMarkerLabel` : « sept. », « janv. 2026 »,
« 7 sept. ») posés par priorité, mois avant semaine ; celui qui en
chevaucherait un autre est retiré, celui qui sortirait à droite passe à gauche
de son filet (`placeUsageMarkerLabels`, APRÈS insertion dans le document : la
largeur d'un texte SVG ne se mesure pas hors document). « 1 semaine » étiquette
chaque bac (« lun. 28 sept. ») et laisse ses repères sans libellé.

**Axes** : trois pas ronds par panneau de tokens, un seul pour les requêtes
(`usageChartAxis`, pas de 1, 2, 2,5 ou 5 × 10ⁿ, jamais sous 1) ; graduations
en notation compacte sans zéros de queue (`formatUsageTick` : « 1,5 M »,
« 1 M »), compacte dès 1 000 et non 10 000 comme le tableau, pour qu'un même
axe ne mêle pas « 5 000 » et « 10 k ». Un pas est entier (2,5 devient 3).

**Survol** : la cible est la COLONNE entière du bac sur les trois panneaux
(`.usage-chart-hit`, HTML posé sur le SVG), jamais un segment de 3 px ; lavis
d'accent seul, sans atténuer les voisines. Infobulle MIAOU par `setTip`, texte
construit localement (`usageBinTitle`, `usageBinTipDetail` : entrée et cache,
sortie, requêtes dont non mesurées) — seulement des nombres et des dates,
aucun nom d'origine backend. Titres, légendes et graduations passent par
`textContent`.

**Accessibilité** : le graphe est un `role="img"` dont le nom résume la période
(`usageChartSummary`) ; **aucun arrêt de tabulation par bac** (décision de
Julien : jusqu'à 31 arrêts, pour des valeurs que le tableau porte déjà). Le
détail bac par bac reste à la souris.

**Couleurs** : dérivées de `--accent` (hors cache et sortie : l'accent ; cache :
l'accent atténué), sans jeton propre, donc elles suivent les palettes et le
thème. Le bleu du cache de l'inspecteur (`--ctx-cache`) n'est pas repris : en
palette Encre l'accent est bleu aussi. « Cache non renseigné » est un gris
neutre : `--surface-4` en sombre, `--text-3` en clair — `--border-2`, d'abord
envisagé, a été mesuré trop proche du cache pâle qu'il surmonte (écart ΔE OKLab
de 6,8 en vision normale, sous le plancher de lisibilité de 15). Espace de
surface de 2 px entre segments, bout arrondi de 4 px côté données, barres de
24 px au plus.

**Largeur** : le SVG est dessiné à la largeur MESURÉE du corps du drawer (un
`viewBox` étirerait le texte), et redessiné seul dès que cette largeur change
(`refreshUsageChart`, sur un `ResizeObserver` du corps et non sur `resize` : la
barre de défilement verticale qu'ajoutent le graphe et le tableau rétrécit le
corps sans que la fenêtre bouge), sans reconstruire les pilules dont un menu
ouvert se refermerait.

## Tests

- QuickJS (`tests/test-usage-stats.js`) : clef de jour, nature normalisée,
  prédicat de comptage, incrément (usage nul, sans cache, cache à 0, un seul
  compteur), fusion (sommes, nom réécrit, non-mutation), composition de
  `noteModelUsage` ; filtre de l'import, aller-retour export/import, ligne du
  rapport de stockage ; dates civiles (changements d'heure, repli du quantième,
  année bissextile), fenêtre de chaque échelle, échelles proposées, filtres,
  options de serveur (supprimé sous son dernier nom), totaux par couple
  (serveur, modèle), marque des homonymes et état du cache ; graphe : bacs
  (repli de fin de mois, bissextile, pavage sans trou sur deux années),
  repères (prorata, 1er qui tombe un lundi, bord gauche), agrégation par bac
  (classement par enregistrement, somme égale au total du tableau), axes,
  graduations, libellés, infobulle, nom accessible, géométrie des piles.
- Playwright (`.claude/skills/run-miaou/verify-usage-stats-collect.mjs`) :
  l'accroche réelle aux deux points réseau (tour d'outils, nature de chaque
  appel silencieux, Stop avant réponse, refus, bascule de serveur en cours
  d'appel), puis l'aller-retour par le zip RÉEL du bouton d'export et l'import
  en remplacement intégral. Le script stube lui-même le backend (`serve: false`)
  pour renvoyer un `usage` : le serveur factice commun n'en renvoie pas, et lui
  en ajouter changerait ce que mesurent les autres verify (inspecteur de
  contexte).
- Playwright (`.claude/skills/run-miaou/verify-usage-stats-view.mjs`) : la
  vue sur un store seedé — état vide, les entrées palette, réglages et fiche, échelles proposées et
  défaut, tableau (« n/d », astérisque et son infobulle), serveur supprimé dans
  le filtre, ouverture filtrée depuis une fiche, empilement et Échap, et les
  modèles homonymes (une ligne par serveur, suffixe sur les seuls homonymes,
  filtre modèle par nom, plus de suffixe sous un filtre serveur) ; enfin le
  rafraîchissement en place — aucune relecture drawer fermé (espion sur
  `readAllUsageStats`), ligne qui suit un nouvel appel sans rouvrir ni perdre le
  filtre, report tant qu'un menu de pilule est ouvert, et appel enregistré dans
  un second onglet (`usage-updated`). Rouge contre le code d'avant ; le dernier
  contrôle rougit seul quand on retire le `syncPost`.
- Playwright (`.claude/skills/run-miaou/verify-usage-stats-chart.mjs`) : le
  graphe dessiné sur un store seedé, valeurs attendues lues dans les purs
  vivants — à chaque échelle, nom accessible, aucun arrêt de tabulation, une
  colonne de survol par bac, repères aux jours et positions attendus, filets
  ou coche seule, libellés sans chevauchement ; hauteur d'une pile ; segment et
  légende « non renseigné » et « non mesurées » si et seulement si la sélection
  en contient ; infobulle d'un bac ; couleurs en clair et en sombre ; captures
  dans `shots-usage-chart/`. Chaque contrôle rejoué contre une régression
  injectée.
