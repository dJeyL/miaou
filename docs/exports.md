# Export Markdown, export HTML, téléchargements et horodatages

## Export Markdown et téléchargements

- `downloadFile(filename, content, mimeType)` dans `utils.js` : Blob +
  `createObjectURL` + `<a download>` éphémère + clic programmatique +
  `revokeObjectURL`. **N'est pas un outil LLM.** Point d'entrée unique pour
  tout téléchargement côté client (blocs de code, messages, export conversation,
  et futurs backup/import).
- `slugTitle(title)` dans `utils.js` (pure, testée QuickJS) : slug de nom de
  fichier depuis le titre de conversation. Les lettres accentuées sont
  **translittérées** en ASCII (`normalize('NFD')` + suppression des marques
  diacritiques U+0300–U+036F) **avant** le remplacement du reste par des
  tirets — « café » donne `cafe`, pas `caf` ni `caf-`. Fallback
  `miaou-conversation` si le titre est vide ou ne contient que des caractères
  non alphanumériques (après translittération). Utilisée par `downloadConvMd`
  (`.md`, sans date) et l'export HTML (`.html`, avec date — cf. section
  dédiée ci-dessous).
- `exportDateStamp(now)` dans `utils.js` (pure, testée QuickJS) : horodatage
  `YYYY-MM-DD` déterministe (heure locale, pas d'`Intl`/`toLocaleString`),
  utilisé dans le nom de fichier de l'export HTML.
- `LANG_TO_EXT` / `langExt(lang)` dans `utils.js` : table langage → extension.
  Fallback `.txt` si le langage est absent ou inconnu.
- Bouton `.code-dl` dans `decoratePre` (ui.js) : posé aux côtés de `.code-copy`,
  télécharge le contenu brut du bloc.
- **`.msg-dl` (bouton download d'un message assistant) porte l'attribut `hidden`
  à la création** (`assistantHead`) et est révélé uniquement par `finalizeAssistant`
  (message live) **et** `buildMsg` (reload depuis storage). Ne jamais l'afficher
  avant finalisation — le contenu est incomplet pendant le streaming.
  Le contenu brut à télécharger est stocké dans `body.dataset.raw`, posé par
  `finalizeAssistant` et `buildMsg` (chemin reload). Si on retouche l'un ou
  l'autre, s'assurer que `dataset.raw` est bien mis à jour.
- **`.conv-dl-btn` (export de la conversation) est désactivé (`disabled`) pendant
  le streaming** via `setSending` (ui.js). CSS : `.conv-dl-btn:disabled` masque
  le bouton. `downloadConvMd()` (main.js) ne garde que les rôles `user`/`assistant`
  pour le texte, et inclut l'horodatage par message si `ts` est défini.
- **Traces d'appels d'outils dans l'export.** `formatToolAcksMd(acks)` (utils.js,
  pure, testée QuickJS) rend un groupe d'acks **enrichis** (`args` non null —
  mêmes acks que `expandThread` réinjecte cross-turn, cf. `docs/tools.md`)
  en blockquote Markdown juste avant le texte de réponse du tour : nom de l'outil
  + `— intent` (si présent), arguments (JSON), résultat (ou « Résultat (erreur) »
  si `ackIsError(m)` — prédicat unique partagé avec le rendu live `buildToolAck`
  et l'export HTML, cf. `docs/tools.md` : couvre `m.error` (MCP distant) **et**
  `m.ok === false` (`js__eval`, refus de cap ou plantage guest)), et pour
  `resource_presented` une note `Ressource présentée
  automatiquement : nom (mime) — non incluse dans cet export` (**jamais de
  data-URI/base64 embarqué**, cohérent avec D8/D9 (`docs/mcp.md`) — le binaire
  reste en IDB). Un seul appel → « Outil appelé : » ; plusieurs (même `group`) →
  « n outils appelés : » en liste numérotée (compteur **en toutes lettres, jamais
  entre parenthèses** — même formule que le summary de l'export HTML). Troncature pour la lisibilité du
  fichier (n'affecte ni le storage ni le payload modèle) : args/résultat à 300
  caractères, nom de ressource à 60, suffixe `...` simple (pas de mention
  « tronqué »). Acks **legacy** (sans `args`) restent **omis** de l'export, comme
  avant cette fonctionnalité — pas de fallback sur le label compact écran.
  `downloadConvMd()` tamponne les acks enrichis qui précèdent un message
  assistant (même motif que `renderThread`) ; `downloadMsgMd()` (ui.js) retrouve
  les acks de son propre tour en remontant `currentThread` depuis `msgIndex(wrap)`.
- **`.msg-ts` user est un sibling de `.bubble`**, pas un enfant — `align-items:
  flex-end` du `.msg.user` gère l'alignement à droite. Ne pas le mettre à
  l'intérieur du bubble (sinon il serait exclu/recréé lors des reconstructions
  de `bubble.innerHTML` comme dans `cancelEdit`).

## Export HTML standalone (lot G, brief `untracked/muscle/G-html-export.md`)

Export d'une conversation en un fichier `.html` autonome, zéro-JS, ouvrable
hors MIAOU (mail, partage). Étape G-1 : socle de fonctions pures (le
générateur de template complet et le bouton topbar sont des étapes
ultérieures du même lot).

- **Le repli à deux étages (ticker, brief N) est LIVE-ONLY** — `formatToolAcksHtml`/
  `EXPORT_CSS` en sont indépendants, aucun impact (cf. `docs/tools.md`).
- **`formatToolAcksHtml(acks)`** dans `utils.js` (pure, testée QuickJS) :
  sœur HTML de `formatToolAcksMd` — même seuils de troncature
  (`EXPORT_ARGS_MAX`/`EXPORT_RESULT_MAX`/`EXPORT_RESNAME_MAX`), même politique
  `resource_presented` (nom + mime, jamais de binaire/data-URI), mêmes acks
  legacy (sans `args`) omis. **Trois paliers** (allégé après le repli à deux
  étages du thread live, brief N — l'export suit désormais le même geste
  d'allègement en usage agentique) :
  1. replié : `<details class="tool-trace">` fermé par défaut, `<summary>`
     ne porte QUE le compteur (« 1 outil appelé » / « n outils appelés »,
     sans parenthèses ; couleur `--text-2`, volontairement discrète — pas
     `--accent`).
  2. 1er clic (ouvre le `<details>`) : liste d'intents visible
     (`.tool-ack-preview-list`, une `.tool-ack-preview` par ack — imite
     `.tool-ack` du thread live : bordure gauche + icône outil générique
     `EXPORT_ACK_ICON`, une seule icône pour tous les kinds, pas de
     dépendance à `ACK_KINDS`/ui.js hors de portée depuis `utils.js` — +
     `m.intent` si présent, sinon fallback `<code>name</code>`). Un ack en
     échec (`ackIsError`) porte la classe `ack-error` : icône `--err`, label
     `--err-soft` — mêmes couleurs que `.tool-ack.ack-error` du thread live.
  3. clic sur la liste d'intents : bascule vers le détail JSON (`<ul>`,
     séparateur `border-top` discret entre `<li>` consécutifs). La première
     ligne d'un ack en échec (nom + intent) est enveloppée dans
     `<span class="ack-head-error">` (couleur `--err-soft`).
  4. clic sur le détail JSON : **revient** à la liste d'intents (cycle, pas
     de cul-de-sac).
  Le cycle intents ↔ JSON (paliers 3/4) n'est **pas** un second `<details>`
  imbriqué : un `<details>` interne ne serait pas réinitialisé par le DOM à
  la fermeture du parent (testé — l'état `open` d'un `<details>` imbriqué
  survit à la fermeture de son parent), ce qui bloquerait en JSON après un
  collapse/reopen sans porte de sortie. À la place : une paire de
  `<input type="radio">` masqués (`.tt-radio`, `opacity:0`) + deux
  `<label for="…">` cliquables (`.tt-view-intents`/`.tt-view-json`,
  `EXPORT_CSS`) pilotées par le sélecteur `.tt-radio + .tt-radio:checked ~`
  — zéro JS, fonctionne même en export statique (`exportInteractive:
  false`). Ordre DOM figé (radio intents, radio json, label intents, label
  json) : le sélecteur CSS en dépend, ne pas réordonner sans l'ajuster.
  Fermer puis rouvrir le `<details>` externe **ne réinitialise pas** le
  choix radio (contrairement à un `<details>` imbriqué) — assumé : le
  besoin réel était une porte de sortie cliquable, pas une remise à zéro au
  collapse. **`escHtml` systématique** sur `name`, `intent`, les arguments
  JSON et le résultat (preview ET détail JSON) : ce sont des chaînes
  d'origine modèle/outil, et c'est l'unique chemin de concaténation
  string→HTML de tout l'export (cf. note de piège dans
  `CLAUDE.md`/`docs/pitfalls-detail.md`) — toute future extension qui
  ajoute un chemin similaire doit `escHtml` de la même façon.
- **`exportableAckImageKey(ack)`** dans `utils.js` (pure, testée QuickJS,
  lot Gbis) : miroir des règles image de `placeToolAck` (ui.js). Retourne
  `{ by: 'id' }` (`resource_presented`, `resource_stored`), `{ by: 'attId' }`
  (`attachment_recalled`) ou `null` (kind non porteur d'image, ou id/attId
  manquant). Ne fait **que** la sélection — le lookup cache et le filtre
  `image/`/`class !== 'inline'` restent dans `renderExportBody` (voir ci-dessous),
  seul à avoir accès au cache resources.
- **`resolveConvRefs(text, opts)`** (ui.js) gagne un paramètre optionnel
  `opts.asPlainText` (défaut `false`, comportement écran **inchangé**). En
  mode `asPlainText`, une référence de conversation vivante est rendue en
  **label nu échappé** (pas de `[label](#miaou-conv:…)`) car le lien
  `#miaou-conv:` ne résout jamais hors MIAOU (D3 du brief G — « no dead
  links »). Le tombstone `~~label (supprimée)~~` reste inchangé dans les deux
  modes (c'est déjà du texte, pas un lien). `renderMd(text, opts)` transmet
  `opts` à `resolveConvRefs` en passe-plat.
- **`buildExportHtml({ title, dateDisplay, theme, styleCss, bodyHtml, scriptTag })`**
  (ui.js, pure — mais **pas** couverte par le runner QuickJS, malgré une
  mention historique contraire : `tests/runner.py` ne l'appelle pas ; référencer
  `LOGO_SRC` — global de main.js — y est donc sans danger) : assemble le
  squelette `<!doctype html><html data-theme="…"><head>…</head><body>` (topbar
  titre+date, `bodyHtml`, footer « Généré par MIAOU », `scriptTag` avant
  `</body>`). Un seul `<link>` (favicon, cf. ci-dessous) ; pas de CDN/CSS externe
  (Prism inliné). Le `<script>` n'est plus interdit (**D1 révisé**, cf.
  ci-dessous) : il est composé par l'appelant dans `scriptTag` (vide → export
  strictement statique, ou `<script>…</script>` → progressive enhancement). Le
  `styleCss` (tokens + `EXPORT_CSS` + `PRISM_THEME_CSS`) est de même composé par
  l'appelant — `buildExportHtml` reste pur en ne faisant qu'insérer des strings
  déjà assemblées.
- **Favicon.** `<link rel="icon" href="LOGO_SRC">` — même logo data-URI que la
  sidebar (source unique, `main.js`). Statique, présent inconditionnellement
  (indépendant de `exportInteractive`/`scriptTag`).
- **Métadonnées de preview de lien (Open Graph).** Le `<head>` porte `og:title`
  (= titre de conv), `og:description`/`<meta name="description">` (= `« {titre}
  — exporté depuis MIAOU le {date} »`, `ogDesc`), `og:site_name=MIAOU`,
  `og:type=article`, `og:image` (= `LOGO_SRC`, data-URI). But : quand l'export
  est partagé dans Teams/Slack/Discord, ces balises pilotent la carte de
  preview — sinon le crawler pêche au hasard un texte de la page (typiquement
  le footer « Généré par MIAOU »). **Échappement `escHtml` systématique** sur
  chaque `content=` (un titre avec `"` casserait sinon l'attribut). **Limites connues
  et assumées** (ne pas re-investiguer sans URL réelle) : (1) `og:image` en
  **data-URI est ignoré** par la plupart des crawlers (Teams inclus) — ils
  exigent une URL http(s) fetchable ; sur une pièce jointe locale, pas de
  vignette. La balise reste (coût nul, honorée par quelques lecteurs). (2) Le
  **style de la carte** (fond/texte) est celui du client (Teams), pas pilotable
  par la page. (3) Certains clients ne génèrent une preview **que pour des URL**,
  pas pour un fichier `.html` joint — auquel cas même titre/description peuvent
  ne pas s'afficher. La seule voie vers une preview riche complète (image
  comprise) est d'héberger l'export derrière une URL publique, hors du modèle
  « fichier autonome ».
- **D1 révisé (progressive enhancement, réglage `exportInteractive`).** D1
  d'origine posait l'export comme strictement zéro-JS, abandonnant les boutons
  copier/télécharger. Révisé : le réglage `exportInteractive` (défaut `true`,
  `storage.js`) gouverne l'ajout d'un `<script>` inline (`EXPORT_SCRIPT`) qui
  **révèle** au chargement les boutons copier (`navigator.clipboard`) et
  télécharger (`Blob`) sur chaque bloc de code. Décoché → `scriptTag` vide →
  export identique à l'ancien zéro-JS (barre de langage comprise, cf.
  `decorateExportPre`). Les bénéfices D1 d'origine (sûr à ouvrir, pas de CSP,
  pas de dérive de re-parsing) restent atteignables **sur option**. La barre
  de langage, elle, est **toujours statique** — indépendante du réglage.
  **Depuis le lot R**, `EXPORT_SCRIPT` porte un second rôle : la mémorisation du
  thème choisi. La **bascule** de thème, elle, est du markup statique et ne
  dépend PAS du réglage (cf. section dédiée plus bas).
- **`EXPORT_SCRIPT`** (ui.js, constante template string, injectée seulement si
  `exportInteractive`) : script **autonome** (l'export n'a aucun global MIAOU —
  `downloadFile`/`sanitizeDownloadName`/`LANG_TO_EXT` réimplémentés inline en
  minimal). Parcourt les `<pre>`, ajoute dans le `.code-head` (déjà présent) un
  `.code-actions` avec deux boutons câblés à `code.textContent` /
  `code.getAttribute('data-filename')`. `exportConvHtml` échappe `</` du script
  (`.replace(/<\//g, '<\\/')`) avant de l'insérer dans le `<script>` porteur —
  même parade défensive que `build.py` sur `__MIAOU_CONFIG__` (EXPORT_SCRIPT
  n'en contient pas aujourd'hui, mais la garde évite qu'un futur ajout casse
  silencieusement le `</script>`).
  - **Images cliquables → nouvel onglet (lot Gb2, décision A.4).** Le même
    script pose au chargement un handler de clic sur les images ouvrables :
    images modèle (`img.tool-block-img`, lot Gbis) et vignettes de chips user
    image (`.att-chip` contenant `img.att-thumb` — clic sur le **chip entier**,
    cible plus large). Le data URL est **lu depuis le DOM** (`img.src`, posé par
    `renderExportBody`), **jamais interpolé dans le script** (piège 21). La
    navigation top-level vers un `data:` étant bloquée par les navigateurs, le
    handler convertit le data URL en `Blob` (décodeur base64 minimal
    `dataUrlToBlob`, l'IIFE n'a aucun global MIAOU) → `URL.createObjectURL` →
    `window.open(url, '_blank')`. Curseur `zoom-in` posé sur les cibles.
    **Fallback / dégradation** : conversion en échec → aucune action (pas de
    fallback `location = data:`, interdit) ; **export statique**
    (`exportInteractive` décoché, script absent) → images **visibles mais non
    cliquables** — pas d'enveloppe `<a>` posée statiquement (décision A.4 :
    liens interactifs seuls, évite le doublement des octets base64 `src` +
    `href`). Les chips **non-image** restent inertes (pas de `.att-thumb`, donc
    ignorées par la boucle de découverte).
- **`decorateExportPre(scope)`** (ui.js, DOM — pas QuickJS) : appelée par
  `renderExportBody` après le highlight Prism. Insère dans chaque `<pre>` un
  `.code-head` **statique** = un seul `<span class="code-lang">` (langage lu
  depuis `language-xxx`). **Zéro bouton, zéro onclick** (ils seraient perdus par
  la sérialisation `innerHTML`, et l'export n'a pas les globals) — les actions
  sont l'affaire d'`EXPORT_SCRIPT` au runtime. À ne pas confondre avec
  `decoratePre` (live), qui pose barre **et** boutons câblés en une passe.
- **`renderExportBody(thread, convId)`** (ui.js, DOM/marked — pas QuickJS) :
  construit un **fragment détaché** (jamais de lecture/mutation de `#thread`
  live), itère `thread` en tamponnant les acks précédant un message
  `assistant`. **Le buffer empile TOUS les acks** (comme `renderThread` live,
  PAS comme `downloadConvMd` qui ne garde que les enrichis) : le filtre
  `args != null` ne s'applique **qu'à la trace textuelle** (`traceAcks` →
  `formatToolAcksHtml`), pas au rendu d'image (lot Gbis ci-dessous). Distinction
  **payée** : un ack image secondaire — ex. `resource_stored` créé par
  `internResourcesFromResult` en sous-produit d'un `fetch_url`, jamais enrichi
  par `onEnrichLastAck` (qui vise le `fetch_url`), donc sans `args` — voyait son
  image masquée dans l'export alors qu'elle est en cache et s'affiche en live
  (image « trouvée par le modèle » absente de l'export). Même cas pour les acks
  legacy antérieurs à l'enrichissement cross-turn. **Ordre dans le message
  assistant : `meta → reasoning → outils appelés → images → corps`** (le
  raisonnement précède l'appel d'outils qu'il motive) ; les acks précédant un
  `user` sont silencieusement droppés (même choix que `downloadConvMd`, pas une
  régression).
  Corps assistant via `renderMd(content, { asPlainText: true })` (conv_ref
  délié), reasoning en `<details class="reasoning">` **fermé** par défaut, avec
  le contenu (`.reasoning-content`) **imbriqué DANS le `<summary>`** — même
  motif que `formatToolAcksHtml` (le détail est dans le summary, pas en frère) :
  tout le bloc est une zone de clic pliable **sans JS** (cf. piège
  `<details>/<summary>`, CSS `.reasoning:not([open]) .reasoning-content {
  display:none }`). Corps user via
  `renderUserMd`, attachments réutilisant `attChipHtml(att, thumb, false,
  null)` — `removable=false` et `conversationId=null` suppriment
  respectivement `.att-remove` et `.att-promote` (aucune de ces affordances
  n'a de sens dans un fichier zéro-JS). Après peuplement du fragment, si
  `highlightEnabled` et `window.Prism`, `Prism.highlightAllUnder(fragment)`
  pré-tokenise le code (voie B) : les `<span>` de coloration Prism sont
  sérialisés dans le HTML exporté, donc **déjà coloriés à l'ouverture, sans
  JS**. Un langage jamais affiché à l'écran (grammaire non chargée par
  l'autoloader Prism) reste en texte brut — dégradation gracieuse, pas de
  crash (cas limite v1 acceptable). **Async depuis le lot E4** : après le
  highlight Prism et `decorateExportPre`, `await embedExportMermaid(fragment)`
  (ci-dessous) — le reste de la construction est synchrone.
  - **Images modèle embarquées (lot Gbis) : parité reload.** Dans la branche
    assistant, après `formatToolAcksHtml(pendingAcks)` et **avant** le
    `<div class="body">` (miroir du DOM live, `placeToolAck`), on ré-émet les
    images persistées en IDB portées par les acks du groupe. La **sélection**
    est pure et testée QuickJS (`exportableAckImageKey(ack)` dans `utils.js`,
    ci-dessous) ; le **lookup cache** reste dans `renderExportBody` (seul à
    avoir `getCachedRecord`/`getCachedRecordByAttId`). Pour chaque ack retenu :
    `resource_presented` → `getCachedRecord(ack.id)` ; `resource_stored` → idem
    mais **écarté si `record.class === 'inline'`** (stocké mais non affiché auto,
    comme en live) ; `attachment_recalled` → `getCachedRecordByAttId(ack.attId,
    ack.convId)`. Bloc émis **seulement si `record.mime` commence par `image/`**,
    en `<div class="tool-block"><img class="tool-block-img" src="<dataURL>"
    alt="<escHtml(name)>"></div>`, `dataURL = 'data:' + record.mime +
    ';base64,' + arrayBufferToBase64(record.data)`. **`escHtml` sur `src` et
    `alt`** (piège 21 : `record.mime`/`record.name` viennent du stockage MIAOU,
    pas du texte modèle, mais échappés quand même en position d'attribut ; le
    base64 est construit par nous). **Record absent → rien** (fenêtre de course
    théorique : export déclenché juste après ouverture, avant que
    `loadConversationResources` fire-and-forget ait peuplé le cache) — **pas
    d'`await` IDB dans ce chemin**, dégradation identique à aujourd'hui.
    **Non-parité assumée** : les blocs D8 éphémères en échec de stockage (jamais
    internés en IDB) ne sont pas exportés — hors périmètre (décision Gbis §0.3),
    comme ils sont absents au reload live. Le gate anti-doublon D8 du live
    (`getPendingToolBlocks().length === 0` sur `resource_stored`) n'est **pas**
    transposé : aucune file pendante à l'export. Affichage **pleine largeur**
    (décision A.2), curseur/lien de clic posés uniquement en interactif (Gb2).
- **`embedExportMermaid(container)`** (ui.js, DOM/async — pas QuickJS, lot E4) :
  passe Mermaid de l'export. Chaque `code.language-mermaid` du fragment devient
  un **SVG embarqué statiquement** (`.mermaid-view` — visible à l'ouverture du
  fichier, **sans JS**), la source surlignée restant disponible repliée dans un
  `<details class="mermaid-src">` : le `<pre>` d'origine y **déménage intact**
  (code-head compris — `EXPORT_SCRIPT` y greffe copier/télécharger si l'export
  est interactif, `data-filename` inclus). Le SVG **conserve son id** : le
  `<style>` interne de Mermaid scope chaque règle par `#<id>` (même raison que
  la lightbox E3) ; ids uniques par rendu (`xmmd` + compteur + suffixe
  aléatoire), pas de collision entre diagrammes. Thème : celui de la session au
  moment de l'export (`mermaidInit` courant), cohérent avec le `data-theme`
  émis. `view.innerHTML = out.svg` : markup produit par **Mermaid strict**, pas
  de re-sanitisation — même posture que `renderMermaidUnder`
  (cf. `docs/rendering.md`), c'est la **deuxième exception sanctionnée** du
  chemin string→HTML de l'export après `formatToolAcksHtml` (piège 21).
  **Double fallback, zéro régression vs lot G** : Mermaid non chargeable
  (offline, `ensureMermaid` rejette) → passe entière ignorée, toutes les
  sources surlignées restent telles quelles ; erreur de parse d'un bloc → CE
  bloc reste source surlignée (nœud d'erreur orphelin de Mermaid v11 purgé,
  même hygiène que le live), les autres sont rendus. **Pas de barre d'actions,
  de toggle ni de lightbox dans l'export** (boutons perdus à la sérialisation
  `innerHTML`, aucun global MIAOU côté fichier) ; pas de préviz iframe non
  plus (audit §4b).
- **`THEME_TOKENS`** (ui.js, liste de noms `--…`) + **`serializeThemeTokens()`**
  (via `readThemeTokens()`, qui lit `getComputedStyle(document.documentElement)`
  pour chaque nom) : voie **runtime** tranchée (pas de modif `build.py`, pas de
  placeholder). **`THEME_TOKENS` est la seule chose à tenir à jour** si un token
  `--…` est ajouté à `base.css`/`theme-light.css` ; `--col`/`--sidebar-w`
  volontairement exclus (mise en page écran, sans usage dans un document
  statique).

  **Depuis le lot R, les DEUX jeux de tokens sont émis** (avant : le seul thème
  effectif) — c'est ce qui permet de changer de thème à la lecture.

  **La case à cocher `#theme-switch` est la SEULE source de vérité du thème**
  dans un export. Les tokens sortent sous la forme `body{…sombre…}` +
  `body:has(#theme-switch:checked){…clair…}` (helper `exportLightSelector()`,
  formule unique partagée avec les surcharges Prism via
  `prismThemeCssForExport()` — deux formules divergentes redonneraient le bug
  « l'icône change mais pas les couleurs »).

  **Aucun `data-theme` n'est posé sur le `<html>` exporté**, contrairement à
  l'app. Première version du lot : attribut figé par `buildExportHtml` + bouton
  construit en JS — l'attribut gagnait en permanence sur la case, donc sans
  JavaScript le clic changeait l'icône mais **pas** les couleurs (bug constaté).
  Les tokens sont portés par `body` et non `:root` parce que la case vit dans
  `body` : `:has()` remonte à un ancêtre, un sélecteur de frère non.

  **Pas de `@media (prefers-color-scheme)`** : `theme-light.css` proscrit
  explicitement ce doublon (« UNE seule variante ») et l'export s'aligne.

  **Lecture du thème inactif : bascule temporaire de `documentElement`.** Les
  tokens du thème non appliqué ne sont lisibles QUE sur l'élément racine — les
  sélecteurs de l'app sont ancrés sur `html`, donc un élément détaché ou hors
  écran portant `data-theme` ne les résout pas (vérifié au spike : détaché →
  chaînes vides ; hors écran → valeurs du thème *actif*). `serializeThemeTokens()`
  bascule donc l'attribut de l'APP, mesure, restaure — **entièrement synchrone**
  (aucun `await` entre bascule et restauration, donc aucun repaint intercalé :
  invisible) et sous `try/finally`. L'attribut est touché **en direct**, jamais
  via `applyTheme` (hooks Mermaid/accueil) ni `selectTheme` (persistance +
  broadcast multi-onglets, piège 24).

- **`PRISM_THEME_CSS`** (ui.js, constante) : copie **figée** de
  `prism-tomorrow.min.css` (CDN, cf. `index.html`) + les overrides Prism clair
  de `theme-light.css`. Inlinée dans l'export (pas de `<link>` CDN) puisque
  les `<span>` de tokens sont pré-générés par `renderExportBody`. **Dette
  assumée** : à resynchroniser manuellement si le thème Prism CDN change
  (rare).
- **`EXPORT_CSS`** (ui.js, constante, template string) : feuille **dédiée et
  minimale**, écrite à la main — PAS une extraction programmatique de
  `chat.css`/`tools.css` (leur sectionnement mélange règles écran/export,
  dette `next.md`), PAS un miroir vivant de ces fichiers. Couvre uniquement
  ce qui a un sens dans un document statique : bulles, typo markdown, tables,
  blocs de code (dont la barre `.code-head`/`.code-lang`/`.code-actions`/
  `.code-copy`/`.code-dl` portée depuis `chat.css`), `.reasoning`/`.tool-trace`
  en `<details>`, attachments (`.att-chip`/`.att-thumb`/`.att-icon`),
  diagrammes Mermaid embarqués (`.mermaid-view`/`.mermaid-src`, lot E4 — nés
  synchronisés avec le `.mermaid-view` de `chat.css` : padding, fond
  `--code-bg`, centrage svg ; sans `display:none`/toggle, le SVG exporté est
  toujours visible). **Dette
  assumée et mémorisée** : si
  `chat.css`/`tools.css`/`composer.css` évoluent (nouvelle classe, structure
  changée), `EXPORT_CSS` ne suit PAS automatiquement — seuls les tokens de
  couleur (voie `getComputedStyle`) restent synchronisés. Revue manuelle à la
  charge de qui retouche ce CSS.
  - **Largeur de lecture : `900px` EN DUR**, pas via `var(--col)` (720px,
    gabarit du composer écran) : `--col` est volontairement absent de
    `THEME_TOKENS` (sans usage dans un document statique), donc y référencer
    `var(--col)` résoudrait à rien. 900px choisi après retour manuel (« 720px
    trop étroit ») pour une lecture plus confortable qu'à l'écran, sans
    devenir disproportionné sur un grand écran (`.export-topbar`/
    `.export-body`/`.export-footer` partagent tous cette valeur en dur — si
    on la change, la changer aux trois endroits).
  - **`zoom: 0.9` sur `<html>`** : dézoom global de l'export (retour manuel —
    la mise en page par défaut était perçue comme trop grande). Choisi plutôt
    que `transform: scale(0.9)` (universellement supporté mais laisse un
    espace vide résiduel puisque la mise en page garde sa taille de layout
    avant réduction visuelle) — `zoom` respecte le flow naturel de la page.
    Support Firefox natif récent (~2024+) ; dégradation gracieuse en cas
    d'absence de support (page affichée à 100%, pas de crash). Toutes les
    tailles d'`EXPORT_CSS` sont en `px` absolus (pas d'`em`/`rem`), donc ce
    zoom global scale fidèlement l'ensemble sans recalcul de chaque valeur.
- **Bouton retitle-btn (fix collatéral, pas lié à G)** : `.topbar-mid:hover
  .conv-retitle-btn` révélait le bouton de retitrage au survol de **tout**
  `.topbar-mid` (titre ET boutons de download, jumeaux), contredisant le
  commentaire du CSS (« retitrage au survol du titre seulement ») — bug
  pré-existant, révélé par l'ajout du second bouton jumeau. Corrigé en
  `:has(#conv-title:hover, .conv-retitle-btn:hover)` (chat.css) : la
  condition inclut le bouton lui-même, sinon il disparaîtrait sous le
  curseur dès qu'on quitte `#conv-title` pour l'atteindre.
- **`exportConvHtml()`** (ui.js, global — handler `onclick`) : point
  d'entrée. Résout titre/slug (`slugTitle`)/thème actif/`dateStamp`
  (`exportDateStamp`), assemble `styleCss` et `bodyHtml`, appelle
  `buildExportHtml`, calcule la taille du HTML final (`Blob.size`) et avertit
  via **`confirm()` natif** si elle dépasse `EXPORT_HTML_SIZE_WARN` (8 Mo —
  pas de dialogue dédié en v1, YAGNI), puis télécharge
  `miaou-<slug>-<dateStamp>.html` via `downloadFile`. **Async depuis le lot
  E4** (la passe Mermaid attend le CDN et les rendus) : verrou de réentrance
  `_exportingHtml` (l'await ouvre une fenêtre de double-clic → double
  téléchargement, cf. mémoire B5/B7), et `renderExportBody` est encadré par
  `runBackgroundTask('export HTML…')` (indicateur d'activité pendant le
  chargement CDN ; un échec — improbable, tous les await internes sont
  gardés — rend `null` → abandon silencieux).
- **Câblage topbar (livré, commit `106245c`)** : bouton `.conv-dl-html-btn`
  jumeau de `.conv-dl-btn` (index.html), `onclick="exportConvHtml()"` (ui.js).
  `syncConvDownloadBtn()` gère les DEUX boutons ensemble : même condition
  d'affichage (`hidden` levé quand une conversation a du contenu), désactivés
  pendant l'envoi (`setSending`). Pas d'entrée palette (gatée sur le lot F,
  absent) — le point d'entrée est le bouton topbar seul.

## Bascule de thème dans l'export (lot R)

**Markup STATIQUE, pas de JavaScript** : une case `#theme-switch` masquée en tête
de `<body>` + un `<label class="theme-switch-label">` cliquable, tous deux émis
par `buildExportHtml`. La bascule est donc **présente et opérante dans TOUS les
exports**, y compris `exportInteractive: false` — et surtout dans les
visionneuses de pièces jointes qui n'exécutent aucun script (Quick Look iOS,
aperçus de mail). Première version : bouton construit par `EXPORT_SCRIPT`, donc
absent de ces visionneuses (constaté par Julien sur iPhone) — c'est ce qui a
motivé le passage au markup statique.

- **Rôle résiduel d'`EXPORT_SCRIPT`** : la **persistance** du choix seulement
  (clé `localStorage` dérivée de `location.pathname`, pour qu'un export ne
  contamine pas la préférence d'un autre ; lecture/écriture sous `try/catch`).
  Sans lui, la bascule marche, le choix n'est simplement pas mémorisé d'une
  ouverture à l'autre. Il ne pose **aucun attribut de thème** (cf.
  `serializeThemeTokens()` : la case est seule source de vérité).
- **Placement** : `position: fixed` — contrainte du sélecteur `:has()`, qui
  impose que la case reste en tête de `body`. Calé sur la **colonne de lecture**
  (`left: min(100vw - 50px, 50% + 450px)`), pas sur le bord du viewport. Deux
  jets antérieurs rejetés : bas-droite (flottait dans le vide sous le contenu),
  puis `right: 16px` (désolidarisé du cartouche sur grand écran).
- **Icône** : soleil quand on est en sombre, lune quand on est en clair —
  l'icône montre **la destination**, pas l'état courant.
- **Limite connue : les diagrammes Mermaid ne suivent pas.** `embedExportMermaid`
  produit un SVG portant un `<style>` interne aux couleurs **résolues à
  l'export** ; la bascule ne les recolore pas. Les faire suivre imposerait
  d'embarquer Mermaid dans le fichier exporté (hors sujet, ~2,5 Mo). Limite
  assumée, documentée aussi dans `src/help.md`.

## Conversion Markdown → HTML (lot R)

Convertit un `.md` **de l'utilisateur** (pas du contenu modèle) en document
autonome au même format que l'export de conversation. Point d'entrée : réglages
» « Outils & extensions » » zone de dépôt (clic ou drag&drop). **Aucun passage
par le modèle**, aucune ressource stockée.

- **Fonctions pures** (`utils.js`, testées QuickJS) :
  - `extractMdTitle(md)` → `{ title, body }`. Le titre est le `# …` **en tête**
    de document (forme ATX seule ; Setext non reconnu, il reste rendu dans le
    corps) ; il est **retiré du corps** pour ne pas apparaître deux fois. Un
    front-matter YAML en ouverture est retiré au passage. `title: null` quand il
    n'y a pas de h1 en tête — c'est ce `null` qui supprime le cartouche.
  - `mdHtmlFileName(source)` → nom de sortie : seule l'extension finale
    `.md`/`.markdown` est remplacée par `.html` (« notes v2.md » → « notes
    v2.html »). Le titre h1 n'intervient **pas** (le nom suit le fichier
    source). Séparateurs de chemin et caractères de contrôle neutralisés, points
    de tête retirés — dans cet ordre (`../etc/passwd.md` → `_etc_passwd.html`).
- **`renderMarkdownDocBody(md)`** (ui.js, async) : **troisième chemin
  string→HTML** au sens du piège 21, assumé et documenté. Ni `renderMd` (qui
  applique `resolveConvRefs` — des références de conversation n'ont aucun sens
  dans un `.md` externe), ni `renderUserMd` (qui échappe les `<`, alors qu'un
  `.md` peut légitimement porter du HTML inline) : `marked` est appelé
  directement, **mais la sortie traverse `sanitizeHtml`/DOMPurify** comme les
  deux autres — c'est ce qui rend ce chemin sûr, et toute évolution doit
  conserver cette passe.

  **`breaks: false`, contrairement aux renderers de l'écran.** `renderMd`/
  `renderUserMd` utilisent `breaks: true` parce qu'ils rendent des messages de
  **chat**, tapés au fil de l'eau, où « une ligne = une ligne » est le bon
  comportement. Un fichier `.md` est un **document** : il est presque toujours
  enroulé à ~80 colonnes, et ces retours ne sont pas sémantiques — les rendre en
  `<br>` reproduisait la largeur du fichier source au lieu de laisser le texte se
  réenrouler (retour Julien, corrigé après livraison). Convention CommonMark
  standard : retour simple = espace, ligne vide = nouveau paragraphe, deux espaces
  en fin de ligne = `<br>` explicite. Le repli sans `marked`
  (`plainTextToParagraphs`, utils.js, pure et testée) suit la **même** convention,
  pour que le rendu ne dépende pas de la disponibilité du CDN. Le conteneur **réutilise la classe `.body`** (toutes
  les règles typographiques d'`EXPORT_CSS` y sont attachées sans dépendre de
  `.msg.assistant`) + `.md-doc` pour le peu qui lui est propre ; inventer une
  seconde classe la ferait dériver (piège 22).
- **`highlightMarkdownDocCode(container)`** : les blocs d'un `.md` sont
  **neufs**, leur grammaire Prism n'a jamais été chargée. Piège vérifié :
  passer un callback à `Prism.highlightElement` **ne suffit pas** — l'autoloader
  demande bien la grammaire (requête observée, HTTP 200) mais le callback est
  rappelé **après** que le bloc a été rendu sans elle (résultat : zéro token).
  On **précharge** donc les grammaires manquantes (`loadPrismGrammar`, une
  promesse mémoïsée par langage, **réinitialisée en cas d'échec** — hygiène des
  caches async) **puis** on colorise. Ce cas ne se pose pas pour l'export de
  conversation, dont les blocs ont déjà été coloriés à l'écran.
- **`buildExportHtml`** est partagé avec l'export de conversation, avec deux
  paramètres qui les distinguent :
  - `title` **null/vide → aucun cartouche** (ni logo, ni titre). Le cartouche
    ne porte QUE logo + titre : **la date vit systématiquement dans le footer**
    (décision Julien), avec ou sans cartouche — un seul endroit, pas de branche
    conditionnelle. `.export-body:first-child` donne au corps sa respiration
    haute quand il n'y a pas de cartouche.
  - `kind` (`'export'` | `'convert'`) pilote le vocabulaire du footer via
    `EXPORT_VERBS` : « Généré par MIAOU le … » pour une conversation,
    « Converti par MIAOU le … » pour un `.md`. (`verbs.meta` ne sert plus qu'à
    la description Open Graph depuis que la date a quitté le cartouche.)
- **Câblage** (handlers globaux, attributs inline `index.html` — cf. CLAUDE.md) :
  `onMdConvertPick` / `onMdConvertInput` / `onMdConvertDragOver` /
  `onMdConvertDragLeave` / `onMdConvertDrop`. Le filtre de fichier réutilise
  `isMarkdownFile` (drawer skills), pas un second prédicat. Verrou de réentrance
  `_convertingMd` (la conversion est async : un second dépôt produirait deux
  téléchargements concurrents). `onMdConvertInput` **réinitialise `input.value`**
  — sans ça, re-choisir le même fichier ne déclenche aucun `change`.
  Contrairement au drawer skills, un fichier non-`.md` déposé donne un **retour
  visible** (`md-convert-status--error`) : l'utilisateur a visé une zone dédiée,
  le silence passerait pour un bug.

## Bouton « Convertir en page HTML » sur un bloc de code (lot R)

Quatrième point du lot : le même geste que le convertisseur des réglages,
appliqué au contenu d'un bloc markdown **affiché à l'écran** (sans passer par un
fichier). Ajouté par `decoratePre` comme les autres actions de bloc.

- **Gating** : `isMarkdownLang(lang)` (utils.js, pure, testée) — `markdown` et
  `md` seulement. Même motif que `isPreviewableLang`/`isMermaidLang`.
- **Un seul chemin de conversion** : le handler appelle
  `convertMarkdownToHtmlFile`, exactement comme la zone de dépôt — pas de second
  rendu à faire dériver.
- **Nom de sortie** : `data-filename` du bloc s'il existe, sinon le titre h1 du
  markdown (`extractMdTitle`), sinon repli neutre. `mdHtmlFileName` pose
  l'extension.
- Le bouton se **désactive** pendant la conversion (async) — `:disabled` stylé
  dans `chat.css`.

**Correctif de style au passage** : `.code-preview-btn` (lot E) n'était dans
aucune règle de `chat.css` et se rendait en **4×19 px** — bouton quasi
invisible, sans zone de clic. Il a été ajouté aux mêmes sélecteurs que
`.code-copy`/`.code-dl`/`.code-mmd-toggle` en même temps que `.code-md-html`
(tous en 26×26 désormais). Défaut préexistant, mesuré au box-model runtime.

## Rendu mobile des pages exportées (lot R)

Deux correctifs, indissociables :

- **`<meta name="viewport">`** dans `buildExportHtml` — **il n'y en avait
  aucun**. Sans lui un mobile rend la page à ~980px puis la réduit : le texte
  paraît minuscule ET aucune media query mobile ne se déclenche. C'était la
  cause principale du retour « texte trop petit sur mobile ».
- **`@media (max-width: 767px)`** dans `EXPORT_CSS` (même point de rupture que
  `responsive.css`) : `html { zoom: 1 }` — le `zoom: 0.9` global, confortable
  sur grand écran, est trop petit au téléphone — et paddings resserrés.
- **`@media (pointer: coarse)`** pour le bouton de thème : sans survol possible,
  son `opacity: 0.55` de repos le laissait indéfiniment à demi-effacé (il
  passait pour absent — retour Julien). Opacité pleine, couleur `--text-2`, et
  cible portée à 40px.

**Placement du bouton (deux correctifs successifs, tous deux mesurés).** Le
label est en `position: fixed` — contrainte du sélecteur `:has()`, qui impose
que la case reste en tête de `body` — donc **hors du flux** :

- il ne réserve aucune place, et un titre long passait **dessous** en se faisant
  amputer (constaté sur iPhone, chevauchement mesuré à 38px). D'où le
  `padding-right` de `.export-topbar` (66px, 72px en tactile où le bouton est
  plus gros) : c'est cette réserve, et rien d'autre, qui protège le titre. La
  retirer ramènerait le bug.
- calé sur `right: 16px`, il suivait le bord du **viewport** alors que le
  cartouche est une colonne de 900px **centrée** : sur un écran de 1440px il
  flottait à ~270px du cartouche, visuellement désolidarisé. Remplacé par
  `left: min(100vw - 50px, 50% + 450px)` — bord droit de la colonne sur grand
  écran, bord de l'écran quand le viewport est plus étroit qu'elle.

`verify-export-mobile` mesure les deux (chevauchement titre/bouton en mobile ET
desktop, écart bouton/colonne sur grand écran).

## Horodatages des messages

- `formatMessageTime(ts, now)`, `formatFullDateFr(ts)` et `formatDateRelative(ts, now)`
  dans `utils.js` : fonctions pures, **sans `Intl` ni `toLocaleString`** (déterminisme
  + testabilité QuickJS). Abréviations et noms complets des jours/mois codés en dur
  en français.
- `SHOW_YEAR_AFTER_DAYS = 183` : constante nommée, exprimée en jours (pas en
  mois calendaires), testable par soustraction d'epoch.
- `_startOfDay(d)` : helper interne (minuit local, DST-safe) partagé par
  `formatMessageTime` et `formatDateRelative`. Le delta calendaire se calcule via
  `Math.round((_startOfDay(n) - _startOfDay(d)) / 86400000)` — **`Math.round`, pas
  `Math.floor`** : au passage heure d'été un jour calendaire adjacent dure 23h,
  `floor` le classerait à tort comme « aujourd'hui ».
- `formatMessageTime` distingue le découpage **calendaire** (minuit/minuit) de la
  fenêtre 24h glissante : un message d'hier à 23:50 est « hier » même si < 24h
  se sont écoulées ; un message à 00:10 aujourd'hui est l'heure courte même si
  > 9h se sont écoulées.
- `formatDateRelative` est **date-only** (pas de composante horaire) : tiers
  aujourd'hui / hier / avant-hier / `"3 mars"` / `"12 janvier 2024"`, réutilise
  `SHOW_YEAR_AFTER_DAYS` et `FR_MONTHS_FULL`. Employé par `showSummaryBanner` pour
  les dates des items de la liste.
- `formatFullDateFr` (ex. « jeudi 26 juin 2026 à 14:30 ») est réservé aux
  **tooltips de la sidebar** (`:hover` = contexte de détail, l'année toujours
  présente). Pour les horodatages inline des messages, utiliser `formatMessageTime`.
- Le champ `ts` (epoch ms) est posé par `sendUserText` (user), `onFinal` et
  `onToolTour` (assistant). Absent sur les anciens messages → affichage sans
  horodatage, pas de crash.
