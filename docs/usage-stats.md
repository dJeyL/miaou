# Statistiques de consommation de tokens (lot AJ)

MIAOU additionne ce que chaque appel de complétion a consommé, d'après les
compteurs renvoyés par l'API (`usage`), et le garde par jour, serveur, modèle et
nature d'appel. Ce fichier décrit la collecte, puis la consultation.

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

**Pas de broadcast**, par choix : aucun onglet n'affiche ces chiffres en continu,
la vue relira le store à chaque ouverture (`docs/multitab-sync.md`).

**Écriture sans ack ni trace dans le fil**, et c'est voulu : la règle « pas
d'écriture silencieuse en arrière-plan » vise le contenu écrit à l'initiative du
modèle (souvenirs, fichiers). Ces statistiques sont une télémétrie locale de
l'application, jamais un outil du modèle.

## Consultation

Drawer `#usage-drawer` (`drawer-wide`), rendu par `renderUsageStats`
(usage-stats.js), styles dans `src/css/usage-stats.css`.

**Trois entrées** : la palette (touche `u`), le bouton « Statistiques d'usage »
de Réglages › Connexion, et le glyphe « barres » de chaque fiche du drawer des
serveurs API (`.api-usage`, absent d'une fiche neuve comme la relecture), qui
ouvre la vue **filtrée sur ce serveur**. Le glyphe est réservé à cet usage. Le
drawer s'ouvre par-dessus les réglages et les serveurs sans rien fermer ; il
est suivi par `trackDrawer` (ui.js), donc Échap le referme seul. Il est déclaré
APRÈS le drawer des serveurs dans `index.html` : à z-index égal, c'est l'ordre
du DOM qui le fait passer devant.

**Relecture complète à chaque ouverture** (`readAllUsageStats`), jeton de
séquence contre une ouverture qui en double une autre. Le drawer ne se met pas à
jour pendant qu'il est ouvert : c'est la contrepartie de l'absence de broadcast.

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
`usageTotals` est le COUPLE, et le graphe ventilera par la même clef. Le
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

**Graphe** : pas encore livré. Bacs glissants (jour, semaine, mois au
quantième) et repères calendaires de semaine et de mois à leur position exacte
dans le bac.

## Tests

- QuickJS (`tests/test-usage-stats.js`) : clef de jour, nature normalisée,
  prédicat de comptage, incrément (usage nul, sans cache, cache à 0, un seul
  compteur), fusion (sommes, nom réécrit, non-mutation), composition de
  `noteModelUsage` ; filtre de l'import, aller-retour export/import, ligne du
  rapport de stockage ; dates civiles (changements d'heure, repli du quantième,
  année bissextile), fenêtre de chaque échelle, échelles proposées, filtres,
  options de serveur (supprimé sous son dernier nom), totaux par couple
  (serveur, modèle), marque des homonymes et état du cache.
- Playwright (`.claude/skills/run-miaou/verify-usage-stats-collect.mjs`) :
  l'accroche réelle aux deux points réseau (tour d'outils, nature de chaque
  appel silencieux, Stop avant réponse, refus, bascule de serveur en cours
  d'appel), puis l'aller-retour par le zip RÉEL du bouton d'export et l'import
  en remplacement intégral. Le script stube lui-même le backend (`serve: false`)
  pour renvoyer un `usage` : le serveur factice commun n'en renvoie pas, et lui
  en ajouter changerait ce que mesurent les autres verify (inspecteur de
  contexte).
- Playwright (`.claude/skills/run-miaou/verify-usage-stats-view.mjs`) : la
  vue sur un store seedé — état vide, les trois entrées, échelles proposées et
  défaut, tableau (« n/d », astérisque et son infobulle), serveur supprimé dans
  le filtre, ouverture filtrée depuis une fiche, empilement et Échap, et les
  modèles homonymes (une ligne par serveur, suffixe sur les seuls homonymes,
  filtre modèle par nom, plus de suffixe sous un filtre serveur).
