// ── Agents : sous-conversations lancées par le modèle (lot X-1) ─────────────
// Un agent EST une conversation ordinaire (décision X, question structurante 1)
// portant un champ `parentConvId`. Tout l'existant sert gratuitement —
// persistance, cache RAM à deux étages, rendu de thread, synchro multi-onglets,
// export/import — et ce qui n'a pas de sens pour un agent est exclu
// EXPLICITEMENT, jamais subi (cf. les huit sites de l'étape 2).
//
// Ligne de partage (décision 12, modèle docs.js/utils.js du lot V-7) : ce
// fichier porte le DOMAINE agent — cycle de vie, prédicats, statut, délivrance
// de résultat. Ce qui est pur et sans dépendance au domaine reste ailleurs
// (resolveActivityBadge dans utils.js, MAX_AGENTS_* dans storage.js).
//
// LECTURES DE `currentConvId` — le critère de grep du piège 28 les fait
// ressortir ici, et c'est VOULU. Trois seulement, toutes de la même nature :
// « la conversation X est-elle AFFICHÉE ? ». C'est la question d'ÉCRAN de
// genOwnsScreen, pas la question de RÉFÉRENTIEL que le piège interdit. La
// distinction est celle de docs/generations.md : « où j'écris ? » (jamais
// l'écran) et « est-ce que je peins ? » (l'écran, précisément). Les handlers
// d'outils, eux, restent sur `ctx` explicite — tools.js et api.js n'ont
// toujours aucune lecture hors toolCtx.

// ── Le prédicat de racine ───────────────────────────────────────────────────
// LE prédicat, unique (discipline spaceConvIds, piège 18). Huit sites le
// consomment ; JAMAIS un `c.parentConvId == null` réécrit localement — c'est ce
// qui décide de la tenue du lot entier.
//
// Une chaîne VIDE n'est pas un parent : `{ parentConvId: '' }` est une racine.
// C'est le cas produit par un record legacy ou une désérialisation qui pose le
// champ sans valeur — le traiter comme un agent le rendrait invisible partout
// sans que rien ne le signale.
function isRootConversation(conv) {
  return !(conv && typeof conv.parentConvId === 'string' && conv.parentConvId !== '');
}

// Le contraire, nommé pour la lisibilité des call-sites qui posent la question
// dans ce sens (« est-ce un agent ? »). Jamais une seconde formule.
function isAgentConversation(conv) {
  return !isRootConversation(conv);
}

// Enfants directs d'une conversation. Itère les MÉTADONNÉES (étage 1 du cache,
// permanent depuis U-1) : `parentConvId` doit donc figurer dans la projection de
// listAllConversations, sans quoi ce balayage ne verrait jamais rien.
// Pas de récursion : la profondeur est bornée à 1 (X-b, pas de petits-enfants).
function agentChildrenOf(convId, convs) {
  if (!convId) return [];
  return (convs || []).filter(c => c && c.parentConvId === convId);
}

// LE prédicat de libellé d'une conversation, unique (même discipline que
// isRootConversation). Un agent n'est JAMAIS titré (title: '' figé au spawn,
// exclusion 3ter) : sans ce prédicat, chaque surface qui lit `conv.title` nu
// affiche le placeholder « Nouvelle conversation » sur un agent, alors que
// `agentIntent` — rédigé par le modèle précisément pour ça — est juste à côté.
// La description d'agent__spawn le PROMET au modèle mot pour mot (« c'est ce
// libellé qui s'affichera dans la conversation à la place d'un titre ») : sans
// consommateur, cette promesse serait un mensonge
// (project_doc_promises_intent_code_never_confronted).
//
// Retourne '' plutôt que le placeholder : le fallback d'affichage appartient à
// chaque surface (la topbar veut '' pour laisser parler son :empty::before, le
// document.title veut « Nouvelle conversation »). Mélanger les deux ferait
// remonter un placeholder là où un champ vide était attendu.
//
// Retourne {text, provisional} depuis le lot AA : `provisional` vaut vrai pour
// le SEUL cas de l'extrait de secours (`snippet`), que les surfaces italisent
// pour dire « ceci n'est pas un titre ». `agentIntent` n'est PAS provisoire
// bien qu'il ne soit pas un titre non plus : il est le libellé DÉFINITIF d'un
// agent (jamais titré, exclusion 3ter), rien ne viendra le remplacer — alors
// qu'un `snippet` est en attente du titrage. Ne pas « harmoniser » les deux
// cas sans titre : ils diffèrent par ce qui va leur arriver, pas par leur forme.
//
// Ordre de priorité à ne pas inverser : title > agentIntent > snippet. Un agent
// n'écrit jamais de `snippet` (maybeWriteSnippet s'en abstient), donc le
// troisième test ne peut pas le capturer — l'ordre le garantit en défense.
function convLabel(conv) {
  if (!conv) return { text: '', provisional: false };
  if (conv.title) return { text: conv.title, provisional: false };
  if (isAgentConversation(conv)) return { text: conv.agentIntent || '', provisional: false };
  if (conv.snippet) return { text: conv.snippet, provisional: true };
  return { text: '', provisional: false };
}

// ── Statut ──────────────────────────────────────────────────────────────────
// `running` est TOUJOURS DÉRIVÉ du registre de générations, jamais persisté
// (Q5) : un agent interrompu par un reload retombe naturellement sur son statut
// terminal, sans champ supplémentaire ni zombie persisté. Seuls les états
// TERMINAUX vivent sur le record.
//
// Cinq statuts terminaux, et les cinq sont distincts dans ce qui remonte au
// parent (Q8) : il ne réagit pas pareil à « j'ai arrêté cet agent » et
// « l'utilisateur a arrêté cet agent ».
const AGENT_TERMINAL_STATUSES = ['done', 'exhausted', 'aborted', 'stopped', 'error'];

// Libellé destiné au MODÈLE (parent), par statut. Table unique : les messages de
// délivrance en dérivent, jamais une chaîne écrite au point d'usage
// (project_dispatch_table_exception_hides_false_premise — la table est la source
// qui dérive les messages).
const AGENT_STATUS_LABELS = {
  running:  'toujours en cours',
  done:     'terminé',
  exhausted: 'arrêté d\'office : il a atteint la borne de tours autorisée, son résultat est PARTIEL',
  aborted:  'interrompu par toi (agent__abort)',
  stopped:  'interrompu par l\'utilisateur',
  error:    'terminé en erreur',
};

// Libellé destiné à l'UTILISATEUR, par statut (X-1e). Table SÉPARÉE de
// AGENT_STATUS_LABELS, qui s'adresse au MODÈLE : celle-ci tutoie le lecteur
// humain (« interrompu par toi » y désigne l'utilisateur, alors que dans la
// table du modèle le même « toi » désigne le modèle qui a appelé agent__abort).
// Les fusionner ferait qu'un des deux publics lirait un texte écrit pour
// l'autre — l'utilisateur se verrait attribuer un appel d'outil qu'il n'a pas
// fait, ou le modèle lirait un statut à la deuxième personne qui parle de
// quelqu'un d'autre.
const AGENT_STATUS_UI_LABELS = {
  running:  'au travail',
  done:     'travail terminé',
  exhausted: 'arrêté : borne de tours atteinte, résultat partiel',
  aborted:  'interrompu par le modèle',
  stopped:  'interrompu',
  error:    'terminé en erreur',
};

// Statut effectif d'un agent. `running` dérivé, terminal lu sur le record.
// Un agent sans statut terminal et sans génération en vol est `aborted` : c'est
// le cas du reload (la génération n'a pas survécu, personne n'a écrit de statut).
function agentStatus(convId) {
  if (typeof isGenerating === 'function' && isGenerating(convId)) return 'running';
  const conv = loadConversation(convId);
  return (conv && conv.agentStatus) || 'aborted';
}

// Écrit le statut TERMINAL sur le record. Écriture ciblée (persistConversationField) :
// jamais un saveConversation, qui viderait les messages d'une conversation froide.
function setAgentTerminalStatus(convId, status) {
  if (!convId || AGENT_TERMINAL_STATUSES.indexOf(status) < 0) return;
  if (!loadConversation(convId)) return;   // supprimée entre-temps : ne pas ressusciter (piège 20)
  persistConversationField(convId, { agentStatus: status });
}

// ── Badges : un parent dont un enfant travaille est « working » ─────────────
// Prédicat dérivé nommé, consommé par convBadgeState (main.js) ET par les gardes
// de suppression/déplacement (étape 8). JAMAIS un balayage de _activeGenerations
// réécrit sur place — c'est le même point de discipline que hasWorkingAgent
// serait sinon le troisième prédicat qui répond à la question des badges.
// `convs` optionnel : liste de conversations déjà en main. Les agrégats de
// badges balaient toutes les conversations et appellent convBadgeState sur
// chacune — sans ce paramètre, chaque appel relirait la liste entière et le
// balayage deviendrait quadratique. Omis, on la relit (call-sites isolés :
// gardes de suppression et de déplacement).
function hasWorkingAgent(convId, convs) {
  if (!convId) return false;
  if (typeof isGenerating !== 'function') return false;
  for (const c of agentChildrenOf(convId, convs || listAllConversations())) {
    if (isGenerating(c.id)) return true;
  }
  return false;
}

// ── Bornes d'agents simultanés (Q3) ─────────────────────────────────────────
// Deux bornes, pas une, et le refus NOMME laquelle est atteinte : « 3 agents
// déjà en cours sur cette conversation » et « 5 agents en cours au total »
// appellent des gestes différents du parent (attendre l'un des siens, ou
// constater que la machine est saturée).
//
// PUR et testable : les comptes arrivent en arguments, la lecture du registre
// reste à l'appelant. Renvoie null si le lancement est permis, sinon le message
// de refus.
function agentSpawnLimitError(perConv, total, maxPerConv, maxTotal) {
  if (perConv >= maxPerConv) {
    return 'Refusé : ' + maxPerConv + ' agent' + (maxPerConv > 1 ? 's' : '') +
      ' déjà en cours sur cette conversation (borne par conversation atteinte). ' +
      'Attends qu\'un des tiens termine, ou interromps-en un avec agent__abort.';
  }
  if (total >= maxTotal) {
    return 'Refusé : ' + maxTotal + ' agent' + (maxTotal > 1 ? 's' : '') +
      ' en cours au total, toutes conversations confondues (borne globale atteinte). ' +
      'Aucun slot n\'est libre ; réessaie plus tard.';
  }
  return null;
}

// Compte les agents EN VOL d'une conversation donnée. Dérive de agentChildrenOf
// et du registre, jamais d'un second balayage.
function countWorkingAgentsOf(convId) {
  let n = 0;
  for (const c of agentChildrenOf(convId, listAllConversations())) {
    if (isGenerating(c.id)) n++;
  }
  return n;
}

// Compte les agents en vol, TOUTES conversations confondues. Un agent en vol est
// une entrée du registre dont la conversation porte un parentConvId — on ne peut
// donc pas se contenter de _activeGenerations.size, qui compte aussi les
// conversations racines (l'utilisateur qui discute pendant qu'un agent tourne).
function countWorkingAgentsTotal() {
  const byId = new Map(listAllConversations().map(c => [c.id, c]));
  let n = 0;
  for (const convId of _activeGenerations.keys()) {
    const c = byId.get(convId);
    if (c && isAgentConversation(c)) n++;
  }
  return n;
}

// ── Validation de la liste d'outils déléguée (X-e + X-i) ────────────────────
// PUR et testable (project_extract_pure_helper_over_idb_stub). Trois règles :
//  - défaut [] = AUCUN outil (le parent doit nommer ce qu'il délègue) ;
//  - nom inconnu → refus explicite LISTANT les noms valides (referme la
//    découverte sans outil dédié, motif docs__read) ;
//  - agent__spawn refusé (corollaire X-b, pas de petits-enfants).
// Renvoie { ok:true, tools:[…] } ou { ok:false, error:'…' }.
function validateAgentToolList(requested, availableNames) {
  if (requested == null) return { ok: true, tools: [] };
  if (!Array.isArray(requested)) {
    return { ok: false, error: 'Le paramètre « tools » doit être un tableau de noms d\'outils.' };
  }
  const available = availableNames || [];
  const out = [];
  for (const raw of requested) {
    const name = (typeof raw === 'string') ? raw.trim() : '';
    if (!name) continue;
    if (name === 'miaou__agent__spawn' || name === 'agent__spawn') {
      return { ok: false, error: 'Un agent ne peut pas en lancer un autre : retire « ' + name +
        ' » de la liste. La profondeur est bornée à un niveau.' };
    }
    if (available.indexOf(name) < 0) {
      return { ok: false, error: 'Outil inconnu : « ' + name + ' ». Noms valides : ' +
        available.join(', ') + '.' };
    }
    if (out.indexOf(name) < 0) out.push(name);
  }
  return { ok: true, tools: out };
}

// ── Borne de tours (décision 9) ─────────────────────────────────────────────
// Une borne sur le nombre d'échanges enchaînés, pas un budget de tokens : le
// problème est le TEMPS et l'agent zombie qui tient un slot, pas le coût.
// Pur, trivialement testable. La constante vit dans storage.js (dérivée de
// BUILD_CONFIG) et n'est lue qu'en corps de fonction.
function shouldStopAgent(turns, max) {
  const t = Number(turns), m = Number(max);
  if (!isFinite(t) || !isFinite(m) || m <= 0) return false;
  return t >= m;
}

// ── Garde de parenté (3bis) ─────────────────────────────────────────────────
// Un agent n'est adressable que PAR SON PARENT. Un id d'agent d'une autre
// conversation → « Agent introuvable. », MÊME MESSAGE qu'un id inexistant : pas
// d'oracle, même posture que conv__get hors-Space (piège 18).
//
// Prédicat UNIQUE consommé par les quatre handlers agent__* ET par l'extension
// de conv__get. `ctx` en argument explicite (piège 28) : jamais currentConvId.
const AGENT_NOT_FOUND = 'Agent introuvable.';

function resolveOwnedAgent(agentId, ctx) {
  if (!agentId || !ctx || !ctx.convId) return null;
  const conv = loadConversation(agentId);
  if (!conv) return null;
  if (isRootConversation(conv)) return null;          // pas un agent
  if (conv.parentConvId !== ctx.convId) return null;  // agent d'une autre conversation
  return conv;
}

// ── Phrase de cadrage du premier message user d'un agent (mesure 1) ─────────
// PAS une liste d'outils : le body.tools la porte déjà, la répéter serait
// redondant. La borne est d'une autre nature — l'agent lit ~10,5 ko de doctrine
// décrivant un monde plus riche que le sien (prompt système STRICTEMENT
// identique à celui du parent, X-d, pour le partage de préfixe KV). Sans
// cadrage, il peut ANNONCER qu'il va ouvrir un PDF, ou bâtir un plan qui suppose
// des outils absents : un décalage de récit, pas un appel invalide.
//
// En position de DERNIER TEXTE LU avant la tâche, donc celle qui désigne le
// destinataire (project_model_facing_text_indicative_and_reachable). Coût KV
// nul : le premier message user vient APRÈS le préfixe système, et l'agent en a
// un de toute façon.
const AGENT_SCOPE_NOTICE =
  'Tu es un agent : une conversation autonome lancée pour une tâche précise, sans ' +
  'l\'historique de celle qui t\'a lancé. Tout ce dont tu as besoin est dans la tâche ' +
  'ci-dessous.\n\n' +
  'Tes outils sont exactement ceux de ton payload, et rien d\'autre. Les doctrines du ' +
  'prompt système décrivent les capacités de l\'application dans son ensemble, pas ' +
  'nécessairement les tiennes : n\'annonce pas une action que tes outils ne te ' +
  'permettent pas. S\'il t\'en manque un pour aboutir, dis-le explicitement dans ta ' +
  'réponse — c\'est cette phrase qui permettra de te relancer avec la bonne trousse.\n\n' +
  'Ta réponse finale EST ton résultat : elle est transmise telle quelle. Sois complet ' +
  'et autonome, sans renvoyer à un contexte que ton lecteur n\'a pas.\n\n';

// Séparateur de tâche, sorti d'AGENT_SCOPE_NOTICE (X-1b) pour que le bloc des
// fichiers délégués puisse s'intercaler entre le cadrage et l'énoncé.
const AGENT_TASK_SEPARATOR = '--- Tâche ---\n\n';

// ── Fichiers délégués à un agent (X-1b) ─────────────────────────────────────
// Un agent démarre à froid, dans SA conversation : les handles du parent n'y
// résolvent rien. `att-N` est conversation-scopé (getCachedRecordByAttId filtre
// sur convId) et `file-<id>` Space-scopé — seul ce dernier passait, par héritage
// du spaceId, sans que rien ne l'annonce au modèle. Le parent ne pouvait donc PAS
// confier un fichier joint par l'utilisateur : ni par handle, ni en recopiant son
// contenu (qu'il n'a pas — un binaire n'est en contexte qu'en descripteur).
//
// Le partage est EXPLICITE, symétrique de `tools` : le parent NOMME ce qu'il
// délègue. Même raisonnement que la trousse (« un agent qui reçoit tout est un
// clone du parent »), et même posture que le piège 18 — on n'élargit pas le
// scope de resolveHandleRecord, on lui adjoint une dérogation BORNÉE à une liste
// FIGÉE au spawn.
//
// Trois décisions de forme :
//  1. RÉSOLUTION AU SPAWN, dans le référentiel du PARENT. Le handle est résolu
//     une fois, à l'instant du spawn, par le ctx du parent — jamais plus tard
//     dans celui de l'agent (qui n'y résoudrait rien) ni par une seconde
//     formule. Ce qui est figé est l'ID DE RECORD, stable et sans scope.
//  2. RÉÉCRITURE EN res_<id>. L'agent voit des handles `res_…` — une famille
//     qu'il connaît déjà, acceptée par tous les outils qui prennent un handle.
//     Pas de quatrième famille (qui aurait fallu ajouter à classifyHandleRef et
//     à la douzaine de descriptions d'outils qui énumèrent les handles admis),
//     et pas de conservation des handles du parent : `att-3` du parent
//     COLLISIONNERAIT avec le `att-3` que l'agent s'alloue lui-même s'il appelle
//     docs__render_page (reserveAttIdFor, resources.js) — deux records pour un
//     handle, et getCachedRecordByAttId rend le premier trouvé.
//  3. LE HANDLE DÉLÉGUÉ EST UN ALIAS, pas une copie. Aucun octet n'est dupliqué
//     en IDB : la table mappe alias → id de record réel, et le record reste
//     celui du parent. Un agent ne peut donc pas plus qu'y accéder en lecture,
//     ce que font déjà tous les outils à handle (readOnly sur le record).

// Alias res_… d'un record délégué. DÉTERMINISTE et sans allocation : dérivé de
// l'id de record par substitution de préfixe, donc deux délégations du même
// record dans deux agents rendent le même alias — ce qui est correct, les tables
// étant per-agent. Les trois familles de record (att_…, res_…, file_…) ont des
// suffixes indépendants, mais l'alias est toujours confronté à une table par
// agent : une collision de suffixe entre familles n'a pas de portée globale, et
// la table est la seule autorité de résolution (jamais le format de l'alias).
// Pur.
function agentDelegatedAlias(recordId) {
  const id = String(recordId || '');
  if (!id) return '';
  return 'res_' + id.replace(/^(att_|res_|file_)/, '');
}

// Table de délégation d'un agent, construite au spawn depuis les records DÉJÀ
// RÉSOLUS par le parent. Entrée : [{ ref, record }] (ref = handle parent, tel
// qu'écrit par le modèle, gardé pour le message d'erreur). Sortie :
//   { ok:true, files:[{ alias, recordId, name, mime, size, ref }] }
//   { ok:false, error:'…' }
// Un record null (handle inconnu, ou hors scope du parent) → REFUS nommant le
// handle fautif : le silence laisserait le parent croire le fichier transmis et
// l'agent conclure à son absence — deux récits faux pour un seul geste.
// Déduplication par alias (deux handles du même record = un seul fichier).
// Pur et testable (les lookups restent à l'appelant, motif validateAgentToolList).
function buildAgentDelegatedFiles(entries) {
  if (entries == null) return { ok: true, files: [] };
  if (!Array.isArray(entries)) {
    return { ok: false, error: 'Le paramètre « attachments » doit être un tableau de handles.' };
  }
  const out = [];
  const seen = [];
  for (const e of entries) {
    const ref = (e && typeof e.ref === 'string') ? e.ref.trim() : '';
    if (!ref) continue;
    const rec = e && e.record;
    if (!rec || !rec.id) {
      return { ok: false, error: 'Handle introuvable : « ' + ref + ' ». Ne délègue que des ' +
        'fichiers que tu peux toi-même adresser (att-N, file-<id> ou res_<id>).' };
    }
    const alias = agentDelegatedAlias(rec.id);
    if (seen.indexOf(alias) >= 0) continue;
    seen.push(alias);
    out.push({
      alias: alias, recordId: rec.id, ref: ref,
      name: String(rec.name || 'fichier'),
      mime: String(rec.mime || 'application/octet-stream'),
      size: Number(rec.size) || 0,
    });
  }
  return { ok: true, files: out };
}

// Table de délégation EFFECTIVE d'une conversation donnée. Deux sources, dans cet
// ordre : la génération en vol (source la plus fidèle — c'est elle qui exécute le
// tour), sinon le record persisté (agent rechargé après un reload, ou consulté
// hors génération). Impure par nature (registre + store) ; la décision qu'elle
// alimente, elle, est pure (resolveDelegatedRecordId).
//
// Rend [] pour une conversation racine : la dérogation ne s'ouvre QUE pour un
// agent. Un parent garde exactement le scope qu'il avait — c'est ce qui fait que
// X-1b n'élargit rien pour personne d'autre que l'agent, et que le prédicat
// d'herméticité (piège 18) reste seul maître du reste.
function agentDelegatedFilesOf(convId) {
  if (!convId) return [];
  const gen = (typeof generationFor === 'function') ? generationFor(convId) : null;
  if (gen && gen.agentFiles && gen.agentFiles.length) return gen.agentFiles;
  const conv = loadConversation(convId);
  if (!conv || isRootConversation(conv)) return [];
  return conv.agentFiles || [];
}

// Résolution d'un handle DANS un agent : alias → id de record réel, par la table
// figée au spawn. Rend null si l'agent n'a rien de délégué, ou si le handle n'est
// pas dans SA table — jamais une recherche élargie. C'est la borne : un agent
// n'atteint QUE ce que son parent a nommé. Pur.
function resolveDelegatedRecordId(handle, files) {
  const h = String(handle || '');
  if (!h) return null;
  for (const f of (files || [])) {
    if (f && f.alias === h) return f.recordId;
  }
  return null;
}

// Section du cadrage listant les fichiers délégués. Vient APRÈS le cadrage
// général et AVANT la tâche : le dernier texte lu avant l'énoncé
// (project_model_facing_text_indicative_and_reachable). Chaque ligne porte le
// handle ATTEIGNABLE — annoncer un fichier sans son handle serait annoncer une
// capacité sans prise. Rend '' si rien n'est délégué (pas de section vide, pas
// de « aucun fichier » : une phrase de plus dont l'agent tirerait des
// conclusions). Pur.
function formatAgentDelegatedFilesBlock(files) {
  const list = files || [];
  if (!list.length) return '';
  const lines = ['--- Fichiers mis à ta disposition ---', ''];
  for (const f of list) {
    lines.push('« ' + f.name + ' » (' + f.mime + (f.size ? ', ' + humanSize(f.size) : '') +
      ') → ' + f.alias);
  }
  lines.push('');
  lines.push('Ces handles se passent à tes outils comme n\'importe quelle ressource. ' +
    'Ils désignent les fichiers eux-mêmes, pas une copie : tu les lis, tu ne les modifies pas.');
  lines.push('');
  return lines.join('\n');
}

// Premier message user d'un agent : cadrage, fichiers délégués, puis tâche,
// dans cet ordre. Le bloc fichiers s'insère AVANT le séparateur de tâche parce
// que c'est la tâche qui doit rester le dernier texte lu ; il est vide (chaîne
// nulle) quand rien n'est délégué. Pur.
function buildAgentFirstMessage(prompt, files) {
  const block = formatAgentDelegatedFilesBlock(files);
  return AGENT_SCOPE_NOTICE + block + AGENT_TASK_SEPARATOR +
    String(prompt == null ? '' : prompt);
}

// ── Trace des échecs d'outils (mesure 3) ────────────────────────────────────
// Un échec d'outil est NON-isError délibérément dans MIAOU
// (project_tool_failure_lives_in_ack_not_iserror) : il vit dans l'ack, pas dans
// le résultat. Si le payload délivré au parent ne porte que le texte final de
// l'agent, le parent ne saura JAMAIS pourquoi c'est vide, et ne pourra pas
// relancer avec la bonne trousse.
//
// Dérive des entrées `tool-ack` du fil via `ackIsError` (utils.js), jamais un
// second prédicat. Pur et testable.
function collectAgentToolFailures(thread) {
  const out = [];
  for (const m of (thread || [])) {
    if (!m || !isAckRole(m.role)) continue;
    if (!ackIsError(m)) continue;
    const name = m.name || m.kind || 'outil';
    const detail = (typeof m.message === 'string' && m.message) ? m.message : '';
    out.push(detail ? (name + ' : ' + detail) : name);
  }
  return out;
}

// Dernier texte assistant du fil d'un agent — SON résultat. Ignore les bulles
// vides (`_acksOnly` du lot Q, bulle d'un stop sans contenu) : elles ne portent
// rien et masqueraient le vrai dernier message.
function lastAgentText(thread) {
  for (let i = (thread || []).length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      return m.content;
    }
  }
  return '';
}

// Payload délivré au parent. PUR : la composition du message est testable sans
// registre ni IDB. Porte le statut (les cinq sont distincts), l'intent, le texte
// final, et la trace des échecs d'outils.
function formatAgentResultForParent(payload) {
  const p = payload || {};
  const status = p.status || 'done';
  const label = AGENT_STATUS_LABELS[status] || status;
  const lines = ['[Résultat d\'agent — ' + label + ']'];
  if (p.intent) lines.push('Tâche confiée : ' + p.intent);
  if (p.id) lines.push('Identifiant : ' + p.id);
  const failures = p.toolFailures || [];
  if (failures.length) {
    lines.push('');
    lines.push('Outils en échec pendant son travail (' + failures.length + ') :');
    for (const f of failures) lines.push('- ' + f);
    lines.push('Si la tâche a échoué faute d\'outil, relance un agent avec la trousse corrigée ' +
      'plutôt que de conclure à un échec de la tâche.');
  }
  lines.push('');
  lines.push('--- Réponse de l\'agent ---');
  lines.push('');
  lines.push(p.text && p.text.trim() ? p.text : '(aucune réponse produite)');
  return lines.join('\n');
}

// Entrée de thread poussée dans le fil du PARENT (Q1) : message user
// AUTHENTIQUE (persisté, visible), portant un champ discriminant qui gouverne
// L'AFFICHAGE SEULEMENT — jamais le routage (ligne posée au piège 19,
// corollaire V-8). X-3 stylera `agentResult` ; X-1 le pose et le rend lisible.
//
// Jamais `_synthetic` : l'injection <miaou_context> doit pouvoir viser ce
// message (même raison qu'une interjection, lot Q).
function buildAgentResultEntry(payload, ts) {
  const content = formatAgentResultForParent(payload);
  return {
    role: 'user',
    content: content,
    ts: ts || Date.now(),
    agentResult: {
      id: (payload && payload.id) || '',
      status: (payload && payload.status) || 'done',
      intent: (payload && payload.intent) || '',
    },
  };
}

// ── Lancement d'un agent (étape 4) ──────────────────────────────────────────
// CHEMIN DÉDIÉ, pas une réutilisation de dispatchSend (option (c), tranchée par
// Julien le 2026-08-30). Motif : les hooks d'un agent sont STRUCTURELLEMENT plus
// simples — jamais d'écran à peindre, `genOwnsScreen` est faux par construction
// tant qu'on n'ouvre pas l'agent, et X-1 n'en ouvre aucun. Ce n'est donc pas une
// copie de dispatchSend, c'est sa moitié.
//
// MAIS — contrainte dure — la PERSISTANCE et la PROJECTION restent PARTAGÉES :
// persistGeneration et projectThreadToMessages sont appelés tels quels, jamais
// réécrits. Deux formules de projection divergentes feraient qu'un agent
// persisté ne serait pas relisible comme une conversation
// (docs/generations.md, « deux chemins de persistance »).
//
// Rend l'id de l'agent IMMÉDIATEMENT : jamais d'await sur sa fin.
function spawnAgent(opts) {
  const o = opts || {};
  if (!o.parentConvId) return null;
  // Id à suffixe aléatoire (project_id_generation_random_suffix) : deux spawns
  // dans le même tour d'outils s'exécutent en séquence sub-milliseconde, un id
  // purement horodaté les ferait collisionner.
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  // `spaceId` vient du CTX, jamais de activeSpaceId (piège 28) : un agent lancé
  // par une génération détachée doit naître dans le Space de SA génération, pas
  // de l'écran. Herméticité héritée et figée (X-a) — jamais d'exception.
  saveConversation({
    id: id,
    title: '',                       // jamais titré (exclusion 3ter) : agentIntent tient lieu de libellé
    timestamp: now,
    updatedAt: now,
    messages: [],
    spaceId: o.spaceId || DEFAULT_SPACE_ID,
    parentConvId: o.parentConvId,
    parentCallId: o.callId || undefined,
    agentIntent: o.intent || '',     // rendu tel quel, JAMAIS normalisé (casse du modèle)
    agentTurns: 0,
    // Table de délégation de fichiers (X-1b), PERSISTÉE sur le record : elle est
    // la seule autorité de résolution des handles de l'agent, et un agent doit
    // rester lisible/relançable après un reload. Absente quand rien n'est
    // délégué — pas de tableau vide qui ferait croire à une capacité.
    agentFiles: (o.files && o.files.length) ? o.files : undefined,
  });
  // Premier message user = cadrage + tâche (mesure 1). Le thread de l'agent
  // démarre là : PAS d'historique du parent — c'est tout l'intérêt d'un agent
  // d'isoler le contexte, et c'est aussi ce qui rend le partage de préfixe KV
  // possible (l'historique est précisément ce qui diverge après le système).
  const thread = [{ role: 'user', content: buildAgentFirstMessage(o.prompt, o.files), ts: now }];
  runAgentGeneration(id, thread, o);
  renderConvList();
  syncSpaceUI();   // pastille du parent : son enfant travaille (étape 7)
  return id;
}

// Réhydratation du cache session pour les fichiers délégués d'un agent (X-1b).
// resolveHandleRecord est SYNCHRONE (elle lit le cache), alors que le store est
// asynchrone : le cache doit donc être garni AVANT le premier appel d'outil.
// Il l'est déjà au spawn — le parent vient d'y résoudre ces mêmes records — mais
// pas nécessairement plus tard : un `resources-updated` d'un autre onglet évince
// (invalidateResourceCache, lot J), et un reload le vide entièrement. Sans ce
// filet, un agent perdrait ses fichiers en cours de vol, silencieusement et de
// façon non reproductible.
//
// Fire-and-forget ET idempotente : elle ne fait que remettre en cache ce qui y
// manque, ne touche à rien d'autre, et un échec IDB laisse simplement le handle
// introuvable (dégradation propre, comme un attId purgé au piège 19).
function rehydrateAgentDelegatedFiles(files) {
  for (const f of (files || [])) {
    if (!f || !f.recordId) continue;
    if (getCachedRecord(f.recordId)) continue;   // resources.js — déjà là, rien à faire
    getResource(f.recordId).then(function(rec) {
      if (rec) _cacheRecord(rec);   // resources.js — global du bundle concaténé
    }).catch(function() { /* handle introuvable : dégradation propre */ });
  }
}

// Boucle d'exécution d'un agent. Fire-and-forget par construction : l'appelant
// (le handler agent__spawn) ne l'attend jamais.
function runAgentGeneration(convId, thread, opts) {
  const o = opts || {};
  const gen = createAgentGeneration(convId, thread, o);
  registerGeneration(gen);
  // Filet de cache pour les fichiers délégués — avant tout appel d'outil.
  rehydrateAgentDelegatedFiles(gen.agentFiles);
  // Le payload système est celui du parent, STRICTEMENT (X-d) : buildSystemMessage()
  // tel quel, sans filtrage, sans paramètre. Mesuré le 2026-08-30 : aucune des
  // six parts de systemMessageParts() n'est conditionnée à la présence d'un
  // outil, donc restreindre la trousse de l'agent ne fait pas diverger son
  // prompt système. Le préfixe KV reste partagé avec le parent.
  const sys = buildSystemMessage();
  // matches = [] (Q4) : un agent n'a pas de passé, lui injecter les résumés
  // d'autres conversations serait un gonflement gratuit. Le reste du bloc
  // <miaou_context> est identique (date, souvenirs, manifeste de bibliothèque).
  const apiMessages = buildAgentApiMessages(sys, gen);
  // La liste d'outils DÉLÉGUÉE restreint le payload : les outils non délégués
  // ne sont pas « appelables et refusés », ils sont ABSENTS de body.tools.
  const tools = toolDefinitions(gen.agentTools, { convId: convId, spaceId: gen.spaceId });
  driveAgentConversation(gen, apiMessages, tools);
  return gen;
}

// Objet génération d'un agent. Dérive de createGeneration (main.js) pour que le
// registre, l'abort ciblé, l'épinglage de cache et les badges le voient comme
// n'importe quelle génération — puis SURCHARGE ce qui vient de l'écran.
//
// `spaceId`, `model` et `serverName` sont FIGÉS ici depuis le ctx/le parent,
// jamais relus depuis activeModel()/activeSpaceId : un agent lancé pendant que
// l'utilisateur change l'override du composer reproduirait sinon le bug payé le
// 2026-08-29 (description d'image sur le mauvais modèle).
function createAgentGeneration(convId, thread, opts) {
  const o = opts || {};
  const parent = o.parentConvId ? loadConversation(o.parentConvId) : null;
  const parentGen = o.parentConvId ? generationFor(o.parentConvId) : null;
  // Modèle et serveur HÉRITÉS du parent (décision 3, X-f) : de la génération
  // parente si elle tourne encore (source la plus fidèle : elle les a figés au
  // même titre), sinon de l'état résolu au moment du spawn.
  const model = (parentGen && parentGen.model) || activeModel();
  const serverName = (parentGen && parentGen.serverName) || ((activeApiServer() || {}).name || '');
  const gen = createGeneration(convId, thread, {
    model: model, serverName: serverName, reasoningEffort: o.reasoningEffort || '',
  });
  gen.spaceId = o.spaceId || (parent && parent.spaceId) || DEFAULT_SPACE_ID;
  gen.convModel = '';                 // l'agent n'a pas d'override de conversation propre
  gen.convReasoningEffort = o.reasoningEffort || '';
  gen.needTitle = false;              // JAMAIS titré (exclusion 3ter, étape 2)
  gen.isAgent = true;                 // discriminant de cycle de vie, jamais de routage
  gen.agentTools = o.agentTools || o.tools || [];
  // Fichiers délégués figés sur la génération (X-1b), au même titre que la
  // trousse : c'est ce que lira resolveHandleRecord pendant toute la boucle.
  gen.agentFiles = o.agentFiles || o.files || [];
  gen.agentTurns = 0;
  gen.agentIntent = o.intent || '';
  gen.parentConvId = o.parentConvId || '';
  return gen;
}

// Payload messages d'un agent : système + son fil, avec le préfixe dynamique
// <miaou_context> sur le dernier message user — MÊME géométrie que dispatchSend
// (piège 16 : le contenu dynamique reste hors du message système).
// matches = [] (Q4).
function buildAgentApiMessages(sys, gen) {
  const threadMsgs = expandThread(resolveRecallImages(resolveResourceRefs(gen.thread)));
  const lastUserIdx = threadMsgs.reduce((acc, m, i) => (m.role === 'user' && !m._synthetic) ? i : acc, -1);
  if (lastUserIdx >= 0) {
    const prefix = buildSkillsContextBlock() + buildContextBlock([]) + '\n\n---\n\n';
    const lastContent = threadMsgs[lastUserIdx].content;
    threadMsgs[lastUserIdx] = {
      role: 'user',
      content: Array.isArray(lastContent)
        ? prefixTextInContentParts(lastContent, prefix)
        : prefix + lastContent,
    };
  }
  return [sys].concat(threadMsgs.map(m =>
    m && m._synthetic ? { role: m.role, content: m.content } : m
  )).filter(Boolean);
}

// Les hooks d'un agent : la moitié « données » de ceux de dispatchSend, sans la
// moitié « écran ». AUCUN appel à startAssistantMessage, setSending, streamInto,
// placeToolAck, finalizeAssistant, showConfirmation ni recomputeLastContextManifest
// — un agent ne possède jamais l'écran en X-1, et peindre depuis ici pousserait
// une bulle dans le DOM d'une AUTRE conversation.
//
// Le point d'accroche de la délivrance au parent est le FINALLY, seul endroit
// que TOUS les cas de sortie traversent (Q8) — nominale, avortée par le modèle,
// avortée par l'utilisateur, épuisée, en erreur. Jamais le chemin nominal :
// c'est ce qui rend l'invariant vérifiable au lieu d'être une liste de
// call-sites à maintenir.
async function driveAgentConversation(gen, apiMessages, tools) {
  let sawFinal = false;
  try {
    await runConversation(apiMessages, {
      gen: gen,
      model: gen.model,
      reasoningEffort: gen.reasoningEffort,
      agentTools: gen.agentTools,   // restreint body.tools tour après tour (api.js)
      onDelta: (full) => { gen.partialContent = full; },
      onReasoning: (full) => { gen.partialReasoning = full; },
      onToolTour: (content) => {
        gen.partialContent = '';
        gen.partialReasoning = '';
        // Borne de TOURS (décision 9) : comptée à la frontière de tour, le seul
        // point que chaque échange enchaîné traverse. Atteinte → arrêt d'office,
        // statut `exhausted`, et le résultat PARTIEL est quand même délivré (avec
        // la mention explicite : un parent qui croit complet un résultat tronqué
        // prend une décision fausse).
        gen.agentTurns++;
        if (content && content.trim()) {
          const msg = { role: 'assistant', content: content, model: gen.model, ts: Date.now() };
          if (gen.serverName) msg.server = gen.serverName;
          gen.thread.push(msg);
          persistGeneration(gen);
        }
        if (shouldStopAgent(gen.agentTurns, MAX_AGENT_TURNS)) {
          gen.agentExhausted = true;
          if (gen.abort) gen.abort.abort();
        }
      },
      onEarlyAcks: () => {
        for (const ack of getPendingToolAcks()) gen.thread.push(copyAckFields(ack, { role: 'tool-ack' }));
        clearPendingToolAcks();
      },
      onToolAcks: () => {
        for (const ack of getPendingToolAcks()) gen.thread.push(copyAckFields(ack, { role: 'tool-ack' }));
        clearPendingToolAcks();
        // Blocs non-texte d'un outil distant : éphémères par conception (D8),
        // jamais persistés. Un agent n'a pas d'écran où les rendre — on les
        // draine pour ne pas les laisser fuiter dans la génération suivante.
        clearPendingToolBlocks();
      },
      onEnrichLastAck: ({ name, args, result, ts, group, assistantText }) => {
        const fields = {};
        if (name != null) fields.name = name;
        if (args != null) fields.args = args;
        if (result != null) fields.result = result;
        if (ts != null) fields.ts = ts;
        if (group != null) fields.group = group;
        if (assistantText != null) fields.assistantText = assistantText;
        updateLastPendingToolAck(fields);
      },
      // Interjections DANS le fil d'un agent (X-1f). Le lot X-1e câblait ici
      // `() => null`, au motif que la file était un état d'ÉCRAN — prémisse
      // devenue fausse dans le lot MÊME qui l'écrivait : X-1e a clefé la file
      // par conversation et fait cibler les deux drains sur `gen.convId`. Le
      // `null` restait donc en travers d'un mécanisme qui, lui, savait déjà à
      // qui appartenait la file. Un agent qui enchaîne des tool calls est
      // précisément le cas où réorienter a de la valeur : c'est le seul moment
      // où l'utilisateur voit passer un travail qui part de travers, alors que
      // le parent, lui, ne verra que le compte rendu final.
      //
      // Même corps que le drain d'écran (main.js) MOINS tout le DOM : un agent
      // n'a pas de bulle à clore, pas de wrap à rouvrir, pas de puce à animer
      // (le rail montre la file de la conversation AFFICHÉE — si c'est ce fil,
      // takePendingInterjections s'en charge ; sinon il n'y a rien à l'écran).
      // Structure alignée sur `onAgentResults` du chemin détaché, ci-dessous.
      onInterjections: async () => {
        const batch = takePendingInterjections(gen.convId);
        if (!batch.length) return null;
        const literal = joinInterjectionLiterals(batch.map(b => b.literal));
        if (!literal) return null;
        // Échec résiduel de résolution (skill désactivée pendant la génération) :
        // littéral tel quel — chaque élément a déjà passé la garde à l'enqueue.
        let r = null;
        try { r = await resolveSend(literal); } catch (e) { r = null; }
        const content = (r && r.ok) ? r.content : literal;
        gen.thread.push(buildInterjectionEntry(literal, content, Date.now()));
        persistGeneration(gen);
        return [{ role: 'user', content: content }];
      },
      onFinal: (content, reasoning, finishReason) => {
        sawFinal = true;
        const ts = Date.now();
        const msg = { role: 'assistant', content: content, model: gen.model, ts: ts };
        if (gen.serverName) msg.server = gen.serverName;
        if (reasoning && reasoning.trim()) msg.reasoning = reasoning;
        gen.thread.push(msg);
        persistGeneration(gen);
        // Le statut terminal est décidé ICI, avec le finishReason sous la main :
        // le finally ne le voit plus. `exhausted` prime sur `aborted`, car la
        // borne de tours provoque elle-même l'abort — sans cette priorité, un
        // agent épuisé remonterait comme « interrompu par toi », et le parent
        // relancerait une tâche déjà arrivée au bout de son budget.
        // Un statut DÉJÀ posé (agent__abort par le modèle, stop utilisateur) est
        // respecté : il porte une information que finishReason n'a pas.
        if (!gen.agentTerminalStatus) {
          gen.agentTerminalStatus = gen.agentExhausted ? 'exhausted'
            : (finishReason === 'aborted' ? 'stopped' : 'done');
        }
      },
      // Halte (ask_confirmation) : impossible pour un agent, l'outil n'est pas
      // dans son payload (toolDefinitions n'ajoute ASK_CONFIRMATION_DEF que
      // sans liste blanche). Le hook reste, par symétrie : s'il tournait quand
      // même, la question doit atterrir dans le fil de l'agent et non produire
      // un overlay modal sur la conversation affichée.
      onHalt: (leadIn, question) => {
        sawFinal = true;
        const text = [leadIn, question].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
        const msg = { role: 'assistant', content: text, model: gen.model, ts: Date.now() };
        if (gen.serverName) msg.server = gen.serverName;
        gen.thread.push(msg);
        persistGeneration(gen);
        if (!gen.agentTerminalStatus) gen.agentTerminalStatus = 'done';
      },
      onError: () => { gen.agentError = true; },
    });
  } catch (e) {
    gen.agentError = true;
    // Trace du plantage DANS le fil de l'agent : sans elle, ouvrir son fil
    // montrerait une conversation qui s'arrête sans rien dire, et le parent
    // recevrait un résultat vide sans cause lisible.
    gen.thread.push({ role: 'assistant', content: 'Erreur : ' + ((e && e.message) || e),
      model: gen.model, ts: Date.now() });
    persistGeneration(gen);
  } finally {
    // Résolution du statut terminal, dans l'ordre de priorité. Un statut déjà
    // posé (agent__abort par le modèle) gagne sur tout : il porte l'INTENTION,
    // que ni finishReason ni l'absence d'onFinal ne peuvent restituer.
    let status = loadAgentTerminalStatus(gen.convId) || gen.agentTerminalStatus;
    if (!status) status = gen.agentError ? 'error' : (sawFinal ? 'done' : 'stopped');
    if (gen.agentExhausted && status !== 'aborted') status = 'exhausted';
    setAgentTerminalStatus(gen.convId, status);
    persistConversationField(gen.convId, { agentTurns: gen.agentTurns });
    unregisterGeneration(gen);
    // L'écran affiche le fil de cet agent (l'utilisateur le regardait
    // travailler) : le composer doit cesser d'annoncer une génération en cours.
    // Symétrique du même appel dans driveDetachedConversation — il manquait
    // ici, et le fil d'un agent terminé gardait le placeholder « Le modèle
    // travaille » et son bouton stop. La lecture seule (X-1e) rend le défaut
    // visible : composer verrouillé ET libellé de travail en cours.
    if (gen.convId === currentConvId) setSending(isGenerating(currentConvId));
    // LE point d'entrée unique de la délivrance, sur TOUTE sortie sans
    // exception (Q8). Fire-and-forget : rien n'attend le réveil du parent.
    deliverAgentResult(gen.convId, status, gen.thread);
  }
}

// Statut terminal déjà posé sur le record — par agent__abort (le modèle) ou par
// le stop utilisateur. Lecture sans effet de bord, distincte de agentStatus()
// qui, lui, DÉRIVE `running` du registre : ici on veut savoir si quelqu'un a
// déjà tranché, pas ce que vaut l'agent maintenant.
function loadAgentTerminalStatus(convId) {
  const conv = loadConversation(convId);
  return (conv && conv.agentStatus) || '';
}

// ── Le réveil du parent (étape 6) ───────────────────────────────────────────
// Point d'entrée UNIQUE, appelé depuis le finally du cycle de vie — jamais
// depuis le chemin nominal. Sans cette règle, le stop utilisateur sur un agent
// (qui existe GRATUITEMENT : le fil de l'agent a un composer, donc un bouton
// stop qui appelle abortStream(currentConvId)) ne notifierait personne : le
// parent attendrait indéfiniment un réveil qui ne vient pas, pastille pulsante à
// l'appui — précisément « pire que pas de pastille du tout ».
async function deliverAgentResult(agentConvId, status, thread) {
  const agent = loadConversation(agentConvId);
  // Parent disparu (supprimé pendant que l'agent tournait) → rien,
  // silencieusement. Même posture que persistGeneration : on ne ressuscite
  // jamais une conversation supprimée (piège 20).
  const parentConvId = agent && agent.parentConvId;
  if (!parentConvId) { refreshAgentBadges(); return; }

  const payload = {
    id: agentConvId,
    status: status || 'done',
    intent: (agent && agent.agentIntent) || '',
    text: lastAgentText(thread || (agent && agent.messages)),
    // La trace des échecs d'outils (mesure 3) : un échec est NON-isError
    // délibérément, il vit dans l'ack. Sans elle, un agent privé du bon outil
    // rend une réponse évasive et le parent ne peut PAS savoir pourquoi, donc
    // pas relancer avec la bonne trousse.
    toolFailures: collectAgentToolFailures(thread || (agent && agent.messages)),
  };

  // Le parent doit être CHAUD pour qu'on lise et réécrive ses messages : une
  // conversation froide rend `messages: []` (étage 2 borné), et persister
  // par-dessus la viderait. C'est le seul await de cette fonction — donc le
  // point après lequel tout état doit être RELU (piège 24 (b)).
  await warmConversation(parentConvId);

  // RELECTURE APRÈS L'AWAIT, jamais un instantané pris avant : le parent a pu
  // démarrer une génération, ou être supprimé, pendant le chargement.
  // C'est le piège 24 (b) mot pour mot.
  if (!loadConversation(parentConvId)) { refreshAgentBadges(); return; }
  const entry = buildAgentResultEntry(payload, Date.now());
  const parentGen = generationFor(parentConvId);

  if (parentGen) {
    // Parent OCCUPÉ : mise en file dédiée, drainée à la frontière de tour de sa
    // génération. File DISTINCTE de _pendingInterjections (Q2) : leurs
    // conditions de drain sont OPPOSÉES — une interjection est un état d'écran
    // gardé par genOwnsScreen, un résultat d'agent ne dépend pas de l'écran.
    // Les fusionner serait exactement le motif « deux prédicats corrects
    // séparément qui divergent ».
    queueAgentResult(parentConvId, entry);
    refreshAgentBadges();
    return;
  }

  // Parent INERTE : on pousse dans son thread et on démarre une génération.
  // LE VRAI DANGER DU LOT — deux sources possibles pour le thread du parent.
  // Un prédicat nommé, une seule expression : parentThreadFor.
  const thread2 = parentThreadFor(parentConvId);
  thread2.push(entry);
  startParentWakeGeneration(parentConvId, thread2);
  refreshAgentBadges();
}

// LE prédicat de source du thread d'un parent qu'on réveille (étape 6).
// Deux sources possibles, un choix erroné ÉCRASE des messages :
//  - parent AFFICHÉ → `currentThread`, la MÊME RÉFÉRENCE que celle que
//    openConversation a adoptée. Relire le storage produirait un second tableau,
//    et le rendu resterait branché sur le premier : le message du réveil
//    n'apparaîtrait jamais à l'écran, tout en étant persisté.
//  - parent NON AFFICHÉ → `projectConvMessages(loadConversation(id))`, la
//    projection de reload. `currentThread` désigne alors une AUTRE conversation :
//    y pousser le résultat le rangerait dans le mauvais fil.
// Une seule expression, testée. Jamais réécrit localement.
function parentThreadFor(parentConvId) {
  if (parentConvId === currentConvId) return currentThread;
  return projectConvMessages(loadConversation(parentConvId));
}

// ── File des résultats d'agent (Q2) ─────────────────────────────────────────
// Map<convId, entry[]>. DÉDIÉE, jamais fusionnée avec _pendingInterjections.
const _pendingAgentResults = new Map();

function queueAgentResult(convId, entry) {
  const q = _pendingAgentResults.get(convId) || [];
  q.push(entry);
  _pendingAgentResults.set(convId, q);
}

// Drain à la frontière de tour d'une génération. Retire ET rend les entrées :
// un drain partiel les perdrait sans trace.
function takePendingAgentResults(convId) {
  const q = _pendingAgentResults.get(convId) || [];
  _pendingAgentResults.delete(convId);
  return q;
}

function hasPendingAgentResults(convId) {
  return (_pendingAgentResults.get(convId) || []).length > 0;
}

// Rafraîchissement des badges (étape 7, point 4) : au spawn ET à TOUTE fin
// d'agent, y compris anormale (abort, parent supprimé, borne épuisée). Une
// pastille qui pulse pour un travail mort est pire que pas de pastille.
function refreshAgentBadges() {
  renderConvList();
  syncSpaceUI();
  // Lecture seule d'un agent terminé (X-1e) : si le fil AFFICHÉ est justement
  // l'agent qui vient de finir, son composer doit se fermer maintenant — sinon
  // l'utilisateur, qui le regardait travailler, garde une saisie ouverte sur un
  // fil que plus personne ne lit. `applyReadonlyState` recompose les deux
  // causes ; l'appeler ici ne pose pas la nôtre, il redemande la question.
  if (typeof applyReadonlyState === 'function') applyReadonlyState();
  // Le bandeau d'agent porte le statut : il change avec lui.
  if (typeof syncAgentBanner === 'function') syncAgentBanner(loadConversation(currentConvId));
}

// ── Démarrer une génération sur le parent réveillé (étape 6) ────────────────
// LE deuxième piège structurel du lot : démarrer une génération sur une
// conversation QUI N'EST PAS AFFICHÉE est un cas que le lot T n'a jamais exercé.
// dispatchSend part TOUJOURS de l'écran — son commentaire le dit en toutes
// lettres (« un envoi part toujours de la conversation affichée, donc on possède
// l'écran ici »). Le réveil viole cette prémisse.
//
// D'où deux branches EXPLICITES, jamais un chemin unique qui « marcherait dans
// les deux cas » :
//  - parent AFFICHÉ → dispatchSend, tel quel. C'est sa prémisse exacte : l'écran
//    est possédé, la bulle, le composer et le patienteur sont légitimes. Rien à
//    dupliquer, et surtout rien à contourner.
//  - parent NON AFFICHÉ → chemin détaché ci-dessous. AUCUN appel à
//    startAssistantMessage (qui pousserait une bulle dans le DOM d'une AUTRE
//    conversation), AUCUN setSending (qui basculerait le composer d'une
//    conversation qu'on regarde et qui, elle, ne génère pas).
function startParentWakeGeneration(parentConvId, thread) {
  if (parentConvId === currentConvId) {
    // L'écran possède déjà ce thread (parentThreadFor a rendu currentThread, la
    // même référence) : il ne reste qu'à peindre le message poussé et à partir
    // par le chemin nominal.
    renderThread(currentThread);
    scrollBottom(true);
    runGenerationFromCurrentThread();
    return;
  }
  runDetachedGeneration(parentConvId, thread);
}

// Génération détachée sur une conversation non affichée. Réutilise
// l'infrastructure T-1 (registre, abort ciblé, persistGeneration) et les hooks
// « données seulement » d'un agent — ce n'est pas un hasard : un agent EST une
// génération sans écran, et le parent réveillé en arrière-plan aussi. Les deux
// partagent donc le même corps, sans copie.
//
// Différence avec un agent, et elle est réelle : le parent garde SA trousse
// d'outils complète (aucune liste blanche) et SON besoin de titrage — un parent
// réveillé peut être une conversation neuve encore sans titre.
function runDetachedGeneration(convId, thread) {
  const conv = loadConversation(convId);
  if (!conv) return null;
  if (isGenerating(convId)) return null;   // une seule génération par conversation (registre clé par convId)
  const gen = createGeneration(convId, thread, {
    model: conv.model || activeModel(),
    serverName: (activeApiServer() || {}).name || '',
    reasoningEffort: conv.reasoningEffort || activeReasoningEffort(),
  });
  // Champs figés depuis le RECORD, jamais depuis l'écran (piège 28) : l'écran
  // affiche une autre conversation, ses overrides ne sont pas ceux-ci.
  gen.spaceId = conv.spaceId || DEFAULT_SPACE_ID;
  gen.convModel = conv.model || '';
  gen.convReasoningEffort = conv.reasoningEffort || '';
  gen.needTitle = !conv.title;
  registerGeneration(gen);
  const apiMessages = buildAgentApiMessages(buildSystemMessage(), gen);
  driveDetachedConversation(gen, apiMessages);
  return gen;
}

// Boucle d'une génération détachée de parent. Même discipline que
// driveAgentConversation — muter le thread TOUJOURS, ne jamais peindre — mais
// sans borne de tours, sans statut d'agent, et avec le titrage.
async function driveDetachedConversation(gen, apiMessages) {
  try {
    await runConversation(apiMessages, {
      gen: gen,
      model: gen.model,
      reasoningEffort: gen.reasoningEffort,
      onDelta: (full) => { gen.partialContent = full; },
      onReasoning: (full) => { gen.partialReasoning = full; },
      onToolTour: (content) => {
        gen.partialContent = '';
        gen.partialReasoning = '';
        if (content && content.trim()) {
          const msg = { role: 'assistant', content: content, model: gen.model, ts: Date.now() };
          if (gen.serverName) msg.server = gen.serverName;
          gen.thread.push(msg);
          persistGeneration(gen);
        }
      },
      onEarlyAcks: () => {
        for (const ack of getPendingToolAcks()) gen.thread.push(copyAckFields(ack, { role: 'tool-ack' }));
        clearPendingToolAcks();
      },
      onToolAcks: () => {
        for (const ack of getPendingToolAcks()) gen.thread.push(copyAckFields(ack, { role: 'tool-ack' }));
        clearPendingToolAcks();
        clearPendingToolBlocks();
      },
      onEnrichLastAck: ({ name, args, result, ts, group, assistantText }) => {
        const fields = {};
        if (name != null) fields.name = name;
        if (args != null) fields.args = args;
        if (result != null) fields.result = result;
        if (ts != null) fields.ts = ts;
        if (group != null) fields.group = group;
        if (assistantText != null) fields.assistantText = assistantText;
        updateLastPendingToolAck(fields);
      },
      // File d'interjections : état d'ÉCRAN, jamais drainée par une génération
      // détachée (docs/generations.md).
      onInterjections: () => null,
      // Un autre agent peut finir pendant ce tour : même drain qu'en écran, sans
      // aucun effet DOM (la conversation n'est pas affichée par construction).
      onAgentResults: () => {
        const batch = takePendingAgentResults(gen.convId);
        if (!batch.length) return null;
        const out = [];
        for (const entry of batch) {
          gen.thread.push(entry);
          out.push({ role: 'user', content: entry.content });
        }
        persistGeneration(gen);
        return out;
      },
      onFinal: (content, reasoning, finishReason) => {
        const ts = Date.now();
        const msg = { role: 'assistant', content: content, model: gen.model, ts: ts };
        if (gen.serverName) msg.server = gen.serverName;
        if (reasoning && reasoning.trim()) msg.reasoning = reasoning;
        if (finishReason === 'length' || (finishReason === 'aborted' && content && content.trim())) {
          msg.truncated = true;
        }
        gen.thread.push(msg);
        persistGeneration(gen);
        maybeTitle(gen);
      },
      onHalt: (leadIn, question) => {
        // La question reste DANS LE FIL (message assistant persisté) : revenir
        // sur la conversation la montre, et y répondre reprend le fil. Aucune
        // carte de confirmation — c'est un overlay MODAL, et sa réponse partirait
        // sur la conversation AFFICHÉE (docs/generations.md).
        const text = [leadIn, question].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
        const msg = { role: 'assistant', content: text, model: gen.model, ts: Date.now() };
        if (gen.serverName) msg.server = gen.serverName;
        gen.thread.push(msg);
        persistGeneration(gen);
      },
      onError: () => {},
    });
  } catch (e) {
    gen.thread.push({ role: 'assistant', content: 'Erreur : ' + ((e && e.message) || e),
      model: gen.model, ts: Date.now() });
    persistGeneration(gen);
  } finally {
    unregisterGeneration(gen);
    // Si l'écran affiche cette conversation à la fin (l'utilisateur a navigué
    // dessus pendant le tour), le composer doit refléter qu'elle ne génère plus.
    if (gen.convId === currentConvId) setSending(isGenerating(currentConvId));
    // Un résultat arrivé après la dernière frontière de tour relance un réveil,
    // même règle que dans dispatchSend : sans ça, il resterait en file pour
    // toujours.
    if (hasPendingAgentResults(gen.convId)) wakeParentWithPendingAgentResults(gen.convId);
  }
}
