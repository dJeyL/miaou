# Infobulles

Infobulles MIAOU (lot AH) : elles remplacent l'attribut `title` natif dans toute
l'application. Code : `src/js/tooltips.js` (bulle, listeners, minuteurs, point
d'écriture), purs dans `src/js/utils.js` (section « Tooltips »), styles dans
`src/css/tooltips.css`, jetons `--tip-*` dans `base.css`.

## Pourquoi pas `title`

Le natif ne se montre jamais au clavier. Il ne se rafraîchit pas quand on le
réécrit pendant qu'il est affiché : l'infobulle d'export restait pour cette
raison figée, et l'armement d'une suppression n'était signalé que par la
couleur. Son apparence dépend enfin du système. Tant que `title` donnait aussi
leur nom accessible aux boutons réduits à une icône, le retirer sans compenser
les rendait muets pour un lecteur d'écran : la règle ARIA ci-dessous répare ça.

**Règle de code : une infobulle se pose par `setTip` / `tipAttrs` / `data-tip`,
jamais par `title`.** Un filet de `tests/runner.py` (`run_native_title_check`)
échoue si un `title` d'infobulle réapparaît dans `index.html` ou `src/js/*.js`.
Ses exceptions sont nommées : `export.js` en entier, `document.title`, et deux
écritures de champs de données repérées à la ligne près (`DATA_TITLE_WRITES`).
Une nouvelle écriture de donnée nommée `title` s'y ajoute en connaissance de
cause.

## Point d'écriture unique

Une seule fonction pure décide des attributs, `tipAriaRule` (utils.js), servie
par trois voies d'entrée :

- **JS** : `setTip(el, tip)` remplace toute affectation `el.title = …`, et
  `getTip(el)` toute lecture (ainsi `armThenRun`, qui mémorise puis restaure
  l'infobulle d'un bouton armé). `tip` est une chaîne, `{ label, detail }` pour
  deux étages, ou `''` pour retirer.
- **Gabarit** : `tipAttrs(tip, { text, ariaLabel })` rend la chaîne
  d'attributs, échappée en position d'attribut et précédée d'une espace
  (`<button${tipAttrs('Copier')}>`). `text` est le texte visible du porteur :
  **à passer pour tout porteur qui affiche du texte**, sans quoi la règle le
  traite comme un bouton-icône et pose un `aria-label` qui masque son texte.
  `ariaLabel` est l'`aria-label` d'auteur : `tipAttrs` l'émet lui-même, ne pas
  l'écrire à côté dans le gabarit.
- **HTML statique** : `data-tip="…"` (et `data-tip-detail`) dans `index.html` ;
  `initTooltips` applique la règle au démarrage. Aucun `aria-label` écrit à la
  main à côté : deux sources dériveraient.

`refreshTipAria(el)` ré-applique la règle à un porteur dont le texte visible a
changé après coup, sans toucher à la bulle. Appelants : `syncAgentCount`
(`#agent-count`, vide au démarrage) et `setTitle` (le titre de la conversation,
vide sur une conversation neuve).

Une infobulle qui annonce un geste suit la possibilité du geste. Le titre de la
conversation porte « Renommer la conversation » seulement quand il est
éditable : `applyConvTitleEditable` (ui.js) pose l'attribut `contentEditable`
et l'infobulle ensemble, pour les deux écrivains de l'éditabilité (fil d'agent,
retitrage en cours).

### Règle ARIA (`tipAriaRule`)

- Porteur sans texte visible ni `aria-label` d'auteur → `aria-label` = texte de
  l'infobulle (« libellé. détail » à plat pour deux étages).
- Porteur nommé (texte visible ou `aria-label` d'auteur) → `aria-description`
  = texte de l'infobulle, **sauf** si le nom le contient déjà (« Copier » sous
  le nom « Copier cette interjection » n'apporterait que du bruit).
- Ce que la règle pose est marqué `data-tip-aria` (`label` ou `description`) :
  une mise à jour ou un retrait ne touche qu'à ça, jamais à un `aria-label`
  d'auteur.

La règle lit le porteur **au moment de l'appel** : poser l'infobulle APRÈS son
contenu et son `aria-label` d'auteur, jamais avant (la croix des toasts, les
boutons de relecture des serveurs, la pilule MCP, les boutons SVG/PNG des
diagrammes y ont été réordonnés). Une image se nomme par son `alt` : c'est lui
qui compte comme texte visible, sans quoi « Agrandir » remplacerait la
description de l'image.

## Deux étages

Un libellé (graisse 600) puis un détail, chacun posé en `textContent` : aucune
infobulle ne porte de balisage (des infobulles citent des noms de fichiers, de
conversations, des erreurs). Le second étage ne sert que si le porteur n'affiche
pas déjà son libellé. Emplois : la pastille de connexion quand l'API n'est pas
configurée (état, puis geste), la pilule MCP en erreur (sa pilule dit l'état, la
bulle le geste puis la vérification).

## Affichage et masquage

- Au survol, et au focus **clavier** seulement (`:focus-visible` : un clic ne
  laisse pas de bulle). Un champ de saisie est exclu du focus, `:focus-visible`
  y étant vrai même au clic.
- Délai à froid `TIP_COLD_MS` (500 ms) ; passé une première bulle, les voisines
  s'affichent sans attendre pendant `TIP_WARM_WINDOW_MS` (300 ms) après la
  dernière fermeture (`tipShowDelay`, pur).
- Masquage : sortie du porteur, `pointerdown`, porteur retiré du DOM, masqué ou
  vidé (vérification périodique `TIP_WATCH_MS` tant qu'une bulle est affichée :
  un re-rendu de la sidebar déclenché par la synchro peut détruire le porteur
  sous le pointeur), défilement d'un conteneur **qui contient le porteur** (le
  fil défile à chaque chunk pendant le streaming : un masquage sur tout
  défilement éteindrait la bulle du bouton d'envoi).
- **Frappe** : toute touche masque la bulle, sauf une touche de modification
  seule (`tipKeyHides` : Shift, Ctrl, Alt, Meta). Le listener est en **capture**
  sur `document` : il passe avant l'autocomplétion, les éditions et toute la
  cascade Échap. Échap sur une bulle visible est **consommé** — la bulle se
  ferme, rien d'autre. Sans bulle visible, Échap passe tel quel.
- **Texte vivant** : `setTip` sur le porteur de la bulle affichée met son texte à
  jour en place. Si la bulle a été masquée (clic) et que le pointeur est
  toujours sur le porteur, un `setTip` la réaffiche avec le nouveau texte (état
  « porteur sous le pointeur » distinct de « porteur de la bulle ») : c'est ce
  qui rend visible l'armement d'une suppression (« Cliquer à nouveau pour
  confirmer »).
- **Export sous Shift** : l'infobulle du bouton d'export passe à « Exporter la
  conversation en Markdown » tant que Shift est enfoncé, **seulement si elle est
  affichée** (`tipShownOn`) — une majuscule tapée ailleurs ne fait rien
  apparaître. Shift déjà enfoncé quand le pointeur arrive sur le bouton : la
  bulle s'ouvre directement en version Markdown, après son délai normal
  (`pointerover` écouté sur le bouton, donc avant le listener délégué du
  module : le texte change sans déclencher de réaffichage). Au relâchement, ou à la perte de focus de la fenêtre, le texte de
  repos (lu sur le `data-tip` statique) est toujours rétabli
  (`wireExportShiftTip`, main.js). C'est le clic qui décide du format
  (`ev.shiftKey`), jamais l'infobulle.
- Un bouton `disabled` affiche sa bulle : les navigateurs délivrent les
  événements de pointeur d'un `<button disabled>` à un listener délégué sur
  `document` (mesuré dans Chrome, Safari et Firefox).

## Placement

Une bulle unique, montée sur `body` en `position: fixed` : `.topbar` isole les
z-index (`backdrop-filter`) et un `contain: paint` couperait une bulle montée
dans son porteur. `pointer-events: none` : elle n'intercepte jamais un clic,
même quand elle couvre le bouton voisin (elle n'est donc pas survolable, choix
assumé). `tipPlacement` (pur) reçoit des grandeurs MESURÉES à chaque affichage :
au-dessus du porteur par défaut, retournée au-dessous quand la place manque (cas
nominal de toute la topbar), décalée pour rester dans la fenêtre, flèche visant
le centre du porteur, bornée hors des coins arrondis (`TIP_ARROW_INSET`).
Fondu sous le kill-switch global ; le masquage ne dépend d'aucun
`transitionend`.

## Hors du module

- **Export** : garde le `title` natif (le module n'est pas embarqué, et
  `EXPORT_CSS` est figé, piège 22). Le seul gabarit partagé qui porte une
  infobulle, le nom d'une pièce jointe (`attChipHtml`), y repasse en `title` par
  `exportNativeTip` (export.js).
- **Contenu du modèle** : un `title` produit par le modèle (lien Markdown titré,
  `<abbr>`) reste natif. Le module ne réagit qu'à `data-tip` ; le styler ferait
  entrer une chaîne d'origine modèle dans un composant de l'application.
- **Tactile** : hors champ, comme le natif.

## Vérification

Purs en QuickJS (`tests/test-utils.js` : texte, règle ARIA, échappement,
placement, délais, touches). Couche DOM : `.claude/skills/run-miaou/verify-tooltips.mjs`
(règle ARIA posée, délais, retournement en topbar, texte vivant et réaffichage,
Échap consommé devant un drawer, Shift qui ne masque pas, focus clavier contre
focus par clic, porteur détruit, défilement). Manuel : `docs/manual-tests.md`,
section « Infobulles ».
