/* ── acks.js ───────────────────────────────────────────────────────────────
   Traces d'appels d'outils dans le fil : table pilote ACK_KINDS (libellé,
   icône, annulation), construction d'un ack et de ses affordances (loupe,
   téléchargement, lien d'autorisation), groupe d'acks (ticker : réducteur pur
   puis partie DOM), marqueur de compaction, inspecteur d'appel d'outil (lot Z)
   et rendu des blocs non-texte d'un résultat distant. Séparé d'ui.js le
   2026-09-25 (cf. docs/tools.md) ; chargé juste APRÈS ui.js dans JS_ORDER,
   donc ses initialiseurs de premier niveau peuvent lire les const d'ui.js
   (COMPACTION_SUMMARY_COLLAPSE_MS lit SCROLL_BOTTOM_DURATION_MS), et aucun
   code de premier niveau d'ui.js ne doit lire les siens.
   L'inspecteur est le second chemin string→HTML à risque (piège 21) :
   textContent sans exception.
   ────────────────────────────────────────────────────────────────────────── */

// ── Acks d'outils : table pilote (label + capacité d'annulation + icône) ──────
// Source unique de vérité : ajouter un outil traçable = ajouter une ligne, pas
// toucher au renderer. `undo: null` = variante informative sans bouton (lectures).
// `undo` est une fonction (id) => void. Les icônes sont des SVG statiques
// author-controlled (jamais de donnée modèle dedans).
const ICON_MEMORY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
const ICON_WRENCH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
const ICON_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const ICON_PACKAGE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
// Métaphore code (chevrons < >) — réservée au compute js__eval (lot L), une
// métaphore = un usage (cf. CLAUDE.md, vocabulaire d'icônes).
const ICON_CODE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
// Silhouette de robot (tête carrée + antenne) — métaphore RÉSERVÉE aux agents
// (lot X-1) : une métaphore = un usage. Distincte de la clé à molette (outil
// MCP) et de l'œil (lecture de conversation) : un agent n'est ni l'un ni
// l'autre, c'est un tiers à qui on confie une tâche.
const ICON_AGENT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 13h.01M15 13h.01M9 17h6"/></svg>';
// Triangle d'alerte — métaphore RÉSERVÉE à l'échec d'outil (kind tool_failed) :
// ne pas la réemployer ailleurs (vocabulaire d'icônes : une métaphore = un usage).
// L'outil MCP en échec garde SON icône (clé à molette) + la couleur d'erreur ;
// ce triangle est pour les échecs natifs, qui n'ont pas d'icône propre.
const ICON_ALERT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
// Même tracé que `.code-dl` (decoratePre) — vocabulaire d'icônes, flèche vers
// le bas = télécharger, réservée à cet usage (A3-2, bouton lightbox mode image).
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
// Métaphore image (cadre + montagne) — RÉSERVÉE à une image PRODUITE par MIAOU
// (page PDF rendue, lot V-8). Vocabulaire d'icônes : une métaphore = un usage.
// NE PAS la confondre avec ICON_EYE, qui porte la CONSULTATION (conversation_read,
// resource_presented, recall d'une pièce jointe) : l'œil dit « on te remontre »,
// là où le rendu FABRIQUE une image qui n'existait pas.
const ICON_IMAGE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

// Métaphore « appareil photo » — RÉSERVÉE à « ce modèle lit les images » (lot
// AF : pilule et menu des modèles). Ni l'œil (consultation, aperçu) ni le
// cadre-montagne (image produite). Doublon voulu du glyphe statique de
// index.html (#composer-model-vision) : l'un est dans le HTML, l'autre généré.
const ICON_CAMERA = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

// Métaphore « loupe » — RÉSERVÉE à l'inspection du détail d'un appel d'outil
// (lot Z). Vocabulaire d'icônes : une métaphore = un usage. Distincte
// d'ICON_EYE, qui dit « on te remontre un contenu » (conversation_read,
// resource_presented) : la loupe dit « on décortique ce qui s'est passé » —
// arguments envoyés, résultat reçu, méta d'appel.
const ICON_INSPECT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';

// Métaphore « clé » — RÉSERVÉE au refus d'autorisation d'un serveur MCP
// (campagne AB). Vocabulaire d'icônes : une métaphore = un usage. Une clé, pas
// un cadenas : le cadenas dit « c'est fermé » (un état), la clé dit « voici de
// quoi ouvrir » (une action) — et c'est bien une action qu'on propose ici.
// Distincte d'ICON_ALERT, qui signale une anomalie subie : un refus
// d'autorisation n'est pas une panne, c'est une étape prévue du parcours.
const ICON_KEY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.8 12.2 21 2"/><path d="m17 6 3 3"/><path d="m14 9 3 3"/></svg>';

// Séparateur › coloré (teinte accent) partagé par tous les acks à deux segments
// (breadcrumb MCP, détail replié, ou simple label "Action › cible") — générique,
// pas réservé aux outils MCP — classe CSS générique `.ack-sep`.
function appendAckSep(el) {
  const sep = document.createElement('span');
  sep.className = 'ack-sep';
  sep.textContent = '›';
  el.appendChild(sep);
}

// Rendu à deux niveaux partagé par les acks avec intent : intention (niveau 1,
// visible) + détail technique (niveau 2, replié par défaut derrière un chevron).
// `detailText` est le texte simple du niveau 2 ; `detailBuilder(detail)` (optionnel)
// permet un contenu DOM riche (breadcrumb MCP avec <code>/séparateurs) — appelé à la
// place de detailText si fourni.
function renderIntentTwoLevel(el, intent, detailText, detailBuilder) {
  const row = document.createElement('span');
  row.className = 'mcp-intent-row';
  const intentSpan = document.createElement('span');
  intentSpan.className = 'mcp-intent';
  intentSpan.textContent = intent;
  row.appendChild(intentSpan);
  const chevron = document.createElement('button');
  chevron.className = 'mcp-chevron';
  chevron.type = 'button';
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  setTip(chevron, 'Détail technique');
  const detail = document.createElement('span');
  detail.className = 'mcp-breadcrumb-detail';
  detail.setAttribute('hidden', '');
  if (detailBuilder) {
    detailBuilder(detail);
  } else {
    detail.textContent = detailText;
  }
  row.addEventListener('click', function() {
    if (detail.hasAttribute('hidden')) {
      detail.removeAttribute('hidden');
      chevron.classList.add('open');
    } else {
      detail.setAttribute('hidden', '');
      chevron.classList.remove('open');
    }
  });
  row.appendChild(chevron);
  el.appendChild(row);
  el.appendChild(detail);
}

// Libellé d'un ack docs_pack, en deux moitiés parce que renderLabel intercale
// un séparateur entre elles. `zipEdit` (présent seulement sur une modification,
// docs__pack avec base) change le verbe et ajoute le bilan.
function docsPackAckVerb(m) {
  return m && m.zipEdit ? 'Archive modifiée' : 'Archive créée';
}
function docsPackAckTail(m) {
  if (!m || m.ok === false) return ' (refusée)';
  const n = m.count === 1 ? '1 membre' : (m.count != null ? m.count : '?') + ' membres';
  return ' — ' + n + (m.zipEdit ? ' (' + formatZipEditTally(m.zipEdit) + ')' : '') +
    (m.size != null ? ', ' + humanSize(m.size) : '');
}

const ACK_KINDS = {
  memory_create: { destination: 'both', undo: forgetMemory,  icon: ICON_MEMORY, label: m => 'Mémorisé : « ' + (m.content || '') + ' »' },
  memory_update: { destination: 'both', undo: (id, entry) => { if (entry && entry.prevContent != null) editMemory(id, entry.prevContent); }, icon: ICON_EDIT, label: m => 'Souvenir mis à jour : « ' + (m.content || '') + ' »' },
  memory_delete: { destination: 'both', undo: restoreMemory, icon: ICON_TRASH,  label: m => 'Souvenir supprimé' + (m.content ? ' : « ' + m.content + ' »' : '') },
  conversation_read: { destination: 'user', undo: null, icon: ICON_EYE,
    label: m => 'Conversation consultée : « ' + (m.title || 'sans titre') + ' »',
    renderLabel: (m, el) => {
      // Titre cliquable si convId connu (mène à la conversation) — sans changer
      // sa couleur hors survol, cf. .ack-conv-link.
      const titleNode = m.convId
        ? Object.assign(document.createElement('a'), {
            className: 'ack-conv-link',
            href: 'javascript:void(0)',
            textContent: m.title || 'sans titre',
            onclick: () => selectConv(m.convId, true),
          })
        : document.createTextNode(m.title || 'sans titre');
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Conversation consultée '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' '));
          detail.appendChild(titleNode);
        });
      } else {
        el.appendChild(document.createTextNode('Conversation consultée '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' « '));
        el.appendChild(titleNode);
        el.appendChild(document.createTextNode(' »'));
      }
    },
  },
  // Énumération des conversations par le modèle : si m.intent est présent, rendu
  // en deux niveaux (intention visible + décompte replié) — même pattern que
  // mcp_call. `label` reste la version texte brut (ackLabel, tests).
  conversation_list: { destination: 'user', undo: null, icon: ICON_LIST,
    label: m =>
      (m.intent ? m.intent + ' : ' : '') + (
        m.count === 0 ? 'Aucune conversation trouvée'
      : m.count === 1 ? '1 conversation listée'
      : (m.count != null ? m.count : '?') + ' conversations listées'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'Aucune conversation trouvée'
        : m.count === 1 ? '1 conversation listée'
        : (m.count != null ? m.count : '?') + ' conversations listées';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, countText);
      } else {
        el.textContent = countText;
      }
    },
  },
  // Appel d'outil MCP distant : breadcrumb `seg1` › `seg2` › … sur chaque `__`.
  // Si m.intent est présent, rendu en deux niveaux : intention (niveau 1, visible)
  // + breadcrumb technique (niveau 2, repliée par défaut via chevron).
  // `label` reste la version texte brut (ackLabel, tests) — breadcrumb uniquement.
  mcp_call: { destination: 'user', undo: null, icon: ICON_WRENCH,
    label: m => 'Appel : ' + (m.name || '').split('__').filter(Boolean).join(' › '),
    renderLabel: (m, el) => {
      const segs = (m.name || '').split('__').filter(Boolean);
      const buildBreadcrumb = detail => {
        detail.appendChild(document.createTextNode('Appel '));
        appendAckSep(detail);
        detail.appendChild(document.createTextNode(' '));
        segs.forEach((seg, i) => {
          if (i > 0) appendAckSep(detail);
          const code = document.createElement('code');
          code.textContent = seg;
          detail.appendChild(code);
        });
      };
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, buildBreadcrumb);
      } else {
        // Fallback : breadcrumb seule (inchangée)
        buildBreadcrumb(el);
      }
    },
  },
  // ── Ressources IDB ──────────────────────────────────────────────────────────
  resource_stored: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Ressource enregistrée : ' + (m.resourceName || m.id || '?') +
      (m.size != null ? ' (' + humanSize(m.size) + ')' : ''),
    renderLabel: (m, el) => {
      const build = target => {
        target.appendChild(document.createTextNode('Ressource enregistrée '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?') +
          (m.size != null ? ' (' + humanSize(m.size) + ')' : '')));
      };
      // DEUX POSTURES pour ce kind, distinguées par la seule présence d'`intent`
      // (mesuré, pas déduit) : ack UNIQUE d'un outil que le modèle a appelé
      // (resource__create) → il le porte ; SOUS-PRODUIT de _storeBlock derrière
      // un autre outil (docs__pack, docs__read as_resource, fetch_url) → il ne le
      // porte pas, l'intent est allé à l'ack principal poussé après lui.
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  // Lot Y — écriture incrémentale. MÊME icône que resource_stored (ICON_PACKAGE) :
  // c'est la même métaphore « ranger dans une ressource », l'action se distingue
  // par le libellé, pas par une deuxième métaphore de la même famille
  // (project_icon_metaphor_vocabulary). Pas d'undo, comme resource_stored.
  // `appendedLen` (ajouté) et `size` (total après ajout) sont TOUS DEUX affichés :
  // seul le couple dit ce qui vient de se passer.
  //
  // `ok === false` (lot Y) ne veut PAS dire « l'écriture a échoué » — _appendBlock
  // est atomique — mais « le calcul qui l'a produite s'est interrompu », donc la
  // ressource est incomplète. D'où un suffixe qui S'AJOUTE au décompte au lieu de
  // le remplacer, contrairement au « (refusé) » de js_eval/docs_pack : ce qui a
  // été écrit avant l'interruption est précisément ce qui a été SAUVÉ, l'effacer
  // de l'affichage cacherait l'information utile. ackIsError fait le rouge.
  resource_appended: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Ressource complétée : ' + (m.resourceName || m.id || '?') +
      (m.appendedLen != null ? ' (+' + m.appendedLen + ' car.' +
        (m.size != null ? ', ' + humanSize(m.size) + ' au total' : '') +
        (m.ok === false ? ', interrompu' : '') + ')'
        : (m.ok === false ? ' (interrompu)' : '')),
    renderLabel: (m, el) => {
      const tail = (m.appendedLen != null ? ' (+' + m.appendedLen + ' car.' +
        (m.size != null ? ', ' + humanSize(m.size) + ' au total' : '') +
        (m.ok === false ? ', interrompu' : '') + ')'
        : (m.ok === false ? ' (interrompu)' : ''));
      const build = target => {
        target.appendChild(document.createTextNode('Ressource complétée '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?') + tail));
      };
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  resource_presented: {
    destination: 'user',
    undo: null,
    icon: ICON_EYE,
    label: m => 'Ressource présentée : ' + (m.resourceName || m.id || '?'),
    renderLabel: (m, el) => {
      const build = target => {
        target.appendChild(document.createTextNode('Ressource présentée '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?')));
      };
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  // Rappel d'une pièce jointe de message (miaou__recall_attachment, brief A).
  // Même posture que resource_presented (lecture, pas d'undo) mais lookup par
  // attId (conversation-scoped), pas id de ressource — cf. placeToolAck.
  // DEUX PRODUCTEURS pour ce kind, distingués par `origin` (lot V-8) :
  //   - recall_attachment : l'utilisateur avait joint le fichier, le modèle le
  //     RAPPELLE (métaphore œil, « on te remontre ») ;
  //   - docs__render_page (origin: 'docs_render') : MIAOU PRODUIT l'image d'une
  //     page de PDF, elle n'existait pas avant (métaphore image).
  // Le kind est commun DÉLIBÉRÉMENT : c'est lui que resolveRecallImages
  // (resources.js) reconnaît pour ré-injecter les pixels aux envois ultérieurs,
  // et un second kind obligerait à maintenir deux prédicats de ré-injection en
  // parallèle. `origin` ne gouverne QUE l'affichage — jamais le routage.
  attachment_recalled: {
    destination: 'user',
    undo: null,
    icon: m => (m && m.origin === 'docs_render') ? ICON_IMAGE : ICON_EYE,
    label: m => (m && m.origin === 'docs_render')
      ? docsRenderAckLabel(m)                                  // docs.js, pur
      : 'Pièce jointe rappelée : ' + (m.resourceName || m.attId || '?'),
    renderLabel: (m, el) => {
      const render = m && m.origin === 'docs_render';
      const head = (render ? docsRenderAckHead(m) : 'Pièce jointe rappelée') + ' ';
      const cible = render
        ? (m.sourceName || m.resourceName || '?')
        : (m.resourceName || m.attId || '?');
      const build = target => {
        target.appendChild(document.createTextNode(head));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + cible));
      };
      // Intention du modèle au niveau 1, libellé dérivé replié au niveau 2 —
      // patron des 19 autres lignes de la table (cf. docs_read juste au-dessus).
      // Cette ligne en était la SEULE exception, antérieurement à V-8 : le
      // `miaou_intent` arrivait bien sur l'ack (callTool + ACK_COPY_FIELDS) mais
      // n'était jamais affiché, alors qu'il l'était dans l'export.
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  // Énumération des skills par le modèle (miaou__skills__list) : informatif, pas
  // d'undo (lecture — même posture que conversation_list, dont on réutilise l'icône).
  skill_list: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m =>
      (m.intent ? m.intent + ' : ' : '') + (
        m.count === 0 ? 'Aucune skill disponible'
      : m.count === 1 ? '1 skill listée'
      : (m.count != null ? m.count : '?') + ' skills listées'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'Aucune skill disponible'
        : m.count === 1 ? '1 skill listée'
        : (m.count != null ? m.count : '?') + ' skills listées';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, countText);
      } else {
        el.textContent = countText;
      }
    },
  },
  // Lecture d'une skill par le modèle (miaou__skills__read) : informatif, pas d'undo
  // (lecture, pas une mutation d'état — même posture que conversation_read).
  skill_read: {
    destination: 'user',
    undo: null,
    icon: ICON_BOOK,
    label: m => 'Skill consultée : ' + (m.title || m.slug || '?'),
    renderLabel: (m, el) => {
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Skill consultée '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
        });
      } else {
        el.appendChild(document.createTextNode('Skill consultée '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
      }
    },
  },
  // Création/modification d'une skill par le modèle (miaou__skills__write) :
  // informatif, pas d'undo (cohérent avec l'absence de tombstone sur la
  // suppression de skill — action explicite, pas de undo async IDB introduit ici).
  skill_write: {
    destination: 'user',
    undo: null,
    icon: ICON_EDIT,
    label: m => (m.created ? 'Skill créée : ' : 'Skill modifiée : ') + (m.title || m.slug || '?'),
    renderLabel: (m, el) => {
      const verb = m.created ? 'Skill créée' : 'Skill modifiée';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode(verb + ' '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
        });
      } else {
        el.appendChild(document.createTextNode(verb + ' '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
      }
    },
  },
  // Consultation de l'aide MIAOU par le modèle (miaou__about) : informatif, pas
  // d'undo (lecture — même posture que skill_read).
  about_read: {
    destination: 'user',
    undo: null,
    icon: ICON_BOOK,
    label: m => 'Aide consultée : ' + (m.topic || 'apercu'),
    renderLabel: (m, el) => {
      const topic = m.topic || 'apercu';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Aide consultée '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + topic));
        });
      } else {
        el.appendChild(document.createTextNode('Aide consultée '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + topic));
      }
    },
  },
  // Recherche de mots-clefs dans l'aide MIAOU (miaou__about_search) : même
  // posture que about_read (lecture, pas d'undo) ; libellé porte la requête
  // et le nombre de sujets trouvés (pattern pluriel de files_list).
  about_search: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m =>
      'Aide cherchée « ' + (m.query || '') + ' » : ' + (
        m.count === 0 ? 'aucun résultat'
      : m.count === 1 ? '1 sujet trouvé'
      : (m.count != null ? m.count : '?') + ' sujets trouvés'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'aucun résultat'
        : m.count === 1 ? '1 sujet trouvé'
        : (m.count != null ? m.count : '?') + ' sujets trouvés';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Aide cherchée « ' + (m.query || '') + ' » '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + countText));
        });
      } else {
        el.appendChild(document.createTextNode('Aide cherchée « ' + (m.query || '') + ' » '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + countText));
      }
    },
  },
  // ── Bibliothèque de fichiers d'espace (lot Cbis) ────────────────────────────
  // Énumération des fichiers de l'espace actif (miaou__files__list) : même
  // posture que skill_list/conversation_list (lecture, pas d'undo).
  files_list: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m =>
      (m.intent ? m.intent + ' : ' : '') + (
        m.count === 0 ? 'Aucun fichier dans la bibliothèque'
      : m.count === 1 ? '1 fichier listé'
      : (m.count != null ? m.count : '?') + ' fichiers listés'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'Aucun fichier dans la bibliothèque'
        : m.count === 1 ? '1 fichier listé'
        : (m.count != null ? m.count : '?') + ' fichiers listés';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, countText);
      } else {
        el.textContent = countText;
      }
    },
  },
  // Lecture d'un fichier de bibliothèque (miaou__files__read) : même posture
  // que skill_read/attachment_recalled (lecture, pas d'undo).
  files_read: {
    destination: 'user',
    undo: null,
    icon: ICON_BOOK,
    label: m => 'Fichier consulté : ' + (m.resourceName || m.id || '?'),
    renderLabel: (m, el) => {
      const name = m.resourceName || m.id || '?';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Fichier consulté '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name));
        });
      } else {
        el.appendChild(document.createTextNode('Fichier consulté '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name));
      }
    },
  },
  // Promotion d'une pièce jointe vers la bibliothèque (miaou__files__promote) :
  // informatif seulement, PAS d'undo — la promotion est déjà consent-gated en
  // amont (ask_confirmation, voie B), un undo ici confondrait consentement et
  // réversibilité (« undo n'est pas consentement »).
  file_promote: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Fichier ajouté à la bibliothèque : ' + (m.resourceName || m.id || '?'),
    renderLabel: (m, el) => {
      const build = target => {
        target.appendChild(document.createTextNode('Fichier ajouté à la bibliothèque '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?')));
      };
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  // Compute sandboxé sur un blob client (miaou__js__eval, lot L) : informatif,
  // pas d'undo (pur compute, aucune écriture d'état). Le code exécuté N'est PAS
  // rendu dans le thread (brief §3 : la doctrine no-silent-action vise les
  // écritures d'état inférées, pas le compute pur) — il n'est capté que dans
  // l'ack pour l'export (champ `code`, cf. formatToolAcksHtml). La ligne de
  // thread annonce seulement les entrées (résumées par jsEvalHandlesSummary,
  // utils.js — pur et partagé avec l'export) et l'issue.
  js_eval: {
    destination: 'user',
    undo: null,
    icon: ICON_CODE,
    label: m => (jsEvalHasNoInputs(m.inputHandles)
      ? 'Code exécuté sans ressource'
      : 'Code exécuté sur ' + jsEvalHandlesSummary(m.inputHandles)) +
      (m.ok === false ? ' (refusé)' : (m.outLen != null ? ' → ' + m.outLen + ' car.' : '')),
    renderLabel: (m, el) => {
      const tail = m.ok === false ? ' (refusé)' : (m.outLen != null ? ' → ' + m.outLen + ' car.' : '');
      // Calcul pur (aucune entrée) : la phrase se termine sur elle-même, sans
      // séparateur ni résumé — « exécuté sur › ? » suggérerait une ressource
      // non identifiée là où il n'y en a simplement aucune.
      const bare = jsEvalHasNoInputs(m.inputHandles);
      const paint = (node) => {
        if (bare) {
          node.appendChild(document.createTextNode('Code exécuté sans ressource' + tail));
          return;
        }
        node.appendChild(document.createTextNode('Code exécuté sur '));
        appendAckSep(node);
        node.appendChild(document.createTextNode(' ' + jsEvalHandlesSummary(m.inputHandles) + tail));
      };
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, paint);
      else paint(el);
    },
  },
  // Listing d'un document (miaou__docs__list, lot V-1, élargi V-4) : lecture
  // pure, pas d'undo — rien n'est décompressé ni stocké. Pattern de pluriel de
  // files_list. Le verbe et l'unité suivent le FORMAT : « Archive listée … 3
  // membres » pour un zip, « Document listé … 12 pages » pour un PDF. Un ack
  // qui dirait « Archive » sur un PDF apprendrait faux à l'utilisateur — et
  // c'est la seule trace qu'il ait de ce que le modèle a ouvert.
  docs_list: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m => docsListAckHead(m) + ' : ' + (m.resourceName || m.handle || '?') +
      ' — ' + docsListAckCount(m),
    renderLabel: (m, el) => {
      const countText = docsListAckCount(m);
      const name = m.resourceName || m.handle || '?';
      const head = docsListAckHead(m) + ' ';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode(head));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name + ' — ' + countText));
        });
      } else {
        el.appendChild(document.createTextNode(head));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name + ' — ' + countText));
      }
    },
  },
  // Lecture paginée (miaou__docs__read, lot V-4). Kind DISTINCT de docs_list :
  // l'utilisateur doit lire « Pages 2-5 lues », pas « Document listé » — ce
  // n'est pas la même opération et la trace est ce qu'il en voit.
  // Sans as_resource, rien n'est stocké (lecture pure) ; avec, la ressource
  // créée est tracée par l'ack resource_stored de _storeBlock, comme
  // docs_extract. Pas d'undo dans les deux cas.
  docs_read: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m => docsReadAckLabel(m),
    renderLabel: (m, el) => {
      const name = m.resourceName || m.handle || '?';
      const head = docsReadAckHead(m) + ' ';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode(head));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name));
        });
      } else {
        el.appendChild(document.createTextNode(head));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name));
      }
    },
  },
  // Extraction d'un membre d'archive (miaou__docs__extract, lot V-1) : informatif,
  // pas d'undo (la ressource créée est un artefact de travail, comme un
  // resource__create — l'ack resource_stored de _storeBlock la trace déjà). Un
  // refus métier (membre chiffré, trop gros, introuvable) arrive ici avec
  // ok:false → rendu rouge par ackIsError, alors que le result modèle reste un
  // texte non-isError : l'échec n'existe QUE dans l'ack (même posture que js_eval).
  docs_extract: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Membre extrait : ' + (m.path || '?') +
      (m.ok === false ? ' (refusé)' : (m.size != null ? ' — ' + humanSize(m.size) : '')),
    renderLabel: (m, el) => {
      const tail = m.ok === false ? ' (refusé)' : (m.size != null ? ' — ' + humanSize(m.size) : '');
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Membre extrait '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + (m.path || '?') + tail));
        });
      } else {
        el.appendChild(document.createTextNode('Membre extrait '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + (m.path || '?') + tail));
      }
    },
  },
  // Création ou modification d'archive (miaou__docs__pack, lot V-2 ; `base`
  // pour la modification, libellé par docsPackAckVerb/Tail) : même posture que
  // docs_extract — informatif, pas d'undo, et un refus métier (plan vide,
  // doublon, cap, nom non sûr) arrive avec ok:false → rouge par ackIsError,
  // alors que le result modèle reste un texte non-isError.
  // ICÔNE : ICON_PACKAGE, déjà la métaphore de « des octets deviennent une
  // ressource » (resource_stored, docs_extract, file_promote) — docs__pack en
  // est le cas exact, aucune métaphore à inventer.
  // Le BOUTON DE TÉLÉCHARGEMENT du zip n'est PAS ici : il vient de l'ack
  // resource_stored que _storeBlock pousse en plus (ackDownloadTarget →
  // .ack-dl). Deux acks par appel réussi, comme docs__extract.
  docs_pack: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => docsPackAckVerb(m) + ' : ' + (m.resourceName || '?') + docsPackAckTail(m),
    renderLabel: (m, el) => {
      const verb = docsPackAckVerb(m);
      const tail = docsPackAckTail(m);
      const name = m.resourceName || '?';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode(verb + ' '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name + tail));
        });
      } else {
        el.appendChild(document.createTextNode(verb + ' '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name + tail));
      }
    },
  },
  // Échec d'un outil NATIF (miaou__*) : kind générique, poussé par toolFail()
  // (tools.js) au point de sortie en erreur du handler. Avant ce kind, un handler
  // en échec (« Souvenir introuvable », « Handle manquant »…) retournait sa chaîne
  // sans pousser d'ack : le modèle voyait l'erreur en tool result, mais l'appel
  // était TOTALEMENT invisible dans le fil (pas d'ack blanc — pas d'ack du tout).
  // Toujours en erreur (`error: true`, posé par toolFail) → rendu rouge via
  // ackIsError. Pas d'undo : rien ne s'est produit, il n'y a rien à annuler.
  // Les échecs MCP distants ne passent PAS par ici : ils gardent leur kind
  // mcp_call (avec leur breadcrumb) et sont colorés par `error`.
  tool_failed: {
    destination: 'user',
    undo: null,
    icon: ICON_ALERT,
    label: m => 'Échec : ' + (m.name || 'outil') + (m.message ? ' — ' + m.message : ''),
    renderLabel: (m, el) => {
      const detailText = (m.name || 'outil') + (m.message ? ' — ' + m.message : '');
      // Avec intent : l'intention du modèle en niveau 1 (ce qu'il VOULAIT faire),
      // le nom d'outil + le message d'échec en niveau 2 (pourquoi ça a raté).
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, detailText);
      } else {
        el.appendChild(document.createTextNode('Échec '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + detailText));
      }
    },
  },
  // ── Agents (lot X-1) ────────────────────────────────────────────────────
  // Quatre kinds, un par outil agent__*. L'ack est FIGÉ au moment de l'appel
  // (nature d'un ack) : celui du spawn dit « lancé », pas « en cours » — le
  // suivi live d'un agent qui travaille est porté par la pastille du parent
  // (badges, étape 7), pas par cet ack. L'enrichir pour qu'il reflète l'état
  // courant est l'objet de X-3, avec sa spec ; ne pas l'anticiper ici.
  //
  // `title` porte l'`intent` rédigé par le modèle — un agent n'étant jamais
  // titré, c'est le seul libellé disponible. Il est rendu tel quel, JAMAIS
  // normalisé (la casse appartient au modèle).
  // `convId` rend le libellé cliquable : ouvrir le fil de l'agent est un geste
  // de débogage rare mais légitime (décision 8, capacité sans publicité).
  agent_spawn: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'Agent lancé : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'Agent lancé'),
  },
  agent_status: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'État d\'agent consulté : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'État d\'agent consulté'),
  },
  agent_result: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'Résultat d\'agent relu : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'Résultat d\'agent relu'),
  },
  agent_abort: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'Agent interrompu : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'Agent interrompu'),
  },
};

// Rendu partagé des quatre acks agent (lot X-1) : verbe + libellé cliquable
// vers le fil de l'agent. Une seule formule — quatre copies divergeraient sur
// le point exact (la cliquabilité) qui fait la valeur de l'affordance.
// Même motif que conversation_read, dont il reprend `.ack-conv-link`.
function renderAgentAckLabel(m, el, verb) {
  const text = m.title || 'sans libellé';
  const node = m.convId
    ? Object.assign(document.createElement('a'), {
        className: 'ack-conv-link',
        href: 'javascript:void(0)',
        textContent: text,
        onclick: () => selectConv(m.convId, true),
      })
    : document.createTextNode(text);
  if (m.intent) {
    renderIntentTwoLevel(el, m.intent, null, detail => {
      detail.appendChild(document.createTextNode(verb + ' '));
      appendAckSep(detail);
      detail.appendChild(document.createTextNode(' '));
      detail.appendChild(node);
    });
  } else {
    el.appendChild(document.createTextNode(verb + ' '));
    appendAckSep(el);
    el.appendChild(document.createTextNode(' « '));
    el.appendChild(node);
    el.appendChild(document.createTextNode(' »'));
  }
}

// Wrapper exposé pour les tests (aucun call-site app — buildToolAck utilise
// spec.label directement) : résout le label depuis ACK_KINDS.
function ackLabel(kind, m) {
  const spec = ACK_KINDS[kind];
  return spec ? spec.label(m) : 'Action effectuée';
}

// Téléchargement de la ressource désignée par un ack (lot V). Cible produite
// par `ackDownloadTarget` (utils.js, prédicat unique). Deux résolutions selon
// `by`, jamais fusionnées : une ressource IDB se relit par id — cache session
// d'abord, puis `getResource` (IDB) pour survivre à un cache froid après reload
// — tandis qu'un attachment ne se résout QUE par le cache session
// (getCachedRecordByAttId n'a pas d'équivalent IDB indexé par attId ; le cache
// est peuplé à l'ouverture de la conversation par loadConversationResources).
// Échec = feedback visuel discret sur le bouton, jamais d'alert ni de throw :
// une ressource peut légitimement avoir été évincée ou supprimée.
async function downloadAckResource(target, btn) {
  if (!target || (btn && btn.disabled)) return;
  if (btn) btn.disabled = true;
  try {
    let record = null;
    if (target.by === 'resource') {
      record = (typeof getCachedRecord === 'function' && getCachedRecord(target.id)) || null;
      if (!record) { try { record = await getResource(target.id); } catch (e) { record = null; } }
    } else if (target.by === 'attachment') {
      record = (typeof getCachedRecordByAttId === 'function'
        ? getCachedRecordByAttId(target.attId, target.convId) : null);
    }
    if (!record || !record.data) { markAckDlUnavailable(btn); return; }
    // Nom au mieux : celui du record (figé au stockage) prioritaire sur celui de
    // l'ack (copie, potentiellement plus ancienne), extension dérivée du mime.
    downloadFile(
      resourceDownloadName(record.name || target.name, record.mime || target.mime),
      record.data, record.mime || 'application/octet-stream');
  } finally {
    if (btn && !btn.classList.contains('unavailable')) btn.disabled = false;
  }
}

// Feedback d'indisponibilité : le bouton reste en place (l'ack, lui, est
// toujours vrai — la ressource A été enregistrée) mais devient inerte et le dit
// au survol. Pas de retrait du DOM : ferait disparaître une affordance sous le
// curseur, et le record peut redevenir disponible après réouverture de la conv.
function markAckDlUnavailable(btn) {
  if (!btn) return;
  btn.classList.add('unavailable');
  btn.disabled = true;
  setTip(btn, 'Ressource non disponible');
}

// Bouton loupe d'un ack. Extrait de `buildToolAck` (lot Z-2) parce qu'il a un
// SECOND site d'appel : la rétro-application au DOM quand l'ack a été peint
// AVANT d'être enrichi (cf. `refreshAckInspectAffordance`). Le dupliquer ferait
// diverger la classe, le titre, l'icône ou — plus grave — le stopPropagation.
//
// Le listener est posé SUR LE NŒUD, jamais en délégation au niveau du groupe :
// en mode compact un seul .tool-ack est dans le DOM, les autres sont DÉTACHÉS
// et ne vivent que comme valeurs de `ackNodeOf` (WeakMap). Une délégation ne
// verrait jamais les acks masqués — c'est-à-dire précisément les appels
// intermédiaires d'un enchaînement, le cas d'usage qui a motivé le lot. Les
// nœuds détachés survivent intacts, listeners compris.
//
// La closure capture l'ENTRÉE elle-même, jamais `m.id` : cet id n'est pas
// unique (un create et un delete du même souvenir le partagent). Elle capture
// la RÉFÉRENCE, donc un enrichissement ultérieur par `Object.assign` sur cette
// même entrée est vu par l'inspecteur à l'ouverture — c'est ce qui rend la
// rétro-application correcte sans re-poser de listener.
// Comme `.ack-dl`, ce bouton est délibérément ABSENT des exports (piège 21) :
// _formatToolCallHtml construit son markup indépendamment et ne l'émet pas.
function _appendAckInspectBtn(wrap, m) {
  const insp = document.createElement('button');
  insp.className = 'ack-inspect';
  insp.innerHTML = ICON_INSPECT;   // SVG statique author-controlled uniquement
  setTip(insp, 'Inspecter l\'appel');
  insp.addEventListener('click', ev => {
    // Le bouton est un frère de `.ack-label`, pas un descendant de
    // `.mcp-intent-row` : le listener de groupe (ensureAckGroup) filtre sur
    // cette row et ne verrait pas ce clic. stopPropagation est là comme
    // garde de frontière — pour qu'ajouter demain un écouteur en bulle sur
    // `.ack-panels` ou `.tool-ack` ne fasse pas basculer le groupe au
    // passage, alors que le geste demandé est « inspecter », pas « replier ».
    ev.stopPropagation();
    openToolInspector(m);
  });
  // Ordre des icônes : la loupe vient APRÈS le téléchargement mais AVANT
  // `.ack-undo`/`.ack-resolved`, pour que la colonne d'icônes reste alignée
  // d'un ack à l'autre dans un groupe déplié. En rétro-application le wrap est
  // déjà complet : `appendChild` la mettrait derrière « annuler ». D'où
  // l'insertion AVANT le premier de ces deux-là quand il existe.
  const after = wrap.querySelector('.ack-undo, .ack-resolved');
  if (after) wrap.insertBefore(insp, after);
  else wrap.appendChild(insp);
  return insp;
}

// Bouton œil d'un ack agent : ouvre le fil de l'agent que l'ack désigne.
//
// ICON_EYE et pas la loupe : vocabulaire d'icônes, une métaphore = un usage.
// L'œil dit « on te remontre une conversation » (c'est déjà l'icône de kind de
// `conversation_read`, et le commentaire d'ICON_AGENT le désigne comme tel) ;
// la loupe dit « on décortique cet appel » — ce que le bouton d'à côté fait,
// et qui est une autre question.
//
// L'existence de la conversation est vérifiée AU CLIC, pas au rendu, à
// l'inverse du bouton équivalent sur le compte rendu d'agent
// (`agentOpenButtonHtml`). La raison est le mode compact : un ack masqué vit
// détaché dans `ackNodeOf` (WeakMap) et peut être ré-attaché longtemps après
// sa construction, donc un test au rendu y serait périmé sans que rien ne le
// recalcule. Vérifier au clic est le seul instant qui vaut pour les deux
// chemins. On retire alors le bouton devenu faux plutôt que d'échouer en
// silence (openConversation est un no-op sur un id inconnu).
//
// stopPropagation pour la même raison que `.ack-inspect` : garde de frontière
// contre un futur écouteur en bulle sur `.ack-panels`/`.tool-ack` qui ferait
// replier le groupe alors que le geste demandé est « ouvrir le fil ».
function _appendAckOpenAgentBtn(wrap, target) {
  const btn = document.createElement('button');
  btn.className = 'ack-open-agent';
  btn.innerHTML = ICON_EYE;   // SVG statique author-controlled uniquement
  setTip(btn, 'Ouvrir le fil de l\'agent');
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    if (!loadConversation(target.convId)) { btn.remove(); return; }
    selectConv(target.convId, true);
  });
  wrap.appendChild(btn);
  return btn;
}

// Fait apparaître la loupe sur un ack DÉJÀ PEINT qui vient d'être enrichi.
// `buildToolAck` décide de l'affordance au moment où l'ack est créé ; or un ack
// MCP est rendu par `onEarlyAcks` AVANT le round-trip réseau, donc avant que
// `onEnrichLastAck` ne pose `args`/`result` — la loupe n'apparaissait qu'après
// avoir quitté et rouvert la conversation (le reload relit l'entrée enrichie).
// Idempotente : ne repose rien si le bouton est déjà là. Sans effet si le nœud
// est absent (génération détachée : l'entrée est enrichie quand même, et le
// rendu à l'attache lira le prédicat à jour).
function refreshAckInspectAffordance(node, entry) {
  if (!node || !entry) return;
  if (!ackHasInspectableDetail(entry)) return;
  if (node.querySelector('.ack-inspect')) return;
  _appendAckInspectBtn(node, entry);
}

// Lien « Autoriser » d'un ack portant un refus d'autorisation (campagne AB).
//
// S'écarte du gabarit icône-seule de `.ack-dl`/`.ack-inspect`, et c'est
// délibéré : ces deux-là agissent SUR l'ack (télécharger sa ressource,
// inspecter son détail) et se lisent d'un pictogramme. Ici l'action est
// SORTANTE — elle quitte MIAOU pour un tiers — et l'utilisateur doit lire vers
// où il part avant de cliquer. Une icône seule ne peut pas porter cette
// information ; l'origine en clair, si.
//
// Construction par API DOM, `href` posé par PROPRIÉTÉ : cette URL vient du
// réseau, et la passer par une template string la mettrait sur un chemin
// string→HTML, c'est-à-dire précisément la voie que le piège 21 réserve à
// `formatToolAcksHtml`. Ici il n'y a aucune raison d'en ouvrir une seconde.
//
// `rel="noopener noreferrer"` : `noopener` coupe l'accès à `window.opener`
// depuis la page ouverte ; `noreferrer` évite en plus de lui annoncer d'où
// vient le clic — un serveur d'autorisation légitime n'en a pas besoin, et un
// serveur hostile n'a pas à l'apprendre.
function _appendAckAuthorizeLink(wrap, target) {
  const box = document.createElement('span');
  box.className = 'ack-authorize';

  // La clé précède le libellé : dans une ligne rouge, le mot « Autoriser » seul
  // se noie dans le texte d'erreur, alors que le pictogramme accroche l'œil.
  // Elle est DANS le lien, pas à côté : c'est la même cible de clic, et deux
  // éléments cliquables voisins pour une seule action se manquent au pointeur.
  const icon = document.createElement('span');
  icon.className = 'ack-authorize-icon';
  icon.innerHTML = ICON_KEY;   // SVG statique author-controlled uniquement

  const link = document.createElement('a');
  link.className = 'ack-authorize-link';
  link.appendChild(icon);
  link.href = target.url;              // propriété, jamais interpolation
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // appendChild, PAS textContent : celui-ci écraserait l'icône insérée juste
  // au-dessus. Nœud texte, donc frontière XSS identique.
  link.appendChild(document.createTextNode('Autoriser'));
  setTip(link, target.upstream
    ? 'Autoriser l\'accès à ' + target.upstream + ' sur ' + target.origin
    : 'Autoriser l\'accès sur ' + target.origin);
  box.appendChild(link);

  const origin = document.createElement('span');
  origin.className = 'ack-authorize-origin';
  origin.textContent = target.origin;   // textContent : frontière XSS standard
  box.appendChild(origin);

  // Même position que la loupe dans la colonne d'icônes, et pour la même
  // raison : rester alignée d'un ack à l'autre dans un groupe déplié.
  const after = wrap.querySelector('.ack-undo, .ack-resolved');
  if (after) wrap.insertBefore(box, after);
  else wrap.appendChild(box);
  return box;
}

// Fait apparaître le lien sur un ack DÉJÀ PEINT qui vient d'être enrichi —
// même différé que `refreshAckInspectAffordance`, et pour la même cause : un
// ack MCP est peint par `onEarlyAcks` AVANT le round-trip, donc avant que le
// refus n'existe. Idempotente ; sans effet si le nœud est absent (génération
// détachée — l'entrée est mutée quand même, le rendu à l'attache lira le
// prédicat à jour).
// URL configurée du serveur MCP d'où vient un ack, ou `null`. Impure (elle lit
// le stockage), donc hors d'`ackAuthorizationTarget`, qui doit rester pure et
// testable — et ses DEUX appelants passent par ici plutôt que de recomposer le
// lookup, sans quoi un ack rendrait un lien là où l'autre n'en rendrait pas.
//
// Résolu à l'AFFICHAGE, jamais figé sur l'ack : c'est la config du moment qui
// dit comment on joint le serveur aujourd'hui, et un ack relu dans six mois doit
// pointer là où l'utilisateur a mis son proxy depuis, pas là où il était.
function _ackMcpServerUrl(entry) {
  if (!entry || !entry.mcpServer) return null;
  const srv = getMcpServer(entry.mcpServer);
  return (srv && srv.url) || null;
}

function refreshAckAuthorizationAffordance(node, entry) {
  if (!node || !entry) return;
  const target = ackAuthorizationTarget(entry, _ackMcpServerUrl(entry));
  if (!target) return;
  if (node.querySelector('.ack-authorize')) return;
  _appendAckAuthorizeLink(node, target);
}

// Séparateur de compaction dans le fil (lot AE). Ni une bulle ni un ack : une
// règle horizontale légendée, repliée par défaut sur le résumé.
//
// Ce que cette surface DIT, et qui n'est pas anodin : les messages d'avant sont
// toujours là (AE-2 conserve tout en base, l'élagage est à l'émission). Ce qui
// a changé est ce que le modèle reçoit. Un libellé qui laisserait croire à une
// suppression ferait craindre une perte qui n'a pas lieu.
//
// Le résumé est d'origine MODÈLE : rendu par `renderMd` (sortie sanitisée),
// jamais par interpolation de chaîne (piège 21).
function buildCompactionMarker(m) {
  const wrap = document.createElement('div');
  wrap.className = 'compaction-mark';
  const head = document.createElement('div');
  head.className = 'compaction-mark-head';
  head.innerHTML =
    `<svg class="compaction-mark-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"/><path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M3 12h18"/></svg>` +
    `<span class="compaction-mark-label">Contexte compacté${formatCompactionReclaimSuffix(m.reclaimed)} — les messages précédents ne sont plus transmis au modèle</span>`;
  wrap.appendChild(head);
  const body = document.createElement('details');
  body.className = 'compaction-mark-body';
  const sum = document.createElement('summary');
  sum.textContent = 'Voir le résumé';
  body.appendChild(sum);
  const content = document.createElement('div');
  content.className = 'compaction-mark-summary body';
  content.innerHTML = renderMd(m.content || '');
  body.appendChild(content);
  body.addEventListener('toggle', () => {
    sum.textContent = body.open ? 'Masquer le résumé' : 'Voir le résumé';
    if (body.open) revealCompactionSummary(content);
  });
  sum.addEventListener('click', (e) => {
    if (!body.open) return;
    e.preventDefault();
    collapseCompactionSummary(body, content);
  });
  wrap.appendChild(body);
  return wrap;
}

// Durée du repli du résumé — celle de la descente au fond, l'autre geste de
// navigation animé du fil.
const COMPACTION_SUMMARY_COLLAPSE_MS = SCROLL_BOTTOM_DURATION_MS;

// Déplié, le résumé s'ouvre SOUS le libellé cliqué, donc souvent sous le
// composer : on descend jusqu'à le montrer — au fond du fil s'il y tient, sinon
// jusqu'à poser son début en haut de la vue. Même calcul que le plafond
// d'autoscroll (`cappedScrollTop`), résumé pris pour ancre : la vue ne remonte
// jamais, et un résumé déjà visible ne bouge rien.
function revealCompactionSummary(content) {
  const m = $('messages');
  if (!m || !content.isConnected) return;
  const padTop = parseFloat(getComputedStyle(m).paddingTop) || 0;
  const top = cappedScrollTop(anchorTopInScroll(m, content), m.scrollHeight, m.clientHeight, padTop, m.scrollTop);
  if (top <= m.scrollTop) return;
  m.scrollTo({ top, behavior: motionReduced() ? 'auto' : 'smooth' });
}

// Repli ANIMÉ, pendant du dépli qui défile en douceur. Un repli sec retire d'un
// coup toute la hauteur du résumé : une vue posée au fond du fil est alors
// ramenée d'autant par le navigateur, en un saut. En faisant fondre la boîte,
// c'est ce même recalage qui suit la hauteur frame par frame — aucun scroll à
// piloter. `open` n'est retiré qu'à l'arrivée, ce qui déclenche le `toggle`
// (libellé) au moment où le résumé a effectivement disparu.
//
// Départ = la boîte telle qu'elle est rendue (hauteur de bordure en
// border-box, marge et paddings calculés) : aucun saut à la pose de
// l'animation (cf. l'épinglage des hauteurs d'acks).
function collapseCompactionSummary(body, content) {
  if (content._collapsing) return;
  if (motionReduced() || typeof content.animate !== 'function') { body.open = false; return; }
  const cs = getComputedStyle(content);
  content._collapsing = true;
  content.style.boxSizing = 'border-box';
  content.style.overflow = 'hidden';
  const anim = content.animate([
    { height: content.offsetHeight + 'px', marginTop: cs.marginTop,
      paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
      borderTopWidth: cs.borderTopWidth, borderBottomWidth: cs.borderBottomWidth, opacity: 1 },
    { height: '0px', marginTop: '0px', paddingTop: '0px', paddingBottom: '0px',
      borderTopWidth: '0px', borderBottomWidth: '0px', opacity: 0 },
  ], { duration: COMPACTION_SUMMARY_COLLAPSE_MS, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
  anim.onfinish = () => {
    body.open = false;
    anim.cancel();
    content.style.boxSizing = '';
    content.style.overflow = '';
    content._collapsing = false;
  };
}

function buildToolAck(m) {
  const kind = ackKindOf(m);
  const spec = ACK_KINDS[kind] || { undo: null, icon: '', label: () => 'Action effectuée' };

  const wrap = document.createElement('div');
  wrap.className = 'tool-ack ack-' + (kind || 'unknown') +
    (m.resolved ? ' resolved' : '') +
    (ackIsError(m) ? ' ack-error' : '') +
    (m.intent ? ' has-intent' : '');
  if (m.id) wrap.dataset.ackId = m.id;

  if (spec.icon) {
    // `icon` accepte une FONCTION depuis V-8 (comme `label` le fait déjà) : un
    // kind dont deux producteurs méritent deux métaphores l'aiguille sur l'ack
    // (attachment_recalled : rappel vs page rendue). La garde de sécurité est
    // intacte — la fonction CHOISIT parmi les constantes ICON_* de ce fichier,
    // elle n'en fabrique aucune : rien d'origine modèle n'entre jamais ici.
    const svg = (typeof spec.icon === 'function') ? spec.icon(m) : spec.icon;
    if (svg) {
      const iconEl = document.createElement('span');
      iconEl.className = 'ack-icon';
      iconEl.innerHTML = svg;   // SVG statique author-controlled uniquement
      wrap.appendChild(iconEl);
    }
  }

  const label = document.createElement('span');
  label.className = 'ack-label';
  // renderLabel : construction DOM riche (breadcrumb avec <code> et séparateur) —
  // réservé aux kinds qui en ont besoin. Sinon textContent (frontière XSS standard).
  if (spec.renderLabel) {
    spec.renderLabel(m, label);
  } else {
    label.textContent = spec.label(m);
  }
  wrap.appendChild(label);

  // Téléchargement de la ressource désignée par l'ack (lot V). Placé APRÈS le
  // label et AVANT `undo` : c'est une action sur la cible de l'ack, pas sur
  // l'ack lui-même. Il précède aussi la loupe d'inspection (lot Z) : quand les
  // deux sont là, l'ordre fixe met la loupe en DERNIÈRE position, donc à la
  // même abscisse d'un ack à l'autre — une colonne d'icônes alignée dans un
  // groupe déplié, là où l'ordre inverse la décalait sur les seules lignes
  // porteuses d'un téléchargement. Les trois kinds concernés sont énumérés par
  // `ackDownloadTarget` (utils.js) — prédicat UNIQUE, partagé avec le rendu de
  // la liste de fichiers d'espace ; ne jamais tester `kind` en dur ici.
  // Toujours affiché quand l'ack désigne une ressource : les bytes vivent en
  // IDB, pas dans l'ack, et le cache session peut être froid après un reload —
  // la disponibilité réelle n'est connue qu'au clic (résolution async).
  // Ce bouton est délibérément ABSENT des exports (piège 21) : un HTML
  // standalone n'a ni IDB ni globals MIAOU. Cf. docs/tools.md.
  const dlTarget = ackDownloadTarget(m);
  if (dlTarget) {
    const dl = document.createElement('button');
    dl.className = 'ack-dl';
    dl.innerHTML = ICON_DOWNLOAD;   // SVG statique author-controlled uniquement
    setTip(dl, 'Télécharger');
    dl.addEventListener('click', () => downloadAckResource(dlTarget, dl));
    wrap.appendChild(dl);
  }
  // Inspection du détail de l'appel (lot Z) : arguments, résultat, code. Gated
  // par le prédicat UNIQUE `ackHasInspectableDetail` (utils.js) — jamais un
  // test de kind ici, même doctrine que `ackDownloadTarget` juste en dessous.
  // Un ack legacy (sans args/result/code) n'affiche pas le bouton : rien à
  // montrer, donc pas d'affordance qui ouvrirait un panneau vide.
  //
  // Le listener est posé SUR LE NŒUD, jamais en délégation au niveau du groupe :
  // en mode compact un seul .tool-ack est dans le DOM, les autres sont DÉTACHÉS
  // et ne vivent que comme valeurs de `ackNodeOf` (WeakMap). Une délégation ne
  // verrait jamais les acks masqués — c'est-à-dire précisément les appels
  // intermédiaires d'un enchaînement, le cas d'usage qui a motivé le lot. Les
  // nœuds détachés survivent intacts, listeners compris.
  //
  // La closure capture l'ENTRÉE elle-même, jamais `m.id` : cet id n'est pas
  // unique (un create et un delete du même souvenir le partagent, cf. plus bas).
  // Comme `.ack-dl`, ce bouton est délibérément ABSENT des exports (piège 21) :
  // _formatToolCallHtml construit son markup indépendamment et ne l'émet pas.
  // Ouverture du fil de l'agent (lot suivant X-1e) : gated par le prédicat
  // UNIQUE `ackAgentConvTarget` (utils.js), jamais un test de kind ici — même
  // doctrine que ses deux voisines. Le lien existait DÉJÀ, mais seulement sur
  // le libellé, qu'un ack à `intent` replie dans son détail
  // (`renderIntentTwoLevel`) : il fallait déplier pour l'atteindre. Le bouton
  // le remonte en surface SANS le remplacer — les deux coexistent, un lien
  // dans le texte et une affordance dans la colonne d'icônes.
  //
  // AVANT la loupe, pour ne pas casser l'invariant de colonne posé plus haut :
  // `.ack-inspect` reste en dernière position, donc à la même abscisse d'un ack
  // à l'autre dans un groupe déplié.
  //
  // Comme `.ack-dl` et `.ack-inspect`, ABSENT des exports (piège 21) : un HTML
  // standalone lu hors de l'application n'a aucune conversation où naviguer.
  // _formatToolCallHtml (utils.js) construit son markup indépendamment et ne
  // l'émet pas — vérifié sur la fonction, pas supposé.
  const agentTarget = ackAgentConvTarget(m);
  if (agentTarget) _appendAckOpenAgentBtn(wrap, agentTarget);
  if (ackHasInspectableDetail(m)) _appendAckInspectBtn(wrap, m);
  // Lien d'autorisation (campagne AB) : gated par le prédicat UNIQUE
  // `ackAuthorizationTarget` (utils.js), jamais un test de kind ni de code ici —
  // même doctrine que ses deux voisines au-dessus. Le prédicat re-valide l'URL
  // À CHAQUE AFFICHAGE, ce qui couvre aussi les acks relus depuis le stockage
  // (ou écrits par une version antérieure) : la garde ne serait pas une garde
  // si elle ne s'appliquait qu'aux acks de la session courante.
  //
  // Comme `.ack-dl` et `.ack-inspect`, ABSENT des exports (piège 21) : un HTML
  // standalone n'a ni la fraîcheur ni le contexte pour qu'un lien d'autorisation
  // y ait un sens, et ce serait un lien externe cliquable dans un fichier qui
  // circule. _formatToolCallHtml construit son markup indépendamment et ne
  // l'émet pas — vérifié, pas supposé (cf. tests d'export).
  const authTarget = ackAuthorizationTarget(m, _ackMcpServerUrl(m));
  if (authTarget) _appendAckAuthorizeLink(wrap, authTarget);
  if (spec.undo) {
    if (m.resolved) {
      const s = document.createElement('span');
      s.className = 'ack-resolved';
      s.textContent = 'annulé';
      wrap.appendChild(s);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ack-undo';
      btn.textContent = 'annuler';
      // On passe l'ENTRÉE et le NŒUD exacts : un create et un delete du même
      // souvenir partagent le même m.id, une recherche par id viserait le mauvais.
      btn.addEventListener('click', () => undoToolAck(m, wrap));
      wrap.appendChild(btn);
    }
  }
  // expand : bouton toggle « voir/masquer » pour les ressources stockées. Le
  // contenu est rendu une seule fois (lazy) dans un conteneur inline.
  // ⚠️ DORMANT / NON BRANCHÉ (audit F, 2026-07-10) : aucune entrée d'ACK_KINDS ne
  // définit `expand:` aujourd'hui, donc ce bloc ne s'exécute JAMAIS. Les classes
  // `.ack-expand`/`.ack-expand-content` n'ont d'ailleurs aucun style CSS, et
  // `presentResourceFromChip` (le `spec.expand` attendu) n'est câblé nulle part.
  // Conservé sciemment comme jalon d'une feature « déplier une ressource stockée
  // depuis son ack » à finir. Pour l'activer : poser `expand: presentResourceFromChip`
  // sur l'entrée `resource_stored` d'ACK_KINDS ET styler `.ack-expand*`.
  if (spec.expand && !m.resolved) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'ack-expand';
    expandBtn.textContent = 'voir';
    const content = document.createElement('div');
    content.className = 'ack-expand-content';
    content.hidden = true;
    let rendered = false;
    expandBtn.addEventListener('click', function() {
      content.hidden = !content.hidden;
      expandBtn.textContent = content.hidden ? 'voir' : 'masquer';
      if (!content.hidden && !rendered) {
        rendered = true;
        spec.expand(m, content);   // presentResourceFromChip (défini plus bas)
      }
    });
    wrap.appendChild(expandBtn);
    wrap.appendChild(content);
  }
  return wrap;
}

// Place un ack DANS la bulle assistant, entre l'en-tête (.meta / raisonnement) et
// le corps (.body) : la provenance s'affiche après l'icône+nom du modèle et avant
// le patienteur/la réponse. Si la bulle n'a pas de .body, on append en dernier
// recours. Partagé par le rendu live (onToolAcks/onEarlyAcks) et le reload (renderThread).
// ── Groupe d'acks (ticker) : réducteur d'état pur ──────────────────────────
// Pont entrée d'ack → nœud DOM. WeakMap et NON une propriété `entry.__node` :
// l'objet `entry` est le MÊME que celui poussé dans `currentThread` (main.js,
// onEarlyAcks/onToolAcks) puis persisté par saveConversation — y greffer une
// référence DOM la ferait partir en JSON.stringify (clé parasite au store) et
// surtout retiendrait le nœud en mémoire tant que la conversation vit (fuite).
// La WeakMap garde le lien hors de l'objet persisté et laisse le nœud être GC.
const ackNodeOf = new WeakMap();
// État d'un groupe d'acks contigu dans UNE bulle assistant : { acks, mode,
// slotExpanded }. `acks` = descripteurs d'entrée (mêmes objets que placeToolAck
// reçoit), ordre d'arrivée. `mode` = 'compact'|'list'. `slotExpanded` = détail
// visible dans le slot compact, hérité d'un ack à l'autre (brief §3). Aucune
// mutation en place : chaque action renvoie un nouvel état.
function ackGroupInitState() {
  return { acks: [], mode: 'compact', slotExpanded: false };
}
function ackGroupReduce(state, action) {
  const s = state || ackGroupInitState();
  if (action.type === 'arrive') {
    return { acks: s.acks.concat([action.ack]), mode: s.mode, slotExpanded: s.slotExpanded };
  }
  if (action.type === 'toggleMode') {
    return { acks: s.acks, mode: s.mode === 'compact' ? 'list' : 'compact', slotExpanded: s.slotExpanded };
  }
  if (action.type === 'toggleSlot') {
    return { acks: s.acks, mode: s.mode, slotExpanded: !s.slotExpanded };
  }
  return s;
}
// Seuil de bascule visuelle : compact tant que < 2 acks, le mode ne suffit pas
// (un groupe à 1 ack reste transparent même en mode 'compact').
function ackGroupIsCompact(state) {
  return state.mode === 'compact' && state.acks.length >= 2;
}
function ackGroupCount(state) {
  return state.acks.length;
}
function ackGroupVisibleAck(state) {
  return state.acks.length ? state.acks[state.acks.length - 1] : null;
}

// Résolution pure du booléen reduced-motion effectif : préférence système
// injectée en paramètre (jamais de matchMedia interne — testable QuickJS).
function resolveMotionReduced(setting, systemPrefersReduced) {
  if (setting === 'reduced') return true;
  if (setting === 'normal') return false;
  return !!systemPrefersReduced;
}

// Bascule compact/liste animée SIMULTANÉMENT (retour Julien : un flash de
// groupe vide apparaissait avec un enchaînement séquentiel repli-puis-
// agrandissement). Appelé APRÈS renderAckGroup (contenu déjà correct des DEUX
// côtés — `outgoing` est masqué par `hidden` mais son contenu DOM reste
// intact, cf. renderAckGroup : le mode compact ne vide jamais .ack-list, il
// ne fait que le cacher). `outgoingStart` = hauteur mesurée AVANT le
// re-render (le sortant avait encore son ancien contenu visible à ce moment).
// `height` n'anime pas vers/depuis `auto` : on fixe une valeur px de départ
// des deux côtés, un seul rAF pour poser les cibles, cleanup sur
// transitionend de chaque panneau (indépendants, jamais orphelins).
function animateGroupPanelSwap(outgoing, incoming, outgoingStart) {
  const incomingTarget = incoming.scrollHeight;
  outgoing.hidden = false;   // ré-affiché le temps de l'anim (contenu intact)
  outgoing.style.height = outgoingStart + 'px';
  outgoing.style.overflow = 'hidden';
  outgoing.style.opacity = '1';
  outgoing.classList.add('ack-panel-animating');
  incoming.style.height = '0px';
  incoming.style.overflow = 'hidden';
  incoming.classList.add('ack-panel-animating');
  requestAnimationFrame(() => {
    outgoing.style.height = '0px';
    // Fondu du sortant EN PLUS du rétrécissement (les deux panneaux partagent
    // la même cellule de grille — cf. .ack-panels — donc le sortant restait
    // visible par-dessus le texte entrant jusqu'à la toute fin, superposition
    // signalée par Julien) : à hauteur quasi nulle son contenu ne devrait de
    // toute façon plus être lisible, l'opacité masque le résidu avant ça.
    outgoing.style.opacity = '0';
    incoming.style.height = incomingTarget + 'px';
  });
  const onOutEnd = function(ev) {
    if (ev.target !== outgoing || ev.propertyName !== 'height') return;
    outgoing.removeEventListener('transitionend', onOutEnd);
    outgoing.classList.remove('ack-panel-animating');
    outgoing.style.height = '';
    outgoing.style.overflow = '';
    outgoing.style.opacity = '';
    outgoing.hidden = true;   // reconforme à l'état voulu par renderAckGroup
  };
  const onInEnd = function(ev) {
    if (ev.target !== incoming || ev.propertyName !== 'height') return;
    incoming.removeEventListener('transitionend', onInEnd);
    incoming.classList.remove('ack-panel-animating');
    incoming.style.height = '';
    incoming.style.overflow = '';
  };
  outgoing.addEventListener('transitionend', onOutEnd);
  incoming.addEventListener('transitionend', onInEnd);
}

// ── Groupe d'acks (ticker) : partie DOM ─────────────────────────────────────
// Un groupe par bulle assistant (`wrap._ackGroup`), créé paresseusement au 1er
// ack. Porte l'état pur (ackGroupReduce) + les nœuds DOM. Le wrapper est posé
// dès le 1er ack et reste visuellement transparent tant que count < 2 (PLAN
// étape 4, ambiguïté 4 tranchée : pas de re-parent au franchissement du seuil).
function ensureAckGroup(wrap) {
  if (wrap._ackGroup) return wrap._ackGroup;
  const el = document.createElement('div');
  el.className = 'ack-group';
  const slot = document.createElement('div');
  slot.className = 'ack-slot';
  const track = document.createElement('div');
  track.className = 'ticker-track';
  slot.appendChild(track);
  const list = document.createElement('div');
  list.className = 'ack-list';
  list.hidden = true;
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'ack-badge';
  badge.setAttribute('aria-expanded', 'false');
  badge.hidden = true;   // masqué tant que count < 2 (transparence sous le seuil)
  badge.addEventListener('click', () => {
    // Bascule compact/liste (retour Julien : agrandissement/repli vertical
    // SIMULTANÉS, pas séquentiels — sinon un flash de groupe vide entre le
    // repli du panneau sortant et la réécriture du panneau entrant). On
    // mesure le sortant AVANT toute mutation, on ré-affiche (contenu correct
    // tout de suite, renderAckGroup), on mesure l'entrant maintenant peuplé,
    // puis on anime les deux `height` en parallèle dans le même rAF.
    const outgoing = group.state.mode === 'list' ? group.list : group.slot;
    const animate = !motionReduced() && !outgoing.hidden;
    const outgoingStart = animate ? outgoing.scrollHeight : 0;
    group.state = ackGroupReduce(group.state, { type: 'toggleMode' });
    renderAckGroup(group);
    if (!animate) return;
    const incoming = group.state.mode === 'list' ? group.list : group.slot;
    animateGroupPanelSwap(outgoing, incoming, outgoingStart);
  });
  const panels = document.createElement('div');
  panels.className = 'ack-panels';
  panels.appendChild(slot);
  panels.appendChild(list);
  el.appendChild(panels);
  el.appendChild(badge);
  const body = wrap.querySelector('.body');
  if (body) wrap.insertBefore(el, body);
  else wrap.appendChild(el);
  const group = { state: ackGroupInitState(), el, slot, track, list, badge };
  // Slot-expanded (brief §3) : la ligne intent gère déjà son propre toggle
  // DOM (renderIntentTwoLevel, self-contained) ; on écoute en bulle sur .ack-panels
  // pour resynchroniser l'état de GROUPE — donc l'héritage à l'ack suivant, ET la
  // valeur que renderAckGroup réapplique au retour en compact (applySlotExpanded)
  // — sans toucher à la signature de renderIntentTwoLevel/buildToolAck.
  //
  // Écouter sur `panels` (parent commun) et non sur `slot` seul : en mode liste
  // le nœud visible vit dans `.ack-list`, donc un toggle fait là-bas ne bullait
  // pas jusqu'ici, `slotExpanded` restait périmé, et le retour en compact
  // écrasait l'expand manuel de l'utilisateur (applySlotExpanded réapplique
  // l'état de groupe, source unique). Le filtre reste le nœud de l'ack VISIBLE :
  // toggler un ack plus ancien dans la liste ne concerne pas le slot compact.
  panels.addEventListener('click', (ev) => {
    if (!ev.target.closest('.mcp-intent-row')) return;
    const visible = ackGroupVisibleAck(group.state);
    const visibleNode = visible && ackNodeOf.get(visible);
    if (!visibleNode || !visibleNode.contains(ev.target)) return;
    const detail = visibleNode.querySelector('.mcp-breadcrumb-detail');
    if (!detail) return;
    const nowExpanded = !detail.hasAttribute('hidden');
    if (nowExpanded !== group.state.slotExpanded) {
      group.state = ackGroupReduce(group.state, { type: 'toggleSlot' });
    }
  });
  wrap._ackGroup = group;
  return group;
}

// Ré-affiche l'intégralité du groupe depuis son état (source unique de vérité
// pour le compteur — brief §No silent action). Pas d'animation ici : c'est un
// resync, pas une arrivée (le ticker anime dans addAckAnimated, à part).
function renderAckGroup(group) {
  const count = ackGroupCount(group.state);
  group.el.dataset.count = String(count);
  group.el.dataset.mode = (group.state.mode === 'list' && count >= 2) ? 'list' : 'compact';
  group.badge.hidden = count < 2;
  group.badge.textContent = (group.state.mode === 'list' ? '▴ ' : '') + count + ' étape' + (count > 1 ? 's' : '');
  group.badge.setAttribute('aria-expanded', String(group.state.mode === 'list'));
  const showList = count >= 2 && group.state.mode === 'list';
  group.list.hidden = !showList;
  group.slot.hidden = showList;
  if (showList) {
    // Rebuild depuis l'état (source unique) : un ack a pu arriver pendant que
    // le groupe était en mode compact (donc jamais append à .ack-list), ou le
    // nœud visible a été déplacé dans le track par un précédent rendu compact.
    // ORDRE D'AFFICHAGE, pas l'ordre d'état : `ackDisplayOrder` (utils.js, pure)
    // remet l'ack d'action devant le `resource_stored` que `_storeBlock` a
    // poussé avant lui sur les outils internes. `group.state.acks` reste en
    // ordre d'arrivée — c'est lui que lit `ackGroupVisibleAck` pour le slot
    // compact (l'action, dernière arrivée, doit y rester l'ack visible), et
    // c'est l'ordre du THREAD qui porte la structure de groupe d'
    // `enrichedAckGroups`. Trier la donnée ferait disparaître la réponse du
    // modèle au reload (assistantText n'est relu que sur le premier ack).
    //
    // `appendChild` d'un nœud déjà enfant le DÉPLACE en fin : la garde
    // `parentNode !== group.list` doit donc sauter dès que l'ordre voulu diffère
    // de l'ordre du DOM, sinon un nœud déjà placé ne serait jamais reclassé.
    // On repositionne inconditionnellement, ce qui est idempotent.
    for (const a of ackDisplayOrder(group.state.acks)) {
      const n = ackNodeOf.get(a);
      if (n) group.list.appendChild(n);
    }
  } else {
    // Slot compact (ou transparent sous le seuil) : ne montre que le dernier ack.
    const visible = ackGroupVisibleAck(group.state);
    const visibleNode = visible && ackNodeOf.get(visible);
    group.track.querySelectorAll('.tool-ack').forEach(n => { if (n !== visibleNode) n.remove(); });
    if (visibleNode && !group.track.contains(visibleNode)) {
      group.track.appendChild(visibleNode);
    }
    if (visibleNode) applySlotExpanded(visibleNode, group.state.slotExpanded);
    group.track.style.transform = '';
    group.track.classList.remove('animating');
    group.slot.classList.remove('animating');
    group.slot.style.height = '';
  }
}

// Pré-ouvre/replie le détail d'un nœud .tool-ack déjà construit (héritage
// slot-expanded, brief §3) : ne touche pas à buildToolAck/renderIntentTwoLevel,
// juste l'attribut hidden + la classe .open du chevron.
function applySlotExpanded(node, expanded) {
  const detail = node.querySelector('.mcp-breadcrumb-detail');
  const chevron = node.querySelector('.mcp-chevron');
  if (!detail) return;
  if (expanded) {
    detail.removeAttribute('hidden');
    if (chevron) chevron.classList.add('open');
  } else {
    detail.setAttribute('hidden', '');
    if (chevron) chevron.classList.remove('open');
  }
}

// Ajoute un ack au groupe. `animate` = true en live (arrivée réelle pendant le
// streaming), false au reload (renderThread) — reconstruction, pas arrivée.
function ackGroupAddAck(group, entry, node, animate) {
  ackNodeOf.set(entry, node);   // pont état pur → nœud DOM, hors objet persisté
  const prevVisible = ackGroupVisibleAck(group.state);
  const wasCompact = ackGroupIsCompact(group.state);
  group.state = ackGroupReduce(group.state, { type: 'arrive', ack: entry });
  const nowCompact = ackGroupIsCompact(group.state);
  applySlotExpanded(node, group.state.slotExpanded);

  if (group.state.mode === 'list') {
    group.list.appendChild(node);   // append en bas, sans animation (brief §4)
    renderAckGroup(group);
    return;
  }
  const prevNode = prevVisible && ackNodeOf.get(prevVisible);
  if (!wasCompact || !nowCompact || !animate || !prevNode || motionReduced()) {
    // Pas encore de transition à animer (1er/2e ack, reduced-motion, reload) :
    // dry swap direct.
    renderAckGroup(group);
    return;
  }
  // Arrivée animée en compact : le nœud entrant est déjà en place (empilé sous
  // le sortant dans le track), on measure/translate/cleanup sur transitionend.
  // La hauteur du slot est ÉPINGLÉE en px AVANT l'append puis transitionnée
  // vers celle de l'entrant : sans ça, le slot (height auto) mesurerait
  // sortant+entrant pendant l'anim puis retomberait au retrait du sortant —
  // aller-retour de hauteur qui faisait sautiller l'autoscroll collé en bas.
  // Toutes les mesures sont des hauteurs EXTÉRIEURES : .tool-ack porte des
  // marges verticales (non collapsées dans le track flex) qu'offsetHeight
  // ignore — épingler offsetHeight nu faisait perdre 6px au départ puis les
  // reprenait au cleanup (height:'' → auto), wobble inverse du sautillement.
  // Départ = hauteur auto courante du slot ; cible = boîte de marge de
  // l'entrant ; translation = écart d'offsetTop (exact marges comprises,
  // offsetParent = .ack-slot, position:relative).
  const outgoing = prevNode;
  const hStart = group.slot.offsetHeight;
  group.slot.style.height = hStart + 'px';
  group.track.appendChild(node);
  const dist = node.offsetTop - outgoing.offsetTop;
  const mcs = getComputedStyle(node);
  const hEnd = node.offsetHeight + (parseFloat(mcs.marginTop) || 0) + (parseFloat(mcs.marginBottom) || 0);
  group.slot.classList.add('animating');
  group.track.classList.add('animating');
  group.track.style.transform = 'translateY(-' + dist + 'px)';
  group.slot.style.height = hEnd + 'px';
  const onEnd = function() {
    group.track.removeEventListener('transitionend', onEnd);
    if (outgoing.parentNode === group.track) outgoing.remove();
    group.track.classList.remove('animating');
    group.track.style.transform = '';
    group.slot.classList.remove('animating');
    group.slot.style.height = '';
    renderAckGroup(group);   // resync badge/attrs, ne touche plus au track (déjà propre)
  };
  group.track.addEventListener('transitionend', onEnd, { once: true });
}

function placeToolAck(wrap, entry, animate) {
  const node = buildToolAck(entry);
  if (wrap) {
    const group = ensureAckGroup(wrap);
    ackGroupAddAck(group, entry, node, animate !== false);
  }
  const body = wrap && wrap.querySelector('.body');
  // resource_presented : rend le bloc ressource (toute classe).
  // resource_stored : rend le bloc pour les binaires uniquement (les inline sont
  // stockés en IDB mais non affichés automatiquement) ; en live, _pendingToolBlocks
  // est non vide (binaires) → on laisse placeToolBlocks les rendre, pas de double.
  const kindNow = ackKindOf(entry);
  const needsBlock = kindNow === 'resource_presented' ||
    (kindNow === 'resource_stored' && typeof getPendingToolBlocks === 'function' && getPendingToolBlocks().length === 0);
  if (needsBlock && entry.id && wrap) {
    const record = typeof getCachedRecord === 'function' ? getCachedRecord(entry.id) : null;
    if (record && (kindNow !== 'resource_stored' || record.class !== 'inline')) {
      const block = makeResourcePresentBlock(record);
      const blockNode = block ? renderToolBlock(block) : null;
      if (blockNode) {
        if (body) wrap.insertBefore(blockNode, body);
        else wrap.appendChild(blockNode);
        if (highlightEnabled && window.Prism) Prism.highlightAll();
      }
    }
  }
  // attachment_recalled : idem resource_presented mais lookup par attId
  // (conversation-scoped) — seules les images ont un bloc visuel à rendre ;
  // texte/binaire sont déjà retournés en clair/descripteur au modèle (rien à afficher ici).
  // `ackImageIsDisplayable` (utils.js, pur) est le prédicat PARTAGÉ avec
  // l'export (exportableAckImageKey) : une page de PDF rendue pour le modèle
  // (origin 'docs_render') n'est affichée sur AUCUNE des deux surfaces — l'ack
  // et son bouton de téléchargement suffisent. Jamais un filtre réécrit ici.
  if (kindNow === 'attachment_recalled' && entry.attId && wrap &&
      ackImageIsDisplayable(entry)) {
    const record = typeof getCachedRecordByAttId === 'function' ? getCachedRecordByAttId(entry.attId, entry.convId) : null;
    if (record && record.mime && record.mime.startsWith('image/')) {
      const block = makeResourcePresentBlock(record);
      const blockNode = block ? renderToolBlock(block) : null;
      if (blockNode) {
        if (body) wrap.insertBefore(blockNode, body);
        else wrap.appendChild(blockNode);
      }
    }
  }
  // `animate !== false` distingue déjà un ack QUI ARRIVE d'un ack RE-RENDU :
  // renderThread (reload) et le rebranchement d'écran passent false, les trois
  // chemins live laissent l'argument indéfini. S'appuyer dessus plutôt que
  // d'ajouter un second signal — deux drapeaux pour la même distinction
  // divergeraient. `wrap` null = génération hors écran : rien n'est apparu à
  // l'écran, donc rien à aller voir.
  if (wrap && animate !== false) markThreadContentUnseen();
  return node;
}

// ── Inspecteur d'appel d'outil (lot Z) ───────────────────────────────────────
// Détail complet d'UN appel, ouvert depuis la loupe d'un ack. Les données sont
// déjà persistées sur l'entrée (`args`/`result`/`code`/`ts`/`server`/`intent`,
// ACK_COPY_FIELDS) : rien n'est collecté ici, on ne fait que présenter.
//
// FRONTIÈRE DE SÛRETÉ (piège 21) : tout ce qu'on affiche est d'origine MODÈLE
// ou SERVEUR DISTANT. Ce fichier devient le second chemin string→HTML à risque
// du projet après formatToolAcksHtml. Règle sans exception ici : `textContent`,
// ou `escHtml` dans un <pre>. JAMAIS `renderMd` (qui laisse passer le HTML
// d'origine modèle), jamais d'interpolation en template string.

// Ack couramment affiché — l'ENTRÉE elle-même, jamais un id (non unique).
// Sert au rafraîchissement asynchrone du volet ressource : quand la résolution
// IDB revient, on ne peint que si l'utilisateur regarde toujours le même appel.
let _inspectEntry = null;

function openToolInspector(entry) {
  _inspectEntry = entry || null;
  renderToolInspector(entry);
  $('inspect-drawer').classList.add('show');
  $('inspect-backdrop').classList.add('show');
}

function closeToolInspector() {
  $('inspect-drawer').classList.remove('show');
  $('inspect-backdrop').classList.remove('show');
  _inspectEntry = null;
}

// Re-rend le drawer s'il est ouvert SUR CETTE ENTRÉE, sinon ne fait rien.
// Appelée quand un appel en vol reçoit sa réponse : l'enrichissement est un
// `Object.assign` sur l'entrée que le drawer affiche déjà, donc un simple
// re-rendu suffit à faire apparaître résultat et horodatage — aucun état
// intermédiaire à recoller, `renderToolInspector` reconstruit tout depuis
// l'entrée.
//
// La garde compare l'ENTRÉE (identité d'objet), jamais `m.id` : cet id n'est
// pas unique, et l'utilisateur a pu ouvrir un AUTRE appel pendant le
// round-trip. Même doctrine que la fenêtre d'await du volet ressource
// (`_inspectEntry !== m`) — c'est le même risque, à la même échelle de temps.
//
// Sans elle, le drawer resterait sur « réponse en attente » alors que la
// réponse est arrivée : un état faux affiché à l'écran, que seule une
// réouverture corrigerait.
function refreshToolInspectorIfOpen(entry) {
  if (!entry || _inspectEntry !== entry) return;
  renderToolInspector(entry);
}

// Titre de section d'un volet. Les volets sont EMPILÉS verticalement, jamais
// des onglets (décision d'ouverture) : on lit une fiche d'appel de haut en bas.
function _inspectSection(parent, title) {
  const sec = document.createElement('section');
  sec.className = 'inspect-section';
  const h = document.createElement('h4');
  h.className = 'inspect-section-title';
  h.textContent = title;
  sec.appendChild(h);
  parent.appendChild(sec);
  return sec;
}

// Préfixe de nommage des téléchargements de CE panneau : dernier segment du nom
// d'outil (`splunk__search` → `search`, `miaou__js__eval` → `eval`). UNE seule
// formule, appelée par tous les blocs — sans elle, deux appels d'outils
// différents proposeraient tous deux `query.txt` et se marcheraient dessus dans
// le dossier de téléchargements. Le segment final suffit à discriminer : le
// préfixe de serveur alourdirait le nom sans lever d'ambiguïté réelle.
// Repli sur le kind quand l'ack n'a pas de nom (ack legacy) ; '' si rien.
function _inspectNamePrefix(m) {
  const seg = String((m && m.name) || '').split('__').filter(Boolean).pop();
  return seg || ackKindOf(m) || '';
}

// Compose le nom d'un bloc : `<préfixe>-<quoi>`, ou `<quoi>` nu si l'ack ne
// donne aucun préfixe. Jamais de concaténation à la main sur un site d'appel.
function _inspectBlockName(m, what) {
  const p = _inspectNamePrefix(m);
  return p ? p + '-' + what : what;
}

// Bloc de code : <pre><code class="language-…">. `textContent` pose le texte —
// donc AUCUN parsing HTML, la frontière la plus stricte possible. Prism
// réécrit ensuite le contenu en spans à partir de ce texte déjà neutralisé.
// `decoratePre` ajoute copier/télécharger, et pour html/svg le bouton d'aperçu
// sandboxé (iframe sans allow-same-origin, piège 23 — chemin existant, aucune
// seconde voie de rendu ouverte ici).
// `name` (optionnel) alimente le `data-filename` que `decoratePre` lit pour
// nommer le téléchargement du bloc : sans lui, tout snippet sort en
// « miaou-snippet.<ext> », y compris quand on sait très bien ce qu'il est (le
// paramètre `query` d'un appel, le fichier `resultat.json` d'une ressource).
// Le nom traverse `sanitizeDownloadName` chez decoratePre — il peut donc venir
// du modèle sans précaution supplémentaire ici.
function _inspectCodeBlock(parent, text, lang, name) {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'language-' + (lang || 'text');
  if (name) code.setAttribute('data-filename', name);
  code.textContent = text == null ? '' : String(text);
  pre.appendChild(code);
  parent.appendChild(pre);
  decoratePre(parent);
  // Grammaire chargée à la demande PUIS colorisation : un callback sur
  // highlightElement ne suffit pas (cf. ensurePrismGrammar).
  if (typeof ensurePrismGrammar === 'function') {
    ensurePrismGrammar(lang).then(() => highlightUnder(parent)).catch(() => {});
  } else {
    highlightUnder(parent);
  }
  return pre;
}

// Ligne « clé : valeur » d'un volet. Une valeur MULTILIGNE passe en bloc plein
// format (inspectValueShape) : une requête SPL ou un JSON collé en argument est
// illisible replié sur une ligne.
function _inspectField(parent, key, value, m) {
  const shape = inspectValueShape(value);
  const row = document.createElement('div');
  row.className = 'inspect-field';
  const k = document.createElement('span');
  k.className = 'inspect-key';
  k.textContent = key;
  row.appendChild(k);
  if (shape.mode === 'inline') {
    const v = document.createElement('span');
    v.className = 'inspect-val';
    v.textContent = shape.text;
    row.appendChild(v);
    parent.appendChild(row);
  } else {
    parent.appendChild(row);
    // Nom du bloc = clé du paramètre, préfixée de l'outil (`search-query.txt`) :
    // la clé dit ce que c'est, le préfixe dit d'où ça vient. L'extension est
    // dérivée de la langue par decoratePre.
    _inspectCodeBlock(parent, shape.text, shape.lang, _inspectBlockName(m, key));
  }
  // Renvoie la ligne : `_inspectResourcePanel` en réserve certaines pour les
  // remplir après résolution du record (lot Z-2).
  return row;
}

// Réécrit la valeur d'une ligne posée par `_inspectField`. `textContent`, jamais
// d'HTML : la valeur vient d'un record d'origine modèle/serveur (piège 21).
// Sans effet si la ligne n'a pas de valeur inline (cas bloc).
function _inspectFieldSetValue(row, text) {
  const v = row && row.querySelector('.inspect-val');
  if (v) v.textContent = String(text);
}

// Volet « ressource » : ce qu'un ack désigne au-delà de son texte aplati. Le
// `result` ne porte que le texte (flattenToolResult) ; les blocs non-texte ont
// été internés en ressource IDB, et c'est `ackDownloadTarget` qui sait laquelle.
//
// Deux temps, délibérément : on peint TOUT DE SUITE ce que l'ack sait déjà
// (nom, id, mime, taille) puis on enrichit quand le record est résolu. Les
// octets vivent en IDB et le cache session peut être froid après un reload :
// bloquer l'ouverture du drawer sur un await ferait payer la latence à chaque
// consultation, y compris celles qui ne regardent que les arguments.
function _inspectResourcePanel(parent, m, target) {
  const sec = _inspectSection(parent, 'Ressource');
  // Valeurs de l'ack : disponibles sans I/O, mais ce sont des COPIES, prises au
  // moment de l'ack. Le record fait foi dès qu'il arrive (cf. plus bas).
  // Les champs de l'ACK ne sont une copie que pour les kinds `resource_*`. Un
  // `mcp_call` désignant une ressource par `[resource_ref:…]` (lot Z-2) n'a ni
  // nom, ni mime, ni taille : le volet n'afficherait qu'un identifiant nu, là
  // où le fil annonce « photo-labrador.png (1.5 MB) ». Les lignes manquantes
  // sont donc RÉSERVÉES ici, à leur place définitive, et remplies à la
  // résolution du record — qui les a, et qui fait foi de toute façon. Les créer
  // dans le `.then` les rejetterait toutes en fin de volet, derrière
  // l'identifiant, alors que le nom est ce qu'on lit en premier.
  const late = {};
  const name = m.resourceName || target.name || '';
  if (name) _inspectField(sec, 'nom', name, m);
  else late.nom = _inspectField(sec, 'nom', '…', m);
  _inspectField(sec, 'identifiant', target.by === 'resource' ? target.id : target.attId, m);
  if (m.mime) _inspectField(sec, 'type', m.mime, m);
  else late.type = _inspectField(sec, 'type', '…', m);
  if (m.size != null) _inspectField(sec, 'taille', humanSize(m.size), m);
  else late.taille = _inspectField(sec, 'taille', '…', m);

  const dl = document.createElement('button');
  dl.className = 'drawer-btn inspect-dl';
  dl.textContent = 'Télécharger';
  // Réutilise le chemin de téléchargement des acks : cache→IDB, nommage par
  // `resourceDownloadName` (assainissement PUIS extension depuis le mime), et
  // `markAckDlUnavailable` si le record a disparu. Rien de dupliqué ici.
  dl.addEventListener('click', () => downloadAckResource(target, dl));
  sec.appendChild(dl);

  const preview = document.createElement('div');
  preview.className = 'inspect-preview';
  sec.appendChild(preview);

  _inspectResolveRecord(target).then(record => {
    // Fenêtre d'await : l'utilisateur a pu fermer le drawer ou ouvrir un AUTRE
    // appel pendant la résolution. On compare l'ENTRÉE (identité d'objet), pas
    // un id — deux acks peuvent partager le même `m.id`.
    if (_inspectEntry !== m) return;
    if (!record || !record.data) {
      const gone = document.createElement('p');
      gone.className = 'inspect-empty';
      gone.textContent = 'Contenu non disponible dans ce navigateur (ressource purgée ou produite ailleurs).';
      preview.appendChild(gone);
      return;
    }
    // Le record est figé au stockage ; l'ack en est une copie potentiellement
    // plus ancienne. Même doctrine que downloadAckResource : le record prime.
    const mime = record.mime || m.mime || '';
    const size = record.size != null ? record.size
      : (record.data && record.data.byteLength != null ? record.data.byteLength : m.size);
    // Remplissage des lignes réservées : le record fait foi.
    if (late.nom) _inspectFieldSetValue(late.nom, record.name || '(sans nom)');
    if (late.type) _inspectFieldSetValue(late.type, mime || '(inconnu)');
    if (late.taille) _inspectFieldSetValue(late.taille, size != null ? humanSize(size) : '(inconnue)');
    const p = inspectResourcePresentation(mime, size);
    if (p.mode === 'thumbnail') {
      _inspectThumbnail(preview, record);
      return;
    }
    if (p.mode === 'descriptor') {
      const note = document.createElement('p');
      note.className = 'inspect-empty';
      // Refus EXPLICITE au-delà du cap, jamais un extrait qui se ferait passer
      // pour le tout : c'est exactement le défaut de l'export tronqué que cet
      // inspecteur existe pour corriger.
      note.textContent = (p.reason === 'too-big')
        ? 'Ressource trop volumineuse pour être prévisualisée (' + humanSize(size) +
          ') — utilise le téléchargement.'
        : 'Contenu binaire : pas de prévisualisation, téléchargement disponible.';
      preview.appendChild(note);
      return;
    }
    // Textuel (JSON, CSV, texte…) ou SVG. Le SVG passe par le MÊME chemin : sa
    // source est colorisée, et `decoratePre` y ajoute de lui-même le bouton
    // d'aperçu (langue `svg`), qui rend dans l'iframe sandbox — les deux
    // façons demandées, sans seconde voie de rendu.
    let text;
    try { text = utf8Decode(record.data); }
    catch (e) { text = null; }
    if (text == null) {
      const bad = document.createElement('p');
      bad.className = 'inspect-empty';
      bad.textContent = 'Contenu illisible en texte — téléchargement disponible.';
      preview.appendChild(bad);
      return;
    }
    // Un JSON stocké en ressource mérite la même mise en forme qu'un résultat
    // JSON : ré-indenté s'il parse, brut sinon.
    const shaped = (p.lang === 'json') ? inspectResultShape(text) : { text, lang: p.lang };
    // Une ressource a un vrai nom (figé au stockage) : c'est LUI qu'on propose,
    // pas un nom dérivé de l'appel — il est déjà spécifique et porte son
    // extension, le préfixer n'ajouterait rien. Le repli, lui, se préfixe comme
    // les autres blocs.
    _inspectCodeBlock(preview, shaped.text, shaped.lang,
      record.name || name || _inspectBlockName(m, 'ressource'));
  }).catch(() => { /* résolution ratée : le descripteur et le bouton restent */ });
}

// Résolution du record désigné, par la clé de SA famille : un id de ressource
// IDB et un attId scopé conversation ne se résolvent pas dans le même store —
// les aplatir ferait interroger le mauvais.
function _inspectResolveRecord(target) {
  if (target.by === 'attachment') {
    return Promise.resolve(
      typeof getCachedRecordByAttId === 'function'
        ? getCachedRecordByAttId(target.attId, target.convId) : null);
  }
  const cached = (typeof getCachedRecord === 'function' && getCachedRecord(target.id)) || null;
  if (cached) return Promise.resolve(cached);
  return getResource(target.id).catch(() => null);
}

// Vignette d'une image bitmap, cliquable vers la lightbox plein écran (même
// chemin que les images du fil : openLightboxWith, singleton à init paresseuse).
function _inspectThumbnail(parent, record) {
  const img = document.createElement('img');
  img.className = 'inspect-thumb';
  img.src = 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data);
  img.alt = record.name || 'ressource image';
  setTip(img, 'Agrandir');   // après l'alt : c'est lui qui nomme l'image
  img.addEventListener('click', () => {
    const full = document.createElement('img');
    full.src = img.src;
    // Dimensions RÉELLES de l'image avant celles du record : `openLightboxWith`
    // pose une boîte de taille fixe que le contenu remplit, donc un w/h faux
    // ÉTIRE l'image (la vignette, elle, n'impose rien et reste juste — c'est ce
    // qui rend l'écart visible au clic seulement).
    // Les champs `w`/`h` ne sont pas universels : ils sont figés au stockage
    // pour une pièce jointe, mais un binaire interné depuis un résultat d'outil
    // (`_storeBlock` via `[resource_ref:…]`, lot Z-2) n'en a pas — on retombait
    // alors sur le repli 800×600, un ratio arbitraire.
    // `naturalWidth`/`naturalHeight` sont disponibles sans attendre : la
    // vignette est chargée, c'est ce clic qui le prouve. Le repli du record
    // reste derrière pour un cas où l'image ne serait pas décodable.
    const w = img.naturalWidth || record.w || 800;
    const h = img.naturalHeight || record.h || 600;
    openLightboxWith(full, w, h, record.name || '', 'image');
  });
  parent.appendChild(img);
}

function renderToolInspector(m) {
  const body = $('inspect-body');
  if (!body) return;
  body.textContent = '';
  if (!m) return;

  // ── En-tête : breadcrumb du nom d'outil + intention déclarée ──────────────
  // `appendAckSep` est le séparateur › du projet, explicitement générique et
  // non réservé au MCP : on le réutilise plutôt que de recoder un chevron.
  const head = document.createElement('div');
  head.className = 'inspect-head';
  const crumb = document.createElement('div');
  crumb.className = 'inspect-crumb';
  const segs = String(m.name || '').split('__').filter(Boolean);
  if (segs.length) {
    segs.forEach((seg, i) => {
      if (i > 0) appendAckSep(crumb);
      const c = document.createElement('code');
      c.textContent = seg;
      crumb.appendChild(c);
    });
  } else {
    crumb.textContent = ackKindOf(m) || 'appel';
  }
  head.appendChild(crumb);
  if (ackIsError(m)) {
    const bad = document.createElement('span');
    bad.className = 'inspect-badge-error';
    bad.textContent = 'en échec';
    head.appendChild(bad);
  }
  body.appendChild(head);
  if (m.intent) {
    const it = document.createElement('p');
    it.className = 'inspect-intent';
    it.textContent = m.intent;
    body.appendChild(it);
  }

  // ── Requête ───────────────────────────────────────────────────────────────
  const req = _inspectSection(body, 'Requête');
  // Le code js__eval en JavaScript colorisé, jamais en string JSON : c'est le
  // cas qui a motivé le lot.
  if (m.code != null) _inspectCodeBlock(req, m.code, 'javascript', _inspectBlockName(m, 'code'));
  if (m.args != null && typeof m.args === 'object') {
    const keys = Object.keys(m.args);
    if (!keys.length) {
      const none = document.createElement('p');
      none.className = 'inspect-empty';
      none.textContent = 'Aucun argument.';
      req.appendChild(none);
    }
    // `miaou_intent` est déjà affiché en tête (il est strippé des args envoyés
    // au serveur, mais reste dans l'objet enrichi) : ne pas le répéter ici.
    // `code` non plus, déjà rendu en bloc juste au-dessus.
    keys.forEach(k => {
      if (k === 'miaou_intent' && m.intent) return;
      if (k === 'code' && m.code != null) return;
      _inspectField(req, k, m.args[k], m);
    });
  } else if (m.args != null) {
    _inspectField(req, 'arguments', m.args, m);
  } else if (m.code == null) {
    const none = document.createElement('p');
    none.className = 'inspect-empty';
    // Un appel EN VOL porte ses `args` depuis l'émission (markEarlyAckPending) :
    // arriver ici avec `pending` signifie donc un appel réellement sans
    // arguments, pas un appel dont ils ne seraient « pas encore » là. Ne pas
    // rétablir de formulation d'attente ici : elle serait fausse.
    none.textContent = 'Aucun argument enregistré pour cet appel.';
    req.appendChild(none);
  }

  // ── Réponse ───────────────────────────────────────────────────────────────
  const res = _inspectSection(body, 'Réponse');
  if (m.result != null) {
    // Détacher d'abord la note de présentation que MIAOU a concaténée pour le
    // modèle : elle n'est pas la réponse de l'outil, et la laisser empêcherait
    // inspectResultShape de reconnaître un JSON (cf. splitToolResultNote).
    const split = splitToolResultNote(m.result);
    const shape = inspectResultShape(split.text);
    if (shape.text === '') {
      const empty = document.createElement('p');
      empty.className = 'inspect-empty';
      empty.textContent = 'Réponse vide.';
      res.appendChild(empty);
    } else {
      // Marqueurs de ressource détachés du corps (splitResultResourceMarkers) :
      // ils sont CONSERVÉS — l'inspecteur montre ce que l'outil a littéralement
      // renvoyé — mais rendus à part, en `.inspect-ref`, et jamais en <pre>. Un
      // bloc de code à en-tête de langue et boutons copier/télécharger pour un
      // identifiant donne à un marqueur le poids visuel d'un contenu, alors que
      // le contenu est juste en dessous, dans son volet. Registre du fil, qui
      // affiche « Ressource enregistrée › nom » et non le marqueur.
      //
      // La prose qui les entoure, elle, reste rendue normalement : un serveur
      // MCP peut écrire une vraie phrase avant son descripteur, et c'est bien
      // la réponse de l'outil. Séparer les deux évite que la seule présence
      // d'un marqueur décide du format du reste (ou l'inverse).
      const split2 = splitResultResourceMarkers(shape.text);
      if (split2.body) {
        // Re-typer le corps amputé : retirer un marqueur peut rendre au JSON sa
        // forme parsable (ou la lui retirer), et garder la `lang` calculée avant
        // la scission colorierait le mauvais langage.
        const bodyShape = inspectResultShape(split2.body);
        // Même doctrine que les arguments de la Requête (`inspectValueShape`) :
        // ce qui tient sur UNE ligne se lit en ligne. Un <pre> à en-tête de
        // langue, hauteur bornée et boutons copier/télécharger autour d'une
        // phrase unique est plus de chrome que de contenu — et la coloration
        // syntaxique n'a rien à colorer sur de la prose. Le seuil est le saut
        // de ligne, pas une longueur : une chaîne longue mais monoligne ne
        // gagne rien à être encadrée, et le drawer sait déjà la faire passer
        // à la ligne (overflow-wrap).
        if (bodyShape.text.indexOf('\n') < 0) {
          const line = document.createElement('p');
          line.className = 'inspect-line';
          line.textContent = bodyShape.text;
          res.appendChild(line);
        } else {
          _inspectCodeBlock(res, bodyShape.text, bodyShape.lang, _inspectBlockName(m, 'resultat'));
        }
      }
      split2.markers.forEach(mk => {
        const ref = document.createElement('p');
        ref.className = 'inspect-ref';
        ref.textContent = mk;
        res.appendChild(ref);
      });
    }
    // Note SOUS le bloc : elle commente ce qui précède, et la placer au-dessus
    // repousserait le contenu — qui est ce qu'on vient inspecter.
    if (split.note) {
      const n = document.createElement('p');
      n.className = 'inspect-note';
      n.textContent = split.note;
      res.appendChild(n);
    }
  } else if (m.pending === true) {
    // Appel parti, réponse pas encore revenue. Distinct du cas suivant, et la
    // distinction est tout l'objet du drapeau : « pas encore » et « jamais »
    // sont le même objet sans `result`, et les confondre ferait lire un appel
    // en cours comme un ack legacy sans rien à montrer.
    const wait = document.createElement('p');
    wait.className = 'inspect-pending';
    wait.textContent = 'Réponse en attente…';
    res.appendChild(wait);
  } else {
    const none = document.createElement('p');
    none.className = 'inspect-empty';
    none.textContent = 'Aucun résultat enregistré pour cet appel.';
    res.appendChild(none);
  }

  // ── Ressource(s) désignée(s) par l'ack ────────────────────────────────────
  // Désignation par `ackInspectResourceTargets` (utils.js) : les kinds
  // `resource_*` via `ackDownloadTarget`, ET les `[resource_ref:…]` du résultat
  // d'un `mcp_call` — sans quoi l'inspecteur d'un appel ayant produit une image
  // n'en montrait que la référence. Jamais une liste de kinds réécrite ici.
  // Toutes les cibles, dans l'ordre : n'en peindre qu'une masquerait les
  // suivantes en silence.
  ackInspectResourceTargets(m).forEach(t => _inspectResourcePanel(body, m, t));

  // ── Méta ──────────────────────────────────────────────────────────────────
  const meta = _inspectSection(body, 'Méta');
  if (m.name) _inspectField(meta, 'outil', m.name, m);
  if (m.server) _inspectField(meta, 'serveur', m.server, m);
  const kind = ackKindOf(m);
  if (kind) _inspectField(meta, 'type', kind, m);
  if (m.ts) {
    _inspectField(meta, 'horodatage',
      new Date(m.ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }), m);
  }
  // « succès » est une CONCLUSION, qu'un appel encore en vol n'autorise pas :
  // `ackIsError` répond faux par défaut, donc sans ce cas l'inspecteur
  // affirmait le succès d'un appel dont rien n'était revenu.
  _inspectField(meta, 'issue',
    m.pending === true ? 'en cours' : (ackIsError(m) ? 'échec' : 'succès'), m);
}

// Enregistrement dans la pile des drawers (trackDrawer, ui.js — les autres
// drawers y sont enregistrés en bloc, juste après sa définition). `trackDrawer` transmet les arguments,
// donc `openToolInspector(entry)` garde sa signature. Sans cette registration,
// Escape fermerait le drawer du dessous et laisserait celui-ci ouvert.
const _tInspect = trackDrawer(openToolInspector, closeToolInspector);
openToolInspector = _tInspect.open; closeToolInspector = _tInspect.close;

// ── Cascade de rendu des blocs NON-text d'un résultat d'outil distant ────
// Placés DANS la bulle assistant, avant le corps (comme les acks). Éphémères :
// jamais persistés, disparaissent au reload. DOM-safe : textContent ou
// attributs (img src en data-URI) ; aucun markup modèle injecté en innerHTML.
function placeToolBlocks(wrap, blocks) {
  const body = wrap && wrap.querySelector('.body');
  let placed = 0;
  for (const b of (blocks || [])) {
    const node = renderToolBlock(b);
    if (!node) continue;
    if (body) wrap.insertBefore(node, body);
    else if (wrap) wrap.appendChild(node);
    placed++;
  }
  // Blocs non-text d'un outil distant (image, ressource) : purement éphémères,
  // donc jamais re-rendus — pas de distinction live/reload à faire ici. On
  // compte les blocs RÉELLEMENT insérés : renderToolBlock peut tout refuser,
  // auquel cas rien n'est apparu.
  if (wrap && placed) markThreadContentUnseen();
}

function renderToolBlock(block) {
  const box = document.createElement('div');
  box.className = 'tool-block';
  // 1. image base64 → <img> data-URI (DOM-safe, aucun markup injecté).
  if (block && block.type === 'image' && block.data) {
    const img = document.createElement('img');
    img.className = 'tool-block-img';
    img.src = 'data:' + (block.mimeType || 'image/png') + ';base64,' + block.data;
    img.alt = 'Image renvoyée par un outil';
    setTip(img, 'Agrandir');   // après l'alt : c'est lui qui nomme l'image
    // A3-2 : closure directe (élément créé par createElement) — pas de
    // handler global nécessaire, contrairement aux chips (onclick inline).
    img.onclick = () => openToolImageLightbox(img);
    box.appendChild(img);
    return box;
  }
  // 2. resource avec blob image → <img> inline (miroir de makeResourcePresentBlock).
  const r = block && block.resource;
  if (block && block.type === 'resource' && r) {
    if (r.blob != null && r.mimeType && r.mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'tool-block-img';
      img.src = 'data:' + r.mimeType + ';base64,' + r.blob;
      img.alt = 'Image renvoyée par un outil';
      setTip(img, 'Agrandir');
      img.onclick = () => openToolImageLightbox(img);
      box.appendChild(img);
      return box;
    }
    // 3. resource text-like → bloc de code surligné (Prism lazy), via textContent.
    if (r.text != null) return renderResourceText(box, r);
  }
  // 4. binaire / inconnu → téléchargement éphémère (rien n'est persisté).
  return renderBinaryBlock(box, block);
}

function renderResourceText(box, resource) {
  box.classList.add('tool-block-code');   // conteneur pleine largeur → rendu identique au bloc assistant
  const lang = mimeToLang(resource.mimeType);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  if (lang) code.className = 'language-' + lang;
  code.textContent = String(resource.text);   // frontière XSS : jamais innerHTML
  // Nom proposé au téléchargement : le bloc est construit par MIAOU (pas une
  // fence du modèle), donc `filename=` n'existe pas — on pose nous-mêmes le
  // data-filename que decoratePre lira, dérivé du nom de la ressource et de son
  // mime via le nommeur PARTAGÉ resourceDownloadName (mêmes règles que le
  // téléchargement d'une ressource depuis son ack : un seul jeu de règles de
  // nommage, jamais deux). Sans lui, decoratePre retombait sur
  // « miaou-snippet.txt », qui perd et le nom et l'extension.
  const dlName = resourceDownloadName(resource.uri, resource.mimeType);
  if (dlName) code.setAttribute('data-filename', dlName);
  pre.appendChild(code);
  box.appendChild(pre);
  // Même chrome que les blocs de code des messages assistant : on construit le
  // <pre><code> à la main (pas de markdown ici), puis on le confie aux DEUX helpers
  // partagés — decoratePre (header + boutons copier/télécharger) et highlightUnder
  // (Prism, garde highlightEnabled incluse). Aucun wrapper réinventé, aucun 3e chemin.
  decoratePre(box);
  highlightUnder(box);
  return box;
}

function renderBinaryBlock(box, block) {
  const b64 = (block && (block.data || (block.resource && block.resource.blob))) || '';
  const mime = (block && (block.mimeType || (block.resource && block.resource.mimeType))) || 'application/octet-stream';
  const uri = (block && block.resource && block.resource.uri) || '';
  const fname = ((uri.split('/').pop() || '').split('?')[0]) || 'piece-jointe';
  box.classList.add('tool-block-binary');
  const label = document.createElement('span');
  label.className = 'tool-block-label';
  // Taille : le `size` du record IDB quand le bloc en vient (makeResourcePresentBlock
  // le transporte) — c'est la taille RÉELLE, déjà connue, qu'il serait absurde de
  // redériver. Repli sur la charge base64 (base64ByteLength, utils.js — calcul par
  // la longueur, sans décoder) pour les blocs qui n'ont pas de record derrière eux :
  // ceux d'un outil MCP DISTANT, arrivés par `_pendingToolBlocks`, éphémères et
  // jamais persistés. Omise si elle vaut 0 — une pièce jointe vide est soit un
  // bloc malformé, soit une charge qu'on n'a pas su lire, et « (0 o) »
  // affirmerait un fait qu'on n'a pas mesuré.
  const declaredSize = block && block.resource && block.resource.size;
  const bytes = Number(declaredSize) > 0 ? Number(declaredSize)
    : (typeof base64ByteLength === 'function' ? base64ByteLength(b64) : 0);
  const sizePart = bytes > 0 ? ', ' + humanSize(bytes) : '';
  // Libellé composé en NŒUDS et non en une chaîne unique : le nom du fichier est
  // mis en gras, le reste (préfixe, mime, taille) garde son poids normal. Chaque
  // fragment reste posé en textContent — `fname` dérive d'une URI d'origine
  // modèle ou serveur, et un `innerHTML` en ferait une voie d'injection là où le
  // fichier n'en est jamais une.
  label.appendChild(document.createTextNode('Pièce jointe : '));
  const nameEl = document.createElement('strong');
  nameEl.className = 'tool-block-name';
  nameEl.textContent = fname;
  label.appendChild(nameEl);
  label.appendChild(document.createTextNode(' (' + mime + sizePart + ')'));
  const btn = document.createElement('button');
  btn.className = 'tool-block-dl';
  btn.textContent = 'Télécharger';
  btn.addEventListener('click', () => {
    try { downloadFile(fname, b64ToBytes(b64), mime); }   // Blob éphémère, rien persisté
    catch (e) { /* base64 invalide : rien à offrir */ }
  });
  box.appendChild(label);
  box.appendChild(btn);
  return box;
}

// Présente une ressource IDB inline dans un conteneur DOM (chip expand ou autre).
// getCachedRecord / makeResourcePresentBlock viennent de resources.js (chargé avant).
// ⚠️ DORMANT / NON APPELÉE (audit F, 2026-07-10) : destinée à être le `spec.expand`
// du bloc expand de buildToolAck (cf. commentaire là-bas), mais aucune entrée
// d'ACK_KINDS ne pose `expand:` → jamais invoquée. Conservée comme jalon, pas du code actif.
function presentResourceFromChip(id, containerEl) {
  const record = getCachedRecord(id);
  if (!record) {
    const span = document.createElement('span');
    span.textContent = 'Ressource non disponible.';
    containerEl.appendChild(span);
    return;
  }
  const block = makeResourcePresentBlock(record);
  if (!block) return;
  const node = renderToolBlock(block);
  if (node) {
    containerEl.appendChild(node);
    if (highlightEnabled && window.Prism) Prism.highlightAll();
  }
}

function mimeToLang(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('json') >= 0) return 'json';
  if (m.indexOf('javascript') >= 0) return 'javascript';
  if (m.indexOf('html') >= 0) return 'html';
  if (m.indexOf('css') >= 0) return 'css';
  if (m.indexOf('xml') >= 0) return 'xml';
  if (m.indexOf('yaml') >= 0 || m.indexOf('yml') >= 0) return 'yaml';
  if (m.indexOf('markdown') >= 0) return 'markdown';
  if (m.indexOf('python') >= 0) return 'python';
  if (m.indexOf('csv') >= 0) return 'csv';
  return '';
}
