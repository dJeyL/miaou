/* ── mcp-select.js ──────────────────────────────────────────────────────────
   Sélecteur de serveurs MCP du composer : fonctions PURES de l'état
   coché/décoché (tests/test-mcp-select.js).

   L'état est mémorisé comme une liste de clés DÉSACTIVÉES, jamais de clés
   actives : tout ce qui n'y figure pas est actif, y compris un serveur JAMAIS
   VU. Brancher une carte l'active donc sans geste, et le défaut global d'une
   carte nouvelle n'a pas à être recopié dans chaque conversation. Une clé vaut
   `<carte>` pour la carte, ou `<carte>__<enfant>` pour un serveur agrégé
   derrière une carte proxy — un nom de carte ne contient JAMAIS `__`, le
   séparateur est donc non ambigu.

   Un serveur agrégateur (le proxy) expose les outils de ses enfants sous
   `<carte>__<enfant>__<outil>` : le DEUXIÈME segment nomme l'enfant, et c'est
   lui qu'on coche ou décoche séparément. Un serveur ordinaire expose
   `<carte>__<outil>`, deux segments seulement — aucun enfant.

   Deux règles gouvernent tout le fichier :
     - l'activité d'un nœud ne se STOCKE pas, elle se DÉDUIT : couper une carte
       coupe ses enfants sans écrire une seule clé d'enfant, et couper un enfant
       ne touche pas au parent ;
     - basculer une carte n'efface JAMAIS les clés de ses enfants : leur état
       est conservé tel quel pour la prochaine réactivation.

   Aucune fonction ne lève sur une entrée inattendue (null, undefined, type
   faux) : chacune rend la valeur neutre qui a du sens pour son appelant ([]
   pour une liste, true pour « permis », 0 pour un compte).
   ───────────────────────────────────────────────────────────────────────── */

// ── Enfants d'une carte ──────────────────────────────────────────────────────
//
// Un enfant est le DEUXIÈME segment d'un nom d'outil `<carte>__<enfant>__…`
// qui compte au moins TROIS segments NON VIDES et dont le premier vaut `card`.
// L'exigence des trois segments non vides écarte un outil PROPRE de la carte
// (`p__status`, deux segments) autant qu'un `__` collé ou en bord, qui ne
// fabrique pas un enfant.
//
// S'y ajoutent les upstreams non autorisés (`unauthorizedUpstreams`, forme
// rendue par `unauthorizedUpstreamsFromList`, utils.js) : ce sont des serveurs
// agrégés qui n'exposent ENCORE aucun outil parce qu'ils attendent une
// autorisation. Sans eux, l'utilisateur ne pourrait pas les décocher avant de
// les avoir autorisés.
//
// Résultat sans doublon, trié par ordre alphabétique (comparaison `<` simple).
// Pure, testable en QuickJS.
function mcpServerChildren(card, toolNames, unauthorized) {
  const name = typeof card === 'string' ? card : '';
  const seen = {};
  const out = [];
  const add = function (child) {
    if (!child || child.indexOf('__') >= 0) return;
    if (Object.prototype.hasOwnProperty.call(seen, child)) return;
    seen[child] = true;
    out.push(child);
  };
  if (name) {
    for (const tool of Array.isArray(toolNames) ? toolNames : []) {
      if (typeof tool !== 'string') continue;
      const segs = tool.split('__');
      if (segs.filter(s => s !== '').length < 3) continue;
      if (segs[0] !== name) continue;
      if (!segs[1]) continue;
      add(segs[1]);
    }
  }
  for (const u of Array.isArray(unauthorized) ? unauthorized : []) {
    if (!u || typeof u.name !== 'string') continue;
    add(u.name.trim());
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

// ── Arbre de sélection d'une liste de serveurs ───────────────────────────────
//
// `servers` : `[{ name, state, toolNames, unauthorizedUpstreams }]` (le `name`
// est le slug de la carte, le même que `state` de `_remoteStatus`, mcp.js). Rend
// les nœuds DANS L'ORDRE REÇU, `key === name`, `state` recopié tel quel (null
// s'il est absent) et un tableau d'enfants `{ key, name, unauthorized }` dans
// l'ordre de `mcpServerChildren`. `unauthorized` dit qu'un enfant vient de la
// liste des upstreams à autoriser (pas d'un outil), pour que le panneau puisse
// le présenter autrement.
//
// Un serveur sans `name` est ignoré : sans nom il n'a ni clé ni préfixe
// d'outil, rien à cocher.
// Pure, testable en QuickJS.
function buildMcpSelectionTree(servers) {
  const list = Array.isArray(servers) ? servers : [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s.name !== 'string' || !s.name) continue;
    const unauth = {};
    for (const u of Array.isArray(s.unauthorizedUpstreams) ? s.unauthorizedUpstreams : []) {
      if (!u || typeof u.name !== 'string') continue;
      const n = u.name.trim();
      if (!n || n.indexOf('__') >= 0) continue;
      unauth[n] = true;
    }
    const children = [];
    for (const child of mcpServerChildren(s.name, s.toolNames, s.unauthorizedUpstreams)) {
      children.push({
        key: s.name + '__' + child,
        name: child,
        unauthorized: Object.prototype.hasOwnProperty.call(unauth, child),
      });
    }
    out.push({
      key: s.name,
      name: s.name,
      state: s.state === undefined ? null : s.state,
      children: children,
    });
  }
  return out;
}

// ── Normalisation de la liste des clés désactivées ───────────────────────────
//
// La liste est une donnée d'entrée utilisateur (persistée, importée, écrite à la
// main dans un export) : on n'en garde que des chaînes non vides après trim, une
// seule fois chacune, triées. Rendre TOUJOURS un NOUVEAU tableau évite que
// l'appelant partage et mute l'état d'un autre (le tri en place d'un tableau
// reçu serait un effet de bord silencieux).
// Pure, testable en QuickJS.
function normalizeMcpDisabled(list) {
  const src = Array.isArray(list) ? list : [];
  const seen = {};
  const out = [];
  for (const v of src) {
    if (typeof v !== 'string') continue;
    const key = v.trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(seen, key)) continue;
    seen[key] = true;
    out.push(key);
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

// ── Activité et modifiabilité d'un nœud ──────────────────────────────────────
//
// Un nœud est actif si sa clé n'est pas dans la liste ET, pour un enfant, si sa
// carte parente (ce qui précède le PREMIER `__`) n'y est pas non plus : couper
// la carte coupe ses enfants sans écrire une seule clé d'enfant. L'inverse est
// faux — un parent reste actif quand un de ses enfants est coupé.
// Pure, testable en QuickJS.
function mcpNodeActive(key, disabled) {
  const list = Array.isArray(disabled) ? disabled : [];
  const k = typeof key === 'string' ? key : '';
  if (!k) return true;
  if (list.indexOf(k) >= 0) return false;
  const sep = k.indexOf('__');
  if (sep > 0 && list.indexOf(k.slice(0, sep)) >= 0) return false;
  return true;
}

// Une carte est TOUJOURS modifiable, même coupée : c'est le geste qui la
// réactive. Un enfant ne l'est que si sa carte parente est active : tant que le
// parent est coupé, son état d'enfant est figé (le geste n'aurait aucun effet
// visible, et le laisser passer rendrait l'interface menteuse).
// Pure, testable en QuickJS.
function mcpNodeEditable(key, disabled) {
  const list = Array.isArray(disabled) ? disabled : [];
  const k = typeof key === 'string' ? key : '';
  const sep = k.indexOf('__');
  if (sep <= 0) return true;
  return list.indexOf(k.slice(0, sep)) < 0;
}

// ── Bascule d'une clé ────────────────────────────────────────────────────────
//
// Rend une NOUVELLE liste normalisée où `key` a basculé : retirée si présente,
// ajoutée sinon. Basculer une carte ne touche JAMAIS aux entrées de ses enfants
// (leur état est conservé pour la prochaine réactivation) ; une clé non
// modifiable (enfant d'une carte coupée) laisse la liste inchangée. L'argument
// n'est jamais muté : la normalisation part d'une copie.
// Pure, testable en QuickJS.
function toggleMcpDisabled(disabled, key) {
  const list = normalizeMcpDisabled(disabled);
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return list;
  if (!mcpNodeEditable(k, list)) return list;
  const idx = list.indexOf(k);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(k);
  return normalizeMcpDisabled(list);
}

// ── Compte des nœuds actifs ──────────────────────────────────────────────────
//
// `tree` : la forme rendue par `buildMcpSelectionTree`. Compte les cartes ET les enfants actifs, au sens
// de `mcpNodeActive` — un enfant dont la carte est coupée n'est donc pas compté,
// même sans clé à son nom. Sert le libellé du panneau (`mcpSelectorLabel`).
// Pure, testable en QuickJS.
function countActiveMcp(tree, disabled) {
  const list = Array.isArray(tree) ? tree : [];
  let n = 0;
  for (const node of list) {
    if (!node) continue;
    const key = typeof node.key === 'string' ? node.key : node.name;
    if (mcpNodeActive(key, disabled)) n++;
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (!child) continue;
      const ck = typeof child.key === 'string' ? child.key : child.name;
      if (mcpNodeActive(ck, disabled)) n++;
    }
  }
  return n;
}

// ── Filtrage des outils proposés au modèle ───────────────────────────────────
//
// Un outil est refusé si une clé désactivée est un PRÉFIXE de son nom suivi de
// `__` : couper la carte `p` écarte `p__bench__echo`, couper l'enfant `p__bench`
// écarte `p__bench__echo` mais laisse `p__status` (outil propre de la carte) et
// `p__web__search`. Le `+ '__'` est indispensable : sans lui, `p` couperait
// aussi `pp__x`. Les outils internes (`miaou__…`) sont donc toujours permis, le
// nom `miaou` ne pouvant pas être une carte (validateMcpServerName l'interdit).
// Pure, testable en QuickJS.
function mcpToolAllowed(fullName, disabled) {
  const name = typeof fullName === 'string' ? fullName : '';
  const list = Array.isArray(disabled) ? disabled : [];
  for (const k of list) {
    if (typeof k !== 'string' || !k) continue;
    if (name.indexOf(k + '__') === 0) return false;
  }
  return true;
}

// Garde les définitions d'outils autorisées, DANS L'ORDRE reçu, dans un NOUVEAU
// tableau (les éléments eux-mêmes ne sont ni copiés ni modifiés). Un élément
// sans `name` chaîne n'est jamais adressable : écarté.
// Pure, testable en QuickJS.
function filterMcpToolDefs(defs, disabled) {
  const list = Array.isArray(defs) ? defs : [];
  const out = [];
  for (const d of list) {
    if (!d || typeof d.name !== 'string') continue;
    if (mcpToolAllowed(d.name, disabled)) out.push(d);
  }
  return out;
}

// ── Filtrage des skills servies par une carte MCP ────────────────────────────
//
// Première forme d'une URI de skill d'enfant chez le proxy : `skill://<enfant>/…`
// (le SKILL.md est `skill://<enfant>/<skill>/SKILL.md`). Le segment qui suit
// `skill://` est donc l'enfant, et la clé à consulter vaut `<carte>__<enfant>`.
//
// Une skill PROPRE du proxy porte une URI non préfixée (`skill://<skill>/…`) :
// son premier segment n'est alors un enfant que par homonymie, cas assumé.
const MCP_SKILL_CHILD_URI_RE = /^skill:\/\/([^/]+)\//;

// Une skill est permise si sa carte n'est pas coupée et, quand l'URI nomme un
// enfant (`skill://<enfant>/…`), si cet enfant n'est pas coupé non plus. Toute
// autre forme d'URI est permise : ce n'est pas une skill d'enfant identifiable.
// Pure, testable en QuickJS.
function mcpSkillAllowed(card, uri, disabled) {
  const list = Array.isArray(disabled) ? disabled : [];
  const name = typeof card === 'string' ? card : '';
  if (list.indexOf(name) >= 0) return false;
  const m = MCP_SKILL_CHILD_URI_RE.exec(typeof uri === 'string' ? uri : '');
  if (m && list.indexOf(name + '__' + m[1]) >= 0) return false;
  return true;
}

// Garde les entrées de skills autorisées, DANS L'ORDRE reçu, dans un NOUVEAU
// tableau (forme `{ name, description, server, uri }`, cf.
// `mcpSkillContextEntries`/`mcpSkillListEntries`, mcp-skills.js).
// Pure, testable en QuickJS.
function filterMcpSkillEntries(entries, disabled) {
  const list = Array.isArray(entries) ? entries : [];
  const out = [];
  for (const e of list) {
    if (!e) continue;
    if (mcpSkillAllowed(e.server, e.uri, disabled)) out.push(e);
  }
  return out;
}

// ── Résolution de l'état d'une conversation ──────────────────────────────────
//
// Une conversation qui n'a JAMAIS rien enregistré suit les défauts globaux :
// `conv.mcpDisabled` est un tableau (même vide) dès qu'un geste y a écrit, y
// compris pour tout réactiver — un tableau vide enregistré l'emporte donc sur
// les défauts. Chaque branche passe par `normalizeMcpDisabled` : la valeur
// retenue est sûre quel que soit ce que porte la conversation.
// Pure, testable en QuickJS.
function resolveMcpDisabled(conv, defaults) {
  if (conv && typeof conv === 'object' && Array.isArray(conv.mcpDisabled)) {
    return normalizeMcpDisabled(conv.mcpDisabled);
  }
  return normalizeMcpDisabled(defaults);
}

// Libellé du panneau : « N MCP ». Un compte qui n'est pas un entier ≥ 0 (absent,
// négatif, texte, NaN) se lit « 0 MCP » plutôt que de faire mentir l'interface.
// Pure, testable en QuickJS.
function mcpSelectorLabel(count) {
  const n = (typeof count === 'number' && isFinite(count) && Math.floor(count) === count && count >= 0) ? count : 0;
  return n + ' MCP';
}

/* ── Câblage IMPUR du sélecteur ──────────────────────────────────────────────
   Ce qui suit lit l'application (générations en vol, conversation affichée,
   réglages, localStorage) et touche le DOM. Les fonctions PURES ci-dessus n'en
   dépendent jamais : c'est ce qui les rend testables, et ce qui garantit qu'une
   génération ne lit pas l'écran.

   Une seule lecture impure de l'état, `mcpDisabledFor`, et deux écrivains
   seulement (le sélecteur pour la conversation affichée, la génération qui
   copie au PREMIER enregistrement).
   ───────────────────────────────────────────────────────────────────────── */

// LA lecture de l'état de sélection pour un contexte d'exécution. Unique :
// aucun appelant ne relit le record ou les défauts de son côté. Ordre voulu, du
// plus proche de l'appelant au plus lointain :
//
//   1. la GÉNÉRATION en vol de `ctx.convId` : elle a figé sa sélection à sa
//      création, et c'est elle qui construit le payload en cours — relire
//      l'écran ou le record décrirait un envoi qui n'a pas lieu ;
//   2. la conversation AFFICHÉE quand on est dessus (`currentConvMcpDisabled`,
//      variable d'écran posée à l'ouverture) ;
//   3. le record de la conversation, sinon les défauts globaux.
//
// Gardes `typeof` : les tests chargent les fichiers un par un, et mcp-select.js
// précède main.js (où vivent `generationFor`, `currentConvId` et
// `currentConvMcpDisabled`). Au runtime, tout est chargé.
function mcpDisabledFor(ctx) {
  const c = (typeof toolCtx === 'function') ? toolCtx(ctx) : (ctx || {});
  const convId = (c && c.convId !== undefined) ? c.convId : null;
  if (typeof generationFor === 'function') {
    const gen = generationFor(convId);
    if (gen && Array.isArray(gen.mcpDisabled)) return normalizeMcpDisabled(gen.mcpDisabled);
  }
  if (typeof currentConvId !== 'undefined' && convId === currentConvId
      && Array.isArray(currentConvMcpDisabled)) {
    return normalizeMcpDisabled(currentConvMcpDisabled);
  }
  const conv = convId ? loadConversation(convId) : null;
  return resolveMcpDisabled(conv || null, loadMcpDisabledDefaults());
}

// Cartes MCP ACTIVÉES dans les réglages, dans leur ordre de configuration,
// enrichies de ce qu'un nœud d'arbre doit porter : `state` (statut de session),
// `toolNames` (noms d'outils DISTANTS BRUTS, avant tout filtrage de sélection —
// c'est leur préfixe `<carte>__<enfant>__…` qui fait reconnaître un agrégateur)
// et `unauthorizedUpstreams`. Une carte jamais connectée a `state: null`.
function mcpSelectorServers() {
  const servers = (typeof loadMcpServers === 'function' ? loadMcpServers() : [])
    .filter(s => s && s.enabled !== false);
  const remote = (typeof remoteToolDefs === 'function') ? remoteToolDefs() : [];
  return servers.map(s => {
    const st = (typeof getMcpStatus === 'function') ? getMcpStatus(s.name) : null;
    return {
      name: s.name,
      state: st ? st.state : null,
      toolNames: remote.filter(t => t && typeof t.name === 'string' && t.name.indexOf(s.name + '__') === 0)
        .map(t => t.name),
      unauthorizedUpstreams: st ? st.unauthorizedUpstreams : [],
    };
  });
}

// Sélection effective de la conversation affichée, pour l'INTERFACE. Le
// sélecteur préfère la variable d'écran `currentConvMcpDisabled` à la
// génération en vol : l'utilisateur qui rebascule une carte pendant que la
// conversation génère voit SON geste (l'état du prochain envoi), pas la
// sélection figée de l'échange en cours — sinon le menu se re-rendrait sur
// l'ancienne valeur et la bascule paraîtrait sans effet. Une conversation
// vierge (variable `null`) retombe sur `mcpDisabledFor`, qui lit alors le record
// ou les défauts globaux.
function mcpDisabledOnScreen() {
  if (typeof currentConvMcpDisabled !== 'undefined' && Array.isArray(currentConvMcpDisabled)) {
    return normalizeMcpDisabled(currentConvMcpDisabled);
  }
  return mcpDisabledFor({ convId: (typeof currentConvId !== 'undefined' ? currentConvId : null) });
}

// Libellé (« N MCP ») + visibilité de la pilule. Masquée si le réglage est off,
// ou si AUCUNE carte MCP n'est activée : un sélecteur qui ne liste rien n'a pas
// d'objet. Appelée à chaque changement de serveurs (connect/disconnect), à
// l'ouverture d'une conversation et à l'application des réglages.
function syncMcpSelectorUI() {
  const box = $('composer-mcp');
  if (!box) return;
  const settings = loadSettings();
  const servers = (typeof loadMcpServers === 'function' ? loadMcpServers() : [])
    .filter(s => s && s.enabled !== false);
  if (settings.showMcpSelector === false || !servers.length) { box.hidden = true; return; }
  const tree = buildMcpSelectionTree(mcpSelectorServers());
  const active = countActiveMcp(tree, mcpDisabledOnScreen());
  const label = $('composer-mcp-label');
  if (label) label.textContent = mcpSelectorLabel(active);
  // Aucun serveur actif : même teinte effacée que le raisonnement sur « défaut »
  // (`.is-default`), la pilule ne signale alors rien d'ajouté au contexte.
  const btn = $('composer-mcp-btn');
  if (btn) btn.classList.toggle('is-default', active === 0);
  box.hidden = false;
}

function toggleComposerMcpMenu() {
  const menu = $('composer-mcp-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  if (isComposerReadonly()) return;   // cf. toggleComposerModelMenu (X-1f)
  renderComposerMcpOptions();
  menu.classList.add('show');
}

// Une ligne par nœud : case (le ✓ de `.check`, visible quand le nœud est
// coché), nom, et mentions discrètes (« hors ligne » pour un serveur en erreur,
// « à autoriser » pour un enfant qui attend une autorisation). La coche reflète
// l'état PROPRE du nœud (`disabled` ne contient pas sa clé), pas son activité
// DÉDUITE : un enfant dont la carte est coupée reste coché, simplement grisé —
// son propre état est conservé pour la prochaine réactivation de la carte.
// Un enfant non modifiable (mcpNodeEditable faux) n'a AUCUN handler.
function renderComposerMcpOptions() {
  const menu = $('composer-mcp-menu');
  if (!menu) return;
  const tree = buildMcpSelectionTree(mcpSelectorServers());
  const disabled = mcpDisabledOnScreen();
  const list = Array.isArray(disabled) ? disabled : [];
  const row = function (key, name, child, status) {
    const el = document.createElement('div');
    const checked = list.indexOf(key) < 0;
    const editable = mcpNodeEditable(key, list);
    el.className = 'model-opt' + (child ? ' mcp-child' : '')
      + (checked ? ' selected' : '') + (editable ? '' : ' mcp-node-locked');
    el.innerHTML = '<span>' + escHtml(name)
      + (status ? ' <span class="mcp-node-status">' + escHtml(status) + '</span>' : '')
      + '</span><span class="check">✓</span>';
    if (editable) el.onmousedown = (ev) => { ev.preventDefault(); pickComposerMcpKey(key); };
    menu.appendChild(el);
  };
  menu.innerHTML = '';
  for (const node of tree) {
    row(node.key, node.name, false, node.state === 'error' ? 'hors ligne' : '');
    for (const child of node.children) {
      row(child.key, child.name, true, child.unauthorized ? 'à autoriser' : '');
    }
  }
}

// Bascule une clé et l'ENREGISTRE à l'endroit voulu : défauts globaux pour une
// conversation vierge (aucun message — il n'y a pas encore d'historique à
// figer), champ `mcpDisabled` de la conversation sinon. Ne ferme pas le menu
// (sélection multiple) : il se re-rend en place. `_lastContextManifest` tombe
// pour que l'inspecteur recalcule avec la nouvelle sélection.
function pickComposerMcpKey(key) {
  const next = toggleMcpDisabled(mcpDisabledOnScreen(), key);
  const blank = !(typeof currentThread !== 'undefined' && currentThread && currentThread.length);
  if (blank) {
    saveMcpDisabledDefaults(next);
  } else if (typeof currentConvId !== 'undefined' && currentConvId) {
    currentConvMcpDisabled = next;
    persistConversationField(currentConvId, { mcpDisabled: next });
  }
  _lastContextManifest = null;
  syncContextCounter();
  syncMcpSelectorUI();
  renderComposerMcpOptions();
}
