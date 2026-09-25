# Toasts

Annonce ponctuelle d'un événement survenu là où l'utilisateur ne regarde pas
(lot AG). Code : `src/js/toasts.js` (DOM, minuteurs, observation de la mise en
page), purs dans `src/js/utils.js`, styles dans `src/css/toasts.css`, jetons
dans `base.css` / `theme-light.css`.

## Le critère : l'état sur la surface passive, le front en toast

MIAOU a longtemps refusé le toast (lots T, J, V-3, AB-5, U-1) : un état durable
doit rester lisible sans avoir à surprendre une notification. La règle qui
réconcilie ce refus et le besoin est la suivante : **un état reste porté par sa
surface passive** (le chat, les pastilles, les badges), **le toast n'en annonce
que les fronts** — la pose d'un état, la panne ou le retour d'un service, l'échec
d'une action lancée plus tôt. Un toast « collant tant que l'état dure » serait un
bandeau déguisé : tout branchement qui en ferait le porteur d'un état durable
est hors critère.

Pas de toast de succès pur (génération ou agent terminé hors écran,
conversation déplacée : les badges le disent). Seule exception, le « service
rétabli », qui referme un incident annoncé.

## API

```js
showToast({ key, level, theme, text, action, persistent })
dismissToast(key)
```

- `key` — clé de cause. Un toast de même clé **remplace** l'ancien au lieu de
  s'empiler (`backend:<serverId>`, `mcp:<name>`, `summary:<convId>`…).
- `level` — `'info'`, `'warn'` ou `'error'`. La couleur (filet gauche, glyphe)
  dit le niveau.
- `theme` — clé de la table fermée `TOAST_GLYPHS` (toasts.js) ; le glyphe dit le
  thème. Un site d'appel choisit un thème, jamais un dessin.
- `text` — posé en `textContent`, jamais en HTML : il cite des noms de
  conversation ou des messages d'erreur venus d'ailleurs. Espaces insécables
  après « et avant ».
- `action` — optionnelle, `{ label, run }`. Le clic sur le corps appelle `run()`
  puis ferme. La ligne de `label` suivie d'un chevron est le signal AU REPOS
  qu'un toast est cliquable ; sans action, ni ligne, ni survol, ni curseur.
- `persistent` — erreur de perte de données (P1) : pas d'auto-fermeture.

## Thèmes et glyphes

Aucun glyphe n'est dessiné pour les toasts : chacun reprend celui qui dit déjà
la même chose ailleurs (une métaphore = un usage). Les tracés sont recopiés, et
leur source citée dans le commentaire de `TOAST_GLYPHS` — les retoucher ensemble.

| Thème | Glyphe repris de |
|---|---|
| `storage` | le cylindre de la catégorie « Données » des réglages |
| `services` | la prise de la catégorie « Connexion » des réglages |
| `agents` | `ICON_AGENT` (acks.js), le robot du bandeau d'agent |
| `clipboard` | le glyphe des boutons « Copier » |
| `export` | le bouton d'export de conversation |
| `files` | l'onglet « Fichiers » de la sidebar |
| `summary` | la bulle du bandeau de résumés liés |

Le cylindre et la prise sont des glyphes pleins, les autres au trait : écart
assumé, la reprise à l'identique primant sur l'homogénéité de graisse.

## File, plafond, remplacement (purs, testés)

`toastQueueUpsert(list, item, max)` tient la file du plus ancien (haut de la
pile) au plus récent (bas, contre l'ancre). **Le plus récent est toujours en
bas** : un toast remplacé par sa clé y revient, comme un toast neuf (option B de
la maquette, Julien — l'option A, garder sa place, obligeait l'éviction à porter
une date en plus de la position). Au-delà de `TOAST_MAX_VISIBLE` (4, constante
et non clef de config), **le plus ancien non-erreur sort d'abord** ; si tous
sont des erreurs, la plus ancienne. Cas limite assumé : quatre erreurs affichées
et un arrivant qui n'en est pas une — c'est lui qui ne trouve pas place.

`toastDurationMs(level, persistent)` : info 5 s, avertissement 8 s, erreur de
service 8 s (l'état reste porté par le chat), erreur P1 jamais. La croix est
toujours présente.

## Placement (pur `toastPlacement`, mesuré par `layoutToasts`)

En bas à droite, empilé vers le haut, **toujours collé au bord droit de
l'écran** hors drawer — « à droite du composer » désigne la zone, pas un
accolement au champ. Seule la hauteur dépend de la place :

- **`composer`** — la place libre à droite du champ de saisie atteint
  `--toast-w + 2 × --toast-inset` (332 px) : bas de la pile aligné sur celui du
  champ ;
- **`edge`** — sinon au-dessus du composer, qu'elle ne recouvre jamais, en bas
  du fil ;
- **`beside-drawer`** — drawer ouvert : à gauche du drawer ;
- **`over-drawer`** — drawer ouvert sans 332 px à sa gauche : par-dessus, au
  bord droit.

Le drawer ne décide que du décalage HORIZONTAL : la hauteur suit la même règle
avec ou sans lui, pour que la pile ne saute pas verticalement à l'ouverture ou à
la fermeture d'un drawer.

La place se **mesure** (`getBoundingClientRect` du champ, `offsetWidth` du
drawer), elle ne se déduit pas d'un breakpoint : elle dépend de la sidebar et
de `--col`, et les drawers n'ont pas une largeur unique (`.drawer-mid` 500 px,
`.drawer-wide` 620 px, plafonnés à 92vw). Recalcul sur `resize`, sur un
`ResizeObserver` de `.composer` (sidebar, cran de colonne) et sur un
`MutationObserver` de la classe des `.drawer` — un observateur plutôt qu'un appel
dans chaque `open*`/`close*`, qui oublierait le prochain drawer.

Le conteneur `#toasts` vit hors de la topbar (qui isole les z-index), à
`z-index: 55` : au-dessus du backdrop (40) et des drawers (50), sous la lightbox
(60) et la palette (70). Il ne capte aucun clic, seuls les toasts le font.

## Accessibilité et mouvement

- Conteneur `aria-live="polite"` ; chaque toast porte `role="alert"` (erreur,
  interrompt) ou `role="status"`.
- **Jamais de vol de focus** : la frappe dans le composer continue. Le corps
  cliquable est un `<button>`, la croix aussi : atteignables au clavier.
- Minuteur **en pause au survol et au focus** ; au départ du pointeur, il reprend
  avec au moins 1,5 s.
- Hors de la pile d'Échap : Échap garde son sens (drawers).
- Entrée et sortie en transition, sous le kill-switch global (0.01ms). La sortie
  retire le nœud sur un minuteur (`TOAST_LEAVE_MS`), jamais sur `transitionend`.

## Jetons

Deux étages dans `:root` (base.css). `--float-*` est la matière d'un élément
flottant — surface, bordure, rayon, ombre (celle du `.model-menu`), typo — que
partageront les futurs tooltips : c'est le point d'harmonie. `--toast-*` porte
ce qui n'appartient qu'au toast (largeur, marges, filet, glyphe, couleurs de
niveau) : c'est le point de dissemblance, le tooltip n'en reprendra rien.
Niveaux : `--toast-info` vaut `--ok` (les seuls toasts info sont des
« rétabli »), `--toast-warn` a sa propre valeur par luminosité (plus saturée en
clair que `--pending`, jugé terne), `--toast-err` vaut `--err`.

## Branchements

Tous les textes vivent dans toasts.js, un émetteur par événement (`toast*`) :
un site d'appel dit ce qui s'est passé, jamais comment l'annoncer.

**P1 — erreur, sans auto-fermeture**

| Événement | Émetteur, appelé par | Clé | Clic |
|---|---|---|---|
| Quota IndexedDB (front de `setStorageFull`) | `toastStorageFront`, storage.js — dans chaque onglet, le pair qui reçoit `storage-state` compris (S3) ; la levée retire le toast | `storage-quota` | Réglages › Données (`openSettingsCategory('donnees')`) |
| Quota localStorage (S2) | `toastLocalQuota`, `writeLocalStorage` — à chaque écriture refusée, pas d'état | `local-quota` | Réglages › Données |
| Écriture refusée par la garde anti-troncature | `toastTruncateRefused`, `persistGeneration` | `truncate:<convId>` | aucun |
| Réveil du parent échoué | `toastWakeFailed`, les deux `.catch` de `wakeParentWithPendingAgentResults` | `wake:<parentId>` | `gotoAgentInventoryRow(parent)`, cross-Space (S5) |

**P2 — avertissement, 8 s** : export HTML raté (`toastExportFailed`, rendu nul
ou exception dans `exportConvHtml` — le clic ne restait plus muet), renommage de
fichier de bibliothèque refusé (`toastRenameFailed`, le nom revenu à l'ancien
dit enfin pourquoi), copie refusée par le navigateur (`toastCopyFailed`, les
trois boutons « Copier »), résumé automatique raté (`toastSummaryFailed`, à
**chaque** échec — décision S4, à réévaluer si c'est bruyant : il est retenté
chaque minute).

**Fronts de services** — `syncHealthToasts`, appelé aux deux synchros de santé
(`syncConnDot`, `syncAuthorizationPending`) et nulle part ailleurs. Le pur
`healthFronts(prev, next)` décide par diff d'instantanés ; clés
`backend:<serverId>` et `mcp:<name>`, clic vers le drawer des serveurs API ou
MCP. Règles, toutes testées : `ok → down` erreur, `down → ok` « rétabli »
(affiché même si l'erreur a été fermée, D5) ; `unconfigured` ne produit rien
dans aucun sens (`down → unconfigured` retire le toast sans rétablir) ; une
bascule de serveur actif est un changement de clé, pas un front ; au démarrage
l'état antérieur vaut `ok`, donc un backend déjà mort s'annonce ; côté MCP, un
serveur en reconnexion garde son dernier état ÉTABLI dans l'instantané (sans
quoi `error → connecting → ok` n'aurait jamais de « rétabli »), une attente
d'autorisation n'annonce rien, et un serveur supprimé ou désactivé en erreur
voit son toast retiré sans « rétabli ».

## Vérification

Purs : `tests/test-utils.js` (file, durées, placement, fronts de santé).
Rendu, rôles, focus, placement réel dans chaque mode, minuteurs, kill-switch,
et les branchements — quota provoqué sur le vrai chemin d'écriture (une
transaction avortée avec un `tx.error` nommé `QuotaExceededError`, ce que fait
un échec au commit), diffusion au second onglet, levée par suppression, fronts
de service, quota localStorage, export : `.claude/skills/run-miaou/verify-toasts.mjs`.
