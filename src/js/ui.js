/* ── ui.js ─────────────────────────────────────────────────────────────────
   Couche DOM : rendu des messages, sidebar, drawers, dropdown modèle, bannière
   mémoire, indicateur d'activité, gestion des souvenirs. Aucune logique
   d'orchestration (qui vit dans main.js) ni réseau (api.js).
   ────────────────────────────────────────────────────────────────────────── */

let highlightEnabled = true;
let configured = false;
let sending = false;
let _confirmPending = false;

function $(id) { return document.getElementById(id); }

// ── Écran d'accueil (nouvelle conversation) ─────────────────────────────────
const WELCOME_SCREENS = [
  { emoji: '🌙', title: 'À tes ordres.',          sub: 'Qu\'est-ce qu\'on démonte aujourd\'hui ?',
    tipEmoji: '🧰', tipHead: 'Dans la boîte à outils :' },
  { emoji: '⚡', title: 'Prêt.',                  sub: 'Pose la question que tu n\'osais pas chercher sur Google.',
    tipEmoji: '🤫', tipHead: 'Ce que Google ne t\'aurait pas dit :' },
  { emoji: '🧠', title: 'Connexion établie.',     sub: 'Ta prochaine bonne idée est à une question d\'ici.',
    tipEmoji: '💭', tipHead: 'En attendant la tienne :' },
  { emoji: '🎯', title: 'Dans le mille.',         sub: 'Allons droit au but.',
    tipEmoji: '🏹', tipHead: 'Une flèche pour ton carquois :' },
  { emoji: '🔭', title: 'Je t\'écoute.',          sub: 'L\'inconnu n\'est qu\'un contexte manquant.',
    tipEmoji: '🪐', tipHead: 'Justement, un peu de contexte :' },
  { emoji: '🌊', title: 'Dans le flux.',          sub: 'Décris le problème, on trouvera la sortie.',
    tipEmoji: '🐚', tipHead: 'Ramené par la marée :' },
  { emoji: '☕', title: 'Fraîchement infusé.',    sub: 'Le moment idéal pour poser cette question qui traîne.',
    tipEmoji: '🥐', tipHead: 'Avec le café :' },
  { emoji: '🏗️', title: 'Chantier ouvert.',      sub: 'Amène tes plans, tes blocs, ou juste l\'intention.',
    tipEmoji: '📐', tipHead: 'Lu sur les plans :' },
  { emoji: '🌿', title: 'Calme et disponible.',   sub: 'Prends ton temps.',
    tipEmoji: '🍃', tipHead: 'Au passage :' },
  { emoji: '🗺️', title: 'Carte blanche.',        sub: 'Par où commence-t-on ?',
    tipEmoji: '🧭', tipHead: 'Un repère, pour commencer :' },
  { emoji: '🔍', title: 'Sous la loupe.',         sub: 'Tout mérite d\'être examiné de plus près.',
    tipEmoji: '🔬', tipHead: 'Vu de plus près :' },
  { emoji: '🚀', title: 'Compte à rebours.',      sub: 'Dix secondes pour formuler, le reste suit.',
    tipEmoji: '🛰️', tipHead: 'Pendant le compte à rebours :' },
  { emoji: '🎸', title: 'Accordé.',               sub: 'À toi de jouer.',
    tipEmoji: '🎼', tipHead: 'Un accord à connaître :' },
  { emoji: '🎲', title: 'Prêt à tout.',           sub: 'Une question, une idée, un bug — on y va.',
    tipEmoji: '🃏', tipHead: 'Tiré au hasard :' },
  { emoji: '🦾', title: 'Opérationnel.',          sub: 'Dis-moi ce qui coince.',
    tipEmoji: '⚙️', tipHead: 'Dans les rouages :' },
  { emoji: '🥖', title: 'À la baguette.',         sub: 'No pain, no gain.',
    tipEmoji: '🧑‍🍳', tipHead: 'Sorti du four :' },
  { emoji: '🐈', title: 'Miaou.',                 sub: 'Ça veut dire « je t\'écoute », en chat.',
    tipEmoji: '🐾', tipHead: 'Ronronné en passant :' },
  { emoji: '🧵', title: 'Nouveau fil.',           sub: 'Tire dessus, on verra ce qui vient avec.',
    tipEmoji: '🪡', tipHead: 'Au bout du fil :' },
  { emoji: '🎬', title: 'Moteur.',                sub: 'À toi de dire action.',
    tipEmoji: '🍿', tipHead: 'Dans les bonus :' },
  { emoji: '🧩', title: 'Pièce manquante.',       sub: 'Cherchons la forme.',
    tipEmoji: '📦', tipHead: 'Une pièce qui s\'emboîte :' },
  { emoji: '♟️', title: 'À ton tour.',            sub: 'J\'ai trois coups d\'avance. Ou je bluffe.',
    tipEmoji: '🏰', tipHead: 'Une ouverture à connaître :' },
  { emoji: '🕯️', title: 'Allumé.',                sub: 'Pas de panique, la cire tient jusqu\'au matin.',
    tipEmoji: '🔥', tipHead: 'À la lueur :' },
  { emoji: '🧪', title: 'Paillasse dégagée.',     sub: 'Amène ton hypothèse, on verra ce qui explose.',
    tipEmoji: '⚗️', tipHead: 'Résultat d\'expérience :' },
  { emoji: '📡', title: 'Signal reçu.',           sub: 'Cinq sur cinq. Ou quatre, selon le Wi-Fi.',
    tipEmoji: '📻', tipHead: 'Capté entre deux fréquences :' },
  { emoji: '🦉', title: 'Encore debout.',         sub: 'Les bonnes questions sont souvent nocturnes.',
    tipEmoji: '🌒', tipHead: 'Vu de nuit :' },
  { emoji: '🔑', title: 'Porte ouverte.',         sub: 'Pas besoin de frapper.',
    tipEmoji: '🚪', tipHead: 'Trouvé sur le paillasson :' },
  { emoji: '🪄', title: 'Abracadabra.',           sub: 'Dis ce que tu as dans la manche, je fais le reste.',
    tipEmoji: '🎩', tipHead: 'Sorti du chapeau :' },
  { emoji: '🧊', title: 'Sang-froid.',            sub: 'Rien ne brûle tant qu\'on n\'a pas lu les logs.',
    tipEmoji: '🐧', tipHead: 'Conservé au frais :' },
  { emoji: '🕰️', title: 'Juste à l\'heure.',      sub: 'Ni en avance, ni en retard : exactement quand tu arrives.',
    tipEmoji: '⏳', tipHead: 'Le temps de le lire :' },
  { emoji: '🐙', title: 'Huit bras libres.',      sub: 'De quoi tenir plusieurs sujets à la fois.',
    tipEmoji: '🫧', tipHead: 'Remonté des profondeurs :' },
  { emoji: '📚', title: 'Page blanche.',          sub: 'Le premier mot est le plus cher, les suivants sont offerts.',
    tipEmoji: '🔖', tipHead: 'Noté en marge :' },
  { emoji: '🧲', title: 'Aimanté.',               sub: 'Balance le problème, il collera.',
    tipEmoji: '📎', tipHead: 'Resté accroché :' },
  { emoji: '🕵️', title: 'Enquête ouverte.',      sub: 'Un bug, un mobile, pas encore de coupable.',
    tipEmoji: '🗂️', tipHead: 'Dans le dossier :' },
  { emoji: '🧯', title: 'Rien ne brûle.',         sub: 'Pour l\'instant. Raconte.',
    tipEmoji: '🚒', tipHead: 'Consigne de sécurité :' },
  { emoji: '🦆', title: 'Coin.',                  sub: 'Explique-moi comme au canard. Moi, je réponds en plus.',
    tipEmoji: '🛁', tipHead: 'Flotté jusqu\'ici :' },
  { emoji: '🍳', title: 'Poêle chaude.',          sub: 'Casse tes œufs, je fais l\'omelette.',
    tipEmoji: '🧂', tipHead: 'Une pincée en plus :' },
  { emoji: '🐘', title: 'Mémoire d\'éléphant.',   sub: 'Enfin, jusqu\'à la fenêtre de contexte.',
    tipEmoji: '🥜', tipHead: 'Une cacahuète pour la route :' },
  { emoji: '🔮', title: 'Boule de cristal.',      sub: 'Je vois… une question. Tu confirmes ?',
    tipEmoji: '🌠', tipHead: 'Prédit sans garantie :' },
  { emoji: '🏔️', title: 'Campement établi.',     sub: 'Le sommet est en haut, ça aide.',
    tipEmoji: '🧗', tipHead: 'Un point d\'ancrage :' },
  { emoji: '🐝', title: 'La ruche bourdonne.',   sub: 'Goûtons de ce miel.',
    tipEmoji: '🍯', tipHead: 'Butiné ce matin :' },
  { emoji: '🛸', title: 'Atterrissage.',          sub: 'Conduis-moi à ton problème.',
    tipEmoji: '👽', tipHead: 'Intercepté en orbite :' },
  { emoji: '🧭', title: 'Cap libre.',             sub: 'Donne la direction, je m\'occupe du reste.',
    tipEmoji: '⛵', tipHead: 'Relevé au compas :' },
];

// Tire un écran d'accueil au hasard, en évitant `exceptTitle` si fourni (pour
// garantir un changement VISIBLE au re-tirage — cf. refreshWelcomeIfPresent).
function pickWelcomeScreen(exceptTitle) {
  const pool = exceptTitle
    ? WELCOME_SCREENS.filter(w => w.title !== exceptTitle)
    : WELCOME_SCREENS;
  const src = pool.length ? pool : WELCOME_SCREENS;   // garde-fou (jamais vide en pratique)
  return src[Math.floor(Math.random() * src.length)];
}

function showWelcome(exceptTitle) {
  const w = pickWelcomeScreen(exceptTitle);
  const el = document.createElement('div');
  el.className = 'welcome-screen';
  el.innerHTML =
    '<div class="welcome-emoji">' + w.emoji + '</div>' +
    '<div class="welcome-title">' + escHtml(w.title) + '</div>' +
    '<div class="welcome-sub">'   + escHtml(w.sub)   + '</div>';
  $('thread').appendChild(el);
  // La tête de l'astuce est celle de CET écran : mémorisée à la pose, car le
  // rendu de l'astuce (deux secondes plus tard, puis à chaque redimensionnement)
  // n'a plus accès à l'écran tiré — il ne reçoit que son nœud hôte.
  _welcomeTipHead.set(el, { emoji: w.tipEmoji, head: w.tipHead });
  scheduleDidYouKnow(el);
}

// ── Astuce d'accueil (encart sous l'écran d'accueil) ───────────────────────
// Tête de l'astuce (emoji + libellé d'introduction) pour un écran d'accueil
// donné, posée par showWelcome. WeakMap plutôt qu'un champ sur le nœud, comme
// _welcomeTipText plus bas : rien à nettoyer quand l'écran est remplacé.
const _welcomeTipHead = new WeakMap();

// Une astuce PAR écran d'accueil : le déclencheur est showWelcome, donc elle
// change quand le welcome change (nouvelle conversation, bascule de thème via
// refreshWelcomeIfPresent) et pas sur un timer. Décidé pour borner le coût —
// l'astuce demande un appel modèle, et une rotation périodique en aurait
// engagé un par minute sur un onglet simplement laissé ouvert.
// DID_YOU_KNOW_DELAY_MS vient de storage.js (clef de build `did_you_know_delay_s`).
let _didYouKnowTimer = null;

// `hostEl` est L'écran d'accueil qui a demandé cette astuce : on la lui attache
// seulement s'il est TOUJOURS celui affiché. Deux fenêtres d'attente le rendent
// nécessaire (le délai de 2 s, puis la génération) : entre-temps l'utilisateur
// peut avoir envoyé un message (thread rendu, welcome retiré) ou re-tiré un
// welcome. `isConnected` répond aux deux cas d'un coup — un nœud retiré du DOM
// le perd, y compris quand un AUTRE welcome l'a remplacé.
// Place disponible pour l'astuce, en pixels : hauteur de l'écran d'accueil
// moins son plancher (le bas du trio emoji/titre/sous-titre, calc(50% + 92px)
// en CSS) moins la marge basse contre le composer. Mesurée sur l'hôte plutôt
// que dérivée de window.innerHeight : la topbar, le composer déployé et le
// zoom du navigateur entrent tous dans l'écart entre les deux, et une
// media query en aurait ignoré la totalité.
// Les trois nombres sont ceux de `.welcome-tip` dans chat.css — les changer
// d'un côté impose de les changer de l'autre ; il n'existe pas de canal par
// lequel le JS lise un calc() CSS.
function welcomeTipRoomPx(hostEl) {
  return hostEl.getBoundingClientRect().height / 2 - 92 - 20;
}

// Place minimale pour ESPÉRER une astuce : la tête d'introduction plus une
// ligne de corps. Seuil grossier par nécessité — au moment de décider s'il faut
// appeler le modèle, le texte n'existe pas encore, donc son nombre de lignes
// est inconnu. Mesuré : 48px pour une ligne de corps, 114px pour quatre (une
// phrase longue se replie, deux phrases longues font donc quatre lignes et non
// deux). Refuser dès ici tout ce qui ne tiendrait de toute façon jamais évite
// l'appel modèle dans le cas franc.
const WELCOME_TIP_MIN_ROOM_PX = 48;

// La décision d'AFFICHER, elle, se prend sur le texte rendu : c'est la seule
// mesure exacte, et c'est celle qui garantit que la tête n'est pas rognée.
// Deux prédicats et non un seuil unique parce que les deux questions n'ont pas
// les mêmes informations disponibles — « faut-il générer ? » ignore la longueur
// du texte, « faut-il montrer ? » la connaît.
function welcomeTipFits(tipEl) {
  const head = tipEl.querySelector('.welcome-tip-head');
  const body = tipEl.querySelector('.welcome-tip-body');
  if (!head || !body) return true;
  const needed = head.getBoundingClientRect().height
    + parseFloat(getComputedStyle(head).marginBottom || 0)
    + body.getBoundingClientRect().height;
  // Demi-pixel de tolérance : les hauteurs sont fractionnaires et une astuce
  // qui tient au pixel près ne doit pas être refusée par un arrondi.
  return needed <= tipEl.getBoundingClientRect().height + 0.5;
}

// Faire tenir l'astuce en retirant des phrases PAR LA FIN, plutôt que de la
// jeter entière : les phrases sont déjà des blocs séparés (.welcome-tip-line),
// et l'astuce est écrite en ordre décroissant d'importance — la première porte
// le fait, les suivantes le nuancent. Une astuce d'une phrase reste une astuce.
// Rend true si quelque chose reste affichable, false si même la première phrase
// ne tient pas (l'appelant retire alors tout : mieux vaut rien qu'une tête
// suivie d'un fragment).
// Le retrait se fait dans le DOM et se remesure à chaque tour — la hauteur d'un
// texte replié ne se calcule pas d'avance, seulement s'observe.
function fitWelcomeTipByDroppingLines(tipEl) {
  const lines = Array.from(tipEl.querySelectorAll('.welcome-tip-line'));
  for (let i = lines.length - 1; i >= 1 && !welcomeTipFits(tipEl); i--) {
    lines[i].remove();
  }
  return welcomeTipFits(tipEl);
}

// Poser l'astuce puis l'ajuster à la place réelle : rendu complet, élagage des
// phrases de queue, retrait total si même la première ne tient pas. Une seule
// fonction pour la pose initiale ET le re-rendu après redimensionnement — les
// deux doivent produire exactement le même résultat pour une même place, sinon
// l'astuce changerait d'aspect au premier coup d'accordéon.
// `animate` distingue la POSE (fondu d'apparition, l'astuce arrive) du
// RE-RENDU après redimensionnement (aucun fondu : l'astuce était déjà là, la
// refondre à chaque event de resize la ferait clignoter pendant tout un drag).
function renderWelcomeTipFitted(hostEl, tip, animate) {
  _welcomeTipLastRoom.set(hostEl, Math.round(welcomeTipRoomPx(hostEl)));
  renderDidYouKnow(hostEl, tip);
  const posed = hostEl.querySelector('.welcome-tip');
  if (!posed) return;
  if (!animate) posed.style.animation = 'none';
  if (!fitWelcomeTipByDroppingLines(posed)) posed.remove();
}

function scheduleDidYouKnow(hostEl) {
  if (_didYouKnowTimer) { clearTimeout(_didYouKnowTimer); _didYouKnowTimer = null; }
  if (typeof generateDidYouKnowTip !== 'function') return;   // sources non buildées (tests)
  if (!loadSettings().didYouKnow) return;
  _didYouKnowTimer = setTimeout(async () => {
    _didYouKnowTimer = null;
    if (!hostEl.isConnected) return;
    // Testé AVANT l'appel au modèle, pas seulement au rendu : une astuce qu'on
    // ne montrera pas ne vaut pas une génération. Mesuré ici et non à la pose
    // du timer — la fenêtre a pu être redimensionnée pendant l'attente.
    if (welcomeTipRoomPx(hostEl) < WELCOME_TIP_MIN_ROOM_PX) return;
    // Sans serveur API, `silentCompletion` partirait sur une URL vide : un
    // `fetch('/chat/completions')` relatif, voué à l'échec (et journalisé par
    // le navigateur). Lu au déclenchement, pas à la pose : la configuration a
    // pu changer pendant l'attente.
    if (!configured) return;
    const res = await generateDidYouKnowTip();
    if (!res || !hostEl.isConnected) return;
    // Re-mesuré après l'await : la génération dure, la fenêtre peut avoir
    // rétréci entre-temps (fenêtre d'await, cf. piège 24).
    if (welcomeTipRoomPx(hostEl) < WELCOME_TIP_MIN_ROOM_PX) return;
    // Ajustement sur le texte RENDU : le seuil ci-dessus ne pouvait pas
    // connaître son nombre de lignes. Poser puis élaguer plutôt que
    // pré-calculer — la hauteur d'un texte replié ne se prédit pas hors DOM.
    // Le sujet est posé ICI et non dans renderDidYouKnow : celui-ci sert aussi
    // le re-rendu au redimensionnement, qui ne repasse pas par la génération et
    // n'a donc pas le topic à lui donner. Un WeakMap écrit une fois, au seul
    // point qui connaît la réponse.
    _welcomeTipTopic.set(hostEl, res.topic);
    renderWelcomeTipFitted(hostEl, res.tip, true);
  }, DID_YOU_KNOW_DELAY_MS);
}

// Texte intégral de l'astuce, par écran d'accueil. Nécessaire parce que le
// rendu est ÉLAGUÉ selon la place disponible : le DOM ne porte donc plus le
// texte complet dès qu'une phrase a sauté, et un agrandissement de fenêtre
// doit pouvoir la faire revenir. WeakMap plutôt qu'un champ sur le nœud : rien
// à nettoyer quand l'écran d'accueil est remplacé.
const _welcomeTipText = new WeakMap();

// Sujet d'aide (slug) d'où l'astuce a été tirée, par écran d'accueil. Mémorisé
// pour le clic « développe » : le prompt pré-rempli nomme le slug, que
// generateDidYouKnowTip rend déjà mais que le rendu jetait. Comme
// _welcomeTipText, il survit à l'élagage du DOM — et comme lui, il se relit
// au re-rendu après redimensionnement, qui ne repasse pas par la génération.
const _welcomeTipTopic = new WeakMap();

// Dernière place mesurée pour laquelle l'astuce a été mise en page. Sert à
// n'agir, au redimensionnement, que quand la place a réellement bougé.
const _welcomeTipLastRoom = new WeakMap();

// escHtml impératif : `tip` est d'origine modèle (piège 21).
function renderDidYouKnow(hostEl, tip) {
  _welcomeTipText.set(hostEl, tip);
  const old = hostEl.querySelector('.welcome-tip');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'welcome-tip';
  // escHtml par phrase : `tip` est d'origine modèle (piège 21). Le découpage
  // en phrases se fait AVANT l'échappement, sur le texte brut — après, une
  // entité (&amp;) introduirait des points-virgules qui ne coupent rien mais
  // brouilleraient la lecture d'un futur motif.
  // hardenFrenchSpacing AVANT escHtml : elle ne produit que des espaces
  // insécables, qu'escHtml laisse passer tels quels — l'inverse ferait passer
  // ses motifs sur des entités (&amp;) plutôt que sur le texte.
  const harden = s => (typeof hardenFrenchSpacing === 'function' ? hardenFrenchSpacing(s) : s);
  const lines = (typeof splitTipSentences === 'function' ? splitTipSentences(tip) : [tip])
    .map(p => '<span class="welcome-tip-line">' + escHtml(harden(p)) + '</span>').join('');
  // Tête accordée à l'écran d'accueil tiré ; repli sur la formule neutre si
  // l'hôte n'en porte pas (écran posé par un chemin qui n'en fournirait pas).
  const head = _welcomeTipHead.get(hostEl) || { emoji: '💡', head: 'Le savais-tu ?' };
  el.innerHTML =
    '<span class="welcome-tip-head">' +
      '<span class="welcome-tip-head-emoji">' + head.emoji + '</span>' +
      escHtml(harden(head.head)) +
    '</span>' +
    '<span class="welcome-tip-body">' + lines + '</span>';
  // Cliquer l'astuce pré-remplit le composer d'une demande de développement.
  // Listener et non attribut inline : ce nœud est recréé à chaque mise en page
  // (pose puis re-rendus au redimensionnement), il n'y a donc aucun câblage
  // durable à maintenir — et l'affordance suit le nœud sans dépendre d'un nom
  // global cité dans une template string.
  // `title` plutôt qu'un texte d'invite ajouté dans l'encart : l'astuce est
  // courte et bornée en hauteur (elle s'élague déjà faute de place), une ligne
  // de plus y disputerait la place au contenu.
  el.title = 'Demander à développer';
  el.addEventListener('click', () => askToDevelopWelcomeTip(hostEl));
  hostEl.appendChild(el);
}

// Pré-remplit le composer d'une demande de développement de l'astuce affichée,
// puis focus — SANS envoyer. Même geste qu'insertSkillIntoComposer :
// l'utilisateur voit le prompt, l'amende ou l'abandonne. Un clic sur un encart
// décoratif ne déclenche pas une génération.
//
// Le texte lu est le texte INTÉGRAL mémorisé (_welcomeTipText), jamais le DOM :
// celui-ci a pu être élagué par la fin faute de place, et citer l'astuce
// amputée priverait le modèle des phrases qu'elle contenait.
//
// Écrase un éventuel brouillon plutôt que de s'y ajouter, contrairement au
// reflux d'interjections : celui-ci RESTITUE un texte que l'utilisateur avait
// écrit et à qui on doit de ne rien perdre, là où ici le composer d'un écran
// d'accueil vierge est le cas nominal — et un clic sur l'astuce est une
// intention claire de partir sur CE sujet.
function askToDevelopWelcomeTip(hostEl) {
  const tip = _welcomeTipText.get(hostEl);
  if (!tip) return;
  const ta = $('composer-text');
  if (!ta || ta.disabled || isComposerReadonly()) return;
  const prompt = formatTipFollowUpPrompt(tip, _welcomeTipTopic.get(hostEl));
  if (!prompt) return;
  ta.value = prompt;
  ta.focus();
  const caret = ta.value.length;
  ta.setSelectionRange(caret, caret);
  autoGrow(ta);
  if (typeof onComposerInput === 'function') onComposerInput();
}

// Une astuce déjà posée quand la fenêtre rétrécit se ferait rogner par le haut
// (elle est poussée contre le composer) : on la retire plutôt que de la laisser
// décapitée. Elle ne revient pas si la fenêtre se ré-agrandit — la regénérer
// coûterait un appel modèle par coup d'accordéon, et l'astuce est décorative.
// Branchée sur le listener de visualViewport, qui suit déjà tout
// redimensionnement.
function revisitWelcomeTipRoom() {
  const thread = $('thread');
  if (!thread) return;
  const host = thread.querySelector('.welcome-screen');
  if (!host) return;
  const tip = _welcomeTipText.get(host);
  if (!tip) return;   // aucune astuce n'a jamais été posée sur cet écran
  // Re-rendu depuis le TEXTE mémorisé, jamais depuis le DOM courant : celui-ci
  // a pu être élagué, ou retiré entièrement. Repartir de lui rendrait la perte
  // définitive — une astuce ne remonterait jamais après un agrandissement,
  // alors qu'ouvrir puis refermer la console du navigateur est le cas courant.
  // Aucun appel modèle n'est en jeu : le texte est déjà là, on ne fait que le
  // remettre en page.
  // Ne toucher au DOM que si la place a VRAIMENT changé. Un redimensionnement
  // produit des dizaines d'events dont la quasi-totalité ne déplace rien ;
  // re-rendre à chaque fois recréerait le nœud (donc un clignotement) pour un
  // résultat identique. Comparer la place plutôt que re-rendre puis annuler :
  // la seule façon de ne pas produire de mutation est de ne pas en produire.
  const room = Math.round(welcomeTipRoomPx(host));
  if (room === _welcomeTipLastRoom.get(host)) return;
  _welcomeTipLastRoom.set(host, room);
  renderWelcomeTipFitted(host, tip, false);
}

// Coquetterie : si l'écran d'accueil est affiché (conversation vierge), un
// changement de thème re-tire un message d'accueil au hasard, DIFFÉRENT de
// l'actuel (changement toujours visible). Retire l'ancien avant de rappeler
// showWelcome (qui append). No-op hors écran d'accueil ou avant tout rendu.
function refreshWelcomeIfPresent() {
  const thread = $('thread');
  if (!thread) return;
  const w = thread.querySelector('.welcome-screen');
  if (!w) return;
  const curTitle = (w.querySelector('.welcome-title') || {}).textContent || '';
  w.remove();
  showWelcome(curTitle);
}

// Path des composants Prism pour l'autoloader (langages chargés à la volée).
if (window.Prism && Prism.plugins && Prism.plugins.autoloader) {
  Prism.plugins.autoloader.languages_path =
    'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
}

// Renderer custom pour les fences de code : marked 12.0.0 (désassemblage vérifié)
// conserve l'info string COMPLÈTE dans `lang` (ex. "python filename=foo.py") et son
// renderer par défaut prend juste `^\S*` pour la classe language-xxx — un filename
// séparé par un ESPACE ne casse donc déjà rien côté Prism, mais est perdu (jamais lu).
// On réutilise le même corps que le renderer d'origine (signature vérifiée :
// code(text, lang, escaped)) en y ajoutant l'extraction du filename
// (parseCodeFenceInfo, utils.js) posé en attribut data- sur le <code>, jamais dans la
// classe. Pur/déterministe (même entrée → même HTML), s'applique aussi à renderUserMd
// (même instance marked globale — souhaité : un user peut coller un codeblock nommé).
if (window.marked) {
  marked.use({
    renderer: {
      code(text, infoString, escaped) {
        const { lang, filename } = parseCodeFenceInfo(infoString);
        const body = String(text).replace(/\n$/, '') + '\n';
        const content = escaped ? body : escHtml(body);
        const cls = lang ? ' class="language-' + escHtml(lang) + '"' : '';
        const attr = filename ? ' data-filename="' + escHtml(filename) + '"' : '';
        return '<pre><code' + cls + attr + '>' + content + '</code></pre>\n';
      },
    },
  });
}

// ── Rendu markdown / coloration ─────────────────────────────────────────────
// Résout les [conv_ref:ID] / [conv_ref:ID|Titre] (CONV_REF_DOCTRINE, tools.js)
// en lien Markdown standard AVANT marked.parse — jamais après : une fois passés
// par le parseur, les crochets bruts seraient déjà interprétés (syntaxe de lien
// incomplète) et donc invisibles/imprévisibles à ce stade. Le href pointe vers un
// pseudo-schéma `#miaou-conv:ID` intercepté par délégation de clic (listener
// anonyme posé une fois sur `#messages` dans init(), main.js — greper le
// sélecteur `a[href^="#miaou-conv:"]`), jamais une vraie navigation. Titre :
// celui fourni par le modèle, sinon lookup dans l'index des résumés
// (storage.js) — y compris une entrée tombstone
// (suppressed:true ne concerne QUE le résumé/mémoire, cf. §6 CLAUDE.md ; la
// conversation elle-même reste intacte et ouvrable, son titre reste affichable).
// Conversation réellement supprimée (deleteConv → deleteSummaryEntry, hard
// delete des DEUX, ≠ tombstone) : la source de vérité pour « ouvrable » est
// loadConversation(id), pas la présence d'un résumé (cas limite existant où le
// résumé peut survivre sans la conversation, cf. conv__get). Dans ce cas,
// rendu en texte barré NON cliquable plutôt qu'un lien mort — pas de
// post-traitement DOM, juste du Markdown ~~...~~.
// `opts.asPlainText` (défaut false, écran inchangé) : pour l'export standalone
// (brief G, règles de contenu) où le lien `#miaou-conv:` ne résout jamais hors MIAOU — rend
// le label nu au lieu d'un lien mort. Le tombstone `~~…~~` reste inchangé
// (c'est du texte, pas un lien).
function resolveConvRefs(text, opts) {
  const asPlainText = !!(opts && opts.asPlainText);
  return String(text).replace(CONV_REF_RE, function(match, id, title) {
    const entry = getSummaryEntry(id);
    const label = title || (entry && entry.title) || id;
    const safeLabel = label.replace(/\]/g, ')');
    if (!loadConversation(id)) {
      return '~~' + safeLabel + ' (supprimée)~~';
    }
    if (asPlainText) return safeLabel;
    return '[' + safeLabel + '](#miaou-conv:' + encodeURIComponent(id) + ')';
  });
}

// Ouverture des liens du markdown rendu dans un nouvel onglet. Posé en hook
// DOMPurify plutôt que dans les renderers marked : `sanitizeHtml` est le
// passage OBLIGÉ des trois chemins de rendu (renderMd, renderUserMd,
// renderMarkdownDocBody), donc le seul endroit où la règle ne peut pas être
// oubliée par un futur appelant — et elle vaut aussi pour les liens d'un
// fragment HTML inline écrit par le modèle, que marked laisse passer sans
// jamais appeler son renderer `link`.
// Deux exclusions, pour la même raison dans les deux cas : ce sont des liens
// qui ne naviguent pas.
//   - `#miaou-conv:` — pseudo-schéma résolu par resolveConvRefs, intercepté en
//     délégation de clic (main.js) qui fait preventDefault + selectConv. Un
//     `target` y ouvrirait un second MIAOU sur l'ancre au lieu de changer de
//     conversation.
//   - toute autre ancre pure (`#…`) — navigation interne au document, pertinente
//     surtout dans l'export standalone (sommaire de document converti).
// `rel="noopener noreferrer"` systématique avec `target` : sans lui, la page
// ouverte reçoit `window.opener` et peut renaviguer l'onglet MIAOU. Le lien vient
// du modèle ou d'un contenu utilisateur, donc jamais de confiance.
if (window.DOMPurify) {
  DOMPurify.addHook('afterSanitizeAttributes', function(node) {
    if (node.tagName !== 'A') return;
    const href = node.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  });
}

// Sanitisation du HTML issu de marked (campagne relecture 2026-07) : le
// markdown du MODÈLE peut contenir du HTML inline (marked le laisse passer tel
// quel) — sans sanitisation, un payload reproduit par le modèle depuis une
// source hostile (page web lue par outil) s'exécuterait dans le DOM, avec
// accès aux clefs API du localStorage. DOMPurify (CDN, comme marked/Prism) ;
// s'il n'est pas chargé (offline), marked ne l'est probablement pas non plus
// (même CDN) et le fallback escHtml des renderers prend le relais — le cas
// marked-sans-DOMPurify laisse passer comme avant, dégradation assumée.
function sanitizeHtml(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}
function renderMd(text, opts) {
  const resolved = resolveConvRefs(text, opts);
  if (!window.marked) return escHtml(resolved).replace(/\n/g, '<br>');
  return sanitizeHtml(marked.parse(resolved, { breaks: true }));
}
// Variante pour les messages utilisateur : empêche les balises HTML de traverser
// vers le DOM (angle-brackets échappés) tout en conservant le markdown.
// Le `>` est laissé intact pour que les blockquotes fonctionnent.
function renderUserMd(text) {
  if (!window.marked) return escHtml(text).replace(/\n/g, '<br>');
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return sanitizeHtml(marked.parse(safe, { breaks: true }));
}
function highlightUnder(el) { if (highlightEnabled && window.Prism) Prism.highlightAllUnder(el); }

// ── Rendu Mermaid (lot E) ────────────────────────────────────────────────
// Lazy-load réel : Mermaid (~2,5 Mo minifié) n'est chargé qu'au premier bloc
// ```mermaid rencontré, par injection dynamique de <script> — pattern DIFFÉRENT
// de Prism (dont le cœur est un <script src> statique dans index.html), assumé :
// le poids ne doit être payé que si la feature sert. Promesse mémoïsée avec
// reset sur rejet (hygiène des caches async) : un échec CDN n'empoisonne pas la
// session, le prochain bloc retente.
// Config (mermaidInit) : securityLevel 'strict' posé EXPLICITEMENT (c'est le
// défaut Mermaid, mais un upgrade de version ne doit pas pouvoir l'assouplir en
// silence) — Mermaid sanitise lui-même labels/liens (DOMPurify interne) ; on ne
// re-passe PAS son SVG dans sanitizeHtml : DOMPurify généraliste ampute les
// <style> internes du SVG (rendu cassé) et la sanitisation amont couvre déjà le
// vecteur. htmlLabels:false : labels en <text> SVG pur, pas de <foreignObject>
// — prérequis de l'export PNG canvas (lot E3, canvas tainted sur Safari sinon) ;
// rendu des labels légèrement différent du défaut Mermaid, assumé.
// Cf. docs/rendering.md.
const MERMAID_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.13.0/mermaid.min.js';
let _mermaidPromise = null;
let _mermaidTheme = null;   // thème du dernier initialize (détection de changement)
let _mermaidUid = 0;

function mermaidInit(themeName) {
  _mermaidTheme = themeName;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: themeName,
  });
}

// ── Chargement borné d'une bibliothèque CDN ────────────────────────────────
// Point unique des <script src> chargés à la demande (Mermaid, QuickJS, fflate,
// pdf.js, SheetJS). Borné parce qu'un CDN qui accepte la connexion sans jamais
// répondre ne déclenche NI onload NI onerror : sans borne, la promesse mémoïsée
// de l'appelant reste pendante pour toujours, et avec elle l'outil qui l'attend
// — or Stop n'interrompt jamais un outil en vol (piège 10) : la génération
// restait bloquée sans issue. Même ordre de grandeur que DOC_WORKER_TIMEOUT_MS,
// qui borne déjà le chargement des bibliothèques dans le worker : large, parce
// que Mermaid pèse ~3 Mo et qu'une connexion lente n'est pas une panne.
// Résout sur onload SEULEMENT ; la garde « le global et ses fonctions sont
// là » reste à l'appelant, qui seul sait ce qu'il consomme.
//
// Nouvelle tentative après une borne atteinte : retirer le <script> n'annule
// PAS la requête, et le navigateur rattache une seconde requête sur la même URL
// à celle qui pend encore (mesuré : aucune requête réémise) — la tentative
// pendrait exactement comme la première. L'URL d'une tentative qui suit une
// expiration porte donc un paramètre qui la rend distincte ; les CDN servent le
// même fichier, seul le cache HTTP est contourné, et seulement dans ce cas.
const CDN_LOAD_TIMEOUT_MS = 120000;
const _cdnTimedOut = new Set();
function loadCdnScript(src, label) {
  const url = _cdnTimedOut.has(src)
    ? src + (src.indexOf('?') === -1 ? '?' : '&') + 'miaou-retry=' + Date.now()
    : src;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    let settled = false;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.onload = s.onerror = null;
      if (err) { s.remove(); reject(err); } else resolve();
    };
    const timer = setTimeout(() => {
      _cdnTimedOut.add(src);
      settle(new Error('chargement ' + label + ' (CDN) sans réponse après ' +
        Math.round(CDN_LOAD_TIMEOUT_MS / 1000) + ' s'));
    }, CDN_LOAD_TIMEOUT_MS);
    s.src = url;
    s.onload = () => settle(null);
    s.onerror = () => settle(new Error('échec de chargement ' + label + ' (CDN)'));
    document.head.appendChild(s);
  });
}

function ensureMermaid() {
  if (_mermaidPromise) return _mermaidPromise;
  _mermaidPromise = loadCdnScript(MERMAID_CDN, 'Mermaid').then(() => {
    if (!window.mermaid) throw new Error('mermaid absent après chargement');
    mermaidInit(mermaidThemeFor(document.documentElement.getAttribute('data-theme')));
    return window.mermaid;
  });
  _mermaidPromise.catch(() => { _mermaidPromise = null; });   // reset sur rejet → retry possible
  return _mermaidPromise;
}

// ── Moteur QuickJS-WASM pour js__eval (lot L) ────────────────────────────────
// Artefact tranché par le spike L0 : build IIFE `index.global.min.js` exposant
// le global `window.QJS`, WASM RELEASE_SYNC (synchrone, Model 2) INLINÉ dans ce
// fichier unique → un seul <script src>, 2 requêtes réseau totales, aucun fetch
// .wasm séparé, aucun module ES au niveau source (contrainte dure MIAOU). Version
// épinglée @0.32.0 comme Mermaid @11.13.0. Détail : AUDIT-L, section spike.
const QUICKJS_CDN = 'https://cdn.jsdelivr.net/npm/quickjs-emscripten@0.32.0/dist/index.global.min.js';
let _quickjsPromise = null;

// Lazy-load calqué sur ensureMermaid (précédent exact) : promesse mémoïsée,
// reset-on-reject (hygiène des caches async, cf. CLAUDE.md). Différence avec
// Mermaid : l'échec ici NE se dégrade PAS silencieusement — il se propage en
// rejet, capté par le handler js__eval qui le remonte en erreur d'outil propre
// (un compute demandé qui ne peut pas tourner doit le dire, pas échouer en
// silence comme un diagramme non rendu). La promesse résout le MODULE QuickJS
// prêt (post getQuickJS = WASM compilé), pas juste le script chargé.
function ensureQuickJs() {
  if (_quickjsPromise) return _quickjsPromise;
  _quickjsPromise = loadCdnScript(QUICKJS_CDN, 'QuickJS').then(() => {
    if (!window.QJS || typeof window.QJS.getQuickJS !== 'function') {
      throw new Error('QuickJS absent après chargement');
    }
    // getQuickJS() compile/instancie le WASM (async) et résout le module.
    return window.QJS.getQuickJS();
  });
  _quickjsPromise.catch(() => { _quickjsPromise = null; });   // reset sur rejet → retry possible
  return _quickjsPromise;
}

// ── fflate : décodage zip natif pour docs__list / docs__extract (lot V-1) ─────
// Artefact tranché à l'audit V (AUDIT §1) : build UMD 32 ko, posant `self.fflate`
// quand ni `module` ni `define` ne sont présents → compatible « pas de modules ES »
// (contrainte dure MIAOU). Hébergé sur jsdelivr et non cdnjs comme marked/Prism :
// cdnjs ne sert PAS fflate (api.cdnjs.com → 404 « Library not found », vérifié) ;
// le précédent QuickJS rend jsdelivr non exceptionnel ici. Le même fichier couvre
// unzip ET zip (`unzipSync`, `zipSync`, `strToU8`) : V-2 (création d'archive)
// n'aura ni second script ni changement d'artefact. Version épinglée comme
// mermaid@11.13.0 et quickjs-emscripten@0.32.0.
const FFLATE_CDN = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
let _fflatePromise = null;

// Lazy-load calqué sur ensureQuickJs — PAS sur ensureMermaid : ici l'échec se
// PROPAGE (rejet) au lieu de se dégrader en silence. Une extraction demandée qui
// ne peut pas tourner doit le dire ; le handler docs__* la remonte en erreur
// d'outil propre. Promesse mémoïsée, reset-on-reject (hygiène des caches async).
// Garde post-onload symétrique de celle de QuickJS : le global ET la fonction
// attendue, pas seulement le script chargé.
function ensureFflate() {
  if (_fflatePromise) return _fflatePromise;
  _fflatePromise = loadCdnScript(FFLATE_CDN, 'fflate').then(() => {
    // TOUTES les fonctions consommées, pas seulement celle du premier
    // appelant : docs__extract lit (unzipSync), docs__pack écrit (zipSync,
    // lot V-2), l'export de sauvegarde encode son manifeste (strToU8, lot
    // V-3). Un build CDN partiel échouerait sinon tardivement, dans un
    // handler async, au lieu d'échouer au chargement — exactement le mode de
    // défaillance tardif que cette garde existe pour empêcher. Ajouter un
    // consommateur d'une nouvelle fonction fflate = ajouter sa ligne ici.
    if (!window.fflate || typeof window.fflate.unzipSync !== 'function'
        || typeof window.fflate.zipSync !== 'function'
        || typeof window.fflate.strToU8 !== 'function') {
      throw new Error('fflate absent ou incomplet après chargement');
    }
    return window.fflate;
  });
  _fflatePromise.catch(() => { _fflatePromise = null; });   // reset sur rejet → retry possible
  return _fflatePromise;
}

// ── pdf.js : lecture PDF native pour docs__list / docs__read (lot V-4) ───────
// VERSION GELÉE à 3.11.174, et ce n'est pas un choix de confort : pdf.js 4.x et
// 5.x n'existent plus qu'en modules ES (vérifié au spike — `pdf.min.mjs` est le
// seul build proposé, la variante `legacy/` comprise). La contrainte dure MIAOU
// « pas de modules ES » fige donc la dépendance sur la dernière UMD publiée.
// Cette branche ne suivra pas l'amont ; le jour où MIAOU accepterait un module
// ES, la question se rouvre. Épinglée comme mermaid@11.13.0, fflate@0.8.2 et
// quickjs-emscripten@0.32.0.
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
let _pdfjsPromise = null;

// Lazy-load calqué sur ensureFflate (échec PROPAGÉ, promesse mémoïsée,
// reset-on-reject, garde post-onload sur TOUTES les fonctions consommées), avec
// une différence de CONTRAT : cette fonction résout « pdf.js PRÊT, worker
// compris », jamais « le script est chargé ». Aucun appelant ne pose workerSrc
// lui-même — même discipline qu'ensureQuickJs, qui résout le module WASM
// compilé et pas le script.
//
// Le worker RÉEL est une décision du lot (V-4 décision 1), pas un raffinement.
// L'alternative — le « fake worker » (workerSrc = '') — parse dans le THREAD
// PRINCIPAL : 1 106 ms pour 3 pages au spike, donc des dizaines de secondes de
// gel sur un rapport de 200 pages. Pendant ce gel, une génération en vol
// (piège 28) se figerait avec l'UI. Le lot T a passé beaucoup d'énergie à rendre
// les générations non bloquantes ; réintroduire un gel par le côté serait une
// régression architecturale, pas un désagrément.
//
// Le détour par blob: est obligatoire : un worker ne peut pas être chargé
// cross-origin depuis un CDN via workerSrc direct. Le fetch + createObjectURL
// contourne, et c'est aussi la seule voie qui reste compatible d'une page
// file:// — MIAOU est un fichier HTML unique, souvent ouvert en local.
// Coût assumé : +1,09 Mo et une requête de plus au PREMIER PDF ouvert.
function ensurePdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = loadCdnScript(PDFJS_CDN, 'pdf.js').then(() => {
    const lib = window.pdfjsLib;
    // Le global ET tout ce qu'on consomme : getDocument pour ouvrir,
    // GlobalWorkerOptions pour poser le worker. Un build CDN partiel doit
    // échouer ICI, pas plus tard dans un handler async (leçon V-3, où strToU8
    // manquait à la garde de fflate).
    if (!lib || typeof lib.getDocument !== 'function' || !lib.GlobalWorkerOptions) {
      throw new Error('pdf.js absent ou incomplet après chargement');
    }
    // Worker en blob:. L'échec se propage comme le reste : un PDF qu'on ne
    // peut pas ouvrir doit le dire, jamais retomber en silence sur un parsing
    // main thread qui gèlerait l'onglet. Borné comme le script (même motif que
    // loadCdnScript : un fetch qui ne répond jamais ne rejette jamais).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CDN_LOAD_TIMEOUT_MS);
    return fetch(PDFJS_WORKER_CDN, { signal: ctrl.signal })
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(b => {
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b);
        return lib;
      })
      .catch(e => { throw new Error('échec de chargement du worker pdf.js : ' + ((e && e.message) || e)); })
      .finally(() => clearTimeout(timer));
  });
  _pdfjsPromise.catch(() => { _pdfjsPromise = null; });   // reset sur rejet → retry possible
  return _pdfjsPromise;
}

// ── SheetJS : lecture Excel native pour docs__list / docs__read (lot V-5) ────
// VERSION GELÉE à 0.18.5, et pour une raison différente de pdf.js : SheetJS a
// QUITTÉ npm. 0.18.5 est la dernière version publiée sur le registre ; le projet
// distribue depuis sur son propre CDN. Épingler 0.18.5 via jsdelivr est stable
// (npm ne réécrit pas une version publiée) et garde le patron des cinq autres
// artefacts — mais cette branche ne recevra aucun correctif. Si un .xlsx réel
// refuse de s'ouvrir, la question se rouvre, et le fallback mcp_docs existe
// précisément pour que ce ne soit pas bloquant.
const SHEETJS_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let _sheetjsPromise = null;

// Même contrat qu'ensureFflate et ensurePdfJs (échec PROPAGÉ, promesse mémoïsée,
// reset-on-reject, garde post-onload sur TOUTES les fonctions consommées), en
// plus simple : SheetJS n'a pas de worker à câbler, donc « le script chargé » et
// « la bibliothèque prête » coïncident ici — ce qui n'était PAS le cas de pdf.js.
//
// LOT AD — CE QUE CETTE FONCTION EST DEVENUE, à lire avant de s'en servir :
// elle n'est PLUS le chemin de lecture des classeurs. Le parsing tourne dans le
// worker (importScripts), et aucun code applicatif ne l'appelle. Elle survit
// comme INSTRUMENT DE MESURE : verify-xlsx-structured.mjs charge SheetJS dans la
// page pour remesurer ses trois prémisses (origine non-A1, cellule voisine d'une
// fusion réellement absente, '!merges' absent) avant toute assertion de rendu.
// Son homologue ensureMammoth a été RETIRÉ, n'ayant pas cet usage.
// Ne pas la rebrancher sur un chemin de lecture : ce serait ramener le gel.
//
// Vérifié au spike plutôt que supposé : SheetJS ne DÉTACHE PAS le buffer qu'on
// lui passe (byteLength intact après read, deuxième lecture du même buffer OK).
// Le u8.slice() défensif d'openPdfDocument n'a donc pas à être reproduit ici —
// et cette phrase existe pour que le prochain ne le rajoute pas « par symétrie ».
//
// PRÉCISION DEVENUE NÉCESSAIRE AU LOT AD, qui a introduit un postMessage vers le
// worker : ce que la phrase ci-dessus garantit, c'est que LA BIBLIOTHÈQUE ne
// détache pas. NOUS le pourrions — postMessage(buf, [buf]) détache par contrat.
// C'est pourquoi runDocWorker COPIE au lieu de transférer : readXlsxDocument
// réutilise u8 après le parsing, pour xlsxImageAnchors. Ne pas lire « rien ne
// détache jamais » là où il est écrit « SheetJS ne détache pas ».
function ensureSheetJs() {
  if (_sheetjsPromise) return _sheetjsPromise;
  _sheetjsPromise = loadCdnScript(SHEETJS_CDN, 'SheetJS').then(() => {
    const lib = window.XLSX;
    // Le global ET tout ce qu'on consomme. Depuis AC-3 c'est `read` SEUL :
    // le rendu ne passe plus par utils.sheet_to_csv (les cellules sont lues
    // directement, pour ne perdre ni les formules ni les fusions). Garder
    // sheet_to_csv dans cette garde ferait échouer le chargement sur une
    // fonction dont plus rien ne dépend — et, pire, ferait croire qu'elle est
    // encore le chemin de rendu. Un build CDN partiel doit échouer ICI
    // (leçon V-3), sur ce qu'on utilise VRAIMENT.
    if (!lib || typeof lib.read !== 'function') {
      throw new Error('SheetJS absent ou incomplet après chargement');
    }
    return lib;
  });
  _sheetjsPromise.catch(() => { _sheetjsPromise = null; });   // reset sur rejet → retry possible
  return _sheetjsPromise;
}

// mammoth (lot V-5, étape 2) — lecture des .docx. Contrairement à SheetJS,
// mammoth est toujours publié sur npm : 1.11.0 est une version courante et non
// une branche gelée, l'épinglage est ici du conservatisme ordinaire.
//
// LOT AD : il n'y a PLUS de loader `ensureMammoth`. La bibliothèque est chargée
// par importScripts DANS le worker de parsing (cf. plus bas), donc plus rien ne
// la charge dans la page — garder le loader aurait laissé du code qu'aucun
// appelant n'atteint, tenu en vie par la seule symétrie avec ses frères.
// Seule l'URL survit : c'est le worker qui la consomme, et une bibliothèque a
// une seule adresse.
//
// Deux faits du spike V-5 restent vrais et méritent de ne pas se reperdre :
// la seule API consommée est convertToHtml (extractRawText perd les tableaux,
// convertToMarkdown les aplatit cellule par cellule en sur-échappant) — d'où la
// garde post-importScripts du worker, qui porte sur elle seule.
const MAMMOTH_CDN = 'https://cdn.jsdelivr.net/npm/mammoth@1.11.0/mammoth.browser.min.js';

// ── Worker de parsing documentaire (lot AD) ─────────────────────────────────
// POURQUOI : le parsing d'un .xlsx lourd GÈLE l'onglet. Mesuré sur une fixture
// de 37,9 Mo : 5 731 ms pendant lesquels rien ne se peint, rien ne se clique,
// et le navigateur propose de tuer la page. Le docx suit, en moins spectaculaire
// (493-725 ms sur 3,3 Mo). Ce n'est pas un problème de vitesse — le worker ne
// fait PAS gagner de temps (+2 à +6 % de coût total) — c'est que l'UI reste
// vivante pendant.
//
// Deux conséquences qui dépassent le confort :
//   - une GÉNÉRATION EN VOL (piège 28) se fige avec l'UI. Le lot T a dépensé
//     beaucoup d'énergie à rendre les générations non bloquantes ; un parsing
//     main-thread de 5,7 s est une régression architecturale par le côté.
//   - le Stop ne peut RIEN : XLSX.read n'est pas préemptible, aucun
//     AbortController ne l'atteint. Le worker rend l'interruption possible
//     (terminate()) — capacité NON câblée dans ce lot, délibérément.
//
// LE PPTX NE PASSE PAS ICI, et ce n'est pas un oubli : voir le commentaire
// d'openPptxDocument (docs.js), qui porte la mesure et le motif.
//
// CONTRAT, calqué sur ensurePdfJs : la fonction résout « prêt », jamais « le
// script est chargé ». Aucun appelant ne câble le worker lui-même.
// Différence avec pdf.js : PAS de fetch + createObjectURL pour la lib. Le worker
// fait importScripts(CDN), qui accepte le cross-origin — c'est `workerSrc` de
// pdf.js qui ne l'acceptait pas. Le blob: reste nécessaire pour la source DU
// WORKER, pas pour la bibliothèque.
//
// Worker JETABLE par appel : pas d'état résiduel, terminate() trivial, et les
// ~50 ms d'importScripts sont négligeables devant un parsing qui se compte en
// secondes. Un worker persistant imposerait une invalidation et un cycle de vie
// à raisonner pour économiser 1 %.
//
// ÉCHEC PROPAGÉ, jamais de repli silencieux en main thread : un repli rendrait
// le gel intermittent, donc indiagnosticable (même posture que le worker pdf.js).

// Les purs que le worker doit exécuter, injectés par leur SOURCE VIVE. Le worker
// ne peut pas les appeler autrement : il n'a pas accès au scope de la page.
//
// JAMAIS de copie manuelle de ces fonctions ici. Deux copies divergent, et les
// tests QuickJS ne couvriraient que l'une — c'est la forme « instrument qui
// compte la source au lieu de la sortie composée » du contrôle vert qui ne
// prouve rien. Function.prototype.toString() rend la source telle qu'elle a été
// PARSÉE, donc celle du bundle (commentaires retirés par strip_js_comments) et
// non celle de src/ : vérifié à l'exécution, c'est du JS valide et complet.
//
// PRÉCONDITION que ce mécanisme impose au domaine : ces fonctions forment un
// graphe CLOS — chacune n'appelle que ses pairs de cette liste, aucune constante
// de module, aucun global applicatif. Une seule référence extérieure ajoutée à
// l'une d'elles (MAX_XLSX_ROWS_DEFAULT, par exemple) casserait le worker
// SILENCIEUSEMENT à l'exécution, en ReferenceError loin de sa cause. C'est
// verify-docs-worker.mjs qui garde cette propriété, en comparant le résultat du
// worker à celui du main thread.
const DOC_WORKER_PURES = [
  'colIndexToLetter', 'colLetterToIndex', 'parseA1Range', 'formatA1Range',
  'restrictSheetRange', 'sheetToMatrix',
  // parseSheetSelector a besoin de wb.SheetNames, qui n'existe QUE dans le
  // worker. L'injecter évite un second aller-retour (« rends-moi les feuilles »,
  // puis « lis celle-ci ») — et surtout évite de parser deux fois le classeur,
  // ce qui doublerait le coût que le lot vise à supprimer.
  'parseSheetSelector',
  // Côté docx : le callback convertImage doit apparier les octets qu'il reçoit
  // à une pièce de word/media/, et la clé est (taille, hash) — donc le hash se
  // calcule DANS le worker, sur les octets que mammoth lui donne.
  'fnv1aBytes', 'mediaMatchKey',
];

// Compose la source du worker : les purs, puis le corps qui les orchestre.
// Le corps est un template literal ordinaire — attention, comme EXPORT_SCRIPT,
// à ne JAMAIS y mettre de backtick (piège 22).
function docWorkerSource() {
  const pures = DOC_WORKER_PURES
    .map((n) => {
      const fn = globalThis[n];
      if (typeof fn !== 'function') {
        throw new Error('pur manquant pour le worker documentaire : ' + n);
      }
      return Function.prototype.toString.call(fn);
    })
    .join('\n\n');

  return pures + '\n' + DOC_WORKER_BODY;
}

// Le corps du worker. Un message par OPÉRATION (list / read / describe) : les
// trois consommateurs xlsx tirent des choses différentes du même classeur, et
// renvoyer le workbook pour les laisser choisir coûterait 1,3 s de gel au
// postMessage (mesuré) — un worker à moitié raté, dont personne ne verrait
// qu'il l'est. Le worker renvoie donc ce qui est DÉJÀ EXTRAIT ET BORNÉ.
const DOC_WORKER_BODY = [
  "self.onmessage = async (ev) => {",
  "  const msg = ev.data || {};",
  "  const reply = (payload) => self.postMessage(payload);",
  "  try {",
  "    if (msg.lib === 'sheetjs') {",
  "      importScripts(msg.cdn);",
  "      const XLSX = self.XLSX;",
  "      if (!XLSX || typeof XLSX.read !== 'function') throw new Error('SheetJS absent ou incomplet apres importScripts');",
  "      const wb = XLSX.read(msg.bytes, { type: 'array' });",
  "      if (!wb || !wb.SheetNames || !wb.SheetNames.length) { reply({ ok: false, empty: true }); return; }",
  // Les dimensions de TOUTES les feuilles : c'est le seul dénominateur commun
  // aux trois opérations, et c'est minuscule (un objet par feuille).
  "      const sheets = wb.SheetNames.map((name) => {",
  "        const sh = wb.Sheets[name];",
  "        const refA1 = (sh && sh['!ref']) ? String(sh['!ref']) : '';",
  "        const r = refA1 ? parseA1Range(refA1) : null;",
  "        return { name: name, ref: refA1, rows: r ? (r.e.r - r.s.r + 1) : 0, cols: r ? (r.e.c - r.s.c + 1) : 0 };",
  "      });",
  "      if (msg.op === 'list') { reply({ ok: true, sheets: sheets }); return; }",
  "      if (msg.op === 'read') {",
  // Le selector est résolu ICI parce que lui seul connaît wb.SheetNames. Les
  // refus (feuille introuvable, plage invalide) remontent tels quels : c'est
  // l'appelant qui les tourne en toolFail, le worker ne connaît pas les outils.
  "        const sel = parseSheetSelector(msg.selector, wb.SheetNames);",
  "        if (!sel.ok) { reply({ ok: true, sheets: sheets, selectorFail: sel.message }); return; }",
  "        const sheet = wb.Sheets[sel.sheet];",
  "        const sheetRef = (sheet && sheet['!ref']) ? String(sheet['!ref']) : '';",
  "        if (!sheetRef) { reply({ ok: true, sheets: sheets, sheetName: sel.sheet, emptySheet: true }); return; }",
  "        const restricted = restrictSheetRange(sheetRef, sel.range);",
  "        if (restricted.fail) { reply({ ok: true, sheets: sheets, sheetName: sel.sheet, restrictFail: restricted.fail }); return; }",
  "        const matrix = sheetToMatrix(sheet, restricted.ref);",
  "        reply({ ok: true, sheets: sheets, sheetName: sel.sheet, hadRange: !!sel.range, matrix: matrix, ref: restricted.ref, notice: restricted.notice });",
  "        return;",
  "      }",
  "      if (msg.op === 'describe') {",
  // La première feuille NON VIDE, bornée à msg.previewRows lignes : exactement
  // ce que describeXlsxForLibrary consomme, calculé ici pour que le gel du
  // DÉPÔT de fichier disparaisse lui aussi (c'est le geste qui a produit le
  // rapport d'origine).
  "        let preview = null;",
  "        for (const s of sheets) {",
  "          if (!s.ref) continue;",
  "          const box = parseA1Range(s.ref);",
  "          if (!box) continue;",
  "          const lastRow = Math.min(box.e.r, box.s.r + (msg.previewRows || 10) - 1);",
  "          const previewRef = formatA1Range({ s: box.s, e: { r: lastRow, c: box.e.c } });",
  "          preview = { sheet: s.name, ref: previewRef, matrix: sheetToMatrix(wb.Sheets[s.name], previewRef) };",
  "          break;",
  "        }",
  "        reply({ ok: true, sheets: sheets, preview: preview });",
  "        return;",
  "      }",
  "      throw new Error('operation inconnue pour sheetjs : ' + msg.op);",
  "    }",
  "    if (msg.lib === 'mammoth') {",
  "      importScripts(msg.cdn);",
  "      const mammoth = self.mammoth;",
  "      if (!mammoth || typeof mammoth.convertToHtml !== 'function') throw new Error('mammoth absent ou incomplet apres importScripts');",
  // Le HTML est le payload, et c'est mesuré : convertImage remplace les octets
  // par des CHEMINS, donc le HTML reste petit (facteur 11 sans lui). Sans
  // convertImage, mammoth encode chaque image en base64 DANS le HTML — ce qui
  // ferait exploser le postMessage autant que le workbook.
  "      const u8 = msg.bytes;",
  "      const ab = (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) ? u8.buffer : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);",
  "      const index = msg.mediaIndex || {};",
  "      const convertImage = (mammoth.images && mammoth.images.imgElement)",
  "        ? mammoth.images.imgElement(async (image) => {",
  "            let src = '';",
  "            try {",
  "              const bytes = await image.readAsBuffer();",
  "              src = (bytes && index[mediaMatchKey(bytes.length, fnv1aBytes(bytes))]) || '';",
  "            } catch (e) { src = ''; }",
  "            return { src: src };",
  "          })",
  "        : null;",
  "      const res = convertImage",
  "        ? await mammoth.convertToHtml({ arrayBuffer: ab }, { convertImage: convertImage })",
  "        : await mammoth.convertToHtml({ arrayBuffer: ab });",
  "      reply({ ok: true, html: (res && res.value) || '' });",
  "      return;",
  "    }",
  "    throw new Error('bibliotheque inconnue : ' + msg.lib);",
  "  } catch (err) {",
  "    reply({ ok: false, error: String((err && err.message) || err) });",
  "  }",
  "};",
].join('\n');

// Borne de sécurité : un worker qui ne répond jamais laisserait l'appelant
// suspendu pour toujours, et la promesse d'un document qui ne s'ouvre pas est
// pire que son refus. Tout appel est borné, sans exception (piège :
// project_fetch_timeout_required — la règle vise les appels réseau, et un
// worker qui fait importScripts EST un appel réseau).
const DOC_WORKER_TIMEOUT_MS = 120000;

// Exécute une requête de parsing dans un worker jetable.
// Rend la réponse du worker ({ ok: true, … }) ou LÈVE — l'échec est propagé,
// jamais un repli main thread (cf. le commentaire de tête).
//
// terminate() en finally, sur TOUS les chemins : succès, échec, timeout. Un
// worker oublié garde son thread et ses ~30 Mo d'octets vivants.
function runDocWorker(request) {
  return new Promise((resolve, reject) => {
    let source;
    try { source = docWorkerSource(); }
    catch (e) { reject(e); return; }

    let url = null, w = null, timer = null;
    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (w) { try { w.terminate(); } catch (_e) {} w = null; }
      if (url) { try { URL.revokeObjectURL(url); } catch (_e) {} url = null; }
    };

    try {
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (e) {
      cleanup();
      reject(new Error('création du worker impossible : ' + ((e && e.message) || e)));
      return;
    }

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('le worker de parsing n\'a pas répondu (délai dépassé)'));
    }, DOC_WORKER_TIMEOUT_MS);

    w.onmessage = (ev) => {
      const data = ev.data || {};
      cleanup();
      if (data.ok === false && data.error) { reject(new Error(data.error)); return; }
      resolve(data);
    };
    // onerror couvre l'échec d'importScripts (CDN injoignable) et toute
    // exception non rattrapée du worker : sans lui, le seul filet serait le
    // timeout, soit deux minutes d'attente pour une erreur immédiate.
    w.onerror = (ev) => {
      cleanup();
      reject(new Error('erreur du worker de parsing : ' + ((ev && ev.message) || 'inconnue')));
    };

    try {
      // COPIE, jamais de transfert. postMessage(buf, [buf]) éviterait la copie
      // de 30 Mo mais DÉTACHERAIT u8 côté appelant — or readXlsxDocument
      // réutilise u8 après le parsing, pour xlsxImageAnchors. Mesuré : la copie
      // est comprise dans les 18 ms de gel du worker, donc elle ne coûte rien
      // d'observable.
      w.postMessage(request);
    } catch (e) {
      cleanup();
      reject(new Error('envoi au worker impossible : ' + ((e && e.message) || e)));
    }
  });
}

// Les deux entrées publiques du domaine. Elles portent le CDN plutôt que de le
// laisser au worker : la constante vit ici, aux côtés des quatre autres
// lazy-loads, et une seule source d'URL par bibliothèque.
function parseXlsxInWorker(u8, op, opts) {
  const o = opts || {};
  return runDocWorker({
    lib: 'sheetjs', cdn: SHEETJS_CDN, op: op, bytes: u8,
    selector: o.selector || '', previewRows: o.previewRows || 0,
  });
}

function parseDocxInWorker(u8, mediaIndex) {
  return runDocWorker({
    lib: 'mammoth', cdn: MAMMOTH_CDN, bytes: u8, mediaIndex: mediaIndex || {},
  });
}

// Passe de rendu : transforme chaque bloc ```mermaid de `scope` en diagramme.
// Appelée à la FINALISATION uniquement — finalizeAssistant et buildMsg, JAMAIS
// streamInto (source partielle = flicker + erreurs de parse en cascade).
// Fire-and-forget : les appelants n'attendent pas.
// Architecture : le <pre> n'est JAMAIS détruit ; la vue rendue (.mermaid-view)
// vit DANS le <pre> (précédent .code-head, div déjà insérée là par decoratePre)
// pour que l'en-tête — et donc le bouton toggle — reste visible dans les deux
// états. La classe .mermaid-rendered sur le <pre> inverse code ↔ vue (CSS).
// code.textContent reste l'unique source de vérité (re-render thème, exports,
// lightbox relisent là).
// Échec de parse → <pre> intact + notice .mermaid-error, jamais de rendu cassé ;
// l'échec est mémorisé par source (pre._mermaidErrSrc) pour ne pas retenter la
// même source invalide à chaque passe (le re-render d'un message édité change
// la source → retente). CDN indisponible → silencieux, la source surlignée
// reste (même dégradation que marked/DOMPurify offline).
async function renderMermaidUnder(scope) {
  const codes = scope.querySelectorAll('code.language-mermaid');
  if (!codes.length) return;
  let mm;
  try { mm = await ensureMermaid(); }
  catch (e) { return; }
  for (const code of codes) {
    const pre = code.closest('pre');
    if (!pre) continue;
    const src = sanitizeMermaidSource(code.textContent);   // strippe <b>/<i>… inertes ; textContent intact
    const existing = pre.querySelector('.mermaid-view');
    if (existing && existing._mermaidSrc === src) continue;   // déjà rendu pour cette source
    if (pre._mermaidErrSrc === src) continue;                 // déjà en échec pour cette source
    // Id unique exigé par mermaid.render : compteur + suffixe aléatoire
    // (jamais un timestamp seul — deux rendus dans la même ms collisionnent).
    const uid = 'mmd' + (++_mermaidUid) + Math.random().toString(36).slice(2, 8);
    try {
      const out = await mm.render(uid, src);
      // Garde anti-obsolescence : le DOM a pu changer pendant l'await
      // (re-render du fil, édition). isConnected est vrai au retour de
      // microtâche pour un wrap construit par buildMsg puis appendé.
      if (!pre.isConnected || sanitizeMermaidSource(code.textContent) !== src) continue;
      const stale = pre.querySelector('.mermaid-view');
      if (stale) stale.remove();
      const oldNote = pre.querySelector('.mermaid-error');
      if (oldNote) oldNote.remove();
      pre._mermaidErrSrc = null;
      const view = document.createElement('div');
      view.className = 'mermaid-view';
      view.innerHTML = out.svg;   // markup produit par Mermaid strict — pas de re-sanitisation (cf. en-tête)
      view._mermaidSrc = src;
      attachDiagramActions(view, code);   // agrandir + exports SVG/PNG (lot E3)
      pre.appendChild(view);
      pre.classList.add('mermaid-rendered');
      const toggle = pre.querySelector('.code-mmd-toggle');
      if (toggle) toggle.removeAttribute('hidden');
    } catch (e) {
      // Mermaid v11 peut laisser un nœud d'erreur orphelin dans document.body.
      ['d' + uid, uid].forEach(id => {
        const orphan = document.getElementById(id);
        if (orphan) orphan.remove();
      });
      if (!pre.isConnected || sanitizeMermaidSource(code.textContent) !== src) continue;
      pre._mermaidErrSrc = src;
      pre.classList.remove('mermaid-rendered');
      // Notice réécrite si elle existe déjà : une source éditée peut échouer
      // pour une autre raison, et le message doit être celui de CET échec.
      let note = pre.querySelector('.mermaid-error');
      if (!note) {
        note = document.createElement('div');
        note.className = 'mermaid-error';
        pre.appendChild(note);
      }
      note.textContent = mermaidErrorNotice(e);
    }
  }
}

// Re-render au changement de thème résolu. Hook UNIQUE, appelé par applyTheme —
// couvre donc selectTheme ET le suivi matchMedia OS. mermaid.initialize ne
// ré-applique pas le thème aux SVG déjà rendus : purge des vues puis re-render
// explicite. La classe .mermaid-rendered est conservée pendant le re-render
// (pas de flash de source) ; un échec inattendu la retire (chemin d'erreur de
// renderMermaidUnder).
function refreshMermaidTheme(resolved) {
  if (typeof window === 'undefined' || !window.mermaid || !_mermaidPromise) return;
  const t = mermaidThemeFor(resolved);
  if (t === _mermaidTheme) return;
  mermaidInit(t);
  const thread = $('thread');
  if (!thread) return;
  thread.querySelectorAll('.mermaid-view').forEach(v => v.remove());
  renderMermaidUnder(thread);   // fire-and-forget
}
// ── Exports d'image & lightbox Mermaid (lot E3) ──────────────────────────────
// Sérialise le SVG rendu avec des dimensions EXPLICITES tirées du viewBox :
// Mermaid pose width="100%" + style max-width, dont la taille intrinsèque
// retombe à 300×150 quand le XML est rasterisé via <img> (export PNG). Clone
// normalisé — le SVG affiché n'est jamais touché.
function serializeDiagramSvg(svgEl) {
  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  const rect = svgEl.getBoundingClientRect();
  const w = (vb && vb.width) || rect.width || 800;
  const h = (vb && vb.height) || rect.height || 600;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.style.maxWidth = '';
  return { xml: new XMLSerializer().serializeToString(clone), w, h };
}

function downloadDiagramSvg(svgEl, rawName) {
  const s = serializeDiagramSvg(svgEl);
  downloadFile(diagramImageName(rawName, 'svg'), s.xml, 'image/svg+xml');
}

// PNG : SVG sérialisé → Blob → <img> → canvas 2x (dimensions viewBox) →
// toBlob → downloadFile (seul point d'entrée download du projet ; Blob accepte
// un Blob comme part, pas de chemin parallèle). Fond OPAQUE rempli avec le
// --code-bg résolu du thème actif avant drawImage : un PNG transparent issu du
// thème sombre est illisible collé dans un document clair. htmlLabels:false
// (mermaidInit) garantit l'absence de <foreignObject> → canvas jamais tainted.
function downloadDiagramPng(svgEl, rawName) {
  const s = serializeDiagramSvg(svgEl);
  const url = URL.createObjectURL(new Blob([s.xml], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(s.w * 2);
    canvas.height = Math.round(s.h * 2);
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const bg = (cs.getPropertyValue('--code-bg') || cs.getPropertyValue('--bg')).trim() || '#fff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) downloadFile(diagramImageName(rawName, 'png'), blob, 'image/png');
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// Barre d'actions posée par renderMermaidUnder sur chaque .mermaid-view :
// agrandir (lightbox) + exports SVG/PNG. Câblage en CLOSURES comme decoratePre
// — pas de nouveaux handlers globaux, la liste CLAUDE.md est inchangée. La
// source des exports est TOUJOURS le SVG courant de la vue (relu au clic),
// jamais une référence figée : le re-render thème remplace la vue entière
// (actions recréées avec), mais inutile de parier sur l'ordre.
function attachDiagramActions(view, code) {
  const svgExpand = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  const bar = document.createElement('div');
  bar.className = 'mermaid-actions';
  const rawName = () => (code ? code.getAttribute('data-filename') : '');
  const svg = () => view.querySelector('svg');
  const mk = (cls, title, html, fn) => {
    const b = document.createElement('button');
    b.className = cls;
    b.title = title;
    b.innerHTML = html;
    b.onclick = fn;
    bar.appendChild(b);
  };
  mk('mermaid-btn mermaid-btn-expand', 'Agrandir', svgExpand,
     () => { const el = svg(); if (el) openMermaidLightbox(el, rawName()); });
  mk('mermaid-btn', 'Télécharger en SVG', 'SVG',
     () => { const el = svg(); if (el) downloadDiagramSvg(el, rawName()); });
  mk('mermaid-btn', 'Télécharger en PNG', 'PNG',
     () => { const el = svg(); if (el) downloadDiagramPng(el, rawName()); });
  view.appendChild(bar);
}

// Lightbox pan/zoom : singleton DOM créé au premier usage, affiche un CLONE du
// SVG rendu (l'original reste dans le fil). Transform CSS translate+scale sur
// un wrapper interne (transform-origin 0 0 → maths de zoom centré curseur
// triviales). Molette = zoom autour du curseur, drag = pan, double-clic =
// reset (re-fit), Esc (cascade D-Esc, niveau prioritaire) + clic hors diagramme
// + bouton × = fermer. Vanilla, pas de lib.
let _lbEl = null;        // overlay singleton
let _lbCanvas = null;    // wrapper transformé
let _lbName = '';        // data-filename du diagramme affiché (exports)
let _lbScale = 1, _lbTx = 0, _lbTy = 0;
let _lbW = 0, _lbH = 0;  // dimensions viewBox du clone courant

function lbApply() {
  _lbCanvas.style.transform = `translate(${_lbTx}px, ${_lbTy}px) scale(${_lbScale})`;
}

// Reset / état initial : fit dans la scène avec marge, sans jamais agrandir
// (un petit diagramme reste net à l'échelle 1), centré.
function lbFit() {
  const stage = _lbEl.querySelector('.mermaid-lightbox-stage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  if (!sw || !sh) return;   // lightbox cachée (display:none) : dimensions nulles, ne rien calculer
  _lbScale = Math.min(1, (sw - 48) / _lbW, (sh - 48) / _lbH);
  if (!(_lbScale > 0)) _lbScale = 1;
  _lbTx = (sw - _lbW * _lbScale) / 2;
  _lbTy = (sh - _lbH * _lbScale) / 2;
  lbApply();
}

// A3-2 : boutons taggés par mode ('mermaid' | 'image'), togglés via `hidden`
// plutôt que reconstruits — la barre ne bouge plus après création, mais les
// closures SVG/PNG ne s'exécutent jamais en mode image (elles restent
// cachées, jamais retirées du DOM).
let _lbDlBtn = null;   // bouton Télécharger, mode image — closure reciblée à chaque open

function ensureLightbox() {
  if (_lbEl) return _lbEl;
  _lbEl = document.createElement('div');
  _lbEl.className = 'mermaid-lightbox';
  const stage = document.createElement('div');
  stage.className = 'mermaid-lightbox-stage';
  _lbCanvas = document.createElement('div');
  _lbCanvas.className = 'mermaid-lightbox-canvas';
  stage.appendChild(_lbCanvas);
  const bar = document.createElement('div');
  bar.className = 'mermaid-lightbox-actions';
  const svg = () => _lbCanvas.querySelector('svg');
  const mk = (title, html, fn) => {
    const b = document.createElement('button');
    b.className = 'mermaid-lb-btn';
    b.title = title;
    b.innerHTML = html;
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  const svgBtn = mk('Télécharger en SVG', 'SVG', () => { const el = svg(); if (el) downloadDiagramSvg(el, _lbName); });
  const pngBtn = mk('Télécharger en PNG', 'PNG', () => { const el = svg(); if (el) downloadDiagramPng(el, _lbName); });
  _lbDlBtn = mk('Télécharger', ICON_DOWNLOAD, () => {});
  mk('Fermer', '×', closeMermaidLightbox);
  _lbEl._svgBtn = svgBtn;
  _lbEl._pngBtn = pngBtn;
  _lbEl.appendChild(stage);
  _lbEl.appendChild(bar);

  // Zoom centré curseur : le point sous le curseur reste fixe. Avec
  // transform-origin 0 0 : p_écran = t + p_monde·s, donc t' = p − (p − t)·f.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const next = _lbScale * f;
    if (next < 0.1 || next > 24) return;
    const rect = stage.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    _lbTx = px - (px - _lbTx) * f;
    _lbTy = py - (py - _lbTy) * f;
    _lbScale = next;
    lbApply();
  }, { passive: false });

  // Pan au drag (pointer capture : le drag survit à la sortie de la scène).
  // Un pointerup sans mouvement sur le FOND de la scène — pas sur le diagramme
  // — vaut « clic hors » et ferme ; un vrai drag ne ferme jamais. ATTENTION :
  // setPointerCapture RECIBLE les pointerup vers la scène (e.target === stage
  // même en cliquant le diagramme) — la cible réelle du clic doit être figée
  // AU pointerdown, avant la capture, sinon tout clic ferme la lightbox.
  let dragging = false, moved = false, lx = 0, ly = 0, downTarget = null;
  stage.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    downTarget = e.target;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    if (!dx && !dy) return;
    _lbTx += dx; _lbTy += dy; lx = e.clientX; ly = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) >= 1) moved = true;
    lbApply();
  });
  stage.addEventListener('pointerup', () => {
    dragging = false;
    stage.classList.remove('dragging');
    if (!moved && downTarget === stage) closeMermaidLightbox();
  });
  stage.addEventListener('dblclick', lbFit);

  document.body.appendChild(_lbEl);
  return _lbEl;
}

// A3-2 : cœur commun mermaid/image — dimensionne `_lbCanvas`, affiche, fit.
// `contentEl` est déjà le nœud à insérer (clone SVG ou <img>), construit par
// l'appelant : `openLightboxWith` ne connaît pas son origine.
function openLightboxWith(contentEl, w, h, rawName, mode) {
  ensureLightbox();
  _lbName = rawName || '';
  _lbW = w || 800;
  _lbH = h || 600;
  _lbCanvas.textContent = '';
  _lbCanvas.appendChild(contentEl);
  _lbCanvas.style.width = _lbW + 'px';
  _lbCanvas.style.height = _lbH + 'px';
  const isImage = mode === 'image';
  _lbEl._svgBtn.hidden = isImage;
  _lbEl._pngBtn.hidden = isImage;
  _lbDlBtn.hidden = !isImage;
  _lbEl.classList.add('show');
  lbFit();
}

function openMermaidLightbox(svgEl, rawName) {
  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  const rect = svgEl.getBoundingClientRect();
  const w = (vb && vb.width) || rect.width || 800;
  const h = (vb && vb.height) || rect.height || 600;
  // Le clone GARDE son id : le <style> interne de Mermaid scope toutes ses
  // règles par #<id> — le retirer rend le diagramme totalement dé-stylé. L'id
  // dupliqué dans le document est assumé : les règles CSS (identiques) matchent
  // les deux occurrences, et rien ne fait de getElementById dessus.
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.style.maxWidth = '';
  openLightboxWith(clone, w, h, rawName, 'mermaid');
}

// A3-2 : mode image — pièce jointe de bulle envoyée (record du cache session,
// mêmes bytes que resolveAttachmentThumb, déjà downscalés ≤1536px à
// l'ingestion — pas de "pleine taille" distincte à résoudre). `<img>` créé par
// `createElement` + `src` en propriété JS, jamais en template string (piège 23).
function openAttachmentLightbox(record) {
  const img = document.createElement('img');
  img.src = 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data);
  img.alt = '';
  // openLightboxWith → ensureLightbox() en premier : _lbDlBtn n'existe qu'après
  // (créé au premier usage du singleton), d'où l'ordre (jamais l'inverse).
  openLightboxWith(img, record.w || 800, record.h || 600, record.name, 'image');
  _lbDlBtn.onclick = () => downloadFile(record.name, record.data, record.mime);
}

// A3-2 : mode image — image modèle inline (`.tool-block-img`, résultat
// d'outil). Éphémère (jamais persistée, cf. placeToolBlocks) : pas de
// name/w/h figés au schéma, dimensions lues sur l'<img> déjà rendu
// (naturalWidth/Height, disponibles une fois l'image chargée dans le DOM).
// Téléchargement dérivé du `src` data-URI existant (pas de record IDB ici).
function openToolImageLightbox(imgEl) {
  const w = imgEl.naturalWidth || imgEl.width || 800;
  const h = imgEl.naturalHeight || imgEl.height || 600;
  const clone = document.createElement('img');
  clone.src = imgEl.src;
  clone.alt = '';
  openLightboxWith(clone, w, h, '', 'image');
  _lbDlBtn.onclick = () => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(imgEl.src);
    if (m) downloadFile('image.' + (m[1].split('/')[1] || 'png'), b64ToBytes(m[2]), m[1]);
  };
}

function closeMermaidLightbox() {
  if (!_lbEl) return;
  _lbEl.classList.remove('show');
  _lbCanvas.textContent = '';   // libère le clone (un gros SVG n'a pas à survivre fermé)
}

// Niveau prioritaire de la cascade Escape (D-Esc) : la lightbox est l'overlay
// le plus « au-dessus » de l'application (z-index > drawers).
function closeMermaidLightboxViaEscape() {
  if (!_lbEl || !_lbEl.classList.contains('show')) return false;
  closeMermaidLightbox();
  return true;
}

// Autoscroll pendant le streaming : ne suit le bas du fil que si l'utilisateur
// s'y trouvait déjà avant le rendu (isAtBottom), pour ne pas arracher la vue
// d'un lecteur remonté consulter une réponse précédente ou un raisonnement en
// cours. Tolérance en pixels car un scrollHeight recalculé après rendu markdown
// peut différer de quelques px de la position "pile en bas" mesurée avant.
const AUTOSCROLL_TOLERANCE_PX = 24;

function isAtBottom() {
  const m = $('messages');
  if (!m) return true;
  return m.scrollHeight - m.scrollTop - m.clientHeight <= AUTOSCROLL_TOLERANCE_PX;
}

// scrollBottom(force) : force=true ramène toujours en bas (nouveau message
// user, nouvelle bulle assistant, ouverture de conversation). Sans argument,
// ne scrolle que si l'utilisateur était déjà en bas — cf. isAtBottom.
function scrollBottom(force) {
  const m = $('messages');
  if (!m) return;
  if (!force && !isAtBottom()) return;
  m.scrollTop = m.scrollHeight;
  syncScrollBottomBtn();
}

// Maintient le fil collé au fond pendant que sa hauteur se stabilise après un
// rendu complet (ouverture d'une conversation, rechargement).
//
// `scrollBottom(true)` seul ne suffit PAS : il colle au fond la hauteur du
// MOMENT, mais le fil grandit encore après — coloration Prism en lazy-load,
// décoration des blocs de code, diagrammes, images qui arrivent. Chaque
// croissance postérieure éloigne d'autant du bas, et on ouvrait une
// conversation à 332px du haut pour un maximum de 3095 (mesuré).
//
// Un ResizeObserver capte TOUTE croissance tardive sans avoir à énumérer ses
// causes — l'énumération serait fausse au prochain contributeur de hauteur.
// Il se retire de lui-même après un délai de calme : au-delà, une croissance
// n'est plus la fin du rendu initial mais un événement de la vie du fil
// (streaming, dépliage d'un raisonnement), qui ne doit rien forcer.
const THREAD_SETTLE_MS = 900;
let _settleRO = null;
let _settleTimer = null;

function stickToBottomWhileSettling() {
  const m = $('messages');
  const thread = $('thread');
  if (!m || !thread || typeof ResizeObserver === 'undefined') return;
  stopStickToBottom();
  _settleRO = new ResizeObserver(() => { m.scrollTop = m.scrollHeight; syncScrollBottomBtn(); });
  _settleRO.observe(thread);
  _settleTimer = setTimeout(stopStickToBottom, THREAD_SETTLE_MS);
}

// Débranché dès qu'une génération démarre ou que l'utilisateur fait un geste :
// le collage au fond est une phase de rendu, pas un mode de lecture.
function stopStickToBottom() {
  if (_settleRO) { _settleRO.disconnect(); _settleRO = null; }
  if (_settleTimer) { clearTimeout(_settleTimer); _settleTimer = null; }
}

// ── Plafond d'autoscroll pendant le streaming ───────────────────────────────
// Sans plafond, une réponse plus haute que l'écran fait défiler la question qui
// l'a provoquée hors du champ : on lit une réponse dont on ne voit plus l'énoncé.
// Le plafond fige donc le suivi dès que le haut de la dernière bulle user
// atteindrait le haut du viewport du fil — la génération continue d'écrire, la
// vue reste sur l'énoncé, et le bouton « aller tout en bas » apparaît.
//
// ANCRAGE DOUX : le plafond est LEVÉ pour le reste de la génération dès que
// l'utilisateur redescend au fond de son plein gré (clic sur le bouton, ou
// scroll manuel jusqu'en bas). Il se réarme au tour suivant, quand une nouvelle
// bulle user devient l'ancre.
//
// L'état est clefé PAR CONVERSATION et non porté par une globale d'écran : une
// génération n'écrit jamais dans l'écran mais dans SA conversation (piège 28),
// et on peut ouvrir un fil d'agent ou revenir sur un parent réveillé pendant
// qu'il travaille.
const _scrollCapReleased = new Set();   // Set<convId> — plafond levé pour ce tour

function releaseScrollCap(convId) {
  if (convId != null) _scrollCapReleased.add(convId);
}

function armScrollCap(convId) {
  if (convId != null) _scrollCapReleased.delete(convId);
}

function scrollCapReleased(convId) {
  return convId != null && _scrollCapReleased.has(convId);
}

// ── Contenu non vu, pour la pulsation du bouton « aller tout en bas » ───────
// Le bouton ne brille que s'il y a quelque chose à ALLER VOIR : du contenu est
// arrivé en bas du fil alors que l'utilisateur regardait plus haut. Ce n'est
// PAS « une génération tourne » — une attente sans rien d'écrit n'a rien à
// montrer, et faire briller le bouton y promettrait du vide.
//
// Trois transitions, et elles seules :
//   contenu arrivé hors de vue       → non vu      (markThreadContentUnseen)
//   le fil atteint le fond           → vu          (acquitté par syncScrollBottomBtn)
//   la conversation change           → sans objet  (le Set est clefé par conv)
//
// Même clef et même volatilité que _scrollCapReleased juste au-dessus, pour la
// même raison (piège 28) : une génération écrit dans SA conversation, et on
// peut ouvrir un fil d'agent ou revenir sur un parent réveillé pendant son
// travail. Un Set en mémoire, jamais persisté : « je n'ai pas encore vu ce qui
// vient d'arriver » ne survit pas à un rechargement, qui repart du fond.
const _threadUnseen = new Set();   // Set<convId> — du contenu est arrivé hors de vue

// Appelée aux points d'écriture VISUELLE du fil (streamInto, placeToolAck,
// placeToolBlocks, finalizeAssistant). Les appelants passent par ici plutôt que
// d'écrire dans le Set — un seul écrivain, une seule fois la condition.
//
// La condition est la POSITION (`isAtBottom`), pas l'intention de suivi
// (`shouldFollowStream`). Les deux questions sont distinctes : « faut-il
// continuer à dérouler le fil ? » regarde ce que l'utilisateur veut, « ce qui
// vient d'arriver est-il visible ? » regarde où est la vue.
//
// Marquer sur `shouldFollowStream` ne marquait JAMAIS tant que le plafond
// d'ancrage était armé, puisque ce prédicat rend `true` par construction dans
// ce cas. Or le plafond mord exactement quand la réponse dépasse l'écran : le
// suivi s'arrête au ras de la bulle utilisateur, la suite s'écrit sous le fold,
// donc hors de vue — le cas même que le bouton doit signaler. Le bouton est
// d'ailleurs déjà VISIBLE là (`syncScrollBottomBtn`, appelée par
// `scrollBottomCapped` à chaque écriture) : ce qui est montré doit pouvoir
// briller, sinon le glow rate sa seule occasion utile.
//
// Pas de risque de glow permanent pendant une génération réellement suivie :
// l'ancrage doux (plafond levé, vue au fond) garde `isAtBottom()` vrai, et
// `syncScrollBottomBtn` acquitte à chaque `scroll` dès que le fond est atteint.
function markThreadContentUnseen() {
  if (currentConvId == null || isAtBottom()) return;
  _threadUnseen.add(currentConvId);
  syncScrollBottomGlow();
}

// Acquittement : arriver au fond vaut « j'ai vu ». Appelée par le prédicat de
// visibilité, donc à chaque scroll — y compris la dernière frame de la descente
// animée déclenchée par le clic.
//
// Acquitte les DEUX porteurs du même fait, depuis que quitter une conversation
// à non-vu la marque non lue en sidebar (`carryThreadUnseenToBadge`). Les
// séparer laisserait la sidebar allumée sur une conversation entièrement lue,
// sans rien pour l'expliquer (le fantôme du 2026-09-05, sous une autre cause).
//
// Ce n'est PAS le seul chemin d'effacement, et il ne faut pas le croire :
// `openConversation` appelle `markConvRead` inconditionnellement, et toute
// réouverture atterrit au fond de toute façon. Ce point-ci couvre le cas où
// l'on descend sans avoir quitté la conversation — le badge n'existe alors pas
// encore, `markConvRead` rend false, et rien ne se re-rend.
function ackThreadContentSeen() {
  if (currentConvId == null) return;
  const had = _threadUnseen.delete(currentConvId);
  // Le badge ne se rafraîchit pas tout seul : la liste de gauche et les
  // agrégats sont des rendus, pas des observateurs. Conditionné au retrait
  // effectif — cette fonction est appelée à CHAQUE scroll, un renderConvList
  // par frame de défilement serait un coût pour rien.
  if (had && markConvRead(currentConvId)) { renderConvList(); syncSpaceUI(); }
}

// Report du non-vu sur le badge de conversation, au DÉPART de la conversation.
// Deuxième chemin vers le même badge, à côté de `unregisterGeneration` : celui-ci
// couvre le non-vu SANS génération qui se termine (on remonte dans le fil, puis
// on s'en va), l'autre la génération qui finit hors de vue — y compris sur la
// conversation affichée depuis le 2026-09-13.
//
// La formulation d'origine réservait la pastille au départ, au motif que le
// bouton « aller tout en bas » suffisait tant qu'on restait dans la
// conversation. L'usage a tranché autrement : ce bouton ne dit rien dès qu'on
// regarde une autre fenêtre, et la sidebar est le seul porteur qui tienne.
// Appelée depuis le seul point de bascule d'écran qui distingue un vrai départ
// d'une ré-hydratation (`switching` dans openConversation) et depuis
// `resetToEmpty` (départ vers l'accueil, qui ne passe pas par là).
//
// Ne marque QUE si la conversation a du non-vu : quitter une conversation lue
// n'allume rien. Et le marquage passe par `markConvUnread`, jamais un
// `_unreadConvs.add` réécrit ici — un seul écrivain, comme pour le reste.
// GARDE DE RACINE, la même qu'à l'autre producteur (`unregisterGeneration`) et
// pour la même raison : un non-lu d'AGENT est invisible de la liste de gauche
// (filtrée sur `isRootConversation`) mais bien présent dans les agrégats, qui
// ne le sont pas — pastille allumée sur le hamburger et sur la ligne d'Espace,
// sans rien à déplier qui l'explique. C'est le bug du 2026-09-05, et un fil
// d'agent qu'on ouvre puis qu'on quitte en étant remonté serait un troisième
// chemin vers lui. Sans cette garde le fantôme ne serait pas permanent (rouvrir
// le fil atterrit au fond et acquitte), mais l'invariant « un agrégat ne
// remonte rien qu'aucune surface de détail ne puisse expliquer » serait rompu
// tant qu'on n'y retourne pas.
function carryThreadUnseenToBadge(convId) {
  if (!hasThreadUnseen(convId)) return;
  const conv = loadConversation(convId);
  if (!conv || !isRootConversation(conv)) return;
  markConvUnread(convId);
}

// LE prédicat de non-vu. Une fonction plutôt qu'un `_threadUnseen.has` recopié
// chez chaque lecteur : le Set est un détail d'implémentation, et c'est la
// troisième question posée sur le même état (les deux autres étant « faire
// briller le bouton ? » et « reporter sur le badge en partant ? »).
function hasThreadUnseen(convId) {
  return convId != null && _threadUnseen.has(convId);
}

// SEUL écrivain de la classe .has-unseen. Distinct de syncScrollBottomBtn, qui
// reste le seul écrivain de `hidden` : deux questions (« le montrer ? » selon
// la position, « le faire briller ? » selon le non-vu), deux prédicats — la
// classe survit d'ailleurs aux passages masqué/visible.
function syncScrollBottomGlow() {
  const btn = $('scroll-bottom-btn');
  if (!btn) return;
  btn.classList.toggle('has-unseen', currentConvId != null && _threadUnseen.has(currentConvId));
}

// Position de scroll maximale autorisée, en pixels, pour garder `anchorTop`
// (position de l'ancre dans le référentiel de défilement, cf.
// anchorTopInScroll) visible en haut du viewport. Pure : prend
// les mesures, rend un scrollTop. Le `max(0, …)` couvre l'ancre située avant le
// premier écran de contenu, où le plafond ne mord pas.
function cappedScrollTop(anchorTop, scrollHeight, clientHeight, padTop, currentTop) {
  const bottom = Math.max(0, scrollHeight - clientHeight);
  const cap = Math.max(0, anchorTop - (padTop || 0));
  const target = Math.min(bottom, cap);
  // Un autoscroll ne REMONTE jamais la vue. Sans cette borne, le plafond
  // « tire vers le haut » dès que l'ancre est à moins d'un écran du fond :
  // après une édition ou une régénération, le fil tronqué est court, on vient
  // d'être amené au fond, et la naissance de la bulle assistant faisait sauter
  // la vue en arrière pour coller l'ancre en haut — on ne voyait plus que sa
  // propre bulle (mesuré : scrollTop 215 → 14). Le plafond est une BORNE de
  // descente, pas une position à rejoindre.
  return Math.max(target, Math.min(currentTop || 0, bottom));
}

// Bulle d'ancrage : la DERNIÈRE bulle user du fil affiché. Ce n'est pas
// forcément « celle qui a lancé la génération en cours » — une interjection
// mid-génération (lot Q) en insère une nouvelle, et c'est bien celle-là qu'il
// faut garder à l'écran une fois le tour réaiguillé.
function autoscrollAnchorEl() {
  const msgs = $('thread') ? $('thread').querySelectorAll('.msg.user') : null;
  return (msgs && msgs.length) ? msgs[msgs.length - 1] : null;
}

// Position de l'ancre DANS LE RÉFÉRENTIEL DE DÉFILEMENT de `#messages`.
//
// Surtout PAS `offsetTop` : il est relatif à l'`offsetParent`, c'est-à-dire au
// parent positionné le plus proche — ici `.main` (position: relative), et non
// `#messages` qui, lui, ne l'est pas. `offsetTop` inclut donc la hauteur de la
// topbar, et le plafond calculé dessus laissait la bulle sortir de l'écran par
// le haut de cet écart (52px mesurés, 24px de débordement visible).
//
// Les rects sont relatifs au viewport : leur DIFFÉRENCE annule ce décalage
// quel que soit l'ancêtre positionné, et rajouter `scrollTop` la ramène dans
// le repère du contenu défilant. Vrai indépendamment du CSS environnant, là où
// `offsetTop` dépend de qui porte `position` au-dessus.
function anchorTopInScroll(m, anchor) {
  return anchor.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop;
}

// « Cette génération doit-elle continuer à faire défiler le fil ? »
//
// PAS `isAtBottom()`, qui était le prédicat de suivi avant le plafond et ne
// peut plus l'être : dès que le plafond mord, la vue N'EST PLUS au fond par
// construction, donc `isAtBottom()` devient faux et le suivi s'arrête POUR
// TOUJOURS — plus aucun appel, la réponse s'écrit hors champ et on ne voit
// plus rien (mesuré : figé à 820 pendant que le fil montait à 3259).
//
// Le vrai critère est l'INTENTION : on suit tant que l'utilisateur n'est pas
// parti lire ailleurs.
//   - plafond levé ET au fond → on suit (ancrage doux, il veut voir la suite) ;
//   - plafond levé et remonté → il lit plus haut : on ne le dérange pas ;
//   - plafond armé → on suit tant que la vue est au fond OU à la hauteur du
//     plafond ou en dessous (le plafond borne la descente lui-même) ; remonté
//     AU-DESSUS de l'ancre, il lit plus haut : on ne le dérange pas non plus.
// Ce dernier cas manquait : « plafond armé → on suit » sans condition ramenait
// sur l'énoncé, à chaque delta, un lecteur remonté consulter l'historique
// pendant la génération (mesuré par verify-autoscroll : scrollTop 0 → 2583).
function shouldFollowStream(convId) {
  if (isAtBottom()) return true;
  if (scrollCapReleased(convId)) return false;
  const m = $('messages');
  const anchor = autoscrollAnchorEl();
  if (!m || !anchor) return false;   // pas d'ancre, pas de plafond : seul le fond compte
  const padTop = parseFloat(getComputedStyle(m).paddingTop) || 0;
  return viewAtOrBelowScrollCap(anchorTopInScroll(m, anchor), padTop, m.scrollTop);
}

// Pure : la vue est-elle à la hauteur du plafond d'ancrage, ou en dessous ?
// Même plafond que cappedScrollTop (`anchorTop - padTop`, jamais négatif), à la
// tolérance de isAtBottom près — le plafond posé par nous tombe sur une
// position fractionnaire que scrollTop arrondit.
function viewAtOrBelowScrollCap(anchorTop, padTop, scrollTop) {
  const cap = Math.max(0, anchorTop - (padTop || 0));
  return scrollTop >= cap - AUTOSCROLL_TOLERANCE_PX;
}

// Autoscroll de streaming : suit le bas du fil SANS jamais dépasser le plafond
// d'ancrage. Distinct de scrollBottom(true), qui reste le geste « va vraiment
// tout en bas » (envoi utilisateur, ouverture de conversation, clic du bouton).
function scrollBottomCapped(convId) {
  const m = $('messages');
  if (!m) return;
  // Une génération écrit : c'est elle qui gouverne le défilement à partir
  // d'ici, plus la phase de stabilisation du rendu initial.
  stopStickToBottom();
  const anchor = scrollCapReleased(convId) ? null : autoscrollAnchorEl();
  if (!anchor) {
    m.scrollTop = m.scrollHeight;
  } else {
    const padTop = parseFloat(getComputedStyle(m).paddingTop) || 0;
    m.scrollTop = cappedScrollTop(anchorTopInScroll(m, anchor), m.scrollHeight, m.clientHeight, padTop, m.scrollTop);
  }
  syncScrollBottomBtn();
}

// ── Bouton « aller tout en bas » ────────────────────────────────────────────
// Durée de la descente au clic. Animation MAISON plutôt que
// `behavior: 'smooth'` : le smooth natif n'expose aucune durée, et la sienne
// (proportionnelle à la distance) traîne sur un fil long — un geste de
// navigation explicite doit arriver vite.
const SCROLL_BOTTOM_DURATION_MS = 260;

let _scrollBottomAnim = null;    // handle rAF de la frame en attente
let _scrollBottomAnimating = false;   // descente en cours (drapeau de visibilité)

// PRÉDICAT UNIQUE de visibilité du bouton, et SEUL écrivain de son `hidden`.
// Visible dès que le fil n'est pas au fond — génération en cours ou simple
// relecture d'une conversation ancienne — SAUF pendant la descente animée
// qu'il a lui-même déclenchée : le bouton est alors la cible qu'on vient de
// cliquer, et le laisser sous le curseur pendant tout le trajet le fait
// survivre à son propre effet.
//
// L'état d'animation est lu ICI plutôt que masqué à la main dans le handler de
// clic : chaque frame de la descente émet un `scroll`, donc rappelle cette
// fonction, et un masquage posé à côté était rallumé dès la frame suivante
// (isAtBottom() encore faux). Deux écrivains d'un même attribut, dont le second
// gagne toujours — le bouton ne disparaissait donc qu'à l'arrivée.
function syncScrollBottomBtn() {
  const btn = $('scroll-bottom-btn');
  if (!btn) return;
  const atBottom = isAtBottom();
  // Arriver au fond vaut « j'ai vu » — que ce soit par le clic (dernière frame
  // de la descente animée) ou à la main. Acquitter ICI plutôt qu'au clic : le
  // scroll manuel jusqu'en bas est le MÊME geste du point de vue de
  // l'utilisateur, et n'a pas de handler propre à décorer.
  if (atBottom) ackThreadContentSeen();
  syncScrollBottomGlow();
  if (_scrollBottomAnimating || atBottom) btn.setAttribute('hidden', '');
  else btn.removeAttribute('hidden');
}

// Clic : descente franche au fond ET levée du plafond pour le reste du tour —
// c'est le geste par lequel l'utilisateur dit qu'il veut suivre la génération
// plutôt que garder son énoncé à l'écran (ancrage doux).
function onScrollBottomBtn() {
  const m = $('messages');
  if (!m) return;
  releaseScrollCap(currentConvId);
  scrollToBottomAnimated(m);
}

// Descente animée vers le bas du fil. La cible est relue À CHAQUE FRAME : une
// génération en cours allonge le fil pendant la descente, et une cible figée au
// départ arriverait court, en laissant le bouton se rallumer juste après.
function scrollToBottomAnimated(m) {
  if (_scrollBottomAnim) { cancelAnimationFrame(_scrollBottomAnim); _scrollBottomAnim = null; }
  if (motionReduced()) {
    m.scrollTop = m.scrollHeight;
    syncScrollBottomBtn();
    return;
  }
  // Drapeau posé AVANT le premier sync : c'est lui qui masque le bouton, dès
  // ce tour de boucle et non à l'arrivée (cf. syncScrollBottomBtn).
  _scrollBottomAnimating = true;
  syncScrollBottomBtn();
  const from = m.scrollTop;
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / SCROLL_BOTTOM_DURATION_MS);
    const eased = 1 - Math.pow(1 - t, 3);   // ease-out cubique, accord de --ease
    const target = m.scrollHeight - m.clientHeight;
    m.scrollTop = from + (target - from) * eased;
    if (t < 1) {
      _scrollBottomAnim = requestAnimationFrame(step);
    } else {
      _scrollBottomAnim = null;
      _scrollBottomAnimating = false;
      m.scrollTop = m.scrollHeight;   // atterrissage exact, à l'abri des arrondis
      syncScrollBottomBtn();
    }
  };
  _scrollBottomAnim = requestAnimationFrame(step);
}

// Écoute du défilement du fil : met à jour la visibilité du bouton, et lève le
// plafond quand l'utilisateur redescend au fond à la main (même intention qu'un
// clic sur le bouton). Throttlé par rAF — l'événement scroll part en rafale.
//
// La levée est gardée par `scrollFollowsUserIntent` : un autoscroll atteint LUI
// AUSSI le fond (le plafond ne mord pas tant que la réponse tient dans
// l'écran), et l'événement qu'il émet lèverait alors le plafond sans qu'on ait
// rien demandé — il ne servirait plus jamais dès le premier tour court. Seul un
// scroll SUIVANT UN GESTE vaut intention.
let _scrollSyncPending = false;

// ── Reconnaître un geste de l'utilisateur ───────────────────────────────────
// Lever le plafond suppose de distinguer « l'utilisateur est redescendu au
// fond » de « un autoscroll y est arrivé tout seul ». L'événement `scroll` ne
// le dit pas : il est identique dans les deux cas.
//
// Deux tentatives ont échoué, pour la même raison de fond — l'ÉVÉNEMENT est un
// mauvais support de cette question :
//   1. drapeau à retombée sur rAF : le navigateur émet `scroll` de façon
//      asynchrone, souvent APRÈS la frame suivante, donc l'écho arrivait le
//      drapeau déjà retombé ;
//   2. comparaison de position : entre l'écriture et l'événement, le fil
//      grandit (bulle assistant, patienteur, frame de streaming), donc la
//      position observée ne vaut plus celle qu'on avait mémorisée.
//
// On écoute donc le GESTE D'ENTRÉE — molette, doigt, touche de navigation —
// qui, lui, n'est émis que par l'utilisateur. C'est déjà le support retenu
// pour abandonner la descente animée (cancelScrollBottomAnim), et pour la
// même raison.
//
// La fenêtre est généreuse : un geste de molette produit une salve
// d'événements `scroll` étalée sur plusieurs centaines de ms (défilement
// inertiel des trackpads), tous à imputer au même geste.
const USER_SCROLL_INTENT_MS = 700;
let _lastUserScrollIntent = 0;

function noteUserScrollIntent() {
  _lastUserScrollIntent = Date.now();
  // Un geste pendant la phase de stabilisation la termine : l'utilisateur veut
  // regarder ailleurs, le collage au fond lutterait contre lui.
  stopStickToBottom();
}

function scrollFollowsUserIntent() {
  return _scrollbarDragging || (Date.now() - _lastUserScrollIntent) <= USER_SCROLL_INTENT_MS;
}

// Glisser la barre de défilement est un geste qui n'émet NI molette, NI
// toucher, NI touche : sans ce drapeau, redescendre au fond par la barre ne
// levait jamais le plafond. Tenu du `pointerdown` sur la barre au relâchement,
// pas sur une fenêtre de temps — un glisser dure ce qu'il dure.
let _scrollbarDragging = false;

function onMessagesPointerDown(e) {
  const m = e.currentTarget;
  // La barre fait partie de l'élément lui-même (jamais d'un enfant), au-delà
  // de sa largeur cliente.
  if (e.target !== m || e.offsetX < m.clientWidth) return;
  _scrollbarDragging = true;
  noteUserScrollIntent();
  cancelScrollBottomAnim();
  const end = () => {
    _scrollbarDragging = false;
    noteUserScrollIntent();   // la salve de `scroll` du dernier mouvement reste imputée au geste
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

// Pousser vers le bas alors qu'on est DÉJÀ au fond : le navigateur n'émet
// aucun `scroll` (la position ne peut plus changer), donc onMessagesScroll ne
// voit jamais ce geste. Or c'est exactement celui qu'on fait quand la levée a
// manqué — on insiste. Il doit donc suffire à lui seul.
const SCROLL_DOWN_KEYS = ['End', 'PageDown', 'ArrowDown', ' '];

function releaseScrollCapOnPushAtBottom(e) {
  const down = (e.type === 'wheel') ? e.deltaY > 0 : SCROLL_DOWN_KEYS.includes(e.key);
  if (down && isAtBottom()) releaseScrollCap(currentConvId);
}

// Abandon de la descente animée sur intention explicite de l'utilisateur
// (molette, doigt). Pendant l'animation, chaque frame réécrit la position de
// référence : un scroll utilisateur y est indistinguable d'une de nos frames,
// donc c'est le geste D'ENTRÉE qu'on écoute, pas son effet — sans quoi on
// continuerait à tirer la vue vers le bas contre lui.
function cancelScrollBottomAnim() {
  if (!_scrollBottomAnimating) return;
  if (_scrollBottomAnim) cancelAnimationFrame(_scrollBottomAnim);
  _scrollBottomAnim = null;
  _scrollBottomAnimating = false;
  syncScrollBottomBtn();
}

function onMessagesScroll() {
  if (_scrollSyncPending) return;
  _scrollSyncPending = true;
  // Lus TOUT DE SUITE, pas dans le rAF : la fenêtre d'intention peut expirer
  // d'ici là sur une salve longue, et surtout le fil peut GRANDIR — une frame
  // de streaming rendue entre l'événement et le rAF éloigne le fond, et la
  // vue que l'utilisateur venait d'amener au fond n'y était plus au moment du
  // test : la levée manquait, et insister à la molette n'émet plus de scroll.
  const intent = scrollFollowsUserIntent();
  const atBottomNow = isAtBottom();
  requestAnimationFrame(() => {
    _scrollSyncPending = false;
    if (intent && (atBottomNow || isAtBottom())) releaseScrollCap(currentConvId);
    syncScrollBottomBtn();
  });
}

function modelName() {
  // activeApiConfig (storage.js) : modèle du serveur actif, filet legacy inclus —
  // jamais loadSettings().model directement (périmé depuis le multi-serveurs).
  return activeApiConfig().model || 'modèle';
}

// ── Construction d'un message ───────────────────────────────────────────────
// En-tête d'un message assistant : la barre méta (modèle + icône raisonnement,
// masquée tant qu'aucun raisonnement) et le bloc collapsible du raisonnement
// (replié par défaut, donc `hidden`). Sert au rendu live ET au reload depuis le
// stockage — un seul mécanisme de pliage/dépliage, persistant sans recalcul.
function assistantHead(model, reasoning, ts, server) {
  const has = reasoning && String(reasoning).trim();
  const tsText = ts ? formatMessageTime(ts, Date.now()) : '';
  // Provenance : « serveur › modèle » seulement si plusieurs serveurs API sont
  // configurés (sur une config mono-serveur l'info est du bruit). Les anciens
  // messages sans champ server n'affichent que le modèle. Le « · » devant
  // l'heure est un span séparé (même coloration accent que le « › »), masqué
  // et révélé avec .msg-ts (cf. les deux mises à jour dynamiques, main.js).
  const showSrv = server && loadApiServers().length > 1;
  const srcHtml = (showSrv ? `<span>${escHtml(server)}</span><span class="inline-sep">›</span>` : '') +
    `<span>${escHtml(model || modelName())}</span>`;
  return (
    `<div class="meta"><img class="glyph" src="${LOGO_SRC}" alt="">${srcHtml}` +
    `<span class="msg-ts-sep inline-sep"${tsText ? '' : ' hidden'}>·</span>` +
    `<span class="msg-ts"${tsText ? '' : ' hidden'}>${escHtml(tsText)}</span>` +
    `<div class="meta-actions">` +
      `<button class="reasoning-toggle"${has ? '' : ' hidden'} onclick="toggleReasoning(this)" title="Raisonnement" aria-label="Raisonnement">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 2.5l1.5 3.8 3.8 1.5-3.8 1.5L11 13.1 9.5 9.3 5.7 7.8l3.8-1.5z"/><path d="M17.5 13l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/></svg>` +
      `</button>` +
      `<button class="msg-copy" hidden title="Copier" onclick="copyMsg(this)">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
      `</button>` +
      `<button class="msg-dl" hidden title="Télécharger en .md" onclick="downloadMsgMd(this)">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>` +
      `</button>` +
      `<button class="msg-regen" hidden title="Régénérer la réponse" onclick="onRegenBtn(this)">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>` +
      `</button>` +
    `</div>` +
    `</div>` +
    `<div class="reasoning" hidden><div class="reasoning-content">${has ? escHtml(String(reasoning)) : ''}</div></div>`
  );
}

// Bandeau de réponse incomplète (feature C) : texte persistant + bouton
// « Continuer ». Deux causes possibles, même bandeau : coupe backend (limite
// de tokens) ou stop manuel avec contenu déjà reçu — d'où le libellé générique.
// Inséré APRÈS .body dans la bulle assistant, aussi bien au rendu live
// (finalizeAssistant) qu'au reload (buildMsg) — un seul balisage pour les deux
// chemins. Le bouton est masqué/désactivé par syncLastAssistantActions selon
// la position (dernier message du fil) et l'état sending ; le texte, lui,
// reste affiché sur les messages anciens (spec brief §C).
function truncatedBannerHtml() {
  return (
    `<div class="msg-truncated">` +
    `<span class="msg-truncated-text">Réponse incomplète</span>` +
    `<button class="msg-continue" onclick="continueTruncated(this)">Continuer</button>` +
    `</div>`
  );
}

// Corps replié d'une réponse d'agent (X-1e). `<details>` NATIF, fermé par
// défaut : un compte rendu d'agent est long (tâche confiée, identifiant, outils
// en échec, puis la réponse entière) et il arrive au milieu du fil du parent,
// entre deux messages qui, eux, sont la conversation. Le laisser déplié noie
// l'échange dans le rapport d'un travail déjà fait.
//
// L'en-tête est imbriqué DANS le <summary> (pas en frère) : c'est ce qui donne
// une zone de clic couvrant tout le bandeau, repli comme dépli, SANS JS
// (project_details_summary_collapse_click_zone). Marqueur natif retiré en CSS,
// remplacé par un chevron qui pivote.
//
// Le libellé porte l'intent — ce que le modèle avait confié à l'agent — plutôt
// qu'un « Réponse d'agent » générique : replié, c'est la seule chose lisible,
// et c'est la question à laquelle le bloc répond. Statut à côté, depuis la même
// table que le bandeau (AGENT_STATUS_UI_LABELS) : un résultat partiel ou en
// erreur doit se voir sans déplier.
function agentResultBodyHtml(content, agentResult) {
  const a = agentResult || {};
  const intent = a.intent || 'Agent';
  const label = AGENT_STATUS_UI_LABELS[a.status] || '';
  return (
    `<details class="agent-result-box">` +
    `<summary>` +
    `<div class="agent-result-head">` +
    `<svg class="agent-result-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>` +
    `<svg class="agent-result-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 13h.01M15 13h.01M9 17h6"/></svg>` +
    `<span class="agent-result-intent">${escHtml(intent)}</span>` +
    (label ? `<span class="agent-result-status">${escHtml(label)}</span>` : '') +
    `</div>` +
    `</summary>` +
    `<div class="body">${renderUserMd(content)}</div>` +
    `</details>`
  );
}

// Bouton « ouvrir le fil de l'agent », rendu à la place de « Éditer » dans la
// barre d'actions d'une réponse d'agent : le compte rendu replié dit CE QUE
// l'agent a répondu, jamais comment il y est arrivé (les outils qu'il a
// appelés, ses détours). Cette conversation existe toujours — la seule chose
// qui manquait était le chemin pour y aller depuis l'endroit où on lit son
// résultat.
//
// ICON_EYE, pas la loupe : vocabulaire d'icônes (une métaphore = un usage).
// L'œil porte déjà « on te remontre une conversation » (ack conversation_read,
// et le commentaire d'ICON_AGENT le cite comme tel) ; la loupe est RÉSERVÉE à
// l'inspection du détail d'un appel d'outil (lot Z).
//
// Rendu seulement si la conversation de l'agent EXISTE ENCORE : elle est
// supprimable indépendamment de son parent, et le résultat reste alors dans le
// fil. Un bouton dont le clic ne ferait rien (openConversation est un no-op
// silencieux sur un id inconnu) est pire que pas de bouton — il promet une
// navigation qu'il ne tient pas. L'affordance est donc recalculée à chaque
// rendu du fil, jamais figée dans la donnée persistée.
function agentOpenButtonHtml(agentResult) {
  const id = (agentResult && agentResult.id) || '';
  if (!id || !loadConversation(id)) return '';
  return (
    `<button class="msg-open-agent" title="Ouvrir le fil de l'agent" onclick="onOpenAgentConv(this)" data-agent-conv="${escHtml(id)}">` +
    ICON_EYE +
    `</button>`
  );
}

// `agentResult` (X-1e) : le message user porte une réponse d'agent
// (buildAgentResultEntry, agents.js) plutôt qu'une saisie humaine. Il n'est pas
// éditable — son texte est le compte rendu d'un travail qui a réellement eu
// lieu, dans une conversation qui existe encore et que le bouton de retour
// permet d'aller lire. Le réécrire ferait diverger le fil du parent de ce que
// l'agent a effectivement produit, sans que rien ne le signale : deux versions
// d'un même résultat, celle du parent et celle de l'agent, et aucun moyen de
// savoir laquelle est la vraie. On retire donc le bouton ici ET on ferme
// enterEditMode (les deux voies ensemble — fermer la seule affordance visible
// laisserait passer un appel direct, et le clavier).
function buildMsg(role, content, model, reasoning, ts, server, truncated, attachments, agentResult) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  if (role === 'user') {
    if (ts) wrap.dataset.ts = ts;
    if (agentResult) wrap.classList.add('agent-result');
    wrap.innerHTML =
      `<div class="bubble">` +
      renderMsgAttachments(attachments, currentConvId) +
      (agentResult
        ? agentResultBodyHtml(content, agentResult)
        : `<div class="body">${renderUserMd(content)}</div>`) +
      `</div>` +
      `<div class="msg-user-footer">` +
      `<div class="msg-user-actions">` +
      (agentResult ? agentOpenButtonHtml(agentResult) :
      `<button class="msg-edit" title="Éditer" onclick="onEditMsg(this)">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>`) +
      `<button class="msg-copy-user" title="Copier" onclick="copyMsg(this)">` +
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
      `</button>` +
      `</div>` +
      (ts ? `<span class="msg-ts">${escHtml(formatMessageTime(ts, Date.now()))}</span>` : '') +
      `</div>`;
  } else {
    wrap.innerHTML =
      assistantHead(model, reasoning, ts, server) +
      `<div class="body">${renderMd(content)}</div>` +
      (truncated ? truncatedBannerHtml() : '');
    const bodyEl = wrap.querySelector('.body');
    if (bodyEl) bodyEl.dataset.raw = content;
    // Message déjà finalisé (reload) : les boutons copier/download sont opérationnels immédiatement.
    const copyBtn = wrap.querySelector('.msg-copy');
    if (copyBtn) copyBtn.removeAttribute('hidden');
    const dlBtn = wrap.querySelector('.msg-dl');
    if (dlBtn) dlBtn.removeAttribute('hidden');
  }
  decoratePre(wrap);
  // Rendu mermaid des messages historiques (reload/renderThread). Fire-and-
  // forget : la continuation async ne s'exécute qu'en microtâche, une fois le
  // wrap appendé au DOM par l'appelant (garde isConnected dans la passe).
  renderMermaidUnder(wrap);
  return wrap;
}

// ── Bloc de raisonnement (thinking) ─────────────────────────────────────────
// Texte brut en police mono (pas de markdown). Révèle l'icône à la première
// substance reçue ; un raisonnement vide ('') ne révèle rien (cf. distinction
// absence / chaîne vide du brief).
let _reasonTimer = null;
let _reasonPending = null;

// Écriture effective dans le DOM (O(n) : tout le nœud est réécrit). À ne PAS
// appeler par delta sans throttle — d'où setReasoning ci-dessous.
function renderReasoningNow(wrap, text) {
  if (!text) return;
  const toggle = wrap.querySelector('.reasoning-toggle');
  const panel = wrap.querySelector('.reasoning');
  const content = wrap.querySelector('.reasoning-content');
  if (!toggle || !panel || !content) return;
  toggle.removeAttribute('hidden');          // capacité détectée → icône visible
  // Autoscroll du raisonnement : même doctrine que le fil (isAtBottom) — ne
  // suivre le bas que si l'utilisateur y était déjà AVANT la réécriture, pour
  // ne pas arracher la vue d'un lecteur remonté dans un raisonnement en cours.
  // Mesuré avant l'écriture (qui modifie scrollHeight).
  const stick = !panel.hasAttribute('hidden') &&
    content.scrollHeight - content.scrollTop - content.clientHeight <= AUTOSCROLL_TOLERANCE_PX;
  // Le FIL aussi : déplié, le bloc grandit jusqu'à sa hauteur max avant de
  // défiler en interne, et cette croissance repousse le fond du fil. Sans ce
  // suivi, seuls les deltas de contenu faisaient défiler le fil — pendant toute
  // la phase de raisonnement, la vue restait sur place, levée du plafond
  // comprise (on redescendait au fond pour rien). Lu avant l'écriture, même
  // raison que streamInto.
  const follow = shouldFollowStream(currentConvId);
  // Ajout en queue plutôt que réécriture quand le texte ne fait que se
  // prolonger (cas du streaming) : réécrire textContent recrée le nœud texte et
  // perd toute sélection en cours. Réécriture complète sinon.
  const suffix = appendOnlySuffix(content.textContent, text);
  if (suffix === null) content.textContent = text;
  else if (suffix) content.appendChild(document.createTextNode(suffix));
  if (stick) content.scrollTop = content.scrollHeight;  // suivre si déplié ET déjà en bas
  if (follow) scrollBottomCapped(currentConvId);
}

// Alimenté en live par les deltas accumulés, throttlé par fenêtres de ~90 ms
// (même motif que streamInto pour le contenu) : un textContent complet par delta
// serait O(n²) en écritures DOM sur un long raisonnement. La dernière mise à
// jour en attente est écrasée ; le flush final passe par flushReasoning.
function setReasoning(wrap, text) {
  if (!text) return;
  _reasonPending = { wrap, text };
  if (_reasonTimer) return;
  _reasonTimer = setTimeout(() => {
    _reasonTimer = null;
    const p = _reasonPending;
    _reasonPending = null;
    if (p) renderReasoningNow(p.wrap, p.text);
  }, 90);
}

// Annule un rendu de raisonnement en attente (avant un finalize/reset, pour
// qu'un timer en vol ne réécrive pas un état périmé). Symétrique de
// cancelStreamRender pour le contenu.
function cancelReasoningRender() {
  if (_reasonTimer) { clearTimeout(_reasonTimer); _reasonTimer = null; }
  _reasonPending = null;
}

// Flush synchrone du raisonnement définitif : annule le throttle en vol et écrit
// la valeur finale d'un coup. Sans lui, les derniers tokens manqueraient au live
// (la valeur persistée, issue de onFinal, reste complète quoi qu'il arrive).
function flushReasoning(wrap, text) {
  cancelReasoningRender();
  renderReasoningNow(wrap, text);
}

// Toggle global (référencé en onclick= inline). Déplie/replie le bloc.
function toggleReasoning(btn) {
  const wrap = btn.closest('.msg');
  const panel = wrap && wrap.querySelector('.reasoning');
  if (!panel) return;
  const opening = panel.hasAttribute('hidden');
  if (opening) {
    panel.removeAttribute('hidden');
    btn.classList.add('open');
    const content = panel.querySelector('.reasoning-content');
    if (content) content.scrollTop = content.scrollHeight;
  } else {
    panel.setAttribute('hidden', '');
    btn.classList.remove('open');
  }
  // Pas de scrollBottom() ici : consulter le raisonnement d'un message ancien
  // ne doit pas ramener la vue en bas du fil.
}

// En-tête (langage + boutons copier/télécharger) sur chaque <pre>.
function decoratePre(scope) {
  const svgCopy = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const svgCheck = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const svgDl = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  // Pictogramme « diagramme » (3 nœuds reliés) — toggle rendu ↔ source des
  // blocs mermaid. Métaphore réservée à cet usage (vocabulaire d'icônes).
  const svgDiagram = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M7.5 8.7 10.5 15.4"/><path d="M16.5 8.7 13.5 15.4"/><path d="M9 6h6"/></svg>`;
  // Pictogramme « œil » — aperçu sandboxé des blocs html/svg (lot E, préviz sandboxée).
  // Métaphore réservée à cet usage (vocabulaire d'icônes).
  const svgEye = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  // Pictogramme « page » — conversion d'un bloc markdown en page HTML (lot R).
  // Distinct de la flèche de téléchargement (qui rend le contenu BRUT) : ici on
  // produit un document mis en forme. Métaphore réservée à cet usage.
  const svgPage = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>`;

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
    head.innerHTML =
      `<span class="code-lang">${escHtml(lang)}</span>` +
      `<div class="code-actions">` +
      // Toggle mermaid : présent dès le décor (y compris pendant le streaming)
      // mais caché — révélé par renderMermaidUnder au premier rendu réussi.
      (isMermaidLang(lang) ? `<button class="code-mmd-toggle" title="Diagramme / source" hidden>${svgDiagram}</button>` : '') +
      // Aperçu sandboxé : clic EXPLICITE uniquement, jamais automatique.
      (isPreviewableLang(lang) ? `<button class="code-preview-btn" title="Aperçu">${svgEye}</button>` : '') +
      // Conversion en page HTML (lot R) : même geste que le convertisseur des
      // réglages, appliqué au contenu du bloc. Markdown seulement.
      (isMarkdownLang(lang) ? `<button class="code-md-html" title="Convertir en page HTML">${svgPage}</button>` : '') +
      `<button class="code-copy" title="Copier">${svgCopy}</button>` +
      `<button class="code-dl" title="Télécharger">${svgDl}</button>` +
      `</div>`;
    const mmdToggle = head.querySelector('.code-mmd-toggle');
    if (mmdToggle) mmdToggle.onclick = () => {
      // Ne bascule que si une vue rendue existe (le bouton est caché sinon,
      // ceinture-bretelles) ; l'inversion visuelle est portée par le CSS.
      if (pre.querySelector('.mermaid-view')) pre.classList.toggle('mermaid-rendered');
    };
    const pvBtn = head.querySelector('.code-preview-btn');
    if (pvBtn) pvBtn.onclick = () => {
      // Frontière de sécurité (piège 23) : le markup d'origine modèle n'atteint
      // une surface de rendu QUE via cette iframe sandbox="allow-scripts",
      // JAMAIS avec allow-same-origin (origine opaque : pas de localStorage/
      // IndexedDB/DOM parent). srcdoc posé par PROPRIÉTÉ sur un élément créé
      // par createElement — jamais interpolé dans un template string HTML.
      let box = pre.querySelector('.code-preview');
      if (!box) {
        box = document.createElement('div');
        box.className = 'code-preview';
        const close = document.createElement('button');
        close.className = 'code-preview-close';
        close.title = "Fermer l'aperçu";
        close.textContent = '×';
        close.onclick = () => { box.remove(); pre.classList.remove('preview-open'); };
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        box.appendChild(close);
        box.appendChild(frame);
        pre.appendChild(box);
      }
      // Re-clic = re-render depuis la source COURANTE (source de vérité unique).
      box.querySelector('iframe').srcdoc = buildPreviewSrcdoc(lang, code ? code.textContent : '');
      pre.classList.add('preview-open');
    };
    head.querySelector('.code-copy').onclick = () => {
      navigator.clipboard.writeText(code ? code.textContent : '').then(() => {
        const btn = head.querySelector('.code-copy');
        btn.innerHTML = svgCheck;
        btn.classList.add('code-copy--checked');
        setTimeout(() => { btn.innerHTML = svgCopy; btn.classList.remove('code-copy--checked'); }, 1400);
      }).catch(toastCopyFailed);
    };
    head.querySelector('.code-dl').onclick = () => {
      const rawName = code ? code.getAttribute('data-filename') : '';
      const dlName = sanitizeDownloadName(rawName, lang) || ('miaou-snippet.' + langExt(lang));
      downloadFile(dlName, code ? code.textContent : '', 'text/plain');
    };
    // Conversion en page HTML (lot R) : réutilise convertMarkdownToHtmlFile,
    // exactement comme la zone de dépôt des réglages — un seul chemin de
    // conversion, pas de second rendu à faire dériver. Le nom de sortie vient
    // du data-filename du bloc s'il existe, sinon du titre h1 du markdown,
    // sinon d'un repli neutre (mdHtmlFileName pose l'extension .html).
    const mdBtn = head.querySelector('.code-md-html');
    if (mdBtn) mdBtn.onclick = async () => {
      if (mdBtn.disabled) return;
      const md = code ? code.textContent : '';
      const rawName = code ? code.getAttribute('data-filename') : '';
      const fallback = (extractMdTitle(md).title || 'document') + '.md';
      mdBtn.disabled = true;
      try {
        await convertMarkdownToHtmlFile(md, rawName || fallback);
      } finally {
        mdBtn.disabled = false;
      }
    };
    pre.insertBefore(head, pre.firstChild);
  });

  // Dans decoratePre et non chez ses appelants : c'est déjà LE point de passage
  // du markdown rendu, donc tout nouveau site de rendu hérite du porteur sans
  // qu'on ait à y penser. No-op sur les scopes qui construisent un <pre> à la
  // main (bloc de code d'une ressource, aperçu de prompt) : aucun `.body table`
  // à y trouver.
  wrapWideTables(scope);
}

// Enveloppe chaque tableau rendu dans un porteur, seul moyen de le laisser
// déborder de la colonne de lecture EN RESTANT CENTRÉ : le débordement veut une
// marge horizontale négative, le centrage veut `margin-inline: auto`, et un même
// élément ne peut pas porter les deux — la seconde écrase la première. Le
// porteur prend l'élargissement, le tableau se centre dedans (cf. .table-bleed,
// chat.css).
//
// Aucune mesure, aucun seuil : le CSS décide seul si le tableau consomme le
// débordement offert, donc rien à ré-exécuter au redimensionnement de la fenêtre
// ni au changement de largeur de colonne.
//
// Idempotent : les chemins de rendu repassent sur un même scope (finalize après
// streaming, re-rendu de fil) — un tableau déjà enveloppé est laissé tel quel.
function wrapWideTables(scope) {
  if (!scope) return;
  scope.querySelectorAll('.body table').forEach(function(table) {
    const parent = table.parentNode;
    if (!parent || (parent.classList && parent.classList.contains('table-bleed'))) return;
    const holder = document.createElement('div');
    holder.className = 'table-bleed';
    parent.insertBefore(holder, table);
    holder.appendChild(table);
    // Le message hôte renonce à content-visibility (cf. .msg, chat.css) : sa
    // valeur `auto` implique `contain: layout paint`, et ce `paint` CLIPPE tout
    // ce qui sort de la boîte du message — donc précisément le débordement
    // qu'on vient de mettre en place. Posé ICI parce que c'est le seul endroit
    // qui sache qu'un tableau va déborder, et posé sur le MESSAGE parce que
    // c'est lui qui porte le confinement, pas le porteur. `closest` est nul à
    // l'export (pas de .msg là-bas, ni de content-visibility) : rien à faire.
    // Posée pour TOUT tableau enveloppé, sans mesurer s'il déborde vraiment :
    // c'est le parti pris de cette fonction (le CSS décide seul, rien à
    // ré-exécuter au resize ni au changement de cran). Un message à petit
    // tableau renonce donc au confinement sans en avoir besoin — coût accepté
    // contre une mesure au rendu, qu'il faudrait refaire à chaque frappe.
    const host = holder.closest('.msg');
    if (host) host.classList.add('has-table-bleed');
  });
}

// Télécharge le contenu brut (markdown source) d'un message assistant, précédé
// de la trace des acks enrichis (args+result) de son tour — mêmes acks que
// placeToolAck affiche dans la bulle, retrouvés via msgIndex en remontant
// currentThread (cf. downloadConvMd pour le même motif sur l'export complet).
// Le contenu est stocké dans body.dataset.raw au moment du finalize/buildMsg.
function downloadMsgMd(btn) {
  const wrap = btn.closest('.msg');
  const body = wrap && wrap.querySelector('.body');
  const raw = body && body.dataset.raw;
  if (!raw) return;
  const idx = msgIndex(wrap);
  const acks = [];
  if (idx > 0) {
    for (let i = idx - 1; i >= 0 && isAckRole(currentThread[i].role); i--) {
      if (currentThread[i].args != null) acks.unshift(currentThread[i]);
    }
  }
  const trace = acks.length ? formatToolAcksMd(acks) + '\n\n' : '';
  const msg = idx >= 0 ? currentThread[idx] : null;
  const modelStr = (msg && msg.model) ? ' (' + msg.model + ')' : '';
  const header = '### MIAOU' + modelStr + '\n\n';
  downloadFile('miaou-message.md', header + trace + raw, 'text/markdown');
}

// Copie le markdown source d'un message (bulle assistant ou user) dans le
// presse-papier. Assistant : body.dataset.raw (même source que downloadMsgMd,
// pas d'en-tête ni de trace d'outils). User : le littéral tapé (displayText
// si présent — slash-commande skill —, sinon content), jamais le corps baké.
// Feedback visuel identique à code-copy (decoratePre) : swap SVG check ~1400 ms.
function copyMsg(btn) {
  const wrap = btn.closest('.msg');
  if (!wrap) return;
  let text;
  if (wrap.classList.contains('assistant')) {
    const body = wrap.querySelector('.body');
    text = body && body.dataset.raw;
  } else {
    const idx = msgIndex(wrap);
    const m = idx >= 0 ? currentThread[idx] : null;
    text = m ? (m.displayText ?? m.content) : null;
  }
  if (!text) return;
  // width/height inline obligatoires : les boutons méta assistant n'ont pas de
  // règle CSS de dimensionnement svg (contrairement à .msg-copy-user), un svg nu
  // s'y rendrait à taille dégénérée.
  const svgCheck = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const svgCopy = btn.innerHTML;
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = svgCheck;
    btn.classList.add('msg-copy--checked');
    setTimeout(() => { btn.innerHTML = svgCopy; btn.classList.remove('msg-copy--checked'); }, 1400);
  }).catch(toastCopyFailed);
}

// Ouvre le fil de l'agent dont ce message porte le compte rendu (bouton posé par
// agentOpenButtonHtml). L'id vient du dataset du BOUTON, pas d'un index dans
// currentThread : le nœud porte lui-même sa cible (project_dom_state_pairing…),
// donc aucun appariement positionnel à maintenir juste.
//
// Re-vérification de l'existence AVANT selectConv, alors que le bouton n'a été
// rendu que parce que la conversation existait : entre ce rendu et le clic, un
// autre onglet a pu la supprimer. selectConv → openConversation est déjà un
// no-op silencieux sur un id inconnu — la re-vérification ne change donc pas
// l'issue du clic, elle RETIRE le bouton devenu faux, pour que l'affordance
// cesse de promettre une navigation qui n'existe plus. Pas de message : le
// projet n'a pas de composant de notification transitoire, et en inventer un
// ici serait redessiner à l'aveugle.
function onOpenAgentConv(btn) {
  const id = btn && btn.dataset ? btn.dataset.agentConv : '';
  if (!id) return;
  if (!loadConversation(id)) { btn.remove(); return; }
  selectConv(id, true);
}

// ── Rendu du fil ────────────────────────────────────────────────────────────
function renderThread(msgs) {
  const thread = $('thread');
  // Titre du welcome courant AVANT vidage : si on re-rend un thread vide alors
  // qu'un accueil était déjà affiché (Nouvelle conversation répétée, bouton ou
  // palette), on garantit un accueil DIFFÉRENT (changement toujours visible).
  const prevWelcome = (thread.querySelector('.welcome-screen .welcome-title') || {}).textContent || '';
  thread.innerHTML = '';
  clearMemoryProposals();   // les cartes de proposition viennent d'être détruites
  if (!msgs || msgs.length === 0) { showWelcome(prevWelcome || undefined); return; }
  // Les acks précèdent dans currentThread l'assistant qu'ils ont nourri ; on les
  // tamponne pour les replacer DANS sa bulle (en-tête, acks, réponse), cohérent
  // avec le rendu live. Repli en blocs autonomes s'ils ne précèdent pas un
  // assistant (cas limite : acks orphelins ou suivis d'un message user).
  let pendingAcks = [];
  for (const m of msgs) {
    if (isAckRole(m.role)) { pendingAcks.push(m); continue; }
    // Frontière de compaction (lot AE) : ni bulle ni message — un séparateur.
    // Les acks en attente sont vidés AVANT, sinon ils seraient replacés dans la
    // première bulle assistant d'APRÈS la frontière, à laquelle ils
    // n'appartiennent pas.
    if (isCompactionEntry(m)) {
      for (const a of pendingAcks) thread.appendChild(buildToolAck(a));
      pendingAcks = [];
      thread.appendChild(buildCompactionMarker(m));
      continue;
    }
    // Bulle user : afficher le littéral tapé (displayText) si présent — slash-
    // commande skill, où content embarque le corps de la skill injectée (invisible à l'UI).
    const shown = (m.role === 'user' && m.displayText != null) ? m.displayText : m.content;
    const wrap = buildMsg(m.role, shown, m.model, m.reasoning, m.ts, m.server, m.truncated, m.attachments, m.agentResult);
    if (m.role === 'assistant') {
      for (const a of pendingAcks) placeToolAck(wrap, a, false);
    } else {
      for (const a of pendingAcks) thread.appendChild(buildToolAck(a));
    }
    pendingAcks = [];
    thread.appendChild(wrap);
  }
  for (const a of pendingAcks) thread.appendChild(buildToolAck(a));
  if (highlightEnabled && window.Prism) Prism.highlightAll();
  scrollBottom(true);   // ouverture/rechargement de conversation : toujours au fond
  stickToBottomWhileSettling();   // ... et y RESTER le temps que la hauteur se fixe
  syncConvDownloadBtn();
  syncLastAssistantActions();
  reindexThreadDom();   // toutes les bulles viennent d'être (re)construites depuis msgs
}

// Synchronise les actions réservées à la DERNIÈRE bulle assistant du fil :
// régénérer (feature B) et continuer une troncature (feature C). Masque
// .msg-regen et désactive .msg-continue sur toutes les bulles sauf la
// dernière assistant, et jamais pendant un stream (sending). Le TEXTE du
// bandeau .msg-truncated, lui, reste affiché sur les messages anciens — seul
// le bouton est borné à la dernière bulle (spec brief §C) : on ne le masque
// donc pas (`hidden`), on le désactive (`disabled`) pour ne pas faire
// disparaître le texte qui l'accompagne dans la même bulle. Appelé en fin de
// renderThread, dans finalizeAssistant et dans setSending : trois points où
// l'ensemble des bulles ou l'état sending peuvent changer.
// Un agent de cette conversation en vol masque AUSSI « régénérer » : sa fin
// pousse un compte rendu dans ce fil, et tronquer entre-temps le ferait
// atterrir derrière un historique qui n'est plus celui auquel il répond. Le
// prédicat est `hasWorkingAgent` (agents.js), le même que les gardes de
// suppression, de déplacement et de badge — jamais un balayage réécrit.
//
// `sending` ne suffit pas et ne peut pas suffire : c'est un reflet d'ÉCRAN
// (piège 28). Un parent inerte dont un agent travaille a `sending === false`,
// donc le bouton restait offert. La garde de mutation vit dans main.js
// (regenerateResponse) ; celle-ci ne protège que le clic.
function syncLastAssistantActions() {
  const bubbles = Array.from($('thread').querySelectorAll('.msg.assistant'));
  const last = bubbles[bubbles.length - 1];
  for (const b of bubbles) {
    const regenBtn = b.querySelector('.msg-regen');
    if (regenBtn) regenBtn.hidden = sending || b !== last;
    const continueBtn = b.querySelector('.msg-continue');
    if (continueBtn) {
      // Réponse que la compaction a retirée de ce qui part au modèle : la
      // continuer n'a plus de sens (`compactionFollows`, utils.js). Désactivé
      // et non masqué, comme sur les bulles anciennes — le texte « Réponse
      // incomplète » reste vrai ; le title dit pourquoi le bouton est inerte.
      const cut = b === last && compactionFollows(currentThread, msgIndex(b));
      continueBtn.disabled = sending || b !== last || cut;
      continueBtn.title = cut
        ? 'Cette réponse n\'est plus transmise au modèle depuis la compaction : elle ne peut plus être continuée.'
        : '';
    }
  }
  syncAgentBusyAffordances();
}

// Les deux glyphes de réécriture d'historique (crayon d'édition, régénération)
// GRISÉS tant qu'un agent de la conversation affichée travaille, curseur
// « interdit » au survol. Portés par une classe sur `body` plutôt que bulle par
// bulle : le nombre de bulles change à chaque tour, la condition non — et la
// même classe couvre du même coup les bulles créées PENDANT que la garde tient.
//
// Grisé, PAS masqué. Un bouton qui disparaît puis revient se lit comme un bug
// d'affichage ; grisé avec un `title` qui donne la raison, l'état est lisible
// et le geste reste découvrable. C'est le traitement déjà retenu pour la case
// de déplacement d'une conversation dont un agent tourne (convItemEl) — même
// situation, même vocabulaire.
//
// `pointer-events` reste ACTIF, contrairement à `body.conv-readonly` : le
// couper empêcherait `cursor: not-allowed` de s'afficher et le `title` de
// paraître. Le clic est neutralisé côté JS (enterEditMode, regenerateResponse),
// où vit de toute façon la seule garde qui protège le thread.
function syncAgentBusyAffordances() {
  const busy = hasWorkingAgent(currentConvId);
  document.body.classList.toggle('agent-busy', busy);
  const hint = busy
    ? 'Un agent de cette conversation travaille : l\'historique ne peut pas être réécrit pour l\'instant.'
    : '';
  for (const btn of document.querySelectorAll('#thread .msg-edit')) {
    if (busy) btn.title = hint; else btn.title = 'Éditer';
  }
  // Libellés de repos recopiés des points de construction (buildMsg, ui.js) :
  // « Éditer » et « Régénérer la réponse ». Les réécrire de mémoire changerait
  // l'infobulle en silence — c'est arrivé ici même, « Régénérer » au lieu de
  // « Régénérer la réponse », rattrapé en relisant la source.
  for (const btn of document.querySelectorAll('#thread .msg-regen')) {
    if (busy) btn.title = hint; else btn.title = 'Régénérer la réponse';
  }
}

function syncConvDownloadBtn() {
  const hasAssistant = currentThread.some(m => m.role === 'assistant');
  const btn = document.querySelector('.conv-dl-btn');
  if (btn) btn.hidden = !hasAssistant;
  // Un agent n'est jamais titré (lot X-1) : offrir « Régénérer le titre » y
  // écrirait un `title` que convLabel préférerait ensuite à l'agentIntent —
  // deux libellés concurrents pour la même conversation, celui des acks et
  // celui de la topbar, qui divergeraient en silence. Même raison que
  // l'éditabilité fermée (setTitleEditableForConv) : les deux voies d'écriture
  // du titre se ferment ensemble, sinon fermer l'une déplace juste le problème.
  const isAgent = isAgentConversation(loadConversation(currentConvId));
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.hidden = !hasAssistant || isAgent;
}

// ── Streaming d'une réponse assistant ───────────────────────────────────────
// `agentResult` : un message user peut porter un compte rendu d'agent plutôt
// qu'une saisie humaine (buildAgentResultEntry, agents.js). Le paramètre est
// OBLIGATOIRE au point d'appel des drains de résultats — l'omettre peint une
// bulle utilisateur ordinaire, alors que le reload et `renderThread` rendent une
// bulle dédiée depuis le MÊME `buildMsg` : l'écart ne se voit que pendant le
// travail des agents restants, puis se répare tout seul au premier re-rendu du
// fil, donc il ne laisse aucune trace.
function appendUserMessage(text, ts, attachments, agentResult) {
  const welcome = $('thread').querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  const el = buildMsg('user', text, undefined, undefined, ts, undefined, undefined, attachments, agentResult);
  $('thread').appendChild(el);
  highlightUnder(el);
  scrollBottom(true);   // l'utilisateur vient d'envoyer : toujours suivre
  return el;
}

function startAssistantMessage(model, server) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.innerHTML = assistantHead(model, '', undefined, server) + `<div class="body"></div>`;
  $('thread').appendChild(wrap);
  startWaiter(wrap.querySelector('.body'));     // état WAITING
  // Plafonné : une bulle assistant naît AUSSI en cours de tour (après chaque
  // volée d'outils), là où un saut au fond arracherait l'énoncé de l'écran.
  scrollBottomCapped(currentConvId);
  return wrap;
}

// ── Patienteur animé ────────────────────────────────────────────────────────
// Remplace le caret pendant l'attente (WAITING) et la reprise après un tour
// tool_calls : un mot court qui change par fondu CSS toutes les ~1.8 s, tiré
// au hasard (pas de cycle fixe). Discret, couleur texte secondaire. Jamais
// affiché en même temps que du contenu en streaming (streamInto coupe avant
// de peindre). Deux timers à nettoyer : la rotation et le fondu intermédiaire.
const WAITER_WORDS = [
  'Cogite', 'Médite', 'Triture', 'Décortique', 'Mijote', 'Tisse', 'Rumine',
  'Ausculte', 'Démêle', 'Échafaude', 'Macère', 'Ourdit', 'Tergiverse',
  'Élucubre', 'Pondère', 'Fomente',
];
let _waiterRotate = null;   // setInterval : changement de mot
let _waiterFade = null;     // setTimeout : bascule du texte à mi-fondu

function pickWaiterWord(prev) {
  let w;
  do { w = WAITER_WORDS[Math.floor(Math.random() * WAITER_WORDS.length)]; }
  while (WAITER_WORDS.length > 1 && w === prev);
  return w;
}

function startWaiter(body) {
  stopWaiter();
  body.innerHTML = `<span class="waiter"><span class="waiter-dot"></span><span class="waiter-word">${pickWaiterWord()}</span></span>`;
  const word = body.querySelector('.waiter-word');   // le point animé, lui, demeure
  _waiterRotate = setInterval(() => {
    word.classList.add('fade');                 // opacity → 0 (mot + « … » via transition CSS)
    _waiterFade = setTimeout(() => {
      word.textContent = pickWaiterWord(word.textContent);
      word.classList.add('dots-reset');
      void word.offsetWidth;                    // force reflow → reset animation ::after
      word.classList.remove('dots-reset');
      word.classList.remove('fade');            // opacity → 1
    }, 280);                                     // doit matcher .waiter-word transition
  }, 5400);
}

function stopWaiter() {
  if (_waiterRotate) { clearInterval(_waiterRotate); _waiterRotate = null; }
  if (_waiterFade) { clearTimeout(_waiterFade); _waiterFade = null; }
}

// Rendu en cours de streaming, throttlé : on n'applique le markdown + la
// coloration que par fenêtres de ~90 ms. Chaque frame peinte est complète
// (parsée, décorée, colorée) — jamais d'état intermédiaire non coloré, donc
// pas de scintillement. La dernière mise à jour en attente est écrasée.
//
// Rendu PAR BLOCS (renderStreamBlocks) : réécrire tout le .body à chaque frame
// recréait chaque nœud, donc perdait toute sélection de texte et remettait à
// zéro le défilement interne des blocs de code bornés et des tableaux larges.
// Seuls les blocs dont la source a changé sont remplacés — en pratique le
// dernier. Et tant qu'une sélection touche un bloc à remplacer, le rendu est
// DIFFÉRÉ (le texte continue de s'accumuler dans gen.partialContent, rien n'est
// perdu) : il reprend au relâchement. Cf. docs/rendering.md.
let _streamTimer = null;
let _streamPending = null;

function streamInto(wrap, full) {
  stopWaiter();                 // transition WAITING/REASONING → STREAMING
  _streamPending = { wrap, full };
  if (!_streamTimer) scheduleStreamRender();
}

function scheduleStreamRender() {
  _streamTimer = setTimeout(() => {
    _streamTimer = null;
    const p = _streamPending;
    _streamPending = null;
    if (!p) return;
    // isAtBottom() DOIT être lu avant la mutation du DOM ci-dessous : le
    // nouveau contenu fait grandir scrollHeight, donc évalué après il donnerait
    // presque toujours "pas en bas" même quand l'utilisateur suivait le fil.
    const follow = shouldFollowStream(currentConvId);
    const body = p.wrap.querySelector('.body');
    if (renderStreamBlocks(p.wrap, body, p.full, { caret: true }) === 'deferred') {
      // Sélection en cours sur un bloc à remplacer : on repasse plus tard. Un
      // delta arrivé entre-temps a la priorité (il porte le texte le plus long).
      if (!_streamPending) _streamPending = p;
      scheduleStreamRender();
      return;
    }
    // Plafonné : le suivi s'arrête avant que l'énoncé qui a provoqué la
    // réponse ne sorte par le haut (cf. scrollBottomCapped).
    if (follow) scrollBottomCapped(currentConvId);
    // Du texte vient d'arriver en bas. Après le scroll de suivi, pas avant :
    // si `follow` nous a ramenés au fond, il n'y a rien de non vu.
    markThreadContentUnseen();
  }, 90);
}

// Annule un rendu de streaming en attente (avant un finalize/reset, pour qu'un
// timer en vol ne réécrive pas un contenu périmé avec le caret par-dessus).
function cancelStreamRender() {
  if (_streamTimer) { clearTimeout(_streamTimer); _streamTimer = null; }
  _streamPending = null;
}

// État de VUE du rendu par blocs, clefé par le .body (WeakMap : jamais posé sur
// un objet persisté). { keys, links, nodes } — nodes[i] : les nœuds DOM
// produits par le bloc i, enfants directs du .body. Pas de conteneur par bloc :
// le DOM reste celui d'un rendu d'un seul tenant, donc le CSS (`.body > p`,
// premiers/derniers enfants) n'a pas à le savoir.
const _streamBlocks = new WeakMap();

// Rend `full` dans `body` en ne remplaçant que les blocs dont la source a
// changé (streamBlockKeepCount, utils.js). Rend 'done', 'deferred' (une
// sélection touche un bloc à remplacer — jamais avec opts.force), ou 'full'
// (repli sur un rendu d'un seul tenant : marked sans lexer, ou opts.noHtml et un
// bloc HTML brut présent). Un état dont les nœuds ne sont plus dans le .body
// (finalize, patienteur d'un tour d'outils, rendu d'ailleurs) est jeté : on
// repart de zéro plutôt que de garder des nœuds qui ne sont plus à l'écran.
function renderStreamBlocks(wrap, body, full, opts) {
  const o = opts || {};
  const caretHtml = '<span class="cursor-blink"></span>';
  const fullRender = () => {
    _streamBlocks.delete(body);
    body.innerHTML = renderMd(full) + (o.caret ? caretHtml : '');
    decoratePre(wrap);
    highlightUnder(wrap);
    return 'full';
  };
  if (!window.marked || !marked.lexer || !marked.parser) return fullRender();
  // Fusion EXPLICITE avec marked.defaults : contrairement à marked.parse,
  // marked.lexer/marked.parser (12.0.0, source lue) prennent les options telles
  // quelles — `{ breaks: true }` seul perdrait GFM (tableaux) et le renderer de
  // code posé par marked.use.
  const mdOpts = Object.assign({}, marked.defaults, { breaks: true });
  const tokens = marked.lexer(resolveConvRefs(full), mdOpts);
  // Un bloc HTML brut peut ouvrir une balise qu'un bloc suivant referme :
  // assaini seul, il ne se recolle pas comme dans un rendu d'un seul tenant.
  // Toléré pendant le streaming (transitoire), jamais pour le rendu définitif.
  if (o.noHtml && tokens.some(t => t.type === 'html')) return fullRender();
  const next = { keys: tokens.map(t => t.raw), links: JSON.stringify(tokens.links || {}) };
  let st = _streamBlocks.get(body);
  if (st && !st.nodes.every(ns => ns.every(n => n.parentNode === body))) st = null;
  const keep = streamBlockKeepCount(st, next);
  const doomed = st ? [].concat(...st.nodes.slice(keep)) : [];
  if (st && !o.force && selectionTouchesNodes(doomed)) return 'deferred';
  const scroll = captureInnerScroll(doomed);
  if (st) doomed.forEach(n => n.remove());
  else body.textContent = '';                 // patienteur, rendu non suivi
  const oldCaret = body.querySelector(':scope > .cursor-blink');
  if (oldCaret) oldCaret.remove();
  const nodes = st ? st.nodes.slice(0, keep) : [];
  for (let i = keep; i < tokens.length; i++) {
    const one = [tokens[i]];
    one.links = tokens.links;                 // le parser résout les liens en référence depuis la liste
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitizeHtml(marked.parser(one, mdOpts));
    const ns = Array.from(tpl.content.childNodes);
    body.appendChild(tpl.content);
    nodes.push(ns);
  }
  if (o.caret) body.insertAdjacentHTML('beforeend', caretHtml);
  decoratePre(wrap);                          // idempotent : ne touche que les <pre> neufs
  // Relevé APRÈS decoratePre : wrapWideTables y déplace chaque <table> dans un
  // porteur `.table-bleed`, qui devient l'enfant direct du .body. Retenir le
  // <table> invaliderait l'état à la frame suivante (il n'est plus enfant du
  // .body), donc tout serait re-rendu à chaque frame dès qu'un tableau existe.
  for (let i = keep; i < nodes.length; i++) nodes[i] = nodes[i].map(n => bodyChildOf(body, n));
  _streamBlocks.set(body, { keys: next.keys, links: next.links, nodes });
  // Coloration des SEULS nœuds neufs : Prism réécrit le contenu du <code>, ce
  // qui détruirait une sélection posée dans un bloc gardé.
  // Depuis les nœuds RELEVÉS (porteurs compris) : le report du défilement doit
  // retrouver le `.table-bleed`, qui n'est pas dans les nœuds bruts du parser.
  const settled = [].concat(...nodes.slice(keep));
  settled.forEach(n => { if (n.nodeType === 1) highlightUnder(n); });
  restoreInnerScroll(settled, scroll);
  return 'done';
}

// Ancêtre de `n` qui est enfant direct de `body` (n lui-même s'il l'est déjà).
function bodyChildOf(body, n) {
  while (n && n.parentNode && n.parentNode !== body) n = n.parentNode;
  return n;
}

function selectionTouchesNodes(nodes) {
  if (!nodes.length || !window.getSelection) return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  return nodes.some(n => range.intersectsNode(n));
}

// Défilement interne des boîtes qui en ont un (bloc de code borné, porteur de
// tableau large), relevé dans l'ordre du document sur les nœuds remplacés et
// réappliqué dans le même ordre sur leurs successeurs : le bloc en cours
// d'écriture est justement celui qu'on fait défiler pour le lire.
const INNER_SCROLL_SELECTOR = 'pre > code, .table-bleed';
function innerScrollBoxes(nodes) {
  const out = [];
  nodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches(INNER_SCROLL_SELECTOR)) out.push(n);
    out.push(...n.querySelectorAll(INNER_SCROLL_SELECTOR));
  });
  return out;
}
function captureInnerScroll(nodes) {
  return innerScrollBoxes(nodes).map(el => ({ top: el.scrollTop, left: el.scrollLeft }));
}
function restoreInnerScroll(nodes, saved) {
  if (!saved.some(s => s.top || s.left)) return;
  innerScrollBoxes(nodes).forEach((el, i) => {
    if (!saved[i]) return;
    el.scrollTop = saved[i].top;
    el.scrollLeft = saved[i].left;
  });
}

// Au rendu définitif, les blocs gardés ont été colorés pendant le streaming —
// sauf si la grammaire Prism n'était pas encore chargée à ce moment (autoloader
// asynchrone). Ne recolorer que ceux-là : recolorer un bloc déjà coloré
// détruirait une sélection qu'on vient justement de préserver.
function highlightUncolored(scope) {
  if (!highlightEnabled || !window.Prism) return;
  scope.querySelectorAll('pre > code[class*="language-"]').forEach(el => {
    if (!el.querySelector('.token')) Prism.highlightElement(el);
  });
}

function resetAssistant(wrap) {
  cancelStreamRender();
  cancelReasoningRender();
  startWaiter(wrap.querySelector('.body'));     // reprise d'attente après un tour tool_calls
}

// Révèle l'horodatage inline d'une bulle assistant (heure + séparateur « · »),
// masqués tant que le message n'est pas finalisé. Partagé par les trois chemins
// de finalisation de dispatchSend (onToolTour, onFinal, onHalt — main.js).
function revealMsgTimestamp(wrap, ts) {
  const tsEl = wrap.querySelector('.msg-ts');
  if (tsEl) { tsEl.textContent = formatMessageTime(ts, Date.now()); tsEl.removeAttribute('hidden'); }
  const sepEl = wrap.querySelector('.msg-ts-sep');
  if (sepEl) sepEl.removeAttribute('hidden');
}

// truncated (optionnel, feature C) : pose/retire le bandeau .msg-truncated
// après .body. Les appelants qui ne tronquent jamais (onToolTour, onHalt,
// onError) omettent l'argument — équivaut à false, pas de bandeau.
function finalizeAssistant(wrap, full, truncated) {
  cancelStreamRender();
  cancelReasoningRender();
  stopWaiter();
  const follow = shouldFollowStream(currentConvId);   // lu avant mutation DOM, cf. streamInto
  const body = wrap.querySelector('.body');
  // Même chemin par blocs que le streaming, sans différé ni caret : un rendu
  // d'un seul tenant ferait perdre, à la toute fin, la sélection que le
  // streaming vient de préserver. Rendu identique à renderMd (le parser marked
  // rend chaque bloc de premier niveau indépendamment), sauf bloc HTML brut —
  // d'où noHtml, qui retombe alors sur le rendu d'un seul tenant.
  if (renderStreamBlocks(wrap, body, full, { force: true, noHtml: true }) === 'done') {
    highlightUncolored(body);
  }
  _streamBlocks.delete(body);
  body.dataset.raw = full;
  renderMermaidUnder(wrap);   // rendu mermaid à la finalisation SEULEMENT (jamais streamInto)
  const copyBtn = wrap.querySelector('.msg-copy');
  if (copyBtn) copyBtn.removeAttribute('hidden');
  const dlBtn = wrap.querySelector('.msg-dl');
  if (dlBtn) dlBtn.removeAttribute('hidden');
  const existingBanner = wrap.querySelector('.msg-truncated');
  if (truncated && !existingBanner) {
    body.insertAdjacentHTML('afterend', truncatedBannerHtml());
  } else if (!truncated && existingBanner) {
    existingBanner.remove();
  }
  syncConvDownloadBtn();
  syncLastAssistantActions();
  reindexThreadDom();   // l'entrée assistant vient d'être poussée (cf. call-sites main.js)
  if (follow) scrollBottomCapped(currentConvId);
  // Seul rendu du tour quand la réponse est plus courte que le throttle de
  // streamInto : sans cet appel, une réponse brève n'allumerait jamais le glow.
  markThreadContentUnseen();
}

// Finalisation d'un tour en ÉCHEC (400 backend, exception réseau, non-convergence).
// N'existe que pour l'affichage : ce message n'est jamais persisté ni exporté.
// Rendu en texte brut échappé (le message peut porter un JSON multi-ligne, cf.
// erreurs de backend) dans un .msg-error dédié — surtout PAS via renderMd, qui
// mangerait la mise en forme et imposerait un italique. Style : rouge désaturé,
// plus petit, non-italique (chat.css).
function finalizeAssistantError(wrap, msg) {
  cancelStreamRender();
  cancelReasoningRender();
  stopWaiter();
  const follow = shouldFollowStream(currentConvId);
  const body = wrap.querySelector('.body');
  body.className = 'body msg-error';
  body.textContent = String(msg);
  const copyBtn = wrap.querySelector('.msg-copy');
  if (copyBtn) copyBtn.setAttribute('hidden', '');
  const dlBtn = wrap.querySelector('.msg-dl');
  if (dlBtn) dlBtn.setAttribute('hidden', '');
  syncLastAssistantActions();
  if (follow) scrollBottomCapped(currentConvId);
}

// ── Édition d'un message utilisateur ────────────────────────────────────────
// Réindexation autoritaire DOM → currentThread. Chaque bulle `.msg` reçoit
// `data-thread-idx` = l'index RÉEL de son entrée dans currentThread (les
// entrées sans bulle propre — acks, frontière de compaction — sont sautées,
// prédicat unique `entryHasMsgBubble`, utils.js). C'est LA
// source de vérité de l'appariement bulle↔entrée — jamais un recomptage par
// call-site (l'ancien msgIndex appariait « n-ième .msg ↔ n-ième non-ack », qui
// désalignait silencieusement dès qu'un `.msg` DOM et une entrée divergeaient
// en nombre/ordre : édition d'un message qui chargeait la mauvaise entrée). À
// rappeler après toute mutation qui change la correspondance (renderThread,
// ajout live, finalisation, suppression). Garde de divergence : si le nombre de
// `.msg` ne correspond pas au nombre d'entrées à bulle, on le signale (console)
// — un mapping partiel vaut mieux qu'un mapping faux et muet.
function reindexThreadDom() {
  const msgs = $('thread').querySelectorAll('.msg');
  const bubbled = [];
  for (let i = 0; i < currentThread.length; i++) {
    if (entryHasMsgBubble(currentThread[i])) bubbled.push(i);
  }
  if (msgs.length !== bubbled.length && typeof console !== 'undefined') {
    console.warn('[miaou] reindexThreadDom: ' + msgs.length + ' bulle(s) .msg pour ' +
      bubbled.length + ' entrée(s) à bulle — appariement partiel');
  }
  const n = Math.min(msgs.length, bubbled.length);
  for (let k = 0; k < n; k++) msgs[k].dataset.threadIdx = bubbled[k];
  // Bulles en excès (jamais censé arriver) : pas d'attribut → msgIndex renvoie -1.
  for (let k = n; k < msgs.length; k++) delete msgs[k].dataset.threadIdx;
}

// Traduit une bulle `.msg` en index currentThread. Lit `data-thread-idx` posé
// par reindexThreadDom ; re-réindexe d'abord si l'attribut manque (bulle créée
// après la dernière passe, ou conversation d'avant l'introduction de l'attribut).
function msgIndex(wrap) {
  if (!wrap || !wrap.classList || !wrap.classList.contains('msg')) return -1;
  if (wrap.dataset.threadIdx == null) reindexThreadDom();
  const n = wrap.dataset.threadIdx == null ? -1 : Number(wrap.dataset.threadIdx);
  return Number.isInteger(n) ? n : -1;
}

function onEditMsg(btn) {
  if (sending) return;                          // pas d'édition pendant un stream
  const wrap = btn.closest('.msg');
  if (!wrap) return;
  // Message situé AVANT la dernière frontière de compaction : l'envoi de
  // l'édition tronquera le thread après lui, frontière comprise. Second clic
  // exigé, sur le même prédicat que l'avis affiché après coup
  // (`compactionUndoneNotice`, utils.js) — deux formules divergeraient.
  const index = msgIndex(wrap);
  if (index >= 0 && compactionUndoneNotice(currentThread, index + 1)) {
    armThenRun(btn, () => enterEditMode(wrap), null,
      'Modifier ce message annulera la compaction — cliquer à nouveau pour confirmer');
    return;
  }
  enterEditMode(wrap);
}

// Bouton « régénérer » de la dernière réponse. Même garde que `onEditMsg` :
// régénérer juste après une compaction retire la frontière, posée en fin de
// thread APRÈS cette réponse (revue du 2026-09-22). Le cas nominal — aucune
// frontière emportée — reste un clic simple.
function onRegenBtn(btn) {
  if (compactionUndoneNotice(currentThread, regenerateKeptLength(currentThread))) {
    armThenRun(btn, regenerateResponse, null,
      'Régénérer annulera la compaction — cliquer à nouveau pour confirmer');
    return;
  }
  regenerateResponse();
}

function enterEditMode(wrap) {
  if (sending) return;
  // Agent en vol sur cette conversation : ouvrir la zone d'édition promettrait
  // une réécriture que editUserMessage refusera de toute façon (main.js). Le
  // bouton crayon, lui, n'est pas masqué : il est rendu UNE FOIS à la
  // construction de la bulle et n'a pas de passe de synchro par état — le
  // masquer demanderait d'en créer une, et il faudrait la rappeler au spawn
  // comme à la fin de chaque agent. Garder au clic est ici le geste juste, et
  // c'est déjà exactement ce que `sending` fait juste au-dessus.
  if (hasWorkingAgent(currentConvId)) return;
  const index = msgIndex(wrap);
  if (index < 0) return;
  // Source UNIQUE du texte éditable et de la bulle restaurée : displayText (littéral
  // tapé) si présent, sinon content. Jamais le content baké d'une slash-commande
  // skill — sinon la textarea et la bulle (après annulation) fuiteraient le corps injecté.
  const m = currentThread[index];
  // Réponse d'agent : non éditable (cf. buildMsg). Deuxième voie fermée, pas un
  // doublon de la première — le bouton absent ne protège que le clic.
  if (m && m.agentResult) return;
  const original = m ? (m.displayText != null ? m.displayText : m.content) : '';

  wrap.classList.add('editing');
  const bubble = wrap.querySelector('.bubble');
  // Dropdown sous la textarea (seule différence positionnelle avec le composer,
  // où il est au-dessus) : placé juste APRÈS dans le DOM, AVANT les actions.
  bubble.innerHTML =
    `<textarea class="msg-edit-area" spellcheck="false"></textarea>` +
    `<div class="skill-ac" hidden></div>` +
    `<div class="msg-edit-actions">` +
    `<button class="mb-btn" data-act="cancel">Annuler</button>` +
    `<button class="mb-btn primary" data-act="save">Valider</button>` +
    `</div>` +
    `<div class="msg-edit-error" hidden></div>`;

  const ta = bubble.querySelector('.msg-edit-area');
  const box = bubble.querySelector('.skill-ac');
  const ac = { ta, box, index: -1, trigger: null };
  ta.value = original;
  autoGrow(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  ta.addEventListener('input', () => { autoGrow(ta); clearEditError(wrap); updateSkillAutocomplete(ac); });
  ta.addEventListener('keydown', (e) => {
    if (skillAutocompleteOpen(ac)) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSkillAcSelection(ac, 1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); moveSkillAcSelection(ac, -1); return; }
      if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); hideSkillAutocomplete(ac); return; }
      if (e.key === 'Tab')       { e.preventDefault(); acceptSkillAcSelection(ac); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acceptSkillAcSelection(ac); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(wrap, original); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(wrap, ta.value); }
  });
  bubble.querySelector('[data-act="cancel"]').onclick = () => cancelEdit(wrap, original);
  bubble.querySelector('[data-act="save"]').onclick = () => commitEdit(wrap, ta.value);
}

// Annulation : restaure le contenu de la bulle. Le footer (.msg-user-footer :
// boutons + .msg-ts) est un sibling du .bubble (hors de sa portée), il n'est
// pas touché. Les chips d'attachments (brief A) sont réinsérées au même
// emplacement que dans buildMsg (avant le body) — sans quoi elles
// disparaîtraient jusqu'au prochain reload (le message, lui, les porte toujours).
function cancelEdit(wrap, original) {
  wrap.classList.remove('editing');
  const index = msgIndex(wrap);
  const m = index >= 0 ? currentThread[index] : null;
  const bubble = wrap.querySelector('.bubble');
  bubble.innerHTML =
    renderMsgAttachments(m && m.attachments, currentConvId) +
    `<div class="body">${renderUserMd(original)}</div>`;
  decoratePre(wrap);
  highlightUnder(wrap);
}

// Validation : recalcule l'index (le thread n'a pas bougé, mais on ne fige rien)
// puis délègue la troncature + relance à editUserMessage (main.js). Un slug skill
// invalide remonte une erreur affichée SOUS LA ZONE D'ÉDITION (pas le composer) ;
// le thread reste intact et la bulle en mode édition pour correction. En cas de
// succès, editUserMessage re-rend le thread → la bulle d'édition (et son erreur)
// disparaissent.
async function commitEdit(wrap, value) {
  const t = (value || '').trim();
  if (!t) return;
  const index = msgIndex(wrap);
  if (index < 0) return;
  const err = await editUserMessage(index, t);
  if (err) showEditError(wrap, err);
}

function showEditError(wrap, msg) {
  const el = wrap && wrap.querySelector('.msg-edit-error');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}
function clearEditError(wrap) {
  const el = wrap && wrap.querySelector('.msg-edit-error');
  if (el) { el.setAttribute('hidden', ''); el.textContent = ''; }
}

// ── Indicateur d'activité en arrière-plan ───────────────────────────────────
// Point d'entrée unique avec compteur, pour gérer les chevauchements.
//
// L'indicateur est GLOBAL et anonyme : il dit « une tâche de fond tourne »,
// jamais laquelle ni dans quelle conversation. C'est ce qui convient à ses
// usages historiques (résumé, titrage, description de fichier), qui n'ont
// aucune autre surface.
//
// La compaction fait exception (lot AE, étape 8) : elle a une SECONDE surface,
// la pilule d'activité de la topbar, qui dit la même chose en mieux dès qu'on
// a quitté la conversation — elle la NOMME et permet d'y revenir d'un clic.
// Les deux allumées en même temps font doublon (signalé par Julien,
// 2026-09-22). D'où `_bgSuppressed` : un drapeau qui éteint l'indicateur sans
// toucher au compteur, de sorte que les tâches CONCURRENTES (un titrage qui
// tournerait pendant la compaction) continuent d'être comptées et que la levée
// du drapeau les retrouve.
let _bgCount = 0;
let _bgSuppressed = false;
function bgActivityStart(label) {
  _bgCount++;
  $('bg-label').textContent = label;
  syncBgActivity();
}
function bgActivityEnd() {
  _bgCount = Math.max(0, _bgCount - 1);
  syncBgActivity();
}

// Écrivain UNIQUE de la classe `.active` — les trois points qui la
// changeaient (start, end, et la suppression) passent par ici, sinon le
// dernier à parler gagnerait (souvenir `concurrent-writers`).
function syncBgActivity() {
  const el = $('bg-activity');
  if (!el) return;
  el.classList.toggle('active', _bgCount > 0 && !_bgSuppressed);
}

// Masque l'indicateur alors qu'une tâche tourne toujours : la tâche a une
// autre surface, mieux placée, et deux annonces du même fait se lisent comme
// deux faits. Réversible à tout moment — c'est ce qui permet de suivre la
// navigation, la pilule ne prenant le relais qu'une fois la conversation
// quittée.
function setBgActivitySuppressed(on) {
  _bgSuppressed = !!on;
  syncBgActivity();
}
function bgActivityLabel(label) {
  $('bg-label').textContent = label;
}

// ── Sidebar / sections temporelles ──────────────────────────────────────────
// En-tête de section de la sidebar. Bornes calendaires via calendarBucket
// (utils.js) — partagées avec relativeWhen.
function sectionFor(ts) {
  if (!ts) return 'Plus ancien';
  switch (calendarBucket(ts, Date.now()).bucket) {
    case 'today':     return "Aujourd'hui";
    case 'yesterday': return 'Hier';
    case 'week':      return '7 derniers jours';
    case 'month':     return '30 derniers jours';
    default:          return 'Plus ancien';
  }
}

// Libellé de date d'une conversation dans la sidebar. Même découpage calendaire
// que sectionFor (calendarBucket), formatage distinct : le jour même affiche
// l'heure (HH:MM) plutôt que « aujourd'hui », redondant avec l'en-tête de section.
function relativeWhen(ts) {
  if (!ts) return '';
  const b = calendarBucket(ts, Date.now());
  const hhmm = () => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (b.bucket === 'today') return hhmm();
  if (b.bucket === 'yesterday') return 'hier à ' + hhmm();
  if (b.daysAgo < 7) return 'il y a ' + b.daysAgo + ' j';
  if (b.daysAgo < 30) return 'il y a ' + Math.floor(b.daysAgo / 7) + ' sem';
  return new Date(ts).toLocaleDateString('fr-FR', { month: 'long' });
}

// Filtre de recherche courant (prédicat sur une conversation), ou null pour
// « tout afficher ». Persistant : conservé à travers les re-rendus (maj en
// arrière-plan, sélection, etc.) tant que le champ de recherche n'est pas vidé.
let convSearchFilter = null;

// Placeholder du champ de recherche AU FOCUS : il enseigne la syntaxe au moment
// exact où elle sert. Au repos le champ annonce sa fonction (« Rechercher… ») ;
// une fois dedans, l'utilisateur sait déjà qu'il cherche — la place est mieux
// employée à montrer ce qu'il peut taper.
//
// Registre unique, à dessein : les deux membres se lisent comme ce qu'ils
// décrivent, jamais comme des méta-variables à remplacer (« terme1 terme2 » fait
// hésiter sur ce qu'il faut vraiment taper). Les guillemets sont MONTRÉS en
// situation plutôt qu'expliqués : c'est la seule part de la syntaxe qui ne se
// devine pas.
//
// Partagé avec le sous-mode `conv` de la palette (CMDK_PLACEHOLDERS) : les deux
// surfaces acceptent la même syntaxe, et ne l'enseigner que d'un côté laisserait
// croire que l'autre ne la comprend pas.
const SEARCH_SYNTAX_PLACEHOLDER = 'mots cherchés ou "suite exacte"';

// Compagnons du filtre pour le RENDU des résultats (extraits surlignés) — pas
// pour le filtrage lui-même, qui reste l'affaire du seul `convSearchFilter`.
// `convSearchQuery` porte la requête telle que frappée (le filtre est une
// closure, elle ne la rend pas) ; `convSearchExcerpts` est la Map id → extrait
// que rend `collectContentSearchHits`.
//
// Leur cycle de vie est EXACTEMENT celui de `convSearchFilter` — posés et remis
// à null aux mêmes points, y compris dans `cancelConvSearchDebounce`. Un extrait
// qui survivrait à une requête abandonnée se poserait sur les cartes de la
// suivante, en surlignant des mots qu'elle ne contient pas.
let convSearchQuery = '';
let convSearchExcerpts = null;

// Prédicat de recherche : match direct (sous-chaîne) sur le titre, ou
// recouvrement de mots-clés sur le résumé via le scoring existant (seuil bas,
// plus permissif que l'injection automatique), ou enfin appartenance à
// `contentHits`. null si requête vide.
//
// `contentHits` (U-3) est l'ensemble des ids dont le CONTENU matche, précalculé
// en async par `collectContentSearchHits` (storage.js) : depuis le passage des
// conversations en IDB, une conversation froide n'a pas ses `messages` en RAM,
// et le scan de contenu ne peut plus se faire ici. Le prédicat reste synchrone —
// c'est ce qui permet à `renderConvList` et à la palette de ne pas changer.
// Argument OMIS = pas de scan de contenu (titre et résumé seulement) ; c'est le
// comportement des appelants qui ne veulent pas payer la lecture, et celui du
// premier rendu avant que la passe async ait rendu la main.
function searchConversations(query, contentHits) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  // Termes plutôt que requête brute : un groupe entre guillemets vaut UN terme
  // (sa suite doit se retrouver telle quelle), le reste se coupe aux espaces, et
  // TOUS doivent être présents. Sans ce découpage, une requête citée chercherait
  // les guillemets eux-mêmes dans le titre — aucun titre ne matcherait jamais.
  // Même parsing que le scan de contenu (`convContentMatch`) : les deux moitiés
  // de la recherche doivent répondre à la même question.
  const needles = excerptKeywords(q);
  // Le résumé garde son scoring par mots (scoreSummary, recouvrement pondéré) :
  // il est court et rédigé par la machine, un ET strict y serait trop sévère.
  const qTokens = tokenize(q);
  // Un seul instantané des résumés, capturé par la closure : le prédicat est
  // appelé une fois par conversation, sans relire le cache à chaque appel.
  const summaries = loadSummaries();
  return c => {
    const title = (c.title || '').toLowerCase();
    if (needles.length && needles.every(n => title.indexOf(n) !== -1)) return true;
    const entry = summaries[c.id];
    if (entry && !entry.suppressed && entry.summary && scoreSummary(qTokens, entry) >= 1) return true;
    return !!(contentHits && contentHits.has(c.id));
  };
}

// Debounce de la recherche (CONV_SEARCH_DEBOUNCE_MS) : le filtre reconstruit
// toute la liste ET joue son animation d'entrée, deux gestes qu'on ne veut pas
// à chaque frappe. Ce qui est temporisé est le RÉSULTAT (filtre + render) ; le
// bouton d'effacement, lui, reflète la présence de texte dans le champ, pas le
// résultat — il reste donc immédiat, sinon il traînerait derrière la frappe.
// Le timer est un état de module annulable : clearConvSearch DOIT l'annuler,
// sans quoi une frappe suivie d'un effacement dans la fenêtre de debounce
// verrait le timer en vol réappliquer l'ancien filtre APRÈS la remise à null.
const CONV_SEARCH_DEBOUNCE_MS = 150;
let _convSearchTimer = null;
// Jeton de séquence de la passe de scan de contenu (U-3). Le scan est async
// (lecture IDB) : deux frappes rapprochées peuvent avoir leurs passes en vol
// simultanément, et rien ne garantit qu'elles rendent la main dans l'ordre.
// Sans jeton, la plus lente écraserait le résultat de la plus récente et la
// liste afficherait le filtre d'une requête abandonnée
// (cf. `project_await_reentrancy_guard`). Même geste que `_openConvSeq`.
let _convSearchSeq = 0;

function cancelConvSearchDebounce() {
  if (_convSearchTimer !== null) { clearTimeout(_convSearchTimer); _convSearchTimer = null; }
  // Invalide aussi toute passe de scan en vol : un effacement du champ ne doit
  // pas voir un filtre réapparaître quand la lecture IDB rend la main.
  _convSearchSeq++;
  // Les extraits suivent le filtre, jamais leur propre horloge : une passe en
  // vol invalidée ne doit pas laisser derrière elle les extraits qu'elle avait
  // déjà posés (ils seraient réutilisés tels quels au rendu suivant, alors
  // qu'ils décrivent une requête abandonnée).
  convSearchExcerpts = null;
}

// Bascule du placeholder au focus/blur. Le texte de repos est lu depuis
// l'attribut HTML au premier focus et mémorisé sur le nœud : le dupliquer en
// constante JS ferait deux sources pour un même libellé, dont l'une seulement
// serait mise à jour le jour où il change.
function onConvSearchFocus() {
  const input = $('conv-search');
  if (!input) return;
  if (input._restPlaceholder == null) input._restPlaceholder = input.placeholder;
  input.placeholder = SEARCH_SYNTAX_PLACEHOLDER;
}

function onConvSearchBlur() {
  const input = $('conv-search');
  if (!input) return;
  if (input._restPlaceholder != null) input.placeholder = input._restPlaceholder;
}

function onConvSearch() {
  const input = $('conv-search');
  $('search-clear').classList.toggle('show', !!input.value);
  cancelConvSearchDebounce();
  _convSearchTimer = setTimeout(async () => {
    _convSearchTimer = null;
    // Relecture du champ DANS le timer, jamais une valeur figée à l'armement :
    // la frappe a pu continuer (doctrine « relire l'état après l'attente »,
    // même esprit que le piège 24).
    const query = $('conv-search').value;
    const seq = ++_convSearchSeq;
    // Premier rendu SANS attendre la lecture IDB : titre et résumé suffisent à
    // remplir la liste immédiatement. Le scan de contenu la complète ensuite.
    // Sans ce rendu intermédiaire, la liste resterait figée sur l'ancien filtre
    // pendant toute la lecture — perceptible sur un gros historique.
    convSearchFilter = searchConversations(query);
    convSearchQuery = query.trim();
    convSearchExcerpts = null;
    animateNextConvList();
    renderConvList();
    const hits = await collectContentSearchHits(query);
    if (seq !== _convSearchSeq) return;   // requête abandonnée entre-temps
    if (!hits.size) return;               // rien à ajouter : pas de re-rendu
    convSearchFilter = searchConversations(query, hits);
    convSearchExcerpts = hits;
    animateNextConvList();
    renderConvList();
  }, CONV_SEARCH_DEBOUNCE_MS);
}

// Ramène l'élément de conversation actif dans la partie visible de la liste.
// Sans effet si aucune conversation active. Fonctionne même sidebar masquée
// (scrollIntoView agit sur le conteneur overflow hors écran) : on la retrouve
// déjà en vue à sa réouverture. `block` = 'nearest' par défaut (scroll minimal,
// pas de mouvement si déjà visible) ; 'center' pour dégager la conv du bord.
function revealActiveConv(block) {
  const active = $('conv-list').querySelector('.conv.active');
  if (active) active.scrollIntoView({ block: block || 'nearest' });
}

function clearConvSearch() {
  const input = $('conv-search');
  input.value = '';
  $('search-clear').classList.remove('show');
  cancelConvSearchDebounce();
  convSearchFilter = null;
  convSearchQuery = '';
  animateNextConvList();
  renderConvList();
  // La sélection courante (potentiellement très ancienne) peut être hors écran
  // une fois la liste complète restaurée : on la ramène dans le champ visible.
  revealActiveConv();
  input.focus();
}

// ── Suppression en deux temps (« armer puis confirmer ») ────────────────────
// Premier clic : le bouton passe en état armé (.armed, mis en évidence) pendant
// ARM_DELETE_MS ; second clic dans la fenêtre : exécution. Timeout → désarmé.
// Évite un dialog natif (cohérence UI) tout en protégeant d'un clic raté au
// survol. Générique : poubelle de la sidebar (conversations) et boutons
// « Supprimer » des cartes MCP/API/skills. `armedLabel` (optionnel) remplace le
// texte du bouton pendant l'armement (boutons textuels) ; les boutons icône
// s'appuient sur la classe .armed + le title.
//
// Sert aussi, depuis la revue AE du 2026-09-22, de GARDE sur deux gestes non
// destructeurs par nature mais qui peuvent annuler une compaction (régénérer,
// éditer — cf. `onRegenBtn`/`onEditMsg`). `armedTitle` (optionnel) y dit
// pourquoi le second clic est demandé ; la couleur de l'état armé est portée
// par le CSS de chaque bouton — rouge `--err` pour une suppression, accent de
// la palette pour une garde, qui n'est pas une destruction.
const ARM_DELETE_MS = 2600;

function armThenRun(btn, onConfirm, armedLabel, armedTitle) {
  if (btn.classList.contains('armed')) {
    clearTimeout(btn._disarmTimer);
    btn.classList.remove('armed');
    onConfirm();
    return;
  }
  btn.classList.add('armed');
  btn._origTitle = btn.title;
  btn.title = armedTitle || 'Cliquer à nouveau pour confirmer';
  if (armedLabel != null) { btn._origLabel = btn.textContent; btn.textContent = armedLabel; }
  btn._disarmTimer = setTimeout(() => {
    btn.classList.remove('armed');
    btn.title = btn._origTitle || '';
    if (armedLabel != null && btn._origLabel != null) btn.textContent = btn._origLabel;
  }, ARM_DELETE_MS);
}

// Handler global de la poubelle sidebar (référencé en onclick= inline).
function onConvDel(btn, id) {
  armThenRun(btn, () => deleteConv(id));
}

// Icônes d'épingle (pleine = épinglé, contour = à épingler).
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 10.76V4h6v6.76a2 2 0 0 0 .59 1.42L18 14.5H6l2.41-2.32A2 2 0 0 0 9 10.76z"/></svg>';

// ── Mode sélection / déplacement de conversations entre Spaces (brief Cter) ──
// Rien de visible au repos (contrainte UX dure du brief) : `_moveMode` gouverne
// la classe `.select-mode` sur #conv-list (affiche les checkboxes) et la
// présence de la barre contextuelle (#move-bar). `_moveSelection` (Set d'ids)
// est l'état source, relu par convItemEl à chaque reconstruction de la liste
// (renderConvList ne préserve aucun état DOM, cf. audit §1).
let _moveMode = false;
let _moveSelection = new Set();

// Déclenché par l'item du menu Space. Pas de vérification ici sur le
// nombre de Spaces disponibles : renderSpaceMenu masque déjà l'item si
// loadSpaces().length < 2 (aucune destination possible).
// Préselectionne la conversation actuellement affichée (si présente dans le
// Space actif) : geste le plus probable en entrant en mode déplacement.
function enterMoveMode() {
  _moveMode = true;
  // EXCLURE DE LA PRÉSÉLECTION, PUIS GRISER — dans cet ordre (lot X-1).
  // Une conversation dont un agent tourne ne peut pas être déplacée : son
  // enfant resterait dans l'ancien Espace, ce qui est exactement la violation
  // d'herméticité que le piège 18 interdit (un agent orphelin de référentiel).
  // Sans l'exclusion, la conversation affichée — présélectionnée par défaut —
  // apparaîtrait COCHÉE ET GRISÉE : une sélection que l'utilisateur ne peut pas
  // retirer, dans une barre annonçant « 1 conversation » et un bouton qui
  // échouerait. `renderMoveBar` compte `_moveSelection.size`, donc l'ensemble
  // vide y retombe naturellement sur le cas ordinaire « rien de sélectionné ».
  _moveSelection = (currentConvId && !hasWorkingAgent(currentConvId))
    ? new Set([currentConvId]) : new Set();
  renderConvList();
  renderMoveBar();
}

// Sortie du mode, quelle qu'en soit la cause (Cancel, move effectué, envoi
// d'un message). Un seul point de sortie, ré-utilisé partout : évite
// la logique éparpillée que le brief proscrit explicitement.
function exitMoveMode() {
  if (!_moveMode) return;
  _moveMode = false;
  _moveSelection = new Set();
  renderConvList();
  renderMoveBar();
}

// Appelée uniquement si le mode est actif — évite tout re-render superflu sur
// le chemin d'envoi normal (hors mode sélection, l'appel est un no-op immédiat).
function exitMoveModeIfActive() {
  if (_moveMode) exitMoveMode();
}

function toggleConvSelection(id, checked) {
  if (checked) _moveSelection.add(id); else _moveSelection.delete(id);
  renderMoveBar();
}

// ── Surlignage des correspondances de recherche ─────────────────────────────
// SEUL point d'écriture du <mark> de l'application : sidebar (titre et extrait)
// et palette (label et extrait) passent tous les quatre par ici. Le texte est
// d'origine utilisateur ou modèle — titres de conversation, messages — donc il
// est posé en `textContent`, jamais en template string : concaténer du HTML
// autour de lui ouvrirait une injection là où le reste du rendu de liste s'en
// garde déjà (cf. la doctrine de renderCommandList).
//
// `ranges` vient de `findMatchRanges`/`buildExcerpt` (utils.js, pur) : offsets
// déjà fusionnés et triés, donc pas de <mark> imbriqué à gérer ici. Ranges vides
// ou absents → simple textContent, ce qui rend la fonction utilisable sans
// condition à l'appel.
function applyHighlight(el, text, ranges) {
  el.textContent = '';
  const s = String(text == null ? '' : text);
  const rs = (ranges || []).filter(r => r && r.end > r.start);
  if (!rs.length) { el.textContent = s; return el; }
  let at = 0;
  for (const r of rs) {
    const start = Math.max(at, Math.min(r.start, s.length));
    const end = Math.max(start, Math.min(r.end, s.length));
    if (start > at) el.appendChild(document.createTextNode(s.slice(at, start)));
    if (end > start) {
      const mk = document.createElement('mark');
      mk.className = 'search-hit';
      mk.textContent = s.slice(start, end);
      el.appendChild(mk);
    }
    at = end;
  }
  if (at < s.length) el.appendChild(document.createTextNode(s.slice(at)));
  return el;
}

// Ligne d'extrait d'un résultat de recherche (sidebar et palette), ellipses de
// bord comprises. `excerpt` est ce que rend `buildExcerpt` ; les ellipses sont
// posées ICI et non dans le texte de l'extrait, pour que les offsets de
// surlignage restent alignés sur le texte nu (cf. buildExcerpt).
function searchExcerptEl(excerpt, className) {
  const el = document.createElement('div');
  el.className = className;
  applyHighlight(el, excerpt.text, excerpt.ranges);
  if (excerpt.leading) el.insertBefore(document.createTextNode('…'), el.firstChild);
  if (excerpt.trailing) el.appendChild(document.createTextNode('…'));
  return el;
}

function convItemEl(c, convs) {
  const el = document.createElement('div');
  el.className = 'conv' + (c.id === currentConvId ? ' active' : '') + (c.pinned ? ' pinned' : '');
  el.onclick = () => selectConv(c.id);
  const checked = _moveSelection.has(c.id) ? ' checked' : '';
  // Case GRISÉE si un agent de cette conversation tourne (lot X-1) :
  // la déplacer laisserait son enfant dans l'ancien Espace — l'agent orphelin
  // de référentiel que le piège 18 interdit. `hasWorkingAgent` est LE prédicat,
  // le même que celui de l'exclusion de présélection (enterMoveMode) et de la
  // pastille : pas un second balayage.
  // Le titre porte la RAISON : une case inerte sans explication se lit comme un
  // bug (« pourquoi je ne peux pas cocher celle-là ? »).
  const agentBusy = hasWorkingAgent(c.id, convs);
  const lockAttrs = agentBusy
    ? ' disabled title="Un agent de cette conversation travaille : elle ne peut pas être déplacée pour l\'instant."'
    : '';
  // convLabel, pas `c.title` nu (lot AA) : c'était la dernière des surfaces de
  // libellé restée hors du prédicat. Elle y gagne l'extrait provisoire — la
  // branche `agentIntent` y est morte par construction (renderConvList filtre
  // sur isRootConversation, un agent n'atteint jamais cette ligne), ce qui ne
  // dispense pas le prédicat de la porter : elle sert aux deux autres surfaces.
  const lbl = convLabel(c);
  const titleCls = 'conv-title' + (lbl.provisional ? ' provisional' : '');
  el.innerHTML =
    `<input type="checkbox" class="conv-select" onclick="event.stopPropagation();toggleConvSelection('${c.id}',this.checked)"${checked}${lockAttrs}>
     <div class="conv-body">
       <div class="${titleCls}">${escHtml(lbl.text || 'Nouvelle conversation')}</div>
       <div class="conv-date" title="${escHtml(formatFullDateFr(c.updatedAt || c.timestamp))}">${escHtml(relativeWhen(c.updatedAt || c.timestamp))}</div>
     </div>
     <div class="conv-actions">
       <button class="conv-pin" title="${c.pinned ? 'Désépingler' : 'Épingler'}" onclick="event.stopPropagation();togglePin('${c.id}')">${PIN_SVG}</button>
       <button class="conv-del" title="Supprimer" onclick="event.stopPropagation();onConvDel(this,'${c.id}')">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
       </button>
     </div>`;
  // Pastille d'activité (lot T-2) posée en DOM plutôt qu'en template string :
  // applyActivityBadge est LE seul point d'écriture, partagé par les quatre
  // surfaces — concaténer des classes ici ferait un deuxième chemin, qui
  // dériverait. renderConvList reconstruit tout à chaque appel, aucun état DOM
  // à préserver (piège 11 : la fonction reste sans argument, elle dérive l'état
  // du registre elle-même).
  el.insertBefore(activityBadgeEl(convBadgeState(c.id, convs)), el.querySelector('.conv-actions'));

  // Rendu de recherche (extraits surlignés), seulement pendant une recherche
  // active. Deux gestes distincts, chacun conditionnel :
  //   - le TITRE est re-rendu en DOM quand la requête y apparaît. Il reste écrit
  //     en template ci-dessus (cas nominal, écrasante majorité des rendus) ; on
  //     ne le remplace que pour poser les <mark>, ce que la template string ne
  //     peut pas faire sans concaténer du HTML autour d'un titre utilisateur.
  //   - l'EXTRAIT n'apparaît que si le match vient du CONTENU. Un match de titre
  //     seul n'ajoute pas de ligne : elle répéterait le titre juste au-dessus.
  if (convSearchQuery) {
    const titleRanges = findMatchRanges(lbl.text || 'Nouvelle conversation', excerptKeywords(convSearchQuery));
    if (titleRanges.length) {
      applyHighlight(el.querySelector('.conv-title'), lbl.text || 'Nouvelle conversation', titleRanges);
    }
    const ex = convSearchExcerpts && convSearchExcerpts.get(c.id);
    if (ex) el.querySelector('.conv-body').appendChild(searchExcerptEl(ex, 'conv-excerpt'));
  }
  return el;
}

function sectionEl(label) {
  const s = document.createElement('div');
  s.className = 'conv-section';
  s.textContent = label;
  return s;
}

// Animation d'entrée de la liste (opt-in explicite, one-shot). renderConvList
// est appelée très souvent pour des raisons qui ne changent PAS le contenu
// visible de la liste (titrage async, pastille d'activité, épinglage, mode
// sélection) : animer à chaque appel ferait clignoter la sidebar en permanence.
// Seuls les gestes qui remplacent réellement le jeu d'items arment le flag
// (bascule de Space, recherche). Il est consommé — et remis à false — par le
// render suivant, quel qu'il soit : un flag armé ne peut pas survivre pour être
// joué au mauvais moment. L'anim elle-même est du CSS pur (.conv-list.enter),
// donc déjà neutralisée par le kill-switch reduced-motion (base.css) sans gate
// JS supplémentaire.
const CONV_ENTER_STAGGER_MAX = 12;
let _convListAnim = false;

function animateNextConvList() { _convListAnim = true; }

function renderConvList() {
  const list = $('conv-list');
  const animate = _convListAnim;
  _convListAnim = false;
  list.classList.remove('enter');
  list.innerHTML = '';
  list.classList.toggle('select-mode', _moveMode);
  // Deux filtres qui COMPOSENT, jamais un prédicat qui répond aux deux questions
  // (piège 18) : l'appartenance au Space actif, et « est-ce une racine ? ».
  // L'exclusion des agents (lot X-1, exclusion 3 de 3ter) est ORTHOGONALE à
  // l'herméticité — les mélanger donnerait le prédicat à double sens que le
  // piège 18 interdit. La recherche (convSearchFilter, plein texte comprise)
  // s'applique ensuite : elle ne peut donc jamais ramener un agent.
  // `everyConv` porte AUSSI les agents : c'est la liste que convBadgeState
  // propage à hasWorkingAgent pour retrouver les enfants d'un parent. La liste
  // affichée (`all`), elle, en est expurgée — passer `all` ferait chercher les
  // enfants dans une liste dont ils sont exclus par construction, et aucun
  // parent ne porterait jamais la pastille de son agent.
  const everyConv = listAllConversations();
  const inSpace = spaceConvIds(activeSpaceId, everyConv);
  const all = everyConv.filter(c => inSpace.has(c.id) && isRootConversation(c));
  $('conv-search').disabled = all.length === 0;
  let convs = all;
  if (convSearchFilter) convs = convs.filter(convSearchFilter);

  // Section « Épinglé » en tête (au singulier, choix assumé), si au moins une.
  const pinned = convs.filter(c => c.pinned);
  if (pinned.length) {
    list.appendChild(sectionEl('Épinglé'));
    for (const c of pinned) list.appendChild(convItemEl(c, everyConv));
  }

  // Le reste, regroupé par tranches temporelles.
  let lastSection = null;
  for (const c of convs) {
    if (c.pinned) continue;
    const section = sectionFor(c.updatedAt || c.timestamp);
    if (section !== lastSection) {
      list.appendChild(sectionEl(section));
      lastSection = section;
    }
    list.appendChild(convItemEl(c, everyConv));
  }

  if (animate) {
    // `--i` porte le rang pour l'échelonnement, plafonné (ANIM_STAGGER_MAX) :
    // sans plafond, une liste de 200 conversations donnerait plusieurs secondes
    // de cascade — au-delà du plafond tout le reste démarre ensemble, et comme
    // ces items sont hors écran, la coupure ne se voit pas.
    const items = list.children;
    for (let i = 0; i < items.length; i++) {
      items[i].style.setProperty('--i', Math.min(i, CONV_ENTER_STAGGER_MAX));
    }
    // Reflow forcé avant la pose de la classe : sans lui, le navigateur peut
    // regrouper le remove/add du même frame et l'animation ne rejouerait pas
    // sur deux renders animés consécutifs (deux recherches à la suite).
    void list.offsetWidth;
    list.classList.add('enter');
  }
}

// Barre contextuelle de destination : n'apparaît qu'à ≥1 conversation cochée, en mode
// sélection. Reconstruite à chaque changement de sélection (toggleConvSelection)
// ou de mode (enterMoveMode/exitMoveMode) — coût négligeable, pas d'état DOM
// à préserver entre deux renders (cfgPillSelect est reconstruit avec la même
// value à chaque fois, cohérent avec le pattern conv-list).
function renderMoveBar() {
  const bar = $('move-bar');
  if (!bar) return;
  if (!_moveMode) {
    bar.innerHTML = '';
    bar.classList.remove('show');
    return;
  }
  bar.classList.add('show');
  bar.innerHTML = '';

  const count = document.createElement('div');
  count.className = 'move-bar-count';
  const n = _moveSelection.size;
  count.textContent = n > 0
    ? `Déplacer ${n} conversation${n > 1 ? 's' : ''} vers…`
    : 'Sélectionner des conversations à déplacer…';
  bar.appendChild(count);

  const row = document.createElement('div');
  row.className = 'move-bar-row';
  const destinations = sortedSpacesByName(loadSpaces()).filter(s => s.id !== activeSpaceId).map(s => ({ value: s.id, label: s.name || '' }));
  let pill = null;
  if (destinations.length) {
    pill = cfgPillSelect('move-bar-dest', destinations, destinations[0].value, null);
    row.appendChild(pill.root);
  }

  // Groupés pour que les deux boutons restent solidaires face à la pilule de
  // destination : le groupe est en flex-shrink: 0, c'est la pilule qui absorbe
  // le manque de place en tronquant (la barre ne passe jamais à la ligne).
  const actions = document.createElement('div');
  actions.className = 'move-bar-actions';

  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'move-bar-go';
  moveBtn.title = 'Déplacer';
  moveBtn.disabled = n === 0 || !pill;
  moveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  if (pill) moveBtn.onclick = () => moveSelectedConversations(pill.input.value);
  actions.appendChild(moveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'move-bar-cancel';
  cancelBtn.title = 'Annuler';
  cancelBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  cancelBtn.onclick = () => exitMoveMode();
  actions.appendChild(cancelBtn);

  row.appendChild(actions);
  bar.appendChild(row);
}

function isMobileLayout() { return window.innerWidth < 768; }

function closeSidebarMobile() {
  $('app').classList.remove('sidebar-open');
  $('sidebar-backdrop').classList.remove('show');
  document.body.style.overflow = '';
}

// Fermeture de la sidebar via Escape (dernier recours de la cascade, cf. plus
// bas) : même effet que closeSidebarMobile en layout mobile (backdrop +
// overflow), simple retrait de la classe sur desktop (pas de backdrop).
function closeSidebarViaEscape() {
  if (!$('app').classList.contains('sidebar-open')) return false;
  if (isMobileLayout()) closeSidebarMobile();
  else $('app').classList.remove('sidebar-open');
  return true;
}

function toggleSidebar() {
  const app = $('app');
  if (isMobileLayout()) {
    const opening = !app.classList.contains('sidebar-open');
    app.classList.toggle('sidebar-open');
    $('sidebar-backdrop').classList.toggle('show', opening);
    document.body.style.overflow = opening ? 'hidden' : '';
  } else {
    app.classList.toggle('sidebar-open');
  }
}

function initVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    revisitWelcomeTipRoom();
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

// ── Redimensionnement de la sidebar (drag du bord droit) ────────────────────
// Largeur bornée [min = largeur d'origine, max = ×2], persistée dans les
// réglages. On pilote la variable CSS --sidebar-w ; pendant le drag la classe
// .resizing coupe la transition pour un suivi 1:1 du curseur.
const SIDEBAR_MIN = 264;
const SIDEBAR_MAX = SIDEBAR_MIN * 2;
let _sidebarW = SIDEBAR_MIN;

function applySidebarWidth(w) {
  _sidebarW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));
  $('app').style.setProperty('--sidebar-w', _sidebarW + 'px');
  return _sidebarW;
}

function initSidebarResize() {
  applySidebarWidth(loadSettings().sidebarWidth || SIDEBAR_MIN);

  const handle = $('sidebar-resizer');
  const sidebar = document.querySelector('.sidebar');
  if (!handle || !sidebar) return;

  let dragging = false, startX = 0, startW = 0;

  const onMove = (e) => {
    if (!dragging) return;
    applySidebarWidth(startW + (e.clientX - startX));
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sidebar.classList.remove('resizing');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    saveSettings({ sidebarWidth: _sidebarW });   // persiste la largeur finale
  };

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = _sidebarW;
    sidebar.classList.add('resizing');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Largeur de la colonne centrale (thread + composer) ──────────────────────
// Trois crans multiplicateurs appliqués à la largeur de lecture d'origine, que
// le CSS porte comme --col. Le cran 0 EST la largeur historique : c'est le
// plancher, jamais un réglage « réduit » — d'où un « – » désactivé au repos
// plutôt qu'un cran plus étroit qui n'a jamais existé.
// Le pas est stocké en INDEX, pas en pixels : le jour où la largeur de base
// bouge dans base.css, les crans suivent sans migration de réglage — un
// sidebarWidth en pixels, lui, resterait figé sur l'ancienne base.
const COL_WIDTH_STEPS = [1, 1.25, 1.5];
const COL_WIDTH_FALLBACK_BASE = 720;   // filet si --col est illisible (jamais en usage nominal)

// La largeur de base est LUE sur :root, jamais recopiée : base.css en est la
// seule source. On la lit avant toute surcharge et on la mémorise — surcharger
// --col sur #app la rendrait ensuite indistinguable de la base au prochain
// appel, et chaque cran se multiplierait par le précédent.
let _colWidthBase = 0;
function colWidthBase() {
  if (!_colWidthBase) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col'));
    _colWidthBase = Number.isFinite(v) && v > 0 ? v : COL_WIDTH_FALLBACK_BASE;
  }
  return _colWidthBase;
}

// Pur : borne un index de cran, quelle que soit la saleté du réglage persisté
// (chaîne, négatif, cran retiré depuis). Number.isFinite et non `||` : 0 est
// l'index NOMINAL ici, un `||` le remplacerait silencieusement par le défaut.
function clampColWidthStep(step, count) {
  const n = (typeof count === 'number' && count > 0) ? count : COL_WIDTH_STEPS.length;
  const i = Math.round(Number(step));
  if (!Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(n - 1, i));
}

let _colWidthStep = 0;

// Applique le cran : surcharge --col sur #app (et non :root) pour rester
// homogène avec --sidebar-w, et pour que l'export — qui lit des tokens sur
// :root — ne voie jamais cette largeur d'écran (cf. THEME_TOKENS, --col exclu).
function applyColWidth(step) {
  _colWidthStep = clampColWidthStep(step);
  const app = $('app');
  if (app) {
    app.style.setProperty('--col', Math.round(colWidthBase() * COL_WIDTH_STEPS[_colWidthStep]) + 'px');
    markColResizing(app);
  }
  syncColWidthUI();
  return _colWidthStep;
}

// Fenêtre pendant laquelle le porteur de tableau élargi a le droit de glisser
// (cf. `.app.col-resizing .table-bleed`, chat.css). Elle existe parce que sa
// largeur ne dérive pas seulement de --col : elle se calcule sur `100cqw`, donc
// sur la place laissée par la sidebar. Une transition déclarée en permanence
// répondait donc aussi au repli/dépli de la sidebar, qui n'a jamais demandé de
// glissement — le tableau y prenait une largeur intermédiaire avant de revenir
// à la sienne, avec une barre de défilement le temps du trajet. Restreindre
// l'animation à cette fenêtre la rend au seul geste qui la motive.
//
// Le timer est unique et réarmé : deux clics rapprochés sur le contrôle de
// largeur ne doivent pas laisser le premier retirer la classe pendant que le
// second glisse encore.
let _colResizeTimer = null;
function markColResizing(app) {
  app.classList.add('col-resizing');
  if (_colResizeTimer) clearTimeout(_colResizeTimer);
  _colResizeTimer = setTimeout(function() {
    _colResizeTimer = null;
    app.classList.remove('col-resizing');
  }, colResizeMs());
}

// Durée de la fenêtre, LUE sur le token qui porte déjà la transition
// (--col-resize, base.css) plutôt que recopiée : une fenêtre plus courte que la
// transition la couperait en pleine course, une plus longue laisserait la
// sidebar animer une table à nouveau. Le filet ne sert qu'au cas où le token est
// illisible — il ne peut alors qu'être trop généreux, ce qui dégrade vers le
// comportement actuel plutôt que vers une animation tronquée. Même motif que
// colWidthBase : lecture unique et mémorisée, base.css reste la seule source.
const COL_RESIZE_FALLBACK_MS = 180;
let _colResizeMs = 0;
function colResizeMs() {
  if (!_colResizeMs) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--col-resize').trim();
    const v = parseFloat(raw);
    // Le token est en ms ; un `s` explicite est admis pour qu'un changement
    // d'unité en CSS n'ouvre pas une fenêtre mille fois trop courte.
    const ms = (Number.isFinite(v) && v > 0) ? (/[^m]s$/.test(raw) ? v * 1000 : v) : COL_RESIZE_FALLBACK_MS;
    _colResizeMs = ms;
  }
  return _colResizeMs;
}

// Les deux boutons sont désactivés en butée : le contrôle dit alors de
// lui-même où on se trouve dans la course, sans compteur ni libellé.
function syncColWidthUI() {
  const dec = $('col-width-dec'), inc = $('col-width-inc');
  if (dec) dec.disabled = _colWidthStep <= 0;
  if (inc) inc.disabled = _colWidthStep >= COL_WIDTH_STEPS.length - 1;
}

function nudgeColWidth(delta) {
  const next = clampColWidthStep(_colWidthStep + delta);
  if (next === _colWidthStep) return;   // butée : rien à persister ni à diffuser
  applyColWidth(next);
  saveSettings({ colWidth: next });   // persistance immédiate, modèle selectTheme
}

// `label` : soit une chaîne (titre définitif — applyGeneratedTitle), soit
// l'objet {text, provisional} de convLabel (lot AA). Les deux formes sont
// admises parce que les deux appelants ont des besoins différents : un titrage
// qui vient d'aboutir SAIT qu'il n'est pas provisoire, l'ouverture d'une
// conversation doit le demander au prédicat.
function setTitle(label) {
  const o = (label && typeof label === 'object') ? label : { text: label || '', provisional: false };
  const el = $('conv-title');
  el.textContent = o.text || '';
  el.classList.toggle('provisional', !!o.provisional);
  // L'onglet reçoit l'extrait BRUT, sans marque de provisoire : il n'a pas
  // d'italique, et distinguer les conversations entre plusieurs onglets prime
  // sur signaler le statut du titre.
  document.title = documentTitleFor(o.text);
}

// Titre d'onglet, formule unique (main.js écrit aussi document.title à la
// saisie manuelle d'un titre). Sans titre l'onglet porte « MIAOU » nu, pas le
// placeholder du bandeau : l'onglet est ce qu'on met en favori, et une entrée
// nommée d'après une conversation vide est une friction inutile. Le
// placeholder reste l'affaire de la topbar (son :empty::before).
function documentTitleFor(text) {
  const t = (text || '').trim();
  return t ? t + ' — MIAOU' : 'MIAOU';
}

// Éditabilité DURABLE du titre, gouvernée par la nature de la conversation
// (lot X-1) : un agent n'est jamais renommé à la main. À ne pas confondre avec
// setTitleEditable (main.js), verrou TRANSITOIRE le temps d'un titrage async —
// les deux écrivent sur le même attribut, mais celui-ci est reposé à chaque
// ouverture de conversation, donc il gagne au switch, ce qui est le bon ordre :
// un agent n'est de toute façon jamais titré, donc jamais verrouillé par
// l'autre chemin.
function setTitleEditableForConv(conv) {
  const el = $('conv-title');
  if (!el) return;
  el.contentEditable = isAgentConversation(conv) ? 'false' : 'true';
}

// Bandeau de parenté d'agent : la voie de RETOUR vers la conversation qui a
// lancé l'agent (l'aller étant les acks agent__*, renderAgentAckLabel).
// Masqué sur toute conversation racine — c'est-à-dire presque toujours.
//
// Le parent est relu à CHAQUE appel plutôt que mémorisé : il peut avoir été
// renommé (ou supprimé) depuis le spawn. S'il a disparu, on affiche quand même
// le bandeau, sans lien : l'information « ceci est un agent » reste vraie et
// utile, et un lien mort serait pire qu'une absence de lien.
function syncAgentBanner(conv) {
  const el = $('agent-banner');
  if (!el) return;
  // Le bouton de topbar est piloté depuis ICI, par le MÊME appel et le MÊME
  // parent relu (lot X-1c) : deux surfaces qui répondent à la même question
  // (« d'où vient ce fil, et où revient-on ? ») ne doivent pas dériver leur
  // réponse de deux formules — c'est la discipline de `convLabel` et de
  // `spaceConvIds`. En particulier, un parent supprimé doit fermer les DEUX
  // affordances, sinon le bouton mènerait à une conversation inexistante
  // pendant que le bandeau dit « conversation supprimée ».
  const btn = document.querySelector('.conv-parent-btn');
  // Marqueur robot de topbar : il suit « ce fil est-il celui d'un agent ? »,
  // et RIEN d'autre — à la différence du chevron de retour, qui dépend en plus
  // de la survie du parent. Un agent dont le parent a été supprimé reste un
  // agent : le marqueur reste, seule la voie de retour disparaît.
  const mark = $('conv-agent-mark');
  if (!isAgentConversation(conv)) {
    el.classList.remove('show');
    if (btn) { btn.hidden = true; btn.onclick = null; }
    if (mark) mark.hidden = true;
    return;
  }
  if (mark) {
    // Tracé injecté depuis ICON_AGENT (statique, author-controlled) plutôt que
    // recopié dans index.html : une seule source pour la silhouette de robot,
    // partagée avec les acks agent__*.
    if (!mark.firstChild) mark.innerHTML = ICON_AGENT;
    mark.hidden = false;
  }
  const link = $('agent-banner-link');
  // Statut (X-1e) : le bandeau explique pourquoi le composer est fermé quand
  // l'agent a fini. Sans lui, la lecture seule serait un composer grisé sans
  // cause lisible — l'utilisateur croirait à une panne. `running` ne s'affiche
  // pas : un agent au travail a son composer ouvert, il n'y a rien à expliquer,
  // et la pastille d'activité le dit déjà.
  const statusEl = $('agent-banner-status');
  if (statusEl) {
    const st = agentStatus(conv.id);
    const label = (st !== 'running' && AGENT_STATUS_UI_LABELS[st]) || '';
    statusEl.textContent = label ? ' — ' + label : '';
  }
  const parent = loadConversation(conv.parentConvId);
  if (parent) {
    // `.text` seul : le bandeau n'italise pas le provisoire — le libellé du
    // parent y est une information d'orientation, pas un titre en attente, et
    // le `title` d'attribut qui en dérive est du texte brut.
    const label = convLabel(parent).text || 'Nouvelle conversation';
    link.textContent = label;
    link.onclick = () => selectConv(parent.id, true);
    link.style.pointerEvents = '';
    if (btn) {
      btn.hidden = false;
      // `title` porte le NOM du parent : le bouton est une icône seule, et le
      // bandeau qui porte ce nom en clair défile hors de vue dès qu'on descend
      // dans le fil. Sans lui, l'affordance permanente serait muette sur sa
      // destination.
      btn.title = 'Retour à « ' + label + ' »';
      btn.setAttribute('aria-label', btn.title);
      // Cible relue à CHAQUE appel, jamais figée : un agent peut être réouvert
      // après que son parent a été renommé, et syncAgentBanner est rappelée à
      // chaque ouverture de conversation.
      btn.onclick = () => selectConv(parent.id, true);
    }
  } else {
    link.textContent = 'conversation supprimée';
    link.onclick = null;
    link.style.pointerEvents = 'none';
    // Parent supprimé : le bouton disparaît plutôt que de rester inerte. Une
    // affordance permanente qui ne fait rien au clic est pire qu'absente ; le
    // bandeau, lui, reste pour EXPLIQUER pourquoi (il porte le texte).
    if (btn) { btn.hidden = true; btn.onclick = null; }
  }
  el.classList.add('show');
}

// Placeholder + hint du champ clef d'une carte serveur API, selon
// REQUIRE_API_KEY (figé au build). Appelé à la construction de chaque carte
// (buildApiCard) plutôt qu'une fois à l'init : la cible n'est plus un champ
// settings global mais un input par carte.
function apiKeyFieldHint() {
  return REQUIRE_API_KEY
    ? { placeholder: 'Clef API', hint: 'Authentification requise.' }
    : { placeholder: '(vide si non requise)', hint: "Laissez vide si l'endpoint n'exige pas d'authentification." };
}

// ── État configuré / non configuré ──────────────────────────────────────────
function syncConfigured() {
  // Dérivé du MÊME prédicat que la pastille : « configuré » est exactement
  // « pas unconfigured ». Réécrire le test ici (url && (key || !REQUIRE))
  // ferait deux formules à maintenir pour une seule question.
  configured = resolveBackendHealth(activeApiConfig(), REQUIRE_API_KEY, null) !== 'unconfigured';

  const wrap = $('input-wrap');
  const ta = $('composer-text');
  const send = $('send-btn');

  if (configured) {
    wrap.classList.remove('disabled');
    ta.placeholder = COMPOSER_IDLE_PLACEHOLDER;
    ta.disabled = false;
    send.disabled = false;   // pendant un stream le bouton sert de « stop » : jamais désactivé
  } else {
    wrap.classList.add('disabled');
    ta.placeholder = 'API non configurée — ouvrir les paramètres';
    ta.disabled = true;
    send.disabled = true;
  }
  // La pastille N'EST PLUS écrite ici : « configuré » est une condition
  // nécessaire à « joignable », jamais suffisante. syncConnDot tranche depuis
  // resolveBackendHealth, qui lit la config ET le dernier verdict observé.
  syncConnDot();
}

// `stopping` (optionnel) : la génération qu'on affiche (s'il y en a une) a
// déjà reçu un Stop pas encore honoré (gen.stopRequested, cf. main.js). ui.js
// ne lit pas le registre de générations lui-même (pas de dépendance inverse
// vers main.js) : c'est à l'appelant de le porter. Absent/false → pas d'attente
// en cours, comportement historique.
// `phase` (optionnel) : même statut que `stopping` — la phase de la génération
// affichée, portée par l'appelant, pour que le placeholder reprenne à la bonne
// étape quand on rebranche l'écran sur une génération déjà en cours.
// `variant` (optionnel) : la formulation tirée pour cette phase
// (`gen.phaseVariant`), portée par l'appelant pour la même raison — la
// rebrancher est ce qui empêche un retour sur la conversation de changer le
// texte sous les yeux de l'utilisateur. Absent → la formulation historique.
function setSending(on, stopping, phase, variant) {
  sending = on;
  setComposerStreaming(on, phase, variant);
  const send = $('send-btn');
  // Pendant l'envoi le bouton devient « stop » (cliquable) ; sinon il dépend du
  // seul état configuré. Une confirmation en attente NE bloque pas l'envoi : la
  // saisie libre vaut réponse/correction et lève le widget (dismiss-on-send).
  if (send) send.disabled = on ? false : !configured;
  // APRÈS la ligne ci-dessus : un stop différé rebranché (retour sur une
  // conversation dont gen.stopRequested est déjà vrai) doit garder le bouton
  // désactivé — setStopping doit avoir le dernier mot sur `disabled`, sinon la
  // ligne ci-dessus le réactive juste après l'avoir désactivé.
  setStopping(on && !!stopping);
  // Export de conversation masqué pendant le streaming (contenu incomplet).
  const convDl = document.querySelector('.conv-dl-btn');
  if (convDl) convDl.disabled = on;
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.disabled = on;
  syncLastAssistantActions();   // le bouton régénérer disparaît pendant un stream
  // Readonly relay (lot J) : PLUS piloté ici depuis T-1a. `sending` n'est
  // qu'un reflet de l'écran (« la conv AFFICHÉE génère-t-elle ? ») et change
  // aussi sur un simple changement de conversation — il ne peut donc plus
  // servir de point d'appariement -started/-ended. Le relais suit désormais le
  // cycle de vie de la génération (registerGeneration/unregisterGeneration,
  // main.js), qui reste un point de fin unique par conversation.
  // Le drain des actions de synchro différées (lot J) n'est PLUS déclenché
  // ici depuis T-1a : setSending change aussi sur un simple changement de
  // conversation, ce qui drainerait alors qu'une génération mute encore un
  // thread. Il suit désormais la fin d'une génération (unregisterGeneration).
}

// Readonly cross-onglets (lot J) : un pair génère sur la conv affichée →
// verrouiller les entrées et mutations LOCALES (composer, édition, suppression,
// régénération) pour empêcher une seconde génération concurrente silencieuse.
// Lecture + scroll restent permis. Piloté par une classe sur <body>
// (.conv-readonly, CSS dans composer.css) + désactivation directe du composer.
// Indépendant de `sending` (état local de génération) : ne PAS s'appuyer sur lui.
// À la levée, on restaure l'état du composer via son seul déterminant hors
// streaming, `configured` (mêmes règles que setSending(false)).
let _convReadonly = false;
function setConvReadonly(on) {
  _convReadonly = !!on;
  document.body.classList.toggle('conv-readonly', _convReadonly);
  const ta = $('composer-text');
  const send = $('send-btn');
  if (on) {
    if (ta) ta.disabled = true;
    if (send) send.disabled = true;
    // Menus de modèle/raisonnement DÉJÀ ouverts quand le verrou tombe (X-1f) :
    // le cas arrive pour de bon — on regarde un agent finir, menu déployé. La
    // garde d'ouverture ne les concerne plus une fois ouverts ; sans cette
    // fermeture ils resteraient déployés et cliquables au-dessus d'un composer
    // mort. Le rail d'interjections est re-rendu pour la même raison : sa
    // légende et ses affordances dépendent du verrou.
    for (const id of ['composer-model-menu', 'composer-reasoning-menu']) {
      const m = $(id);
      if (m) m.classList.remove('show');
    }
  } else {
    // Ne pas ré-activer si une génération LOCALE est en cours (le composer sert
    // alors de « stop ») ni si l'app n'est pas configurée. Ni si un stop est en
    // attente (_stopping) : sinon ce chemin (ex. openConversation →
    // applyReadonlyState, APRÈS setSending) réactive le bouton juste après que
    // setStopping l'ait désactivé — même bug que celui corrigé dans setSending,
    // trouvé ici par la vérif bout-en-bout (verify-stop-deferred.mjs).
    if (ta) ta.disabled = sending ? false : !configured;
    if (send) send.disabled = _stopping ? true : (sending ? false : !configured);
  }
}

// Lecture du verrou, pour les appelants qui doivent REFUSER une action plutôt
// que la tenter sur un composer inerte (X-1f : l'édition d'une puce
// d'interjection reflue vers la textarea — verrouillée, elle détruirait la puce
// en échange d'un texte non modifiable). `_convReadonly` reste privé : un seul
// écrivain (setConvReadonly), des lecteurs par cette fonction.
function isComposerReadonly() {
  return _convReadonly;
}

// Phases d'une génération, telles que le composer les ANNONCE — pas un statut
// interne : chaque entrée est un texte adressé à l'utilisateur. La table est
// LA source des libellés (jamais une chaîne recopiée au point d'appel), et
// `composerBusyPlaceholder` la seule lecture — un `phase` inconnu retombe sur
// l'attente plutôt que de vider le placeholder, parce qu'une génération existe
// toujours quand on interroge cette table.
//
// Le suffixe « Entrée ajoute à la file » porte l'affordance des interjections
// (lot Q) : il ne dépend pas de la phase et reste donc sur tous les textes.
//
// `analyzing`/`pondering` sont les homologues de `waiting`/`reasoning` APRÈS un
// tour d'outils (dérivées dans setGenPhase, main.js) : même moment du cycle,
// mais l'utilisateur sait alors qu'il y a des résultats à digérer, et c'est
// précisément ce qu'il veut voir nommé plutôt qu'un retour au texte générique.
//
// Chaque phase porte PLUSIEURS formulations, tirée une fois par entrée dans la
// phase (`gen.phaseVariant`, main.js). La variation est là pour que le composer
// ne devienne pas un décor qu'on cesse de lire ; le tirage est donc tenu par la
// génération et jamais par l'affichage — un tirage fait ici changerait le texte
// à chaque repeinture (rebranchement d'écran, recalcul du composer), ce qui
// ferait clignoter le placeholder sans qu'aucun état n'ait bougé.
//
// La PREMIÈRE de chaque liste est le libellé historique de la phase : c'est
// elle que rend un variant absent, donc elle reste le comportement par défaut
// de tout chemin qui ne porte pas de tirage.
const COMPOSER_PHASE_LABELS = {
  waiting: [
    'Le modèle travaille',
    'Le modèle se met à l\'ouvrage',
    'Le modèle a pris le dossier',
    'Le modèle retrousse ses manches',
  ],
  reasoning: [
    'Le modèle réfléchit intensément',
    'Le modèle pèse le pour et le contre',
    'Le modèle tourne la question dans tous les sens',
    'Le modèle ne veut pas dire de bêtise',
  ],
  answering: [
    'Le modèle répond',
    'Le modèle met ça au propre',
    'Le modèle déroule',
    'Le modèle a trouvé ses mots',
  ],
  tools: [
    'Le modèle utilise des outils',
    'Le modèle met les mains dans le cambouis',
    'Le modèle fait tourner la quincaillerie',
    'Le modèle va chercher ce qui lui manque',
  ],
  analyzing: [
    'Le modèle analyse les résultats d\'outils',
    'Le modèle dépouille ce que les outils ont rapporté',
    'Le modèle fait le tri dans la récolte des outils',
    'Le modèle regarde ce que les outils ont donné',
  ],
  pondering: [
    'Le modèle pense profondément suite à l\'appel d\'outils',
    'Le modèle médite sur ce que les outils ont rendu',
    'Le modèle relit tout ça d\'un air songeur',
    'Le modèle reprend la question, résultats d\'outils en main',
  ],
};
const COMPOSER_QUEUE_HINT = ' — Entrée ajoute à la file…';
const COMPOSER_IDLE_PLACEHOLDER = 'Message…';

// Pure : (phase, variant) → texte du placeholder pendant une génération.
//
// `variant` est un entier quelconque porté par la génération : il est ramené
// modulo la longueur de la liste, donc la fonction reste TOTALE — aucun
// appelant n'a à connaître le nombre de formulations d'une phase, et en ajouter
// une ne périme aucun tirage en cours. Absent ou non fini → 0, la formulation
// historique.
function composerBusyPlaceholder(phase, variant) {
  const list = COMPOSER_PHASE_LABELS[phase] || COMPOSER_PHASE_LABELS.waiting;
  const n = Number.isFinite(variant) ? Math.abs(Math.trunc(variant)) % list.length : 0;
  return list[n] + COMPOSER_QUEUE_HINT;
}

// Bascule l'apparence du bouton du composer entre « envoyer » et « stop ».
// `phase` (optionnel) : phase de la génération AFFICHÉE, cf. setComposerPhase.
// ui.js ne lit jamais le registre de générations (pas de dépendance inverse
// vers main.js) — c'est l'appelant qui porte la phase, comme il porte déjà
// `stopping`. Absente → attente, le comportement d'avant les phases.
function setComposerStreaming(on, phase, variant) {
  const send = $('send-btn');
  if (!send) return;
  send.classList.toggle('streaming', on);
  send.title = on ? 'Arrêter' : 'Envoyer';
  // Mode file (lot Q) : le placeholder annonce la mise en file pendant la
  // génération — l'affordance principale du mécanisme, avec le rail de puces.
  const ta = $('composer-text');
  if (ta) ta.placeholder = on ? composerBusyPlaceholder(phase, variant) : COMPOSER_IDLE_PLACEHOLDER;
}

// Rafraîchit le SEUL placeholder, sans retoucher au bouton ni au reste de
// l'état d'envoi : appelé à chaque changement de phase pendant une génération,
// là où setSending n'est appelé qu'à ses bornes. Garde `sending` : une phase
// qui arriverait d'une génération sans écran (elle ne devrait pas — le point
// d'appel est gardé par genOwnsScreen) n'écrirait pas sur un composer inerte.
function setComposerPhase(phase, variant) {
  if (!sending) return;
  const ta = $('composer-text');
  if (ta) ta.placeholder = composerBusyPlaceholder(phase, variant);
}

// Stop cliqué pendant un tour d'outils (gen.abort momentanément null, cf.
// abortStream/main.js) : l'arrêt est pris en compte mais différé jusqu'à la
// frontière de tour suivante. Le bouton se désactive et change d'apparence —
// pas seulement de title — pour qu'un second clic soit IMPOSSIBLE plutôt que
// simplement sans effet (l'utilisateur ne doit pas pouvoir croire qu'il n'a
// pas cliqué assez fort). Levé par setSending(false) (fin de génération) ou
// par le rebranchement d'écran sur une génération qui a déjà fini d'honorer
// la demande. `_stopping` (variable de module, même statut que `sending`/
// `_convReadonly`) est consultée par tout autre chemin qui recalcule
// `send.disabled` après coup (setConvReadonly) — sans elle, ce chemin
// réactiverait le bouton juste après que setStopping l'ait désactivé.
let _stopping = false;
function setStopping(on) {
  _stopping = !!on;
  const send = $('send-btn');
  if (!send) return;
  send.classList.toggle('stopping', on);
  if (on) {
    send.disabled = true;
    send.title = 'Arrêt en cours…';
  } else if (send.classList.contains('streaming')) {
    send.disabled = false;
    send.title = 'Arrêter';
  }
}
// ── Pastille de connexion (pilule modèle) ───────────────────────────────────
// État observé du backend, mémorisé ICI parce que la pastille doit survivre à
// tout re-rendu : avant ce lot, `syncConfigured` la repeignait en vert sur le
// seul critère « une URL et une clef sont renseignées », effaçant un rouge
// légitime dès qu'on passait dans les réglages — deux écrivains, deux
// sémantiques, et le dernier qui parle gagne.
//
// `null` = rien d'observé depuis le démarrage (cf. resolveBackendHealth : on ne
// présume pas la panne d'un backend qu'on n'a pas encore essayé).
let _backendProbe = null;
let _backendLastProbe = 0;      // horodatage de la dernière SONDE (pas des échanges) — throttle

// Enregistre un verdict sur le backend, d'où qu'il vienne : fin d'échange
// réussie, échec de génération, flux coupé, ou sonde /models. Repeint la
// pastille dans la foulée — les appelants n'ont rien d'autre à faire.
//
// Point d'écriture UNIQUE de `_backendProbe` : c'est ce qui garantit qu'un
// verdict ne peut pas être posé sans que la pastille suive.
function noteBackendProbe(ok) {
  _backendProbe = { ok: !!ok };
  syncConnDot();
}

// Horodatage de la dernière SONDE (pas des échanges) : porté ici avec l'état
// qu'il qualifie, et écrit par ce seul accesseur. Le laisser affecter depuis
// main.js ferait deux écrivains d'une même variable à travers une frontière de
// fichier — ce que ce lot corrige par ailleurs sur la pastille.
function markBackendProbed(now) {
  _backendLastProbe = now;
}

// Faut-il sonder maintenant ? Regroupe la lecture des deux états locaux et la
// décision pure, pour que l'appelant n'ait aucun état à lire lui-même.
function backendProbeDue(now) {
  const health = resolveBackendHealth(activeApiConfig(), REQUIRE_API_KEY, _backendProbe);
  return shouldProbeBackend(health, _backendLastProbe, now, API_PROBE_MIN_INTERVAL_MS);
}

// Repeint la pastille depuis l'état courant. Pas d'argument : la seule source
// est `resolveBackendHealth`, qui lit la config et le dernier verdict — un
// appelant qui pourrait imposer une couleur rouvrirait la porte au bug
// ci-dessus.
function syncConnDot() {
  const dot = $('conn-dot');
  if (!dot) return;
  const health = resolveBackendHealth(activeApiConfig(), REQUIRE_API_KEY, _backendProbe);
  // 'unconfigured' et 'down' sont tous deux rouges, mais ne disent PAS la même
  // chose : le titre porte la distinction, et c'est lui qui envoie au bon geste.
  if (health === 'ok') {
    dot.className = 'dot ok';
    dot.title = 'Backend joignable';
  } else if (health === 'unconfigured') {
    dot.className = 'dot err';
    dot.title = 'API non configurée — ouvrir les paramètres';
  } else {
    dot.className = 'dot err';
    dot.title = 'Backend injoignable';
  }
  syncWorriedLogo();
  syncHealthToasts();
}

// Compat : les points d'échange (main.js) posent leur verdict par cet ancien
// nom. 'ok' / 'err' sont les deux seules valeurs jamais passées.
function setConnDot(state) {
  noteBackendProbe(state === 'ok');
}

// Écrivain DOM UNIQUE du chat soucieux. Une seule classe sur <body> pilote les
// trois surfaces (boot, sidebar, topbar) : le logo y est inline, donc le CSS de
// la page l'atteint partout, et il n'y a rien à repeindre par surface.
//
// S'accroche aux DEUX synchros déjà obligatoires — `syncConnDot` pour le
// backend, `syncAuthorizationPending` pour le MCP. Pas de troisième signal :
// tout point qui change la santé d'un service passe déjà par l'une des deux, et
// en câbler d'autres laisserait diverger ce que la pastille et le chat disent
// du même incident. Le RETRAIT emprunte le même chemin que la pose : la classe
// est recalculée en entier à chaque appel, jamais posée sans être reprise.
// Écrivain UNIQUE des classes d'expression du chat, une par expression, qui
// s'excluent : les deux sont recalculées en entier à chaque appel, de sorte que
// le retrait emprunte le même chemin que la pose. Appelée par les deux synchros
// de santé des services et par le changement d'état du stockage
// (`setStorageFull`, storage.js).
function syncWorriedLogo() {
  const expr = resolveLogoExpression(
    resolveBackendHealth(activeApiConfig(), REQUIRE_API_KEY, _backendProbe),
    resolveAuthorizationPending(mcpStatusSnapshot()).severity,
    isStorageFull());
  document.body.classList.toggle('miaou-worried', expr === 'worried');
  document.body.classList.toggle('miaou-storage', expr === 'storage');
}

// Active ou désactive l'état « confirmation en attente ». Le composer reste
// ÉDITABLE (brief §4.5 : la saisie libre vaut réponse/correction) : on se borne
// à poser l'overlay qui dim l'arrière-plan et la classe .confirming qui élève
// composer + carte au-dessus du dim (effet spotlight, clic possible). Posé/
// retiré par showConfirmation (primitif de confirmation).
function setConfirmPending(on) {
  _confirmPending = on;
  const backdrop = $('confirm-backdrop');
  const app = $('app');
  if (on) {
    if (backdrop) backdrop.classList.add('show');
    if (app) app.classList.add('confirming');
  } else {
    if (backdrop) backdrop.classList.remove('show');
    if (app) app.classList.remove('confirming');
  }
}

// Lève une confirmation en attente SANS la résoudre (l'utilisateur a tapé une
// réponse libre plutôt que cliquer) : retire toutes les cartes du DOM et désarme
// l'overlay. Distinct de clearMemoryProposals (qui suppose le thread déjà rasé).
function dismissConfirmation() {
  for (const k in _proposalMap) delete _proposalMap[k];
  const containers = document.querySelectorAll('.memory-proposals');
  containers.forEach(c => c.remove());
  setConfirmPending(false);
}

// ── Composer ────────────────────────────────────────────────────────────────
function onComposerKey(e) {
  // Autocomplétion skill ouverte : flèches naviguent, Tab/Entrée complètent,
  // Échap ferme — sans envoyer ni insérer de saut de ligne.
  if (skillAutocompleteOpen(_composerAc)) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSkillAcSelection(_composerAc, 1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveSkillAcSelection(_composerAc, -1); return; }
    if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); hideSkillAutocomplete(_composerAc); return; }
    if (e.key === 'Tab')       { e.preventDefault(); acceptSkillAcSelection(_composerAc); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acceptSkillAcSelection(_composerAc); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // Mode file (lot Q) : pendant une génération, Entrée met la saisie en file
    // d'interjection (drainée à la frontière de tour, cf. main.js) — jamais
    // d'envoi direct concurrent. Le bouton du composer reste le stop
    // (onSendBtn inchangé).
    if (sending) enqueueInterjection();
    else sendMessage();
  }
}

// ── Rail d'interjections (lot Q, clefé par conversation depuis X-1e) ─────────
// Rendu DOM du rail des messages en file pendant une génération. L'état vit
// dans main.js (_pendingInterjections, Map<convId, items[]>) ; ces fonctions ne
// font que refléter/animer. SVG statiques author-controlled (innerHTML sûr) ;
// le texte des puces passe par textContent (frontière XSS). Câblage des clics :
// editInterjection/cancelInterjection (main.js), retrouvés par l'id en dataset.
//
// Le rail montre la file de la conversation AFFICHÉE, et elle seule — c'est la
// réponse visible à « qui va recevoir ça ? ». Appelé à chaque changement de
// conversation (openConversation/resetToEmpty) : sans cet appel, les puces
// d'un fil restaient à l'écran sur le suivant, sur une conversation qui ne
// générait pas et n'avait aucun drain à venir (constat de test X-1).
function renderInterjectionRail() {
  const rail = $('ij-rail');
  const chips = $('ij-chips');
  if (!rail || !chips) return;
  const items = (typeof interjectionsFor === 'function') ? interjectionsFor(currentConvId) : [];
  rail.hidden = items.length === 0;
  // Lecture seule (X-1f) : la file d'un agent qui a fini son travail avant le
  // drain reste là, sans destinataire. Le rail SURVIT — c'est ce qui empêche le
  // texte de disparaître sans que l'utilisateur le voie — mais il cesse de
  // promettre un point d'étape qui ne viendra pas, et l'édition n'est plus
  // offerte (le composer où elle refluerait est verrouillé, cf.
  // editInterjection). Restent lire, copier, annuler.
  const ro = isComposerReadonly();
  rail.classList.toggle('ij-rail-stranded', ro);
  const cap = $('ij-caption-text');
  if (cap) {
    if (ro) {
      cap.textContent = items.length <= 1
        ? 'jamais transmise — la conversation s’est terminée avant'
        : items.length + ' interjections jamais transmises — la conversation s’est terminée avant';
    } else {
      cap.textContent = items.length <= 1
        ? 'sera transmise au prochain point d’étape'
        : items.length + ' interjections, fusionnées et transmises au prochain point d’étape';
    }
  }
  // Purge des puces qui ne sont plus dans la file rendue — d'abord, avant tout
  // ajout. La réconciliation d'origine n'ajoutait que les manquantes : avec une
  // file par conversation, celles du fil précédent s'accumuleraient sans que
  // rien ne les retire (elles n'ont pas d'animation de sortie à jouer, elles
  // changent simplement de destinataire). Retrait SEC, pas dismissInterjectionChip :
  // ces puces ne partent pas, elles cessent d'être à l'écran.
  const keep = new Set(items.map(it => it.id));
  for (const el of Array.from(chips.children)) {
    if (!keep.has(el.dataset.ijId)) el.remove();
  }
  // Réconciliation minimale : n'ajoute que les puces manquantes (par id), pour
  // ne pas rejouer l'animation d'entrée des puces déjà présentes à chaque appel.
  const present = new Set(Array.from(chips.children).map(c => c.dataset.ijId));
  for (const item of items) {
    if (present.has(item.id)) continue;
    chips.appendChild(buildInterjectionChip(item));
  }
}

function buildInterjectionChip(item) {
  const el = document.createElement('div');
  el.className = 'ij-chip';
  el.dataset.ijId = item.id;
  el.innerHTML =
    '<span class="ij-glyph"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 20l1.1-4.1a8.3 8.3 0 0 1-1-4A8.4 8.4 0 0 1 12 3.5a8.4 8.4 0 0 1 9 8z"/><path d="M12 8v4l2.5 1.5"/></svg></span>' +
    '<span class="ij-text"></span>' +
    '<span class="ij-hint">cliquer pour éditer</span>' +
    '<button class="ij-copy" title="Copier" aria-label="Copier cette interjection"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>' +
    '<button class="ij-x" title="Annuler" aria-label="Annuler cette interjection"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  el.querySelector('.ij-text').textContent = item.literal;
  // Copie : la seule voie de récupération quand l'édition est fermée (composer
  // verrouillé d'un agent terminé). Offerte en permanence — un texte tapé se
  // récupère aussi quand tout va bien.
  el.querySelector('.ij-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.classList.contains('ij-draining')) return;
    const btn = e.currentTarget;
    const svgCopy = btn.innerHTML;
    navigator.clipboard.writeText(item.literal).then(() => {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => { btn.innerHTML = svgCopy; }, 1400);
    }).catch(toastCopyFailed);
  });
  el.querySelector('.ij-x').addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.classList.contains('ij-draining')) return;   // en vol de drain : figée
    cancelInterjection(item.id);
  });
  el.addEventListener('click', () => {
    if (el.classList.contains('ij-draining')) return;
    editInterjection(item.id);
  });
  return el;
}

// Fige les puces d'un batch en cours de drain (état non interactif) : pendant
// dans le splice synchrone de takePendingInterjections, AVANT tout await —
// l'invariant de réentrance rendu visible.
function markInterjectionChipsDraining(ids) {
  const chips = $('ij-chips');
  if (!chips) return;
  for (const id of ids) {
    const el = chips.querySelector('[data-ij-id="' + CSS.escape(id) + '"]');
    if (el) el.classList.add('ij-draining');
  }
}

// Retire une puce du DOM avec l'animation de sortie choisie : 'up' (décollage
// vers le fil, drain réussi) ou 'down' (plongée vers le composer, annulation/
// édition/reflux). Idempotent : puce déjà partie = no-op. Nettoie le rail si
// vide après la transition.
function dismissInterjectionChip(id, dir) {
  const chips = $('ij-chips');
  if (!chips) return;
  const el = chips.querySelector('[data-ij-id="' + CSS.escape(id) + '"]');
  if (!el) return;
  el.classList.add(dir === 'up' ? 'ij-away' : 'ij-down');
  const remove = () => {
    el.remove();
    if (!chips.children.length) { const rail = $('ij-rail'); if (rail) rail.hidden = true; }
  };
  if (motionReduced()) { remove(); return; }
  let done = false;
  const fin = () => { if (done) return; done = true; remove(); };
  el.addEventListener('transitionend', fin, { once: true });
  setTimeout(fin, 400);   // filet si transitionend ne tire pas (kill-switch, onglet masqué)
}

// ── Pièces jointes : drag & drop + chips ────────────────────────────────────
// Zone de drop unique = toute la colonne chat (#main-col : topbar + messages
// + composer, hors sidebar/drawers, siblings de .main sous #app). .input-wrap
// n'a délibérément AUCUN handler propre : il est un descendant de #main-col,
// donc un drop sur la barre de saisie y bulle déjà. Un handler local en plus
// attachait le fichier deux fois (une par handler du chemin de bulle).
function onMainDragOver(e) {
  e.preventDefault();
  const main = $('main-col');
  if (main) main.classList.add('dragover');
}
function onMainDragLeave(e) {
  const main = $('main-col');
  if (main && (!e.relatedTarget || !main.contains(e.relatedTarget))) main.classList.remove('dragover');
}
function onMainDrop(e) {
  e.preventDefault();
  const main = $('main-col');
  if (main) main.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) handleAttachFiles(files);
}

// Collage presse-papier : tout item de type 'file' (image copiée depuis un
// navigateur, OU fichier copié depuis le Finder/Explorateur) est intercepté et
// détourné vers le pipeline d'attachment — le texte collé (cas immensément
// majoritaire) suit son cours natif dans le textarea, non empêché.
// `clipboardData.items` (pas `.files`, absent sur une image collée sans
// fichier réel derrière) donne accès aux Blob via `getAsFile()`.
function onComposerPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!files.length) return;
  e.preventDefault();
  handleAttachFiles(files);
}

// Icône générique pour un chip sans vignette (texte/binaire, ou image dont le
// blob est absent du cache — fallback gracieux, cf. brief §4).
function attIconSvg() {
  return '<span class="att-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>';
}

// Construit le markup d'un chip d'attachment. `removable` (composer, pré-envoi)
// ajoute le bouton de retrait ; sinon (bulle envoyée) chip en lecture seule
// SAUF pour l'action de promotion (voie 2, lot Cbis), qui n'est pertinente
// que pour un attachment déjà envoyé (a un conversationId stable) — d'où
// `conversationId` optionnel en dernier paramètre, absent pour le composer.
// `thumbSrc` (optionnel) : data URL de vignette déjà résolue par l'appelant
// (cf. resolveAttachmentThumb) — fallback gracieux vers l'icône si absente.
function attChipHtml(att, thumbSrc, removable, conversationId) {
  const thumb = thumbSrc
    ? `<img class="att-thumb" src="${thumbSrc}" alt="">`
    : attIconSvg();
  const removeBtn = removable
    ? `<button class="att-remove" title="Retirer" onclick="removeComposerAttachment('${att.attId}')">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`
    : '';
  const promoteBtn = (!removable && conversationId)
    ? `<button class="att-promote" title="Ajouter à la bibliothèque de l'espace" ` +
      `onclick="promoteAttachmentToLibrary(this, '${att.attId}', '${conversationId}')">${ICON_PACKAGE}</button>`
    : '';
  // A3-1 : chip cliquable UNIQUEMENT en bulle envoyée (conversationId truthy) —
  // exclut naturellement composer (inerte, statu quo acté) et export (Gbis,
  // chemin distinct, ne doit jamais porter d'onclick référençant des globals
  // MIAOU absents du fichier exporté).
  const liveAttrs = (!removable && conversationId)
    ? ` onclick="onAttachmentChipClick(event, '${att.attId}', '${conversationId}')" ` +
      `title="${att.kind === 'image' ? 'Agrandir (Cmd/Ctrl+clic : nouvel onglet)' : 'Télécharger'}"`
    : '';
  const chipClass = (!removable && conversationId) ? 'att-chip att-chip-live' : 'att-chip';
  return (
    `<span class="${chipClass}" data-att-id="${att.attId}"${liveAttrs}>` +
    thumb +
    `<span class="att-name" title="${escHtml(att.name)}">${escHtml(att.name)}</span>` +
    `<span class="att-size">${humanSize(att.size)}</span>` +
    removeBtn +
    promoteBtn +
    `</span>`
  );
}

// A3-1 : prédicat pur — quelle action déclenche un clic sur un chip
// d'attachment de bulle envoyée. Séparé du handler DOM pour rester testable
// (QuickJS) sans DOM/cache. `record` peut être null (bytes plus en cache,
// dégradation gracieuse) ; `hasModifier` = event.metaKey || event.ctrlKey.
// Discriminant image : `record.w`/`record.h` (posés uniquement pour une image,
// storeAttachment/resources.js) — `record.class` vaut 'binary' pour une image
// ET un fichier binaire non-image (cf. ingestAttachmentFile, main.js), donc
// inutilisable seul comme discriminant.
function attachmentClickAction(record, hasModifier) {
  if (!record) return null;
  if (record.w && record.h) {
    return hasModifier ? 'tab' : 'lightbox';
  }
  return 'download';
}

// A3-1 : handler global câblé en onclick inline généré (contrainte CLAUDE.md,
// liste des handlers globaux). Ignore les clics issus des boutons existants
// du chip (retrait/promotion, qui portent leur propre onclick) pour ne pas
// déclencher un download/lightbox accidentel.
function onAttachmentChipClick(event, attId, conversationId) {
  if (event.target.closest('.att-promote, .att-remove')) return;
  const record = getCachedRecordByAttId(attId, conversationId);
  const hasModifier = !!(event.metaKey || event.ctrlKey);
  const action = attachmentClickAction(record, hasModifier);
  if (action === 'download') {
    downloadFile(record.name, record.data, record.mime);
  } else if (action === 'tab') {
    openAttachmentInTab(record);
  } else if (action === 'lightbox') {
    openAttachmentLightbox(record);
  }
  // action === null (record absent du cache) : no-op silencieux, même
  // posture que resolveAttachmentThumb.
}

// A3-1 : ouverture nouvel onglet (Cmd/Ctrl+clic sur une image). `data:` est
// bloqué en navigation top-level par les navigateurs — Blob + objectURL,
// révocation différée (une révocation immédiate casse le chargement sur
// certains navigateurs).
function openAttachmentInTab(record) {
  const url = URL.createObjectURL(new Blob([record.data], { type: record.mime }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Promotion utilisateur d'un attachment de message vers la bibliothèque de
// l'espace actif (voie 2, lot Cbis) : action explicite en un clic, PAS de
// gate (contrairement à la promotion modèle — c'est déjà un consentement).
// Copie bytes+méta ; l'attachment d'origine reste intact (mêmes sémantiques
// que la promotion modèle, storeLibraryFile). Description absente (le trigger la
// génère séparément si le toggle est actif) ; `source` = conversationId
// d'origine.
async function promoteAttachmentToLibrary(btn, attId, conversationId) {
  if (btn.disabled) return;
  btn.disabled = true;
  const record = getCachedRecordByAttId(attId, conversationId);
  if (!record) { btn.disabled = false; return; }
  const stored = await storeLibraryFile(
    activeSpaceId, record.mime, record.name, record.data, record.class,
    conversationId, undefined, Date.now(), Math.random
  );
  if (stored) {
    btn.classList.add('done');
    btn.title = 'Ajouté à la bibliothèque de l\'espace';
    // Trigger de description fire-and-forget : aucun écran Space ouvert ici pour afficher un
    // statut par carte (l'utilisateur est dans une conversation) — la
    // description, si elle aboutit, sera visible à la prochaine ouverture de
    // l'écran Space.
    describeFileIfNeeded(stored.id);
  } else {
    btn.disabled = false;
  }
}

// Résout une vignette d'image depuis le cache session (peuplé par
// storeAttachment à l'attache, ou loadConversationResources à la réouverture).
// Fallback gracieux (null) si le blob n'est pas/plus disponible.
function resolveAttachmentThumb(att, conversationId) {
  if (att.kind !== 'image') return null;
  const rec = getCachedRecordByAttId(att.attId, conversationId);
  if (!rec || !rec.data) return null;
  return 'data:' + rec.mime + ';base64,' + arrayBufferToBase64(rec.data);
}

// Rafraîchit les chips du composer depuis pendingAttachments (état module-level,
// main.js). Vignettes résolues depuis le cache session (image tout juste attachée,
// donc déjà en cache — cf. storeAttachment/_cacheRecord).
function renderComposerAttachments() {
  const el = $('attach-chips');
  if (!el) return;
  if (!pendingAttachments.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = pendingAttachments.map(att =>
    attChipHtml(att, resolveAttachmentThumb(att, currentConvId), true)
  ).join('');
}

// Construit les chips d'une bulle utilisateur ENVOYÉE, depuis message.attachments
// (jamais depuis content — cf. brief A §4). Retourne '' si aucun attachment.
function renderMsgAttachments(attachments, conversationId) {
  if (!attachments || !attachments.length) return '';
  return `<div class="msg-attachments">` +
    attachments.map(att => attChipHtml(att, resolveAttachmentThumb(att, conversationId), false, conversationId)).join('') +
    `</div>`;
}

// ── Dropdown modèle (liste via l'API) ───────────────────────────────────────
// Réutilisé par carte serveur API (buildApiCard) : opère sur les éléments
// input/menu de LA carte plutôt que sur des ids fixes, une carte MCP-like
// pouvant en principe être éditée en même temps qu'une autre.
let _models = [];

async function openApiModelMenu(inputEl, menuEl, urlEl, keyEl) {
  menuEl.classList.add('show');
  menuEl.innerHTML = `<div class="model-loading"><span class="spin"></span>Interrogation de l'API…</div>`;
  const url = urlEl.value.trim();
  const key = keyEl.value.trim();
  if (!url) {
    menuEl.innerHTML = `<div class="model-error">URL non renseignée — saisie manuelle</div>`;
    return;
  }
  try {
    const models = await fetchModels({ url, key });
    _models = models;
    if (!models.length) {
      menuEl.innerHTML = `<div class="model-error">Aucun modèle exposé — saisie manuelle</div>`;
      return;
    }
    renderApiModelOptions(models, inputEl, menuEl, true);
  } catch (e) {
    menuEl.innerHTML = `<div class="model-error">API injoignable — saisie manuelle</div>`;
  }
}

function renderApiModelOptions(models, inputEl, menuEl, scrollToSelected) {
  const cur = inputEl.value.trim();
  menuEl.innerHTML = '';
  models.forEach(m => {
    const o = document.createElement('div');
    o.className = 'model-opt' + (m === cur ? ' selected' : '');
    o.innerHTML = `<span>${escHtml(m)}</span><span class="check">✓</span>`;
    o.onmousedown = (ev) => { ev.preventDefault(); inputEl.value = m; menuEl.classList.remove('show'); };
    menuEl.appendChild(o);
  });
  if (scrollToSelected) {
    const sel = menuEl.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
}

function onApiModelInput(inputEl, menuEl) {
  const q = inputEl.value.trim().toLowerCase();
  renderApiModelOptions(_models.filter(m => m.toLowerCase().includes(q)), inputEl, menuEl);
}

// Ferme tout menu modèle de carte API ouvert au clic ailleurs.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.api-model-anchor')) {
    document.querySelectorAll('#api-list .api-model-anchor .model-menu.show').forEach(m => m.classList.remove('show'));
  }
  if (!e.target.closest('#composer-model')) {
    const cm = $('composer-model-menu');
    if (cm) cm.classList.remove('show');
  }
  if (!e.target.closest('#composer-reasoning')) {
    const cr = $('composer-reasoning-menu');
    if (cr) cr.classList.remove('show');
  }
  if (!e.target.closest('#set-reasoning-select')) {
    const sr = $('set-reasoning-menu');
    if (sr) sr.classList.remove('show');
  }
  // Dropdowns pilule des formulaires (cfgPillSelect — ex. transport MCP).
  if (!e.target.closest('.cfg-pill-select')) {
    document.querySelectorAll('.cfg-pill-select .model-menu.show').forEach(m => m.classList.remove('show'));
  }
  if (!e.target.closest('#space-select')) {
    const sm = $('space-menu');
    if (sm) sm.classList.remove('show');
  }
  // Popover d'agents (T-3) : ferme au clic hors de son ancre. `closeAgentMenu`
  // et non un `remove('show')` local — l'attribut aria-expanded du bouton doit
  // suivre, et un seul point le sait.
  if (!e.target.closest('#agent-anchor')) closeAgentMenu();
});

// Cascade Escape (D-Esc) : un seul niveau fermé par pression, priorité au plus
// « au-dessus ». 0) la lightbox Mermaid (overlay plein écran au-dessus de tout,
// lot E3) — 1) une dropdown ouverte (mêmes cibles que le clic extérieur
// ci-dessus) — 2) le mode déplacement de conversations (_moveMode), s'il est
// actif — 3) le drawer/écran le plus récemment ouvert (pile explicite :
// certains écrans s'empilent volontairement sur un autre déjà ouvert, ex.
// openApiServers depuis le drawer Settings — sans pile, Escape fermait
// toujours le premier de la liste au lieu du sommet réellement affiché) —
// 4) en dernier recours, la sidebar (la referme si ouverte, sinon la réaffiche
// — spec Julien, 2026-07-09 : rien d'autre à faire, Esc redonne l'accès au
// slider plutôt que d'être un no-op). Aucun de ces niveaux n'avait de gestion
// clavier avant ce correctif (à l'exception de la sidebar, mobile uniquement
// — étendue ici au desktop).
let _drawerStack = [];
// Enveloppe chaque paire open*/close* de drawer : l'ouverture pousse sur la
// pile (dédoublonnée — rouvrir un écran déjà au sommet ne l'empile pas deux
// fois), la fermeture — quelle qu'en soit la cause (bouton, backdrop, Escape)
// — la retire où qu'elle se trouve dans la pile (fermeture hors-ordre possible
// via un bouton "Annuler" direct, pas seulement Escape).
function trackDrawer(openFn, closeFn) {
  return {
    open: (...args) => {
      _drawerStack = _drawerStack.filter(fn => fn !== closeFn);
      _drawerStack.push(closeFn);
      return openFn(...args);
    },
    close: (...args) => {
      _drawerStack = _drawerStack.filter(fn => fn !== closeFn);
      return closeFn(...args);
    },
  };
}
const _tSettings = trackDrawer(openSettings, closeSettings);
openSettings = _tSettings.open; closeSettings = _tSettings.close;
const _tSummary = trackDrawer(openSummaryDrawer, closeSummaryDrawer);
openSummaryDrawer = _tSummary.open; closeSummaryDrawer = _tSummary.close;
const _tCtx = trackDrawer(openContextInspector, closeContextInspector);
openContextInspector = _tCtx.open; closeContextInspector = _tCtx.close;
const _tTools = trackDrawer(openTools, closeTools);
openTools = _tTools.open; closeTools = _tTools.close;
const _tSpace = trackDrawer(openSpaceScreen, closeSpaceScreen);
openSpaceScreen = _tSpace.open; closeSpaceScreen = _tSpace.close;
const _tMcp = trackDrawer(openMcpServers, closeMcpServers);
openMcpServers = _tMcp.open; closeMcpServers = _tMcp.close;
const _tApi = trackDrawer(openApiServers, closeApiServers);
openApiServers = _tApi.open; closeApiServers = _tApi.close;
const _tSkills = trackDrawer(openSkills, closeSkills);
openSkills = _tSkills.open; closeSkills = _tSkills.close;

// ── Command palette (Ctrl/Cmd+K, lot F) ─────────────────────────────────────
// Overlay type Spotlight : input de filtrage + liste navigable au clavier. Le
// registre est déclaratif (COMMANDS) — ajouter une commande = ajouter une
// entrée, aucun code de palette touché. Chaque `run()` appelle une fonction
// globale existante (contrainte inline-handler du projet). Scoring/tri PURS dans
// utils.js (scoreCommand/filterCommands/rankConvResults), testés QuickJS ; ici
// vit tout l'impur (DOM, état, effets de bord).
//
// Submodes : la palette peut basculer d'un mode « racine » vers un mode
// secondaire (choix de modèle, skill, conversation, espace) où l'input filtre
// une liste dédiée. Escape recule d'un mode avant de fermer.

let _cmdkOpen = false;
let _cmdkMode = 'root';        // 'root' | 'model' | 'skill' | 'conv' | 'space' | 'agent'
let _cmdkItems = [];           // items rendus (mode courant, après filtrage)
let _cmdkSel = 0;              // index sélectionné dans _cmdkItems
let _cmdkFocusBefore = null;   // élément à re-focus à la fermeture (composer)
// Mode filtre armé (racine) : champ vide, une lettre = RACCOURCI par défaut ;
// taper Espace (avalé) bascule en filtrage, où une lettre = texte de recherche.
// Se réarme (retour aux raccourcis) dès que le champ redevient vide (décision
// Julien 2026-07-11). Ambigu sinon : « r » lancerait « Résumés » au lieu de
// filtrer « réglages ». En mode filtre armé, les touches à gauche sont teintées.
let _cmdkFilterArmed = false;
// Scan de contenu du submode « conversation » (U-3). Le rendu de la palette est
// synchrone et rejoué à chaque frappe ; la lecture IDB, elle, ne l'est pas. On
// mémorise donc `{ query, hits }` — la requête AVEC le résultat, jamais le
// résultat seul : sans la requête, un Set arrivé en retard serait appliqué à une
// autre frappe (cf. `project_cache_key_must_be_identity_not_handy_attribute`,
// même esprit — l'identité du résultat est la requête qui l'a produit).
let _cmdkContentHits = null;
let _cmdkContentTimer = null;
let _cmdkContentSeq = 0;

// Débounce + passe de scan de contenu pour le submode conversation. Appelée à
// chaque frappe ; le rendu immédiat (titre/résumé) a déjà eu lieu, celui-ci
// n'arrive qu'en complément. Sans debounce, chaque frappe déclencherait une
// lecture IDB complète — la palette n'en avait pas besoin tant que tout était
// synchrone, elle en a besoin maintenant.
function scheduleCmdkContentScan(query) {
  if (_cmdkContentTimer !== null) { clearTimeout(_cmdkContentTimer); _cmdkContentTimer = null; }
  _cmdkContentSeq++;
  const q = (query || '').trim();
  if (!q) { _cmdkContentHits = null; return; }
  const seq = _cmdkContentSeq;
  _cmdkContentTimer = setTimeout(async () => {
    _cmdkContentTimer = null;
    const hits = await collectContentSearchHits(q);
    // Jeton de séquence : la palette a pu se fermer, changer de mode, ou la
    // frappe continuer pendant la lecture (`project_await_reentrancy_guard`).
    if (seq !== _cmdkContentSeq || !_cmdkOpen || _cmdkMode !== 'conv') return;
    _cmdkContentHits = { query: q, hits: hits };
    if (!hits.size) return;   // rien à ajouter : pas de re-rendu
    renderCommandList($('cmdk-input').value);
  }, CONV_SEARCH_DEBOUNCE_MS);
}

function cancelCmdkContentScan() {
  if (_cmdkContentTimer !== null) { clearTimeout(_cmdkContentTimer); _cmdkContentTimer = null; }
  _cmdkContentSeq++;
  _cmdkContentHits = null;
}

// Placeholders par mode. En racine, deux variantes selon _cmdkFilterArmed.
const CMDK_PLACEHOLDERS = {
  root:  'Taper un raccourci, ou Espace pour filtrer…',
  rootFilter: 'Filtrer les commandes…',
  model: 'Choisir un modèle…',
  skill: 'Invoquer une skill…',
  // Le champ de la palette est focalisé d'emblée : pas de bascule au focus à
  // faire ici, le placeholder porte directement la syntaxe (même texte que la
  // sidebar au focus, cf. SEARCH_SYNTAX_PLACEHOLDER).
  conv:  SEARCH_SYNTAX_PLACEHOLDER,
  space: 'Changer d’espace…',
  // « Filtrer » et non « Rechercher » : ce sous-mode est un INVENTAIRE déjà
  // affiché, que la frappe restreint — pas une recherche qui part de rien.
  agent: 'Filtrer les agents…',
};
function cmdkRootPlaceholder() {
  return _cmdkFilterArmed ? CMDK_PLACEHOLDERS.rootFilter : CMDK_PLACEHOLDERS.root;
}

// Registre déclaratif des commandes racine. `run()` : action ou entrée de
// submode. `enabled()` (optionnel) : masque la commande hors contexte (liste
// courte). `hint` (optionnel) : annotation à droite. `keywords` : matchés par
// scoreCommand en plus du label.
// Items du sous-mode « modèle » de la palette : mêmes couples serveur/modèle que
// le sélecteur du composer (tous les serveurs non désactivés déjà en cache — la
// palette ne déclenche pas de fetch, elle liste ce qui est connu). Le nom du
// serveur apparaît en note dès qu'il y a plus d'un serveur sélectionnable.
function cmdkModelItems(query) {
  const q = (query || '').toLowerCase();
  const cur = activeModel();
  const activeId = (activeApiServer() || {}).id;
  const servers = listSelectableApiServers();
  const multi = servers.length > 1;
  const items = [];
  servers.forEach(s => {
    const e = _modelsEntryOf(s);
    (e.models || []).forEach(m => {
      if (q && m.toLowerCase().indexOf(q) < 0) return;
      items.push({
        label: m,
        note: multi ? (s.name || s.url) : '',
        current: (m === cur && s.id === activeId),
        run: () => { closeCommandPalette(); pickComposerModel(m, s.id); },
      });
    });
  });
  return items;
}

const COMMANDS = [
  { id: 'new', key: 'n', label: 'Nouvelle conversation', keywords: ['new', 'conversation', 'nouveau'],
    run: () => { closeCommandPalette(); newConversation(); } },
  { id: 'search-conv', key: 'f', label: 'Rechercher une conversation', keywords: ['search', 'historique', 'find', 'chercher'],
    run: () => enterCmdkSubmode('conv') },
  // `enabled` : la palette masque nativement les commandes hors contexte, donc
  // l'entrée disparaît d'elle-même quand rien ne travaille — aucun code
  // d'affichage conditionnel à écrire.
  { id: 'agents', key: 'a', label: 'Agents', keywords: ['agent', 'agents', 'tâches', 'en cours'],
    enabled: () => liveAgentInventory().length > 0,
    run: () => enterCmdkSubmode('agent') },
  { id: 'switch-model', key: 'm', label: 'Changer de modèle', keywords: ['model', 'modèle', 'switch'],
    enabled: () => cmdkModelItems('').length > 0,
    run: () => enterCmdkSubmode('model') },
  { id: 'invoke-skill', key: 'k', label: 'Invoquer une skill', keywords: ['skill', 'slash', 'commande'],
    enabled: () => listEnabledSkills().length > 0,
    run: () => enterCmdkSubmode('skill') },
  { id: 'switch-space', key: 'e', label: 'Changer d’espace', keywords: ['space', 'espace', 'workspace'],
    enabled: () => loadSpaces().length > 1,
    run: () => enterCmdkSubmode('space') },
  { id: 'settings', key: ',', label: 'Ouvrir les réglages', keywords: ['settings', 'réglages', 'préférences', 'config'],
    run: () => { closeCommandPalette(); openSettings(); } },
  { id: 'memory', key: 'p', label: 'Ouvrir les souvenirs (profil)', keywords: ['memory', 'souvenirs', 'mémoire', 'profil'],
    run: () => { closeCommandPalette(); openMemoryDrawer(); } },
  { id: 'summaries', key: 'r', label: 'Ouvrir les résumés', keywords: ['summaries', 'résumés', 'historique'],
    run: () => { closeCommandPalette(); openSummaryDrawer('summaries'); } },
  { id: 'skills-drawer', key: 'g', label: 'Gérer les skills', keywords: ['skills', 'gestion'],
    run: () => { closeCommandPalette(); openSkills(); } },
  { id: 'mcp', key: 's', label: 'Serveurs MCP', keywords: ['mcp', 'serveurs', 'outils distants'],
    run: () => { closeCommandPalette(); openMcpServers(); } },
  { id: 'context', key: 'c', label: 'Inspecteur de contexte', keywords: ['context', 'contexte', 'tokens'],
    run: () => { closeCommandPalette(); openContextInspector(); } },
  { id: 'theme', key: 't', label: 'Basculer clair / sombre', keywords: ['theme', 'thème', 'dark', 'light', 'sombre', 'clair'],
    run: () => { toggleThemeLightDark(); closeCommandPalette(); } },
  { id: 'highlight', key: 'h', label: 'Basculer la coloration syntaxique', keywords: ['highlight', 'coloration', 'syntaxe', 'prism'],
    run: () => { toggleHighlightFromPalette(); closeCommandPalette(); } },
  { id: 'export-md', key: 'd', label: 'Exporter la conversation (Markdown)', keywords: ['export', 'markdown', 'md', 'télécharger'],
    enabled: () => !!currentConvId,
    run: () => { closeCommandPalette(); downloadConvMd(); } },
  { id: 'export-html', key: 'w', label: 'Exporter la conversation (HTML)', keywords: ['export', 'html', 'page', 'télécharger'],
    enabled: () => !!currentConvId,
    run: () => { closeCommandPalette(); exportConvHtml(); } },
];

// Table touche → commande (mode racine, champ vide). Construite à la volée pour
// ne pas dupliquer la source ; `enabled()` réévalué au moment de la frappe.
function cmdkKeyCommand(key) {
  const k = String(key || '').toLowerCase();
  return COMMANDS.find(c => c.key === k && (!c.enabled || c.enabled())) || null;
}

// Bascule de thème vers l'apparence NON-active : on lit le thème EFFECTIF à
// l'écran (si le réglage est « system », on résout via matchMedia comme
// applyTheme le fait) et on force l'opposé — garantit toujours un changement
// visible, y compris depuis « system » quand l'OS impose déjà clair/sombre
// (décision Julien 2026-07-11). Réutilise selectTheme (persistance immédiate).
function effectiveTheme() {
  const t = loadSettings().theme;
  if (t === 'light' || t === 'dark') return t;
  return (typeof window !== 'undefined' && window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
}
function toggleThemeLightDark() {
  selectTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
}

// Bascule la coloration syntaxique depuis la palette. onToggleHighlight() LIT la
// checkbox DOM (no-op si on ne l'inverse pas d'abord) : on bascule l'état,
// reflète la checkbox, puis délègue le re-render à onToggleHighlight.
function toggleHighlightFromPalette() {
  const cb = $('set-highlight');
  if (cb) cb.checked = !cb.checked;
  onToggleHighlight();
}

// Source d'items du mode courant, déjà rendus en objets {label, note?, hint?,
// keyLabel?, run}. `note` = annotation secondaire (nom d'espace) ; `hint` =
// annotation à droite (✓) ; `keyLabel` = touche de raccourci affichée à GAUCHE
// (mode racine seulement — la touche lance la commande, champ vide).
function cmdkModeItems(query) {
  if (_cmdkMode === 'root') {
    const avail = COMMANDS.filter(c => !c.enabled || c.enabled());
    return filterCommands(avail, query).map(c => ({
      label: c.label, hint: c.hint || '', keyLabel: c.key ? c.key.toUpperCase() : '', run: c.run,
    }));
  }
  if (_cmdkMode === 'model') return cmdkModelItems(query);
  if (_cmdkMode === 'skill') {
    return matchSkillCompletions(query).map(s => ({
      label: s.name || s.slug, note: s.name ? ('/' + s.slug) : '',
      run: () => { closeCommandPalette(); insertSkillIntoComposer(s.slug); },
    }));
  }
  if (_cmdkMode === 'space') {
    const spaces = sortedSpacesByName(loadSpaces())
      .filter(s => !query || (s.name || '').toLowerCase().indexOf(query.toLowerCase()) >= 0);
    const active = getActiveSpaceId();
    return spaces.map(s => ({
      label: s.name || '(sans nom)', current: s.id === active,
      run: () => { closeCommandPalette(); pickSpace(s.id); },
    }));
  }
  if (_cmdkMode === 'conv') {
    return cmdkConvItems(query);
  }
  if (_cmdkMode === 'agent') {
    return cmdkAgentItems(query);
  }
  return [];
}

// Submode « recherche conversation » : CROSS-Space (décision Julien), mais
// les conversations du Space actif passent en tête même à score inférieur
// (rankConvResults). Réutilise le prédicat de la sidebar (searchConversations)
// pour la logique de match (titre/résumé/contenu) ; score léger local (titre =
// 3, autre = 1) suffisant pour départager dans un groupe de Space. Chaque ligne
// annotée du nom de son Space. Ouvrir une conv d'un autre Space suit le Space
// (followSpace) avant selectConv, pour ne pas afficher un fil hors du Space actif.
function cmdkConvItems(query) {
  const q = (query || '').trim();
  if (!q) return [];
  // `_cmdkContentHits` : résultat de la passe de scan de contenu pour CETTE
  // requête (U-3), ou null tant qu'elle n'a pas rendu la main. Le rendu de la
  // palette reste synchrone ; c'est la passe qui redemande un rendu quand elle
  // aboutit (cf. scheduleCmdkContentScan).
  const hits = _cmdkContentHits && _cmdkContentHits.query === q ? _cmdkContentHits.hits : null;
  const pred = searchConversations(q, hits);
  if (!pred) return [];
  const ql = q.toLowerCase();
  const keywords = excerptKeywords(q);
  const spaceNames = new Map(loadSpaces().map(s => [s.id, s.name || '']));
  const active = getActiveSpaceId();
  // La recherche de la palette est cross-Space (exception sanctionnée, lot F),
  // mais elle ne remonte JAMAIS un agent (lot X-1, exclusion 3 de 3ter) :
  // « pas trouvable » et « pas atteignable » sont deux choses distinctes — le
  // parent, lui, court-circuite par id (conv__get / agent__*).
  const scored = listAllConversations()
    .filter(isRootConversation)
    .filter(pred)
    .map(c => ({
      id: c.id, spaceId: c.spaceId,
      title: c.title || 'Sans titre',
      score: (c.title || '').toLowerCase().includes(ql) ? 3 : 1,
    }));
  return rankConvResults(scored, active).map(c => ({
    label: c.title,
    // Mêmes deux gestes que la carte de sidebar, servis par le même moteur :
    // surlignage du libellé quand la requête y apparaît, et extrait du contenu
    // quand c'est lui qui a décidé du match. Un match de titre seul n'ouvre pas
    // de seconde ligne (elle répéterait le libellé).
    labelRanges: findMatchRanges(c.title, keywords),
    excerpt: (hits && hits.get(c.id)) || null,
    note: c.spaceId === active ? '' : (spaceNames.get(c.spaceId) || 'Autre espace'),
    run: () => {
      closeCommandPalette();
      if (c.spaceId !== getActiveSpaceId()) followSpace(c.spaceId);
      // reveal : après l'éventuel changement d'espace, scroller la liste vers la
      // conv ouverte (même sidebar masquée) pour la retrouver en place.
      selectConv(c.id, true);
    },
  }));
}

// Inventaire VIVANT des agents : la seule fonction qui branche le prédicat pur
// `agentInventory` (agents.js) sur ses deux sources impures — les métadonnées de
// conversations et le registre de générations. Les trois consommateurs du lot
// (pilule de topbar, sous-mode de palette, drawer) passent par ici, jamais par
// un balayage local : c'est ce qui garantit que la pilule annonce exactement le
// nombre de lignes que le drawer affiche.
function liveAgentInventory() {
  return agentInventory(listAllConversations(), isGenerating);
}

// Aplatit l'inventaire en lignes de liste, dans l'ordre d'affichage : chaque
// racine suivie de ses agents. `depth` (0 racine, 1 agent) porte l'indentation —
// la palette comme le drawer en dérivent leur mise en forme, mais aucun des deux
// ne recalcule la hiérarchie.
//
// `label` vient de `convLabel` (prédicat unique, agents.js) : un agent y est
// libellé par son `agentIntent`, jamais par le placeholder de titre. Le
// `provisional` qu'il rend accompagne la ligne pour que les surfaces l'italisent
// comme ailleurs (extrait de secours en attente de titrage).
function agentInventoryRows(inventory) {
  const rows = [];
  (inventory || []).forEach(g => {
    const lbl = convLabel(g.conv);
    rows.push({
      conv: g.conv, depth: 0, working: g.working,
      label: lbl.text || 'Sans titre', provisional: lbl.provisional,
      // Trois états, pas deux (lot AE, étape 8) : un parent inerte qui attend
      // ses agents ne « travaille » pas lui-même, et une conversation qui
      // COMPACTE ne génère pas — elle réécrit son historique. Le libellé vient
      // du pur `rootActivityLabel` (agents.js) et de sa table, jamais d'une
      // chaîne écrite ici : le statut d'agent, juste en dessous, a déjà payé
      // cette règle.
      status: rootActivityLabel(g.working, historyRewriteKind(g.conv.id)),
    });
    g.agents.forEach(a => {
      const al = convLabel(a);
      rows.push({
        conv: a, depth: 1, working: true,
        label: al.text || 'Agent', provisional: al.provisional,
        // Libellé UTILISATEUR issu de la table partagée (agents.js) : jamais une
        // chaîne écrite ici, qui divergerait du bandeau d'agent.
        status: AGENT_STATUS_UI_LABELS.running,
      });
    });
  });
  return rows;
}

// Navigation depuis une ligne d'inventaire — geste UNIQUE, partagé par la
// palette et le drawer. Cross-Space par `followSpace` AVANT `selectConv`, dans
// cet ordre : afficher un fil hors du Space actif violerait l'herméticité
// (piège 18). C'est le geste déjà éprouvé de `cmdkConvItems`, pas une exception
// nouvelle — la palette est cross-Space depuis le lot F.
function gotoAgentInventoryRow(conv) {
  if (!conv) return;
  if (conv.spaceId !== getActiveSpaceId()) followSpace(conv.spaceId);
  selectConv(conv.id, true);
}

// Submode « agents » : INVENTAIRE, pas recherche. Différence de nature avec
// `cmdkConvItems` à ne pas gommer — pas de `if (!q) return []`, la liste est
// présente d'emblée et la query ne fait que la restreindre.
//
// L'indentation d'un agent sous sa racine est matérialisée par un préfixe dans
// le label : la palette rend ses items en ligne plate (un `<li>` à trois
// emplacements fixes), elle n'a pas de niveau d'imbrication à offrir.
function cmdkAgentItems(query) {
  const q = (query || '').trim().toLowerCase();
  const spaceNames = new Map(loadSpaces().map(s => [s.id, s.name || '']));
  const active = getActiveSpaceId();
  const rows = agentInventoryRows(liveAgentInventory());
  // Le filtre s'applique à la ligne SEULE, sans repêcher son parent : une racine
  // dont le libellé ne matche pas disparaît même si un de ses agents matche.
  // Assumé — la query sert à retrouver une ligne connue, pas à reconstruire
  // l'arbre.
  return rows.filter(r => !q || r.label.toLowerCase().indexOf(q) >= 0).map(r => ({
    label: (r.depth ? '↳ ' : '') + r.label,
    note: r.conv.spaceId === active ? '' : (spaceNames.get(r.conv.spaceId) || 'Autre espace'),
    hint: r.status,
    run: () => { closeCommandPalette(); gotoAgentInventoryRow(r.conv); },
  }));
}

// Insère `/slug ` dans le composer et le focus (l'invocation reste au composer :
// chemin slash-skill unique, docs/skills.md). Ne PAS invoquer directement.
function insertSkillIntoComposer(slug) {
  const ta = $('composer-text');
  if (!ta || ta.disabled) return;
  ta.value = '/' + slug + ' ';
  ta.focus();
  const caret = ta.value.length;
  ta.setSelectionRange(caret, caret);
  autoGrow(ta);
  if (typeof onComposerInput === 'function') onComposerInput();
}

function enterCmdkSubmode(mode) {
  _cmdkMode = mode;
  _cmdkFilterArmed = false;   // les sous-modes filtrent nativement (pas de raccourcis)
  // Changer de mode vide le champ : tout scan de contenu en vol devient sans
  // objet, et son résultat ne doit pas s'appliquer au mode d'arrivée.
  cancelCmdkContentScan();
  const input = $('cmdk-input');
  if (input) {
    input.value = '';
    input.placeholder = mode === 'root' ? cmdkRootPlaceholder() : (CMDK_PLACEHOLDERS[mode] || '');
  }
  renderCommandList('');
}

function renderCommandList(query) {
  const list = $('cmdk-list');
  const empty = $('cmdk-empty');
  if (!list) return;
  _cmdkItems = cmdkModeItems(query);
  if (_cmdkSel >= _cmdkItems.length) _cmdkSel = 0;
  // Teinte les touches quand le mode RACCOURCI est actif (racine, filtrage non
  // armé) : signal qu'une lettre lance directement la commande. Dès que le
  // filtrage est armé (Espace tapé), les touches redeviennent neutres (inertes).
  list.classList.toggle('cmdk-shortcuts', _cmdkMode === 'root' && !_cmdkFilterArmed);
  list.textContent = '';
  // Rendu par createElement + textContent (labels = données utilisateur :
  // titres de conversation, noms d'espace — jamais innerHTML, doctrine projet).
  _cmdkItems.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'cmdk-item' + (i === _cmdkSel ? ' selected' : '');
    // Première ligne (clé, label, note, hint) TOUJOURS enveloppée, même sans
    // extrait : l'item est passé en colonne pour accueillir l'extrait de
    // recherche sous le label, et n'envelopper qu'au besoin donnerait deux
    // structures DOM différentes selon le mode — donc deux jeux de règles CSS à
    // tenir en phase. Les items sans extrait rendent simplement une ligne.
    const row = document.createElement('div');
    row.className = 'cmdk-item-row';
    li.appendChild(row);
    // Emplacement de GAUCHE, largeur fixe : il porte la touche de raccourci en
    // mode racine, et la COCHE de l'élément courant dans les sous-modes (modèle,
    // espace) — les deux ne coexistent jamais (un sous-mode n'a pas de touches).
    // Span vide réservé sinon, pour aligner les labels verticalement.
    const keyEl = document.createElement('span');
    keyEl.className = 'cmdk-item-key';
    if (it.keyLabel) {
      keyEl.textContent = it.keyLabel;
    } else if (it.current) {
      keyEl.textContent = '✓';
      keyEl.classList.add('cmdk-item-current');
    } else {
      keyEl.classList.add('cmdk-item-key-empty');
    }
    row.appendChild(keyEl);
    const label = document.createElement('span');
    label.className = 'cmdk-item-label';
    // applyHighlight, pas textContent : même point d'écriture du <mark> que la
    // sidebar. Sans `labelRanges` (tous les modes sauf la recherche de
    // conversation) elle se réduit exactement à un textContent.
    applyHighlight(label, it.label, it.labelRanges);
    row.appendChild(label);
    if (it.note) {
      const note = document.createElement('span');
      note.className = 'cmdk-item-note';
      note.textContent = it.note;
      row.appendChild(note);
    }
    if (it.hint) {
      const hint = document.createElement('span');
      hint.className = 'cmdk-item-hint';
      hint.textContent = it.hint;
      row.appendChild(hint);
    }
    // Second étage : l'extrait du passage matché, seulement quand le match vient
    // du contenu (cf. cmdkConvItems).
    if (it.excerpt) li.appendChild(searchExcerptEl(it.excerpt, 'cmdk-item-excerpt'));
    li.addEventListener('mousedown', (ev) => { ev.preventDefault(); runCmdkItem(i); });
    list.appendChild(li);
  });
  if (empty) empty.hidden = _cmdkItems.length > 0;
}

function runCmdkItem(i) {
  const it = _cmdkItems[i];
  if (it && typeof it.run === 'function') it.run();
}

function moveCmdkSelection(delta) {
  if (!_cmdkItems.length) return;
  _cmdkSel = (_cmdkSel + delta + _cmdkItems.length) % _cmdkItems.length;
  const list = $('cmdk-list');
  if (!list) return;
  Array.from(list.children).forEach((li, i) => li.classList.toggle('selected', i === _cmdkSel));
  const sel = list.children[_cmdkSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function openCommandPalette() {
  if (_cmdkOpen) return;
  _cmdkOpen = true;
  _cmdkMode = 'root';
  _cmdkSel = 0;
  _cmdkFilterArmed = false;   // à l'ouverture, mode raccourci (touches en orange)
  _cmdkFocusBefore = document.activeElement;
  const overlay = $('cmdk-overlay');
  const input = $('cmdk-input');
  if (overlay) overlay.hidden = false;
  if (input) { input.value = ''; input.placeholder = cmdkRootPlaceholder(); }
  renderCommandList('');
  if (input) input.focus();
}

function closeCommandPalette() {
  if (!_cmdkOpen) return;
  _cmdkOpen = false;
  _cmdkMode = 'root';
  _cmdkItems = [];
  cancelCmdkContentScan();
  const overlay = $('cmdk-overlay');
  if (overlay) overlay.hidden = true;
  // Restaure le focus au composer. Fallback : élément focus avant.
  const ta = $('composer-text');
  if (ta && !ta.disabled) ta.focus();
  else if (_cmdkFocusBefore && typeof _cmdkFocusBefore.focus === 'function') _cmdkFocusBefore.focus();
  _cmdkFocusBefore = null;
}

// Escape sur la palette : recule d'un submode (retour racine) avant de fermer.
// Renvoie true si l'événement est consommé (cascade Escape, ui.js).
function closeCommandPaletteViaEscape() {
  if (!_cmdkOpen) return false;
  // Sous-mode → retour racine (enterCmdkSubmode réarme le placeholder). Racine
  // avec filtrage armé → un Escape désarme d'abord (retour aux raccourcis) ;
  // racine mode raccourci → ferme.
  if (_cmdkMode !== 'root') { enterCmdkSubmode('root'); return true; }
  if (_cmdkFilterArmed) { enterCmdkSubmode('root'); return true; }
  closeCommandPalette();
  return true;
}

function toggleCommandPalette() {
  if (_cmdkOpen) closeCommandPalette();
  else openCommandPalette();
}

function closeTopDropdownViaEscape() {
  const open = document.querySelectorAll('.model-menu.show');
  if (!open.length) return false;
  open.forEach(m => m.classList.remove('show'));
  // Le popover d'agents (T-3) est un `.model-menu` comme les autres, mais il est
  // le seul dont le DÉCLENCHEUR porte un état (`aria-expanded` sur la pilule) :
  // le retirer de la classe ne suffit pas, il faut repasser par son fermeur.
  // Sans ça, Escape referme le popover en laissant le bouton annoncer qu'il est
  // ouvert — un état faux pour tout lecteur d'écran, invisible à l'oeil.
  closeAgentMenu();
  return true;
}
function closeTopDrawerViaEscape() {
  if (!_drawerStack.length) return false;
  const top = _drawerStack[_drawerStack.length - 1];
  _drawerStack = _drawerStack.slice(0, -1);
  top();
  return true;
}
function exitMoveModeViaEscape() {
  if (!_moveMode) return false;
  exitMoveMode();
  return true;
}
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+K : ouvre/ferme la palette de commandes (lot F). preventDefault
  // pour couvrir la barre de recherche du navigateur (Firefox). Ignore si un
  // autre modificateur est enfoncé (évite les collisions accidentelles).
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    toggleCommandPalette();
    return;
  }
  if (e.key !== 'Escape') return;
  if (closeCommandPaletteViaEscape()) return;
  if (closeMermaidLightboxViaEscape()) return;
  if (closeTopDropdownViaEscape()) return;
  if (exitMoveModeViaEscape()) return;
  if (closeTopDrawerViaEscape()) return;
  if (closeSidebarViaEscape()) return;
  toggleSidebar();
});

// Câblage de la palette : frappe (filtrage), navigation ↑/↓/Enter, clic backdrop.
// Fait au chargement du module (globals, hors init) — les éléments existent dans
// le HTML statique.
(function wireCommandPalette() {
  const input = $('cmdk-input');
  const backdrop = $('cmdk-backdrop');
  if (input) {
    input.addEventListener('input', () => {
      _cmdkSel = 0;
      // Réarme le mode raccourci dès que le champ redevient vide (retour aux
      // touches orange) ; l'input reste en filtrage tant qu'il y a du texte.
      if (_cmdkMode === 'root' && !input.value && _cmdkFilterArmed) {
        _cmdkFilterArmed = false;
        input.placeholder = cmdkRootPlaceholder();
      }
      renderCommandList(input.value);
      // Complément asynchrone (U-3) : le scan de contenu ne peut plus se faire
      // dans le rendu synchrone ci-dessus. Armé seulement dans le submode qui en
      // dépend ; il redemande un rendu quand il aboutit.
      if (_cmdkMode === 'conv') scheduleCmdkContentScan(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCmdkSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveCmdkSelection(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); runCmdkItem(_cmdkSel); return; }
      // Raccourci par commande (lot F, suite) : en mode racine, champ vide et
      // filtrage NON armé, une lettre lance directement la commande. Comme « r »
      // pourrait aussi vouloir dire « filtrer réglages », l'utilisateur DÉSAMBIGUÏSE
      // en tapant Espace d'abord (avalé) → bascule en filtrage (décision Julien
      // 2026-07-11). Pas de modificateur (le raccourci EST la séquence Ctrl/Cmd+K
      // → lettre, K ayant déjà ouvert la palette).
      if (_cmdkMode === 'root' && !input.value && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === ' ') {
          // Espace en tête : bascule en filtrage sans l'insérer dans le champ.
          e.preventDefault();
          if (!_cmdkFilterArmed) {
            _cmdkFilterArmed = true;
            input.placeholder = cmdkRootPlaceholder();
            renderCommandList('');
          }
          return;
        }
        if (!_cmdkFilterArmed) {
          const cmd = cmdkKeyCommand(e.key);
          if (cmd) { e.preventDefault(); cmd.run(); }
        }
      }
    });
  }
  if (backdrop) backdrop.addEventListener('mousedown', closeCommandPalette);
})();

// ── Sélecteur serveur/modèle du composer ────────────────────────────────────
// Le sélecteur liste les modèles de TOUS les serveurs API non désactivés, pas
// seulement de l'actif. Cache de session (pas de persistance) indexé par **id de
// serveur**, jamais par URL : deux serveurs peuvent partager une URL et ne
// différer que par la clef d'API (même endpoint, droits d'accès distincts, donc
// listes de modèles distinctes) — une clef par URL ferait servir à l'un la liste
// de l'autre. L'id est déjà l'identité partout ailleurs (`activeApiServer().id`,
// `pickComposerModel`, `retryServerModels`) ; pas de clef composite (URL+clef ou
// son hash), qui n'ajouterait rien et ferait transiter la clef d'API dans un nom
// de propriété.
// Une entrée porte `{ id, stamp, models, error, pending }` — `error` mémorise
// l'échec pour l'afficher dans le menu (en-tête de groupe cliquable pour
// réessayer, cf. brief). `stamp` = empreinte de l'endpoint (URL + clef) au
// moment du fetch : l'id SURVIT à l'édition d'une carte, donc sans cette
// vérification une modification d'URL ou de clef laisserait en place la liste de
// l'ANCIEN endpoint.
const _modelsById = Object.create(null);

// Empreinte d'endpoint d'un serveur. Le séparateur `\n` n'apparaît ni dans une
// URL ni dans une clef saisie sur une ligne d'input : pas de collision entre
// (url `a`, clef `b`) et (url `a\nb`, clef vide).
function _serverStamp(server) {
  const o = server || {};
  return ((o.url || '').trim()) + '\n' + (o.key || '');
}

// Entrée de cache d'un serveur, réinitialisée si son endpoint a changé depuis le
// dernier fetch (édition de carte : même id, autre URL ou autre clef).
function _modelsEntry(server) {
  const id = (server && server.id) || '';
  const stamp = _serverStamp(server);
  let e = _modelsById[id];
  if (e && e.stamp !== stamp) e = null;   // endpoint modifié : l'ancienne liste ne vaut plus
  if (!e) { e = _modelsById[id] = { id, stamp, models: null, error: null, pending: null }; }
  return e;
}

// Lecture seule pour le rendu (menu, palette) : ne crée aucune entrée et ne
// ressuscite pas une liste devenue obsolète. Renvoie toujours un objet, les
// appelants lisent `.models`/`.error`/`.pending`.
function _modelsEntryOf(server) {
  const e = _modelsById[(server && server.id) || ''];
  return (e && e.stamp === _serverStamp(server)) ? e : {};
}

// Charge (ou renvoie depuis le cache) la liste d'un serveur. `force` relance un
// fetch même après échec (bouton « réessayer »). Ne rejette jamais : l'échec est
// mémorisé dans l'entrée, à charge de l'appelant de re-rendre.
function loadServerModels(server, force) {
  const url = ((server && server.url) || '').trim();
  if (!url) return Promise.resolve([]);
  const e = _modelsEntry(server);
  if (e.models && !force) return Promise.resolve(e.models);
  if (e.pending && !force) return e.pending;
  if (e.error && !force) return Promise.resolve([]);
  e.error = null;
  e.pending = fetchModelList({ url, key: server.key })
    .then(r => {
      // Propriétés déclarées persistées au passage (lot AF), même appel.
      try { recordListedModelProps(server, r.ids, r.props); } catch (err) { /* cache : un échec d'écriture ne coûte pas la liste */ }
      e.models = r.ids; e.error = null;
      // Chemin natif d'Ollama, NON attendu : la liste (et le verdict de santé
      // qu'en tire `probeBackend`) ne doit pas patienter derrière trois appels
      // de plus. Qui a besoin de la fin (glyphe de la fiche) attend `e.native`.
      const active = activeApiServer();
      e.native = readOllamaNative(server, r.ids, (active && active.id === server.id) ? activeModel() : '');
      return r.ids;
    })
    .catch(err => { e.models = null; e.error = String((err && err.message) || err || 'échec'); return []; })
    .then(models => { e.pending = null; return models; });
  return e.pending;
}

// ── Chemin natif d'Ollama (lot AF, étape 5) ─────────────────────────────────
// `/v1/models` d'Ollama ne porte que des ids : la fenêtre et les capacités sont
// sur la racine native (AF-1). État de SESSION par serveur, tenu à l'empreinte
// d'endpoint comme le cache de liste :
//   root    : racine qui a répondu comme un Ollama à la dernière lecture de la
//             liste, null sinon (pas un Ollama, CORS, panne : « inconnu ») ;
//   shown   : modèles dont `/api/show` a été lu depuis cette lecture ;
//   psDone  : modèles pour qui un appel a déjà déclenché `/api/ps` (AF-2) ;
//   psBusy  : lecture `/api/ps` en vol (verrou : titrage, résumé et chat qui
//             finissent ensemble n'en déclenchent qu'une).
const _ollamaNative = {};

function _ollamaState(server) {
  const id = (server && server.id) || '';
  const stamp = _serverStamp(server);
  let st = _ollamaNative[id];
  if (!st || st.stamp !== stamp) {
    st = _ollamaNative[id] = { stamp, root: null, shown: new Set(), psDone: new Set(), psBusy: false };
  }
  return st;
}

// Id LISTÉ correspondant à un nom (forme complète), sinon le nom tel quel.
function _ollamaListedId(server, name) {
  const ids = _modelsEntryOf(server).models || [];
  const hit = alignOllamaNames(ids, { [name]: true });
  return Object.keys(hit)[0] || name;
}

// Lecture native complète, à chaque chargement réussi de la liste (AF-7) :
// `/api/tags` (qui décide si c'est un Ollama, et se lit en positif), `/api/ps`
// (un appel pour tous les modèles chargés), `/api/show` du seul `showModel` —
// le modèle actif pour le serveur actif, rien pour un autre serveur (sa liste
// se charge à l'ouverture du menu : pas un POST par serveur pour autant), le
// modèle par défaut de la fiche pour le glyphe d'une fiche non active.
// Ne rejette jamais ; rafraîchit l'affichage si c'est un Ollama.
async function readOllamaNative(server, ids, showModel) {
  const st = _ollamaState(server);
  st.shown = new Set();   // une relecture de la liste relit `/api/show`
  const root = ollamaNativeRoot(server.url);
  const tags = root ? await fetchOllamaNative(root, '/api/tags', server.key) : null;
  if (_ollamaState(server) !== st) return;   // endpoint modifié pendant l'await
  if (!isOllamaTagsResponse(tags)) { st.root = null; return; }
  st.root = root;
  try { recordModelProps(server, alignOllamaNames(ids, modelPropsFromOllamaTags(tags))); } catch (e) { /* cache */ }
  await readOllamaServed(server, st);
  await readOllamaShow(server, showModel);
  onModelPropsChanged();
}

// `/api/ps` : fenêtre servie de tout ce qui est chargé. Une absence (modèle
// froid) n'efface pas la dernière mesure (fusion). Rend true si lu.
async function readOllamaServed(server, st) {
  if (!st.root || st.psBusy) return false;
  st.psBusy = true;
  try {
    const ps = await fetchOllamaNative(st.root, '/api/ps', server.key);
    if (!ps || _ollamaState(server) !== st) return false;
    const ids = _modelsEntryOf(server).models || [];
    const served = alignOllamaNames(ids, servedContextsFromOllamaPs(ps));
    try { recordModelProps(server, servedRecords(served, Date.now())); } catch (e) { /* cache */ }
    return true;
  } finally {
    st.psBusy = false;
  }
}

// `/api/show` d'UN modèle, une fois par lecture de la liste. POST par modèle :
// jamais en rafale sur la liste (AF-7).
async function readOllamaShow(server, model) {
  const st = _ollamaState(server);
  const m = String(model || '').trim();
  if (!st.root || !m || st.shown.has(m)) return false;
  st.shown.add(m);
  const show = await fetchOllamaNative(st.root, '/api/show', server.key, { model: m });
  if (!show || _ollamaState(server) !== st) return false;
  try { recordModelProps(server, { [_ollamaListedId(server, m)]: modelPropsFromOllamaShow(show) }); } catch (e) { /* cache */ }
  return true;
}

// Changement de modèle (appelée par `syncModelUI`, par où passent tous les
// changements) : lit `/api/show` du modèle actif s'il ne l'a pas été depuis la
// dernière lecture de la liste. Sans effet hors d'un Ollama reconnu.
function ensureActiveModelShown() {
  const server = activeApiServer();
  if (!server) return;
  const st = _ollamaNative[server.id];
  const m = activeModel();
  if (!st || st.stamp !== _serverStamp(server) || !st.root || !m || st.shown.has(m)) return;
  readOllamaShow(server, m).then(wrote => { if (wrote) onModelPropsChanged(); });
}

// Fin d'un appel réussi au modèle (`silentCompletion`/`streamCompletion`,
// AF-2 révisée) : le moteur vient de charger ce modèle, sa fenêtre servie est
// lisible. Au plus une lecture par (serveur, modèle) et par session, jamais
// hors d'un Ollama reconnu — surtout pas une sonde de dialecte à chaque appel.
function noteModelCalled(url, model) {
  const server = activeApiServer();
  if (!server || String(server.url || '').trim() !== String(url || '').trim()) return;
  const st = _ollamaNative[server.id];
  const m = String(model || '').trim();
  if (!st || st.stamp !== _serverStamp(server) || !st.root || !m || st.psDone.has(m) || st.psBusy) return;
  const sv = modelPropsFor(server, m).served;
  if (sv && sv.at >= MODEL_PROPS_SESSION_START) return;   // déjà mesuré cette session
  st.psDone.add(m);
  readOllamaServed(server, st).then(wrote => { if (wrote) onModelPropsChanged(); });
}

// Une lecture native a écrit : pilule, inspecteur, marque de vision, sélecteur
// de raisonnement (tous via `syncModelUI`), et les fiches serveur — sauf une
// fiche en cours d'édition, qu'un re-rendu viderait.
function onModelPropsChanged() {
  syncModelUI();
  const list = $('api-list');
  if (!(list && list.querySelector('.api-card.is-editing'))) renderApiServersIfOpen();
}

// Compat : liste du serveur ACTIF (utilisée par la visibilité du sélecteur et
// par prefetchModels au démarrage).
function loadModelsCached() {
  const s = activeApiServer();
  if (!s) return Promise.resolve([]);
  return loadServerModels(s);
}

function activeServerModels() {
  const s = activeApiServer();
  return (s && _modelsEntryOf(s).models) || null;
}

// Charge en parallèle les listes de tous les serveurs sélectionnables dont on
// n'a pas encore de résultat. Appelé à l'ouverture du menu : le serveur actif
// est déjà en cache (prefetchModels), les autres arrivent puis re-rendent.
function loadAllServerModels(force) {
  const servers = listSelectableApiServers();
  const todo = servers.filter(s => {
    const e = _modelsEntryOf(s);
    return force || (!e.models && !e.error && !e.pending);
  });
  if (!todo.length) return Promise.resolve(false);
  return Promise.all(todo.map(s => loadServerModels(s, force))).then(() => true);
}

// Met à jour les libellés de modèle (pastille topbar + bouton composer) sur le
// modèle effectif, et la visibilité du sélecteur composer (réglage activé ET
// liste disponible pour le serveur actif — sinon fallback silencieux, le
// sélecteur n'apparaît pas).
// Budget en caractères pour le libellé du bouton de modèle du composer.
// Le sélecteur ne doit pas dépasser ~55% de la rangée : au-delà, il pousse les
// pilules raisonnement et contexte hors de la ligne. La largeur disponible est
// MESURÉE (pas devinée), puis convertie en caractères via la largeur d'un glyphe
// mono à 11px (~0,6em) après déduction du chrome du bouton (icône, chevron,
// gaps, paddings ≈ 52px). Renvoie 0 quand la mesure n'est pas exploitable
// (élément absent, composer masqué, appel avant layout) : shortenModelLabel
// laisse alors le nom intact.
const COMPOSER_MODEL_MAX_RATIO = 0.55;
const COMPOSER_MODEL_BTN_CHROME_PX = 52;
// Marque de vision (lot AF) : glyphe 13px + gap 6px, retranchés quand elle est visible.
const COMPOSER_MODEL_VISION_PX = 19;
const COMPOSER_MODEL_CHAR_PX = 11 * 0.6;

// Budget du libellé de la pilule topbar (`.model-pill`, chat.css). Même besoin
// que le composer — un nom long doit perdre son AUTEUR avant sa fin — mais pas
// la même mécanique de mesure : la pilule a une `max-width` FIXE (210px), elle
// ne suit aucune rangée redimensionnable. Le budget est donc constant, et un
// ResizeObserver n'aurait rien à observer.
//
// Sans cette abréviation, `text-overflow: ellipsis` coupait bien le libellé
// mais par la FIN, en gardant l'auteur : `hf.co/unsloth/gemma-3-4b…` montrait
// l'hébergeur et masquait le modèle, soit exactement l'information utile.
// Le CSS reste en place — il rattrape le cas où l'abréviation ne suffit pas —
// mais il n'est plus le seul recours.
//
// 210px de pilule moins son chrome (paddings 10+10, gap 7, point 7) ≈ 176px de
// texte, convertis en caractères par la largeur d'un glyphe mono à 10.5px
// (~0,6em), comme au composer. Ces valeurs sont RECOPIÉES du CSS : les changer
// là-bas sans les changer ici ne casse rien de visible (le CSS tronque encore),
// ça déplace juste le seuil d'abréviation.
const TOPBAR_MODEL_TEXT_PX = 210 - 34;
const TOPBAR_MODEL_CHAR_PX = 10.5 * 0.6;
const TOPBAR_MODEL_MAX_CHARS = Math.floor(TOPBAR_MODEL_TEXT_PX / TOPBAR_MODEL_CHAR_PX);

function composerModelLabelBudget() {
  const row = $('composer-selectors');
  const rowWidth = row ? row.clientWidth : 0;
  if (!rowWidth) return 0;
  const cam = $('composer-model-vision');
  const camPx = (cam && !cam.hidden) ? COMPOSER_MODEL_VISION_PX : 0;
  const textPx = rowWidth * COMPOSER_MODEL_MAX_RATIO - COMPOSER_MODEL_BTN_CHROME_PX - camPx;
  if (textPx <= 0) return 0;
  return Math.floor(textPx / COMPOSER_MODEL_CHAR_PX);
}

// Le budget dépend d'une LARGEUR : il faut le recalculer quand la rangée change
// de taille (fenêtre redimensionnée, sidebar tirée, ouverture d'un drawer).
// ResizeObserver couvre les trois d'un coup, sans se brancher sur le drag de la
// sidebar ni sur un resize de fenêtre qui raterait le cas sidebar.
let _composerSelectorsRO = null;

function initComposerModelLabelFit() {
  const row = $('composer-selectors');
  if (!row || typeof ResizeObserver === 'undefined' || _composerSelectorsRO) return;
  _composerSelectorsRO = new ResizeObserver(() => {
    const compLabel = $('composer-model-label');
    if (!compLabel) return;
    // Recalcul du seul libellé : syncModelUI referait aussi le test de
    // visibilité (lecture de réglages + listes de serveurs) à chaque frame de
    // redimensionnement, pour rien.
    const m = activeModel() || 'modèle';
    compLabel.textContent = shortenModelLabel(m, composerModelLabelBudget());
    compLabel.title = m;
  });
  _composerSelectorsRO.observe(row);
}

function syncModelUI() {
  const m = activeModel() || 'modèle';
  // Pilule topbar : même abréviation que le bouton composer (auteur retiré,
  // puis fin tronquée), avec le nom complet en title pour rester récupérable.
  const top = $('model-label');
  if (top) {
    top.textContent = shortenModelLabel(m, TOPBAR_MODEL_MAX_CHARS);
    top.title = m;
  }
  // Bouton composer : nom ABRÉGÉ (auteur retiré, puis fin tronquée) — le nom
  // complet reste dans la liste déroulée ET en title, pour rester récupérable.
  // Marque de vision AVANT le libellé : son affichage change la place que le
  // budget de caractères doit lui laisser.
  const cam = $('composer-model-vision');
  if (cam) {
    const vs = modelVisionState(activeApiServer(), activeModel());
    cam.hidden = !(vs.source === 'declared' && vs.enabled);
  }
  const compLabel = $('composer-model-label');
  if (compLabel) {
    compLabel.textContent = shortenModelLabel(m, composerModelLabelBudget());
    compLabel.title = m;
  }
  const box = $('composer-model');
  if (box) {
    // Visible dès que le réglage est actif ET qu'il y a quelque chose à proposer :
    // soit la liste du serveur actif est chargée, soit un autre serveur est
    // sélectionnable (sa liste sera chargée à l'ouverture du menu). Sans ce
    // second cas, un serveur actif injoignable masquerait un sélecteur qui a
    // pourtant des modèles à offrir ailleurs.
    const models = activeServerModels();
    const others = listSelectableApiServers().filter(s => s.id !== (activeApiServer() || {}).id);
    const show = !!(loadSettings().showModelSelector && ((models && models.length) || others.length));
    box.hidden = !show;
  }
  // La fenêtre de contexte dépend du (serveur, modèle) depuis le lot AF : tout
  // changement de modèle, et toute relecture de liste qui a pu en apprendre la
  // fenêtre, repasse par ici — pilule, glyphe de seuil et inspecteur ouvert.
  syncContextCounter();
  // Même motif pour le raisonnement déclaré : un modèle déclaré sans
  // raisonnement masque le sélecteur (reasoningEffortBlocked).
  syncReasoningUI();
  // Tout changement de modèle passe par ici : c'est le point où lire
  // `/api/show` du nouveau modèle actif sur un Ollama (AF-7). Mémoïsé par
  // lecture de liste, donc sans effet au re-rendu — la lecture qui aboutit
  // rappelle `syncModelUI` et trouve le modèle déjà lu.
  ensureActiveModelShown();
}

function toggleComposerModelMenu() {
  const menu = $('composer-model-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  // Lecture seule (X-1f) : ce sélecteur choisit le modèle du PROCHAIN envoi —
  // sur un fil qui n'en acceptera plus aucun, il ne décide de rien. Refus à
  // l'OUVERTURE, pas seulement en CSS : `pointer-events: none` ne couvre ni le
  // clavier ni un appel programmatique. La fermeture (menu déjà ouvert) reste
  // permise inconditionnellement — au-dessus de cette ligne, exprès.
  if (isComposerReadonly()) return;
  renderComposerModelOptions();   // ancre déjà la ligne active dans la vue
  menu.classList.add('show');
  // Les serveurs non actifs sont interrogés à l'ouverture, pas au démarrage :
  // re-rendu à l'arrivée des réponses, si le menu est toujours ouvert. Le
  // re-rendu préserve la position visuelle de la ligne active (cf.
  // renderComposerModelOptions) : la liste ne saute pas sous le curseur.
  loadAllServerModels(false).then(changed => {
    if (changed && menu.classList.contains('show')) renderComposerModelOptions();
  });
}

// Réessaie la liste d'un serveur depuis l'en-tête de groupe en erreur.
function retryServerModels(serverId) {
  const s = getApiServer(serverId);
  if (!s) return;
  renderComposerModelOptions();   // reflète l'état « en cours »
  loadServerModels(s, true).then(() => {
    const menu = $('composer-model-menu');
    if (menu && menu.classList.contains('show')) renderComposerModelOptions();
  });
}

// Re-rendu du menu SANS déplacer ce que l'utilisateur a sous les yeux. Le menu
// est réécrit en entier à chaque arrivée de liste d'un serveur non actif (et à
// chaque retry) : sans ancrage, `scrollTop` retombe à 0 et la ligne active
// disparaît sous le pli. On ré-ancre sur l'élément sélectionné en préservant son
// décalage VISUEL (distance au haut du menu), pas seulement sa visibilité : la
// liste ne glisse pas sous le curseur quand des groupes s'insèrent AVANT lui.
// Repli sur le `scrollTop` brut quand il n'y a pas de ligne sélectionnée (aucun
// modèle actif dans la liste, ou premier rendu).
function renderComposerModelOptions() {
  const menu = $('composer-model-menu');
  if (!menu) return;
  const prevSel = menu.querySelector('.model-opt.selected');
  // Décalage de la ligne active par rapport au haut de la zone scrollable, tel
  // qu'il est perçu à l'écran juste avant réécriture.
  const prevOffset = prevSel ? (prevSel.offsetTop - menu.scrollTop) : null;
  const prevScroll = menu.scrollTop;
  renderComposerModelOptionsInner();
  const nextSel = menu.querySelector('.model-opt.selected');
  if (nextSel && prevOffset !== null) {
    menu.scrollTop = nextSel.offsetTop - prevOffset;
  } else if (nextSel) {
    // Premier rendu (ou apparition de la sélection) : amener la ligne active
    // dans la vue, sans forcer si elle y est déjà (`block: 'nearest'`).
    nextSel.scrollIntoView({ block: 'nearest' });
  } else {
    menu.scrollTop = prevScroll;
  }
}

function renderComposerModelOptionsInner() {
  const menu = $('composer-model-menu');
  const cur = activeModel();
  const activeId = (activeApiServer() || {}).id;
  const servers = listSelectableApiServers();
  menu.innerHTML = '';
  // Groupes visuels seulement s'il y a plusieurs serveurs : à un seul serveur,
  // l'en-tête n'apporte rien et le menu garde son apparence historique.
  const grouped = servers.length > 1;
  servers.forEach(s => {
    const e = _modelsEntryOf(s);
    if (grouped) menu.appendChild(buildModelGroupHeader(s, e));
    const models = e.models || [];
    if (!models.length) {
      if (e.error) menu.appendChild(buildModelGroupNote(s, 'Liste indisponible — réessayer'));
      else if (e.pending) menu.appendChild(buildModelGroupNote(s, 'Interrogation…'));
      else if (e.models) menu.appendChild(buildModelGroupNote(s, 'Aucun modèle exposé'));
      return;
    }
    models.forEach(m => {
      // « Sélectionné » = le couple (serveur actif, modèle courant) : le même nom
      // de modèle exposé par deux serveurs ne doit cocher que celui en usage.
      const isSel = m === cur && s.id === activeId;
      const o = document.createElement('div');
      o.className = 'model-opt' + (isSel ? ' selected' : '');
      // Marque de vision déclarée (lot AF), même glyphe que la pilule.
      const vs = modelVisionState(s, m);
      const cam = (vs.source === 'declared' && vs.enabled)
        ? `<span class="model-opt-vision" title="Lit les images (déclaré par le serveur)">${ICON_CAMERA}</span>` : '';
      o.innerHTML = `<span>${escHtml(m)}</span><span class="model-opt-trail">${cam}<span class="check">✓</span></span>`;
      o.onmousedown = (ev) => { ev.preventDefault(); pickComposerModel(m, s.id); };
      menu.appendChild(o);
    });
  });
}

function buildModelGroupHeader(server, entry) {
  const h = document.createElement('div');
  h.className = 'model-group' + (entry && entry.error ? ' has-error' : '');
  const n = document.createElement('span');
  n.className = 'model-group-name';
  n.textContent = server.name || server.url || 'Serveur';
  h.appendChild(n);
  return h;
}

// Ligne d'état sous un en-tête de groupe. En erreur, elle est cliquable et
// relance le fetch pour ce serveur.
function buildModelGroupNote(server, label) {
  const d = document.createElement('div');
  d.className = 'model-group-note';
  d.textContent = label;
  const e = _modelsEntryOf(server);
  if (e.error) {
    d.classList.add('is-error');
    d.onmousedown = (ev) => { ev.preventDefault(); retryServerModels(server.id); };
  }
  return d;
}

// Sélection d'un modèle dans le composer. Si le modèle appartient à un autre
// serveur, on bascule le serveur ACTIF (décision Julien 2026-08-21 : pas
// d'override de serveur par conversation) — l'ordre compte, le serveur d'abord
// puis le modèle, sinon setConvModel persisterait un modèle sur l'ancien
// endpoint le temps d'un rendu.
function pickComposerModel(m, serverId) {
  const activeId = (activeApiServer() || {}).id;
  if (serverId && serverId !== activeId) {
    setActiveApiServerId(serverId);
    renderApiServersIfOpen();
    syncActiveApiServerUI();
    syncConfigured();
  }
  setConvModel(m);   // override conv + persistance + syncModelUI
  $('composer-model-menu').classList.remove('show');
}

// ── Sélecteur de niveau de raisonnement du composer ─────────────────────────
// Même mécanique que le sélecteur de modèle (bouton pilule + .model-menu
// générique), mais liste STATIQUE (pas de fetch, pas de cache session) : les 5
// valeurs possibles sont fixes. Masqué si le réglage est désactivé OU si l'API a
// déjà rejeté reasoning_effort pour l'endpoint+modèle actifs cette session
// (isReasoningEffortRejected, api.js), ou si le serveur déclare le modèle sans
// raisonnement (reasoningEffortBlocked). Le niveau choisi est CONSERVÉ : c'est
// l'envoi qui s'abstient, pas la conversation qui oublie.
const REASONING_EFFORT_OPTIONS = [
  { value: '', label: 'défaut' },
  { value: 'none', label: 'none' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

function syncReasoningUI() {
  const box = $('composer-reasoning');
  if (!box) return;
  const settings = loadSettings();
  // La clé du cache de rejet est l'URL du serveur ACTIF (posée par
  // streamCompletion via activeApiConfig) — pas settings.url, legacy depuis le
  // multi-serveurs : sur un serveur actif ≠ serveur migré, la lecture raterait.
  // Même prédicat que l'envoi : rejet essuyé OU modèle déclaré sans raisonnement.
  // Bloqué, le sélecteur se MASQUE sans toucher au niveau de la conversation :
  // l'effacer (setConvReasoningEffort, qui persiste) le perdait pour de bon, et
  // depuis que syncModelUI appelle ce rendu, il suffisait d'OUVRIR une
  // conversation servie par un modèle bloqué pour écraser son niveau enregistré.
  // Rien ne part pour autant : streamCompletion applique le même prédicat.
  const rejected = reasoningEffortBlocked(activeApiConfig().url, activeModel());
  const cur = activeReasoningEffort();
  const opt = REASONING_EFFORT_OPTIONS.find(o => o.value === cur);
  const label = $('composer-reasoning-label');
  if (label) label.textContent = opt ? opt.label : cur;
  const btn = $('composer-reasoning-btn');
  if (btn) btn.classList.toggle('is-default', !cur);
  box.hidden = !settings.showReasoningSelector || rejected;
}

function toggleComposerReasoningMenu() {
  const menu = $('composer-reasoning-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  if (isComposerReadonly()) return;   // cf. toggleComposerModelMenu (X-1f)
  renderComposerReasoningOptions();
  menu.classList.add('show');
}

function renderComposerReasoningOptions() {
  const menu = $('composer-reasoning-menu');
  const cur = activeReasoningEffort();
  menu.innerHTML = '';
  REASONING_EFFORT_OPTIONS.forEach(o => {
    const el = document.createElement('div');
    el.className = 'model-opt' + (o.value === cur ? ' selected' : '');
    el.innerHTML = `<span>${escHtml(o.label)}</span><span class="check">✓</span>`;
    el.onmousedown = (ev) => { ev.preventDefault(); pickComposerReasoningEffort(o.value); };
    menu.appendChild(el);
  });
}

function pickComposerReasoningEffort(v) {
  setConvReasoningEffort(v);   // override conv + persistance + syncReasoningUI
  $('composer-reasoning-menu').classList.remove('show');
}

// Même composant (bouton pilule + .model-menu), pour le choix du DÉFAUT GLOBAL
// dans les settings — pas d'override de conversation ici. La valeur vit dans le
// hidden input #set-reasoning-effort, lu tel quel par onSaveSettings() comme les
// autres champs du formulaire ; rien n'est persisté avant l'enregistrement.
function toggleSettingsReasoningMenu() {
  const menu = $('set-reasoning-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  renderSettingsReasoningOptions();
  menu.classList.add('show');
}

function renderSettingsReasoningOptions() {
  const menu = $('set-reasoning-menu');
  const cur = $('set-reasoning-effort').value;
  menu.innerHTML = '';
  REASONING_EFFORT_OPTIONS.forEach(o => {
    const el = document.createElement('div');
    el.className = 'model-opt' + (o.value === cur ? ' selected' : '');
    el.innerHTML = `<span>${escHtml(o.label)}</span><span class="check">✓</span>`;
    el.onmousedown = (ev) => { ev.preventDefault(); pickSettingsReasoningEffort(o.value); };
    menu.appendChild(el);
  });
}

function pickSettingsReasoningEffort(v) {
  $('set-reasoning-effort').value = v;
  syncSettingsReasoningLabel();
  $('set-reasoning-menu').classList.remove('show');
  updateSettingsDirty();
}

// Ré-affiche le label du bouton depuis la valeur courante du hidden input —
// nécessaire après un chargement programmatique (init) qui ne passe pas par
// pickSettingsReasoningEffort.
function syncSettingsReasoningLabel() {
  const v = $('set-reasoning-effort').value;
  const opt = REASONING_EFFORT_OPTIONS.find(o => o.value === v);
  $('set-reasoning-label').textContent = opt ? opt.label : v;
  $('set-reasoning-btn').classList.toggle('is-default', !v);
}

// ── Settings drawer ─────────────────────────────────────────────────────────
// Accordéon des catégories (référencé en onclick= inline) : même mécanique que
// les namespaces du drawer outils. `.settled` (overflow visible, nécessaire aux
// .model-menu absolus) est posée par le transitionend câblé dans init() — jamais
// ici, pour que le clip tienne pendant toute la transition d'ouverture.
// Ouvre les réglages sur une catégorie désignée par sa clé (`data-cat` de son
// en-tête, index.html), la déplie et la fait défiler en vue. Cible du clic des
// toasts de quota (« Données »).
function openSettingsCategory(key) {
  openSettings();
  const head = document.querySelector('#drawer .set-cat-head[data-cat="' + key + '"]');
  if (!head) return;
  if (!head.classList.contains('open')) toggleSettingsCat(head);
  setTimeout(function() { head.scrollIntoView({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' }); }, 240);
}

function toggleSettingsCat(head) {
  const body = head.nextElementSibling;
  const opening = !head.classList.contains('open');
  document.querySelectorAll('#drawer .set-cat-head.open').forEach(function(h) {
    if (h === head) return;
    h.classList.remove('open');
    h.nextElementSibling.classList.remove('open', 'settled');
  });
  head.classList.toggle('open', opening);
  body.classList.toggle('open', opening);
  if (!opening) body.classList.remove('settled');
}

// Vrai si le formulaire diverge des réglages persistés, sur les seuls champs
// enregistrés par onSaveSettings() ET pas déjà auto-persistés ailleurs. Le thème
// est exclu (selectTheme sauve immédiatement). summaryInjectionMode est comparé
// en live à loadSettings() : la bannière peut le persister pendant que le drawer
// est ouvert, la comparaison reste juste.
function settingsFormDirty() {
  const s = loadSettings();
  return $('set-system').value !== (s.systemPrompt || '')
    || $('set-highlight').checked !== (s.highlight !== false)
    || pendingSummaryInjectionMode !== (s.summaryInjectionMode || 'propose')
    || $('set-modelselector').checked !== !!s.showModelSelector
    || $('set-reasoning-effort').value !== (s.reasoningEffort || '')
    || $('set-reasoningselector').checked !== !!s.showReasoningSelector
    || $('set-intent-tracing').checked !== !!s.intentTracing
    || $('set-early-title').checked !== !!s.earlyTitle
    || $('set-did-you-know').checked !== !!s.didYouKnow
    || $('set-retitle-after-reply').checked !== effectiveRetitleAfterReply(s)
    || $('set-describe-files').checked !== (s.describeFiles !== false)
    || $('set-library-manifest').checked !== !!s.libraryManifestInContext
    || $('set-export-interactive').checked !== (s.exportInteractive !== false);
}

// Active « Enregistrer » seulement si quelque chose est à enregistrer. Appelé
// par délégation input/change sur le drawer (câblée dans init) et explicitement
// par les chemins programmatiques qui n'émettent pas d'événement
// (pickSettingsReasoningEffort, selectSummaryInjectionMode, onSaveSettings).
function updateSettingsDirty() {
  syncRetitleUI();   // libellé/éditabilité du retitrage AVANT la comparaison (il peut forcer la case)
  const btn = $('save-settings-btn');
  if (btn) btn.disabled = !settingsFormDirty();
}

// Le réglage « titre après la première réponse » est SUBORDONNÉ au titrage
// précoce, et sa présentation change avec lui — pas seulement son état :
//
// - précoce OFF : la case décrit l'EXISTANT (le niveau 3 titre en fin
//   d'échange, il l'a toujours fait). Cochée et NON MODIFIABLE : la décocher
//   ouvrirait un cas « aucun titrage du tout » que personne n'a demandé et qui
//   ramènerait « Nouvelle conversation » à demeure.
// - précoce ON : la case gouverne un vrai choix, celui de RÉGÉNÉRER un titre
//   déjà écrit. D'où le changement de libellé — « régénéré » dit qu'un titre
//   sera écrasé, ce que « Titre après la première réponse » ne dit pas.
//
// Appelée depuis updateSettingsDirty, donc sur le MÊME chemin que la délégation
// input/change du drawer : la bascule de `set-early-title` la déclenche sans
// handler dédié, et openSettings en hérite aussi.
const RETITLE_LABEL_ALONE = 'Titre après la première réponse';
const RETITLE_LABEL_AFTER_EARLY = 'Titre régénéré après la première réponse';
const RETITLE_HINT_ALONE = "Le titre est généré en fin d'échange, quand la réponse est connue.";
const RETITLE_HINT_AFTER_EARLY = "Remplace le titre écrit à l'envoi par un titre tenant compte de la réponse.";

function syncRetitleUI() {
  const cb = $('set-retitle-after-reply');
  if (!cb) return;
  const early = $('set-early-title').checked;
  if (!early) cb.checked = true;   // sans titrage précoce, le niveau 3 titre toujours
  cb.disabled = !early;
  // Le grisage porte sur la LIGNE entière (libellé compris), pas sur le seul
  // interrupteur : cf. .check-row.is-locked, drawers.css.
  const row = cb.closest('.check-row');
  if (row) row.classList.toggle('is-locked', !early);
  const lbl = $('set-retitle-label');
  if (lbl) lbl.textContent = early ? RETITLE_LABEL_AFTER_EARLY : RETITLE_LABEL_ALONE;
  const hint = $('set-retitle-hint');
  if (hint) hint.textContent = early ? RETITLE_HINT_AFTER_EARLY : RETITLE_HINT_ALONE;
}

// ── État des lieux du stockage (drawer Paramètres › Données) ────────────────
// Rendu du rapport produit par collectStorageReport(). Le chiffre principal est
// la somme MESURÉE par MIAOU (exacte), rapportée au quota du navigateur ;
// estimate().usage n'est pas utilisé (cf. la note en tête de la section « État
// des lieux du stockage », storage.js). Tout est du texte construit ici, jamais
// d'origine modèle.
const STORAGE_REPORT_LABELS = {
  conversations: 'Conversations',
  summaries: 'Résumés',
  resources: 'Fichiers et pièces jointes',
  skills: 'Skills',
  settings: 'Réglages, souvenirs, espaces',
};

function renderStorageReport(report) {
  const totalEl = $('storage-report-total');
  const detailEl = $('storage-report-detail');
  if (!totalEl || !detailEl) return;
  totalEl.innerHTML = '<strong>' + escHtml(humanSize(report.measured)) + '</strong> utilisés' +
    (report.quota
      ? ' <span class="storage-quota">sur ' + escHtml(humanSize(report.quota)) +
        ' disponibles' + (report.percent != null ? ' (' + report.percent + '\u00a0%)' : '') + '</span>'
      : '');
  let html = '';
  for (const key of Object.keys(STORAGE_REPORT_LABELS)) {
    const bytes = report.detail[key] || 0;
    html += '<span>' + escHtml(STORAGE_REPORT_LABELS[key]) + '</span>' +
      '<span class="storage-bytes">' + escHtml(humanSize(bytes)) + '</span>';
  }
  detailEl.innerHTML = html;
}

// Déclenché à chaque ouverture du drawer (les chiffres bougent entre deux
// ouvertures). Un jeton de séquence fait abandonner un rendu devenu obsolète si
// le drawer est refermé puis rouvert pendant la mesure (même discipline que
// _openConvSeq, cf. piège 24 : l'état est relu APRÈS l'await).
let _storageReportSeq = 0;
function refreshStorageReport() {
  const totalEl = $('storage-report-total');
  const detailEl = $('storage-report-detail');
  if (!totalEl || !detailEl) return;
  const seq = ++_storageReportSeq;
  totalEl.textContent = 'Mesure en cours…';
  detailEl.innerHTML = '';
  collectStorageReport().then(function(report) {
    if (seq !== _storageReportSeq) return;
    renderStorageReport(report);
  }).catch(function() {
    if (seq !== _storageReportSeq) return;
    totalEl.textContent = 'Mesure indisponible.';
  });
}

function openSettings() {
  const s = loadSettings();
  setSummaryInjectionModeUI(s.summaryInjectionMode);   // valeur courante (peut changer via la bannière)
  setThemeUI(s.theme || 'system');
  setPaletteUI(s.palette || 'ambre');
  setFontsUI(s.fonts || 'graphite');
  setMotionUI(s.motion || 'system');
  $('set-intent-tracing').checked = !!s.intentTracing;
  $('set-early-title').checked = !!s.earlyTitle;
  $('set-did-you-know').checked = !!s.didYouKnow;
  $('set-retitle-after-reply').checked = effectiveRetitleAfterReply(s);
  $('set-describe-files').checked = s.describeFiles !== false;
  $('set-library-manifest').checked = !!s.libraryManifestInContext;
  $('set-export-interactive').checked = s.exportInteractive !== false;
  // Auto-persisté et donc modifiable hors du formulaire (autre onglet) : relu à
  // l'ouverture, comme les segments ci-dessus.
  $('set-wide-tables').checked = s.wideTables !== false;
  const pre = $('root-prompt-pre');
  if (pre && !pre.dataset.loaded) {
    pre.innerHTML = renderMd(rootSystemPromptDisplay());
    pre.dataset.loaded = '1';
  }
  const lbl = $('build-ts-label');
  if (lbl) {
    lbl.textContent = BUILD_TS
      ? 'Build : ' + new Date(BUILD_TS * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })
      : '';
  }
  refreshStorageReport();  // asynchrone : le bloc se remplit après ouverture
  updateSettingsDirty();   // des saisies non enregistrées peuvent survivre à une fermeture
  $('drawer').classList.add('show');
  $('backdrop').classList.add('show');
}
function closeSettings() {
  $('drawer').classList.remove('show');
  $('backdrop').classList.remove('show');
  // Referme le menu du sélecteur de raisonnement des réglages s'il est resté
  // ouvert. (L'ancien $('model-menu') — champ modèle global supprimé au passage
  // aux cartes serveurs — levait une TypeError à chaque fermeture du drawer.)
  const rm = $('set-reasoning-menu');
  if (rm) rm.classList.remove('show');
}

// ── Catégorie « Données » : export / import complet (feature E) ─────────────
// Ces boutons agissent immédiatement (pas branchés sur settingsFormDirty/
// onSaveSettings, cf. brief). Le récapitulatif d'import affiche les compteurs
// et un bouton d'application arm-then-confirm (remplacement intégral =
// destructif) ; l'orchestration (lecture fichier, application) vit dans main.js.

// Réinitialise la zone d'import (masque erreur + récapitulatif). Appelé avant
// chaque nouvelle sélection de fichier.
function resetImportDataUI() {
  const err = $('import-data-err');
  if (err) { err.setAttribute('hidden', ''); err.textContent = ''; }
  const sum = $('import-data-summary');
  if (sum) { sum.setAttribute('hidden', ''); sum.innerHTML = ''; }
}

function showImportDataError(msg) {
  resetImportDataUI();
  const err = $('import-data-err');
  if (err) { err.textContent = msg; err.removeAttribute('hidden'); }
}

// Jumeau côté export (lot V-3). `exportAllData` n'avait AUCUN chemin d'erreur
// avant V-3 : tout y était synchrone-après-await. Le passage au conteneur zip
// introduit `ensureFflate`, qui peut légitimement échouer (CDN indisponible,
// hors-ligne). Un bouton « Exporter les données » muet — sur l'assurance-vie de
// l'application — est le pire silence possible. Décision Julien : un message,
// jamais un repli silencieux vers le .json non compressé, qui produirait un
// fichier différent de ce que l'utilisateur croit avoir.
function showExportDataError(msg) {
  const err = $('export-data-err');
  if (!err) return;
  if (!msg) { err.setAttribute('hidden', ''); err.textContent = ''; return; }
  err.textContent = msg;
  err.removeAttribute('hidden');
}

// Affiche le récapitulatif d'un import valide (counts de validateImportPayload)
// et câble le bouton d'application sur armThenRun. `onApply` est appelé au
// second clic (confirmation) — l'appelant (main.js) porte l'effet de bord.
function renderImportSummary(counts, onApply) {
  resetImportDataUI();
  const sum = $('import-data-summary');
  if (!sum) return;
  sum.innerHTML =
    `<div>${counts.conversations} conversation(s), ${counts.summaries} résumé(s), ` +
    `${counts.memories} souvenir(s), ${counts.skills} skill(s), ` +
    `${counts.resources} ressource(s), ${counts.servers} serveur(s), ` +
    `${counts.spaces} espace(s).</div>`;
  // Sauvegarde v3 partiellement abîmée : les ressources dont le membre manque
  // sont importées vides plutôt que de faire échouer tout l'import. Le dire ICI,
  // avant le clic d'application — après, il serait trop tard pour renoncer.
  if (counts.missingResourceData) {
    const warn = document.createElement('div');
    warn.className = 'import-summary-warn';
    warn.textContent = counts.missingResourceData + ' ressource(s) sans données dans l\'archive : ' +
      'elles seront importées vides.';
    sum.appendChild(warn);
  }
  const btn = document.createElement('button');
  btn.className = 'drawer-btn danger';
  btn.textContent = 'Appliquer (remplace tout)';
  btn.onclick = () => armThenRun(btn, onApply, 'Confirmer le remplacement');
  sum.appendChild(btn);
  sum.removeAttribute('hidden');
}

// Légende décrivant le comportement induit par l'option sélectionnée (une seule
// à la fois), plutôt que l'énumération des trois modes.
const SUMMARY_INJECTION_HINTS = {
  auto:    "Recherche les conversations passées liées et les injecte dans le contexte, sans rien demander.",
  propose: "Détecte les conversations passées liées et propose de les injecter via une bannière, avant l'envoi.",
  never:   "Aucune recherche ni injection automatique des conversations passées.",
};

let pendingSummaryInjectionMode = 'propose';
function setSummaryInjectionModeUI(mode) {
  pendingSummaryInjectionMode = mode || 'propose';
  document.querySelectorAll('#summary-injection-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingSummaryInjectionMode);
  });
  const hint = $('summary-injection-hint');
  if (hint) hint.textContent = SUMMARY_INJECTION_HINTS[pendingSummaryInjectionMode] || '';
}
function selectSummaryInjectionMode(mode) { setSummaryInjectionModeUI(mode); updateSettingsDirty(); }

// ── Thème ────────────────────────────────────────────────────────────────────
const THEME_HINTS = {
  light:  "Interface toujours en clair, indépendamment du système.",
  dark:   "Interface toujours en sombre, indépendamment du système.",
  system: "Suit la préférence clair/sombre du système d'exploitation.",
};

let pendingTheme = 'system';
// Pose TOUJOURS un data-theme résolu (light|dark) : « system » est tranché ici
// via matchMedia (comme le script de boot du <head>), jamais délégué à un bloc
// @media CSS — le thème clair n'existe qu'en une seule variante
// html[data-theme="light"]. Suivi live du changement de préférence OS ci-dessous.
function applyTheme(theme) {
  let resolved = theme;
  if (resolved !== 'light' && resolved !== 'dark') {
    resolved = (typeof window !== 'undefined' && window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', resolved);
  refreshMermaidTheme(resolved);   // hook unique : couvre selectTheme ET le suivi OS
  refreshWelcomeIfPresent();       // coquetterie : re-tire l'accueil si affiché (vierge)
}

// Réglage « system » : un changement de préférence OS en cours de session
// ré-applique le thème résolu. Guard matchMedia : absent des stubs QuickJS.
if (typeof window !== 'undefined' && window.matchMedia) {
  const _themeMq = window.matchMedia('(prefers-color-scheme: light)');
  const _onSystemThemeChange = () => {
    const t = loadSettings().theme || 'system';
    if (t !== 'light' && t !== 'dark') applyTheme(t);
  };
  if (_themeMq.addEventListener) _themeMq.addEventListener('change', _onSystemThemeChange);
  else if (_themeMq.addListener) _themeMq.addListener(_onSystemThemeChange);   // Safari < 14
}
function setThemeUI(theme) {
  pendingTheme = theme || 'system';
  document.querySelectorAll('#theme-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingTheme);
  });
  const hint = $('theme-hint');
  if (hint) hint.textContent = THEME_HINTS[pendingTheme] || '';
}
function selectTheme(theme) {
  setThemeUI(theme);
  applyTheme(theme);
  saveSettings({ theme });   // persisté immédiatement : préférence visuelle à effet direct
}

// ── Palettes (axe orthogonal au thème clair/sombre, lot S-a) ────────────────
const PALETTES = ['ambre', 'encre', 'foret'];
const PALETTE_HINTS = {
  ambre: "Orange chaud sur gris froids (palette d'origine).",
  encre: "Bleu franc sur bleu-nuit, gris-bleu en clair.",
  foret: "Vert jade sur gris-vert profonds, lin en clair.",
};

let pendingPalette = 'ambre';
// Ambre est le DÉFAUT : pas d'attribut posé (le bloc :root de base.css la
// porte), même logique que « pas de classe pour l'état nominal ». Une valeur
// inconnue (réglage corrompu, palette retirée) retombe sur ambre plutôt que de
// laisser un data-palette orphelin qui ne matcherait aucune règle.
function applyPalette(palette) {
  const p = PALETTES.indexOf(palette) >= 0 ? palette : 'ambre';
  if (p === 'ambre') document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', p);
}

function setPaletteUI(palette) {
  pendingPalette = PALETTES.indexOf(palette) >= 0 ? palette : 'ambre';
  document.querySelectorAll('#palette-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingPalette);
  });
  const hint = $('palette-hint');
  if (hint) hint.textContent = PALETTE_HINTS[pendingPalette] || '';
}

function selectPalette(palette) {
  setPaletteUI(palette);
  applyPalette(palette);
  saveSettings({ palette });   // persistance immédiate, modèle selectTheme
}

// ── Lots de fontes (axe orthogonal à la palette et au thème, lot S-b) ───────
// Sans et mono vont par PAIRE : elles sont choisies pour s'accorder, comme les
// deux teintes d'une palette. Les six familles sont préchargées par l'@import
// unique de base.css, donc la bascule ne déclenche aucun fetch ni FOUT.
const FONT_LOTS = ['graphite', 'atelier', 'chaleur'];
const FONT_HINTS = {
  graphite: "Hanken Grotesk et JetBrains Mono — l'aspect d'origine.",
  atelier:   "Source Sans 3 et Source Code Pro — dessinées comme une même famille.",
  chaleur:   "Figtree et Fira Code — plus rond, mono à ligatures.",
};

// Familles par lot — utilisées par le préchargement. Doivent rester alignées
// sur les blocs :root[data-fonts] de base.css ET sur le <link> du <head> :
// une famille listée ici mais absente du <link> ne se chargerait jamais.
const FONT_LOT_FAMILIES = {
  graphite: { sans: 'Hanken Grotesk', mono: 'JetBrains Mono' },
  atelier:  { sans: 'Source Sans 3',  mono: 'Source Code Pro' },
  chaleur:  { sans: 'Figtree',        mono: 'Fira Code' },
};

let pendingFonts = 'graphite';
// « graphite » est le DÉFAUT : pas d'attribut posé (le bloc :root le porte),
// même doctrine que la palette ambre. Une valeur inconnue retombe dessus
// plutôt que de laisser un data-fonts orphelin qui ne matcherait aucune règle.
function applyFonts(fonts) {
  const f = FONT_LOTS.indexOf(fonts) >= 0 ? fonts : 'graphite';
  if (f === 'graphite') document.documentElement.removeAttribute('data-fonts');
  else document.documentElement.setAttribute('data-fonts', f);
}

function setFontsUI(fonts) {
  pendingFonts = FONT_LOTS.indexOf(fonts) >= 0 ? fonts : 'graphite';
  document.querySelectorAll('#fonts-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingFonts);
  });
  const hint = $('fonts-hint');
  if (hint) hint.textContent = FONT_HINTS[pendingFonts] || '';
}

// Précharge les familles des lots NON actifs. Le <link> du <head> déclare les
// six @font-face, mais un navigateur ne télécharge un .woff2 que lorsqu'un
// glyphe le réclame : sans ça, basculer de lot déclenchait deux fetchs et un
// saut visuel. document.fonts.load() force le téléchargement sans rien rendre.
// Appelé après l'init, pendant que l'overlay de boot masque encore l'écran :
// le coût est invisible, et toute bascule ultérieure est instantanée.
// Silencieux par construction (préchargement opportuniste) : hors ligne ou
// Google Fonts injoignable, on retombe sur le comportement d'avant.
function prefetchFontLots() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  const families = [];
  for (const lot of FONT_LOTS) {
    if (lot === pendingFonts) continue;   // le lot actif se charge tout seul
    const spec = FONT_LOT_FAMILIES[lot];
    if (spec) families.push(spec.sans, spec.mono);
  }
  for (const fam of families) {
    // Les deux graisses réellement utilisées : charger « 400 » ne rapatrie pas
    // le fichier du 600 (un poids = un fichier).
    document.fonts.load(`400 1rem "${fam}"`).catch(() => {});
    document.fonts.load(`600 1rem "${fam}"`).catch(() => {});
  }
}

function selectFonts(fonts) {
  setFontsUI(fonts);
  applyFonts(fonts);
  saveSettings({ fonts });   // persistance immédiate, modèle selectTheme
}

// ── Animations (reduced-motion) ─────────────────────────────────────────────
const MOTION_HINTS = {
  normal:  "Animations toujours actives, indépendamment du système.",
  reduced: "Animations désactivées, indépendamment du système.",
  system:  "Suit la préférence de réduction des animations du système.",
};

let pendingMotion = 'system';
// Cache du booléen reduced-motion effectif, alimenté par applyMotion (seul point
// de passage à chaque changement : init, selectMotion, sync multi-onglets,
// changement de préférence OS). motionReduced() n'a donc PAS à re-parser le
// localStorage à chaque appel — il est sollicité par ack animé et clic badge,
// fréquence trop lourde pour un loadSettings() à chaque fois (retour Julien).
// null = jamais initialisé → calcul complet une fois (défensif, avant init).
let _motionReducedCache = null;
function systemPrefersReducedMotion() {
  return !!(typeof window !== 'undefined' && window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
// Booléen effectif consommé par les animations (ticker d'acks pour l'instant,
// brief N §8) : accessor global, jamais de matchMedia câblé en dur ailleurs.
function motionReduced() {
  if (_motionReducedCache === null) {
    _motionReducedCache = resolveMotionReduced(loadSettings().motion || 'system',
                                               systemPrefersReducedMotion());
  }
  return _motionReducedCache;
}
// Pose/retire l'attribut sur <html>, même doctrine que data-theme (piège N/A
// ici, pas de KV-cache concerné) : jamais délégué à un bloc @media CSS seul,
// pour que le réglage explicite prime toujours sur la préférence système.
// Rafraîchit aussi le cache lu par motionReduced() (seul point de passage).
function applyMotion(setting) {
  const reduced = resolveMotionReduced(setting, systemPrefersReducedMotion());
  _motionReducedCache = reduced;
  if (reduced) document.documentElement.setAttribute('data-motion', 'reduced');
  else document.documentElement.removeAttribute('data-motion');
}
// Réglage « system » : un changement de préférence OS en cours de session
// ré-applique le gate. Guard matchMedia : absent des stubs QuickJS.
if (typeof window !== 'undefined' && window.matchMedia) {
  const _motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const _onSystemMotionChange = () => {
    const m = loadSettings().motion || 'system';
    if (m === 'system') applyMotion(m);
  };
  if (_motionMq.addEventListener) _motionMq.addEventListener('change', _onSystemMotionChange);
  else if (_motionMq.addListener) _motionMq.addListener(_onSystemMotionChange);   // Safari < 14
}
function setMotionUI(motion) {
  pendingMotion = motion || 'system';
  document.querySelectorAll('#motion-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingMotion);
  });
  const hint = $('motion-hint');
  if (hint) hint.textContent = MOTION_HINTS[pendingMotion] || '';
}
function selectMotion(motion) {
  setMotionUI(motion);
  applyMotion(motion);
  saveSettings({ motion });   // persisté immédiatement, modèle selectTheme
}

// Réglage « Élargir les grands tableaux » : un seul attribut sur <html>, lu par
// `html[data-wide-tables="off"] .table-bleed` (chat.css). Même forme
// qu'applyPalette/applyMotion — et surtout AUCUN re-rendu du fil : le porteur
// est posé en permanence par wrapWideTables, c'est le CSS qui décide seul si le
// débordement est consommé. Attribut posé seulement quand le réglage est
// décoché, pour que le cas par défaut ne laisse aucune trace dans le DOM.
function applyWideTables(enabled) {
  if (enabled === false) document.documentElement.setAttribute('data-wide-tables', 'off');
  else document.documentElement.removeAttribute('data-wide-tables');
}

// Persisté immédiatement (modèle selectTheme/selectMotion) et donc EXCLU de
// settingsFormDirty : le basculer ne doit pas armer « Enregistrer ».
function onToggleWideTables() {
  const on = $('set-wide-tables').checked;
  applyWideTables(on);
  saveSettings({ wideTables: on });
}

// Clic sur le libellé ou la description d'une .check-row : bascule
// l'interrupteur de la ligne. Le <label class="toggle"> natif ne couvre que la
// pastille — la colonne de texte est le reste de la ligne, et c'est elle qu'on
// vise naturellement. Délégation unique plutôt qu'un for= par ligne : les hints
// sont des <span> (imbriquer un label dans .label-col donnerait deux labels
// emboîtés), et la règle vaut alors pour toute .check-row à venir.
// Trois refus : ligne sans interrupteur (le sélecteur de raisonnement partage
// la structure), interrupteur désactivé (cf. .check-row.is-locked), et clic
// terminant une sélection de texte — lire une description longue en la
// surlignant ne doit pas la faire basculer.
function onCheckRowLabelClick(e) {
  const col = e.target.closest && e.target.closest('.check-row .label-col');
  if (!col) return;
  if (e.target.closest('a, button, input, select, textarea')) return;
  const sel = window.getSelection && window.getSelection();
  if (sel && !sel.isCollapsed && col.contains(sel.anchorNode)) return;
  const input = col.closest('.check-row').querySelector('.toggle input[type="checkbox"]');
  if (!input || input.disabled) return;
  input.checked = !input.checked;
  // `checked` posé par script n'émet rien : le change explicite réveille les
  // onchange inline (onToggleHighlight…) ET la délégation de dirty-tracking.
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function onToggleHighlight() {
  highlightEnabled = $('set-highlight').checked;
  rerenderCurrentThread();   // jamais renderThread nu : cf. lot T-1b (bulle vive)
}

// ── Bannière résumés (mode « proposer ») ────────────────────────────────────
let _bannerHandlers = null;
function showSummaryBanner(matches, handlers) {
  _bannerHandlers = handlers;
  const n = matches.length;
  $('summary-banner-text').textContent = n > 1
    ? n + ' conversations passées semblent liées.'
    : 'Une conversation passée semble liée.';
  const list = $('summary-banner-list');
  list.innerHTML = '';
  const now = Date.now();
  matches.forEach(function(m) {
    const li = document.createElement('li');
    li.className = 'summary-banner-item';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'sbi-title';
    titleSpan.textContent = m.title || '(sans titre)';
    li.appendChild(titleSpan);
    const dateStr = formatDateRelative(m.updatedAt || m.timestamp, now);
    if (dateStr) {
      const dateSpan = document.createElement('span');
      dateSpan.className = 'sbi-date';
      dateSpan.textContent = dateStr;
      li.appendChild(dateSpan);
    }
    list.appendChild(li);
  });
  $('summary-banner').classList.add('show');
  scrollBottom();
}
function hideSummaryBanner() {
  const b = $('summary-banner');
  if (b) b.classList.remove('show');
  _bannerHandlers = null;
}
function summaryBanner(action) {
  const h = _bannerHandlers;
  hideSummaryBanner();
  if (h && h[action]) h[action]();
}

// ── Bandeau multi-onglets (lot J : soft-lock / readonly) ────────────────────
// Informatif, non-bloquant. Le texte est piloté par l'appelant (main.js, selon
// l'état soft-lock/readonly) ; ici on ne fait qu'afficher/masquer + poser le
// libellé. Réutilise l'anatomie .banner (composer.css).
function setTabBanner(text) {
  const el = $('tab-banner');
  if (!el) return;
  const t = $('tab-banner-text');
  if (t) t.textContent = text || '';
  // Le bandeau est dans .composer-inner (en flux) : son apparition agrandit le
  // composer et rogne la hauteur de .messages par le bas. Si le lecteur suivait
  // le fil (au fond), le re-coller au fond pour que le dernier message ne passe
  // pas sous le composer agrandi. isAtBottom() est mesuré AVANT le reflow.
  const wasAtBottom = isAtBottom();
  const wasShown = el.classList.contains('show');
  el.classList.add('show');
  if (!wasShown && wasAtBottom) scrollBottom(true);
}
function clearTabBanner() {
  const el = $('tab-banner');
  if (el) el.classList.remove('show');
}

// Avis « compaction annulée » (revue du 2026-09-22) : un régénérer ou une
// édition qui remonte avant la dernière frontière de compaction la retire du
// thread, et le modèle reçoit de nouveau l'historique qu'elle écartait. Le
// geste est accepté, mais il doit se DIRE au moment où il a lieu — le
// séparateur qui disparaît du fil ne suffit pas, c'est précisément l'absence
// qu'il faudrait remarquer. Texte rédigé par le pur `compactionUndoneNotice`
// (utils.js).
//
// Même anatomie `.banner` et même logique de recollage au fond que
// `setTabBanner` (le bandeau vit dans le composer, en flux). Levé par sa croix,
// au changement de conversation, et par une nouvelle compaction.
function showCompactionUndoneBanner(text) {
  const el = $('compaction-undone-banner');
  if (!el) return;
  const t = $('compaction-undone-text');
  if (t) t.textContent = text || '';
  const wasAtBottom = isAtBottom();
  const wasShown = el.classList.contains('show');
  el.classList.add('show');
  if (!wasShown && wasAtBottom) scrollBottom(true);
}
function clearCompactionUndoneBanner() {
  const el = $('compaction-undone-banner');
  if (el) el.classList.remove('show');
}

// ── Drawer combiné Résumés / Souvenirs ─────────────────────────────────────
function openSummaryDrawer(tab) {
  switchMemoryTab(tab || 'summaries');
  $('summary-drawer').classList.add('show');
  $('summary-backdrop').classList.add('show');
}
function openMemoryDrawer() { openSummaryDrawer('memories'); }
function closeSummaryDrawer() {
  $('summary-drawer').classList.remove('show');
  $('summary-backdrop').classList.remove('show');
}

// ── Inspecteur de contexte (brief B) ────────────────────────────────────────
// Palette fixe par source, cohérente barre/table. L'ordre des segments n'est
// PAS décidé ici mais par buildContextManifest (utils.js), qui émet ses entrées
// dans l'ordre réel du payload — cette table n'est qu'un lookup.
const CTX_PALETTE = {
  identity_blurb: '#e0d45a', root_prompt: '#7c8cf8', tool_definitions: '#4fc3a1',
  intent_doctrine: '#f2a65a', skills_doctrine: '#f2c85a',
  codeblock_doctrine: '#e05ac9', user_prompt: '#e07a9e', context_date_model: '#9aa5b1',
  summaries: '#e0955a', skills_context: '#8bc98b', mcp_instructions: '#5ec9c0',
  memories_profile: '#c94a6e', space: '#6ab8e0',
  thread_history: '#4a90d9', thread_last_user: '#a8c9ef',
  attachment_images: '#d9974a',
};

// Explication au survol, par source — même forme de lookup que CTX_PALETTE
// juste au-dessus, et même contrat : une clé par `source` produite par
// buildContextManifest (utils.js), qui reste LA source de la liste.
//
// Texte STRICTEMENT DESCRIPTIF (registre choisi) : ce que contient le bloc,
// jamais un conseil d'allègement. Les leviers de réduction vivent dans le
// sujet `contexte` de help.md, à un seul endroit — les dupliquer ici les
// ferait diverger au premier réglage qui change.
//
// Ces libellés vivent côté RENDU, pas dans buildContextManifest : le manifeste
// est une mesure (chars/tokens), et y verser de la prose mettrait du texte
// d'affichage dans une structure que les tests purs assertent champ par champ.
//
// Impersonnel comme tout texte d'interface (le tutoiement est réservé à
// help.md) : « tes souvenirs » se dit ici « les souvenirs actifs ».
const CTX_EXPLAIN = {
  identity_blurb: 'Le bloc d\'identité : il indique au modèle quelle application il pilote et ce qu\'elle sait faire.',
  root_prompt: 'Les instructions de base du modèle : comment se servir des outils disponibles et des documents.',
  intent_doctrine: 'La consigne qui demande au modèle d\'annoncer son intention avant chaque appel d\'outil.',
  skills_doctrine: 'La consigne qui explique au modèle ce qu\'est une skill et quand en déclencher une.',
  codeblock_doctrine: 'La consigne de mise en forme des blocs de code dans les réponses.',
  user_prompt: 'Les instructions système saisies dans les Paramètres. La description de l\'Espace actif est comptée à part, avec le bloc Espace.',
  context_date_model: 'La date et l\'heure courantes, et le modèle utilisé.',
  memories_profile: 'Les souvenirs de portée générale, valables dans tous les Espaces.',
  // Seule entrée à plusieurs états : ce que le bloc dit de sa bibliothèque
  // dépend du réglage `libraryManifestInContext`, et disparaît si elle est vide
  // (cf. CTX_EXPLAIN_SPACE_VARIANTS et `contextExplainFor` juste en dessous).
  // La valeur ici est celle du cas bibliothèque vide, qui sert aussi de défaut
  // pour que le test d'alignement continue de lire une string.
  space: 'Tout ce qui décrit l\'Espace actif : sa description et les souvenirs qui lui sont rattachés.',
  summaries: 'Les résumés de conversations passées jugés pertinents pour ce message.',
  skills_context: 'La liste des skills à déclenchement automatique, avec leur description — pas leur contenu.',
  mcp_instructions: 'Les consignes d\'usage publiées par les serveurs MCP branchés, pour leurs propres outils.',
  tool_definitions: 'La description de chaque outil disponible et de ses paramètres, au format attendu par l\'API.',
  thread_history: 'Les messages précédents de la conversation — ceux de l\'utilisateur, ceux du modèle et les traces d\'appels d\'outils.',
  thread_last_user: 'Le dernier message envoyé, celui auquel le modèle répond.',
  attachment_images: 'Les images jointes encore envoyées en pleine résolution, comptées à part du texte.',
};

// Les états du bloc Espace, selon la forme de bibliothèque qu'il porte
// (`systemMessageParts().libraryForm`, lu et jamais reniflé sur le texte). Les
// deux formes sont EXCLUSIVES par construction et CO-LOCALISÉES : le bloc
// porte le cardinal, OU la liste complète, au même endroit. Le manifeste ne
// peut donc pas les distinguer par une entrée séparée, et son libellé reste
// court et fixe — c'est cette tooltip, seule, qui dit laquelle est là.
//
// Phrase ENTIÈRE par état, jamais un fragment recollé à la valeur de table :
// une substitution partielle redeviendrait muette au premier reword de
// CTX_EXPLAIN.space, sans que rien ne le signale.
const CTX_EXPLAIN_SPACE_VARIANTS = {
  manifest: 'Tout ce qui décrit l\'Espace actif : sa description, les souvenirs qui lui sont rattachés, et la liste complète des fichiers de sa bibliothèque — nom, type, taille et description, mais pas leur contenu.',
  note: 'Tout ce qui décrit l\'Espace actif : sa description, les souvenirs qui lui sont rattachés, et le nombre de fichiers de sa bibliothèque — la liste est servie au modèle à sa demande.',
};

// Explication affichée pour une source, résolue contre l'état courant.
// Pure : `libraryForm` est passé, pas lu — le seul appelant (le rendu du
// drawer) fait la lecture impure. Toute source sans variante, et tout état sans
// entrée dans la table des variantes, retombe sur la valeur de table : le
// contrat du test d'alignement (une string non vide par source produite) vaut
// donc dans tous les états.
function contextExplainFor(source, libraryForm) {
  if (source === 'space' && CTX_EXPLAIN_SPACE_VARIANTS[libraryForm]) {
    return CTX_EXPLAIN_SPACE_VARIANTS[libraryForm];
  }
  return CTX_EXPLAIN[source] || '';
}

// Manifeste effectif : dernier envoi réel s'il existe, sinon simulation
// à froid. Ne recalcule PAS depuis zéro à chaque appel du compteur : la
// simulation est bon marché (fonctions pures déjà utilisées à l'envoi), mais
// PAS de polling — appelée seulement aux points de l'audit (send, switch conv,
// save settings, switch Space).
function effectiveContextManifest() {
  return _lastContextManifest || computeContextManifestNow();
}

// Compteur compact du composer. Câblé aux points send-relevant (audit
// §5b), jamais à l'oninput du textarea (draft exclu v1).
function syncContextCounter() {
  const el = $('ctx-counter-label');
  if (!el) return;
  const m = effectiveContextManifest();
  const win = contextWindowFor(activeModel());
  // Pilule = photo du dernier envoi réel (lot Bbis) : sans `≈` quand
  // l'usage API a calibré le manifeste (m.real), avec `≈` sinon (estimé
  // chars/4 — simulation à froid TOUJOURS estimée, apiUsage y est null).
  let label = (m.real ? '' : '≈ ') + m.totalTokens + ' tok';
  const counter = $('ctx-counter');
  if (win) {
    const pct = Math.round((m.totalTokens / win) * 100);
    label += ' (' + pct + '%)';
    if (counter) {
      const ratio = m.totalTokens / win;
      counter.classList.toggle('ctx-counter-warn', ratio >= CONTEXT_WINDOW_WARN_RATIO && ratio < 1);
      counter.classList.toggle('ctx-counter-over', ratio >= 1);
    }
  } else if (counter) {
    counter.classList.remove('ctx-counter-warn', 'ctx-counter-over');
  }
  // Total provisoire (recalculé en cours de boucle d'outils, pas encore la
  // réponse finale) : marqueur visuel léger sur la pilule elle-même, pas
  // seulement dans le drawer — l'utilisateur doit voir que ça évolue sans
  // avoir à ouvrir l'inspecteur.
  if (counter) counter.classList.toggle('ctx-counter-midturn', !!_lastContextManifestMidTurn);
  el.textContent = label;

  // Liseré de cache sur la pilule elle-même : même donnée que la barre de
  // l'inspecteur (usageDerived), pour un aperçu sans ouvrir le drawer.
  const cacheEl = $('ctx-counter-cache');
  if (cacheEl) {
    const ud = usageDerived(m.apiUsage);
    if (ud.cachedTokens != null && ud.cachedRatio != null) {
      const pct = Math.max(0, Math.min(100, ud.cachedRatio * 100));
      cacheEl.style.width = pct + '%';
      cacheEl.title = ud.cachedTokens + ' tok servis par le cache (' + Math.round(pct) + '%)';
      cacheEl.hidden = false;
    } else {
      cacheEl.hidden = true;
    }
  }

  // Drawer déjà ouvert (ex. laissé ouvert pendant une boucle d'outils ou un
  // streaming) : le rafraîchir en même temps que la pilule, sinon son contenu
  // reste figé sur l'état au moment de l'ouverture jusqu'à une fermeture/
  // réouverture manuelle.
  const drawer = $('ctx-drawer');
  if (drawer && drawer.classList.contains('show')) renderContextInspector();

  // Glyphe de compaction sur la pilule : même point de synchro que le reste du
  // compteur, donc même cadence (points send-relevant, jamais de polling).
  syncCompactionHintGlyph(m, win);
}

// ── Affordance de compaction (lot AE, étape 3) ──────────────────────────────
// Le seuil de 50 % se signale sur la pilule par la FORME (un glyphe), jamais
// par la couleur : `ctx-counter-warn` (80 %) et `ctx-counter-over` (100 %)
// occupent déjà le registre chromatique, et les trois seuils ne disent pas la
// même chose. La couleur dit « limite technique », la forme dit « hygiène
// conseillée » — deux grammaires pour deux questions, cf. docs/compaction.md.
//
// Le glyphe est PUREMENT INDICATIF : le geste reste disponible en dessous du
// seuil (décision Julien), il n'est simplement pas mis en avant.
function syncCompactionHintGlyph(manifest, win) {
  const el = $('ctx-counter-compact');
  if (!el) return;
  // Sans fenêtre connue, aucun ratio calculable : pas de glyphe plutôt qu'un
  // signal arbitraire (même posture que le `%` du libellé, absent lui aussi).
  const ratio = win ? (manifest.totalTokens / win) : 0;
  const show = !!win && ratio >= CONTEXT_COMPACTION_HINT_RATIO;
  // `el.hidden = false` NE SUFFIT PAS ici : la cible est un <svg>, et `hidden`
  // est une propriété de HTMLElement, absente de SVGElement. L'affectation crée
  // donc une propriété JS sur l'objet SANS retirer l'attribut HTML, que
  // `[hidden] { display: none !important }` (base.css) continue d'honorer —
  // le glyphe reste invisible quel que soit le ratio, pendant que tout code qui
  // lit `el.hidden` répond « visible ». Écrire l'ATTRIBUT, pas la propriété.
  // (Mesuré : sur un <div> l'affectation retire bien l'attribut, sur un <svg>
  // elle le laisse — d'où un défaut qui ne se voit sur aucune autre surface.)
  if (show) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

// Synchro de l'affordance elle-même, dans le drawer. Appelée par
// `renderContextInspector` : le bouton vit dans le drawer, il n'a donc à être
// à jour qu'au moment où on le regarde.
//
// Le bouton n'est JAMAIS désactivé sur les bornes AE-7 : `compactCurrentConversation`
// porte les gardes au point de mutation, et un bouton grisé sans explication
// ferait chercher une panne là où il y a une attente. Il reste cliquable et le
// refus NOMME sa borne (même posture que les refus de spawn d'agent).
//
// L'ABSENCE DE MATIÈRE est le seul cas qui déroge, et pour la raison inverse :
// une borne AE-7 est une attente (ça va se lever tout seul, cliquer a du sens
// pour apprendre pourquoi), alors qu'une conversation trop courte ne changera
// pas tant que l'utilisateur n'aura pas parlé. Cliquer n'y apprend rien que le
// hint ne dise déjà, donc le grisé décrit l'état au lieu de cacher une panne.
// Le prédicat reste `hasCompactableSubstance`, jamais un second écrit ici.
// Bilan du dernier geste d'allègement, par affordance (`compact` / `evacuate`).
// VOLATIL et hors de tout objet persisté (souvenir `no-view-state-persisted`) :
// c'est un état de VUE, le résultat d'un clic, pas une propriété de la
// conversation.
//
// Il existe parce que le bilan est rendu APRÈS coup et que le geste re-rend le
// drawer dans la foulée : sans lui, `syncCompactionAffordance` reposerait le
// hint nominal et effacerait le chiffre dans le même tour. Réinitialisé à
// l'ouverture du drawer et au changement de conversation — un bilan est le
// compte rendu d'un geste qu'on vient de faire, pas un état de la conversation.
let _reclaimReports = {};
function setReclaimReport(key, text) { _reclaimReports[key] = text || ''; }
function clearReclaimReports() { _reclaimReports = {}; }

function syncCompactionAffordance() {
  const hint = $('ctx-compact-hint');
  const wrap = $('ctx-compact');
  const btn = $('ctx-compact-btn');
  if (!wrap || !hint) return;
  const m = effectiveContextManifest();
  const win = contextWindowFor(activeModel());
  const ratio = win ? (m.totalTokens / win) : 0;
  const salient = !!win && ratio >= CONTEXT_COMPACTION_HINT_RATIO;
  wrap.classList.toggle('is-salient', salient);
  // Cette synchro réécrit le hint : le refus qu'y avait posé
  // `runReclaimGesture` disparaît, sa couleur doit partir avec lui.
  wrap.classList.remove('is-refused');

  // Le hint explique ce que le geste FAIT, et dit que rien n'est perdu — la
  // crainte spontanée devant « compacter » est la suppression (cf. le libellé
  // du séparateur, même précaution).
  const substance = hasCompactableSubstance(currentThread);
  // Écrivain unique du grisé « pas de matière » (souvenir `concurrent-writers`).
  // `onCompactContext` pose lui aussi `disabled` — mais comme garde de
  // RÉENTRANCE pendant la rédaction, et son `finally` rend la main à cette
  // synchro en re-rendant le drawer : après une compaction réussie il n'y a
  // plus de matière, et c'est ici que le bouton se regrise.
  // Agent terminé : lecture seule DÉFINITIVE, donc un état stable — grisé comme
  // l'absence de matière, et pour la même raison (rien ne bougera ; les attentes
  // AE-7 et l'onglet voisin, elles, restent cliquables et leur refus les nomme).
  const finished = isFinishedAgentConv(currentConvId);   // main.js
  if (btn) btn.disabled = !substance || finished;
  // Le bilan d'un geste qu'on vient de faire PRIME sur le hint nominal : il
  // répond à « qu'est-ce que ça a donné ? », question plus pressante que « à
  // quoi ça sert ? » une fois le bouton cliqué. Il cède la place au prochain
  // rendu qui n'en porte pas (changement de conversation, réouverture).
  if (finished) {
    hint.textContent = 'Conversation d\'agent terminée : elle est en lecture seule.';
  } else if (_reclaimReports.compact) {
    hint.textContent = _reclaimReports.compact;
  } else if (!substance) {
    hint.textContent = 'Pas encore assez d\'historique pour que ce soit utile.';
  } else if (salient) {
    hint.textContent = 'Le contexte est assez chargé pour que le modèle commence ' +
      'à perdre le fil. Compacter remplace le début de la conversation par un ' +
      'résumé : les messages restent affichés ici, seul ce qui part au modèle change.';
  } else {
    hint.textContent = 'Remplace le début de la conversation par un résumé. ' +
      'Les messages restent affichés ici, seul ce qui part au modèle change.';
  }
}

// Corps COMMUN aux deux affordances d'allègement. Le refus comme le bilan sont
// rendus par le geste et affichés SOUS le bouton, dans le hint : même canal que
// le reste de l'affordance, et l'utilisateur lit la réponse là où il vient de
// cliquer.
//
// Factorisé plutôt que dupliqué : les deux gestes ont exactement la même
// mécanique d'appel (réentrance, libellé d'attente, refus, bilan, re-rendu) et
// ne diffèrent que par leurs ids, leur phrase d'attente et la fonction
// appelée. Deux copies divergeraient au premier ajustement de l'une.
async function runReclaimGesture(btnId, hintId, wrapId, pendingLabel, run) {
  const btn = $(btnId);
  const hint = $(hintId);
  const wrap = $(wrapId);
  // Garde de RÉENTRANCE, distincte du grisé d'absence de matière que pose
  // `syncCompactionAffordance` : un double-clic lancerait deux gestes
  // concurrents sur le même thread.
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  if (wrap) wrap.classList.remove('is-refused');
  if (hint) hint.textContent = pendingLabel;
  let out = null;
  try {
    out = await run();
  } finally {
    if (btn) btn.disabled = false;
  }
  if (out && out.refusal) {
    if (wrap) wrap.classList.add('is-refused');
    if (hint) hint.textContent = out.refusal;
    return;
  }
  // Le bilan n'est PAS posé ici : le geste lui-même l'a déjà fait, avant son
  // `syncContextCounter`. Un second poseur à cet endroit arriverait APRÈS ce
  // re-rendu et n'aurait aucun effet pour l'évacuation, tout en doublant celui
  // de la compaction — deux écrivains d'un même état, dont un mort (souvenir
  // `concurrent-writers`). Le re-rendu ci-dessous reste utile : il couvre le
  // cas du refus, où rien n'a été synchronisé.
  renderContextInspector();
}

async function onCompactContext() {
  await runReclaimGesture('ctx-compact-btn', 'ctx-compact-hint',
    'ctx-compact', 'Rédaction du résumé…', compactCurrentConversation);
}

async function onEvacuateToolResults() {
  await runReclaimGesture('ctx-evacuate-btn', 'ctx-evacuate-hint',
    'ctx-evacuate', 'Évacuation…', evacuateToolResults);
}

// Synchro de l'affordance d'évacuation. Écrivain UNIQUE de son grisé, même
// posture que sa voisine.
//
// Contrairement à la compaction, ce geste n'est jamais « saillant » : il ne
// répond pas à un seuil de remplissage mais à la présence de matière. Il se
// GRISE quand il n'y a rien à évacuer — état stable, que cliquer n'apprendrait
// pas mieux que le hint (les bornes AE-7, elles, restent cliquables : ce sont
// des attentes qui se lèvent seules).
function syncEvacuateAffordance() {
  const hint = $('ctx-evacuate-hint');
  const wrap = $('ctx-evacuate');
  const btn = $('ctx-evacuate-btn');
  if (!wrap || !hint) return;
  const found = evacuableToolResults(currentThread, TOOL_RESULT_EVACUATION_MIN_CHARS,
                                     isInlineHandleResult);
  const finished = isFinishedAgentConv(currentConvId);   // main.js — cf. syncCompactionAffordance
  if (btn) btn.disabled = !found.count || finished;
  wrap.classList.remove('is-refused');   // cf. syncCompactionAffordance
  if (finished) {
    hint.textContent = 'Conversation d\'agent terminée : elle est en lecture seule.';
  } else if (_reclaimReports.evacuate) {
    hint.textContent = _reclaimReports.evacuate;
  } else if (!found.count) {
    hint.textContent = 'Aucun résultat d\'outil assez volumineux à évacuer.';
  } else {
    // Le COMPTE se dit, le gain NON : il n'est honnêtement calculable qu'une
    // fois les descripteurs écrits (ils coûtent, et l'écart se verrait sur la
    // pilule juste après). Annoncer « ~N tok » ici puis en afficher moins
    // ferait mentir l'affordance — le bilan d'après-coup répond, lui, sur du
    // mesuré.
    // Formulé SANS deux-points, et ce n'est pas un détail de style : le hint
    // se replie sur deux lignes à la largeur du drawer, et la coupure tombait
    // juste avant le « : », qui se retrouvait orphelin en tête de ligne. Le
    // dépôt n'emploie aucune espace insécable (vérifié : zéro U+00A0 dans
    // ui.js), donc la corriger ici en introduirait une invisible à la
    // relecture et fragile au copier-coller. Reformuler coûte moins.
    //
    // Chaque branche porte ses DEUX phrases en entier. Le pluriel y dit « des
    // références » (une PAR résultat, là où « une référence » laisse imaginer
    // un regroupement), et c'est précisément ce qui interdit la queue commune
    // qu'on avait ici : elle reprenait par un pronom — « peut les rouvrir » —
    // un antécédent dont le nombre change avec la branche. Ce pronom reprend
    // LA RÉFÉRENCE et non le résultat (« peut la rouvrir »), ce qui se lit
    // mieux et reste vrai : c'est bien la référence que le modèle rouvre.
    hint.textContent = found.count + (found.count > 1
      ? ' résultats d\'outils volumineux peuvent être remplacés par des références.'
        + ' Rien n\'est perdu, le modèle peut les rouvrir à la demande.'
      : ' résultat d\'outil volumineux peut être remplacé par une référence.'
        + ' Rien n\'est perdu, le modèle peut la rouvrir à la demande.');
  }
}

function openContextInspector() {
  // Les bilans sont le compte rendu d'un clic, pas un état de la conversation :
  // rouvrir le drawer repart des hints nominaux.
  clearReclaimReports();
  renderContextInspector();
  $('ctx-drawer').classList.add('show');
  $('ctx-backdrop').classList.add('show');
}
function closeContextInspector() {
  $('ctx-drawer').classList.remove('show');
  $('ctx-backdrop').classList.remove('show');
}

// ── Fenêtre de contexte : libellés (lot AF) ─────────────────────────────────
// Purs (QuickJS). Vocabulaire : « réelle » pour une fenêtre mesurée sur le
// serveur, « théorique » pour une valeur annoncée ou saisie.
function formatTokenCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
}

function contextWindowSourceLabel(info, now) {
  switch (info && info.source) {
    case 'served-now': return 'réelle, mesurée sur le serveur pendant cette session';
    case 'configured': return 'fixée par la configuration du modèle sur le serveur (num_ctx), appliquée au chargement';
    case 'served-last': return 'réelle, dernière mesure sur le serveur (' + formatDateRelative(info.at, now) + ')';
    case 'user': return 'théorique, saisie pour ce modèle sur la fiche du serveur';
    case 'declared': return 'théorique, maximum déclaré par le serveur';
    case 'build': return 'théorique, valeur par défaut de l\'installation';
    default: return '';
  }
}

// Ligne de l'inspecteur : la valeur retenue ET d'où elle vient.
function formatContextWindowLine(info, now) {
  if (!info || !info.value) {
    return 'Fenêtre de contexte inconnue : le serveur ne la déclare pas pour ce modèle, ' +
      'et aucune valeur n\'est saisie sur la fiche du serveur.';
  }
  return 'Fenêtre de contexte : ' + formatTokenCount(info.value) + ' tokens — ' +
    contextWindowSourceLabel(info, now) + '.';
}

// Hint du champ de la carte serveur. `detected` : la chaîne résolue SANS saisie
// ni défaut de build (ce que le serveur dit de lui-même) ; `buildDefault` pour
// annoncer le repli. Dit ce que devient une saisie face à ce qui est connu —
// une mesure prime sur elle, un maximum déclaré lui cède.
function contextWindowCardHint(model, detected, buildDefault, now) {
  if (!model) return 'Choisir d\'abord un modèle : la fenêtre se règle par modèle.';
  const src = detected && detected.source;
  if (src === 'served-now' || src === 'configured' || src === 'served-last') {
    return 'Connue : ' + formatTokenCount(detected.value) + ' tokens (' +
      contextWindowSourceLabel(detected, now) + '). Elle prime sur une valeur saisie ici.';
  }
  if (src === 'declared') {
    return 'Déclarée par le serveur : ' + formatTokenCount(detected.value) + ' tokens (maximum du modèle). ' +
      'Une valeur saisie ici la remplace — utile si le serveur coupe plus bas.';
  }
  return 'Le serveur ne déclare pas cette fenêtre pour ce modèle. Une valeur saisie ici sert de repère : ' +
    'jauge de l\'inspecteur de contexte et seuil de compaction conseillée.' +
    (buildDefault > 0 ? ' Vide : ' + formatTokenCount(buildDefault) + ' tokens, valeur par défaut de l\'installation.' : '');
}

// Ligne des capacités (lot AF). `caps` tri-état tel que déclaré ; `vision`
// l'état résolu (resolveModelVision), pour nommer un « Sans vision » manuel.
// `tools: false` n'empêche rien : les outils partent quand même, et la ligne le
// dit plutôt que de laisser croire l'inverse.
function formatModelCapsLine(caps, vision) {
  const c = caps || {};
  const known = ['vision', 'tools', 'thinking'].some(k => c[k] === true || c[k] === false);
  const manual = vision && vision.source === 'manual'
    ? ' Marqué « Sans vision » sur la fiche du serveur : les images partent en descripteur textuel.' : '';
  if (!known) return 'Capacités du modèle : non déclarées par le serveur.' + manual;
  // Coche / croix pour un déclaré, mot en clair pour l'inconnu : un glyphe
  // de plus (« ? ») se lirait mal à côté des deux autres, et l'inconnu est
  // justement ce que la ligne doit nommer sans ambiguïté.
  const v = (x) => x === true ? '✓' : (x === false ? '✗' : 'inconnu');
  return 'Capacités déclarées par le serveur : lecture d\'images ' + v(c.vision) +
    ', outils ' + v(c.tools) + ', raisonnement ' + v(c.thinking) + '.' +
    (c.tools === false ? ' Les outils sont envoyés quand même.' : '') + manual;
}

function renderContextInspector() {
  const m = effectiveContextManifest();
  const winInfo = contextWindowInfo(activeModel());
  const win = winInfo.value;
  const scale = win || m.totalTokens || 1;

  const winHint = $('ctx-window-hint');
  if (winHint) winHint.textContent = formatContextWindowLine(winInfo, Date.now());
  const capsHint = $('ctx-caps-hint');
  if (capsHint) {
    const srv = activeApiServer(), mdl = activeModel();
    capsHint.textContent = formatModelCapsLine(modelPropsFor(srv, mdl).caps, modelVisionState(srv, mdl));
  }

  const ud = usageDerived(m.apiUsage);

  const hint = $('ctx-source-hint');
  if (hint) {
    if (_lastContextManifest && _lastContextManifestMidTurn) {
      hint.textContent = 'Échange en cours (outils) — total provisoire, va encore évoluer.';
    } else if (_lastContextManifest && m.real) {
      hint.textContent = 'Dernier envoi réel — tokens rapportés par l\'API.';
    } else if (_lastContextManifest) {
      hint.textContent = 'Dernier envoi réel — estimation (pas d\'info backend).';
    } else if (currentThread.length) {
      hint.textContent = 'Simulation du prochain envoi (aucun envoi depuis le rechargement de cette conversation).';
    } else {
      hint.textContent = 'Simulation du prochain envoi (aucun message dans cette conversation).';
    }
  }

  const bar = $('ctx-bar');
  if (bar) {
    bar.innerHTML = m.entries.map(e => {
      const pct = Math.max(0, Math.min(100, (e.tokens / scale) * 100));
      const color = CTX_PALETTE[e.source] || '#888';
      return `<span class="ctx-bar-seg" style="width:${pct}%;background:${color}" title="${escHtml(e.label)}"></span>`;
    }).join('');
  }

  // 2e barre, accolée : part de l'ENTRÉE servie par le cache (Bbis). Dessinée
  // sur la MÊME échelle que la barre 1 (campagne cache, axe 2) et non plus sur
  // une échelle interne : le 100 % de la barre 2 est le X % de la barre 1, donc
  // les deux se lisent l'une sous l'autre. C'est tout ce qu'on prétend dire —
  // AUCUN repère de « frontière théorique du cacheable » n'est dessiné : on ne
  // sait pas ce que le backend cache.
  //
  // ⚠ CETTE BARRE MESURE UNE QUANTITÉ, PAS UNE POSITION. Sa longueur ne dit
  // PAS « tout est caché jusqu'à l'entrée sous laquelle elle s'arrête » :
  // `cached_tokens` est aligné par le backend sur ses propres blocs internes,
  // qui ne tombent sur aucune frontière de bloc logique. Mesuré le 2026-09-14
  // (Ollama 0.34) : en faisant varier la longueur de la part modifiée,
  // `cached_tokens` reste FIGÉ sur un palier (4890 constant pendant que le
  // prompt passait de 5677 à 5701 tokens), et la valeur du palier dépend de
  // l'historique des requêtes, pas seulement du contenu. Lire l'abscisse où le
  // segment s'arrête et la reporter sur la liste est donc une sur-lecture —
  // l'écart attendu se chiffre en centaines de tokens. Ce qui reste solide est
  // CATÉGORIEL (servi / pas servi du tout), jamais la position exacte.
  //
  // `cachedTokens` est dans l'unité de l'API, comme les entrées une fois
  // calibrées par scaleManifestToUsage (m.real). Sans ce calibrage les entrées
  // restent en estimé chars/4 et les deux échelles ne sont pas comparables :
  // on masque plutôt que de superposer deux unités différentes. Absente aussi
  // sur les backends qui ne renvoient pas cached_tokens (ex. Ollama).
  const barCache = $('ctx-bar-cache');
  if (barCache) {
    if (ud.cachedTokens != null && m.real) {
      const pct = Math.max(0, Math.min(100, (ud.cachedTokens / scale) * 100));
      const share = ud.cachedRatio != null ? Math.round(ud.cachedRatio * 100) : null;
      // Libellé formulé en QUANTITÉ, jamais en frontière : « jusqu'à » ou
      // « s'arrête à » inviterait la lecture positionnelle que la mesure
      // ci-dessus invalide. La mention d'alignement est là pour désamorcer
      // l'écart que le lecteur constatera forcément en comparant à la liste.
      const title = `${ud.cachedTokens} tok servis par le cache` +
        (share != null ? ` (${share}% de l'entrée)` : '') +
        ' — quantité totale, pas une position dans la liste :' +
        ' le backend aligne sur ses propres blocs.';
      barCache.innerHTML = `<span class="ctx-bar-seg" style="width:${pct}%" title="${escHtml(title)}"></span>`;
      barCache.hidden = false;
    } else {
      barCache.innerHTML = '';
      barCache.hidden = true;
    }
  }

  const body = $('ctx-table-body');
  if (body) {
    // Lignes toujours `≈` (ventilation par bloc jamais mesurée par l'API,
    // même proratisée) ; seul le TOTAL perd le `≈` quand m.real (lot Bbis).
    // Forme de bibliothèque prise sur le MANIFESTE, jamais relue des réglages :
    // le manifeste est la photo du dernier envoi, et le réglage a pu changer
    // depuis — la tooltip décrirait alors un bloc que ces chiffres ne mesurent
    // pas.
    const libraryForm = m.libraryForm || '';
    const rows = m.entries.map(e => {
      const pct = m.totalTokens ? Math.round((e.tokens / m.totalTokens) * 100) : 0;
      const color = CTX_PALETTE[e.source] || '#888';
      const note = e.source === 'attachment_images' ? ' <span class="hint">(très approximatif)</span>' : '';
      // Explication au survol du libellé. `escHtml` bien que le texte soit une
      // constante littérale d'ici (aucune origine modèle, hors piège 21) : on
      // est en position d'ATTRIBUT, et ces phrases portent des apostrophes —
      // escHtml échappe `'` et `"`. Garder l'échappement inconditionnel pour
      // qu'un jour où cette valeur deviendrait dynamique, le point d'injection
      // ne soit pas déjà ouvert.
      const why = contextExplainFor(e.source, libraryForm);
      const titleAttr = why ? ` title="${escHtml(why)}"` : '';
      const labelCls = why ? ' class="ctx-label-explained"' : '';
      return `<tr><td><span class="ctx-swatch" style="background:${color}"></span>` +
        `<span${labelCls}${titleAttr}>${escHtml(e.label)}</span>${note}</td>` +
        `<td>${e.chars}</td><td>≈${e.tokens}</td><td>${pct}%</td></tr>`;
    });
    const totalTokLabel = (m.real ? '' : '≈') + m.totalTokens;
    rows.push(`<tr class="ctx-total"><td>Total</td><td>${m.totalChars}</td><td>${totalTokLabel}</td><td>100%</td></tr>`);
    // Sortie : ligne à part, HORS barres (l'entrée seule occupe le contexte).
    if (ud.outTokens != null) {
      rows.push(`<tr class="ctx-output"><td>Réponse (sortie)</td><td></td><td>${ud.outTokens}</td><td></td></tr>`);
    }
    body.innerHTML = rows.join('');
  }

  // Affordances d'allègement : rafraîchies avec le reste du drawer, dans
  // l'ordre où elles apparaissent (coût croissant).
  syncEvacuateAffordance();
  syncCompactionAffordance();
}

function switchMemoryTab(tab) {
  document.querySelectorAll('#summary-drawer .drawer-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const sp = $('summary-tab-panel');
  const mp = $('memory-tab-panel');
  if (sp) sp.classList.toggle('hidden', tab !== 'summaries');
  if (mp) mp.classList.toggle('hidden', tab !== 'memories');
  if (tab === 'summaries') renderSummaryList();
  else renderMemoryList();
}

// Scopée au Space actif (piège 18) : la liste raconte la MÊME histoire que
// l'injection, qui filtre déjà par `spaceConvIds` (searchSummaries, api.js).
// Afficher un résumé d'un autre Space ferait miroiter une entrée qui n'entrera
// jamais dans le contexte et dont la conversation n'est pas atteignable d'ici.
// Corollaire : le Space de chaque entrée n'a plus à être affiché (il est
// constant), et « Ouvrir » peut appeler `selectConv` sans `followSpace`.
function renderSummaryList() {
  const wrap = $('summary-list');
  wrap.innerHTML = '';
  const all = loadSummaries();
  const convs = loadConversations();
  const idsInSpace = spaceConvIds(activeSpaceId, convs);
  const ids = Object.keys(all).filter(id => idsInSpace.has(id));
  if (!ids.length) {
    wrap.innerHTML = '<div class="mem-empty">Aucun résumé pour l\'instant.</div>';
    return;
  }
  ids.sort((a, b) => (all[b].timestamp || 0) - (all[a].timestamp || 0));
  for (const id of ids) {
    const e = all[id];
    const item = document.createElement('div');
    item.dataset.id = id;
    const date = e.timestamp ? new Date(e.timestamp).toLocaleDateString('fr-FR') : '';
    if (e.suppressed) {
      item.className = 'mem-item suppressed';
      const sub = ['supprimé', date].filter(Boolean).join(' · ');
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-title">${escHtml(e.title || 'Souvenir supprimé')}</div>` +
        `<div class="mem-sub">${escHtml(sub)}</div></div>` +
        `<button class="drawer-btn" onclick="restoreSummaryItem('${id}')">Rétablir</button></div>`;
    } else {
      const full = e.summary || '';
      const extrait = full.slice(0, 150);
      const kws = Array.isArray(e.keywords) && e.keywords.length
        ? `<div class="mem-keywords"><strong>Mots-clefs</strong> — ${escHtml(e.keywords.join(', '))}</div>`
        : '';
      const sub = date;
      item.className = 'mem-item';
      item.onclick = () => toggleSummaryExpand(id);
      item.innerHTML =
        `<div class="mem-header">` +
        `<div class="mem-meta"><div class="mem-title">${escHtml(e.title || 'Nouvelle conversation')}</div>` +
        `<div class="mem-sub">${escHtml(sub)}</div></div>` +
        `<button class="drawer-btn" onclick="event.stopPropagation();openSummaryConv('${id}')">Ouvrir</button>` +
        `<button class="drawer-btn danger" onclick="event.stopPropagation();deleteSummaryItem('${id}')">Supprimer</button>` +
        `</div>` +
        `<div class="mem-excerpt">${escHtml(extrait)}${full.length > 150 ? '…' : ''}</div>` +
        `<div class="mem-full">${escHtml(full)}${kws}</div>`;
    }
    wrap.appendChild(item);
  }
}

function deleteSummaryItem(id) { suppressSummary(id); renderSummaryList(); }

// Ouvre la conversation d'un résumé depuis le drawer. La liste étant scopée au
// Space actif, la conversation y est par construction : pas de `followSpace`.
// Ne ferme AUCUN drawer (décision Julien) : ce drawer s'empile volontiers sur
// Paramètres (`_drawerStack`), donc n'en fermer qu'un déboucherait sur celui du
// dessous — le fil resterait masqué. C'est tout ou rien ; on choisit rien, et
// l'utilisateur ferme au backdrop ou à Escape quand il veut voir la conversation.
function openSummaryConv(id) {
  selectConv(id, true);
}

function toggleSummaryExpand(id) {
  const list = $('summary-list');
  const clicked = list.querySelector('.mem-item[data-id="' + id + '"]');
  if (!clicked) return;
  const wasExpanded = clicked.classList.contains('expanded');
  list.querySelectorAll('.mem-item.expanded').forEach(el => el.classList.remove('expanded'));
  if (!wasExpanded) clicked.classList.add('expanded');
}

// Ré-autorisation. Si le résumé est conservé sous la tombstone → retour
// instantané. Sinon, régénération avec loader inline sur l'item concerné.
async function restoreSummaryItem(id) {
  const entry = getSummaryEntry(id);
  if (entry && entry.summary) {        // état d'avant préservé : instantané
    restoreSummary(id);
    renderSummaryList();
    return;
  }

  // Réchauffage AVANT lecture (lot U-1) : une conversation évincée de l'étage 2
  // sort de loadConversation avec `messages: []`, donc sans substance — la
  // tombstone était levée sans rien régénérer, en silence. Même précaution
  // qu'openConversation, qui warm avant de projeter son thread.
  await warmConversation(id);
  const conv = loadConversation(id);
  if (!conv || !hasSubstance(conv.messages)) {   // rien à régénérer
    restoreSummary(id);
    renderSummaryList();
    return;
  }

  const item = $('summary-list').querySelector('.mem-item[data-id="' + id + '"]');
  if (item) setMemItemLoading(item, 'régénération…');

  const s = await runBackgroundTask('résumé…', () => generateSummary(conv.messages));
  if (s && loadConversation(id)) {   // supprimée pendant la génération : ne pas ressusciter l'entrée
    saveSummary(id, {
      title: conv.title, timestamp: conv.timestamp,
      summary: s.summary, keywords: s.keywords, messageCount: conv.messages.length,
    });
  } else if (s) {
    return;   // conversation disparue entre-temps : rien à afficher ni à sauvegarder
  } else {
    restoreSummary(id);   // échec : on lève la tombstone (candidate au backfill)
  }
  renderSummaryList();
}

// ── Panneau des outils ──────────────────────────────────────────────────────
function openTools() {
  renderToolsList();
  $('tools-drawer').classList.add('show');
  $('tools-backdrop').classList.add('show');
}
function closeTools() {
  $('tools-drawer').classList.remove('show');
  $('tools-backdrop').classList.remove('show');
}

// Sous-drawer « Voir les outils exposés » : groupé par namespace, nom NU
// affiché sous l'en-tête du préfixe. Projection pure du nom canonique — rien n'est
// stocké : groupByNamespace splitte sur le 1er `__`. ask_confirmation (hors
// registre mais déclaré au modèle) est ajouté sous le namespace miaou pour info.
function renderToolsList() {
  const wrap = $('tools-list');
  const list = exposedTools().concat([{
    name: ASK_CONFIRMATION_DEF.function.name,
    description: ASK_CONFIRMATION_DEF.function.description,
    inputSchema: ASK_CONFIRMATION_DEF.function.parameters,
  }]);
  // Ordre d'affichage en trois familles, pour ne PAS entrelacer l'interne et le
  // distant (sinon le tri alpha mêle `miaou › conv` et `mcp › brave`) :
  //   0. « miaou » nu (outils internes plats) — toujours en tête ;
  //   1. sous-namespaces internes `miaou__*` (memory, conv, resource…), alpha ;
  //   2. serveurs MCP distants (préfixe ≠ miaou), alpha.
  // Tri purement présentationnel : groupByNamespace reste en ordre d'apparition.
  const nsFamily = ns => ns === 'miaou' ? 0 : (ns.indexOf('miaou__') === 0 ? 1 : 2);
  const nsSortKey = ns => ns.split('__').filter(Boolean).join(' ');
  const groups = groupByNamespace(list).slice().sort(function(a, b) {
    const fa = nsFamily(a.namespace), fb = nsFamily(b.namespace);
    if (fa !== fb) return fa - fb;
    return nsSortKey(a.namespace).localeCompare(nsSortKey(b.namespace));
  });
  if (!groups.length) {
    wrap.innerHTML = '<div class="mem-empty">Aucun outil enregistré.</div>';
    return;
  }
  wrap.innerHTML = '';
  // Calculé UNE fois pour tous les groupes : `mcpInstructionSources` lit l'état
  // vivant des serveurs branchés, et le relire par groupe donnerait autant de
  // parcours pour un résultat identique.
  const instructionsByPrefix = mcpInstructionsByPrefix(mcpInstructionSources());
  const ICON_NS_CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  groups.forEach(function(g, i) {
    const group = document.createElement('div');
    group.className = 'tool-ns-group';

    const header = document.createElement('div');
    header.className = i === 0 ? 'tool-ns open' : 'tool-ns';

    const label = document.createElement('span');
    label.textContent = g.namespace.split('__').join(' › ');

    const chev = document.createElement('span');
    chev.className = i === 0 ? 'tool-ns-chevron open' : 'tool-ns-chevron';
    chev.innerHTML = ICON_NS_CHEVRON;

    header.appendChild(label);
    header.appendChild(chev);

    const body = document.createElement('div');
    body.className = i === 0 ? 'tool-ns-body open' : 'tool-ns-body';
    const bodyInner = document.createElement('div');
    bodyInner.className = 'tool-ns-body-inner';
    // Consigne de portée serveur publiée par le MCP (champ standard
    // `instructions` de l'InitializeResult), en tête de la section qu'elle
    // couvre. `mcpInstructionsByPrefix` (utils) est indexé par le préfixe
    // d'outil, qui EST le namespace du groupe : lookup direct, aucun nom
    // reconstruit ici. Même source que le bloc injecté au modèle, pour que
    // l'écran ne puisse pas en montrer une version divergente.
    const nsInstructions = instructionsByPrefix[g.namespace];
    if (nsInstructions) bodyInner.appendChild(buildToolNsInstructions(nsInstructions));
    // Tri alpha par nom nu, purement présentationnel (comme le tri des
    // namespaces ci-dessus) : groupByNamespace reste en ordre d'apparition.
    const sorted = g.tools.slice().sort((a, b) => a.bareName.localeCompare(b.bareName));
    for (const t of sorted) bodyInner.appendChild(buildToolItem(t.bareName, t.def));
    body.appendChild(bodyInner);

    header.addEventListener('click', function() {
      wrap.querySelectorAll('.tool-ns.open').forEach(function(h) {
        if (h === header) return;
        h.classList.remove('open');
        h.querySelector('.tool-ns-chevron').classList.remove('open');
        h.nextElementSibling.classList.remove('open');
      });
      const opening = !header.classList.contains('open');
      header.classList.toggle('open', opening);
      chev.classList.toggle('open', opening);
      body.classList.toggle('open', opening);
    });

    group.appendChild(header);
    group.appendChild(body);
    wrap.appendChild(group);
  });
}

// Consigne de portée serveur, en tête de sa section du drawer des outils.
//
// Le texte vient d'un SERVEUR DISTANT : il traverse `renderMd`, donc marked +
// DOMPurify, jamais une concaténation de chaînes. C'est le même chemin que le
// markdown du modèle, et pour la même raison — un serveur MCP branché n'est pas
// plus digne de confiance qu'un contenu rapporté par un outil (piège 21).
//
// `renderMd` et non `escHtml` : la demande est un rendu Markdown, et ces
// consignes en contiennent (titres, listes, gras). La contrepartie assumée est
// que le lien éventuel d'une consigne devient cliquable, comme dans le fil.
function buildToolNsInstructions(markdown) {
  const box = document.createElement('div');
  box.className = 'tool-ns-instructions';

  const label = document.createElement('div');
  label.className = 'tool-ns-instructions-label';
  label.textContent = 'Consignes du serveur MCP';
  box.appendChild(label);

  const body = document.createElement('div');
  body.className = 'tool-ns-instructions-body body';
  body.innerHTML = renderMd(markdown);
  box.appendChild(body);

  return box;
}

function buildToolItem(bareName, def) {
  const props = (def.inputSchema && def.inputSchema.properties) || {};
  const req = (def.inputSchema && def.inputSchema.required) || [];
  const paramNames = Object.keys(props);

  const item = document.createElement('div');
  item.className = 'tool-item';

  let paramsHtml = '';
  if (paramNames.length) {
    paramsHtml = '<div class="tool-params">' +
      paramNames.map(p => {
        const prop = props[p];
        const optional = !req.includes(p);
        return '<div class="tool-param">' +
          '<span class="tool-param-name">' + escHtml(p) + '</span>' +
          '<span class="tool-param-type">' + escHtml((prop.type || '') + (optional ? '?' : '')) + '</span>' +
          (prop.description ? '<span class="tool-param-desc">— ' + escHtml(prop.description) + '</span>' : '') +
          '</div>';
      }).join('') +
      '</div>';
  }

  const nameHtml = bareName.split('__').filter(Boolean)
    .map(escHtml).join('<span class="inline-sep">›</span>');
  item.innerHTML =
    '<div class="tool-name">' + nameHtml + '</div>' +
    '<div class="tool-desc">' + escHtml(def.description || '') + '</div>' +
    paramsHtml;
  return item;
}

// ── Spaces / « Espaces » (sélecteur sidebar + écran, lot C) ────────
// Sélecteur pilule + .model-menu générique (règle projet : jamais de <select>
// natif), pattern le plus proche du sélecteur de modèle composer. Chaque ligne
// bascule le Space actif au clic ; un petit bouton crayon ouvre l'écran Space
// (renommage, description, souvenirs, suppression) sans changer de Space.

// Libellé pilule + badge topbar (masqué en default Space) — à
// appeler après tout changement de Space actif ou de nom de Space.
function syncSpaceUI() {
  const space = getSpace(activeSpaceId) || { name: 'Général' };
  const label = $('space-select-label');
  if (label) label.textContent = space.name || 'Général';
  const badge = $('topbar-space-badge');
  if (badge) {
    badge.textContent = space.name || '';
    badge.hidden = activeSpaceId === DEFAULT_SPACE_ID;
  }
  syncActivityBadges();
  syncAgentCount();
}

// Applique un état de badge ('working' | 'unread' | null) sur un porteur. Un
// seul point d'écriture DOM pour les quatre surfaces (ligne de conversation,
// ligne d'Espace, sélecteur replié, hamburger) : l'apparence est entièrement
// portée par le CSS, ce qui garantit qu'aucune surface ne dérive.
function applyActivityBadge(el, state) {
  if (!el) return;
  el.classList.toggle('working', state === 'working');
  el.classList.toggle('unread', state === 'unread');
  el.hidden = !state;
}

// Crée le porteur de pastille. La classe .waiter-dot est REPRISE telle quelle
// (spec T-2) : ce n'est pas « le même genre de chose » que la pastille du
// patienteur, c'est littéralement le même objet, même sémantique (« ça
// travaille »), même token de couleur (--accent, qui suit palette ET thème sans
// un octet de configuration). Une métaphore = un usage.
function activityBadgeEl(state) {
  const dot = document.createElement('span');
  dot.className = 'waiter-dot activity-dot';
  applyActivityBadge(dot, state);
  return dot;
}

// Surfaces qui ne sont PAS reconstruites à chaque changement d'état (le
// sélecteur replié et le hamburger vivent en permanence dans le DOM) : elles
// ont besoin d'un point de synchronisation explicite.
//
// Il n'existe AUCUN événement à observer pour la visibilité de la sidebar
// (classe `sidebar-open` sur #app, posée par toggleSidebar/closeSidebarMobile/
// closeSidebarViaEscape) : la synchronisation est appelée depuis ces trois
// fonctions, jamais depuis un observateur de classe.
// Compteur d'agents en vol (lot T-2bis). Dérivé du REGISTRE, jamais de
// `sending` : ce dernier est un reflet d'écran depuis T-1 et bascule sur un
// simple changement de conversation (piège 28).
//
// La règle d'apparition vit dans resolveAgentCount (utils.js, pure et testée) :
// le compteur ne parle que quand il apprend quelque chose — une génération
// unique qu'on regarde arriver est déjà signalée par le composer en mode stop.
function syncAgentCount() {
  const el = $('agent-count');
  if (!el) return;
  // Deux questions distinctes — c'est le point de discipline du lot T-3
  // (decision Julien) :
  //  - SE MONTRER ? `resolveAgentCount`, dont la regle d'apparition (se taire
  //    quand on n'apprend rien) est inchangee depuis T-2bis ;
  //  - AFFICHER QUOI ? le nombre de LIGNES de l'inventaire, c'est-a-dire
  //    exactement ce que le popover va lister.
  // Les deux questions restent distinctes, mais elles lisent la MEME grandeur :
  // l'inventaire. La visibilite est partie du registre `_activeGenerations`, et
  // ce sous-compte se payait exactement dans le cas que le lot T-3 avait pourtant
  // nomme -- le parent inerte n'y a aucune entree, donc un agent au travail
  // donnait `total === 1`, et ouvrir le fil de cet agent (screenOwned) masquait
  // une pilule qui annoncait « 2 agents » depuis le parent. La garde `n === 1`
  // ne vaut que si la generation regardee est la SEULE chose a annoncer.
  const inv = liveAgentInventory();
  const visible = resolveAgentCount(agentInventoryCount(inv), isGenerating(currentConvId));
  el.hidden = !visible;
  const label = $('agent-count-label');
  if (label) label.textContent = formatAgentCountLabel(agentInventoryCount(inv));
  // Une pilule qui disparait pendant que son popover est ouvert emporte le
  // popover : sans ca il resterait affiche, ancre a un element masque.
  if (el.hidden) closeAgentMenu();
  else if (isAgentMenuOpen()) renderAgentMenu();
}

// ── Popover d'inventaire des agents (lot T-3) ───────────────────────────────
// Meme anatomie que #space-menu : ancre position:relative + .model-menu. Il
// herite ainsi de deux choses sans une ligne de code — la fermeture par Escape
// (`closeTopDropdownViaEscape`, qui balaie `.model-menu.show` AVANT les drawers)
// et l'animation d'ouverture. Le clic-dehors, lui, est cable au meme endroit que
// ses freres (le listener document plus haut).
function isAgentMenuOpen() {
  const m = $('agent-menu');
  return !!(m && m.classList.contains('show'));
}

function closeAgentMenu() {
  const m = $('agent-menu');
  if (m) m.classList.remove('show');
  const btn = $('agent-count');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleAgentMenu() {
  if (isAgentMenuOpen()) { closeAgentMenu(); return; }
  renderAgentMenu();
  const m = $('agent-menu');
  if (m) m.classList.add('show');
  const btn = $('agent-count');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

// Rendu de l'inventaire. `createElement` + `textContent` : les libelles sont des
// donnees utilisateur (titres de conversation) ET du texte de modele
// (agentIntent) — jamais d'innerHTML, doctrine projet.
//
// L'indentation d'un agent sous sa racine est portee par une classe (`.depth-1`),
// pas par un prefixe textuel comme dans la palette : ici on dispose d'une vraie
// mise en page, et l'indentation EST ce qui distingue une racine d'un agent.
function renderAgentMenu() {
  const m = $('agent-menu');
  if (!m) return;
  m.textContent = '';
  const rows = agentInventoryRows(liveAgentInventory());
  const spaceNames = new Map(loadSpaces().map(s => [s.id, s.name || '']));
  const active = getActiveSpaceId();
  if (!rows.length) {
    // Ne devrait pas s'afficher (la pilule est masquee quand rien ne tourne),
    // mais une liste vide sans un mot serait un popover casse a l'ecran.
    const empty = document.createElement('div');
    empty.className = 'agent-menu-empty';
    empty.textContent = 'Aucun agent au travail.';
    m.appendChild(empty);
    return;
  }
  rows.forEach(r => {
    // `.model-opt` porte deja le hover et le curseur du composant ; le handler
    // est pose sur la LIGNE entiere, padding compris — pose sur le seul libelle,
    // le padding serait une zone morte (project_model_opt_row_click_target).
    const row = document.createElement('div');
    row.className = 'model-opt agent-row depth-' + r.depth;
    const main = document.createElement('span');
    main.className = 'agent-row-main';
    const dot = document.createElement('span');
    // Pastille `working` pulsante, celle des badges d'activite : toute ligne de
    // l'inventaire travaille, directement ou par ses agents.
    dot.className = 'waiter-dot activity-dot working';
    main.appendChild(dot);
    const label = document.createElement('span');
    label.className = 'agent-row-label' + (r.provisional ? ' provisional' : '');
    label.textContent = r.label;
    main.appendChild(label);
    row.appendChild(main);
    const meta = document.createElement('span');
    meta.className = 'agent-row-meta';
    // Espace annote seulement s'il n'est pas l'actif — meme regle que la palette.
    const space = r.conv.spaceId === active ? '' : (spaceNames.get(r.conv.spaceId) || 'Autre espace');
    meta.textContent = space ? (r.status + ' · ' + space) : r.status;
    row.appendChild(meta);
    // Fermeture au clic (decision Julien) : le popover masque le fil qu'on vient
    // ouvrir, et il se rouvre d'un geste.
    row.addEventListener('click', () => { closeAgentMenu(); gotoAgentInventoryRow(r.conv); });
    m.appendChild(row);
  });
}

function syncActivityBadges() {
  // Sélecteur d'espaces replié : « y a-t-il de l'activité AILLEURS ? » — d'où
  // l'exclusion de l'Espace actif. Le corollaire à ne pas rater est que cette
  // pastille n'est PAS un porteur privilégié de l'Espace courant : au dépliage,
  // elle ne reste à côté de son libellé que s'il a lui-même du working/unread.
  const trigger = $('space-select-btn');
  if (trigger) {
    let dot = trigger.querySelector('.activity-dot');
    // Insérée AVANT le chevron, pas appendée : le chevron ferme la ligne, une
    // pastille après lui se lirait comme un second contrôle.
    if (!dot) { dot = activityBadgeEl(null); trigger.insertBefore(dot, trigger.querySelector('.chev')); }
    applyActivityBadge(dot, aggregateBadgeState(activeSpaceId));
  }
  // Hamburger : agrège tous les ESPACES, l'actif compris, mais PAS la
  // conversation affichée ni ses agents. Seul indicateur disponible sidebar
  // repliée — il dit « il y a quelque chose à voir là-dedans », et ce que
  // l'utilisateur a déjà sous les yeux n'est pas « là-dedans » : il n'a pas à
  // ouvrir la sidebar pour voir travailler la conversation qu'il regarde
  // (composer en mode stop, bulle qui se remplit, pilule « n agents »).
  // Sidebar OUVERTE, il s'efface : l'information est alors lisible
  // à sa source (liste de gauche, sélecteur), la redonder au point d'entrée
  // ferait clignoter deux objets pour un seul fait.
  //
  // Ce masquage est porté par le CSS (`.app.sidebar-open` — même mécanique que
  // .topbar-brand et .topbar-space-badge, déjà conditionnés à l'état replié),
  // PAS par un test JS : sans quoi il faudrait rappeler cette fonction depuis
  // toggleSidebar/closeSidebarMobile/closeSidebarViaEscape, alors qu'aucun
  // événement n'existe pour l'observer. Laisser la cascade s'en charger supprime
  // le besoin de ces trois câblages.
  const burger = $('sidebar-toggle');
  if (burger) {
    let dot = burger.querySelector('.activity-dot');
    if (!dot) { dot = activityBadgeEl(null); burger.appendChild(dot); }
    applyActivityBadge(dot, aggregateBadgeState(null, currentConvId));
  }
}

// ── Onglets sidebar « Conversations / Fichiers / Souvenirs » (remplace le
//    drawer Space pour la gestion fichiers/souvenirs) ────────────────────────
// Une seule zone visible à la fois (swap complet, pas 3 zones scroll
// indépendantes). Conversations reste seul à porter la recherche et le
// mode déplacement — changer d'onglet en sort proprement (symétrique au
// changement de Space, cf. pickSpace).
let _spaceTab = 'conversations';

function selectSpaceTab(tab) {
  if (tab !== 'conversations') exitMoveModeIfActive();
  _spaceTab = tab;
  $('space-tab-conversations').classList.toggle('active', tab === 'conversations');
  $('space-tab-files').classList.toggle('active', tab === 'files');
  $('space-tab-memories').classList.toggle('active', tab === 'memories');
  $('sidebar-search').hidden = tab !== 'conversations';
  $('conv-list').hidden = tab !== 'conversations';
  $('space-files-panel').hidden = tab !== 'files';
  $('space-memories-panel').hidden = tab !== 'memories';
  if (tab === 'files') { clearSpaceFilesError(); renderSpaceFilesList(activeSpaceId); }
  else if (tab === 'memories') renderMemoryList('space-memory-list', activeSpaceId);
}

// Force le retour sur Conversations : appelé au switch/reset de Space, pour
// ne pas laisser l'utilisateur face à la bibliothèque d'un Space qu'il vient
// de quitter (spec Julien, 2026-07-08).
function resetSpaceTab() {
  selectSpaceTab('conversations');
}

function toggleSpaceMenu() {
  const menu = $('space-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  renderSpaceMenu();
  fitSpaceMenuHeight();
  menu.classList.add('show');
}

// Plafond de hauteur posé à CHAQUE ouverture, jamais une fois pour toutes : la
// place sous le bouton dépend de la hauteur du viewport, qui bouge (fenêtre
// redimensionnée, clavier mobile). Mesure prise sur le BOUTON, pas sur le menu
// — le menu est encore invisible (visibility: hidden) et surtout on veut la
// place disponible SOUS l'ancre, indépendamment du contenu déjà rendu.
function fitSpaceMenuHeight() {
  const menu = $('space-menu');
  const btn = $('space-select-btn');
  if (!menu || !btn) return;
  const vh = window.innerHeight || 0;
  const h = spaceMenuMaxHeight(btn.getBoundingClientRect().bottom, vh);
  // 0 = mesure inexploitable : on retire toute surcharge et on laisse le
  // plafond CSS de base reprendre la main plutôt que de poser une valeur fausse.
  menu.style.maxHeight = h ? h + 'px' : '';
}

function renderSpaceMenu() {
  const menu = $('space-menu');
  if (!menu) return;
  menu.innerHTML = '';
  const spaces = sortedSpacesByName(loadSpaces());
  for (const s of spaces) {
    const opt = document.createElement('div');
    opt.className = 'model-opt' + (s.id === activeSpaceId ? ' selected' : '');
    opt.innerHTML =
      `<span class="space-opt-name">${escHtml(s.name || '')}</span>` +
      `<button type="button" class="space-opt-edit" title="Modifier l'espace">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>` +
      `<span class="check">✓</span>`;
    // Pastille par ligne d'Espace : la RÈGLE EST UNIQUE — chaque Espace
    // effectivement concerné la porte. « Déplacement » et « dédoublement » ne
    // sont pas deux traitements au choix mais les deux apparences de cette même
    // règle selon le nombre d'Espaces concernés.
    opt.insertBefore(activityBadgeEl(spaceBadgeState(s.id)),
                     opt.querySelector('.space-opt-edit'));
    // Toute la ligne cliquable (pas seulement le texte/check) : le padding de
    // .model-opt n'est couvert par aucun enfant, un clic dessus ne déclenchait
    // rien avant ce correctif (Julien, 2026-07-08 — « il faut cliquer 2 fois »).
    opt.onmousedown = (ev) => {
      if (ev.target.closest('.space-opt-edit')) return;
      ev.preventDefault();
      pickSpace(s.id);
    };
    opt.querySelector('.space-opt-edit').onmousedown = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      menu.classList.remove('show');
      openSpaceScreen(s.id);
    };
    menu.appendChild(opt);
  }
  const newOpt = document.createElement('div');
  newOpt.className = 'model-opt space-new';
  newOpt.innerHTML =
    '<svg class="space-move-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
    '<span>Nouvel espace</span>';
  newOpt.onmousedown = (ev) => { ev.preventDefault(); menu.classList.remove('show'); createSpaceAndOpen(); };
  menu.appendChild(newOpt);

  // Déclencheur du mode déplacement (brief Cter) : masqué sans destination
  // possible (un seul Space = rien à déplacer vers) ou sans rien à déplacer
  // (Space actif vide — spec Julien, 2026-07-09). Après « + Nouvel espace »
  // (décision Julien, 2026-07-07), pour ne pas perturber le geste de création.
  if (spaces.length >= 2 && spaceConvIds(activeSpaceId, loadConversations()).size > 0) {
    const moveOpt = document.createElement('div');
    moveOpt.className = 'model-opt space-move-trigger';
    moveOpt.innerHTML =
      '<svg class="space-move-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 7l5 5-5 5"/></svg>' +
      '<span>Déplacer des conversations…</span>';
    moveOpt.onmousedown = (ev) => { ev.preventDefault(); menu.classList.remove('show'); enterMoveMode(); };
    menu.appendChild(moveOpt);
  }
}

// Bascule le Space actif : la conversation ouverte appartient à l'ancien Space
// (structurellement obligatoire, cf. docs/spaces.md) — résumé de sortie avant
// de vider le fil, comme newConversation/selectConv.
function pickSpace(id) {
  if (id === activeSpaceId) { $('space-menu').classList.remove('show'); return; }
  // Changer de Space actif pendant une sélection en cours vide la sélection
  // (décision Cter, 2026-07-07) : sortir du mode est le geste le plus sûr,
  // symétrique à la sortie du mode sélection (changer d'intention met fin au mode sélection).
  exitMoveModeIfActive();
  const leaving = currentConvId;
  activeSpaceId = id;
  setActiveSpaceId(id);
  // Fire-and-forget (résolution après resetToEmpty) : rafraîchit la pilule une fois
  // la bibliothèque du nouveau Space chargée, même écart que dans init() (main.js).
  loadSpaceLibrary(id).then(() => {
    _lastContextManifest = null;
    syncContextCounter();
  });
  // Armé AVANT resetToEmpty : c'est lui qui appelle renderConvList sur ce
  // chemin (pas d'appel direct ici), et c'est ce render-là qu'on veut animer.
  animateNextConvList();
  resetToEmpty();
  syncSpaceUI();
  resetSpaceTab();
  $('space-menu').classList.remove('show');
  summarizeIfNeeded(leaving);
  armIdleSummaryTimer();
  if (isMobileLayout()) closeSidebarMobile();
}

// Variante de pickSpace pour le « follow » post-déplacement (brief Cter) :
// bascule la vue vers le Space destination SANS vider le fil affiché — utilisée
// uniquement quand la conversation ouverte fait partie du lot déplacé (sinon
// aucun follow n'a lieu, cf. audit §3). Pas de summarizeIfNeeded(leaving) : on
// ne quitte aucune conversation, on la suit dans son nouveau Space.
function followSpace(id) {
  activeSpaceId = id;
  setActiveSpaceId(id);
  loadSpaceLibrary(id).then(() => {
    _lastContextManifest = null;
    syncContextCounter();
  });
  syncSpaceUI();
  resetSpaceTab();
  animateNextConvList();
  renderConvList();
  _lastContextManifest = null;   // la conv suivie change de Space : contexte affiché périmé (piège 16/18)
  syncContextCounter();
  armIdleSummaryTimer();
}

// Crée le Space, bascule dessus immédiatement (sinon l'utilisateur reste dans
// l'ancien Space en éditant à l'aveugle celui qu'il vient de créer), puis
// ouvre son écran avec le nom pré-sélectionné (focus + select) pour que la
// première frappe remplace directement le nom générique.
// Le Space est persisté AVANT l'ouverture de l'écran (pickSpace exige un Space
// existant) : abandonner l'écran sans enregistrer laisserait donc un « Nouvel
// espace » fantôme. `_spaceDraftId` marque ce Space comme provisoire ; il est
// consommé par onSaveSpaceScreen (premier enregistrement = le Space devient
// réel) et honoré par closeSpaceScreen (sortie sans save = rollback). Ne PAS
// remplacer ce mécanisme par un report du upsertSpace après saisie : la bascule
// immédiate est une spec (éditer le Space courant, pas à l'aveugle depuis
// l'ancien).
let _spaceDraftId = null;

function createSpaceAndOpen() {
  const id = genSpaceId();
  const previous = activeSpaceId;
  upsertSpace({ id, name: 'Nouvel espace' });
  _spaceDraftId = id;
  _spaceDraftPrevSpaceId = previous;
  pickSpace(id);
  openSpaceScreen(id);
  const nameInput = $('space-name-input');
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}

// Space actif au moment de la création — cible du retour si le brouillon est
// abandonné (ne jamais retomber sur DEFAULT_SPACE_ID en dur : l'utilisateur
// serait déplacé hors du Space d'où il vient).
let _spaceDraftPrevSpaceId = null;

// Annule un brouillon de Space jamais enregistré : suppression sèche (aucune
// cascade — un Space créé il y a quelques secondes n'a ni conversation, ni
// souvenir, ni fichier) puis retour au Space d'origine. No-op si le Space
// courant n'est pas un brouillon.
function discardSpaceDraftIfAny() {
  const id = _spaceDraftId;
  if (!id) return;
  _spaceDraftId = null;
  const back = _spaceDraftPrevSpaceId || DEFAULT_SPACE_ID;
  _spaceDraftPrevSpaceId = null;
  deleteSpaceEntry(id);
  if (activeSpaceId === id) pickSpace(getSpace(back) ? back : DEFAULT_SPACE_ID);
  renderSpaceMenu();
  syncSpaceUI();
}

// ── Écran Space (sous-drawer, pattern MCP) ───────────────────────────────────
let _spaceScreenId = null;

function openSpaceScreen(id) {
  const space = getSpace(id);
  if (!space) return;
  _spaceScreenId = id;
  $('space-drawer-title').textContent = space.name || 'Espace';
  $('space-name-input').value = space.name || '';
  $('space-description-input').value = space.description || '';
  $('space-save-btn').disabled = true;
  $('space-err').setAttribute('hidden', '');
  const isDefault = id === DEFAULT_SPACE_ID;
  $('space-name-input').disabled = isDefault;
  $('space-delete-btn').hidden = isDefault;
  $('space-delete-title').hidden = isDefault;
  if (!isDefault) syncSpaceDeleteLabel(id);
  $('space-drawer').classList.add('show');
  $('space-backdrop').classList.add('show');
}

// Point de sortie UNIQUE de l'écran (croix, backdrop, Escape via trackDrawer) :
// le rollback du brouillon s'y greffe une seule fois, pas sur chaque câblage.
// onSaveSpaceScreen consomme _spaceDraftId avant d'appeler ici, donc un
// enregistrement ne déclenche jamais la suppression.
function closeSpaceScreen() {
  $('space-drawer').classList.remove('show');
  $('space-backdrop').classList.remove('show');
  _spaceScreenId = null;
  discardSpaceDraftIfAny();
}

function onSpaceFormInput() {
  $('space-save-btn').disabled = false;
  $('space-err').setAttribute('hidden', '');
}

function onSaveSpaceScreen() {
  if (!_spaceScreenId) return;
  const space = getSpace(_spaceScreenId);
  if (!space) return;
  const name = $('space-name-input').value.trim();
  if (_spaceScreenId !== DEFAULT_SPACE_ID && !name) {
    $('space-err').textContent = 'Le nom ne peut pas être vide.';
    $('space-err').removeAttribute('hidden');
    return;
  }
  // Enregistrement réussi : le brouillon devient un Space réel. Consommé AVANT
  // closeSpaceScreen (qui rollbacke tout brouillon encore marqué).
  if (_spaceDraftId === _spaceScreenId) { _spaceDraftId = null; _spaceDraftPrevSpaceId = null; }
  upsertSpace(Object.assign({}, space, {
    name: _spaceScreenId === DEFAULT_SPACE_ID ? (space.name || 'Général') : name,
    description: $('space-description-input').value,
  }));
  renderSpaceMenu();
  syncSpaceUI();
  closeSpaceScreen();
}

// Libellé du bouton de suppression AVEC comptes (piège 18 : passe par
// spaceConvIds, jamais un filtre c.spaceId réécrit localement). Async (lot
// Cbis) : le compte fichiers vient d'IDB (getResourcesBySpace).
async function spaceDeleteLabel(id) {
  const convCount = spaceConvIds(id, loadConversations()).size;
  const memCount = loadMemories().filter(m => (m.scope || DEFAULT_SPACE_ID) === id && !m.suppressed).length;
  const fileCount = (await getResourcesBySpace(id)).length;
  return `Supprimer (${convCount} conv., ${memCount} souvenir${memCount > 1 ? 's' : ''}, ${fileCount} fichier${fileCount > 1 ? 's' : ''})`;
}

// Libellé du bouton de suppression, posé dès l'ouverture de l'écran (pas
// seulement recalculé au clic) : l'utilisateur doit voir l'impact avant même
// d'armer le bouton, pas seulement lire « Supprimer cet espace ». La première
// peinture peut afficher un compte fichiers en retard d'un tick, comme le
// reste du cache session library (cf. piège 18/CLAUDE.md).
async function syncSpaceDeleteLabel(id) {
  const btn = $('space-delete-btn');
  if (!btn) return;
  btn.textContent = await spaceDeleteLabel(id);
}

// Suppression d'un Space : arm-then-run (même pattern que la poubelle sidebar),
// cascade = boucle deleteConv sur les conversations du Space + purge des
// souvenirs scopés + purge des fichiers de bibliothèque (lot Cbis) ; les
// souvenirs profile restent intacts. Le default Space n'a pas de bouton
// (masqué dans openSpaceScreen) — rien à protéger ici.
async function onDeleteSpaceScreen() {
  const btn = $('space-delete-btn');
  if (!_spaceScreenId || _spaceScreenId === DEFAULT_SPACE_ID) return;
  const id = _spaceScreenId;
  const label = await spaceDeleteLabel(id);
  armThenRun(btn, async () => {
    const wasActive = id === activeSpaceId;
    for (const convId of spaceConvIds(id, loadConversations())) {
      deleteConv(convId);
    }
    for (const m of loadMemories().filter(m => (m.scope || DEFAULT_SPACE_ID) === id)) {
      forgetMemory(m.id);
    }
    for (const f of await getResourcesBySpace(id)) {
      await deleteResource(f.id);
    }
    deleteSpaceEntry(id);
    // Suppression explicite d'un Space encore à l'état de brouillon (créé puis
    // supprimé sans passer par Enregistrer) : désarmer le drapeau, sinon le
    // closeSpaceScreen ci-dessous rejouerait un rollback sur un id déjà supprimé.
    if (_spaceDraftId === id) { _spaceDraftId = null; _spaceDraftPrevSpaceId = null; }
    closeSpaceScreen();
    if (wasActive) {
      activeSpaceId = DEFAULT_SPACE_ID;
      setActiveSpaceId(DEFAULT_SPACE_ID);
      resetToEmpty();
      syncSpaceUI();
    }
    renderSpaceMenu();
  }, label);
}

// ── Sous-drawer « Serveurs MCP » (cartes éditables) ───────────────────
function openMcpServers() {
  renderMcpServers();
  $('mcp-drawer').classList.add('show');
  $('mcp-backdrop').classList.add('show');
}
function closeMcpServers() {
  $('mcp-drawer').classList.remove('show');
  $('mcp-backdrop').classList.remove('show');
}
// Drawer « Serveurs API » ouvert ? (bascule du serveur actif depuis le sélecteur
// composer : la carte « Actif » doit suivre si le drawer est visible.)
function renderApiServersIfOpen() {
  if ($('api-drawer') && $('api-drawer').classList.contains('show')) renderApiServers();
}

// Pastille de topbar « des serveurs attendent une autorisation ».
//
// Le prédicat d'apparition ET le libellé viennent d'une fonction pure et testée
// (`resolveAuthorizationPending`), cette fonction ne fait qu'appliquer — même
// séparation que `syncAgentCount`/`resolveAgentCount`.
//
// Appelée depuis les DEUX fonctions de rendu des cartes MCP plutôt que depuis
// chacun des points qui mutent l'état (connexion, déconnexion, sauvegarde,
// suppression, toggle, boot, revérification au focus). Ces points sont nombreux
// et convergent tous vers un rendu : s'y accrocher est un point de passage
// obligé, alors qu'en câbler sept laisserait le huitième mentir en silence.
function syncAuthorizationPending() {
  const el = $('auth-pending');
  if (!el) return;
  const pending = resolveAuthorizationPending(mcpStatusSnapshot());
  el.hidden = !pending.visible;
  // Sévérité posée en classe, jamais en style inline : c'est le CSS qui décide
  // de quelle couleur est « injoignable ». Les deux classes sont retirées puis
  // celle qui vaut est remise — sans le retrait, une pastille passée d'erreur à
  // attente resterait rouge (le cas exact qu'on veut voir se produire quand
  // l'erreur est réparée et que l'attente d'autorisation réapparaît).
  el.classList.remove('is-error', 'is-pending');
  if (pending.severity === 'error') el.classList.add('is-error');
  else if (pending.severity === 'pending') el.classList.add('is-pending');
  el.title = pending.severity === 'error'
    ? 'Ouvrir les serveurs MCP — vérifier les serveurs injoignables'
    : 'Ouvrir les serveurs MCP';
  const label = $('auth-pending-label');
  if (label) label.textContent = pending.label;
  syncWorriedLogo();
  syncHealthToasts();
}

function renderMcpServersIfOpen() {
  // La pastille se synchronise INCONDITIONNELLEMENT, contrairement aux cartes :
  // elle vit en topbar, hors du drawer, et n'a aucune raison d'attendre qu'on
  // l'ouvre. C'est même son intérêt — signaler sans qu'on soit allé voir. D'où
  // cet appel ici EN PLUS de celui de `renderMcpServers` : le drawer fermé,
  // celle-ci ne tourne pas, et le boot passe précisément par là.
  syncAuthorizationPending();
  if ($('mcp-drawer') && $('mcp-drawer').classList.contains('show')) renderMcpServers();
}

// Drawer skills ouvert ? (synchro multi-onglets, lot J : re-render du drawer sur
// réception `skills-updated` seulement s'il est visible.)
function isSkillsDrawerOpen() {
  const el = $('skills-drawer');
  return !!(el && el.classList.contains('show'));
}

function renderMcpServers() {
  // Ici et pas seulement dans `renderMcpServersIfOpen` : six sites appellent
  // celle-ci directement (sauvegarde, suppression, toggle, ouverture du
  // drawer, rehydratation multi-onglets), et n'accrocher que l'autre en
  // laisserait la moitié sans mise à jour.
  syncAuthorizationPending();
  const wrap = $('mcp-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const servers = loadMcpServers();
  if (!servers.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun serveur MCP. Ajouter un backend pour déléguer des appels d\'outils.';
    wrap.appendChild(empty);
  } else {
    for (const s of servers) wrap.appendChild(buildMcpCard(s, false));
  }
}

// Ajoute une carte vierge (nouveau serveur) en tête de liste, transport deviné
// au fil de la saisie d'URL (pré-remplissage, jamais override).
function addMcpServerCard() {
  const wrap = $('mcp-list');
  if (!wrap) return;
  const empty = wrap.querySelector('.mem-empty');
  if (empty) empty.remove();
  wrap.insertBefore(buildMcpCard({
    name: '', url: '', transport: '', enabled: true,
    authorization_token: '', timeout_s: MCP_DEFAULT_TIMEOUT_S, toolAllowlist: [], toolDenylist: [],
  }, true), wrap.firstChild);
}

// ── Helpers partagés des cartes de configuration (MCP / API / skills) ────────
// Les trois familles de cartes partagent la même anatomie : champs labellisés
// (.cfg-field), zone d'erreur (.cfg-err), toggles (.toggle dans une .cfg-toggle-row).
// Un seul jeu de constructeurs — les classes DIFFÉRENCIANTES (inputs lus par les
// handlers de sauvegarde : .mcp-name, .api-url, .skill-slug…) restent par carte.

function showCardError(cardEl, msg) {
  const el = cardEl.querySelector('.cfg-err');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}

function cfgField(labelText, inputEl, hintText) {
  const field = document.createElement('div');
  field.className = 'cfg-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  field.appendChild(label);
  field.appendChild(inputEl);
  if (hintText) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = hintText;
    field.appendChild(hint);
  }
  return field;
}

// Composant .toggle (input caché + track + thumb). Retourne { root, input }.
function cfgToggle(inputClass, checked) {
  const root = document.createElement('label');
  root.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = inputClass;
  input.checked = checked;
  const track = document.createElement('span'); track.className = 'track';
  const thumb = document.createElement('span'); thumb.className = 'thumb';
  root.append(input, track, thumb);
  return { root, input };
}

// Rangée « toggle + libellé » (.cfg-toggle-row). Retourne { row, input }.
function cfgToggleRow(inputClass, checked, labelText) {
  const row = document.createElement('label');
  row.className = 'cfg-toggle-row';
  const t = cfgToggle(inputClass, checked);
  row.appendChild(t.root);
  const txt = document.createElement('span');
  txt.textContent = labelText;
  row.appendChild(txt);
  return { row, input: t.input };
}

// Zone d'erreur d'une carte, masquée par défaut (révélée par showCardError).
function cfgErrEl() {
  const err = document.createElement('div');
  err.className = 'cfg-err';
  err.setAttribute('hidden', '');
  return err;
}

// Dropdown pilule pour les formulaires (règle projet : JAMAIS de <select>
// natif — réutiliser le composant .model-menu). Même anatomie que le sélecteur
// de raisonnement des réglages : bouton pilule + menu absolu + valeur portée
// par un input hidden de classe `inputClass`, lu par les handlers de
// sauvegarde comme n'importe quel champ. `options` = [{ value, label }].
// Retourne { root, input, setValue } — setValue(v) met à jour hidden + libellé
// SANS déclencher onChange (réservé aux choix explicites de l'utilisateur).
function cfgPillSelect(inputClass, options, value, onChange) {
  const root = document.createElement('div');
  root.className = 'pill-select is-compact cfg-pill-select';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pill-select-btn';
  const label = document.createElement('span');
  btn.appendChild(label);
  btn.insertAdjacentHTML('beforeend',
    '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>');
  const menu = document.createElement('div');
  menu.className = 'model-menu';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.className = inputClass;

  function setValue(v) {
    input.value = v;
    const opt = options.find(o => o.value === v);
    label.textContent = opt ? opt.label : v;
  }
  function renderOptions() {
    menu.innerHTML = '';
    options.forEach(o => {
      const el = document.createElement('div');
      el.className = 'model-opt' + (o.value === input.value ? ' selected' : '');
      el.innerHTML = `<span>${escHtml(o.label)}</span><span class="check">✓</span>`;
      el.onmousedown = (ev) => {
        ev.preventDefault();
        setValue(o.value);
        menu.classList.remove('show');
        if (onChange) onChange(o.value);
      };
      menu.appendChild(el);
    });
  }
  btn.addEventListener('click', () => {
    if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
    renderOptions();
    menu.classList.add('show');
  });

  root.append(btn, menu, input);
  setValue(value);
  return { root, input, setValue };
}

function buildMcpCard(server, isNew) {
  const card = document.createElement('div');
  card.className = 'cfg-card mcp-card' + (isNew ? ' is-editing' : '');
  const originalName = server.name || '';

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view';

  const viewName = document.createElement('div');
  viewName.className = 'cfg-view-name';
  viewName.textContent = server.name || '';
  viewSection.appendChild(viewName);

  const viewUrl = document.createElement('div');
  viewUrl.className = 'cfg-view-url';
  viewUrl.textContent = server.url || '';
  viewSection.appendChild(viewUrl);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row mcp-view-row';

  // Toggle en mode vue (class d'input distincte — onSaveMcpCard lit .mcp-enabled
  // dans la section édition)
  const viewToggle = cfgToggleRow('mcp-enabled-view', server.enabled !== false, 'Activé');
  const viewEnabledI = viewToggle.input;
  viewRow.appendChild(viewToggle.row);

  // Pill de statut — masquée si désactivé. L'état ET le libellé viennent du
  // prédicat pur `mcpStatusPill` : les composer ici rendrait le quatrième état
  // (« connecté, mais des upstreams attendent ») invisible au test.
  const viewStatus = document.createElement('div');
  viewStatus.className = 'mcp-status';
  const liveStatus = (!isNew && server.enabled !== false) ? getMcpStatus(originalName) : null;
  const pill = mcpStatusPill(liveStatus);
  if (pill) {
    if (pill.tone !== 'connecting') viewStatus.classList.add(pill.tone);
    viewStatus.textContent = pill.text;
  }
  viewRow.appendChild(viewStatus);

  // Reconnexion à la demande. Présent sur TOUTE carte enregistrée et activée,
  // pas seulement en erreur : le geste sert autant à réparer qu'à relire la
  // liste d'outils d'un serveur sain dont le proxy vient de gagner un upstream
  // — c'est le seul moyen de la rafraîchir sans sauvegarder la carte.
  // Absent d'une carte neuve (rien à reconnecter) et d'un serveur désactivé
  // (aucun handshake n'est dû, la pill est masquée pour la même raison).
  if (!isNew && server.enabled !== false) {
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'icon-btn mcp-refresh';
    refreshBtn.title = 'Reconnecter et relire les outils';
    refreshBtn.setAttribute('aria-label', 'Reconnecter ce serveur');
    refreshBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
    refreshBtn.addEventListener('click', () => onRefreshMcpCard(originalName, refreshBtn));
    viewRow.appendChild(refreshBtn);
  }

  // Bouton Modifier — pattern .drawer-btn de la gestion des souvenirs
  const modBtn = document.createElement('button');
  modBtn.className = 'drawer-btn';
  modBtn.textContent = 'Modifier';
  modBtn.addEventListener('click', () => card.classList.add('is-editing'));
  viewRow.appendChild(modBtn);

  viewSection.appendChild(viewRow);

  // Une ligne par upstream à autoriser (lot AB-5). Sous la pill, parce qu'elles
  // en détaillent le compte : la pill dit combien, ces lignes disent lesquels et
  // offrent l'action. Avec N upstreams, N lignes — MIAOU raisonne en serveur
  // configuré, le proxy en upstreams agrégés, et c'est ce décalage qui interdit
  // un booléen ici.
  const pendingUpstreams = (liveStatus && Array.isArray(liveStatus.unauthorizedUpstreams))
    ? liveStatus.unauthorizedUpstreams : [];
  for (const up of pendingUpstreams) {
    const row = document.createElement('div');
    row.className = 'mcp-upstream-row';

    const label = document.createElement('span');
    label.className = 'mcp-upstream-name';
    label.textContent = up.name;
    row.appendChild(label);

    // BOUTON, pas un lien nu : l'affordance de l'ack est discrète parce qu'elle
    // s'insère dans une ligne d'erreur, ici on veut une action franche. Et son
    // origine n'a pas à être affichée pour être vérifiée — elle vient de l'URL
    // que l'utilisateur a lui-même saisie sur cette carte, visible juste
    // au-dessus, pas d'un tiers.
    const authUrl = composeAuthorizationUrl(server.url, up.authorizePath);
    if (authUrl) {
      const btn = document.createElement('button');
      btn.className = 'drawer-btn mcp-authorize-btn';
      btn.textContent = 'Autoriser';
      btn.addEventListener('click', () => window.open(authUrl, '_blank', 'noopener'));
      row.appendChild(btn);
    } else {
      // Chemin absent ou refusé par la garde de composition : on garde la
      // ligne, sans action. Savoir qu'il faut autoriser reste utile même sans
      // savoir où cliquer — même doctrine que l'ack sans lien.
      const note = document.createElement('span');
      note.className = 'mcp-upstream-note';
      note.textContent = 'accès à autoriser';
      row.appendChild(note);
    }
    viewSection.appendChild(row);
  }

  card.appendChild(viewSection);

  // Toggle vue : persistance immédiate + reconnexion
  viewEnabledI.addEventListener('change', async () => {
    const s = getMcpServer(originalName);
    if (!s) return;
    s.enabled = viewEnabledI.checked;
    upsertMcpServer(s);
    disconnectMcpServer(originalName);
    if (s.enabled) {
      await runBackgroundTask('connexion MCP…', () => connectMcpServer(getMcpServer(originalName)));
    }
    renderMcpServers();
  });

  // ── SECTION ÉDITION ───────────────────────────────────────────────────────
  const editSection = document.createElement('div');
  editSection.className = 'cfg-edit';

  const mkInput = (cls, type, value, placeholder) => {
    const i = document.createElement('input');
    i.className = cls; i.type = type; i.value = value != null ? value : '';
    if (placeholder) i.placeholder = placeholder;
    i.spellcheck = false;
    return i;
  };

  const nameI = mkInput('mcp-name', 'text', server.name, 'jira');
  const urlI  = mkInput('mcp-url', 'text', server.url, 'https://host/mcp');
  // Transport : dropdown pilule custom (cfgPillSelect — pas de <select> natif).
  // La valeur vit dans l'input hidden .mcp-transport, lu tel quel par
  // onSaveMcpCard. Choix explicite → marqué « touché » : la devinette d'URL
  // ne l'écrase jamais ; serveur existant → touché d'office.
  const transport = cfgPillSelect('mcp-transport', [
    { value: 'streamable-http', label: 'streamable-http' },
    { value: 'sse', label: 'sse' },
  ], server.transport || 'streamable-http',
    () => { transport.input.dataset.touched = '1'; });
  if (server.transport) transport.input.dataset.touched = '1';
  urlI.addEventListener('input', () => {
    if (!transport.input.dataset.touched) transport.setValue(guessMcpTransport(urlI.value));
  });

  const tokenI = mkInput('mcp-token', 'password', server.authorization_token, 'Bearer (optionnel)');
  const tmoI = mkInput('mcp-timeout', 'number', mcpTimeoutSeconds(server) || MCP_DEFAULT_TIMEOUT_S, String(MCP_DEFAULT_TIMEOUT_S));
  const allowI = mkInput('mcp-allow', 'text', (server.toolAllowlist || []).join(', '), 'outil1, outil2 (vide = tous)');
  const denyI  = mkInput('mcp-deny', 'text', (server.toolDenylist || []).join(', '), 'outils à masquer');

  editSection.appendChild(cfgField('Nom (préfixe)', nameI, 'Unique, sans espace ni « __ ». « miaou » réservé.'));
  editSection.appendChild(cfgField('URL', urlI));
  // Le libellé « sse » reste nu dans la pilule (harmonisation des dropdowns) :
  // l'avertissement « différé » vit dans le hint du champ, pas dans l'option —
  // `sse` lève à l'usage (mcpRpc, mcp.js), l'info ne doit pas disparaître.
  editSection.appendChild(cfgField('Transport', transport.root,
    'streamable-http seul est implémenté ; sse est différé.'));
  editSection.appendChild(cfgField('Jeton d\'autorisation', tokenI, 'Stocké en clair (localStorage) — usage non-prod encouragé.'));
  editSection.appendChild(cfgField('Timeout (s)', tmoI));
  editSection.appendChild(cfgField('Outils autorisés', allowI));
  editSection.appendChild(cfgField('Outils masqués', denyI));

  // Toggle en mode édition (.mcp-enabled lu par onSaveMcpCard)
  editSection.appendChild(cfgToggleRow('mcp-enabled', server.enabled !== false, 'Activé').row);

  editSection.appendChild(cfgErrEl());

  const actions = document.createElement('div');
  actions.className = 'cfg-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'drawer-btn primary mcp-save'; saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSaveMcpCard(card, originalName));
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'drawer-btn mcp-cancel'; cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { if (isNew) card.remove(); else card.classList.remove('is-editing'); });
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  if (!isNew) {
    const delBtn = document.createElement('button');
    delBtn.className = 'drawer-btn danger mcp-del'; delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', () =>
      armThenRun(delBtn, () => onDeleteMcpCard(card, originalName), 'Confirmer ?'));
    actions.appendChild(delBtn);
  }
  editSection.appendChild(actions);

  card.appendChild(editSection);
  return card;
}

// ── Sous-drawer « Serveurs API » (cartes éditables, même pattern que MCP) ─────
// Remplace les champs plats url/key/model de la catégorie Connexion. `id` fait
// clé d'identité (pas `name`, cf. storage.js) : le renommage ne casse rien.
function openApiServers() {
  renderApiServers();
  $('api-drawer').classList.add('show');
  $('api-backdrop').classList.add('show');
}
function closeApiServers() {
  $('api-drawer').classList.remove('show');
  $('api-backdrop').classList.remove('show');
}
// Affichage lecture seule (catégorie Connexion) du serveur actif : nom en gras,
// « › modèle par défaut » à la suite (même séparateur coloré que le thread),
// URL en hint dessous — évite d'ouvrir le drawer juste pour vérifier le modèle.
function syncActiveApiServerUI() {
  const s = activeApiServer();
  const nameEl = $('active-api-server-name');
  const urlEl = $('active-api-server-url');
  if (nameEl) {
    nameEl.innerHTML = '';
    if (!s) {
      nameEl.textContent = 'Aucun serveur configuré';
    } else {
      const n = document.createElement('span');
      n.textContent = s.name;
      nameEl.appendChild(n);
      if (s.model) {
        const sep = document.createElement('span');
        sep.className = 'inline-sep';
        sep.textContent = '›';
        const m = document.createElement('span');
        m.className = 'active-api-server-model';
        m.textContent = s.model;
        nameEl.append(sep, m);
      }
    }
  }
  if (urlEl) urlEl.textContent = s ? s.url : '';
}

function renderApiServers() {
  const wrap = $('api-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const servers = loadApiServers();
  if (!servers.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun serveur API. Ajouter un backend pour activer MIAOU.';
    wrap.appendChild(empty);
  } else {
    const activeId = (activeApiServer() || {}).id;
    for (const s of servers) wrap.appendChild(buildApiCard(s, false, s.id === activeId));
  }
}

function addApiServerCard() {
  const wrap = $('api-list');
  if (!wrap) return;
  const empty = wrap.querySelector('.mem-empty');
  if (empty) empty.remove();
  // Passe par normalizeApiServer plutôt qu'un littéral : la carte neuve hérite
  // ainsi de TOUT défaut de champ (dont `promptOrder`, réglable au build) sans
  // qu'on ait à le recopier ici — une copie manuelle oublierait le prochain
  // champ ajouté, en silence. `id: ''` est conservé : c'est lui qui marque la
  // carte comme neuve pour onSaveApiCard.
  const blank = Object.assign(normalizeApiServer({}), { id: '' });
  wrap.insertBefore(buildApiCard(blank, true, false), wrap.firstChild);
}

function buildApiCard(server, isNew, isActive) {
  const card = document.createElement('div');
  card.className = 'cfg-card api-card' + (isNew ? ' is-editing' : '');
  const originalId = server.id || '';

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view';

  const viewName = document.createElement('div');
  viewName.className = 'cfg-view-name';
  viewName.textContent = server.name || '';
  viewSection.appendChild(viewName);

  const viewUrl = document.createElement('div');
  viewUrl.className = 'cfg-view-url';
  viewUrl.textContent = server.url || '';
  viewSection.appendChild(viewUrl);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row api-view-row';

  // Pill « Actif » OU bouton « Utiliser ce serveur » — jamais les deux : le
  // pill dit l'état, le bouton propose la transition, redondants sur une même carte.
  if (isActive) {
    const viewStatus = document.createElement('div');
    viewStatus.className = 'api-status active';
    viewStatus.textContent = '● Actif';
    viewRow.appendChild(viewStatus);
  } else if (server.disabled) {
    // Mis de côté : on dit l'état ET on garde la transition (c'est la seule voie
    // pour réactiver un serveur sans passer par l'édition de la carte).
    const viewStatus = document.createElement('div');
    viewStatus.className = 'api-status disabled';
    viewStatus.textContent = '○ Mis de côté';
    viewRow.appendChild(viewStatus);
    const useBtn = document.createElement('button');
    useBtn.className = 'drawer-btn';
    useBtn.textContent = 'Utiliser ce serveur';
    useBtn.addEventListener('click', () => onUseApiServer(originalId));
    viewRow.appendChild(useBtn);
  } else {
    const useBtn = document.createElement('button');
    useBtn.className = 'drawer-btn';
    useBtn.textContent = 'Utiliser ce serveur';
    useBtn.addEventListener('click', () => onUseApiServer(originalId));
    viewRow.appendChild(useBtn);
  }

  // Relecture à la demande (AF-9) : liste, puis sur un Ollama `/api/ps` et
  // `/api/show`, sans recharger la page. Même glyphe et même place que la
  // reconnexion des fiches MCP. Absent d'une fiche neuve (rien à relire).
  if (!isNew) {
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'icon-btn api-refresh';
    refreshBtn.title = 'Relire les modèles et leurs propriétés';
    refreshBtn.setAttribute('aria-label', 'Relire ce serveur');
    refreshBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
    refreshBtn.addEventListener('click', () => onRefreshApiCard(originalId, refreshBtn));
    viewRow.appendChild(refreshBtn);
  }

  const modBtn = document.createElement('button');
  modBtn.className = 'drawer-btn';
  modBtn.textContent = 'Modifier';
  modBtn.addEventListener('click', () => card.classList.add('is-editing'));
  viewRow.appendChild(modBtn);

  viewSection.appendChild(viewRow);
  card.appendChild(viewSection);

  // ── SECTION ÉDITION ───────────────────────────────────────────────────────
  const editSection = document.createElement('div');
  editSection.className = 'cfg-edit';

  const mkInput = (cls, type, value, placeholder) => {
    const i = document.createElement('input');
    i.className = cls; i.type = type; i.value = value != null ? value : '';
    if (placeholder) i.placeholder = placeholder;
    i.spellcheck = false;
    return i;
  };

  const nameI = mkInput('api-name', 'text', server.name, 'Par défaut');
  const urlI  = mkInput('api-url', 'text', server.url, 'http://host-interne/v1');
  const keyHintInfo = apiKeyFieldHint();
  const keyI  = mkInput('api-key', 'password', server.key, keyHintInfo.placeholder);
  const modelI = mkInput('api-model', 'text', server.model, 'gemma4:26b-nvfp4');

  editSection.appendChild(cfgField('Nom', nameI));
  editSection.appendChild(cfgField('URL de l\'API', urlI, 'Endpoint compatible OpenAI, terminant par /v1.'));
  editSection.appendChild(cfgField('Clef API', keyI, keyHintInfo.hint));

  // Le champ modèle enrobe l'input dans une ancre de dropdown (.model-menu) :
  // on construit l'ancre puis on la confie à cfgField comme « input ».
  const modelAnchor = document.createElement('div');
  modelAnchor.className = 'select-anchor api-model-anchor';
  const modelMenu = document.createElement('div');
  modelMenu.className = 'model-menu';
  modelI.addEventListener('focus', () => openApiModelMenu(modelI, modelMenu, urlI, keyI));
  modelI.addEventListener('input', () => onApiModelInput(modelI, modelMenu));
  modelAnchor.append(modelI, modelMenu);
  editSection.appendChild(cfgField('Modèle par défaut', modelAnchor,
    'Choisissez parmi les modèles exposés par l\'API.'));

  // Flag vision manuel (brief A2) : mitigation du silent-failure Ollama
  // (un modèle sans projecteur vision accepte l'image sans erreur puis lit le
  // placeholder [img-0] comme du texte). Réglé par (serveur, modèle courant) ;
  // « Sans vision » remplace proactivement les parts image par un descripteur.
  // Valeur initiale sur le modèle actuellement saisi. `.api-vision` (hidden)
  // porte 'on'/'off', lu par onSaveApiCard. Pas de select natif (cfgPillSelect).
  const visionPill = cfgPillSelect('api-vision', [
    { value: 'on', label: 'Activée' },
    { value: 'off', label: 'Sans vision' },
  ], 'on');
  // Quand le serveur DÉCLARE la vision du modèle (lot AF), la déclaration fait
  // foi dans les deux sens : la pilule cède la place à un libellé figé, et ne
  // propose plus de choix. Elle reste dans le DOM, portant le flag MANUEL tel
  // qu'il est persisté, pour qu'enregistrer la fiche ne le modifie pas.
  const visionFixed = document.createElement('span');
  visionFixed.className = 'cfg-fixed';
  const visionField = cfgField('Vision (images)', visionPill.root, ' ');
  visionField.insertBefore(visionFixed, visionPill.root);
  const visionHint = visionField.querySelector('.hint');
  // Le flag suit le modèle : changer de modèle réévalue l'état affiché depuis la
  // déclaration du serveur, puis la map `vision` (un modèle non réglé : « activée »).
  const syncVisionField = () => {
    const m = modelI.value.trim();
    const manualOff = !!(server.vision && server.vision[m] === false);
    visionPill.setValue(manualOff ? 'off' : 'on');
    const declared = m ? modelPropsFor(server, m).caps.vision : null;
    const isDeclared = declared === true || declared === false;
    visionPill.root.style.display = isDeclared ? 'none' : '';
    visionFixed.hidden = !isDeclared;
    if (isDeclared) {
      visionFixed.textContent = declared ? 'Lit les images' : 'Ne lit pas les images';
      visionHint.textContent = 'Déclaré par le serveur pour ce modèle : MIAOU s\'y fie, sans réglage manuel.' +
        (declared ? '' : ' Les images sont remplacées par un descripteur textuel.');
    } else {
      visionHint.textContent = 'Le serveur ne dit pas si ce modèle lit les images. S\'il ne les lit pas, ' +
        'choisir « Sans vision » : MIAOU enverra un descripteur textuel à la place.';
    }
  };
  syncVisionField();
  modelI.addEventListener('change', syncVisionField);
  editSection.appendChild(visionField);

  // Fenêtre de contexte saisie (lot AF), par (serveur, modèle courant) comme la
  // vision. Le hint dit ce que le serveur déclare ou ce qu'on a mesuré, et ce que
  // devient la saisie face à cela (cf. resolveContextWindow, storage.js).
  const ctxI = mkInput('api-context-window', 'number', serverModelContextWindow(server, server.model) || '', 'ex. 128000');
  ctxI.min = '0'; ctxI.step = '1000';
  const ctxField = cfgField('Fenêtre de contexte (tokens)', ctxI, ' ');
  const ctxHint = ctxField.querySelector('.hint');
  const syncCtxHint = () => {
    const m = modelI.value.trim();
    const detected = m ? resolveContextWindow(modelPropsFor(server, m), null, 0, MODEL_PROPS_SESSION_START) : null;
    ctxHint.textContent = contextWindowCardHint(m, detected, BUILD_DEFAULT_CONTEXT_WINDOW, Date.now());
  };
  syncCtxHint();
  modelI.addEventListener('change', () => {
    ctxI.value = serverModelContextWindow(server, modelI.value.trim()) || '';
    syncCtxHint();
  });
  editSection.appendChild(ctxField);

  // Flag `disabled` : un serveur mis de côté n'est plus interrogé pour peupler le
  // sélecteur serveur/modèle du composer, ni retenu comme repli d'activeApiServer().
  // Il reste activable explicitement depuis cette carte. `.api-disabled` (hidden)
  // porte 'on'/'off', lu par onSaveApiCard.
  const enabledPill = cfgPillSelect('api-disabled', [
    { value: 'on', label: 'Actif' },
    { value: 'off', label: 'De côté' },
  ], server.disabled ? 'off' : 'on');
  editSection.appendChild(cfgField('Disponibilité', enabledPill.root,
    'Mis de côté : ce serveur n\'apparaît plus dans le sélecteur serveur/modèle du composer.'));

  // Ordre d'assemblage du prompt : où CE backend place les définitions d'outils.
  // Propriété mesurée du serveur (cf. normalizePromptOrder, storage.js), pas une
  // préférence de présentation — mais elle ne change QUE l'inspecteur de
  // contexte, jamais ce qui part à l'API. Le libellé le dit, sinon on promet un
  // levier qui n'existe pas. Valeurs nommées par effet observable et non par
  // backend : une liste de backends deviendrait fausse au premier non listé
  // (énumération fermée), là où « avant/après les instructions » reste vrai.
  // `.api-prompt-order` (hidden) porte la valeur, lue par onSaveApiCard.
  const orderPill = cfgPillSelect('api-prompt-order', [
    { value: 'tools-first', label: 'Outils avant les instructions' },
    { value: 'tools-last', label: 'Outils après les instructions' },
  ], normalizePromptOrder(server.promptOrder));
  editSection.appendChild(cfgField('Ordre affiché dans l\'inspecteur', orderPill.root,
    'Où ce serveur place les définitions d\'outils dans le prompt qu\'il assemble. N\'affecte que l\'inspecteur de contexte, pas ce qui est envoyé.'));

  editSection.appendChild(cfgErrEl());

  const actions = document.createElement('div');
  actions.className = 'cfg-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'drawer-btn primary api-save'; saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSaveApiCard(card, originalId));
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'drawer-btn api-cancel'; cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { if (isNew) card.remove(); else card.classList.remove('is-editing'); });
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  if (!isNew && loadApiServers().length > 1) {
    const delBtn = document.createElement('button');
    delBtn.className = 'drawer-btn danger api-del'; delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', () =>
      armThenRun(delBtn, () => onDeleteApiCard(card, originalId), 'Confirmer ?'));
    actions.appendChild(delBtn);
  }
  editSection.appendChild(actions);

  card.appendChild(editSection);
  return card;
}

// ── Skills : drawer de gestion ───────────────────────────────────────────────
// ── Import de fichier .md dans le drawer skills : drag&drop + paste Finder ────
// Cible = tout le drawer (#skills-drawer), pas seulement la liste : zone de drop
// large et prévisible, pattern .dragover identique au composer (composer.css).
// Seul un fichier .md/text est retenu (filtre nom/type — un .png ou autre glissé
// par erreur est ignoré silencieusement, pas d'erreur bruyante pour un mauvais drop).
function isMarkdownFile(file) {
  if (!file) return false;
  if (file.type === 'text/markdown' || file.type === 'text/plain') return true;
  return /\.(md|markdown|txt)$/i.test(file.name || '');
}
function onSkillsDragOver(e) {
  e.preventDefault();
  const dz = $('skills-drawer');
  if (dz) dz.classList.add('dragover');
}
function onSkillsDragLeave(e) {
  const dz = $('skills-drawer');
  if (dz && (!e.relatedTarget || !dz.contains(e.relatedTarget))) dz.classList.remove('dragover');
}
function onSkillsDrop(e) {
  e.preventDefault();
  const dz = $('skills-drawer');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  const file = Array.from(files).find(isMarkdownFile);
  if (!file) return;
  file.text().then(text => ingestSkillMarkdownFile(text, file.name)).catch(() => {});
}
// Copier-coller Finder/Explorateur sur le drawer (hors focus d'une textarea déjà
// en édition — ce cas est intercepté par le listener .skill-content lui-même,
// stopPropagation, avant de remonter ici). Même filtre/lecture que le drop.
function onSkillsDrawerPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  let file = null;
  for (const item of items) {
    if (item.kind === 'file') { const f = item.getAsFile(); if (f && isMarkdownFile(f)) { file = f; break; } }
  }
  if (!file) return;
  e.preventDefault();
  file.text().then(text => ingestSkillMarkdownFile(text, file.name)).catch(() => {});
}

// Liste les skills depuis le cache mémoire (méta) ; le contenu Markdown est lu en
// IDB à l'entrée en édition (getSkillRecord), jamais conservé en cache.
function openSkills() {
  renderSkills();
  $('skills-drawer').classList.add('show');
  $('skills-backdrop').classList.add('show');
}
function closeSkills() {
  $('skills-drawer').classList.remove('show');
  $('skills-backdrop').classList.remove('show');
}

// Légende du `/` au composer. Jusqu'au lot AE elle disait « / pour une skill »
// et disparaissait sans skill activée — le slash n'avait alors aucun sens. Les
// commandes MIAOU (`MIAOU_COMMANDS`, skills.js) existent indépendamment des
// skills : la légende est désormais INCONDITIONNELLE, et c'est son TEXTE qui
// suit l'état. Un `/` annoncé « pour une skill » sur une install sans skill
// serait faux dans les deux sens : il marche, et pas pour ça.
//
// Texte éphémère lu seul (souvenir `ephemeral-text-read-alone`) : chaque
// variante se suffit, aucune ne s'appuie sur ce que l'autre aurait dit avant.
function syncSkillHintUI() {
  const el = $('composer-hint-skill');
  if (!el) return;
  el.hidden = false;
  const label = el.querySelector('.composer-hint-slash-label');
  if (label) {
    label.textContent = listEnabledSkills().length
      ? 'pour une skill ou une commande'
      : 'pour une commande';
  }
}

// Légende de la palette : le raccourci écoute metaKey||ctrlKey partout (cf.
// handler cmdk), mais le libellé suit la plateforme (Cmd sur Mac, Ctrl ailleurs).
function syncPaletteHintUI() {
  const el = $('composer-hint-cmdk-key');
  if (!el) return;
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  el.textContent = isMac ? 'Cmd+K' : 'Ctrl+K';
}

function renderSkills() {
  syncSkillHintUI();   // tout CRUD skill (save/delete/toggle) repasse ici
  const wrap = $('skill-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const skills = listAllSkillsCache();   // skills.js — méta, ordre d'insertion
  if (!skills.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucune skill. Créer un fragment d\'instructions réutilisable.';
    wrap.appendChild(empty);
    return;
  }
  // Skills utilisateur en tête (ce qu'on modifie le plus souvent), skills
  // système ensuite dans un groupe distinct précédé d'un texte d'intro —
  // non éditables (cf. buildSystemSkillCard), pour ne pas les noyer dans la
  // liste modifiable.
  const system = skills.filter(s => s.system === true);
  const user = skills.filter(s => s.system !== true);
  for (const s of user) wrap.appendChild(buildSkillCard(s, false));
  if (system.length) {
    const intro = document.createElement('div');
    intro.className = 'hint skill-system-intro';
    intro.textContent = 'Skills système : fournies par l\'application, toujours actives, non modifiables ni supprimables.';
    wrap.appendChild(intro);
    for (const s of system) wrap.appendChild(buildSystemSkillCard(s));
  }
}

// Carte d'une skill SYSTÈME (non éditable/supprimable, cf. docs/skills.md) :
// toggle enabled (seul réglage utilisateur légitime) + bouton « Consulter »
// qui bascule un panneau readonly rendu via renderMd (marked.js), jamais de
// section édition. Contenu chargé en IDB à l'ouverture, comme enterSkillEdit.
function buildSystemSkillCard(skill) {
  const card = document.createElement('div');
  card.className = 'cfg-card skill-card skill-card--system';
  const slug = skill.slug || '';
  if (slug) card.dataset.slug = slug;

  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view skill-view';

  const viewMain = document.createElement('div');
  viewMain.className = 'skill-view-main';
  const viewName = document.createElement('div');
  viewName.className = 'skill-view-name';
  viewName.textContent = skill.name || skill.slug || '(sans nom)';
  const viewBadge = document.createElement('span');
  viewBadge.className = 'skill-system-badge';
  viewBadge.textContent = 'Système';
  viewName.appendChild(viewBadge);
  const viewSlug = document.createElement('div');
  viewSlug.className = 'skill-view-slug';
  viewSlug.textContent = '/' + slug;
  viewMain.append(viewName, viewSlug);
  viewSection.appendChild(viewMain);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row skill-view-row';

  // Pas de toggle enabled : une skill système est TOUJOURS activée (cf.
  // ensureSystemSkills, skills.js — enabled figé à true à chaque démarrage).

  const viewBtn = document.createElement('button');
  viewBtn.className = 'drawer-btn';
  viewBtn.textContent = 'Consulter';
  viewBtn.addEventListener('click', () => toggleSystemSkillContent(card, slug, viewBtn));
  viewRow.appendChild(viewBtn);

  viewSection.appendChild(viewRow);
  card.appendChild(viewSection);

  const panel = document.createElement('div');
  panel.className = 'skill-system-panel';
  panel.hidden = true;
  if (skill.description) {
    const descView = document.createElement('div');
    descView.className = 'skill-system-desc';
    descView.textContent = skill.description;
    panel.appendChild(descView);
  }
  const contentView = document.createElement('div');
  contentView.className = 'skill-system-content';
  panel.appendChild(contentView);
  card.appendChild(panel);

  return card;
}

// Bascule le panneau de consultation d'une skill système : ouvre + charge le
// contenu (IDB, rendu renderMd) au premier clic, referme ensuite sans
// recharger (re-clic sur Consulter rouvre direct, contenu déjà posé). Le
// libellé du bouton suit l'état (Consulter ↔ Fermer).
function toggleSystemSkillContent(card, slug, btn) {
  const panel = card.querySelector('.skill-system-panel');
  const el = card.querySelector('.skill-system-content');
  if (!panel || !el) return;
  if (!panel.hidden) { panel.hidden = true; if (btn) btn.textContent = 'Consulter'; return; }
  panel.hidden = false;
  if (btn) btn.textContent = 'Fermer';
  if (el.dataset.loaded === '1') return;
  getSkillRecord(slug).then(rec => {
    el.innerHTML = renderMd(rec ? (rec.content || '') : '');
    el.dataset.loaded = '1';
  }).catch(() => {});
}

function addSkillCard() {
  const wrap = $('skill-list');
  if (!wrap) return;
  const empty = wrap.querySelector('.mem-empty');
  if (empty) empty.remove();
  wrap.insertBefore(buildSkillCard({ slug: '', name: '', description: '', enabled: true }, true), wrap.firstChild);
}

// Pré-remplit slug/nom/description/autotrigger d'une card skill (vue édition)
// depuis le cartouche d'un texte donné, sans jamais toucher un champ dont rien
// dans la source ne permet de décider. `scope` est la card ou sa section
// édition (querySelector cherche par classe, marche dans les deux cas).
// `filename` est le nom du fichier source quand l'import en vient (drop / paste
// Finder), omis sur un paste de texte : il sert de repli de slug. Partagé
// par le paste dans .skill-content ET l'import fichier (drag&drop / paste Finder
// hors édition, cf. ingestSkillMarkdownFile, main.js).
function applySkillFrontmatterToCard(scope, text, filename) {
  const fm = parseSkillFrontmatter(text);
  const ident = resolveSkillIdentity(fm, filename);
  if (!fm && !ident.slug) return;
  const slugI = scope.querySelector('.skill-slug');
  const nameI = scope.querySelector('.skill-name');
  const descI = scope.querySelector('.skill-desc');
  if (ident.slug) {
    if (slugI) slugI.value = ident.slug;
    if (nameI) nameI.value = ident.name;
  }
  if (!fm) return;
  if (fm.description != null && descI) descI.value = fm.description;
  if (fm.disableModelInvocation != null) {
    const autotriggerEl = scope.querySelector('.skill-autotrigger');
    if (autotriggerEl) autotriggerEl.checked = !fm.disableModelInvocation;
  }
}

function buildSkillCard(skill, isNew) {
  const card = document.createElement('div');
  card.className = 'cfg-card skill-card' + (isNew ? ' is-editing' : '');
  const originalSlug = skill.slug || '';
  if (originalSlug) card.dataset.slug = originalSlug;

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view skill-view';

  const viewMain = document.createElement('div');
  viewMain.className = 'skill-view-main';
  const viewName = document.createElement('div');
  viewName.className = 'skill-view-name';
  viewName.textContent = skill.name || skill.slug || '(sans nom)';
  const viewSlug = document.createElement('div');
  viewSlug.className = 'skill-view-slug';
  viewSlug.textContent = '/' + (skill.slug || '');
  viewMain.append(viewName, viewSlug);
  // Skill dont le slug est devenu une commande MIAOU (lot AE, AE-9).
  // `validateSkillSlug` interdit les créations FUTURES, mais une skill déjà en
  // base ne repasse jamais par la validation : elle continue d'exister et
  // cesse simplement de répondre au slash, la commande primant. Le dire ici
  // plutôt que de laisser constater — et le dire DANS LE DRAWER, seul endroit
  // où l'utilisateur peut agir (renommer). Au composer ce serait au pire
  // moment : il veut compacter, pas arbitrer un conflit de nom.
  if (skill.slug && commandSlugs().indexOf(skill.slug) >= 0) {
    const warn = document.createElement('div');
    warn.className = 'skill-view-shadowed';
    warn.textContent = 'Ce slug est désormais une commande de MIAOU : /' +
      skill.slug + ' déclenche la commande, pas cette skill. Renomme-la pour la ' +
      'rendre à nouveau invocable.';
    viewMain.appendChild(warn);
  }
  viewSection.appendChild(viewMain);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row skill-view-row';

  // Toggle enabled en vue, sans libellé (persistance immédiate via onToggleSkill, main.js)
  const viewToggle = cfgToggle('skill-enabled-view', skill.enabled !== false);
  viewRow.appendChild(viewToggle.root);
  if (!isNew) {
    viewToggle.input.addEventListener('change', () => onToggleSkill(originalSlug));
  }

  const modBtn = document.createElement('button');
  modBtn.className = 'drawer-btn';
  modBtn.textContent = 'Modifier';
  modBtn.addEventListener('click', () => enterSkillEdit(card, originalSlug));
  viewRow.appendChild(modBtn);

  viewSection.appendChild(viewRow);
  card.appendChild(viewSection);

  // ── SECTION ÉDITION ───────────────────────────────────────────────────────
  const editSection = document.createElement('div');
  editSection.className = 'cfg-edit';

  const slugI = document.createElement('input');
  slugI.className = 'skill-slug'; slugI.type = 'text'; slugI.value = skill.slug || '';
  slugI.placeholder = 'revue-code'; slugI.spellcheck = false;
  const nameI = document.createElement('input');
  nameI.className = 'skill-name'; nameI.type = 'text'; nameI.value = skill.name || '';
  nameI.placeholder = 'Revue de code'; nameI.spellcheck = false;
  const descI = document.createElement('input');
  descI.className = 'skill-desc'; descI.type = 'text'; descI.value = skill.description || '';
  descI.placeholder = 'Brève description (visible du modèle)'; descI.spellcheck = false;
  const contentT = document.createElement('textarea');
  contentT.className = 'skill-content'; contentT.rows = 10; contentT.spellcheck = false;
  contentT.placeholder = 'Corps de la skill en Markdown…';

  editSection.appendChild(cfgField('Slug', slugI, 'Clé d\'invocation /slug. Sans espace ni « / ».'));
  editSection.appendChild(cfgField('Nom', nameI, 'Libellé d\'affichage.'));
  editSection.appendChild(cfgField('Description', descI, 'Surface lexicale décrite au modèle.'));
  editSection.appendChild(cfgField('Contenu', contentT));

  // Toggle enabled en édition (.skill-enabled lu par onSaveSkillCard)
  editSection.appendChild(cfgToggleRow('skill-enabled', skill.enabled !== false, 'Activée').row);

  // Toggle autotrigger en édition (.skill-autotrigger lu par onSaveSkillCard) —
  // stage 2 : liste cette skill dans le contexte dynamique <miaou_skills_context>
  // à chaque tour, pour découverte proactive par le modèle.
  editSection.appendChild(cfgToggleRow('skill-autotrigger', skill.autotrigger === true,
    'Proposée proactivement au modèle').row);

  editSection.appendChild(cfgErrEl());

  // Collage d'un contenu à cartouche (format Claude Code), OU d'un vrai fichier .md copié
  // depuis le Finder/Explorateur (clipboardData porte un File, pas garanti d'être posé en
  // texte nativement par le navigateur — on le lit nous-mêmes via getAsFile() plutôt que
  // de compter sur le comportement natif) : pré-remplit slug/nom/description/autotrigger
  // depuis le frontmatter, sans jamais le retirer du contenu posé dans la textarea
  // (skills.js, parseSkillFrontmatter — pur).
  contentT.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    let file = null;
    if (items) {
      for (const item of items) {
        if (item.kind === 'file') { const f = item.getAsFile(); if (f) { file = f; break; } }
      }
    }
    if (file) {
      e.preventDefault();
      e.stopPropagation();   // évite un double-traitement par le listener du drawer (paste sur #skills-drawer)
      file.text().then(text => { contentT.value = text; applySkillFrontmatterToCard(editSection, text, file.name); }).catch(() => {});
      return;
    }
    setTimeout(() => { applySkillFrontmatterToCard(editSection, contentT.value); }, 0);
  });

  const actions = document.createElement('div');
  actions.className = 'cfg-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'drawer-btn primary skill-save'; saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSaveSkillCard(card, originalSlug));
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'drawer-btn skill-cancel'; cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { if (isNew) card.remove(); else card.classList.remove('is-editing'); });
  actions.append(saveBtn, cancelBtn);
  if (!isNew) {
    const delBtn = document.createElement('button');
    delBtn.className = 'drawer-btn danger skill-del'; delBtn.textContent = 'Supprimer';
    // Hard delete définitif : armement deux temps (pas de window.confirm natif).
    delBtn.addEventListener('click', () =>
      armThenRun(delBtn, () => onDeleteSkillCard(card, originalSlug), 'Confirmer ?'));
    actions.appendChild(delBtn);
  }
  editSection.appendChild(actions);

  card.appendChild(editSection);
  return card;
}

// Entre en mode édition : récupère le contenu Markdown en IDB (jamais en cache) et
// le pose dans la textarea avant d'afficher la section édition.
function enterSkillEdit(card, slug) {
  const ta = card.querySelector('.skill-content');
  if (ta && slug) {
    getSkillRecord(slug).then(rec => { if (rec && ta) ta.value = rec.content || ''; }).catch(() => {});
  }
  card.classList.add('is-editing');
}

// ── Autocomplétion des skills (slash-commande) ─────────────────────────────────
// Filtre le cache mémoire (skills ACTIVÉS) sur le trigger `/slug` actif le plus
// proche du curseur (cf. findSlashTriggers, skills.js — trigger = position 0 OU
// précédé d'un espace/saut de ligne). Mécanique GÉNÉRIQUE partagée par le composer
// et la bulle d'édition in-place : chaque contexte fournit un état `{ ta, box,
// index }` (cf. _composerAc / état créé dans enterEditMode). `index` mémorise la
// sélection clavier ET le trigger actif courant (start/end/slug) pour l'insertion.

// `commands: true` n'est posé QUE sur l'état du composer (lot AE). C'est le
// discriminant des deux contextes : l'état de la bulle d'édition (enterEditMode)
// a exactement la même forme, et rien à l'intérieur de updateSkillAutocomplete
// ne permettrait sinon de les distinguer. Nommé d'après la CAPACITÉ (« cet état
// propose les commandes ») et non d'après le contexte (`isComposer`), qui
// inviterait à y brancher d'autres différences sans rapport.
//
// Les commandes MIAOU sont absentes de l'édition d'un message passé (condition 2
// du § 4.7) : éditer un message passé EST une réécriture d'historique, déjà sous
// la garde AE-7 — y proposer une commande qui en déclenche une autre n'aurait
// pas de sens.
const _composerAc = { ta: null, box: null, index: -1, trigger: null, commands: true };

function onComposerInput() {
  clearComposerError();
  const ta = $('composer-text');
  const box = $('skill-ac');
  if (!ta || !box) return;
  _composerAc.ta = ta; _composerAc.box = box;
  updateSkillAutocomplete(_composerAc);
}

// Recalcule et (re)peint l'autocomplétion pour un état `{ ta, box }` donné, en
// fonction du trigger `/slug` actif sous le curseur. Position 0 avec slug VIDE
// ouvre immédiatement la liste complète (au pic du `/`, l'intention est déjà claire) ;
// toute autre position attend ≥1 caractère après le `/` avant d'ouvrir, pour ne pas
// être intrusif sur un `/` littéral en cours de frappe normale.
function updateSkillAutocomplete(state) {
  const ta = state.ta;
  const triggers = findSlashTriggers(ta.value);
  const caret = ta.selectionStart;
  // Trigger actif = celui qui contient le curseur (start <= caret <= end).
  const trig = triggers.find(t => caret >= t.start && caret <= t.end) || null;
  if (!trig) { hideSkillAutocomplete(state); return; }
  if (!trig.atStart && trig.slug === '') { hideSkillAutocomplete(state); return; }
  // COMMANDES EN TÊTE, skills ensuite. L'ordre inverse avait été posé d'abord
  // (« les skills sont le cas courant, une commande n'a pas à pousser une skill
  // hors de vue ») et la première capture l'a réfuté : les commandes sont peu
  // nombreuses et BORNÉES (registre build-time), les skills une liste OUVERTE,
  // donc mettre les secondes devant pousse systématiquement les premières sous
  // le pli dès qu'il y a plus de quelques skills — `/compact` était invisible
  // sans défiler. La règle générale : ce qui est borné passe devant ce qui ne
  // l'est pas, sinon le borné devient inatteignable à mesure que l'autre grossit.
  //
  // Les commandes ne sont proposées qu'en position 0 — `/compact` n'est reconnu
  // à l'envoi que seul dans le champ (condition 3), donc le proposer au milieu
  // d'un texte suggérerait une capacité qui n'existe pas (défaut « capacité
  // inatteignable » du souvenir `model-facing-text`, qui vaut aussi pour un
  // humain).
  const commands = (state.commands === true && trig.atStart)
    ? matchCommandCompletions(trig.slug).map(c => ({ slug: c.slug, label: c.label, command: true }))
    : [];
  const skills = matchSkillCompletions(trig.slug).map(s => ({
    slug: s.slug, label: s.name, command: false,
  }));
  const matches = commands.concat(skills);
  if (!matches.length) { hideSkillAutocomplete(state); return; }
  state.trigger = trig;
  renderSkillAutocomplete(state, matches);
}

function renderSkillAutocomplete(state, matches) {
  const box = state.box;
  if (!box) return;
  box.innerHTML = '';
  state.index = -1;
  // Entrées normalisées `{ slug, label, command }` par l'appelant : skills et
  // commandes MIAOU partagent la liste mais pas l'apparence — `.is-command`
  // porte la distinction visuelle (lot AE). Une commande affichée comme une
  // skill ferait chercher une skill « compact » éditable dans le drawer.
  matches.forEach((s, i) => {
    const opt = document.createElement('div');
    opt.className = 'skill-ac-opt' + (s.command ? ' is-command' : '');
    opt.dataset.slug = s.slug;
    const slugEl = document.createElement('span');
    slugEl.className = 'skill-ac-slug';
    slugEl.textContent = '/' + s.slug;
    opt.appendChild(slugEl);
    if (s.label) {
      const nameEl = document.createElement('span');
      nameEl.className = 'skill-ac-name';
      nameEl.textContent = s.label;
      opt.appendChild(nameEl);
    }
    if (s.command) {
      const tag = document.createElement('span');
      tag.className = 'skill-ac-tag';
      tag.textContent = 'commande';
      opt.appendChild(tag);
    }
    opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickSkillCompletion(state, s.slug); });
    box.appendChild(opt);
  });
  box.removeAttribute('hidden');
  fitSkillAutocompleteHeight(box);
}

// Borne la hauteur du panneau à la place RÉELLEMENT libre au-dessus de lui,
// plutôt qu'aux 220px fixes du CSS (lot AE étape 5).
//
// Mesuré avant correction : 11 options = ~395px de contenu comprimés dans
// 220px, alors que 445px étaient libres au-dessus du composer. La moitié de la
// place disponible était inutilisée et les dernières options passaient sous le
// pli — dont `/compact`, ce qui a ouvert le sujet.
//
// Pourquoi en JS et pas en CSS : le panneau du composer est en `position:
// absolute` ancré à `.input-wrap`, dont la hauteur varie (pièces jointes, rail
// d'interjections, saisie multiligne). Aucune fonction CSS ne donne la place
// libre au-dessus d'une ancre absolue — `vh` mesure le viewport, pas l'ancre.
//
// Appelée APRÈS `removeAttribute('hidden')` : un panneau caché n'a pas de
// géométrie, sa mesure rendrait 0. Recalculée à chaque peinture, donc jamais
// périmée — c'est ce qui la distingue d'une constante relevée.
function fitSkillAutocompleteHeight(box) {
  // L'instance de la bulle d'édition n'est pas ancrée pareil (flux normal,
  // sous la textarea) : la mesure ne lui convient pas, elle garde le plafond
  // du CSS.
  if (!box || box.id !== 'skill-ac') return;
  box.style.maxHeight = '';
  // Le BAS, jamais le haut. Le panneau est ancré par `bottom` : son bas est
  // fixe, son haut dépend de sa propre hauteur (plafonnée à 220px par
  // `.skill-ac` une fois le style inline retiré). Lire `top` soustrayait donc
  // la hauteur courante de la place libre — ~213px pour 445px libres, moins
  // que le plafond qu'on voulait lever (relevé en revue le 2026-09-22).
  const bottom = box.getBoundingClientRect().bottom;
  // Marge de respiration en haut de fenêtre, et plancher pour que le panneau
  // reste utilisable même dans une fenêtre très basse (il défilera alors).
  const avail = Math.max(120, Math.round(bottom - 12));
  box.style.maxHeight = avail + 'px';
}

function hideSkillAutocomplete(state) {
  const s = state || _composerAc;
  const box = s.box;
  if (box) { box.setAttribute('hidden', ''); box.innerHTML = ''; box.style.maxHeight = ''; }
  s.index = -1;
  s.trigger = null;
}

function skillAutocompleteOpen(state) {
  const box = (state || _composerAc).box;
  return !!box && !box.hasAttribute('hidden');
}

function moveSkillAcSelection(state, delta) {
  const box = state.box;
  if (!box) return;
  const opts = box.querySelectorAll('.skill-ac-opt');
  if (!opts.length) return;
  // Entrée dans la liste par ↑ sans sélection : dernière option (l'arithmétique
  // modulaire depuis -1 donnerait l'avant-dernière). Vaut pour les deux contextes
  // (composer et bulle d'édition), quelle que soit la position de la liste.
  if (state.index < 0 && delta < 0) state.index = opts.length - 1;
  else state.index = (state.index + delta + opts.length) % opts.length;
  opts.forEach((o, i) => o.classList.toggle('active', i === state.index));
  const active = opts[state.index];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

// Valide la sélection courante (ou la première option) : complète `/slug ` dans le
// champ ciblé sans envoyer (l'utilisateur déclenche l'injection en envoyant/validant).
function acceptSkillAcSelection(state) {
  const box = state.box;
  if (!box) return false;
  const opts = box.querySelectorAll('.skill-ac-opt');
  if (!opts.length) return false;
  const opt = opts[state.index >= 0 ? state.index : 0];
  if (!opt) return false;
  pickSkillCompletion(state, opt.dataset.slug);
  return true;
}

// Remplace UNIQUEMENT le segment `/slug` du trigger actif (pas tout le champ) —
// nécessaire pour le cas mid-message où du texte entoure le trigger.
function pickSkillCompletion(state, slug) {
  const ta = state.ta;
  const trig = state.trigger;
  if (!ta || !trig) return;
  const v = ta.value;
  const replacement = '/' + slug + ' ';
  ta.value = v.slice(0, trig.start) + replacement + v.slice(trig.end);
  const caret = trig.start + replacement.length;
  hideSkillAutocomplete(state);
  ta.focus();
  ta.setSelectionRange(caret, caret);
  autoGrow(ta);
}

// Canal d'erreur GÉNÉRIQUE du composer : une ligne sous la zone de saisie, pour
// tout refus qui doit rester visible sans modale ni toast. Nommé d'après la
// SURFACE, pas d'après le premier appelant — il s'est appelé
// `showComposerSkillError` jusqu'au lot X-1f, hérité de la validation de slash-
// skills, alors qu'il portait déjà des refus sans rapport (dont, brièvement, le
// « cette conversation est celle d'un agent » que X-1f a retiré). Un canal
// nommé d'après un de ses usages invite chaque nouvel appelant à se demander
// s'il a le droit de s'en servir, ou à en ouvrir un deuxième.
//
// Distinct de `showComposerAttachError` (main.js), et ce n'est pas un oubli :
// leurs cycles de vie diffèrent. Celui-ci est purgé à chaque frappe
// (`onComposerInput`) parce que ses refus portent sur le TEXTE en cours ; celui
// des pièces jointes survit à la frappe, son objet étant la pile d'attachements.
// Les fusionner ferait qu'écrire une lettre efface un refus d'attache.
function showComposerError(msg) {
  const el = $('composer-error');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}
function clearComposerError() {
  const el = $('composer-error');
  if (el) { el.setAttribute('hidden', ''); el.textContent = ''; }
}

function setMemItemLoading(item, label) {
  const btn = item.querySelector('.drawer-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spin"></span>' + escHtml(label);
}

// ── Souvenirs utilisateur (onglet Souvenirs du drawer combiné = profile ;
//    écran Space = scope de ce Space, lot C) ────────────────────────
// Paramétrée conteneur + scope (au lieu de dupliquer, cf. audit §7) :
// `containerId` = id de l'élément conteneur ; `scope` = 'profile' (défaut,
// drawer réglages) ou un spaceId (écran Space, promotion disponible en plus).
// L'input d'ajout est namespacé par conteneur ('mem-add-input-' + containerId)
// pour coexister sans collision si les deux écrans étaient un jour montés
// simultanément ; les ids par ENTRÉE restent globaux (memory id unique).
function renderMemoryList(containerId, scope) {
  containerId = containerId || 'memory-list';
  scope = scope || 'profile';
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  const addInputId = 'mem-add-input-' + containerId;

  const addArea = document.createElement('div');
  addArea.className = 'mem-add';
  addArea.innerHTML =
    `<textarea class="mem-add-input" id="${addInputId}" rows="2" placeholder="Nouveau souvenir…"></textarea>` +
    `<button class="drawer-btn mem-add-btn" onclick="addMemoryEntry('${containerId}','${scope}')">Ajouter</button>`;
  wrap.appendChild(addArea);

  const all = listMemoryEntries([scope]).concat(loadMemories().filter(e => e.suppressed && (e.scope || DEFAULT_SPACE_ID) === scope))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun souvenir pour l\'instant.';
    wrap.appendChild(empty);
    return;
  }

  const promoteBtn = scope !== 'profile'
    ? `<button class="drawer-btn" onclick="promoteMemoryEntry('${'{{ID}}'}','${containerId}','${scope}')">Promouvoir en profil</button>`
    : '';

  for (const e of all) {
    const item = document.createElement('div');
    item.className = 'mem-item' + (e.suppressed ? ' suppressed' : '');
    item.dataset.id = e.id;
    const date = new Date(e.updated_at || e.created_at || 0).toLocaleDateString('fr-FR');

    if (e.suppressed) {
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-sub">supprimé · ${escHtml(date)}</div></div></div>` +
        `<div class="mem-excerpt">${escHtml((e.content || '').slice(0, 120))}${(e.content || '').length > 120 ? '…' : ''}</div>` +
        `<div class="drawer-btns">` +
        `<button class="drawer-btn" onclick="restoreMemoryEntry('${e.id}','${containerId}','${scope}')">Rétablir</button>` +
        `<button class="drawer-btn danger" onclick="forgetMemoryEntry('${e.id}','${containerId}','${scope}')">Oublier</button>` +
        `</div>`;
    } else {
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-sub">${escHtml(date)}</div></div></div>` +
        `<div class="mem-content" id="mem-content-${e.id}">${escHtml(e.content || '')}</div>` +
        `<div class="drawer-btns" id="drawer-btns-${e.id}">` +
        `<button class="drawer-btn" onclick="startEditMemoryEntry('${e.id}')">Modifier</button>` +
        (promoteBtn ? promoteBtn.replace('{{ID}}', e.id) : '') +
        `<button class="drawer-btn danger" onclick="deleteMemoryEntry('${e.id}','${containerId}','${scope}')">Supprimer</button>` +
        `</div>` +
        `<div class="mem-edit-wrap hidden" id="mem-edit-${e.id}">` +
        `<textarea class="mem-edit-input" id="mem-edit-input-${e.id}">${escHtml(e.content || '')}</textarea>` +
        `<div class="mem-edit-actions">` +
        `<button class="drawer-btn primary" onclick="saveMemoryEntryEdit('${e.id}','${containerId}','${scope}')">Enregistrer</button>` +
        `<button class="drawer-btn" onclick="cancelMemoryEntryEdit('${e.id}')">Annuler</button>` +
        `</div></div>`;
    }
    wrap.appendChild(item);
  }
}

function addMemoryEntry(containerId, scope) {
  containerId = containerId || 'memory-list';
  scope = scope || 'profile';
  const input = $('mem-add-input-' + containerId);
  const content = input ? input.value.trim() : '';
  if (!content) return;
  const now = Date.now();
  saveMemory({ id: genMemoryId(), content, created_at: now, updated_at: now, suppressed: false, scope });
  renderMemoryList(containerId, scope);
  if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope);
}

function deleteMemoryEntry(id, containerId, scope) { suppressMemory(id); renderMemoryList(containerId, scope); if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope); }
function restoreMemoryEntry(id, containerId, scope) { restoreMemory(id); renderMemoryList(containerId, scope); if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope); }
function forgetMemoryEntry(id, containerId, scope) { forgetMemory(id); renderMemoryList(containerId, scope); if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope); }

// Promotion Space → profile (UI-only, lot C) : réécrit le scope en
// place, pas de nouvelle entrée. Démotion volontairement absente en v1 (cf.
// docs/spaces.md, non-goal) — décision à revalider avec Julien si demandée.
function promoteMemoryEntry(id, containerId, scope) {
  const arr = loadMemories();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  e.scope = 'profile';
  persistMemories(arr);
  renderMemoryList(containerId, scope);
}

// ── Bibliothèque de fichiers d'espace (lot Cbis) ─────────────────────────
// Frère de renderMemoryList : composants de carte réutilisés (mem-item/
// mem-header/mem-sub/mem-excerpt, drawers.css), pas de duplication de style.
// Async (getResourcesBySpace lit IDB) — appelée fire-and-forget par
// openSpaceScreen, comme loadSpaceLibrary. Tri createdAt→id, même ordre
// déterministe que le manifeste de contexte (Cbis-2).
async function renderSpaceFilesList(spaceId) {
  const wrap = $('space-files-list');
  if (!wrap) return;
  const entries = (await getResourcesBySpace(spaceId)).slice()
    .sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : String(a.id).localeCompare(String(b.id))));
  wrap.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun fichier dans la bibliothèque de cet espace.';
    wrap.appendChild(empty);
    return;
  }
  for (const e of entries) {
    const item = document.createElement('div');
    item.className = 'mem-item';
    item.dataset.id = e.id;
    // « promu » nu, la phrase entière en tooltip : la provenance est une
    // information de second plan, et elle coûtait ~25 caractères sur une ligne
    // qui doit aussi porter type, taille et date dans ~210 px utiles.
    const provenanceBadge = e.source
      ? '<span class="mem-sub" title="Promu depuis une conversation"> · promu</span>'
      : '';
    // Date de DÉPÔT sur la ligne méta, à sa place de fait (type · taille ·
    // date · provenance) : elle rejoint la ligne des faits sur le fichier
    // plutôt que d'ajouter une hauteur à une carte qui wrappe déjà. Montrée
    // NUE, sans verbe l'introduisant : il n'y a qu'une date, donc rien à
    // distinguer (le pur `libraryFileDate` porte ce motif, et celui de
    // l'absence de date de modification). Le rendu suit le patron de la
    // sidebar — énoncé variable au repos, date complète en tooltip
    // (`formatFullDateFr`), jamais deux formules pour deux surfaces du même ts.
    //
    // `formatDateRelative` et NON `relativeWhen` (qui sert la liste des
    // conversations) : celui-ci rend l'heure nue pour aujourd'hui (« 14:30 »),
    // or une carte de fichier annonce une DATE, pas un instant —
    // `formatDateRelative` est date-only par construction (« aujourd'hui »,
    // « hier », « 3 mars »), et c'est déjà l'emploi que lui donne la bannière
    // de résumés. L'heure exacte reste dans le tooltip.
    const dts = libraryFileDate(e);
    const dateBit = dts
      ? ` · <span title="${escHtml(formatFullDateFr(dts))}">${escHtml(formatDateRelative(dts, Date.now()))}</span>`
      : '';
    const descriptionLine = `<div class="mem-excerpt file-description-line" id="file-description-${e.id}">${e.description ? escHtml(e.description) : ''}</div>`;
    item.innerHTML =
      `<div class="mem-header"><div class="mem-meta">` +
      // Type lisible plutôt que mime brut (`libraryFileTypeLabel`), le mime
      // exact restant accessible en tooltip : il n'est pas perdu, il est
      // rangé là où on le consulte au lieu de le subir.
      `<div class="mem-sub"><span title="${escHtml(e.mime)}">${escHtml(libraryFileTypeLabel(e.mime))}</span> · ${escHtml(humanSize(e.size))}${dateBit}${provenanceBadge}</div>` +
      `</div>` +
      // Téléchargement en GLYPHE dans l'en-tête (pas un bouton texte) : la
      // colonne latérale fait ~210 px utiles, un troisième bouton texte faisait
      // wrapper la rangée sur deux lignes. L'en-tête est déjà le porteur
      // d'actions des cartes (cf. les cartes de résumé) et surplombe
      // directement le nom ; on ne le pose PAS dans `.mem-content`, qui est en
      // `word-break: break-word` — un nom long y ferait flotter l'icône à une
      // position imprévisible. Même glyphe que l'ack (ICON_DOWNLOAD).
      `<button class="mem-dl" title="Télécharger" onclick="onDownloadSpaceFile(this,'${e.id}')">${ICON_DOWNLOAD}</button>` +
      `</div>` +
      // Nom RENOMMABLE en place, même mécanique que le titre de conversation
      // (contenteditable, Entrée valide, Échap annule, blur persiste, vide
      // restaure) : un seul vocabulaire de renommage dans l'appli. Les
      // handlers sont posés après insertion (wireLibraryNameEditing) plutôt
      // qu'en attributs inline : il faut mémoriser le nom d'avant l'édition
      // pour pouvoir le restaurer, ce qu'un attribut ne porte pas.
      `<div class="mem-content file-name-edit" id="file-name-${e.id}" contenteditable="true" spellcheck="false" title="Renommer le fichier">${escHtml(e.name)}</div>` +
      descriptionLine +
      `<div class="drawer-btns" id="file-btns-${e.id}">` +
      `<button class="drawer-btn" onclick="onRegenerateFileDescription(this,'${e.id}','${spaceId}')">${e.description ? 'Régénérer la description' : 'Générer une description'}</button>` +
      `<button class="drawer-btn danger" onclick="onDeleteSpaceFile(this,'${e.id}','${spaceId}')">Supprimer</button>` +
      `</div>`;
    wrap.appendChild(item);
    wireLibraryNameEditing(item.querySelector('.file-name-edit'), e.id, spaceId);
  }
}

// Renommage en place du nom d'un fichier de bibliothèque. Calque de
// wireTitleEditing (main.js) : `before` figé au focus, Entrée = blur (donc
// validation), Échap = restauration puis blur, blur = persistance.
//
// Différence assumée avec le titre de conversation : la persistance est
// asynchrone (IDB), donc le nom affiché est réécrit depuis la valeur
// EFFECTIVEMENT retenue par renameLibraryFile (normalisation, cap de longueur)
// plutôt que laissé tel que tapé — sinon la carte afficherait un nom que le
// store ne porte pas, et le prochain re-render le ferait sauter sans
// explication. `_libFileNameBefore` est porté par le nœud DOM, pas par une
// globale : plusieurs cartes coexistent, et la liste est re-rendue sous les
// handlers (mémoire d'index sur le nœud, jamais d'appariement positionnel).
function wireLibraryNameEditing(el, fileId, spaceId) {
  if (!el) return;
  el.addEventListener('focus', () => {
    el._libNameBefore = el.textContent;
    // Présélection du RADICAL, pas de tout le texte : le geste courant est de
    // renommer « export-final-v2 » en gardant « .csv », et une sélection
    // complète oblige alors à retaper l'extension. Le titre de conversation
    // pose le caret en fin (placeCaretEnd) parce qu'un titre n'a pas de
    // suffixe à préserver — la divergence est délibérée, pas un oubli.
    // requestAnimationFrame comme là-bas : poser la sélection DANS le handler
    // de focus la voit écrasée par le placement de caret que le navigateur
    // effectue derrière (clic).
    requestAnimationFrame(() => selectLibraryNameStem(el));
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    else if (ev.key === 'Escape') {
      ev.preventDefault();
      // stopPropagation : sans lui, Échap remonte au handler global qui ferme
      // le drawer/annule le mode courant — on annule une saisie, pas un écran.
      ev.stopPropagation();
      el.textContent = el._libNameBefore || '';
      el.blur();
    }
  });
  el.addEventListener('blur', async () => {
    const before = el._libNameBefore || '';
    const typed = el.textContent;
    if (typed.trim() === before.trim()) { el.textContent = before; flushDeferredLibraryRefresh(); return; }
    const applied = await renameLibraryFile(fileId, typed);
    // null = échec d'écriture (IDB indisponible, record disparu) : on remet le
    // nom d'avant plutôt que de laisser à l'écran un renommage qui n'a pas eu
    // lieu — l'affordance ne doit jamais mentir sur l'état du store.
    el.textContent = applied != null ? applied : before;
    // Le nom revient à l'ancien : le toast dit pourquoi, là où le retour seul
    // se lisait comme une saisie perdue.
    if (applied == null) toastRenameFailed(before);
    el._libNameBefore = el.textContent;
    flushDeferredLibraryRefresh();
    // Le libellé du bouton de suppression du drawer Space porte des comptes,
    // pas des noms : rien à resynchroniser ici (contrairement à onDeleteSpaceFile).
  });
}

// Sélectionne le radical du nom (tout sauf l'extension) dans un champ
// contenteditable. La borne vient du pur `libraryNameStemLength` ; ici ne
// reste que le geste DOM, qui n'est pas testable en QuickJS.
//
// Le nœud texte est pris par `firstChild` : le champ ne contient qu'une chaîne
// (posée par `escHtml` au rendu, réécrite par `textContent` au blur), jamais de
// balisage. S'il est vide ou absent — cas limite d'un nom vidé — on retombe sur
// le caret en fin plutôt que de lever sur un nœud manquant.
function selectLibraryNameStem(el) {
  const node = el.firstChild;
  if (!node || node.nodeType !== 3) { placeCaretEnd(el); return; }
  const end = libraryNameStemLength(node.nodeValue);
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, Math.min(end, node.nodeValue.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Rafraîchit la bibliothèque AFFICHÉE après un ajout, quelle que soit la voie
// (promotion modèle `files__promote`, promotion utilisateur d'une pièce jointe,
// ou ajout diffusé par un autre onglet). Deux gardes, non redondantes : le
// panneau ne montre JAMAIS que `activeSpaceId` — une génération d'agent ou
// d'une conversation d'un autre Space promeut dans SON Space (piège 18), et
// rafraîchir alors afficherait la bibliothèque de l'espace actif enrichie d'un
// fichier qui n'y est pas —, et `hidden` dit si l'onglet « Fichiers » est celui
// qu'on regarde : sinon `selectSpaceTab` re-rendra à l'ouverture, il n'y a rien
// à faire ici.
//
// Le scroll en bas est la CONSÉQUENCE du tri de `renderSpaceFilesList`
// (createdAt→id croissant, aligné sur le manifeste de contexte) : le nouvel
// arrivant y est en fin de liste. Si ce tri s'inverse un jour, ce scroll devient
// faux — ce n'est pas une préférence d'affichage, c'est « montrer l'arrivant ».
//
// `ids` (optionnel) : les records touchés, passés par la voie de synchro. Seul un
// id sans carte à l'écran justifie de descendre (libraryRefreshRevealsArrival,
// resources.js) ; sinon c'est une mise à jour sur place et la position de
// lecture est restaurée. Le constat se fait AVANT le re-rendu, qui recrée toutes
// les cartes.
//
// Un nom EN COURS D'ÉDITION diffère le re-rendu jusqu'à son blur
// (`_libraryRefreshDeferred`, vidé par wireLibraryNameEditing). Re-rendre
// maintenant retirerait le champ focalisé : le navigateur émet alors un `blur`,
// dont le handler PERSISTE le brouillon comme un renommage validé — tandis que
// la carte re-rendue montre l'ancien nom (mesuré le 2026-09-24). La liste reste
// figée le temps d'une saisie, prix accepté ; les `ids` différés sont cumulés,
// `null` (ajout local) l'emportant, pour que le rendu d'après sache encore s'il
// doit montrer un arrivant.
let _libraryRefreshDeferred = null;   // { spaceId, ids } | null
// Joue le rafraîchissement différé pendant une saisie, à la sortie du champ —
// sur TOUTES les sorties (validé, inchangé, Échap), sinon la liste resterait
// périmée jusqu'à la prochaine écriture.
function flushDeferredLibraryRefresh() {
  const deferred = _libraryRefreshDeferred;
  _libraryRefreshDeferred = null;
  if (deferred) refreshVisibleSpaceLibrary(deferred.spaceId, deferred.ids);
}
async function refreshVisibleSpaceLibrary(spaceId, ids) {
  if (!spaceId || spaceId !== activeSpaceId) return;
  const panel = $('space-files-panel');
  if (!panel || panel.hidden) return;
  const focused = document.activeElement;
  if (focused && focused.classList.contains('file-name-edit') && panel.contains(focused)) {
    const prev = _libraryRefreshDeferred;
    const merged = !ids || (prev && prev.spaceId === spaceId && !prev.ids) ? null
      : (prev && prev.spaceId === spaceId ? prev.ids.concat(ids) : ids.slice());
    _libraryRefreshDeferred = { spaceId, ids: merged };
    return;
  }
  const reveal = libraryRefreshRevealsArrival(ids, (id) => !!$('file-name-' + id));
  const keepTop = panel.scrollTop;
  await renderSpaceFilesList(spaceId);
  // Le scrolleur est le panneau entier (`.space-side-panel`, `overflow-y: auto`),
  // pas `.mem-list` qui n'a pas d'overflow propre.
  panel.scrollTop = reveal ? panel.scrollHeight : keepTop;
}

// Statut de description par carte : « description en cours… » pendant le
// calcul, puis contenu (done) ou message d'échec discret (failed) — précédent
// setMemItemLoading, mais ciblé sur les deux zones (excerpt + bouton) plutôt
// qu'un seul bouton, pour afficher le résultat sans re-render complet.
function setFileDescriptionStatus(fileId, status, description) {
  const line = $('file-description-' + fileId);
  const btns = $('file-btns-' + fileId);
  const btn = btns ? btns.querySelector('.drawer-btn:not(.danger)') : null;
  if (status === 'loading') {
    if (line) line.textContent = 'description en cours…';
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  } else if (status === 'done') {
    if (line) line.textContent = description || '';
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Régénérer la description'; }
  } else if (status === 'failed') {
    if (line) line.textContent = '';
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Générer une description'; }
  }
}

// Action manuelle « Régénérer la description » — force le calcul même si le
// toggle est OFF ou qu'une description existe déjà (contrairement au trigger
// d'ingestion).
async function onRegenerateFileDescription(btn, fileId, spaceId) {
  await describeFileIfNeeded(fileId, (status) => {
    if (status === 'done') {
      getResource(fileId).then(rec => setFileDescriptionStatus(fileId, 'done', rec && rec.description));
    } else {
      setFileDescriptionStatus(fileId, status);
    }
  }, true);
}

// Téléchargement d'un fichier de bibliothèque (lot V). L'entrée listée porte la
// méta, pas forcément les bytes : `getResource` (IDB) est la source, le cache
// session n'est qu'un raccourci — même posture que downloadAckResource, dont on
// réutilise le nommage (`resourceDownloadName`) pour ne pas avoir deux règles
// de nom de fichier. Pas de vérification de Space ici : l'id vient de la liste
// déjà scopée par `getResourcesBySpace` (piège 18, herméticité).
async function onDownloadSpaceFile(btn, fileId) {
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    let record = (typeof getCachedRecord === 'function' && getCachedRecord(fileId)) || null;
    if (!record) { try { record = await getResource(fileId); } catch (e) { record = null; } }
    if (!record || !record.data) {
      // Bouton icône : l'indisponibilité passe par la même classe `unavailable`
      // que l'ack (markAckDlUnavailable) — pas de libellé à réécrire, et un
      // seul vocabulaire visuel entre les deux surfaces.
      if (btn) {
        btn.classList.add('unavailable');
        btn.title = 'Fichier non disponible';
      }
      return;
    }
    downloadFile(
      resourceDownloadName(record.name, record.mime),
      record.data, record.mime || 'application/octet-stream');
  } finally {
    if (btn && !btn.classList.contains('unavailable')) btn.disabled = false;
  }
}

function onSpaceFilesUploadClick() {
  const input = $('space-file-input');
  if (input) { input.value = ''; input.click(); }
}

// Upload direct (voie 1) : mêmes caps que le composer (ingestLibraryFile,
// main.js), mais aucune notion d'attId/conversation ici — chaque fichier
// rejoint directement la bibliothèque du Space actif (onglet sidebar,
// indépendant de l'écran Space qui peut être fermé). Chemin d'ingestion UNIQUE
// des deux entrées utilisateur (bouton « Ajouter un fichier » et drag&drop sur
// le panneau) : une seule séquence ingestion → re-render → trigger de description.
async function ingestLibraryFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  clearSpaceFilesError();
  const spaceId = activeSpaceId;
  const stored = [];
  for (const file of files) {
    const rec = await ingestLibraryFile(spaceId, file);
    if (rec) stored.push(rec);
  }
  // Re-render AWAITÉ ici, en plus du rafraîchissement fire-and-forget déclenché
  // par storeLibraryFile : les callbacks de statut ci-dessous ciblent des ids DOM
  // (`file-description-<id>`) qui doivent exister au moment où on les branche.
  // Passer par le helper plutôt que par renderSpaceFilesList nu évite en outre
  // que les deux rendus se croisent et laissent le scroll ailleurs qu'en bas.
  await refreshVisibleSpaceLibrary(spaceId);
  if (_spaceScreenId === spaceId) syncSpaceDeleteLabel(spaceId);
  // Trigger de description après le re-render (statut par carte visible dès le premier tick) :
  // fire-and-forget, chaque fichier indépendant (pas de blocage séquentiel).
  for (const rec of stored) {
    describeFileIfNeeded(rec.id, (status) => {
      if (status === 'done') {
        getResource(rec.id).then(r => setFileDescriptionStatus(rec.id, 'done', r && r.description));
      } else {
        setFileDescriptionStatus(rec.id, status);
      }
    });
  }
}

async function onSpaceFilesSelected(input) {
  await ingestLibraryFiles(input.files);
}

// Drag&drop de fichiers vers la bibliothèque de l'espace (onglet « Fichiers »
// de la sidebar). La zone est le panneau entier (#space-files-panel, `flex: 1`
// — toute la hauteur sous les onglets), pattern .dragover identique au composer
// et au drawer skills. La condition « seulement en mode bibliothèque » est
// STRUCTURELLE, pas un test JS : le panneau porte `hidden` sur les deux autres
// onglets, il ne reçoit alors aucun événement de drag — rien à resynchroniser
// depuis selectSpaceTab. Aucun filtre de type ici (contrairement au drawer
// skills, restreint au .md) : la bibliothèque accepte les mêmes familles que le
// composer, et le tri par caps est déjà celui d'ingestLibraryFile.
function onSpaceFilesDragOver(e) {
  e.preventDefault();
  const dz = $('space-files-panel');
  if (dz) dz.classList.add('dragover');
}
function onSpaceFilesDragLeave(e) {
  const dz = $('space-files-panel');
  if (dz && (!e.relatedTarget || !dz.contains(e.relatedTarget))) dz.classList.remove('dragover');
}
function onSpaceFilesDrop(e) {
  e.preventDefault();
  const dz = $('space-files-panel');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) ingestLibraryFiles(files);
}

// Suppression d'un fichier de bibliothèque : arm-then-run (même pattern que
// la poubelle sidebar/mémoire), pas de tombstone — le brief ne prévoit pas
// de restauration (non-goal v1, mirror de C).
function onDeleteSpaceFile(btn, id, spaceId) {
  armThenRun(btn, async () => {
    await deleteResource(id);
    renderSpaceFilesList(spaceId);
    if (_spaceScreenId === spaceId) syncSpaceDeleteLabel(spaceId);
  });
}

function startEditMemoryEntry(id) {
  const btns = $('drawer-btns-' + id);
  const contentEl = $('mem-content-' + id);
  const editWrap = $('mem-edit-' + id);
  if (btns) btns.classList.add('hidden');
  if (contentEl) contentEl.hidden = true;
  if (editWrap) editWrap.classList.remove('hidden');
  const area = $('mem-edit-input-' + id);
  if (area) { area.focus(); area.selectionStart = area.selectionEnd = area.value.length; }
}

function cancelMemoryEntryEdit(id) {
  const btns = $('drawer-btns-' + id);
  const editWrap = $('mem-edit-' + id);
  const contentEl = $('mem-content-' + id);
  if (btns) btns.classList.remove('hidden');
  if (editWrap) editWrap.classList.add('hidden');
  if (contentEl) contentEl.hidden = false;
}

function saveMemoryEntryEdit(id, containerId, scope) {
  const area = $('mem-edit-input-' + id);
  if (!area) return;
  const content = area.value.trim();
  if (!content) return;
  editMemory(id, content);
  renderMemoryList(containerId, scope);
}

// ── Confirmation inline (cartes dans le thread) ───────────────────────────────

// _proposalMap[pid] = { onAccept, onReject } — callbacks, jamais les données brutes.
// const : on vide et peuple en place, on ne réassigne jamais la référence.
const _proposalMap = {};

// Purge la table et efface l'overlay. Appelée quand le DOM du thread est rasé
// (changement/réinitialisation de conversation).
function clearMemoryProposals() {
  for (const k in _proposalMap) delete _proposalMap[k];
  setConfirmPending(false);
}

// Primitif générique : une carte « question » + Accepter/Rejeter, avec overlay.
// bodyHtml : contenu HTML AUTHOR-CONTROLLED UNIQUEMENT (posé en innerHTML sans
// échappement) — jamais de donnée modèle brute ici sans escHtml au préalable.
// L'unique appelant actuel (onHalt, main.js) passe ''.
function showConfirmation(bodyHtml, onAccept, onReject) {
  const thread = $('thread');
  const pid = 'prop-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  _proposalMap[pid] = { onAccept: onAccept || function(){}, onReject: onReject || function(){} };

  const container = document.createElement('div');
  container.className = 'memory-proposals';
  const card = document.createElement('div');
  card.className = 'proposal-card';
  card.id = pid;
  card.innerHTML =
    bodyHtml +
    `<div class="proposal-actions">` +
    `<button class="mb-btn primary" onclick="acceptProposal('${pid}')">Accepter</button>` +
    `<button class="mb-btn" onclick="rejectProposal('${pid}')">Rejeter</button>` +
    `</div>`;
  container.appendChild(card);
  thread.appendChild(container);
  setConfirmPending(true);
  // behavior:'smooth' est une option JS, non couverte par le kill-switch CSS
  // (scroll-behavior:auto) : gate explicite via motionReduced() (ui.js).
  container.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'nearest' });
}

function acceptProposal(pid) {
  const e = _proposalMap[pid];
  if (!e) return;
  e.onAccept();
  delete _proposalMap[pid];
  _removeProposalCard(pid);
}

function rejectProposal(pid) {
  const e = _proposalMap[pid];
  if (!e) return;
  e.onReject();
  delete _proposalMap[pid];
  _removeProposalCard(pid);
}

function _removeProposalCard(pid) {
  const card = document.getElementById(pid);
  if (!card) return;
  const container = card.parentElement;
  card.remove();
  if (container && !container.children.length) container.remove();
  if (!Object.keys(_proposalMap).length) setConfirmPending(false);
}
