/* ── export.js ─────────────────────────────────────────────────────────────
   Exports d'une conversation ou d'un message en fichier autonome (HTML
   standalone du lot G, Markdown), et conversion d'un .md quelconque au même
   format (lot R). Séparé d'ui.js le 2026-09-25 : le domaine est clos sur
   lui-même (feuille EXPORT_CSS et script EXPORT_SCRIPT figés, cf.
   docs/exports.md), et ui.js dépassait 13 000 lignes. Chargé juste APRÈS ui.js
   dans JS_ORDER, donc l'ordre de concaténation du bundle est inchangé.
   Les pièges 21 et 22 de CLAUDE.md gouvernent ce fichier.
   ────────────────────────────────────────────────────────────────────────── */

// ── Export HTML standalone (lot G) ──────
// Fichier autonome zéro-JS, ouvrable hors MIAOU. Le corps est un RE-RENDU
// depuis currentThread (jamais un clone du DOM live #thread) : sûr par
// construction (mêmes renderers que l'écran), pas de nouveau chemin de
// concaténation de texte modèle hors formatToolAcksHtml (cf. utils.js).

// Liste des tokens de thème (:root, base.css) à sérialiser pour l'export.
// SEULE chose à tenir à jour si un token --… est ajouté au thème (dette
// assumée, cf. docs/exports.md) : --col/--sidebar-w exclus, spécifiques à la
// mise en page écran, sans usage dans un document statique.
const THEME_TOKENS = [
  '--bg', '--surface', '--surface-2', '--surface-3', '--surface-4',
  '--border', '--border-2',
  '--text', '--text-2', '--text-3',
  '--accent', '--accent-2', '--accent-ink', '--accent-dim', '--accent-bd',
  '--ok', '--err', '--err-soft',
  '--r', '--r-sm', '--ease',
  '--sans', '--mono',
  '--topbar-bg', '--scrollbar-thumb-hover', '--table-stripe',
  '--code-bg', '--code-head-bg', '--code-inline-color',
];

// Lit les valeurs RÉSOLUES (thème effectif, data-theme déjà tranché light|dark)
// via getComputedStyle — voie runtime tranchée (audit §5) : zéro modif
// build.py, capture automatiquement toute évolution des valeurs de tokens
// (mais PAS l'ajout d'un nouveau nom : cf. THEME_TOKENS ci-dessus).
function readThemeTokens() {
  const cs = getComputedStyle(document.documentElement);
  return THEME_TOKENS.map(name => name + ':' + cs.getPropertyValue(name).trim() + ';').join('');
}

// Sérialise les DEUX jeux de tokens pour que l'export interactif puisse
// basculer de thème (bouton posé par EXPORT_SCRIPT) — même forme que
// theme-light.css et PRISM_THEME_CSS : `:root` porte le sombre, le clair
// surcharge sous `html[data-theme="light"]`. PAS de @media
// (prefers-color-scheme) : theme-light.css proscrit explicitement ce doublon
// (« UNE seule variante ») et l'export s'aligne. Conséquence assumée
// (arbitrage Julien) : un export NON interactif reste figé sur le thème actif
// à l'export, sans suivi de l'OS — statu quo, pas une régression.
//
// Les tokens du thème inactif ne sont lisibles QUE sur documentElement : les
// sélecteurs sont ancrés sur `html`, un élément détaché ou hors écran portant
// data-theme ne les résout pas (spike tranché). D'où la bascule temporaire de
// l'attribut, ENTIÈREMENT SYNCHRONE (aucun await entre bascule et restauration
// → aucun repaint intercalé, invisible) et sous try/finally. On touche
// l'attribut EN DIRECT, jamais via applyTheme (hooks Mermaid/accueil) ni
// selectTheme (persistance + broadcast multi-onglets, piège 24).
// Construit le sélecteur « thème clair » d'un export pour une cible donnée.
// UNE seule formule, partagée par les tokens et par les surcharges Prism —
// deux formules divergentes redonneraient le bug « l'icône change mais pas les
// couleurs ». La case (#theme-switch) est la source de vérité ; `:has()` permet
// de remonter jusqu'à un ancêtre de la cible, donc de fonctionner SANS
// JavaScript (visionneuses type Quick Look iOS).
function exportLightSelector(target) {
  return target === 'body'
    ? 'body:has(#theme-switch:checked)'
    : 'body:has(#theme-switch:checked) ' + target;
}

// PRISM_THEME_CSS est écrite avec des préfixes `html[data-theme="light"]`
// (hérités du lot G, et toujours la forme utilisée par l'app à l'écran). Dans
// l'EXPORT, l'attribut n'est plus la source de vérité : on réécrit ces préfixes
// vers la case. Réécriture à l'usage plutôt que constante en dur → la copie
// figée du thème Prism reste lisible et resynchronisable telle quelle
// (dette assumée documentée), et une seule formule gouverne le thème clair.
function prismThemeCssForExport() {
  return PRISM_THEME_CSS.replace(/html\[data-theme="light"\] /g,
                                 exportLightSelector('body') + ' ');
}

function serializeThemeTokens() {
  const root = document.documentElement;
  const active = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const activeCss = readThemeTokens();
  let otherCss;
  try {
    root.setAttribute('data-theme', active === 'light' ? 'dark' : 'light');
    otherCss = readThemeTokens();
  } finally {
    root.setAttribute('data-theme', active);
  }
  const darkCss = active === 'dark' ? activeCss : otherCss;
  const lightCss = active === 'light' ? activeCss : otherCss;
  // Les tokens sont portés par `body`, PAS `:root` : la bascule sans JS repose
  // sur une case à cocher (#theme-switch, premier enfant de body) et un
  // sélecteur de frère — un frère ne peut pas remonter jusqu'à <html>. Depuis
  // body les variables héritent à tout le document, ce qui revient au même.
  //
  // Deux voies de surcharge claire, volontairement redondantes :
  //  - `body:has(#theme-switch:checked)` : fonctionne **sans JavaScript**
  //    (visionneuses type Quick Look iOS, qui n'exécutent aucun script).
  //    `:has()` évite d'énumérer les frères de la case — sinon tout nouveau
  //    bloc de premier niveau devrait être ajouté à la liste, et le fond de
  //    `body` lui-même resterait non couvert.
  //  - `html[data-theme="light"] body` : posée par EXPORT_SCRIPT quand le JS
  //    tourne (et par buildExportHtml pour le thème d'ouverture).
  // La case reflète le thème d'export à la génération ; le JS, quand il est
  // présent, la garde synchronisée avec l'attribut.
  // La CASE est la seule source de vérité du thème dans l'export — pas
  // l'attribut. Un `html[data-theme]` figé par buildExportHtml gagnerait sur
  // elle en permanence : sans JS pour le mettre à jour, le clic changeait
  // l'icône mais pas les couleurs (bug constaté). L'attribut n'est donc plus
  // posé du tout ; EXPORT_SCRIPT le reflète pour Prism (cf. exportLightSelector).
  return 'body{' + darkCss + '}' + exportLightSelector('body') + '{' + lightCss + '}';
}

// Copie figée de prism-tomorrow.min.css (thème Prism dark chargé depuis le
// CDN, cf. index.html) + les overrides Prism clair de theme-light.css.
// Dette assumée (docs/exports.md) : à resynchroniser si le thème Prism CDN
// change. Pas de <link> CDN dans l'export (zéro-JS) : les <span> de
// tokens sont pré-générés par Prism.highlightAllUnder à l'export (voie B),
// ce CSS leur donne juste leurs couleurs.
const PRISM_THEME_CSS =
  'code[class*=language-],pre[class*=language-]{color:#ccc;background:0 0;font-family:Consolas,Monaco,\'Andale Mono\',\'Ubuntu Mono\',monospace;font-size:1em;text-align:left;white-space:pre;word-spacing:normal;word-break:normal;word-wrap:normal;line-height:1.5;-moz-tab-size:4;-o-tab-size:4;tab-size:4;-webkit-hyphens:none;-moz-hyphens:none;-ms-hyphens:none;hyphens:none}' +
  'pre[class*=language-]{padding:1em;margin:.5em 0;overflow:auto}' +
  ':not(pre)>code[class*=language-],pre[class*=language-]{background:#2d2d2d}' +
  ':not(pre)>code[class*=language-]{padding:.1em;border-radius:.3em;white-space:normal}' +
  '.token.block-comment,.token.cdata,.token.comment,.token.doctype,.token.prolog{color:#999}' +
  '.token.punctuation{color:#ccc}' +
  '.token.attr-name,.token.deleted,.token.namespace,.token.tag{color:#e2777a}' +
  '.token.function-name{color:#6196cc}' +
  '.token.boolean,.token.function,.token.number{color:#f08d49}' +
  '.token.class-name,.token.constant,.token.property,.token.symbol{color:#f8c555}' +
  '.token.atrule,.token.builtin,.token.important,.token.keyword,.token.selector{color:#cc99cd}' +
  '.token.attr-value,.token.char,.token.regex,.token.string,.token.variable{color:#7ec699}' +
  '.token.entity,.token.operator,.token.url{color:#67cdcc}' +
  '.token.bold,.token.important{font-weight:700}' +
  '.token.italic{font-style:italic}' +
  '.token.inserted{color:green}' +
  'html[data-theme="light"] code[class*="language-"],' +
  'html[data-theme="light"] pre[class*="language-"]{color:#2c2720}' +
  'html[data-theme="light"] .token.comment,' +
  'html[data-theme="light"] .token.prolog,' +
  'html[data-theme="light"] .token.doctype,' +
  'html[data-theme="light"] .token.cdata{color:#8a8272;font-style:italic}' +
  'html[data-theme="light"] .token.punctuation{color:#5a5248}' +
  'html[data-theme="light"] .token.namespace{opacity:.75}' +
  'html[data-theme="light"] .token.property,' +
  'html[data-theme="light"] .token.constant,' +
  'html[data-theme="light"] .token.symbol{color:#8a6800}' +
  'html[data-theme="light"] .token.boolean,' +
  'html[data-theme="light"] .token.number{color:#b5440e}' +
  'html[data-theme="light"] .token.string,' +
  'html[data-theme="light"] .token.char,' +
  'html[data-theme="light"] .token.attr-value,' +
  'html[data-theme="light"] .token.builtin,' +
  'html[data-theme="light"] .token.inserted{color:#276e38}' +
  'html[data-theme="light"] .token.selector,' +
  'html[data-theme="light"] .token.attr-name{color:#b53030}' +
  'html[data-theme="light"] .token.operator,' +
  'html[data-theme="light"] .token.entity,' +
  'html[data-theme="light"] .token.url{color:#1a6b6b}' +
  'html[data-theme="light"] .token.atrule,' +
  'html[data-theme="light"] .token.keyword{color:#7c3c99}' +
  'html[data-theme="light"] .token.function,' +
  'html[data-theme="light"] .token.class-name{color:#1a5fb8}' +
  'html[data-theme="light"] .token.regex,' +
  'html[data-theme="light"] .token.important,' +
  'html[data-theme="light"] .token.variable{color:#b5440e}' +
  'html[data-theme="light"] .token.tag,' +
  'html[data-theme="light"] .token.deleted{color:#b53030}';

// Feuille dédiée MINIMALE (audit §5, choix A) : le sectionnement chat/tools
// n'est pas assez propre pour une extraction programmatique par marqueurs
// (dette next.md), et la majorité des règles écran (:hover, boutons, drawers)
// n'ont aucun sens dans un document statique. Écrite à la main, PAS un miroir
// vivant de chat.css/tools.css/composer.css : dérive silencieusement si ces
// fichiers évoluent (dette assumée, cf. docs/exports.md et mémoire projet).
// Largeur de lecture (900px) EN DUR, pas via var(--col) (720px, gabarit
// composer écran plus étroit) : --col est un token de mise en page écran,
// volontairement absent de THEME_TOKENS (sans usage dans un document
// statique) — le référencer ici résoudrait à rien puisque
// serializeThemeTokens() ne l'émet jamais. 900px choisi pour l'export
// (lecture plus confortable qu'à l'écran, sans devenir "vertigineux" sur un
// grand écran). Si on veut la faire suivre `--col`, l'ajouter à THEME_TOKENS.
const EXPORT_CSS = `
html { zoom: 0.9; }
/* Sur mobile, le zoom 0.9 (confortable sur grand écran, où il donne de l'air à
   une colonne de 900px) rend le texte trop petit : on revient à 100 % sous le
   point de rupture 767px, le même que responsive.css. Retour Julien après test
   sur mobile. Indissociable du <meta viewport> ajouté au même lot dans
   buildExportHtml : sans lui cette media query ne se déclencherait jamais. */
@media (max-width: 767px) {
  html { zoom: 1; }
  .export-body { padding: 16px 14px; }
  .export-topbar { padding: 12px 14px; }
  .export-footer { padding: 16px 14px; }
}
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.5; margin: 0; }
/* Scrollbars : copie des règles de base.css (EXPORT_CSS est une feuille figée,
   rien ne s'y propage — cf. piège 22). Utile surtout aux blocs de code, dont le
   <code> scrolle horizontalement quand une ligne déborde ; sans ça WebKit y
   pose sa barre par défaut, épaisse et hors palette. Les deux tokens employés
   (--border-2, --scrollbar-thumb-hover) sont déjà dans THEME_TOKENS, donc
   sérialisés pour les DEUX thèmes : la barre suit la bascule claire/sombre.
   scrollbar-color/-width est la voie standard (seule que Firefox comprenne) ;
   elle n'a pas d'état :hover, d'où le pouce figé sur --border-2 côté Firefox. */
* { scrollbar-width: thin; scrollbar-color: var(--border-2) transparent; }
::-webkit-scrollbar { width: 7px; height: 7px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
.export-topbar-wrap { border-bottom: 1px solid var(--border); }
/* Le padding droit RÉSERVE la place du bouton de thème : celui-ci est en
   position:fixed (contrainte du sélecteur :has(), cf. serializeThemeTokens) donc
   hors du flux — sans cette réserve, un titre long passe DESSOUS et se fait
   amputer (constaté sur iPhone). 34px de bouton + 16px de marge + respiration.
   La variante tactile (bouton 40px) ajoute sa propre réserve plus bas. */
.export-topbar { max-width: 900px; margin: 0 auto; padding: 14px 20px; padding-right: 66px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; }
.export-logo { width: 44px; height: 44px; flex-shrink: 0; }
/* Le cartouche ne porte plus que logo + titre (la date est passée au footer,
   décision Julien) : plus de marge basse, plus de règle .export-meta. */
.export-title { font-size: 16px; font-weight: 600; margin: 0; }
.export-body { max-width: 900px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
/* Sans cartouche (Markdown sans titre h1), le corps est le premier élément de
   la page : il lui faut sa propre respiration en haut, celle que la barre de
   séparation du cartouche apporte sinon. */
.export-body:first-child { padding-top: 40px; }
.export-footer-wrap { border-top: 1px solid var(--border); }
.export-footer { max-width: 900px; margin: 0 auto; padding: 20px; font-size: 11px; color: var(--text-3); box-sizing: border-box; }
/* Le lien du dépôt se signale par la couleur d'accent, sans soulignement de
   base : dans un footer gris de 11px, l'orange tranche assez pour être lu
   comme lien. Le soulignement n'apparaît qu'au survol, pour accuser le
   ciblage. (Une variante « couleur héritée + pointillé permanent » a été
   essayée puis abandonnée : le pointillé était visuellement bruyant et son
   espacement n'est pas réglable en CSS standard.) */
.export-brand { color: var(--accent); text-decoration: none; }
.export-brand:hover { text-decoration: underline; text-underline-offset: 2px; }
.msg { display: flex; flex-direction: column; }
.msg.user { align-items: flex-end; margin: 24px 0 10px; }
.msg.user .bubble { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r); padding: 8px 13px; max-width: 80%; word-break: break-word; text-align: left; }
.msg.user .bubble .body { font-size: 13.5px; line-height: 1.6; }
/* Reponse d'agent repliee (X-1e). details natif : le repli fonctionne dans un
   export NON interactif, aucun JS requis. Meme markup qu'a l'ecran
   (agentResultBodyHtml partagee), mais feuille distincte — piege 22. */
.msg.user.agent-result { align-items: stretch; }
.msg.user.agent-result .msg-user-footer { justify-content: flex-end; }
.msg.user.agent-result .bubble { max-width: 100%; background: transparent; border: none; padding: 0; }
.agent-result-box { border: 1px solid var(--border); border-radius: var(--r); background: var(--surface); }
.agent-result-box > summary { cursor: pointer; list-style: none; display: block; }
.agent-result-box > summary::-webkit-details-marker { display: none; }
.agent-result-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; }
.agent-result-box[open] > summary .agent-result-head { border-bottom: 1px solid var(--border); }
.agent-result-box > summary:hover .agent-result-head { background: var(--surface-2); border-radius: var(--r); }
.agent-result-box[open] > summary:hover .agent-result-head { border-radius: var(--r) var(--r) 0 0; }
.agent-result-chevron { flex: 0 0 auto; opacity: .7; transition: transform .15s ease; }
.agent-result-box[open] .agent-result-chevron { transform: rotate(90deg); }
.agent-result-icon { flex: 0 0 auto; opacity: .8; }
.agent-result-intent { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-result-status { flex: 0 0 auto; color: var(--text-2); font-size: 12px; }
.msg.user.agent-result .body { padding: 10px 12px; font-size: 13.5px; line-height: 1.6; }
.msg.assistant { align-items: stretch; margin: 4px 0 14px; }
.msg.assistant .meta { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--text-3); margin-bottom: 7px; }
.msg.assistant .body { font-size: 14px; line-height: 1.68; color: var(--text); }
.msg.assistant .tool-trace + .body { margin-top: 7px; }
.msg-ts { font-size: 11px; color: var(--text-3); }
.body > *:first-child { margin-top: 0; }
.body > *:last-child { margin-bottom: 0; }
.body p { margin: 0 0 11px; }
.body h1, .body h2, .body h3 { font-weight: 600; line-height: 1.3; margin: 18px 0 8px; }
.body h1 { font-size: 18px; }
.body h2 { font-size: 16px; }
.body h3 { font-size: 14.5px; }
.body ul, .body ol { margin: 8px 0 12px; padding-left: 22px; }
.body li { margin-bottom: 4px; }
.body li::marker { color: var(--text-3); }
.body a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-bd); }
.body strong { font-weight: 600; color: var(--text); }
.body em { color: var(--text-2); }
.body del { color: var(--text-3); }
.body blockquote { border-left: 2px solid var(--border-2); padding: 2px 0 2px 14px; margin: 10px 0; color: var(--text-2); }
.body hr { border: none; border-top: 1px solid var(--border-2); margin: 18px 0; }
.body code:not([class*="language-"]) { font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; color: var(--code-inline-color); }
/* Débordement centré des grands tableaux — portage de chat.css (.table-bleed),
   PAS une propagation : EXPORT_CSS est figée, les deux jeux de règles évoluent
   séparément. Le porteur est posé par wrapWideTables, partagée avec l'écran.
   Bornes différentes ici, et c'est tout ce qui change : pas de sidebar ni de
   --col, la colonne est .export-body et la place disponible se lit directement
   sur le viewport, sans container query — donc les 40px retranchés sont bien une
   gouttière à soustraire ici, là où le 100cqw de l'écran exclut déjà son
   padding. Les 860px sont sa largeur de CONTENU
   (900 de box moins 2x20 de padding, box-sizing: border-box) : prendre 900
   décalerait tout de 20px de chaque côté et ferait déborder même un tableau qui
   tient dans la colonne. Les 40px retranchés du viewport sont la gouttière qui
   empêche le tableau de coller au bord de la fenêtre. Le scroll est porté par le
   PORTEUR et non par le tableau : un display:block sur un <table> casse la
   répartition des colonnes (cf. chat.css, étage 2). */
.table-bleed { --table-bleed: max(0px, calc(100vw - 40px - 860px)); margin: 12px calc(var(--table-bleed, 0px) / -2); width: calc(100% + var(--table-bleed, 0px)); overflow-x: auto; }
/* Réglage « Élargir les grands tableaux » (Apparence), figé à l'export : le
   fichier produit n'a pas de réglages, donc l'état du moment est gravé dans le
   markup par buildExportHtml (attribut sur body, faute de pouvoir toucher à
   html — la case de thème y est la seule source de vérité). Même gate qu'à
   l'écran, sur --table-bleed du porteur : une valeur héritée ne battrait pas la
   déclaration que .table-bleed porte sur lui-même. */
body[data-wide-tables="off"] .table-bleed { --table-bleed: 0px; }
/* Une bulle utilisateur est une boîte : un tableau n'en sort jamais, quel que
   soit le réglage ci-dessus. Portage de chat.css (.msg.user .bubble
   .table-bleed) — la chaîne flex y demande le même min-width: 0. */
.msg.user .bubble .table-bleed { --table-bleed: 0px; max-width: 100%; min-width: 0; }
.msg.user .bubble, .msg.user .bubble .body { min-width: 0; }
.msg.user .bubble .table-bleed table { width: max-content; min-width: 0; max-width: none; }
.body table { width: fit-content; min-width: calc(100% - var(--table-bleed, 0px)); max-width: 100%; margin: 0 auto; border-collapse: collapse; font-size: 13px; }
.body th, .body td { border: 1px solid var(--border); padding: 6px 11px; text-align: left; }
.body th { background: var(--surface); font-weight: 600; color: var(--text); }
.body td { color: var(--text-2); }
.body tr:nth-child(even) td { background: var(--table-stripe); }
.body pre { margin: 12px 0; border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; background: var(--code-bg) !important; }
.body pre[class*="language-"] { padding: 0; margin: 12px 0; border-radius: var(--r); background: var(--code-bg) !important; }
.code-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: var(--code-head-bg); border-bottom: 1px solid var(--border); }
.code-lang { font-family: var(--mono); font-size: 10.5px; color: var(--text-3); text-transform: lowercase; }
.code-actions { display: flex; align-items: center; gap: 2px; }
.code-copy, .code-dl { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; background: none; border: none; border-radius: 5px; color: var(--text-3); cursor: pointer; padding: 0; }
.code-copy svg, .code-dl svg { width: 13px; height: 13px; }
.code-copy:hover, .code-dl:hover { color: var(--text); background: var(--surface-2); }
.code-copy--checked { color: var(--accent) !important; }
.body pre code { display: block; padding: 13px 14px !important; font-family: var(--mono) !important; font-size: 11.5px !important; line-height: 1.6 !important; overflow-x: auto; background: transparent !important; text-shadow: none !important; }
.reasoning { margin: 0 0 8px; padding: 8px 11px; border-left: 2px solid var(--border-2); background: var(--surface-2); border-radius: 0 6px 6px 0; }
/* Contenu imbriqué DANS le <summary> (pas en frère) : tout le bloc — en-tête
   ET texte du raisonnement — est une seule zone de clic pliable, nativement,
   sans JS (cf. piège <details>/<summary>). Marqueur natif retiré. */
.reasoning summary { cursor: pointer; list-style: none; display: block; }
.reasoning summary::-webkit-details-marker { display: none; }
.reasoning summary::marker { content: ''; }
.reasoning-label { font-size: 11px; color: var(--text-3); }
.reasoning:not([open]) .reasoning-content { display: none; }
.reasoning-content { font-family: var(--sans); font-size: 12px; line-height: 1.5; color: var(--text-2); opacity: .85; white-space: pre-wrap; word-break: break-word; margin-top: 6px; }
.tool-trace { margin: 3px 0 8px 2px; font-size: 12px; color: var(--text-2); }
.tool-trace summary { cursor: pointer; list-style: none; display: block; }
.tool-trace summary::-webkit-details-marker { display: none; }
.tool-trace summary::marker { content: ''; }
.tool-trace-summary-text { display: block; color: var(--text-2); margin-bottom: 4px; }
.tool-trace ul { list-style: none; margin: 6px 0 0; padding: 4px 0 4px 10px; border-left: 2px solid var(--accent-bd); }
.tool-trace li { margin-bottom: 6px; padding-top: 6px; }
.tool-trace li:first-child { padding-top: 0; border-top: none; }
.tool-trace li + li { border-top: 1px solid var(--border); }
.tool-trace code { font-family: var(--mono); font-size: 11.5px; }
/* Code exécuté par js__eval (lot L) : bloc <pre> COMPLET dans la trace d'outil,
   seule trace du code (absent du thread live). EXPORT_CSS est une feuille figée
   qui ne suit PAS chat/tools/composer.css (piège 22) — règle dédiée ici. */
.tool-ack-code { margin: 4px 0 2px; padding: 8px 10px; background: var(--code-bg); border: 1px solid var(--border); border-radius: 5px; overflow-x: auto; white-space: pre; }
.tool-ack-code code { font-family: var(--mono); font-size: 11px; line-height: 1.5; color: var(--text-2); }
/* Trois paliers (lot N) : replié, .tool-trace ne montre QUE le compteur
   (summary externe) ; ouvert, .tool-trace-toggle apparaît sur la liste
   d'intents (état par défaut du groupe de radios) ; cliquer dessus bascule
   au détail JSON, cliquer sur le détail JSON revient aux intents — cycle
   piloté par une paire de radios masqués + labels cliquables, PAS par un
   second <details> (un <details> imbriqué ne serait pas réinitialisé par le
   DOM à la fermeture du parent, cul-de-sac sur JSON — cf. formatToolAcksHtml,
   utils.js). Zéro JS, fonctionne même en export statique. */
.tool-trace-toggle { margin-top: 4px; }
.tt-radio { position: absolute; opacity: 0; pointer-events: none; }
.tt-view { display: block; cursor: pointer; }
.tt-view-json { display: none; }
/* 2ᵉ radio (id="ttj…", label for="tti…" = clic pour REVENIR aux intents)
   coché → son frère immédiat .tt-view-intents disparaît, .tt-view-json
   (frère suivant) apparaît. Ordre DOM figé par formatToolAcksHtml : radio
   intents, radio json, label intents, label json — ne pas réordonner sans
   ajuster ce sélecteur. */
.tt-radio + .tt-radio:checked ~ .tt-view-intents { display: none; }
.tt-radio + .tt-radio:checked ~ .tt-view-json { display: block; }
.tool-ack-preview-list { display: flex; flex-direction: column; gap: 3px; }
.tool-ack-preview { display: flex; align-items: baseline; gap: 8px; padding: 4px 0 4px 10px; border-left: 2px solid var(--accent-bd); }
.tool-ack-preview .ack-icon { flex-shrink: 0; display: inline-flex; align-items: center; align-self: center; color: var(--accent); }
.tool-ack-preview .ack-label { flex: 1; overflow-wrap: break-word; }
.tool-ack-preview.ack-error .ack-icon { color: var(--err); }
.tool-ack-preview.ack-error .ack-label { color: var(--err-soft); }
.tool-trace .ack-head-error, .tool-trace .ack-head-error code { color: var(--err-soft); }
.msg-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.att-chip { display: flex; align-items: center; gap: 6px; background: var(--surface-2); border: 1px solid var(--border-2); border-radius: var(--r-sm); padding: 4px 8px; font-size: 12px; color: var(--text-2); max-width: 220px; }
.att-thumb { width: 22px; height: 22px; border-radius: 4px; object-fit: cover; flex-shrink: 0; background: var(--surface-3); }
.att-icon { width: 22px; height: 22px; border-radius: 4px; display: grid; place-items: center; background: var(--surface-3); color: var(--text-3); flex-shrink: 0; }
.att-icon svg { width: 13px; height: 13px; }
.att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; color: var(--text); }
.att-size { color: var(--text-3); flex-shrink: 0; font-family: var(--mono); font-size: 10.5px; }
/* Images modèle embarquées (lot Gbis) : parité reload — resource_presented /
   resource_stored non-inline / attachment_recalled images. Inspiré de
   .tool-block/.tool-block-img de tools.css (bordure, rayon, max-width) sans le
   copier (piège 22). Pas de cursor:pointer ici : en export statique l'image
   n'est pas cliquable (décision A.4) ; EXPORT_SCRIPT posera le lien + curseur
   en mode interactif (lot Gb2). */
.tool-block { margin: 6px 0; max-width: 100%; }
.tool-block-img { max-width: 100%; height: auto; display: block; border: 1px solid var(--border); border-radius: var(--r-sm); }
/* Diagrammes Mermaid embarqués (lot E4). Né synchronisé avec .mermaid-view de
   chat.css (padding, fond, centrage svg) — dérive ensuite comme le reste de
   cette feuille (piège 22). Pas de display:none/toggle ici : dans l'export le
   SVG est TOUJOURS visible, la source vit repliée dans .mermaid-src. */
.mermaid-view { margin: 12px 0; padding: 14px; background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--r); overflow-x: auto; }
.mermaid-view svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.mermaid-src { margin: -6px 0 12px; }
.mermaid-src summary { cursor: pointer; list-style: none; font-size: 11px; color: var(--text-3); padding: 2px 0; }
.mermaid-src summary::-webkit-details-marker { display: none; }
.mermaid-src summary::marker { content: ''; }
.mermaid-src summary:hover { color: var(--text); }
.mermaid-src[open] summary { margin-bottom: 2px; }
/* Document Markdown converti (lot R) : réutilise la classe .body pour toute la
   typographie, n'ajoute que ce qui lui est propre. Les h1 restants dans le
   corps (le premier est consommé par le cartouche, cf. extractMdTitle) sont
   remontés en taille : dans un document autonome ils structurent la lecture,
   là où dans une bulle de chat ils restaient discrets.
   ATTENTION : EXPORT_CSS est un template literal — jamais de backtick dans
   ces commentaires, il clôt la chaîne et casse le chargement du fichier. */
.md-doc { font-size: 14px; line-height: 1.68; color: var(--text); }
.md-doc h1 { font-size: 21px; margin: 24px 0 10px; }
.md-doc h2 { font-size: 17px; margin: 22px 0 9px; }
.md-doc > *:first-child { margin-top: 0; }
/* Bascule de thème (export interactif uniquement) : le bouton est créé par
   EXPORT_SCRIPT, ces règles restent inertes en export statique. Fixe en coin
   bas-droite, discret au repos, révélé au survol — l'export est un document de
   lecture, pas une app. */
/* Bascule de thème SANS JavaScript (lot R révisé) : case masquée + label.
   La case doit rester focusable au clavier — d'où opacity/position plutôt que
   display:none, qui la sortirait de l'ordre de tabulation. */
#theme-switch { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
/* Le label est en tête de body (contrainte du sélecteur :has / frère) mais doit
   s'afficher dans le cartouche : on le cale en fixed sur la même ligne que la
   topbar. Sans cartouche il occupe la même place, en haut à droite du document
   — dans les deux cas il reste accessible au scroll. */
/* Aligné sur la COLONNE de lecture (900px centrés), pas sur le bord du
   viewport : sur grand écran, un right:16px le laissait flotter à ~270px du
   cartouche, visuellement désolidarisé. left:50% + une demi-colonne le cale au
   bord droit de la colonne ; min() le ramène au bord de l'écran quand le
   viewport est plus étroit que la colonne (mobile).
   Pas de backtick ici : EXPORT_CSS est un template literal (piège 22). */
.theme-switch-label { position: fixed; top: 16px; left: min(100vw - 50px, 50% + 450px); z-index: 10; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--border-2); border-radius: 50%; background: var(--surface-2); color: var(--text-3); cursor: pointer; opacity: 0.55; transition: opacity var(--ease), color var(--ease), border-color var(--ease); }
.theme-switch-label:hover { opacity: 1; color: var(--text); border-color: var(--accent-bd); }
#theme-switch:focus-visible + .theme-switch-label { opacity: 1; color: var(--text); border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
.theme-switch-label svg { width: 17px; height: 17px; }
/* Une seule icône visible : elle montre la DESTINATION. Décochée = sombre →
   soleil ; cochée = clair → lune. */
.theme-switch-label .ts-moon { display: none; }
#theme-switch:checked + .theme-switch-label .ts-sun { display: none; }
#theme-switch:checked + .theme-switch-label .ts-moon { display: block; }
/* Sur écran tactile il n'y a PAS de survol : le bouton resterait indéfiniment à
   demi-effacé et passe pour absent (retour Julien après test sur mobile). On le
   rend pleinement visible d'emblée, et un peu plus grand pour la cible tactile
   (34px est en dessous des 44px recommandés au doigt). */
@media (pointer: coarse) {
  .theme-switch-label { opacity: 1; color: var(--text-2); width: 40px; height: 40px; }
  .theme-switch-label svg { width: 19px; height: 19px; }
  /* Bouton plus gros → réserve plus large dans le cartouche. */
  .export-topbar { padding-right: 72px; }
}
@media print { .theme-switch-label { display: none; } }
`;

// Script inline OPTIONNEL de l'export (progressive enhancement, zéro-JS révisé —
// brief G). Injecté seulement si settings.exportInteractive (défaut true) via
// scriptTag ; absent, l'export reste strictement statique. Autonome : l'export
// n'a AUCUN global MIAOU (downloadFile, sanitizeDownloadName, LANG_TO_EXT
// n'existent pas), tout est réimplémenté ici en minimal. Révèle sur chaque
// <pre> deux boutons (copier via navigator.clipboard, télécharger via Blob) à
// côté du .code-lang déjà présent statiquement. La barre de langage, elle,
// existe sans JS (decorateExportPre) : ce script n'ajoute QUE les actions.
const EXPORT_SCRIPT = `
(function () {
  var EXT = { python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts', jsx:'jsx', tsx:'tsx', bash:'sh', sh:'sh', shell:'sh', zsh:'sh', json:'json', html:'html', css:'css', sql:'sql', yaml:'yml', yml:'yml', markdown:'md', md:'md' };
  var svgCopy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var svgCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var svgDl = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  function dlName(raw, lang) {
    var n = String(raw || '').replace(/[\\/\\\\]/g, '_').replace(/[\\x00-\\x1f\\x7f]/g, '').replace(/^\\.+/, '').trim();
    if (n && !/\\.[^.\\/\\\\]+$/.test(n)) n += '.' + (EXT[(lang || '').toLowerCase()] || 'txt');
    return n || ('miaou-snippet.' + (EXT[(lang || '').toLowerCase()] || 'txt'));
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    (function (pre) {
      var head = pre.querySelector('.code-head');
      if (!head || head.querySelector('.code-actions')) return;
      var code = pre.querySelector('code');
      var langSpan = head.querySelector('.code-lang');
      var lang = langSpan ? langSpan.textContent : 'text';
      var actions = document.createElement('div');
      actions.className = 'code-actions';
      var copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy'; copyBtn.title = 'Copier'; copyBtn.innerHTML = svgCopy;
      var dlBtn = document.createElement('button');
      dlBtn.className = 'code-dl'; dlBtn.title = 'Télécharger'; dlBtn.innerHTML = svgDl;
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(code ? code.textContent : '').then(function () {
          copyBtn.innerHTML = svgCheck; copyBtn.classList.add('code-copy--checked');
          setTimeout(function () { copyBtn.innerHTML = svgCopy; copyBtn.classList.remove('code-copy--checked'); }, 1400);
        });
      };
      dlBtn.onclick = function () {
        var raw = code ? code.getAttribute('data-filename') : '';
        download(dlName(raw, lang), code ? code.textContent : '');
      };
      actions.appendChild(copyBtn); actions.appendChild(dlBtn);
      head.appendChild(actions);
    })(pres[i]);
  }
  // Images cliquables (lot Gb2) : nouvel onglet. La navigation top-level vers un
  // data: est bloquée par les navigateurs → on convertit le data URL en Blob et
  // on window.open l'URL d'objet. AUCUNE donnée modèle/outil interpolée ici
  // (piège 21) : les data URL sont LUS depuis le DOM (img.src déjà posé par
  // renderExportBody), jamais injectés dans ce script. Cibles : images modèle
  // (.tool-block-img) et vignettes de chips user image (.att-chip > img.att-thumb,
  // clic sur le chip ENTIER). Échec de conversion → rien (pas de fallback data:
  // top-level, interdit) ; en export STATIQUE (ce script absent) les images
  // restent visibles mais non cliquables (décision A.4).
  function dataUrlToBlob(u) {
    var comma = u.indexOf(',');
    if (comma < 0 || u.slice(0, 5) !== 'data:') return null;
    var meta = u.slice(5, comma);
    var mime = meta.split(';')[0] || 'application/octet-stream';
    var isB64 = /;base64/i.test(meta);
    var body = u.slice(comma + 1);
    try {
      if (isB64) {
        var bin = atob(body);
        var bytes = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        return new Blob([bytes], { type: mime });
      }
      return new Blob([decodeURIComponent(body)], { type: mime });
    } catch (e) { return null; }
  }
  function openImage(dataUrl) {
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) return;
    var url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }
  function bindImageOpen(el, dataUrl) {
    if (!dataUrl || dataUrl.slice(0, 5) !== 'data:') return;
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', function () { openImage(dataUrl); });
  }
  var modelImgs = document.querySelectorAll('img.tool-block-img');
  for (var mi = 0; mi < modelImgs.length; mi++) bindImageOpen(modelImgs[mi], modelImgs[mi].src);
  var chips = document.querySelectorAll('.att-chip');
  for (var ci = 0; ci < chips.length; ci++) {
    var thumb = chips[ci].querySelector('img.att-thumb');
    if (thumb) bindImageOpen(chips[ci], thumb.src);
  }
  // Bascule de thème : les DEUX jeux de tokens sont embarqués par
  // serializeThemeTokens (:root sombre + html[data-theme="light"]), il suffit
  // donc de basculer l'attribut. LIMITE CONNUE : les SVG Mermaid embarqués
  // (embedExportMermaid) portent un <style> interne aux couleurs RÉSOLUES à
  // l'export — ils ne suivent pas la bascule et gardent leur thème d'origine.
  // Les recolorer imposerait d'embarquer Mermaid dans l'export (hors sujet) ;
  // limite assumée, cf. docs/exports.md.
  //
  // Le bouton est du HTML STATIQUE (case + label, cf. buildExportHtml) et la
  // bascule fonctionne SANS ce script — c'est le point du lot R révisé (les
  // visionneuses type Quick Look iOS n'exécutent aucun script). Ce bloc n'ajoute
  // que ce qui exige du JS : la PERSISTANCE du choix d'un chargement à l'autre.
  // Il ne pose AUCUN attribut de thème : la case est seule source de vérité,
  // tokens et couleurs Prism sont gouvernés par le sélecteur :has() sur elle.
  // (Pas de backtick dans ce commentaire : EXPORT_SCRIPT est un template
  // literal, piège 22.)
  // UNE seule clef pour TOUS les exports (pas de suffixe de chemin) : le choix
  // clair/sombre est une préférence de lecture, pas un attribut du document —
  // la refaire à chaque nouvel export n'a pas de sens, et une entrée par fichier
  // encrassait le localStorage sans rien apporter.
  var THEME_KEY = 'miaou-export-theme';
  var sw = document.getElementById('theme-switch');
  if (sw) {
    try {
      var saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') sw.checked = (saved === 'light');
    } catch (e) {}
    sw.addEventListener('change', function () {
      try { localStorage.setItem(THEME_KEY, sw.checked ? 'light' : 'dark'); } catch (e) {}
    });
  }
})();
`;

// Assemblage PUR du squelette HTML (testable QuickJS) : le styleCss est
// composé par l'appelant (tokens runtime non purs), buildExportHtml se
// contente de l'insérer. scriptTag est composé par l'appelant (vide si
// settings.exportInteractive est false → export strictement statique, ou
// <script>EXPORT_SCRIPT</script> sinon — progressive enhancement, zéro-JS révisé
// brief G). Zéro <link> (Prism inliné, pas de CDN).
// Icônes de la bascule de thème des exports. Les DEUX sont dans le markup ;
// le CSS n'en montre qu'une selon l'état de la case (soleil quand on est en
// sombre, lune quand on est en clair — l'icône montre la DESTINATION). Ce sont
// les mêmes tracés que ceux qu'utilisait EXPORT_SCRIPT avant qu'on passe au
// markup statique, gardés identiques pour ne pas dévier du vocabulaire d'icônes.
const THEME_SWITCH_SUN_SVG = '<svg class="ts-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const THEME_SWITCH_MOON_SVG = '<svg class="ts-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

// `title` null/vide → AUCUN cartouche d'en-tête (Markdown converti sans titre
// de niveau 1, lot R) : ni logo, ni titre, ni date. Le footer, lui, est
// systématique.
//
// `verb` distingue les deux producteurs de documents : l'export de
// conversation dit « Exporté le … » / « Généré par MIAOU », le convertisseur
// Markdown dit « Converti le … » / « Converti par MIAOU ». Un seul paramètre
// pilote les deux endroits pour qu'ils ne puissent pas diverger.
// `footer` est SCINDÉ (préfixe + nom) parce que seul le mot « MIAOU » porte le
// lien vers le dépôt : une chaîne d'un bloc obligerait à la redécouper au rendu.
const EXPORT_VERBS = {
  export:  { meta: 'Exporté',  footerPrefix: 'Généré par ' },
  convert: { meta: 'Converti', footerPrefix: 'Converti par ' },
};

// Le mot « MIAOU » du footer d'export : lien vers le dépôt si BUILD_REPO_URL
// est non vide (défaut : dépôt public — cf. storage.js), simple texte sinon.
// `escHtml` sur l'URL bien qu'elle soit d'origine BUILD et jamais modèle : le
// chemin string→HTML de l'export ne souffre pas d'exception gratuite (piège 21).
// Partie PURE (testable) : la décision lien/texte à partir d'une URL déjà
// résolue. `exportBrandHtml` n'est que le point de lecture de la constante de
// build, qui, elle, est figée au chargement et donc intestable telle quelle.
function brandHtmlFor(url) {
  if (typeof url !== 'string' || !url) return 'MIAOU';
  return '<a class="export-brand" href="' + escHtml(url) +
    '" target="_blank" rel="noopener">MIAOU</a>';
}
function exportBrandHtml() { return brandHtmlFor(BUILD_REPO_URL); }
// `wideTables` fige l'état du réglage « Élargir les grands tableaux » au moment
// de l'export : le fichier produit n'a pas de réglages, et le débordement des
// tableaux est une décision de présentation qui doit le suivre. Porté par
// <body> et non <html>, dont l'absence d'attribut est un contrat (cf. plus bas,
// la case de thème est la seule source de vérité). Absent/undefined → élargi,
// c'est le défaut du réglage, et ça garde les appelants de test inchangés.
function buildExportHtml({ title, dateDisplay, theme, styleCss, bodyHtml, scriptTag, kind, wideTables }) {
  const hasHeader = !!(title && String(title).trim());
  const docTitle = hasHeader ? title : 'Document';
  const verbs = EXPORT_VERBS[kind] || EXPORT_VERBS.export;
  const verb = verbs.meta;
  const ogDesc = hasHeader
    ? title + ' — ' + verb.toLowerCase() + ' depuis MIAOU le ' + dateDisplay
    : 'Document ' + verb.toLowerCase() + ' depuis MIAOU le ' + dateDisplay;
  // PAS de data-theme sur <html> : dans l'export, la CASE (#theme-switch) est la
  // seule source de vérité du thème. Un attribut figé ici gagnerait sur elle en
  // permanence — sans JS pour le mettre à jour, le clic changeait l'icône mais
  // pas les couleurs (bug constaté au lot R). Le thème d'ouverture est porté par
  // l'état initial de la case, plus bas.
  return '<!doctype html>\n' +
    '<html>\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    // Sans viewport, un mobile rend la page à ~980px puis la réduit : le texte
    // paraît minuscule ET les media queries mobiles ne se déclenchent jamais
    // (lot R — l'export n'en avait aucun jusque-là).
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + escHtml(docTitle) + '</title>\n' +
    // Favicon : même logo que la sidebar (LOGO_SRC, source unique, main.js) —
    // statique, indépendant du réglage exportInteractive/EXPORT_SCRIPT.
    '<link rel="icon" href="' + escHtml(LOGO_SRC) + '">\n' +
    // Métadonnées Open Graph : pilotent la preview de lien dans Teams/Slack/
    // Discord (sinon ils pêchent au hasard un texte de la page — typiquement
    // le footer « Généré par MIAOU »). L'image (logo data-URI) est
    // généralement ignorée par ces crawlers qui exigent une URL fetchable, mais
    // coût nul. Titre + description restent, eux, honorés même sur pièce jointe.
    '<meta name="description" content="' + escHtml(ogDesc) + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:site_name" content="MIAOU">\n' +
    '<meta property="og:title" content="' + escHtml(docTitle) + '">\n' +
    '<meta property="og:description" content="' + escHtml(ogDesc) + '">\n' +
    '<meta property="og:image" content="' + escHtml(LOGO_SRC) + '">\n' +
    '<style>' + styleCss + '</style>\n' +
    '</head>\n' +
    '<body' + (wideTables === false ? ' data-wide-tables="off"' : '') + '>\n' +
    // Bascule de thème SANS JavaScript (lot R, révisé) : une case masquée en
    // tête de body + un <label for> cliquable. Le CSS bascule via
    // `body:has(#theme-switch:checked)`. Fonctionne dans les visionneuses qui
    // n'exécutent pas de script (Quick Look iOS) — c'est tout l'intérêt.
    // Cochée = thème CLAIR, d'où l'état initial dérivé du thème d'export.
    // EXPORT_SCRIPT, quand il tourne, garde case et attribut synchronisés et
    // ajoute la persistance ; sans lui, la bascule marche quand même.
    '<input type="checkbox" id="theme-switch"' + (theme === 'light' ? ' checked' : '') + '>\n' +
    '<label class="theme-switch-label" for="theme-switch" title="Changer de thème" role="button" aria-label="Changer de thème">' +
    THEME_SWITCH_SUN_SVG + THEME_SWITCH_MOON_SVG +
    '</label>\n' +
    (hasHeader
      ? '<div class="export-topbar-wrap">' +
        '<div class="export-topbar">' +
        '<img class="export-logo" src="' + LOGO_SRC + '" alt="">' +
        '<p class="export-title">' + escHtml(title) + '</p>' +
        '</div>\n' +
        '</div>\n'
      : '') +
    '<div class="export-body">' + bodyHtml + '</div>\n' +
    // Footer systématique, et SEUL porteur de la date (décision Julien) : le
    // cartouche ne garde que logo + titre. Un seul endroit, quel que soit le
    // type de document et qu'il y ait un cartouche ou non.
    '<div class="export-footer-wrap"><div class="export-footer">' +
    escHtml(verbs.footerPrefix) + exportBrandHtml() +
    ' le ' + escHtml(dateDisplay) +
    '</div></div>\n' +
    (scriptTag || '') +
    '</body>\n' +
    '</html>\n';
}

// Construit le corps HTML de l'export dans un fragment DÉTACHÉ (jamais de
// lecture/mutation de #thread live). Même motif de buffer d'acks que
// downloadConvMd/renderThread : seuls les acks enrichis précédant un message
// assistant sont émis (ceux devant un user sont silencieusement omis, comme
// dans downloadConvMd — pas un blocage, un choix déjà assumé côté export MD).
// Async depuis le lot E4 : la passe Mermaid (embedExportMermaid) attend le
// chargement CDN et les rendus — le reste de la construction est synchrone.
async function renderExportBody(thread, convId) {
  const container = document.createElement('div');
  let pendingAcks = [];
  for (const m of thread) {
    if (isAckRole(m.role)) {
      // Empiler TOUS les acks (comme renderThread live) : le filtre `args != null`
      // ne s'applique qu'à la TRACE textuelle (formatToolAcksHtml, ci-dessous), PAS
      // au rendu d'IMAGE. Un ack image secondaire — ex. `resource_stored` créé par
      // internResourcesFromResult en sous-produit d'un fetch_url — n'est jamais
      // enrichi (onEnrichLastAck vise le fetch_url, pas lui) donc n'a pas d'`args` ;
      // le filtrer ici masquait son image dans l'export alors qu'elle est en cache
      // et s'affiche en live (bug Gbis : image trouvée par le modèle absente de
      // l'export). Idem pour les acks legacy antérieurs à l'enrichissement cross-turn.
      pendingAcks.push(m);
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const msgEl = document.createElement('div');
    msgEl.className = 'msg ' + m.role;
    if (m.role === 'user') {
      const shown = m.displayText != null ? m.displayText : m.content;
      const attHtml = (m.attachments && m.attachments.length)
        ? '<div class="msg-attachments">' + m.attachments.map(att =>
            attChipHtml(att, resolveAttachmentThumb(att, convId), false, null)).join('') + '</div>'
        : '';
      const tsHtml = m.ts ? '<div class="msg-ts">' + escHtml(formatMessageTime(m.ts, Date.now())) + '</div>' : '';
      // Réponse d'agent (X-1e) : même repli qu'à l'écran, et il fonctionne dans
      // l'export SANS JS — <details> est natif, l'export interactif n'est pas
      // requis. Le HTML est produit par la MÊME fonction que le live
      // (agentResultBodyHtml) : deux formules donneraient deux structures, donc
      // deux CSS à maintenir en parallèle, et c'est exactement la dérive que le
      // piège 22 décrit (EXPORT_CSS ne suit pas chat.css — raison de plus pour
      // que le MARKUP, lui, soit partagé). Son escHtml sur intent/statut est
      // impératif ici : ces chaînes sont d'origine MODÈLE (piège 21).
      const bodyHtml = m.agentResult
        ? agentResultBodyHtml(shown || '', m.agentResult)
        : '<div class="body">' + renderUserMd(shown || '') + '</div>';
      if (m.agentResult) msgEl.className += ' agent-result';
      msgEl.innerHTML = '<div class="bubble">' + attHtml + bodyHtml + '</div>' + tsHtml;
      pendingAcks = [];
    } else {
      // Trace textuelle : seuls les acks enrichis (`args != null`) — les acks
      // legacy/secondaires sans args restent omis de la trace (statu quo), mais
      // leur IMAGE est rendue par la boucle ci-dessous (pendingAcks entier).
      const traceAcks = pendingAcks.filter(a => a.args != null);
      const acksHtml = traceAcks.length ? formatToolAcksHtml(traceAcks) : '';
      // Images modèle (lot Gbis) : parité reload. On ré-émet, APRÈS le bloc
      // d'acks et AVANT le corps (miroir du DOM live, placeToolAck), les images
      // persistées en IDB portées par les acks du groupe. Sélection PURE
      // (exportableAckImageKey), lookup cache ICI seulement — record absent
      // (fenêtre de course théorique, cf. AUDIT-Gbis §3) → rien, pas d'await IDB.
      const ackImgHtml = pendingAcks.map(ack => {
        const key = exportableAckImageKey(ack);
        if (!key) return '';
        const record = key.by === 'attId'
          ? (typeof getCachedRecordByAttId === 'function' ? getCachedRecordByAttId(ack.attId, ack.convId) : null)
          : (typeof getCachedRecord === 'function' ? getCachedRecord(ack.id) : null);
        if (!record || !record.data || !record.mime || !record.mime.startsWith('image/')) return '';
        // resource_stored inline : stocké mais non affiché auto (comme en live).
        if (ackKindOf(ack) === 'resource_stored' && record.class === 'inline') return '';
        const dataUrl = 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data);
        return '<div class="tool-block"><img class="tool-block-img" src="' +
          escHtml(dataUrl) + '" alt="' + escHtml(record.name || '') + '"></div>';
      }).join('');
      pendingAcks = [];
      const tsText = m.ts ? formatMessageTime(m.ts, Date.now()) : '';
      const metaHtml = '<div class="meta"><span>' + escHtml(m.model || modelName()) + '</span>' +
        (tsText ? '<span>· ' + escHtml(tsText) + '</span>' : '') + '</div>';
      const reasoningHtml = (m.reasoning && String(m.reasoning).trim())
        ? '<details class="reasoning"><summary><span class="reasoning-label">Raisonnement</span><div class="reasoning-content">' + escHtml(String(m.reasoning)) + '</div></summary></details>'
        : '';
      msgEl.innerHTML = metaHtml + reasoningHtml + acksHtml + ackImgHtml + '<div class="body">' + renderMd(m.content || '', { asPlainText: true }) + '</div>';
    }
    container.appendChild(msgEl);
  }
  if (highlightEnabled && window.Prism) Prism.highlightAllUnder(container);
  decorateExportPre(container);
  // Même porteur qu'à l'écran, posé par la MÊME fonction : le débordement
  // centré des grands tableaux est une décision de présentation qui vaut aussi
  // pour un export lu sur grand écran. Seules les bornes changent (EXPORT_CSS
  // les calcule sur .export-body et le viewport, faute de sidebar et de --col).
  wrapWideTables(container);
  await embedExportMermaid(container);
  return container.innerHTML;
}

// Passe Mermaid de l'export (lot E4) : chaque bloc ```mermaid du fragment
// devient un SVG embarqué STATIQUEMENT (visible sans JS dans le fichier
// exporté), la source surlignée restant disponible repliée dans un
// <details class="mermaid-src"> — le <pre> y déménage intact (code-head
// compris : EXPORT_SCRIPT y greffera copier/télécharger si l'export est
// interactif). Le SVG conserve son id : le <style> interne de Mermaid scope
// chaque règle par #<id> (même raison que la lightbox, lot E3) ; ids uniques
// par rendu, pas de collision entre diagrammes du même export.
// view.innerHTML = markup produit par Mermaid strict, pas de re-sanitisation
// — même posture que renderMermaidUnder (cf. en-tête de la section Mermaid).
// Double fallback, zéro régression vs lot G : Mermaid non chargeable
// (offline) → passe entière ignorée, toutes les sources surlignées restent ;
// erreur de parse d'un bloc → CE bloc reste source surlignée, les autres
// sont rendus. Pas de barre d'actions ni de toggle dans l'export (boutons
// perdus à la sérialisation innerHTML, et aucun global MIAOU côté fichier).
async function embedExportMermaid(container) {
  const codes = container.querySelectorAll('code.language-mermaid');
  if (!codes.length) return;
  let mm;
  try { mm = await ensureMermaid(); }
  catch (e) { return; }
  for (const code of codes) {
    const pre = code.closest('pre');
    if (!pre) continue;
    const uid = 'xmmd' + (++_mermaidUid) + Math.random().toString(36).slice(2, 8);
    let svg;
    try {
      svg = (await mm.render(uid, sanitizeMermaidSource(code.textContent))).svg;   // même strip que l'écran (renderMermaidUnder)
    } catch (e) {
      // Même hygiène que renderMermaidUnder : Mermaid v11 peut laisser un
      // nœud d'erreur orphelin dans document.body.
      ['d' + uid, uid].forEach(id => {
        const orphan = document.getElementById(id);
        if (orphan) orphan.remove();
      });
      continue;
    }
    const view = document.createElement('div');
    view.className = 'mermaid-view';
    view.innerHTML = svg;
    const details = document.createElement('details');
    details.className = 'mermaid-src';
    const summary = document.createElement('summary');
    summary.textContent = 'Source mermaid';
    details.appendChild(summary);
    pre.before(view);
    view.after(details);
    details.appendChild(pre);
  }
}

// Insère l'en-tête STATIQUE (langage seul) sur chaque <pre> de l'export. Ne pas
// confondre avec decoratePre (live) : ici pas de boutons ni de onclick — ils
// seraient perdus par la sérialisation innerHTML, et l'export n'a pas les
// globals (navigator.clipboard wrapper, downloadFile). Les boutons copier/
// télécharger sont ajoutés au runtime dans le fichier exporté par EXPORT_SCRIPT
// (progressive enhancement : présents seulement si JS actif). Le libellé de
// langage, lui, est du HTML pur → visible même sans JS.
function decorateExportPre(scope) {
  scope.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-head')) return;
    const code = pre.querySelector('code');
    let lang = 'text';
    if (code) {
      const m = (code.className || '').match(/language-([\w-]+)/);
      if (m) lang = m[1];
    }
    const head = document.createElement('div');
    head.className = 'code-head';
    head.innerHTML = '<span class="code-lang">' + escHtml(lang) + '</span>';
    pre.insertBefore(head, pre.firstChild);
  });
}

// ── Conversion Markdown → HTML (lot R) ───────────────────────────────────────
// Convertit un .md quelconque (fichier de l'utilisateur, PAS du contenu modèle)
// en document HTML autonome au format des exports de conversation.
//
// TROISIÈME chemin string→HTML (piège 21), assumé et documenté : ni renderMd
// (qui applique resolveConvRefs — des références de conversation n'ont aucun
// sens dans un .md externe, et transformeraient un `#123` en lien mort), ni
// renderUserMd (qui échappe les `<`, alors qu'un .md peut légitimement porter
// du HTML inline). On passe donc marked directement, MAIS la sortie traverse
// sanitizeHtml/DOMPurify comme les deux autres : c'est ce qui rend ce chemin
// sûr, et toute évolution ici doit conserver cette passe.
//
// `breaks: FALSE` ici, contrairement à renderMd/renderUserMd (écran). Ces deux-là
// rendent des messages de CHAT, tapés au fil de l'eau, où « une ligne = une
// ligne » est le bon comportement. Un fichier .md est un DOCUMENT : il est
// presque toujours enroulé à ~80 colonnes, et ces retours ne sont pas
// sémantiques — les rendre en <br> reproduit la largeur du fichier source au
// lieu de laisser le texte se réenrouler (retour Julien). Comportement
// CommonMark standard : un retour simple est un espace, une ligne vide sépare
// deux paragraphes, deux espaces en fin de ligne forcent un <br>.
// Colorise les blocs de code d'un fragment DÉTACHÉ, grammaires comprises.
//
// Piège vérifié au spike : passer un callback à Prism.highlightElement NE SUFFIT
// PAS. L'autoloader demande bien la grammaire manquante (requête observée, 200),
// mais le callback est rappelé APRÈS que le bloc a déjà été rendu sans elle —
// résultat : requête réussie, `Prism.languages.python` absent, zéro token. Il
// faut donc PRÉCHARGER les grammaires, puis coloriser.
//
// Ce cas ne se pose pas dans l'export de conversation : ses blocs ont déjà été
// coloriés à l'écran, grammaires chargées de longue date.
const MD_HIGHLIGHT_TIMEOUT_MS = 5000;
// Charge un composant de grammaire par <script>, une seule fois par langage.
// Échec (CDN injoignable, langage inexistant) → résolution quand même : le bloc
// sortira non colorié, la conversion n'échoue jamais pour ça.
const _prismGrammarLoads = {};
function loadPrismGrammar(lang) {
  if (!lang || !window.Prism) return Promise.resolve();
  if (Prism.languages[lang]) return Promise.resolve();
  const base = (Prism.plugins && Prism.plugins.autoloader && Prism.plugins.autoloader.languages_path) || '';
  if (!base) return Promise.resolve();
  if (_prismGrammarLoads[lang]) return _prismGrammarLoads[lang];
  _prismGrammarLoads[lang] = new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, MD_HIGHLIGHT_TIMEOUT_MS);
    const s = document.createElement('script');
    s.src = base + 'prism-' + lang + '.min.js';
    s.onload = () => { clearTimeout(timer); finish(); };
    s.onerror = () => { clearTimeout(timer); finish(); };
    document.head.appendChild(s);
  }).then(() => {
    // Hygiène de cache async : un échec ne doit pas empoisonner la session —
    // si la grammaire n'est pas arrivée, la prochaine conversion retentera.
    if (!Prism.languages[lang]) delete _prismGrammarLoads[lang];
  });
  return _prismGrammarLoads[lang];
}
async function highlightMarkdownDocCode(container) {
  if (!highlightEnabled || !window.Prism || !Prism.highlightElement) return;
  const blocks = Array.from(container.querySelectorAll('code[class*="language-"]'));
  if (!blocks.length) return;
  const langOf = el => {
    const m = (el.className || '').match(/language-([\w-]+)/);
    return m ? m[1] : '';
  };
  // Précharge les grammaires manquantes (dédupliquées) AVANT de coloriser.
  const langs = Array.from(new Set(blocks.map(langOf).filter(Boolean)));
  await Promise.all(langs.map(loadPrismGrammar));
  // Colorisation synchrone : les grammaires disponibles le sont maintenant,
  // celles qui ont échoué laisseront simplement leur bloc non colorié.
  for (const el of blocks) {
    try { Prism.highlightElement(el, false); } catch (e) { /* bloc laissé brut */ }
  }
}

async function renderMarkdownDocBody(md) {
  const container = document.createElement('div');
  // Classe `.body` RÉUTILISÉE telle quelle : toutes les règles typographiques
  // d'EXPORT_CSS (titres, listes, tableaux, blockquote, code) y sont attachées
  // sans dépendre de `.msg.assistant`. Inventer une seconde classe la
  // dupliquerait et la ferait dériver (piège 22). `.md-doc` ne porte que le peu
  // qui est propre au document converti (taille de base, titre de niveau 1).
  container.className = 'body md-doc';
  // Le fallback (marked absent, CDN injoignable) suit la MÊME convention que le
  // chemin nominal : ligne vide = nouveau paragraphe, retour simple = espace.
  // Sinon le rendu diverge selon que le CDN a répondu ou non.
  container.innerHTML = window.marked
    ? sanitizeHtml(marked.parse(String(md || ''), { breaks: false }))
    : plainTextToParagraphs(String(md || ''));
  // Mêmes passes que renderExportBody, dans le même ordre : coloration, puis
  // en-têtes de blocs de code, puis Mermaid (qui déménage les <pre> concernés).
  // MAIS coloration ATTENDUE ici (highlightMarkdownDocCode), pas le
  // highlightAllUnder synchrone de renderExportBody : les blocs d'un .md sont
  // NEUFS, leur grammaire n'a jamais été chargée, et l'autoloader Prism la
  // récupère en asynchrone — lire outerHTML juste après rendait un code non
  // colorié (bloc correct, zéro token). Dans l'export de conversation le
  // problème ne se pose pas : les mêmes blocs ont déjà été coloriés à l'écran.
  await highlightMarkdownDocCode(container);
  decorateExportPre(container);
  await embedExportMermaid(container);
  return container.outerHTML;
}

// Point d'entrée de la conversion : prend le TEXTE d'un .md et son nom de
// fichier, produit le HTML complet et le télécharge. Séparé du handler d'UI
// pour rester appelable depuis un verify sans passer par un vrai <input file>.
async function convertMarkdownToHtmlFile(mdText, sourceName) {
  const { title, body } = extractMdTitle(mdText);
  const now = Date.now();
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const styleCss = serializeThemeTokens() + EXPORT_CSS + prismThemeCssForExport();
  const bodyHtml = await renderMarkdownDocBody(body);
  const s = loadSettings();
  const scriptTag = (s.exportInteractive !== false)
    ? '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>\n'
    : '';
  const html = buildExportHtml({
    title,                       // null → aucun cartouche (spec)
    dateDisplay: exportDateDisplay(now),
    kind: 'convert',
    theme, styleCss, bodyHtml, scriptTag,
    wideTables: s.wideTables !== false,
  });
  downloadFile(mdHtmlFileName(sourceName), html, 'text/html');
  return html;
}

// ── Conversion Markdown : câblage UI (réglages » Outils & extensions) ────────
// Handlers globaux référencés en attributs inline dans index.html (cf. CLAUDE.md) :
// onMdConvertPick / onMdConvertInput / onMdConvertDragOver / onMdConvertDragLeave /
// onMdConvertDrop. Renommer ici sans mettre à jour index.html casse en silence.
// Réutilise isMarkdownFile (drawer skills) : même filtre, pas de second prédicat.
function setMdConvertStatus(msg, isError) {
  const el = $('md-convert-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('md-convert-status--error', !!isError);
}
// Verrou de réentrance : la conversion est async (passe Mermaid + CDN), un
// second dépôt pendant ce temps produirait deux téléchargements concurrents.
// Même motif que _exportingHtml.
let _convertingMd = false;
async function runMdConversion(file) {
  if (!file || _convertingMd) return;
  _convertingMd = true;
  try {
    setMdConvertStatus('Conversion de « ' + file.name +' »…', false);
    const text = await file.text();
    await convertMarkdownToHtmlFile(text, file.name);
    setMdConvertStatus('Converti : ' + mdHtmlFileName(file.name), false);
  } catch (e) {
    setMdConvertStatus('Échec de la conversion : ' + (e && e.message ? e.message : 'erreur inconnue'), true);
  } finally {
    _convertingMd = false;
  }
}
function onMdConvertPick() {
  const input = $('md-convert-input');
  if (input) input.click();
}
function onMdConvertInput(e) {
  const input = e && e.target;
  const file = input && input.files && input.files[0];
  // Réinitialise la valeur : sans ça, re-choisir LE MÊME fichier ne relance
  // aucun change (valeur inchangée) — piège classique de <input type=file>.
  if (input) input.value = '';
  if (file) runMdConversion(file);
}
function onMdConvertDragOver(e) {
  e.preventDefault();
  const dz = $('md-convert-zone');
  if (dz) dz.classList.add('dragover');
}
function onMdConvertDragLeave(e) {
  const dz = $('md-convert-zone');
  if (dz && (!e.relatedTarget || !dz.contains(e.relatedTarget))) dz.classList.remove('dragover');
}
function onMdConvertDrop(e) {
  e.preventDefault();
  const dz = $('md-convert-zone');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  const file = Array.from(files).find(isMarkdownFile);
  // Ici, contrairement au drawer skills, un mauvais fichier mérite un retour :
  // l'utilisateur a visé une zone dédiée, le silence passerait pour un bug.
  if (!file) { setMdConvertStatus('Fichier ignoré : seuls les .md sont convertis.', true); return; }
  runMdConversion(file);
}

const EXPORT_HTML_SIZE_WARN = 8 * 1024 * 1024;

// Point d'entrée bouton topbar (global, cf. CLAUDE.md liste des handlers
// inline). Assemble titre/slug/CSS/corps, avertit via confirm() natif au-delà
// du seuil de taille (pas de dialogue dédié en v1, YAGNI), télécharge.
// Async depuis le lot E4 (passe Mermaid) : verrou de réentrance _exportingHtml
// (l'await CDN ouvre une fenêtre de double-clic → double téléchargement), et
// indicateur d'activité via runBackgroundTask (qui avale un échec en null —
// renderExportBody ne rejette jamais en pratique, tous ses await sont gardés).
let _exportingHtml = false;
async function exportConvHtml() {
  if (!currentThread || !currentThread.length) return;
  if (_exportingHtml) return;
  _exportingHtml = true;
  try {
    const conv = currentConvId ? loadConversation(currentConvId) : null;
    const title = (conv && conv.title) || 'miaou-conversation';
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const now = Date.now();
    const dateDisplay = exportDateDisplay(now);
    const styleCss = serializeThemeTokens() + EXPORT_CSS + prismThemeCssForExport();
    const bodyHtml = await runBackgroundTask('export HTML…',
      () => renderExportBody(currentThread, currentConvId));
    // `null` = le rendu a échoué (runBackgroundTask l'a tracé en console).
    // Sans le toast, le clic sur le bouton d'export ne produisait RIEN.
    if (bodyHtml == null) { toastExportFailed(currentConvId); return; }
    // Script optionnel (progressive enhancement, zéro-JS révisé). Échappement défensif
    // de </ pour ne pas clore prématurément le <script> porteur (même parade que
    // build.py sur __MIAOU_CONFIG__), même si EXPORT_SCRIPT n'en contient pas.
    const s = loadSettings();
    const scriptTag = (s.exportInteractive !== false)
      ? '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>\n'
      : '';
    const html = buildExportHtml({ title, dateDisplay, theme, styleCss, bodyHtml, scriptTag, kind: 'export',
      wideTables: s.wideTables !== false });
    const sizeBytes = new Blob([html]).size;
    if (sizeBytes > EXPORT_HTML_SIZE_WARN) {
      const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
      if (!confirm('Fichier volumineux (~' + mb + ' Mo), continuer ?')) return;
    }
    downloadFile(exportConvFilename(title, now, 'html'), html, 'text/html');
  } catch (e) {
    console.error('[miaou] export HTML échoué :', e);
    toastExportFailed(currentConvId);
  } finally {
    _exportingHtml = false;
  }
}
