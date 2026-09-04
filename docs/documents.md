# Documents natifs (`docs__*`) — lot V

MIAOU ouvre seul cinq formats de document, sans serveur compagnon : archive zip,
PDF, classeur Excel, document Word, présentation PowerPoint. Ce fichier décrit
ce que chaque outil rend, comment chaque format est lu, et où vit quoi dans le
code. Le **registre** des quatre outils (`docs__list`, `docs__extract`,
`docs__read`, `docs__pack`) reste dans `docs/tools.md`, avec les autres.

## Où vit le code (lot V-7)

Le domaine a reçu son fichier au lot V-7 : `src/js/docs.js`, inséré dans
`JS_ORDER` juste après `utils.js` et avant tous ses consommateurs. Il porte le
sniff de type aux octets, les fonctions pures de chaque format, les lecteurs qui
pilotent les bibliothèques lazy-loadées, la table `DOC_READERS` et les
descripteurs de bibliothèque.

**La ligne de partage avec `utils.js`** — à tenir, c'est le seul vrai coût du
découpage :

| Fichier | Ce qu'il porte |
|---------|----------------|
| `docs.js` | le zip et les formats de bureautique **comme DOCUMENTS** — ce qu'on ouvre pour en lire le contenu |
| `utils.js` | le zip **comme MÉCANIQUE DE CONTENEUR** — `parseZipCentralDirectory`, `isZipSlipPath`, `decideZipMemberExtraction`, `zipMemberMime`, `zipMemberBaseName`, `buildZipMemberName`, `validateZipPlan`, `normalizeArchiveName`, `sniffBackupFormat` |

Ces primitives restent dans `utils.js` parce que **le lot V n'en est qu'un
consommateur parmi d'autres** : `docs__pack` (V-2) écrit des archives, l'export
de sauvegarde (V-3) en fait des sauvegardes, et ni l'un ni l'autre ne lit un
document. `decideZipMemberExtraction` en particulier a servi hors de son chemin
d'origine sans adaptation — la ranger sous « documents » démentirait ce que V-3
a établi.

**Test décisif pour toute fonction future** : *« si le lot V n'existait pas,
cette fonction aurait-elle encore une raison d'être ? »* Oui → `utils.js`.
Non → `docs.js`.

**L'invariant de dépendance, formulé exactement** (relecture 2026-08-29) :
**aucune fonction restée dans `utils.js` n'appelle une fonction de `docs.js`.**
C'est ce sens-là qui est gardé, et c'est lui qui empêche le découpage bâclé que
le PLAN V-5 redoutait — deux fichiers en amont l'un de l'autre, pire que l'état
d'avant. Il se vérifie par grep, et il est vérifié : zéro occurrence. **Refaire
ce contrôle à chaque ajout.**

Ce n'est **pas** « `docs.js` n'appelle que `utils.js` ». Le domaine s'appuie sur
des fonctions déclarées **plus bas** dans `JS_ORDER`, toutes depuis des corps de
fonction (runtime, après chargement complet) — c'est légal et voulu :
`toolFail`, `_pendingToolAcks` et `docsUnsupportedFormatMessage` (`tools.js`),
`humanSize` (`resources.js`), les quatre `ensure*` (`ui.js`). Un grep
« `docs.js` ne cite aucun symbole aval » sortirait donc **rouge sans qu'il y ait
la moindre régression** : ne pas le lire comme tel.

C'est aussi ce qui justifie que `docsUnsupportedFormatMessage` soit **restée
dans `tools.js`** : elle lit le registre MCP (`findDocsInflationTool`) et répond
à « quel outil serveur est branché ? », pas à « comment lire ce document ? ». La
raison est le **domaine**, pas un interdit d'appel — `docs.js` l'appelle bien.

Ce que `docs.js` **ne porte pas**, délibérément : les schémas d'outils `docs__*`
(le registre `TOOLS` est une liste unique, elle ne se fragmente pas par
domaine), `DOCS_DOCTRINE` (aux côtés des autres doctrines de
`ROOT_SYSTEM_PROMPT`), et les lazy-loads CDN `ensureFflate`/`ensurePdfJs`/
`ensureSheetJs`/`ensureMammoth` (`ui.js`, où vivent **tous** les lazy-loads du
projet — Mermaid, Prism, QuickJS).

**Côté tests**, la même frontière : `tests/test-zip.js` couvre la mécanique zip,
`tests/test-docs.js` le domaine documents. Elle était déjà pratiquée depuis V-1,
et c'est elle qui a servi de patron au découpage du code.

## Contexte permanent vs skill système (lot V-7)

Le namespace `docs__` a grossi à chaque sous-lot : quatre outils, cinq formats,
et une doctrine devenue la plus grosse de `ROOT_SYSTEM_PROMPT`. Tout cela était
payé **à chaque tour**, y compris dans les conversations sans le moindre
document.

V-7 applique le split QUAND/COMMENT déjà pratiqué sur `js-eval` :

| | Où | Quoi |
|---|---|---|
| **QUAND** | `DOCS_DOCTRINE` (tools.js) | un fichier binaire joint n'est pas lisible directement ; MIAOU ouvre seul cinq formats (zip, PDF, Excel, Word, PowerPoint) ; le geste est `docs__list` d'abord ; le natif prime sur le serveur ; appeler sans attendre qu'on le demande |
| **COMMENT** | skill système `docs` (`src/system-skills/docs.md`) | la forme du selector format par format, quand passer `as_resource`, comment lire chaque refus, le cas Office-vu-comme-zip, `docs__pack` |

**La liste des cinq formats reste en doctrine délibérément.** C'est le
déclencheur : sans elle, un modèle ne sait pas qu'un `.pptx` s'ouvre, et une
skill qu'il n'a aucune raison de lire ne le lui apprendra pas. La doctrine ne
doit pas devenir un pointeur nu.

**Effet mesuré** — total `docs__*` en contexte permanent : **6 723 → 5 278
caractères**.

| Bloc | Avant | Après |
|------|-------|-------|
| `DOCS_DOCTRINE` | 2 769 | 1 869 |
| schéma `docs__read` | 1 966 | 1 421 |
| schéma `docs__list` | 721 | 721 (inchangé) |
| schéma `docs__pack` | 684 | 684 (inchangé) |
| schéma `docs__extract` | 583 | 583 (inchangé) |

`docs__list` et `docs__pack` n'ont pas été allégés **à dessein** : leurs
descriptions sont du QUAND, pas du mode d'emploi. L'énumération de ce que rend
un listing est ce qui fait qu'un modèle sait quoi en attendre ; la couper
coûterait du réflexe d'appel pour un gain marginal.

Sur `docs__read`, l'allègement a révélé une **duplication** : la description de
l'outil répétait les quatre formes de selector déjà données par le champ
`selector`. Sur les 545 caractères gagnés, la totalité vient de là.

**Le filet qui rend l'allègement sûr** : un selector mal formé est refusé par un
message qui **rappelle la forme attendue** (`parsePageSelector`,
`parseSheetSelector`, `resolveDocxSection` le font tous les trois — garde posée
délibérément en V-4). Un modèle qui appelle sans avoir lu la skill perd un tour ;
il ne se trompe pas silencieusement. C'est le contrat déjà accepté pour
`js-eval`.

**Aucune constante chiffrée dans la skill** : une skill système n'est pas
rebuild depuis le JS, un cap recopié y dériverait en silence. Les caps se citent
par renvoi — « le message de refus te donne le chiffre », ce qui est vrai de
tous les refus.

**Ce que V-8 y a ajouté** (livré) : le §PDF de la skill a bien été **mis à jour**
plutôt que doublé d'une skill nouvelle — c'était le critère qui avait fait
choisir une skill unique plutôt qu'une par format. Il porte désormais le sommaire
numéroté, `docs__render_page` (une page à la fois, ses trois motifs), et la
consigne sur l'**OCR de mauvaise qualité**. La doctrine, elle, n'a gagné que le
QUAND (trois lignes) : le COMMENT reste dans la skill, le split V-7 tient.

## Ce que chaque outil rend

**Ouverture native d'archives (lot V-1, `docs__*`) :**
- `docs__list(ref)` — liste les membres d'une archive zip désignée par handle
  (`att-N` / `file-<id>` / `res_<id>`) **sans rien décompresser** : le *central
  directory* suffit, donc fflate n'est même pas chargé sur ce chemin. Handler
  **asynchrone depuis V-4** (il était le seul du couple à être synchrone : le
  lazy-load d'un lecteur PDF l'a fait basculer ; `callInternalTool` mappe déjà
  les handlers thenables, la branche zip reste synchrone dans les faits). Rendu
  par `formatZipListing`
  (utils.js, pur) : nom et taille décompressée par membre, nature de l'archive
  (zip brut ou document Office, via `sniffZipOfficeKind`), total décompressé, et
  **mention explicite des membres écartés avec leur motif** (chiffré, chemin non
  sûr) — un membre manquant sans explication fait halluciner le modèle. Un
  membre au-delà du cap est marqué, pas retiré : le listing **décrit**, il ne
  refuse rien.
- `docs__extract(ref, path)` — matérialise **UN** membre en ressource `res_…`
  adressable, consommable par `js__eval`. Handler **asynchrone** (lazy-load
  fflate via `ensureFflate`, ui.js — patron `ensureQuickJs`, échec **propagé**).
  Chaîne : `resolveHandleRecord(ref, ctx)` (**`ctx` explicite**, piège 28) →
  `parseZipCentralDirectory` → `decideZipMemberExtraction` (utils.js, pure) →
  `unzipSync` avec filtre ciblé → `_storeBlock` → **`formatInlineHandleForModel`**.
  Jamais `_makeResourceRef` : un `[resource_ref:…]` vers un record classe
  `'inline'` ré-inlinerait le membre entier au tour suivant (piège 26c).
- **Les cinq refus vivent dans `decideZipMemberExtraction`** (pure, testée),
  prononcés sur le SEUL central directory donc **avant toute allocation** :
  membre introuvable, répertoire, **chiffré**, zip-slip, au-delà de
  `MAX_INLINE_BYTES`. Le refus de cap est un `result` texte **non-`isError`**
  cadré pour que le modèle re-cible dans le tour (doctrine du cap `js__eval`,
  piège 25) — jamais une troncature.
- **La garde de chiffrement est la garde du lot.** fflate **ne détecte pas** les
  membres protégés par mot de passe : il rend des ordures binaires *sans lever
  d'erreur*, que le modèle lirait comme du contenu valide. D'où la lecture
  manuelle du **bit 0 du general purpose flag** dans le central directory
  (`parseZipCentralDirectory`). Ne jamais la retirer au motif que « fflate
  n'a pas planté ».
- **Encodage des noms de membres.** Le format zip en connaît deux, discriminés
  par le **bit 11** du general purpose flag (le même champ que le bit 0 de
  chiffrement, lu une fois) : posé → UTF-8, absent → jeu historique CP437.
  `_zipDecodeName` bifurque dessus. Le repli non-UTF-8 est un décodage
  **octet-à-octet** (« latin-ish »), pas une vraie table CP437 : il est retenu
  parce qu'il est **total et stable** — jamais de U+FFFD. C'est l'enjeu réel,
  et il n'est pas cosmétique : `docs__extract` compare `e.name === path` à
  l'identique, donc un nom décodé en caractère de remplacement serait affiché au
  modèle puis **rejeté au ciblage**, rendant le membre inatteignable. Un accent
  d'archive Windows ancienne s'affiche donc de travers, mais reste extractible.
- **Zip64 non géré, délibérément.** Le nombre d'entrées est lu sur 16 bits et
  l'offset du central directory sur 32 : une archive de plus de 65535 membres
  ou dépassant 4 Go sortirait un listing tronqué. Le cap d'entrée à
  `MAX_INLINE_BYTES` (64 Mo) rend le cas « trop gros » inatteignable ; seul
  « beaucoup de petits membres » le serait, jugé assez improbable pour ne pas
  payer l'EOCD64 (décision Julien, relecture V-1). À rouvrir si un cas réel
  apparaît.
- **Double garde de taille assumée** : `decideZipMemberExtraction` refuse sur le
  `size` du central directory (champ **déclaratif, donc falsifiable**), puis le
  `filter` fflate re-teste `originalSize` avant décompression. Jamais confiance à
  un seul des deux — ce n'est pas un oubli de dédoublonnage.
- **Deux acks par extraction réussie** : `_storeBlock` pousse déjà
  `resource_stored`, `docs__extract` ajoute le sien (précédent `fetch_url`, lot
  Gbis). Signalé, laissé tel quel — « on verra à l'usage ».
- **Le libellé « archive zip » des deux descriptions était daté V-1** (décision
  Julien, consignée dans `00-META.md`). **V-4 l'a élargi** : `docs__list` parle
  désormais de « document » et `docs__read` est né multi-format. `docs__extract`
  garde son libellé « archive », lui : il ne sert qu'aux conteneurs zip (un PDF
  n'a pas de membre à extraire — c'est `docs__read(as_resource)` qui joue ce
  rôle). Invalidation ponctuelle du préfixe KV assumée (piège 16).
- **Cohabitation natif / serveur.** `DOCS_DOCTRINE` est **statique et
  inconditionnelle** : elle ne connaît jamais l'état de branchement MCP (piège
  16 — sinon le prompt système bougerait à chaque connexion/déconnexion). Elle
  aiguille par type (archive et **PDF depuis V-4** → natif ; Office → outil
  serveur *s'il est fourni*), sur le motif à deux blocs de `WEB_DOCTRINE`, la
  conditionnalité
  étant **lue par le modèle**. Le cas dégradé est rattrapé par l'outil :
  `docsUnsupportedFormatMessage(record)` (tools.js, impure par nature) lit
  `findDocsInflationTool()` **au moment de l'appel** et nomme l'outil serveur
  réellement branché, ou dit qu'il n'y en a aucun.
- **Un `.docx` EST un zip** et le natif sait mécaniquement l'ouvrir : il l'ouvre
  donc si on le lui demande, et le sniff Office sert à l'**annoncer** dans le
  listing (« membres XML bruts »). La doctrine oriente malgré tout vers l'outil
  serveur tant qu'il existe, parce qu'il en extrait le texte utile là où le natif
  ne livre que du XML. Filet avant V-5, pas un remplacement.
- **Description automatique d'un fichier de bibliothèque** : pour une
  archive, `extractBinaryFileTextForDescription` (tools.js) bifurque **en amont**
  de `findDocsInflationTool()` et renvoie le listing natif comme texte de
  description — noms et tailles décompressées indicatives, jamais le contenu d'un
  membre. Le chemin garde sa posture : **aucun ack** (l'ingestion peut survenir
  hors conversation, d'où `mcpRpc` et non `callRemoteTool`), dégradé, jamais
  bloquant. Placée avant le chemin serveur pour que MIAOU seul décrive quand même
  ses archives : le `console.warn` du dégradé ne doit pas masquer un format que
  le natif sait traiter.

**Lecture native de PDF (lot V-4, `docs__read`) :**
- **Le type est reconnu AUX OCTETS**, jamais au mime ni à l'extension.
  `sniffDocumentKind(u8, name)` (docs.js, pur) rend `'pdf' | 'zip' | 'docx' |
  'xlsx' | 'pptx' | null` — `%PDF` en tête, sinon `PK\x03\x04` puis délégation à
  `sniffZipOfficeKind`. Le paramètre `name` est en signature mais **ne décide
  rien** : le mime d'un attachment vient du navigateur, celui d'un membre de zip
  d'une table d'extensions, tous deux déclaratifs. Précédent suivi :
  `sniffBackupFormat` (V-3).
- **`DOC_READERS` (docs.js) est la table de dispatch ET la source unique de
  « quels formats MIAOU ouvre-t-il seul ? »**. `docsUnsupportedFormatMessage`
  en dérive son libellé via `nativeDocKinds()` + `formatNativeDocKindsLabel`
  (utils.js, pur) au lieu de le recopier : la formule « ne gère à ce jour que le
  zip » était en dur depuis V-1 et aurait menti au premier format ajouté — or
  c'est le message sur lequel le modèle décide s'il doit chercher un serveur.
- **Le zip est une entrée de la table comme les autres** (`listZipDocument`),
  et les quatre types Office y sont inscrits **explicitement** plutôt que
  laissés en retombée : sans ça, `nativeDocKinds()` ne les annoncerait pas et le
  message de refus mentirait par omission. Le zip n'a l'air d'une exception que
  vu du listing (qui ne charge rien) ; son extraction lazy-load fflate exactement
  comme un PDF charge pdf.js. Ce sont `list` et `read` qui ont des besoins
  différents, pas le zip qui serait d'une autre nature.
- `docs__read(ref, selector, as_resource?)` — lecture **par unité** : `'N'` ou
  `'N-M'`, 1-indexé inclusif, clampé à `[1, total]` **avec notice** quand le
  clamp a lieu (portage du FMT4 serveur : un `'5-100'` sur 10 pages servait
  silencieusement 5-10, et le modèle concluait que le document s'arrêtait là).
  Parsing dans `parsePageSelector` (docs.js, **pur**), qui rend
  `{ok, start, end, notice}` ou `{ok:false, message}` — le serveur *lève*, ici
  on retourne : facture de `decideZipMemberExtraction`, et un pur qui ne jette
  pas reste testable en QuickJS. **Chaque message d'erreur rappelle la forme
  attendue** (le modèle écrit `'page 3'` et se fait refuser — un refus muet
  coûte un tour de plus).
- **Écart assumé au principe « aucune perte de capacité »** (décision 2, le seul
  du lot) : la fenêtre `char_start`/`line_start` du serveur n'est **pas** portée.
  Ce qui est perdu : « lis les lignes 500-800 de la page 3 » en un appel. La
  raison : MIAOU a déjà une pagination fine et plus puissante — `js__eval` — et
  en faire naître une seconde, concurrente, coûterait le portage de
  `_apply_range` (69 lignes denses, quatre notices, le cas « la ligne unique
  dépasse le cap » déjà payé côté serveur en F7). La contrepartie est
  `as_resource` + `js__eval`, en deux appels, sur n'importe quelle taille.
- **`as_resource: true`** range la lecture dans un `res_…` (`text/plain`,
  classe `'inline'`) au lieu de la renvoyer en contexte, nommé par
  `pdfReadResourceName` (docs.js, pur — `rapport.pdf` + pages 2-5 →
  `rapport-p2-5.txt`). Sans lui, la sortie est plafonnée à `JS_EVAL_OUTPUT_CAP`
  et un dépassement est un **REFUS explicite renvoyant vers `as_resource`**,
  jamais une troncature (doctrine du cap `js__eval`, piège 25). Comme
  `docs__extract`, le retour passe par `formatInlineHandleForModel` et
  **jamais** `_makeResourceRef` (piège 26c).
- **Le texte d'une page est reconstitué, pas concaténé.** `getTextContent()` de
  pdf.js ne met **aucun séparateur** entre ses items : un `items.map(it =>
  it.str).join('')` rend deux phrases collées, là où pymupdf rend des sauts de
  ligne — sans traitement, le natif serait **moins lisible** que le serveur.
  `joinPdfTextItems` (docs.js, pur) s'appuie sur `item.hasEOL` (présent en 3.x,
  confirmé sur un PDF réel de 8 pages), avec repli par comparaison d'ordonnée
  (`transform[5]`) dont le seuil se dérive de la hauteur de l'item — une police
  de 6 pt et une de 24 pt ne sautent pas de la même distance.
- **Les pages sans texte sont SIGNALÉES**, jamais rendues comme un blanc
  (`formatPdfRead`, docs.js, pur). Une page vide est presque toujours une page
  **scannée** ; sans notice, le modèle reçoit du vide et conclut que le document
  ne dit rien — le mode de défaillance du zip chiffré de V-1, du silence pris
  pour une réponse. La notice nomme la cause probable, dit que MIAOU ne fait pas
  d'OCR, et demande au modèle de le **dire**. **Depuis V-8 la notice porte une
  ISSUE** et pas seulement un constat : elle renvoie vers `docs__render_page`.
  **Formulée à l'indicatif, jamais « si tu as la vision »** (cf. la section sur
  le rendu image, plus bas) : un modèle n'a pas d'introspection fiable sur ses
  propres modalités, et une condition qu'il ne peut pas évaluer le pousse vers
  la branche prudente. Le repli reste offert, mais sur un fait constatable
  **après coup** (« si tu ne parviens pas à la lire »).
- **Le sommaire porte ses numéros de page (parité rétablie, lot V-8).**
  `getOutline()` de pdf.js rend un arbre dont chaque nœud porte une
  **destination** (`dest`), pas un numéro ; `resolveOutlinePage` (docs.js) la
  résout par `doc.getPageIndex()`, et le listing rend `- p.42 Titre` comme
  `get_toc()` de pymupdf (`mcp_docs/formats.py`). C'était le **seul écart de
  parité du lot V**, resté ouvert de V-4 à V-8 parce qu'un commentaire de
  `listPdfDocument` affirmait l'équivalence exacte avec `get_toc()` — le lecteur
  suivant faisait confiance et passait.
  - **Deux formes de `dest`**, et la seconde n'est pas théorique : un **tableau**
    déjà résolu (le cas courant — 372/372 entrées de `big-toc.pdf`), ou une
    **chaîne** (destination *nommée*) qu'il faut passer par `getDestination()`.
    La fixture `named-dest-toc.pdf` n'a que des nommées, dont deux pointant vers
    un nom absent de l'arbre `/Names`.
  - **Dégradation PAR ENTRÉE, jamais globale** : une destination non résoluble
    laisse `page: 0` sur SON entrée — le titre reste, le préfixe est omis — et
    n'affecte ni les autres ni le listing. `resolveOutlinePage` ne jette jamais.
  - **Aucune borne, et c'est mesuré** : les résolutions partent en un seul
    `Promise.all`, soit **1,4 ms pour 372 entrées** sur trois niveaux
    (`spike-v8-pdf.mjs`, 2026-08-29 ; le séquentiel mesuré à 6,5 ms serait lui
    aussi indolore). Une borne « les N premières entrées » avait été envisagée
    puis abandonnée : elle aurait coûté un message de troncature et un sommaire
    hétérogène pour économiser une milliseconde.
  - **Le piège de la coercition**, payé à l'écriture et gardé par un test :
    `Number(null)` vaut `0`, donc un `Math.floor(Number(idx))` naïf transforme une
    destination non résoluble en **page 1**. `outlinePageFromIndex` (pur, testé)
    teste le TYPE d'abord. C'est la raison d'être de son extraction : la fonction
    async n'est pas testable en QuickJS, l'arithmétique l'est.
- **PDF protégé : refus métier, pas erreur technique.** `getDocument` rejette
  avec `PasswordException` — contrairement à fflate sur un zip chiffré, qui rend
  des octets bruts sans rien dire (AUDIT §3, le piège majeur de V-1). C'est
  pdf.js qui nous l'épargne, pas notre vigilance. Posture : ack rouge
  (`ok:false`, lu par `ackIsError`) mais result texte **non-`isError`**, pour que
  le modèle puisse le dire sans que la boucle d'outils soit coupée (piège 25).
- **`ensurePdfJs` (ui.js) résout « pdf.js PRÊT, worker compris »**, jamais « le
  script est chargé » — aucun appelant ne pose `workerSrc` lui-même (même
  contrat qu'`ensureQuickJs`, qui résout le module WASM compilé). Le **worker
  réel en `blob:`** est une décision (1), pas un raffinement : le *fake worker*
  parse en **thread principal** (1 106 ms pour 3 pages au spike), donc des
  dizaines de secondes de gel sur un rapport de 200 pages — pendant lesquelles
  une génération en vol (piège 28) se figerait avec l'UI. Le détour par `blob:`
  est obligatoire (un worker ne se charge pas cross-origin depuis un CDN) et
  reste compatible d'une page `file://`. Coût : +1,09 Mo au premier PDF ouvert.
- **Dépendance GELÉE à `pdfjs-dist@3.11.174`** : pdf.js 4.x et 5.x n'existent
  plus qu'en modules ES (`legacy/` compris, vérifié au spike). La contrainte dure
  MIAOU « pas de modules ES » fige la version sur la dernière UMD publiée. Cette
  branche ne suivra pas l'amont.
- **`data` est passé en COPIE à pdf.js** (`u8.slice()`) : pdf.js **transfère** le
  buffer, et sans copie le record du cache session ressortirait détaché pour tout
  appel ultérieur.

### Le rendu image d'une page (`docs__render_page`, lot V-8)

Un modèle à vision peut lire une page que l'extraction de texte ne donne pas —
page scannée, schéma, graphique, tableau mis en forme, ou texte issu d'un OCR
trop abîmé pour être exploitable. `docs__render_page` rend **une** page en PNG et
la lui montre. Ce n'est **pas de l'OCR** : MIAOU rend, le modèle lit. C'est un
élargissement de périmètre, pas de la parité — `mcp_docs` ne le fait pas non plus.

- **Une page rendue EMPRUNTE LE CHEMIN DES PIÈCES JOINTES, et c'est ce qui fait
  tout tenir.** Le record est créé par `storeAttachment` (donc porteur d'un
  `attId`), l'ack porte `kind: 'attachment_recalled'`, et les pixels partent par
  `_pendingImageInjections` — exactement comme `recall_attachment`. Il n'y a
  qu'**un seul** chemin d'entrée d'image dans le contexte (piège 19), et il est
  adressé par `attId` : `resolveRecallImages` cherche
  `getCachedRecordByAttId(m.attId, m.convId)`. Un `res_…` de classe `binary`
  (`_storeBlock`) n'a pas d'`attId` — ses pixels n'entreraient jamais dans le
  contexte, et l'y faire entrer aurait demandé un **second prédicat de
  ré-injection** à maintenir en parallèle du premier.
- **Ce que ça donne gratuitement** : la persistance byte-stable (piège 17 — le
  message user est réécrit une fois en descripteur figé), la ré-injection aux
  envois ultérieurs, le téléchargement depuis l'ack, la dégradation vision-less
  (`imageDescriptors`), et surtout la **purge de contexte** — au tour suivant il
  ne reste qu'un descripteur léger, pas 1,5 Mo de base64. Sans ce chemin, un
  examen de dix pages laisserait dix images pleine résolution jusqu'à la fin de
  la conversation. (La **vignette et le lightbox** faisaient partie de cet
  héritage jusqu'à la décision d'affichage ci-dessous : le bloc image n'est plus
  posé pour ce producteur, seul l'ack reste.)
- **Deuxième consommateur de `renderPdfPageImage` (lot V-9)** : la description
  d'un PDF **scanné déposé dans la bibliothèque d'un Espace** appelle la même
  fonction, hors de toute conversation et sans passer par le chemin des pièces
  jointes (il n'y a ni `attId`, ni thread, ni ack — l'image ne sert qu'à un
  `silentCompletion` applicatif, jamais au contexte d'une conversation). Ce qui
  reste partagé est le **rendu** : caps, échelles de dégradation, refus explicite
  au-delà de `PDF_RENDER_MAX_B64`. Un second chemin de rendu aurait divergé en
  silence sur ces trois points. Détail du chemin de description :
  `docs/spaces.md`, section « Descriptions de fichiers ».
- **`origin: 'docs_render'` distingue les deux producteurs du même kind**, et ne
  gouverne **que l'affichage** — libellé (`docsRenderAckHead`, docs.js, pur),
  icône (`ICON_IMAGE` vs `ICON_EYE`) et **présence à l'export** (ci-dessous),
  jamais le routage. Le kind reste commun parce que c'est lui que
  `resolveRecallImages` reconnaît. Champ ajouté à `ACK_COPY_FIELDS`.
- **L'image n'est affichée NI à l'écran NI dans l'export.** Une page rendue est
  une **donnée de travail du modèle** : l'utilisateur a déjà le document source,
  et l'image n'existait que pour donner à lire ce que l'extraction de texte ne
  rendait pas. Ce qui reste dans le fil, c'est l'**ack** — son libellé et son
  **bouton de téléchargement** (`ackDownloadTarget` couvrait déjà ce kind, rien à
  ajouter). Poids : une seule page pesait **plus que tout le reste d'un export**
  (1,6 Mo mesuré pour une conversation de quatre messages, ramené à 1 329
  caractères). Décision Julien, 2026-08-29.
- **Un seul prédicat pour les deux surfaces : `ackImageIsDisplayable(ack)`**
  (utils.js, pur), consulté par `placeToolAck` (écran) **et** par
  `exportableAckImageKey` (export). Deux filtres écrits séparément divergeraient
  en silence au premier changement — c'est exactement ce qui s'était produit au
  lot Gbis (une image visible en live, absente de l'export). Une seule exclusion
  aujourd'hui : `origin === 'docs_render'`.
- **Ce que le changement ne touche PAS** : une image que le modèle est allé
  **chercher** (`fetch_url` et son sous-produit `resource_stored`,
  `resource__present`) reste affichée et exportée — c'est un contenu demandé, pas
  un intermédiaire de lecture. Idem pour le **rappel d'une pièce jointe** fournie
  par l'utilisateur. Deux tests purs et deux contrôles du verify gardent cette
  voie.
- **L'échappatoire explicite, et c'est pourquoi l'exclusion porte sur l'ORIGINE
  et non sur le record** : l'utilisateur peut demander à voir la page, et
  `resource__present` sur l'id du record (`att_…`, présent au cache session comme
  n'importe quelle ressource) la **réaffiche** — l'ack est alors
  `resource_presented`, qu'aucune règle n'exclut. Ce n'est pas un trou : c'est la
  distinction entre un intermédiaire de lecture (masqué par défaut) et un
  affichage **explicitement demandé** — quand l'utilisateur demande la chose, sa
  demande fait foi. Vérifié par sonde puis figé en contrôle du verify.
- **Le tool result désigne le MODÈLE comme destinataire de l'image.** Il disait
  « rendue en image et **affichée à l'utilisateur** » ; c'est le dernier texte
  que le modèle lit avant de recevoir les pixels, et un modèle à vision en a
  conclu — raisonnement à l'appui — que c'était *l'utilisateur* qui avait la
  vision, et a failli s'abstenir. Il dit désormais « MIAOU **te** la montre ».
  L'image apparaît aussi dans le fil, mais ce n'est pas ce que ce message a à
  dire au modèle. Un contrôle du verify garde la formulation.
- **Le libellé dérive de `DOC_ACK_UNITS`, jamais d'un littéral** : « Page 3 rendue
  en image › rapport.pdf ». Le rendu est PDF-only aujourd'hui, donc `'Page '` en
  dur serait *juste* — et c'est exactement le piège que `docsReadAckHead` a payé
  **deux fois** (« Page » en dur révélé par la slide en V-5, `sourceName` révélé
  par le docx). Un test garde la dérivation.
- **`icon` d'`ACK_KINDS` accepte désormais une FONCTION** (comme `label` le
  faisait déjà), résolue au seul point de consommation (`buildToolAck`, ui.js).
  La garde de sécurité est intacte : la fonction **choisit parmi les constantes
  `ICON_*`**, elle n'en fabrique aucune — rien d'origine modèle n'entre là.
- **UNE PAGE PAR APPEL, structurellement** : le paramètre est un entier, pas une
  plage. Ce n'est pas une valeur à surveiller mais une **forme d'API** — c'est
  elle qui applique le « jamais de rendu en lot », chaque page coûtant du
  contexte.
- **Outil séparé plutôt qu'un booléen `as_image` sur `docs__read`** : `as_resource`
  existe déjà, deux booléens sur un même outil font trébucher les modèles faibles,
  les deux ne sont pas orthogonaux (`as_image + as_resource` n'a aucun sens), et
  surtout le **contrat de sortie change de nature** — un texte d'un côté, une
  annonce plus une injection d'image de l'autre. Coût assumé : un schéma de plus
  à chaque tour, borné par une description courte (le COMMENT est dans la skill).
- **Échelle et cap, MESURÉS** (`spike-v8-pdf.mjs`) : `scale: 2` (≈144 dpi, le
  viewport pdf.js étant à 72), cap de **4 Mo sur la dataUrl base64** — c'est elle
  qui part dans le contexte, pas les octets bruts. Dégradation à `1.5` puis `1`
  avant abandon, pour qu'une page hors norme (plan A0) reste lisible plutôt que
  de fermer la porte. Le pire cas mesuré (A4 scannée pleine page) pèse **1,50 Mo,
  soit 37 % du cap** : aucune fixture ne déclenche la dégradation. Débordement
  final = **refus explicite**, jamais une troncature (doctrine du cap js__eval,
  piège 25).
- **PNG et pas JPEG**, alors que le ratio mesuré est de ×3,6 à ×4,7 en faveur du
  JPEG : ses artefacts de compression dégradent exactement le matériau qu'on
  demande au modèle de déchiffrer (texte fin d'un scan). La condition qui aurait
  fait basculer — « PNG déborde régulièrement le cap » — ne se réalise pas.
- **`<canvas>` détaché, pas `OffscreenCanvas`.** Les deux fonctionnent avec
  pdf.js 3.11.174 (vérifié), mais `OffscreenCanvas` n'a pas `toDataURL` : il
  faudrait `convertToBlob()` + `FileReader`, soit un `await` de plus pour rien.
  Chaque tour de dégradation rend sur un canvas **neuf** — réutiliser le
  précédent laisserait les pixels de l'échelle supérieure sous une page
  transparente.
- **L'`attId` est RÉSERVÉ avant tout `await`** (`reserveAttIdFor`, resources.js) :
  lecture, incrément et persistance dans la même passe synchrone.
  `persistConversationField` mutant le cache mémoire de façon synchrone, un
  second appel relit un compteur déjà incrémenté même si l'écriture IDB est
  encore en vol. Conséquence assumée : un stockage qui échoue après l'allocation
  consomme son numéro — `allocateAttId` est documenté monotone, un trou dans la
  séquence n'a aucun sens fonctionnel.
- **`reserveAttIdFor` est le SEUL allocateur d'`attId`, et le composer y a été
  aligné.** Il faisait l'inverse — allouer, stocker, persister après l'`await` —
  et cet ordre tenait tant qu'il était seul : sa fenêtre était fermée par la
  **sérialisation** de l'ingestion d'une `FileList` (`attachIngestInFlight`).
  Deux générations parallèles (piège 28) ne sont sérialisées ni entre elles ni
  avec le composer : la même séparation leur donnerait le même `att-N`, et
  `getCachedRecordByAttId` rend le **premier** record trouvé — la ré-injection
  cross-turn et le bouton de téléchargement serviraient la mauvaise image. Un
  allocateur, un ordre, plutôt que deux qui se contredisent.
- **La conversation ciblée est celle de la GÉNÉRATION** (`ctx.convId`, piège 28),
  jamais celle affichée — d'où le `convId` **explicite** en argument plutôt
  qu'une lecture de `currentConvId` : une génération d'un autre Space ne doit pas
  poser son compteur sur l'écran.
- **`dataUrlBase64Payload` (docs.js, pur) découpe le préfixe** avant
  `base64ToArrayBuffer`. Passer la dataUrl entière « marcherait » en apparence —
  le filtre de caractères de `base64ToArrayBuffer` mange le préfixe — mais
  `data:image/png;base64` contient des lettres **valides en base64**
  (`dataimagepngbase`), qui décaleraient tout le flux d'octets. Un octet de
  décalage sur un PNG, et l'image est illisible.
- **Description automatique d'un fichier de bibliothèque : le PDF rejoint la
  bifurcation** (décision 3, `describePdfForLibrary`). Un fichier décrit par son
  **contenu** vaut mieux qu'un mime et une taille, et la version serveur savait
  déjà le faire — ne pas suivre ferait *régresser* la description en rapatriant.
  Ce chemin tourne **hors conversation**, au dépôt d'un fichier : il déclenche
  donc le lazy-load de pdf.js sans qu'aucune conversation ne l'ait demandé. La
  variante « seulement si pdf.js est déjà chargé » a été **écartée** — elle
  rendait la description non déterministe, pire qu'un téléchargement. Trois
  gardes : **bornée** (métadonnées + sommaire + première page, plafonné —
  jamais le document entier), **dégradée jamais bloquante** (échec → `null`,
  retombée sur le chemin serveur, et en dernier ressort description vide : un
  fichier doit toujours pouvoir être déposé), et **sans `console.warn`** (leçon
  U-1 : un warn sur un chemin d'infrastructure achète du silence, pas de la
  robustesse — l'échec se voit à la description absente).
- **Ack `docs_read` distinct de `docs_list`** : l'utilisateur doit lire « Pages
  2-5 lues », pas « Document listé ». Le `selector` de l'ack porte les bornes
  **effectivement servies**, pas la demande brute — ce qui s'affiche est ce qui a
  été lu, y compris après un clamp. `ACK_COPY_FIELDS` gagne `selector` (une
  ligne, jamais une copie manuelle dans `main.js`).
- **Le libellé de `docs_list` suit le format** : « Archive listée … 3 membres »
  pour un zip, « Document listé … 12 pages » pour un PDF. Un ack qui dirait
  « archive » sur un PDF apprendrait faux à l'utilisateur, et c'est la seule
  trace qu'il ait de ce que le modèle a ouvert. Les quatre helpers de libellé
  (`docsListAckHead`/`Count`, `docsReadAckHead`/`Label`) sont **purs et dans
  utils.js**, hors du registre d'acks : chaque `kind` y duplique sa logique entre
  `label` (chaîne) et `renderLabel` (DOM), et c'est structurellement là qu'un
  libellé dérive. L'unité est déduite du **nom** du record — heuristique
  d'affichage assumée, jamais de routage (le routage se fait aux octets) : s'y
  tromper coûte un mot inexact dans une trace, pas une mauvaise lecture.

**Lecture native de classeurs Excel (lot V-5 étape 1, `docs__list` / `docs__read`) :**
- **`DOC_READERS.xlsx` gagne `{ list, read }`** (`listXlsxDocument` /
  `readXlsxDocument`) à la place du lecteur zip. Le listing zip d'un `.xlsx`
  **ne disparaît pas** pour autant : il reste accessible par `docs__extract`
  (inspecter `xl/workbook.xml`, sortir une image embarquée), c'est
  l'**orientation** qui change, pas la capacité. `docx` et `pptx` restent sur
  `listZipDocument` jusqu'aux étapes 2 et 3.
- **LE PIÈGE DU FORMAT, mesuré : `sheet_to_csv` ignore SILENCIEUSEMENT son
  option `range`** en 0.18.5 — les trois formes (chaîne, objet, entier) rendent
  la feuille **entière** (figé par un contrôle du spike). Porté naïvement, un
  selector `'Feuille!A1:C10'` dumperait toute la feuille en prétendant avoir
  servi la plage : « plausible et faux », le mode de défaillance du zip chiffré
  de V-1. Le rendu passe donc par un **clone à `!ref` restreint**
  (`Object.assign({}, sheet, {'!ref': …})`), clone **superficiel** à dessein
  (les cellules sont partagées ; les copier pour lire dix lignes d'une feuille
  de 50 000 serait absurde). Ne pas « simplifier » vers l'option native sans
  rejouer le spike.
- **Le second piège, mesuré aussi : un `!ref` élargi DÉROULE du vide.** Sur une
  feuille réelle dont le `!ref` est `B2:E31`, poser `A1:Z999` fait rendre à
  SheetJS **999 lignes**, dont ~970 vides — il ne borne pas, il déroule ce qu'on
  lui dit. D'où `restrictSheetRange` (docs.js, **pur**), qui **intersecte** la
  plage demandée avec le `!ref` réel, **dit** le clamp par une notice (même
  raison que le FMT4 de `parsePageSelector`), et traite l'intersection **vide**
  comme un **échec** — rendre une chaîne vide ferait conclure « la feuille est
  vide » à tort.
- **Le `!ref` ne commence pas forcément en A1** (`B2:E31` sur le classeur réel) :
  toute arithmétique de plage qui suppose une origine A1 se décale. Couvert par
  `parseA1Range`/`formatA1Range` (docs.js, purs), en indices 0-based comme
  `decode_range` de SheetJS pour que les deux se composent sans conversion.
  `colLetterToIndex` est en **base 26 bijective** (pas de « colonne zéro ») :
  une base 26 ordinaire ferait de `AA` la 28e colonne au lieu de la 27e,
  décalage invisible en deçà de la colonne Z — donc sur toute fixture jouet.
- **`parseA1Range` borne les colonnes à trois lettres**, et ce n'est pas de la
  coquetterie : sans borne, `'FEUILLE1'` est une référence de cellule
  syntaxiquement valide (colonne « FEUILLE », ligne 1) et le parseur rendrait une
  plage à la colonne 1 922 664 644 au lieu de `null`. La borne est celle du
  format (Excel s'arrête à XFD, 16 384 colonnes), pas une valeur choisie.
- **Le selector est `'Feuille'` ou `'Feuille!A1:C10'`** — pas le `'N'`/`'N-M'`
  du PDF : une feuille se désigne par son nom, et forcer un index reviendrait à
  faire compter au modèle des feuilles qu'il a sous les yeux nommées.
  `parseSheetSelector` (docs.js, pur) porte le `split("!", 1)` du serveur, avec
  **un repli** que le serveur n'a pas : si le selector entier EST un nom de
  feuille, il est pris tel quel. Sans lui, une feuille nommée `« Alerte! »` ne
  serait adressable par **aucun** selector (le split chercherait `« Alerte »`).
  La plage reste inaccessible sur une telle feuille — le `!` y est ambigu par
  construction. Feuille inconnue → message **nommant les feuilles disponibles**,
  et rattrapage de casse quand une seule correspond.
- **`MAX_XLSX_ROWS_DEFAULT` (200) ne mord QUE sans plage explicite** (portage du
  cap serveur) : un modèle qui écrit `'Feuille!A1:C10000'` a exprimé une
  intention, un modèle qui écrit `'Feuille'` ne sait pas encore qu'elle fait
  50 000 lignes. La troncature **se dit** et propose les deux suites (une plage
  explicite, ou `as_resource`). C'est une borne de **lecture** ;
  `JS_EVAL_OUTPUT_CAP` reste la borne de **sortie**, appliquée après coup.
- **Le contrat de retour d'un lecteur `read` s'élargit** : `{ text, label,
  resourceName }` au lieu de `{ text, range }`. `label` est le selector
  **effectivement servi** (après clamp), `resourceName` le nom du record
  `as_resource` — les deux viennent du **lecteur**, seul à savoir ce qu'est une
  unité de son format : une page se dit `'2-5'`, une feuille se dit
  `'Synthèse!B2:E31'`, et une feuille ne se nomme pas `-p2-5`. Le handler ne
  devine plus. `pdfReadResourceName` est conservé mais dérive désormais de
  `docReadResourceName(source, suffixe)` + `slugifyResourceSuffix` (docs.js,
  purs) : seul le suffixe varie par format.
- **Classeur protégé : refus métier**, comme le PDF — mais SheetJS n'a pas
  l'équivalent de `PasswordException`, il lève une erreur ordinaire. On la
  reconnaît **sur son message** (`/password|encrypt/i`) avec repli sur l'erreur
  générique : reconnaître un message est fragile, d'où le repli, mais le silence
  serait pire.
- **`ensureSheetJs` (ui.js)** suit `ensureFflate`/`ensurePdfJs` (échec propagé,
  promesse mémoïsée, reset-on-reject, garde post-`onload` sur `read` ET
  `utils.sheet_to_csv`), en plus simple : **pas de worker**, donc « script
  chargé » et « bibliothèque prête » coïncident ici — ce qui n'était pas le cas
  de pdf.js.
- **Ni SheetJS ni mammoth ne DÉTACHENT le buffer qu'on leur passe** — vérifié par
  exécution (deux lectures enchaînées du même buffer, `byteLength` intact ;
  contrôles ajoutés au spike). Le `u8.slice()` défensif d'`openPdfDocument` est
  **spécifique à pdf.js** et n'a pas à être reproduit « par symétrie ».
- **Dépendance GELÉE à `xlsx@0.18.5`**, pour une raison différente de pdf.js :
  **SheetJS a quitté npm**. 0.18.5 est la dernière version publiée sur le
  registre ; le projet distribue depuis sur son propre CDN. Épingler via
  jsdelivr reste stable (npm ne réécrit pas une version publiée) et garde le
  patron des autres artefacts, mais **cette branche ne recevra aucun correctif**.
  Si un `.xlsx` réel refuse de s'ouvrir, la question se rouvre — et le fallback
  `mcp_docs` existe pour que ce ne soit pas bloquant.
- **Description de bibliothèque : l'Excel rejoint la bifurcation**
  (`describeXlsxForLibrary`), et plus nettement encore que le PDF — décrire un
  `.xlsx` par son listing de membres zip donnerait
  « `[Content_Types].xml`, `xl/workbook.xml`, `xl/worksheets/sheet1.xml`… »,
  soit une description qui ne dit rien du classeur. On rend les feuilles avec
  leurs dimensions plus un aperçu de **dix lignes** de la première feuille non
  vide. Mêmes trois gardes que le PDF : bornée, dégradée jamais bloquante
  (échec → `null` → chemin serveur), sans `console.warn`.
- **Les libellés d'ack passent par une TABLE** (`DOC_ACK_UNITS`, docs.js) au
  lieu d'une cascade de ternaires : chaque format ajouté est **une ligne**, et le
  **genre voyage avec l'unité** au lieu d'être recalculé à chaque usage — c'est
  ainsi qu'on a écrit « aucun page » en V-4. « feuille » est féminin. Pour
  `docs_read`, la **forme du selector** décide s'il s'agit d'une unité numérotée
  (pages) ou nommée ; le **mot** de l'unité nommée, lui, vient de la table
  (étape 2 — avec un seul format nommé, tout selector non numérique s'annonçait
  « Feuille … lue », y compris une section de document Word).

**Lecture native de documents Word (lot V-5 étape 2, `docs__list` / `docs__read`) :**
- **`DOC_READERS.docx` gagne `{ list, read }`** (`listDocxDocument` /
  `readDocxDocument`) à la place du lecteur zip. Comme pour l'Excel, le listing
  zip d'un `.docx` reste atteignable par `docs__extract` (inspecter
  `word/document.xml`, sortir une image embarquée) : c'est l'**orientation** qui
  change, pas la capacité.
- **`mammoth@1.11.0`** via `ensureMammoth` (ui.js), même contrat que les trois
  autres lazy-loads. Deux différences avec pdf.js, **mesurées et non supposées**
  (spike V-5) : pas de worker (« script chargé » = « lib prête »), et **le buffer
  n'est pas détaché** — donc pas de `u8.slice()` défensif à recopier « par
  symétrie ». Contrairement à SheetJS, mammoth est toujours publié sur npm :
  l'épinglage est du conservatisme ordinaire, pas une branche gelée.
- **`convertToHtml`, et elle seule.** Les deux autres API ont été écartées au
  spike sur sortie observée : `extractRawText` **perd les tableaux** (la fixture
  réelle en porte 10, et ils sont la substance du fichier — le serveur a payé ce
  piège, cf. le commentaire de `docx_read`), et `convertToMarkdown` les aplatit
  cellule par cellule tout en sur-échappant (`Sous\-section`). La garde
  post-`onload` ne vérifie **que** `convertToHtml` : vérifier les deux autres
  laisserait croire qu'on peut s'en servir.
- **Ce HTML ne passe PAS par `sanitizeHtml`/DOMPurify**, et c'est délibéré : il
  ne va **jamais au DOM**, il va dans un tool result puis en texte. Le piège 21
  gouverne le chemin string→HTML **affiché** ; il n'y en a pas ici. Le jour où un
  docx converti s'afficherait dans le fil, `sanitizeHtml` redeviendrait
  obligatoire — c'est exactement le troisième chemin de `renderMarkdownDocBody`
  (lot R), qui, lui, affiche.
- **Le parsing du HTML est à la regex, pas au `DOMParser`** : le pur doit tourner
  sous QuickJS, qui n'a pas de DOM. Acceptable **ici et nulle part ailleurs**,
  parce que l'entrée n'est pas du HTML arbitraire mais la sortie d'un générateur
  connu, au vocabulaire fermé (mesuré sur la fixture réelle : `h1`-`h6`, `p`,
  `table`/`thead`/`tbody`/`tr`/`th`/`td`, `strong`, `em`, `ul`/`ol`/`li`).
- **Le décodage d'entités est une garde de round-trip, pas du cosmétique.**
  `decodeHtmlEntities` (docs.js) est appliqué au texte **comme aux labels de
  section**. La fixture réelle porte un heading « 3. Gateway `&amp;` styles
  d'API » : non décodé — ou décodé au listing mais pas à la comparaison —
  **aucun selector ne pourrait jamais viser cette section**, puisque le modèle
  recopie ce que le listing lui a montré.
- **Un `<table>` est DANS sa section**, et c'est le gain structurel sur le
  serveur. `python-docx` expose paragraphes et tables en deux collections
  séparées, d'où son label spécial `(tableaux)` qui rassemblait à la fin ce que
  le document avait dispersé. Le HTML de mammoth est **en séquence** : le label
  `(tableaux)` n'a plus d'objet et n'est **pas** porté. `(préambule)` et
  `(corps)`, eux, le sont — ce sont des selectors valides que le modèle recopie.
- **Le bornage d'une section est celui du serveur, porté tel quel** : un heading
  et tout ce qui suit jusqu'au prochain de niveau **inférieur ou égal**. Un `h2`
  ne ferme pas un `h1`, il s'y imbrique — lire « 1. Bloquants » rend donc aussi
  ses sous-parties. C'est ce qu'un humain attend d'un titre.
- **Le gain le plus concret du lot : la limite multi-locale disparaît.** Le
  serveur détecte les headings par **nom d'affichage** du style, avec une regex
  codant cinq locales en dur (`Heading|Titre|Überschrift|Título|Titolo`,
  formats.py) — un docx polonais, néerlandais ou aux styles renommés y est traité
  « sans structure ». mammoth lit le `styleId` OOXML, **invariant par locale**
  (vérifié au spike : un style « Heading 1 » renommé « Titre 1 » ressort bien en
  `<h1>`).
- **Trois tolérances de selector, chacune répondant à un échec observé** et non à
  une élégance (`resolveDocxSection`, pure) : exact ; insensible à la casse et
  aux espaces répétés (un titre recopié traverse une tokenisation) ; préfixe
  **non ambigu** (un titre long se recopie tronqué). Le repêchage par préfixe
  n'agit que s'il désigne **une seule** section — deux candidats, c'est une
  ambiguïté qu'on rend au modèle, jamais qu'on tranche à sa place. L'échec
  **nomme les sections disponibles**, même posture que `parseSheetSelector` et
  `decideZipMemberExtraction` : c'est ce qui permet de se re-cibler **dans** le
  tour.
- **Le cap de sortie est appliqué DANS le lecteur** (`MAX_DOCX_SECTION_CHARS =
  18000`), seul lecteur du lot dans ce cas. Le handler **refuse** au-delà de
  `JS_EVAL_OUTPUT_CAP`, ce qui est juste pour une plage de pages ou de cellules
  demandée explicitement — le modèle n'a qu'à en demander moins. Mais une section
  est la **plus petite** unité qu'un docx offre : un document dont une section
  dépasse à elle seule le cap n'aurait alors aucun selector lisible, et le refus
  serait un cul-de-sac. On tronque en le disant, et la notice propose
  `as_resource`. **La marge sous le cap du handler est fonctionnelle** : sans
  elle, le texte tronqué **plus sa notice** repasserait au-dessus et le handler
  refuserait quand même — la garde se serait annulée elle-même.
- **Description de bibliothèque : le Word rejoint la bifurcation**
  (`describeDocxForLibrary`) — liste des sections plus le début de la première
  qui porte du texte. La cascade `kind !== 'pdf' && kind !== 'xlsx'` est
  remplacée par une **table** (`DOC_DESCRIBERS`) : même motif que `DOC_READERS`,
  et pour la même raison — la cascade s'allongeait d'un terme par format, et
  chaque terme oublié faisait silencieusement retomber un format sur son listing
  zip. Cette table n'est **pas** `DOC_READERS` et ne s'y adosse pas : un format
  peut être lisible sans être descriptible (le zip l'est, sa description **est**
  son listing de membres).
- **L'ack d'une lecture porte `sourceName`**, nouveau champ d'`ACK_COPY_FIELDS`,
  distinct de `resourceName`. Le mot d'unité (« Section … lue ») se déduit du
  document **lu**, alors qu'en `as_resource` `resourceName` est l'extrait
  **produit** — un `.txt`, qui ne matche aucune ligne de `DOC_ACK_UNITS`. Le
  défaut préexistait à l'étape 2 (une lecture Excel `as_resource` retombait déjà
  sur le mot par défaut) ; il ne devenait visible qu'avec un deuxième format à
  unité nommée.

**Lecture native de présentations PowerPoint (lot V-5 étape 3, `docs__list` / `docs__read`) :**
- **`DOC_READERS.pptx` gagne `{ list, read }`** (`listPptxDocument` /
  `readPptxDocument`) à la place du lecteur zip. C'était le dernier des trois
  types Office à y retomber : `listZipDocument` ne sert plus qu'au zip. Le
  listing zip d'un `.pptx` reste atteignable par `docs__extract`, comme pour les
  deux autres — l'**orientation** change, pas la capacité.
- **Aucun artefact nouveau.** Seule étape du lot dans ce cas : il n'existe pas de
  bibliothèque JS satisfaisante pour lire un `.pptx` (décision de cadrage), donc
  on décortique le zip avec **fflate**, déjà chargé pour le chemin zip, et on
  parse le XML avec **`DOMParser`**, natif au navigateur. Pas de `ensureX` à
  écrire, et le poids cumulé du lot n'augmente pas d'un octet.
- **`unzipSync` est FILTRÉ** aux slides, à leurs rels, aux notes et à
  `presentation.xml` — jamais aux médias, qui sont l'essentiel du poids d'un deck
  (551 ko pour 71 slides dans la fixture réelle, presque tout en images et objets
  OLE). Même geste que `docs__extract` : on ne décompresse que ce qu'on lit.
- **L'ordre des slides n'est PAS l'ordre des fichiers — garde critique.**
  `slide1.xml`, `slide2.xml` sont des noms de **pièces** OOXML ; l'ordre de
  présentation vit dans `ppt/presentation.xml` (`<p:sldIdLst>`), résolu via
  `ppt/_rels/presentation.xml.rels`. Trier par numéro de fichier marche sur une
  présentation jamais réordonnée et **casse en silence** dès qu'une slide est
  déplacée dans PowerPoint : le modèle lirait « slide 3 » en croyant lire la
  troisième. **Silence + plausible** est le mode de défaillance que ce lot refuse
  depuis V-1 (le zip chiffré, AUDIT §3). `pptxSlideOrder` (docs.js) est **pure et
  testée**, et c'est l'**exception assumée** de la décision 3 : elle travaille au
  **regex** sur le XML brut, précisément pour être testable sous QuickJS, qui n'a
  pas de `DOMParser`. Une regex un peu fragile qui est testée vaut mieux qu'un
  parsing correct qui ne l'est pas.
- **L'ordre des attributs d'un `.rels` n'est pas garanti** (mesuré : le deck réel
  écrit `Id`, `Type`, `Target`, un autre outil peut écrire autrement).
  `pptxRelationshipMap` lit donc chaque `<Relationship>` **en bloc** puis y
  cherche chaque attribut séparément, au lieu de supposer une séquence. Une
  relation sans `Target` est ignorée, jamais rendue à moitié.
- **La liaison slide ↔ notes passe par les rels de la SLIDE**
  (`ppt/slides/_rels/slideN.xml.rels`, relation de type `notesSlide`), jamais par
  le numéro : `notesSlide3.xml` n'est pas nécessairement la note de la troisième
  slide affichée — **mesuré sur le deck réel, où `notesSlide2.xml` est la note de
  la slide 17**. Même piège que l'ordre, même garde (`pptxNotesTarget`, pure) : il
  serait absurde de résoudre soigneusement l'ordre pour apparier les notes au
  jugé.
- **La découpe est shape → paragraphe (`a:p`) → runs**, et c'est LA décision
  d'implémentation du format. Elle a été **mesurée** sur la slide 2 du deck réel,
  pas devinée : le balayage plat des `a:t` rend 160 fragments (`"Centre "`, `" "`,
  `"de  "`, `"Cyberdéfense"`) — illisible, les runs étant coupés par les
  changements de mise en forme ; par shape avec runs concaténés, 30 blocs mais
  libellé et personne **collés** (`"Risques ITMarc GUIDAT"`) ; shape → `a:p` →
  runs, 30 blocs au bon niveau (`"Risques IT\nMarc GUIDAT"`). Un balayage plat
  produirait la bouillie qu'on reproche au serveur, à l'envers.
- **Le parcours descend DANS les `p:grpSp`, et c'est le gain net du format.**
  `slide.shapes` de `python-pptx` **n'itère pas dans les groupes** : sur la
  slide 2 du deck réel, **83 des 160 fragments** sont imbriqués dans des shapes
  groupées, et ce sont les noms et les rattachements de l'organigramme — soit
  exactement l'information pour laquelle on ouvre ce fichier. Le serveur en voit
  77, le natif les voit tous. Corollaire de méthode : le balayage `a:t`, qui
  pouvait passer pour une approximation grossière face à une API objet, est en
  réalité **plus fidèle** en volume — et la vérification a été faite avant de le
  dire.
- **Les tableaux (`a:tbl` d'un `p:graphicFrame`) sortent en lignes « a | b | c »**,
  même forme que `htmlTableToText` côté docx : deux documents de formats
  différents ne doivent pas se lire de deux façons.
- **Le listing retombe sur un EXTRAIT quand le titre manque** (décision 6, et
  **ajout de périmètre assumé** — `mcp_docs` ne le fait pas). Le titre est extrait
  par la règle exacte de `slide.shapes.title` (le `p:sp` dont le `p:ph` porte
  `type="title"` ou `"ctrTitle"`), donc parité stricte sur ce point — mais **6
  slides titrées sur 71** dans le deck réel : `pptx_list` du serveur produit
  soixante-cinq lignes « (sans titre) », ce qui ne permet pas au modèle de
  choisir une slide, seulement d'en lire au hasard. **Porter le format à
  l'identique aurait été porter un défaut** : c'est le seul endroit du lot où la
  parité stricte est le mauvais objectif. L'extrait vient des **blocs** (jamais du
  balayage plat, qui donnerait du bruit à la place d'un repère) et il est **borné**
  (`PPTX_EXCERPT_CHARS = 90`, coupe sur un mot entier) — 71 slides × un extrait,
  c'est un listing qui compte dans le contexte.
- **Les notes de présentateur sont dans le périmètre** (décision 5), et c'est un
  **dépassement volontaire de la parité** : `python-pptx` les expose, le serveur
  ne s'en sert pas. C'est le bon endroit pour dépasser — dans une présentation,
  les slides portent des mots-clés et les notes portent le propos ; servir les
  slides seules donnerait au modèle le squelette en lui cachant le contenu. Elles
  sont **séparées du corps par un intertitre explicite** (`--- Notes de
  présentateur (slide N) ---`), sans quoi le modèle attribuerait au public ce qui
  visait le présentateur.
- **Le filtre de placeholders des notes n'est pas cosmétique**
  (`PPTX_NOTES_SKIP_PH = ['sldNum', 'sldImg', 'ftr', 'dt']`). Les quatre
  `notesSlides` du deck réel sont **vides** de propos mais portent un champ de
  numérotation : un balayage naïf rendrait `"Notes view: 17"` comme note de
  présentateur — du chrome de gabarit présenté comme du contenu, exactement le
  plausible-et-faux que le lot refuse.
- **Le selector est un NUMÉRO** (`'3'` ou `'2-5'`), et `parsePageSelector` est
  réutilisée **telle quelle** : c'est le même `N`/`N-M` que le PDF. Une slide n'a
  pas de nom stable à viser (six sur soixante-onze portent un titre), contrairement
  à une feuille Excel ou à une section Word. Le numéro est celui de l'**ordre de
  présentation**, résolu à l'ouverture. La notice de clamp part **avec le texte**,
  comme pour le PDF : une plage ramenée en silence ferait conclure que le deck
  s'arrête là.
- **`docsReadAckHead` : le mot d'unité vient de la table dans les DEUX branches.**
  La branche numérique codait « Page » **en dur** depuis V-4, l'unique format à
  selector numérique d'alors — la ligne `pptx` de `DOC_ACK_UNITS` portait déjà
  `read: 'Slide'` sans que rien ne l'atteigne. Défaut **préexistant** révélé par le
  troisième format, exactement comme `sourceName` l'avait été par le deuxième :
  **un deuxième (puis un troisième) occupant d'une abstraction est ce qui révèle
  ce que le premier laissait passer.** L'accord de genre suit l'unité (« Slides
  2-5 lues », « Membre 3 lu »).
- **`pptxReadResourceName` suffixe en `-sN`**, pas `-pN` : dérivée de
  `docReadResourceName` comme `pdfReadResourceName`, dont elle ne diffère que par
  la lettre — deux extraits du même deck ne doivent pas se recouvrir dans la
  bibliothèque.
- **Description de bibliothèque** (`describePptxForLibrary`, quatrième entrée de
  `DOC_DESCRIBERS`) : le **listing seul**, sans aperçu supplémentaire. C'est le
  seul describer dans ce cas, et pour une raison : le listing d'une présentation
  **porte déjà le texte**, puisque le repli d'extrait le met dans chaque ligne. En
  rajouter ferait de la description une lecture.
- **`DOCS_DOCTRINE` passe en v6, et la puce serveur DISPARAÎT** : le PowerPoint en
  était le dernier occupant. Plus aucun format connu n'est renvoyé vers un outil
  serveur — les cinq (zip, PDF, Excel, Word, PowerPoint) ont leur lecteur natif, et
  le cas d'un format inconnu reste rattrapé par `docsUnsupportedFormatMessage`, qui
  nomme au moment de l'appel le serveur réellement branché. La doctrine décrit ce
  qui est vrai quand elle est lue, jamais ce qui est prévu.

**Création d'archives (lot V-2, `docs__pack`) :**
- `docs__pack(handles[], name?)` — agrège **N** ressources déjà stockées en
  **une** archive zip téléchargeable. Premier outil du namespace `docs__` à
  **écrire** un format plutôt qu'à le lire : le namespace suit le **format**, pas
  le sens de l'opération (décision 1 du lot — nom identique au serveur, pour que
  la disparition de `mcp_docs` reste invisible au modèle). Handler
  **asynchrone** (`ensureFflate` + `_storeBlock`). Ne crée **aucun** contenu :
  les ressources doivent déjà exister, et la description vue par le modèle porte
  cette borne négative explicitement.
- Chaîne : pour chaque handle `classifyHandleRef` → `resolveHandleRecord(ref,
  ctx)` (**`ctx` explicite**, piège 28) → `buildZipMemberName` →
  `validateZipPlan` (utils.js, purs) → `zipSync` → `_storeBlock` en classe
  **`'binary'` explicite** → `formatResourceDescriptor`. Les records sont
  **gelés avant le premier `await`** : le handler est `async`, un état relu
  après un `await` pourrait appartenir à une autre génération (piège 26b).
- **`formatResourceDescriptor`, surtout pas `formatInlineHandleForModel`.** Cette
  dernière ajoute « texte adressable par `js__eval` » — note qui serait **fausse**
  sur un `application/zip` : `js__eval` y décoderait les octets compressés en
  UTF-8 et rendrait du bruit. Et jamais `_makeResourceRef` (piège 26c) : le
  raisonnement « c'est sûr parce que la classe est `binary` » est exactement
  celui qui a coûté le bug du lot M sous une autre classe.
- **La déduplication des noms n'est pas cosmétique.** `zipSync` prend un objet
  `{ nom: octets }` : deux membres homonymes **s'écrasent silencieusement** —
  propriété de l'objet JS, pas de fflate. Or deux ressources d'une même
  conversation portent très souvent le même nom (`rapport.md`, `sortie.txt`).
  `buildZipMemberName` déduplique contre un `Set`, en insérant l'incrément
  **avant** l'extension (`rapport-2.md`, jamais `rapport.md-2`). La casse n'est
  **pas** normalisée : le zip y est sensible, et `Rapport.md` face à `rapport.md`
  sont deux membres distincts.
- **Le nom de membre est un IDENTIFIANT et doit faire l'aller-retour.** C'est par
  lui que `docs__list` puis `docs__extract` reciblent le membre (comparaison
  stricte `e.name === path`). Même exigence que les noms non-UTF-8 payés en
  clôture V-1 : un nom qui ne revient pas à l'identique par `_zipDecodeName`
  rend le membre **inatteignable**. `zipSync` encode en UTF-8 et pose le bit 11,
  donc la branche UTF-8 est prise — structurellement sûr, mais **figé par un test
  d'aller-retour complet** dans le verify plutôt que supposé.
- **Deux tables d'extensions, pas une inversion.** `ZIP_MEMBER_MIME_BY_EXT`
  (ext → mime, V-1) n'est **pas injective** — douze extensions rendent
  `text/plain`. L'inverser programmatiquement donnerait le dernier représentant
  itéré (`text/plain` → `rst`, absurde). `ZIP_EXT_BY_MIME` (mime → ext, V-2) est
  donc écrite **à la main**, avec le représentant canonique de chaque mime, et
  leur accord est gardé par un **test croisé** (`tests/test-zip.js`) qui vérifie
  les deux sens. Même forme que le contrat `zipMemberMime` × `_isTextualMime`
  livré en clôture V-1 : deux fonctions pures qui composent forment un contrat
  que rien ne garde autrement.
- **Les refus vivent dans `validateZipPlan`** (pure, testée) : plan vide, nom
  vide, zip-slip (`isZipSlipPath`, réutilisée, jamais réécrite), doublon
  résiduel, total au-delà de `MAX_INLINE_BYTES`. Comme en V-1, un refus métier
  est un `result` texte **non-`isError`** avec un ack `ok:false` (rouge par
  `ackIsError`) — le modèle re-cible dans le même tour.
- **Le doublon est refusé bien que `buildZipMemberName` l'ait déjà évité.** Ce
  n'est pas redondant : les deux fonctions **composent**, et l'écrasement
  silencieux est précisément le mode de défaillance visé. `validateZipPlan` est
  la garde de dernier ressort.
- **Le cap porte sur le total NON COMPRESSÉ, en amont.** C'est le pic RAM réel :
  les entrées sont déjà en mémoire, `zipSync` construit la sortie par-dessus.
  Aucun second cap sur la sortie compressée — un refus *après* compression aurait
  déjà payé le coût mémoire qu'il prétend éviter, l'inverse exact de la garde
  préventive de V-1 (« on ne décompresse jamais pour découvrir que c'était trop
  gros »).
- **Nom de l'archive** : `normalizeArchiveName` (utils.js, pure) garantit
  l'extension `.zip` sans jamais la doubler, retire le chemin (le nom finit dans
  un record et dans un téléchargement) et retombe sur `archive.zip` si le
  nettoyage ne laisse rien. La casse n'est pas normalisée — c'est un champ rédigé
  par le modèle.
- **Deux acks par appel réussi**, comme `docs__extract` : `_storeBlock` pousse
  `resource_stored`, `docs__pack` ajoute le sien.
- **Le bouton de téléchargement ne vient PAS d'un chemin propre à `docs__pack`.**
  Il vient de l'ack `resource_stored` via `ackDownloadTarget` → `.ack-dl` →
  `downloadAckResource`, déjà câblé (cf. « Téléchargement de la ressource
  désignée par un ack »). C'est ce qui a fait écarter `resource__present`, qui
  coûterait un tour de modèle **et** un `arrayBufferToBase64` sur toute l'archive
  (`makeResourcePresentBlock`) — contradictoire avec ce que V-3 attaque par
  ailleurs. Le modèle reste libre de l'appeler ; on ne l'y **oriente** pas.
- **Le retour au modèle mentionne le téléchargement** (« déjà proposée au
  téléchargement dans le fil »). Délibéré : sans marqueur, un modèle peut
  annoncer à l'utilisateur qu'il doit demander autre chose alors que le bouton
  est déjà là. Précédent exact et documenté : `NOT_PRESENTED_NOTE`
  (`resources.js`).
- **`ensureFflate` garde désormais `unzipSync` ET `zipSync`.** La garde ne
  testait que la première alors que son propre commentaire annonçait que
  l'artefact couvre la seconde « pour V-2 ». Un build CDN partiel aurait échoué
  **tardivement**, dans un handler `async`, au lieu d'échouer au chargement —
  exactement le mode de défaillance que cette garde existe pour empêcher.
- **Le libellé « zip » de la description est daté V-2**, au même titre que celui
  de `docs__list`/`docs__extract` (V-1) : à élargir si la création d'autres
  formats devient native.
