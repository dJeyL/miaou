// ── Synchro multi-onglets : couche applicative (lot J) ──────────────────────
// Sortie de main.js le 2026-09-25. sync.js porte le noyau pur (enveloppe,
// routeMessage, storageEventDecision) et l'adaptateur BroadcastChannel ; ce
// fichier porte ce qui APPLIQUE : réception (handleSyncMessage →
// applySyncDecision), file différée pendant une génération locale, soft-lock,
// relais readonly et heartbeat. Le branchement du canal reste dans init()
// (main.js). Cf. docs/multitab-sync.md.

// ── Réception synchro multi-onglets (lot J, réception) ──────────────────────────────
// Câblé via syncOnMessage(handleSyncMessage) dans init(). L'enveloppe est déjà
// VALIDÉE (validateEnvelope, sync.js) ; on décide l'effet via routeMessage (pur)
// puis on l'applique ici (couche impure : DOM, caches, re-render).
//
// Herméticité de Space (piège 18) : routeMessage présélectionne « conv affichée ? »
// mais l'appartenance au Space actif est tranchée ICI, via spaceConvIds — un
// re-render de liste sur une conv d'un autre Space que l'actif ne doit rien
// changer de visible (renderConvList est déjà scopé Space, mais on évite le
// travail inutile). La conv AFFICHÉE, elle, est par construction dans le Space
// actif (on ne peut afficher qu'une conv du Space courant).
//
// Queue pendant génération locale (brief §4.3, piège documenté) : re-hydrater la
// conv affichée pendant qu'une génération locale mute currentThread l'écraserait.
// On diffère alors l'action ; drainPendingSync() la rejoue à la fin de la
// DERNIÈRE génération en vol (unregisterGeneration, T-1a — plus setSending).

let _pendingSyncActions = [];   // actions différées (re-hydratation) pendant une génération locale

// ── Soft-lock : awareness « même conv ouverte ailleurs » ────────────────
// _peersOnConv = tabIds des AUTRES onglets tenant la conv actuellement affichée.
// _peersGenerating = sous-ensemble en train de générer (readonly). Le bandeau
// soft-lock est visible tant que _peersOnConv est non vide ; le readonly
// prime sur le soft-lock quand _peersGenerating est non vide. Les deux sets sont
// vidés à chaque changement de conv affichée (openConversation/resetToEmpty).
let _peersOnConv = new Set();
let _peersGenerating = new Set();   // tabIds générant sur la conv affichée (readonly)
let _peerHeartbeatAt = {};          // tabId → epoch ms du dernier heartbeat reçu (TTL)
let _peerTtlSweeper = null;         // timer de balayage TTL (auto-release si crash émetteur)

// Émet conv-opened pour la conv que cet onglet vient d'afficher. Les pairs qui
// affichent la même conv se signalent en retour (handshake borné, cf. récepteur).
function announceConvOpened(convId) {
  if (convId != null) syncPost('conv-opened', { convId: convId, tabId: syncTabId() });
}
// Émet conv-closed pour la conv que cet onglet quitte (best-effort).
function announceConvClosed(convId) {
  if (convId != null) syncPost('conv-closed', { convId: convId, tabId: syncTabId() });
}
// Réinitialise l'état de peering au changement de conv affichée : on ne tient
// plus l'ancienne, on repart d'un set vide pour la nouvelle (les pairs se
// re-signaleront via le handshake déclenché par notre conv-opened).
function resetPeerState() {
  _peersOnConv = new Set();
  _peersGenerating = new Set();
  _peerHeartbeatAt = {};
  if (_peerTtlSweeper) { clearInterval(_peerTtlSweeper); _peerTtlSweeper = null; }
  refreshTabBanner();
  applyReadonlyState();
}
// Recalcule le bandeau à partir des deux sets. Readonly prime sur soft-lock.
// Une base mise à niveau par un autre onglet (`_dbSuperseded`, storage.js)
// prime sur tout : cet onglet ne peut plus rien écrire, et c'est le seul
// geste qui le répare. Ce bandeau est le seul écrivain de #tab-banner, donc
// la priorité posée ICI tient contre les re-calculs du peering.
function refreshTabBanner() {
  if (_dbSuperseded) {
    setTabBanner('Une version plus récente de MIAOU est ouverte dans un autre onglet — recharger celui-ci pour continuer.');
  } else if (_peersGenerating.size > 0) {
    setTabBanner('Réponse en cours dans un autre onglet — lecture seule.');
  } else if (_peersOnConv.size > 0) {
    setTabBanner('Cette conversation est aussi ouverte dans un autre onglet.');
  } else {
    clearTabBanner();
  }
}

// Active/désactive le readonly de l'UI. DEUX causes, composées ici et nulle part
// ailleurs (X-1e) — c'est la discipline de refreshTabBanner juste au-dessus, et
// pour la même raison : `setConvReadonly` est un setter booléen, deux appelants
// qui poseraient chacun leur cause se marcheraient dessus (le sweeper TTL qui
// libère un pair rouvrirait le composer d'un agent terminé).
//
//  (a) Un pair génère sur la conv affichée (readonly) : on désactive les entrées et
//      mutations locales pour éviter une seconde génération concurrente
//      silencieuse. Cause TEMPORAIRE, levée à la fin de la génération du pair.
//  (b) La conv affichée est un agent qui a fini (X-1e) : son résultat est déjà
//      remonté au parent, et le parent a repris sa route. Un message envoyé ici
//      partirait dans un fil que plus personne ne lit — ni le parent, qui a
//      déjà reçu son compte rendu, ni l'utilisateur, qui croirait relancer
//      l'agent. Cause DÉFINITIVE : un agent ne repart jamais.
//  (c) Une COMPACTION LOCALE tourne sur la conv affichée (lot AE, étape 8).
//      Cause temporaire comme (a), mais elle vient de CET onglet, et c'est ce
//      qui la rend nécessaire : (a) ne regarde que `_peersGenerating`, donc
//      l'onglet d'où part le geste n'était couvert par personne. Une génération
//      locale ORDINAIRE n'a pas besoin de ce verrou — `setSending(true)` met
//      déjà le composer en mode stop et retire « régénérer » ; une compaction,
//      elle, n'appelle jamais `setSending` (le bouton stop n'interromprait
//      rien, cf. l'exemption d'`abortStream`), donc rien ne la bordait
//      localement. Sans (c), l'onglet qui compacte peut envoyer, éditer et
//      régénérer pendant que sa propre compaction réécrit l'historique —
//      exactement le trou que l'étape voulait fermer, rouvert chez soi.
//
// Lecture, scroll et retour au parent restent permis dans les trois cas (et
// le readonly ne neutralise que les MUTATIONS — cf. .conv-parent-btn, composer.css).
function applyReadonlyState() {
  // Le prédicat est élargi ICI, jamais par un `setConvReadonly` appelé depuis
  // le geste : le verrou a UN écrivain (setConvReadonly) et UN point de
  // décision (cette fonction). Un second point déciderait en concurrence du
  // premier, et le dernier à parler gagnerait (souvenir `concurrent-writers`).
  setConvReadonly(_peersGenerating.size > 0 || !!historyRewriteKind(currentConvId) ||
                  isFinishedAgentConv(currentConvId));   // ui.js
  // Le rail d'interjections change d'apparence ET d'affordances avec le verrou
  // (X-1f) : légende (« sera transmise » vs « jamais transmise »), édition
  // retirée, balise éteinte. Re-rendu ici, à côté du seul écrivain du verrou —
  // sinon un agent qui finit sous les yeux laisserait son rail promettre un
  // point d'étape qui ne viendra plus.
  renderInterjectionRail();   // ui.js
}

// Balayage TTL : auto-release des pairs générateurs dont le heartbeat a expiré
// (crash de l'émetteur sans -ended). Armé tant qu'au moins un pair génère.
function armTtlSweeper() {
  if (_peerTtlSweeper) return;
  _peerTtlSweeper = setInterval(function () {
    const now = Date.now();
    let changed = false;
    for (const tabId of Array.from(_peersGenerating)) {
      const last = _peerHeartbeatAt[tabId] || 0;
      if (now - last > SYNC_HEARTBEAT_TTL_MS) {
        _peersGenerating.delete(tabId);
        delete _peerHeartbeatAt[tabId];
        changed = true;
      }
    }
    if (_peersGenerating.size === 0 && _peerTtlSweeper) {
      clearInterval(_peerTtlSweeper); _peerTtlSweeper = null;
    }
    if (changed) { refreshTabBanner(); applyReadonlyState(); }
  }, SYNC_HEARTBEAT_MS);
}

function handleSyncMessage(env) {
  const decision = routeMessage(env, {
    tabId: syncTabId(),
    currentConvId: currentConvId,
    activeSpaceId: activeSpaceId,
  });
  applySyncDecision(decision);
}

function applySyncDecision(d) {
  // Index des résumés : cache RAM PAR ONGLET depuis U-1, sans point
  // d'invalidation (les résumés n'émettent aucun broadcast — arbitrage du lot J,
  // « ne pas broadcaster l'invisible », pris quand `loadSummaries` relisait
  // localStorage et était donc forcément frais). Ce n'est plus le cas : sans
  // relecture, un onglet injecte au modèle un jeu de résumés périmé — manquant
  // celui qu'un pair vient d'écrire, ou ressuscitant une tombstone posée
  // ailleurs. Ce n'est plus « de l'invisible », c'est du contexte modèle.
  //
  // On ne crée pas de type de message pour autant : un résumé suit toujours une
  // conversation qui vient d'être persistée, donc `conv-updated` (dont
  // `rehydrate` et `render-list` sont les deux issues) est un porteur suffisant.
  // Relecture en ARRIÈRE-PLAN, jamais dans le chemin d'envoi : `searchSummaries`
  // est synchrone et appelé depuis `runGenerationFromCurrentThread`, que la
  // décision structurante du lot U interdit de rendre async. Un résumé d'un pair
  // arrive donc avec un léger différé — acceptable, il ne bloque aucun envoi.
  if (d.action === 'rehydrate' || d.action === 'render-list') {
    refreshSummariesFromDB()
      .catch(function(e) { console.error('[miaou] refresh résumés:', e && e.message); });
  }
  switch (d.action) {
    case 'ignore':
    case 'ignore-self':
      return;

    case 'rehydrate':
      // Conv affichée modifiée ailleurs. Si une génération locale est en vol,
      // différer (ne jamais écraser currentThread en pleine mutation). Sinon
      // re-hydrater par le chemin byte-stable (openConversation, piège 17). Le
      // draft du composer n'est pas touché (renderThread ne lit que #thread).
      // Depuis T-1a : « une génération quelconque », pas `sending` (qui ne parle
      // que de l'écran) — une génération détachée mute son propre thread, qui
      // peut être celui de la conv affichée.
      if (_activeGenerations.size) { _queueSyncAction(d); return; }
      if (currentConvId) openConversation(currentConvId);
      return;

    case 'render-list':
      // Conv non affichée modifiée/supprimée ailleurs : rafraîchir la liste
      // (scopée au Space actif par renderConvList). Pas de re-hydratation du
      // fil, mais les MÉTADONNÉES (titre, updatedAt, épinglage) alimentent la
      // liste et vivent dans le cache d'étage 1 : sans relecture, la sidebar
      // afficherait un titre périmé jusqu'au prochain reload.
      if (d.convId == null) { renderConvList(); return; }
      refreshConversationFromDB(d.convId)
        .then(function() { renderConvList(); })
        .catch(function(e) { console.error('[miaou] render-list:', e && e.message); });
      return;

    case 'conv-gone':
      // Conv AFFICHÉE supprimée dans un autre onglet. L'émetteur a déjà persisté
      // la suppression : ne rien re-supprimer, juste réagir côté UI, comme
      // le fait deleteConv local sur la conv courante. (Notice riche : reléguée
      // à l'infra bandeau du soft-lock ; ici retour à l'accueil, non destructif.)
      // Même prédicat que 'rehydrate' depuis T-1a (cf. ci-dessus).
      if (_activeGenerations.size) { _queueSyncAction(d); return; }
      resetToEmpty();
      return;

    case 'space-list':
      // Registre des Espaces modifié ailleurs (création/renommage/suppression).
      // Recharger le sélecteur + la liste (le Space actif de CET onglet ne change
      // pas — miaou-active-space n'est jamais diffusé). Si le Space actif a été
      // supprimé ailleurs, il reste sélectionné ici jusqu'à action locale : cas
      // limite assumé V1 (pas de réconciliation forcée du Space actif).
      syncSpaceUI();
      renderConvList();
      return;

    case 'apply-settings':
      applySyncedSettings(d.keys);
      return;

    case 'invalidate-resources':
      // Évincer les copies RAM périmées ; si la conv affichée est concernée,
      // recharger ses ressources et re-render (vignettes d'attachments à jour).
      invalidateResourceCache(d.ids);
      if (!sending && d.convId != null && d.convId === currentConvId) {
        loadConversationResources(currentConvId).then(function() { rerenderCurrentThread(); });
      }
      // Un fichier de bibliothèque écrit ailleurs (ajout, renommage, description
      // aboutie) : si CET onglet regarde la bibliothèque du même Space, la
      // rafraîchir — mêmes gardes que la voie locale, portées par le helper
      // lui-même. Les `ids` lui font distinguer un arrivant (on descend) d'une
      // carte déjà affichée (on reste où l'on lisait). `spaceId` n'est
      // renseigné que par `putResource` ; une suppression diffusée le laisse à
      // null et ne repeint donc rien ici, limite assumée (l'onglet qui supprime
      // re-rend le sien).
      if (d.spaceId != null) refreshVisibleSpaceLibrary(d.spaceId, d.ids);
      return;

    case 'reload-skills':
      // Cache skills périmé (CRUD dans un autre onglet). Recharger le miroir RAM ;
      // re-render le drawer seulement s'il est ouvert (sinon renderSkills au
      // prochain openSkills suffit). syncSkillHintUI (légende composer) suit via
      // renderSkills ; on le rappelle explicitement si le drawer est fermé.
      loadSkillsCache().then(function() {
        if (isSkillsDrawerOpen()) renderSkills();
        else syncSkillHintUI();
      });
      return;

    case 'full-reload':
      // Import/reset dans un autre onglet : l'état localStorage+IDB a été
      // intégralement remplacé. Rechargement franc, comme l'onglet émetteur.
      location.reload();
      return;

    case 'storage-state':
      // Un pair a constaté le quota, ou libéré de la place. Appliqué sans
      // rediffuser (`broadcast` faux) : l'émetteur a déjà prévenu tout le monde.
      setStorageFull(d.full, false);
      return;

    case 'soft-lock': {
      // Un pair (d.tabId) affiche la même conv que nous. L'ajouter au set. Si
      // c'est un pair INCONNU, se re-signaler une fois (handshake) pour que le
      // pair récemment ouvert nous connaisse à son tour. Le garde « nouveau »
      // borne l'échange : une fois chacun dans le set de l'autre, plus de
      // re-signalement → pas de boucle. (routeMessage n'émet 'soft-lock' que si
      // la conv est affichée localement ; l'appartenance au Space actif est
      // garantie : on n'affiche qu'une conv du Space courant.)
      if (d.tabId && !_peersOnConv.has(d.tabId)) {
        _peersOnConv.add(d.tabId);
        refreshTabBanner();
        announceConvOpened(currentConvId);   // réponse au handshake
      }
      return;
    }
    case 'soft-unlock': {
      // Le pair a fermé la conv (ou quitté) : le retirer des deux sets. Le
      // bandeau ne disparaît que si plus aucun pair ne tient la conv.
      if (d.tabId) {
        _peersOnConv.delete(d.tabId);
        _peersGenerating.delete(d.tabId);
        refreshTabBanner();
      }
      return;
    }

    case 'readonly-on': {
      // Un pair génère sur la conv qu'on affiche (message initial OU heartbeat).
      // Enregistrer le tabId + l'horodatage (pour le TTL), armer le balayage,
      // activer le readonly. Idempotent : un heartbeat répété rafraîchit juste
      // l'horodatage. Un onglet ouvert PENDANT la génération se verrouille ici,
      // au premier heartbeat reçu (pas besoin d'avoir vu le -started initial).
      if (d.tabId) {
        const wasGenerating = _peersGenerating.has(d.tabId);
        _peersGenerating.add(d.tabId);
        _peerHeartbeatAt[d.tabId] = Date.now();
        armTtlSweeper();
        if (!wasGenerating) { refreshTabBanner(); applyReadonlyState(); }
      }
      return;
    }
    case 'readonly-off': {
      // Le pair a fini de générer : retirer du set. Le readonly ne se lève que si
      // plus aucun pair ne génère.
      if (d.tabId && _peersGenerating.has(d.tabId)) {
        _peersGenerating.delete(d.tabId);
        delete _peerHeartbeatAt[d.tabId];
        refreshTabBanner();
        applyReadonlyState();
        // Re-hydratation à la fin de génération d'un pair. On NE se repose PAS
        // sur le seul conv-updated de la persistance finale : lorsqu'il est
        // émis juste avant conv-generation-ended, il peut arriver pendant l'await
        // interne d'un openConversation() déclenché par un conv-updated ANTÉRIEUR
        // (message user du même tour), et le rendu final retombe alors sur l'état
        // « user sans réponse » — la réponse du pair n'apparaît jamais en live
        // (visible seulement après navigation/reload). Relire le storage frais
        // ici est idempotent (openConversation est byte-stable, piège 17) et ferme
        // le trou quel que soit l'ordre d'arrivée des messages. Différé si une
        // génération LOCALE est en vol (drainé par setSending(false)).
        if (currentConvId && d.convId === currentConvId) {
          // Différer tant qu'une génération LOCALE quelconque est en vol : la
          // rehydratation réassigne currentThread, ce qui débrancherait une
          // génération détachée de son thread de travail si elle porte sur cette
          // même conversation, et rejouerait un rendu obsolète sinon.
          if (_activeGenerations.size) { _queueSyncAction({ action: 'rehydrate', convId: currentConvId }); }
          else openConversation(currentConvId);
        }
      }
      return;
    }

    default:
      return;
  }
}

// Ré-application des réglages modifiés dans un autre onglet. `keys` = clés de
// settings modifiées, ou sentinelles de sous-domaine ('api-servers',
// 'active-api-server', 'mcp-servers'). On ré-applique de façon ciblée pour ne
// pas perturber inutilement l'UI (ne jamais vider un draft ni interrompre
// une génération — on ne touche qu'aux surfaces de réglage/serveur).
function applySyncedSettings(keys) {
  const set = new Set(keys || []);
  // Serveurs API / serveur actif : re-render cartes + sélecteur composer + pilule.
  if (set.has('api-servers') || set.has('active-api-server')) {
    loadApiServers();
    syncActiveApiServerUI();
    if (typeof renderApiServers === 'function') renderApiServers();
    syncModelUI();
  }
  // Bascule de serveur actif : reproduire le nettoyage d'`onUseApiServer` que le
  // simple re-render ci-dessus ne couvre pas. L'override de modèle de la conv
  // affichée (`currentConvModel`) pointait sur un modèle de l'ANCIEN serveur ;
  // sans le lever, `activeModel()` resterait collé dessus (piège 15) et le label
  // ne bougerait pas malgré le changement de serveur. On le lève EN MÉMOIRE
  // seulement : l'onglet émetteur a déjà fait `setConvModel('')` → saveConversation
  // → broadcast `conv-updated`, donc pas de re-persistance ni de rebroadcast ici
  // (évite l'écho). `prefetchModels()` refetch le cache modèles du nouveau serveur
  // (cache `_modelsById` indexé par id de serveur) et rappelle `syncModelUI()`.
  if (set.has('active-api-server')) {
    currentConvModel = '';
    prefetchModels();
  }
  // Serveurs MCP : re-render cartes (les outils distants se rebranchent à la
  // prochaine reconnexion manuelle ; pas de reconnexion auto imposée ici).
  if (set.has('mcp-servers') && typeof renderMcpServers === 'function') renderMcpServers();
  // Réglages généraux : ré-appliquer thème + surlignage + sélecteurs, sans
  // toucher au draft ni au thread. On relit l'état persisté à la source.
  const s = loadSettings();
  // Réglages d'apparence auto-persistés (pas de bouton « Enregistrer ») : il
  // faut ré-appliquer le RENDU *et* rafraîchir les boutons du drawer. Oublier
  // le second laisse un drawer qui affiche l'ancien choix alors que l'écran a
  // changé — désaccord entre ce que l'utilisateur voit et ce que les segments
  // prétendent, et un clic sur le segment déjà « actif » qui semble sans effet.
  // Les setXxxUI sont sans risque drawer fermé : ils ne font que toggler des
  // classes sur des nœuds statiques et écrire un hint (no-op si absent).
  if (set.has('theme')) { applyTheme(s.theme || 'system'); setThemeUI(s.theme || 'system'); }
  if (set.has('palette')) { applyPalette(s.palette || 'ambre'); setPaletteUI(s.palette || 'ambre'); }
  if (set.has('fonts')) { applyFonts(s.fonts || 'graphite'); setFontsUI(s.fonts || 'graphite'); }
  if (set.has('motion')) { applyMotion(s.motion || 'system'); setMotionUI(s.motion || 'system'); }
  if (set.has('colWidth')) applyColWidth(s.colWidth);   // applyColWidth resynchronise déjà les boutons
  if (set.has('highlight')) highlightEnabled = s.highlight !== false;
  // Auto-persisté (onToggleWideTables), donc à ré-appliquer ET à refléter dans
  // la case : le drawer peut être ouvert chez le pair, comme pour les segments
  // ci-dessus. Aucun re-rendu du fil, le CSS suffit (cf. applyWideTables).
  if (set.has('wideTables')) {
    applyWideTables(s.wideTables !== false);
    const cbWide = $('set-wide-tables');
    if (cbWide) cbWide.checked = s.wideTables !== false;
  }
  // Autres clés (systemPrompt, sélecteurs…) : effet au prochain
  // envoi/rendu, rien à ré-appliquer en direct. La pilule de contexte se
  // recalcule au prochain syncContextCounter.
  syncContextCounter();
}

// File d'attente des actions de synchro différées pendant une génération locale.
function _queueSyncAction(d) {
  // Coalescing : une seule re-hydratation/conv-gone en attente suffit (la
  // dernière gagne, l'état persisté est de toute façon relu au drain).
  _pendingSyncActions = _pendingSyncActions.filter(function(a) {
    return a.action !== 'rehydrate' && a.action !== 'conv-gone';
  });
  _pendingSyncActions.push(d);
}

// Drain appelé quand la dernière génération locale se termine
// (unregisterGeneration, T-1a). Rejoue les actions différées maintenant qu'aucun
// thread n'est plus muté.
function drainPendingSync() {
  if (!_pendingSyncActions.length) return;
  const actions = _pendingSyncActions;
  _pendingSyncActions = [];
  for (const d of actions) applySyncDecision(d);
}

// ── Readonly relay + heartbeat ──────────────────────────────────────────
// Un onglet qui génère sur la conv X émet conv-generation-started(X) au début et
// conv-generation-ended(X) à la fin (tous chemins : succès/erreur/abort, via
// register/unregisterGeneration — depuis T-1a un onglet peut générer sur
// PLUSIEURS convs à la fois, chacune avec son propre cycle et son heartbeat). Un heartbeat ré-émet -started toutes les
// SYNC_HEARTBEAT_MS ; les récepteurs auto-libèrent le readonly s'ils ne
// reçoivent pas de heartbeat en SYNC_HEARTBEAT_TTL_MS (crash de l'émetteur).
// Un onglet ouvert PENDANT une génération se verrouille au prochain heartbeat.
const SYNC_HEARTBEAT_MS = 5000;        // ré-émission de -started (N = 5 s)
const SYNC_HEARTBEAT_TTL_MS = 10000;   // auto-release récepteur sans heartbeat (2×N)

// Un heartbeat PAR CONVERSATION en génération (lot T-1a). Avant
// T-1, un scalaire suffisait : un onglet ne générait que sur la conv affichée.
// Avec N générations concurrentes, un scalaire ferait émettre le -ended de la
// première sur la conv de la seconde — les pairs déverrouilleraient une conv
// encore en génération. Une Map préserve le format d'enveloppe du lot J
// inchangé (liste fermée de types de docs/multitab-sync.md non touchée), ce qui
// est l'avantage décisif sur un heartbeat unique portant la liste des convs.
const _genRelayTimers = new Map();   // Map<convId, timerId>

// Démarre le relais pour UNE conversation : émet -started + arme son heartbeat.
// Appelé depuis le cycle de vie de la génération (registerGeneration), plus
// depuis setSending — qui n'est plus qu'un reflet d'écran.
function startGenerationRelay(convId) {
  if (convId == null) return;
  if (_genRelayTimers.has(convId)) return;   // déjà relayée : ne pas doubler le ticker
  syncPost('conv-generation-started', { convId: convId, tabId: syncTabId() });
  const timer = setInterval(function () {
    if (!_genRelayTimers.has(convId)) return;   // course : arrêt entre deux ticks
    syncPost('conv-generation-started', { convId: convId, tabId: syncTabId() });
  }, SYNC_HEARTBEAT_MS);
  _genRelayTimers.set(convId, timer);
}

// Arrête le relais d'UNE conversation : coupe son heartbeat + émet -ended.
// Idempotent (second appel sans effet : la clé a disparu du registre, aucun
// -ended n'est ré-émis). Discipline deux-timers (piège 13) : ne touche QUE les
// timers de relais, jamais ceux du patienteur (startWaiter/stopWaiter).
function stopGenerationRelay(convId) {
  if (convId == null) return;
  const timer = _genRelayTimers.get(convId);
  if (timer === undefined) return;   // pas (ou plus) relayée : rien à émettre
  clearInterval(timer);
  _genRelayTimers.delete(convId);
  syncPost('conv-generation-ended', { convId: convId, tabId: syncTabId() });
}

// Libère TOUS les pairs (lot T-1a) — appelé au départ de l'onglet
// (pagehide/beforeunload), où les générations meurent de toute façon avec la
// page (portée de survie). Idempotence EXPLICITE, pas supposée : le handler est
// branché sur les deux événements et peut tirer deux fois ; on itère sur une
// copie des clés et stopGenerationRelay vide le registre au passage, donc un
// second appel trouve un registre vide et ne ré-émet aucun -ended.
function stopAllGenerationRelays() {
  for (const convId of Array.from(_genRelayTimers.keys())) stopGenerationRelay(convId);
}
