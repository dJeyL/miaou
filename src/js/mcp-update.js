// ── Mise à jour à la demande du proxy MCP (cf. docs/mcp.md) ──────────────────
// Un serveur MCP qui publie l'extension `miaou/self-update` (miaou-mcp-servers,
// option `self_update`) expose son état git et sait avancer en fast-forward vers
// le sha qu'on lui donne. Ce fichier lit cet état, le propose, déclenche la mise
// à jour, suit le redémarrage du proxy et recharge MIAOU si et seulement si
// MIAOU est servi par ce proxy et que la mise à jour le touche.
//
// Contrat du proxy (docs/miaou-contract.md, « Mise à jour du proxy ») :
// extension publiée en ère 2026-07-28 seulement ; `miaou/update/status` rend
// `{ status: {…} }`, `miaou/update/apply { target }` rend `{ applied, restart,
// kind, before, target }` ou une erreur JSON-RPC dont `data.code` (UPDATE_*)
// se teste par égalité. Champs en snake_case sur le fil, renommés en camelCase
// ICI, à la frontière (`normalizeProxyUpdateStatus`), et nulle part ailleurs.
//
// Même surface, même cadence et même attente de retour pour le cycle de vie du
// proxy (extension `miaou/lifecycle`, publiée par tout proxy récent, sans
// option) : sa config a-t-elle changé depuis son démarrage, et redémarrage à
// la demande sous superviseur. Contrat : « Cycle de vie du proxy » du même
// docs/miaou-contract.md. Son `instance` (identité du processus, la même que
// celle des secrets volatils) est ce qui reconnaît le retour du proxy, après
// un redémarrage comme après une mise à jour.

const MCP_UPDATE_EXTENSION_ID = 'miaou/self-update';
const MCP_UPDATE_STATUS_METHOD = 'miaou/update/status';
const MCP_UPDATE_APPLY_METHOD = 'miaou/update/apply';
const MCP_LIFECYCLE_EXTENSION_ID = 'miaou/lifecycle';
const MCP_LIFECYCLE_STATUS_METHOD = 'miaou/lifecycle/status';
const MCP_LIFECYCLE_RESTART_METHOD = 'miaou/lifecycle/restart';

// États publiés par le proxy. Seuls `behind` et `dirty` portent une mise à
// jour (`update` non nul) ; `dirty` la bloque.
const PROXY_UPDATE_OFFER_STATES = ['behind', 'dirty'];
const PROXY_UPDATE_KINDS = ['miaou', 'proxy', 'both'];

// Le serveur déclare-t-il l'extension dans son DiscoverResult ? Même lecture
// que `mcpDeclaresSkillsExtension` : seule la présence de la clé compte, et un
// InitializeResult legacy ne la porte jamais.
function _mcpDeclaresExtension(result, id) {
  const caps = result && result.capabilities;
  const ext = caps && caps.extensions;
  return !!(ext && typeof ext === 'object' && Object.prototype.hasOwnProperty.call(ext, id));
}

function mcpDeclaresUpdateExtension(result) { return _mcpDeclaresExtension(result, MCP_UPDATE_EXTENSION_ID); }
function mcpDeclaresLifecycleExtension(result) { return _mcpDeclaresExtension(result, MCP_LIFECYCLE_EXTENSION_ID); }

// Sha complet (40 ou 64 hexadécimaux), seule forme qu'`apply` accepte.
function isFullGitSha(v) {
  return typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v);
}

function _updStr(v) { return typeof v === 'string' && v ? v : null; }
function _updInt(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0; }

// Contenu d'une mise à jour, ou null si sa forme est inattendue.
function _normalizeUpdateContent(u) {
  if (!u || typeof u !== 'object' || PROXY_UPDATE_KINDS.indexOf(u.kind) < 0) return null;
  const subjects = Array.isArray(u.subjects) ? u.subjects.filter(s => typeof s === 'string') : [];
  return {
    kind: u.kind,
    paths: _updInt(u.paths),
    subjects: subjects,
    subjectsTotal: Math.max(_updInt(u.subjects_total), subjects.length),
  };
}

// Réponse de `miaou/update/status` → état normalisé, ou null. Lecture
// défensive : tout ce qui n'a pas la forme du contrat vaut « rien à signaler ».
// Un `state` inconnu est GARDÉ (une version future du proxy peut en ajouter un,
// et le montrer brut vaut mieux que le taire) ; il ne porte simplement jamais
// de mise à jour. Une mise à jour sans cible valide est retirée : sans sha, il
// n'y a rien à proposer, `apply` le refuserait.
function normalizeProxyUpdateStatus(result) {
  const s = result && result.status;
  if (!s || typeof s !== 'object' || typeof s.state !== 'string' || !s.state) return null;
  const target = isFullGitSha(s.target) ? s.target : null;
  let update = PROXY_UPDATE_OFFER_STATES.indexOf(s.state) >= 0 ? _normalizeUpdateContent(s.update) : null;
  if (update && !target) update = null;
  return {
    state: s.state,
    detail: _updStr(s.detail),
    remedy: _updStr(s.remedy),
    branch: _updStr(s.branch),
    remote: _updStr(s.remote),
    head: _updStr(s.head),
    target: target,
    ahead: _updInt(s.ahead),
    behind: _updInt(s.behind),
    dirty: Array.isArray(s.dirty) ? s.dirty.filter(p => typeof p === 'string') : [],
    update: update,
    checkedAt: _updStr(s.checked_at),
    supervised: s.supervised === true,
    applying: s.applying === true,
    servedBuild: _updStr(s.served_build),
  };
}

// Une mise à jour existe-t-elle (qu'elle soit applicable ou non) ?
function proxyUpdateAvailable(status) {
  return !!(status && status.update && PROXY_UPDATE_OFFER_STATES.indexOf(status.state) >= 0);
}

// Peut-on la déclencher d'ici ? `dirty` la bloque côté proxy, l'absence de
// superviseur aussi (refus UPDATE_NOT_SUPERVISED, même pour le genre `miaou`),
// et une application en cours ailleurs serait refusée (UPDATE_IN_PROGRESS).
// Proposer un bouton que le proxy refuserait à coup sûr n'apprend rien de plus
// que la cause, que la surface dit déjà.
function proxyUpdateApplicable(status) {
  return proxyUpdateAvailable(status) && status.state === 'behind'
    && status.supervised && !status.applying && isFullGitSha(status.target);
}

// Libellé de ce qu'apporte la mise à jour, selon son genre : « mise à jour des
// serveurs MCP » est faux quand seul MIAOU change.
function proxyUpdateKindLabel(kind) {
  if (kind === 'miaou') return 'Nouvelle version de MIAOU';
  if (kind === 'both') return 'Nouvelle version de MIAOU et mise à jour des serveurs MCP';
  return 'Mise à jour des serveurs MCP';
}

// LE prédicat « MIAOU est-il servi par ce proxy ? » : page servie ET empreinte
// publiée par le proxy égale au build qui tourne. Jamais une comparaison
// d'origines (127.0.0.1 et localhost désignent le même proxy, cf. docs/pwa.md).
// À évaluer AVANT `apply` : après une mise à jour qui touche MIAOU, l'empreinte
// publiée change aussitôt et ne désigne plus la page.
function isServedByProxy(served, servedBuild, buildId) {
  return !!(served && servedBuild && buildId && servedBuild === buildId);
}

// Ce qui suit un `apply` réussi. `waitRestart` : la session meurt, attendre le
// retour du proxy. `checkReload` : relire version.json (et recharger si une
// autre empreinte est servie) — seulement si la page est servie par ce proxy
// ET que la mise à jour touche MIAOU. La décision finale de recharger reste au
// changement effectif de version.json : une mise à jour qui ne change que des
// icônes de miaou_dist ne change pas l'empreinte, et ne recharge rien.
function proxyUpdateAfterApply(result, servedByThis) {
  const r = result || {};
  return {
    waitRestart: r.restart === true,
    checkReload: !!servedByThis && (r.kind === 'miaou' || r.kind === 'both'),
  };
}

// Le proxy relu après un redémarrage est-il le NOUVEAU processus ? L'ancien
// peut encore répondre pendant son arrêt en douceur : il publie toujours
// `head` = sha d'avant. Le nouveau publie la cible, ou `head` nul tant que sa
// première sonde n'a pas rendu (`checking`). Repli seulement : un proxy qui
// déclare `miaou/lifecycle` se reconnaît à son `instance` (proxyInstanceChanged).
function proxyRestartLanded(status, before) {
  return !!status && status.head !== before;
}

// Réponse de `miaou/lifecycle/status` → état normalisé, ou null. Sans
// `instance`, la réponse n'a pas la forme du contrat : illisible (c'est le
// champ dont dépend la reconnaissance du retour). Le reste est toléré absent :
// un `config.state` manquant vaut null (rien à dire de la config), un état
// inconnu est GARDÉ tel quel, comme pour la mise à jour.
function normalizeLifecycleStatus(result) {
  const s = result && result.status;
  if (!s || typeof s !== 'object' || !_updStr(s.instance)) return null;
  const c = s.config && typeof s.config === 'object' ? s.config : {};
  const changed = Array.isArray(c.changed) ? c.changed.filter(p => typeof p === 'string' && p) : [];
  return {
    instance: s.instance,
    startedAt: _updStr(s.started_at),
    restartable: s.restartable === true,
    restarting: s.restarting === true,
    config: {
      state: _updStr(c.state),
      changed: changed,
      changedTotal: Math.max(_updInt(c.changed_total), changed.length),
      detail: _updStr(c.detail),
      layers: Array.isArray(c.layers) ? c.layers.filter(p => typeof p === 'string' && p) : [],
      checkedAt: _updStr(c.checked_at),
    },
  };
}

// Le proxy relu est-il un AUTRE processus que celui d'avant le geste ? Sans
// identité d'avant, la réponse est non : mieux vaut attendre en vain qu'annoncer
// revenu l'ancien processus, qui répond encore pendant son arrêt en douceur.
function proxyInstanceChanged(status, before) {
  return !!(status && status.instance && before && status.instance !== before);
}

// Comment reconnaître le retour du proxy après un geste qui le redémarre :
// par `instance` quand on la connaît (extension `miaou/lifecycle` déclarée et
// lue avant le geste), sinon par `head` (proxy antérieur à l'extension, qui ne
// sait se reconnaître qu'après une mise à jour).
function proxyRestartWaitPlan(instanceBefore, headBefore) {
  return instanceBefore ? { by: 'instance', before: instanceBefore } : { by: 'head', before: headBefore };
}

// Verdict d'une relecture après reconnexion. `declared` : la connexion
// nouvelle déclare l'extension que le plan lit. Ne la déclarant plus, le proxy
// est forcément un autre processus (l'ancien la publiait) : revenu, rien à
// relire — c'est le cas d'une mise à jour vers une version sans l'extension.
function proxyRestartLandedFor(plan, declared, status) {
  if (!declared) return true;
  return plan && plan.by === 'instance' ? proxyInstanceChanged(status, plan.before) : proxyRestartLanded(status, plan && plan.before);
}

// ── Cycle de vie : purs de la surface et du redémarrage ──────────────────────

// Chemins de config qui peuvent couper MIAOU du proxy relancé : l'adresse
// (`port`, `host`), l'authentification (`auth`), et le dossier de MIAOU servi
// (`miaou_dist`) quand cette page est servie par ce proxy. Un chemin listé peut
// être sans effet (une option de ligne de commande le surcharge, `--port`) :
// l'avertissement peut être de trop, jamais manquer.
const PROXY_CUT_PATHS = ['port', 'host', 'auth'];

function proxyLifecycleCutPaths(changed, servedByThis) {
  return (Array.isArray(changed) ? changed : []).filter(p =>
    PROXY_CUT_PATHS.indexOf(p) >= 0 || (p === 'miaou_dist' && !!servedByThis));
}

// Cette page est-elle (peut-être) servie par ce proxy ? Avec l'empreinte
// publiée par `miaou/update/status`, LE prédicat d'AT (`isServedByProxy`) ;
// sans elle (proxy sans `self_update`), une page servie l'est peut-être par
// lui : dans le doute, oui — l'avertissement qui en dépend ne doit pas manquer.
function proxyMaybeServesPage(served, updateStatus, buildId) {
  if (!served) return false;
  if (!updateStatus) return true;
  return isServedByProxy(served, updateStatus.servedBuild, buildId);
}

// Avertissement AVANT un redémarrage, '' s'il n'y a rien à craindre. Dit ce
// qu'il faudra faire, pas seulement que ça peut casser.
function proxyRestartWarningText(cutPaths) {
  const cut = Array.isArray(cutPaths) ? cutPaths : [];
  if (!cut.length) return '';
  const parts = [];
  if (cut.indexOf('port') >= 0 || cut.indexOf('host') >= 0) parts.push('son adresse peut changer (modifier alors l’URL de sa carte, Serveurs MCP)');
  if (cut.indexOf('auth') >= 0) parts.push('son authentification peut changer (modifier alors le jeton de sa carte)');
  if (cut.indexOf('miaou_dist') >= 0) parts.push('la version de MIAOU qu’il sert peut changer ou disparaître, cette page comprise');
  return 'La configuration modifiée touche ' + cut.join(', ') + ' : après le redémarrage, '
    + parts.join(' ; ') + '.';
}

// Ce que dit Réglages › Application de la config d'un serveur. `startedLabel` :
// l'heure du démarrage, déjà formatée par l'appelant (rien de l'Intl ici).
// `updateRestarts` : une mise à jour qui redémarre le proxy est proposée — elle
// prendra aussi la config modifiée.
function proxyLifecycleStateText(status, error, startedLabel, updateRestarts) {
  if (!status) return 'Configuration : état illisible' + (error ? ' : ' + error : '.');
  const c = status.config;
  const since = 'depuis le démarrage du proxy' + (startedLabel ? ' (' + startedLabel + ')' : '');
  let text;
  if (c.state === 'unchanged') text = 'Configuration inchangée ' + since + '.';
  else if (c.state === 'changed') {
    const more = c.changedTotal - c.changed.length;
    text = 'Configuration modifiée ' + since + ' : ' + (c.changed.length ? c.changed.join(', ') : 'clefs non précisées')
      + (more > 0 ? ' et ' + more + ' de plus' : '') + '.';
  } else if (c.state === 'invalid') {
    text = 'Configuration modifiée mais invalide : le proxy ne redémarrerait pas.' + (c.detail ? ' Cause : ' + c.detail : '');
  } else if (c.state) text = 'Configuration : état « ' + c.state + ' ».';
  else text = 'Configuration : état non publié.';
  if (status.restarting) text += ' Redémarrage du proxy en cours.';
  else if (!status.restartable) text += ' Redémarrage à faire à la main : le proxy n’a pas été lancé par son superviseur (scripts/supervise.sh).';
  else if (updateRestarts && (c.state === 'changed' || c.state === 'invalid')) text += ' La mise à jour proposée redémarrera aussi le proxy.';
  return text;
}

// Identité d'un état de config à annoncer : un toast par modification, pas par
// lecture. Le proxy ne publie pas l'empreinte de sa config, seulement les
// chemins changés : la signature les reprend, avec l'état, la cause et le
// processus. Limite : une seconde édition des MÊMES chemins, après fermeture du
// toast, ne le fait pas revenir (la ligne d'Application, elle, reste juste).
function proxyLifecycleSignature(status) {
  if (!status) return '';
  const c = status.config;
  return JSON.stringify([status.instance, c.state, c.changed, c.changedTotal, c.state === 'invalid' ? c.detail : null]);
}

// Que faire du toast de config d'un serveur après une lecture ? 'show',
// 'dismiss' ou ''. Une lecture en échec ne change rien (un proxy qui redémarre
// n'a pas perdu sa modification) ; une config revenue à l'identique, ou un
// redémarrage déjà en cours, retirent le toast.
function proxyLifecycleToastAction(status, announced) {
  if (!status) return '';
  const st = status.config.state;
  if (status.restarting || (st !== 'changed' && st !== 'invalid')) return 'dismiss';
  return proxyLifecycleSignature(status) === announced ? '' : 'show';
}

function proxyLifecycleToastText(status, serverName, showName) {
  const where = showName ? ' (« ' + serverName + ' »)' : '';
  const c = status && status.config;
  if (c && c.state === 'invalid') return 'Configuration du proxy MCP invalide' + where + (c.detail ? ' : ' + c.detail : '.');
  return 'Configuration du proxy MCP modifiée' + where + (status && status.restartable ? '.' : ', redémarrage à faire à la main.');
}

// Garde locale avant un redémarrage, sans forçage : l'utilisateur peut arrêter
// sa génération. Même raison que pour la mise à jour (proxyUpdateLocalBlock).
function proxyRestartLocalBlock(generating) {
  if (!(generating > 0)) return '';
  return 'Génération en cours : le redémarrage couperait les outils du proxy MCP. Relancer une fois la génération terminée.';
}

// Refus RESTART_TOOLS_IN_FLIGHT : le nombre d'appels à confirmer, LU DANS LE
// REFUS (tous clients confondus), jamais un compte local. null pour tout autre
// échec ; 0 si le refus ne le porte pas.
function proxyRestartInFlight(err) {
  const d = err && err.data;
  if (!d || d.code !== 'RESTART_TOOLS_IN_FLIGHT') return null;
  return typeof d.count === 'number' && isFinite(d.count) && d.count > 0 ? Math.floor(d.count) : 0;
}

function proxyRestartForceText(count) {
  const what = count > 1 ? count + ' appels d’outils en cours seront coupés'
    : count === 1 ? '1 appel d’outil en cours sera coupé' : 'Des appels d’outils en cours seront coupés';
  return what + ' (tous clients du proxy MCP confondus). Utile quand un service bloqué ne répond plus.';
}

// Texte d'un échec de `restart`, cause gardée. Code testé par ÉGALITÉ.
function proxyRestartFailureText(err) {
  const e = err || {};
  const code = e.data && typeof e.data.code === 'string' ? e.data.code : '';
  const msg = String(e.message || 'échec');
  let lead;
  if (code === 'RESTART_CONFIG_INVALID') lead = 'Redémarrage refusé, configuration invalide : ';
  else if (code === 'RESTART_NOT_SUPERVISED' || code === 'RESTART_UPDATE_IN_PROGRESS' || code === 'RESTART_TOOLS_IN_FLIGHT') lead = 'Redémarrage refusé : ';
  else if (e.timeout) lead = 'Le proxy n’a pas répondu à la demande de redémarrage : ';
  else lead = 'Redémarrage impossible : ';
  return lead + msg;
}

// L'identité du processus qui s'arrête : celle que rend `restart` (le contrat
// la donne), sinon la dernière lue.
function proxyRestartAcceptedInstance(result, fallback) {
  return _updStr(result && result.instance) || _updStr(fallback);
}

function proxyRestartTimeoutText(minutes, cutPaths) {
  const cut = Array.isArray(cutPaths) && cutPaths.length;
  return 'Le proxy MCP n’est pas revenu après ' + minutes + ' minutes. Causes probables : '
    + (cut ? 'son adresse ou son authentification ont changé (modifier sa carte, Serveurs MCP), ou ' : '')
    + 'son démarrage échoue (port déjà pris, module qui ne s’importe plus) ; le journal de son superviseur le dit.';
}

// Un geste en cours dans CET onglet suspend les propositions (toasts) des deux
// extensions : il dit lui-même où il en est.
function proxyBusyHoldsOffers(busy) {
  return busy === 'apply' || busy === 'restart' || busy === 'reboot';
}

// Texte d'un échec d'`apply`, cause gardée (le message du proxy la porte).
// Code applicatif testé par ÉGALITÉ, jamais par sous-chaîne.
function proxyUpdateFailureText(err) {
  const e = err || {};
  const code = e.data && typeof e.data.code === 'string' ? e.data.code : '';
  const msg = String(e.message || 'échec');
  const remedy = e.data && typeof e.data.remedy === 'string' && e.data.remedy ? e.data.remedy : '';
  let lead;
  if (code === 'UPDATE_ROLLED_BACK') lead = 'Mise à jour interrompue, fichiers remis à l\'état d\'avant : ';
  else if (code === 'UPDATE_ROLLBACK_FAILED') lead = 'Mise à jour interrompue, et le retour arrière a échoué : ';
  else if (code === 'UPDATE_STALE') lead = 'L\'état du proxy a changé depuis la proposition : ';
  else if (code.indexOf('UPDATE_') === 0) lead = 'Mise à jour refusée : ';
  else if (e.timeout) lead = 'Le proxy n\'a pas répondu à la demande de mise à jour : ';
  else lead = 'Mise à jour impossible : ';
  return lead + msg + (remedy ? ' Commande de retour arrière : ' + remedy : '');
}

// ── Lecture de l'état ────────────────────────────────────────────────────────
// Un état par serveur, en mémoire seulement : { status, error, readAt }.
// `status` null avec `error` : la lecture a échoué (proxy coupé, réponse
// illisible). Chaque lecture porte un numéro : une réponse plus ancienne
// arrivée après une plus récente est jetée (deux lectures croisées, retour de
// focus pendant le minuteur).
let _proxyUpdates = {};
const _proxyUpdateReadSeq = {};

function proxyUpdateEntry(name) { return _proxyUpdates[name] || null; }

async function readProxyUpdateStatus(server, refresh) {
  if (!server) return null;
  const name = server.name;
  const seq = (_proxyUpdateReadSeq[name] || 0) + 1;
  _proxyUpdateReadSeq[name] = seq;
  let status = null, error = null;
  try {
    status = normalizeProxyUpdateStatus(await mcpRpc(server, MCP_UPDATE_STATUS_METHOD, refresh ? { refresh: true } : {}));
    if (!status) error = 'réponse illisible';
  } catch (e) {
    error = (e && e.message) || 'échec';
  }
  if (_proxyUpdateReadSeq[name] !== seq) return status;   // une lecture plus récente a eu lieu
  _proxyUpdates[name] = { status: status, error: error, readAt: Date.now() };
  if (typeof syncProxyUpdateSurfaces === 'function') syncProxyUpdateSurfaces();
  return status;
}

// Appelé par `connectMcpServer` à chaque connexion réussie d'un serveur qui
// déclare l'extension. Une connexion relit l'état : c'est ce qui retire, dans
// un onglet voisin, la proposition d'une mise à jour déjà faite ici (le proxy
// a redémarré, l'onglet s'est reconnecté). Sans attente : la connexion ne
// dépend pas de cette lecture.
function onProxyUpdateServerConnected(server) {
  readProxyUpdateStatus(server, false);
}

// Cycle de vie : même rangement, même numérotation des lectures. `status` relit
// la config à chaque appel côté proxy : « vérifier » = relire, sans paramètre.
let _proxyLifecycle = {};
const _proxyLifecycleReadSeq = {};

function proxyLifecycleEntry(name) { return _proxyLifecycle[name] || null; }

async function readProxyLifecycleStatus(server) {
  if (!server) return null;
  const name = server.name;
  const seq = (_proxyLifecycleReadSeq[name] || 0) + 1;
  _proxyLifecycleReadSeq[name] = seq;
  let status = null, error = null;
  try {
    status = normalizeLifecycleStatus(await mcpRpc(server, MCP_LIFECYCLE_STATUS_METHOD, {}));
    if (!status) error = 'réponse illisible';
  } catch (e) {
    error = (e && e.message) || 'échec';
  }
  if (_proxyLifecycleReadSeq[name] !== seq) return status;   // une lecture plus récente a eu lieu
  _proxyLifecycle[name] = { status: status, error: error, readAt: Date.now() };
  if (typeof syncProxyUpdateSurfaces === 'function') syncProxyUpdateSurfaces();
  return status;
}

// Appelé par `connectMcpServer` à chaque connexion réussie d'un serveur qui
// déclare `miaou/lifecycle`. Sans attente, comme pour la mise à jour.
function onProxyLifecycleServerConnected(server) {
  readProxyLifecycleStatus(server);
}

// ── Textes de la surface (purs) ──────────────────────────────────────────────

function _commitCount(n) { return n + (n > 1 ? ' commits' : ' commit'); }

// Ce que dit Réglages › Application de l'état d'un serveur. `error` : la
// dernière lecture a échoué (`status` alors null). Chaque état non nominal
// porte sa cause en clair, puis la cause brute du proxy (`detail`) et la
// commande à lancer (`remedy`) quand il en publie une.
function proxyUpdateStateText(status, error) {
  if (!status) return 'État illisible' + (error ? ' : ' + error : '.');
  const s = status;
  let text;
  switch (s.state) {
    case 'checking':
      text = 'Vérification en cours (première sonde du proxy depuis son démarrage).'; break;
    case 'up_to_date':
      text = 'À jour.' + (s.dirty.length ? ' Fichiers suivis modifiés dans le clone du proxy : ' + s.dirty.length + '.' : ''); break;
    case 'behind':
      text = proxyUpdateKindLabel(s.update && s.update.kind) + ' disponible : ' + _commitCount(s.behind) + ' de retard.';
      if (s.applying) text += ' Mise à jour en cours.';
      else if (!s.supervised) text += ' Le proxy n\'a pas été lancé par son superviseur (scripts/supervise.sh) : il ne redémarrerait pas, mise à jour à faire à la main.';
      break;
    case 'dirty':
      text = proxyUpdateKindLabel(s.update && s.update.kind) + ' disponible, mais bloquée : fichiers suivis modifiés dans le clone du proxy ('
        + s.dirty.slice(0, 3).join(', ') + (s.dirty.length > 3 ? '…' : '') + ').'; break;
    case 'ahead':
      text = 'Le clone du proxy a ' + _commitCount(s.ahead) + ' d\'avance sur sa branche distante : rien à prendre.'; break;
    case 'diverged':
      text = 'Le clone du proxy a divergé de sa branche distante (' + s.ahead + ' en avance, ' + s.behind + ' en retard) : à réconcilier à la main.'; break;
    case 'not_tracking':
      text = 'La branche du proxy ne suit aucune branche distante.'; break;
    case 'auth_required':
      text = 'Le dépôt distant demande une authentification : lancer git fetch à la main dans le clone du proxy, qui ouvrira la fenêtre d\'authentification.'; break;
    case 'fetch_failed':
      text = 'Dépôt distant injoignable.'; break;
    case 'not_a_clone':
      text = 'Le proxy ne tourne pas depuis un clone git : pas de mise à jour à la demande.'; break;
    case 'git_missing':
      text = 'git est introuvable sur la machine du proxy.'; break;
    case 'repo_refused':
      text = 'git refuse le dépôt du proxy (propriétaire différent).'; break;
    case 'git_error':
      text = 'Erreur git.'; break;
    default:
      text = 'État « ' + s.state + ' ».';
  }
  const nominal = s.state === 'checking' || s.state === 'up_to_date' || s.state === 'behind';
  if (s.detail && !nominal) text += ' Cause : ' + s.detail;
  if (s.remedy) text += ' Commande : ' + s.remedy;
  return text;
}

// Texte du toast qui propose une mise à jour disponible. Le nom du serveur
// n'apparaît que s'il en existe plusieurs à proposer une mise à jour : le cas
// courant est un seul proxy, dont le libellé de carte n'apprend rien.
function proxyUpdateToastText(status, serverName, showName) {
  const where = showName ? ' (« ' + serverName + ' »)' : '';
  const base = proxyUpdateKindLabel(status && status.update && status.update.kind) + ' disponible' + where;
  return proxyUpdateApplicable(status) ? base + '.' : base + ', à faire à la main.';
}

// Que faire du toast d'un serveur après une lecture ? 'show', 'dismiss' ou ''.
// `announced` : la cible déjà proposée pendant cette session. Une proposition
// par cible : fermé à la croix, le toast ne revient pas à chaque lecture,
// seulement si une AUTRE cible paraît. Une lecture en échec ne change rien :
// un proxy injoignable (il redémarre, peut-être) ne dit pas que la mise à jour
// a disparu. Seule une lecture lisible qui ne propose plus rien retire le toast.
function proxyUpdateToastAction(status, announced) {
  if (!status) return '';
  if (!proxyUpdateAvailable(status) || status.applying) return 'dismiss';
  return status.target === announced ? '' : 'show';
}

// Garde locale avant `apply` : la seule que le proxy ne porte pas. Il refuse
// lui-même tant que des appels d'outils sont en vol (tous clients confondus),
// mais une génération de cet onglet ENTRE deux appels n'en a pas en vol, et
// verrait au suivant un proxy en plein redémarrage. Sans objet pour le genre
// `miaou`, qui ne redémarre rien.
function proxyUpdateLocalBlock(kind, generating) {
  if (kind === 'miaou' || !(generating > 0)) return '';
  return 'Génération en cours : la mise à jour redémarre le proxy MCP, dont les outils seraient coupés. Relancer une fois la génération terminée.';
}

// Faut-il relire l'état maintenant (retour de focus) ? Le minuteur, lui, lit
// sans condition : il EST la cadence.
function shouldReadProxyUpdates(lastRead, now, minIntervalMs) {
  return !lastRead || now - lastRead >= minIntervalMs;
}

// ── Cadence ──────────────────────────────────────────────────────────────────
// Le proxy sonde son dépôt toutes les 5 min et met le résultat en cache : lire
// `status` ne coûte qu'un aller-retour local. MIAOU lit à la connexion, sur un
// minuteur de la même période (suspendu quand la page est cachée : un onglet
// caché n'affiche rien, et le navigateur bride ses minuteurs), et au retour de
// focus ou de visibilité, au plus une fois par minute.
const PROXY_UPDATE_POLL_MS = 300000;
const PROXY_UPDATE_FOCUS_MIN_INTERVAL_MS = 60000;
// `apply` refait au besoin un fetch, puis un fast-forward : plusieurs appels git
// bornés côté proxy (réseau 30 s, merge 120 s). Le délai de la carte (30 s par
// défaut) le couperait en plein travail ; celui-ci couvre la somme.
const PROXY_UPDATE_APPLY_TIMEOUT_S = 240;
let _proxyUpdatePollTimer = null;
let _proxyUpdateLastRead = 0;
const _proxyUpdateAnnounced = {};   // nom → cible déjà proposée en toast
const _proxyUpdateBusy = {};        // nom → geste en cours dans CET onglet ('apply', 'check'…)

// Serveurs qui déclarent l'extension, connectés.
function proxyUpdateServers() {
  return listEnabledMcpServers().filter(s => {
    const st = getMcpStatus(s.name);
    return !!(st && st.state === 'ok' && st.updateDeclared);
  });
}

// Serveurs qui déclarent `miaou/lifecycle`, connectés.
function proxyLifecycleServers() {
  return listEnabledMcpServers().filter(s => {
    const st = getMcpStatus(s.name);
    return !!(st && st.state === 'ok' && st.lifecycleDeclared);
  });
}

// Une cadence pour les deux extensions : c'est le retour de focus qui compte
// pour la config (on l'édite ailleurs, puis on revient dans MIAOU).
async function checkProxyUpdates(fromTimer) {
  const now = Date.now();
  if (!fromTimer && !shouldReadProxyUpdates(_proxyUpdateLastRead, now, PROXY_UPDATE_FOCUS_MIN_INTERVAL_MS)) return;
  _proxyUpdateLastRead = now;
  pruneProxyUpdates();
  await Promise.all(proxyUpdateServers().map(s => readProxyUpdateStatus(s, false))
    .concat(proxyLifecycleServers().map(s => readProxyLifecycleStatus(s))));
}

function startProxyUpdatePolling() {
  if (_proxyUpdatePollTimer || typeof setInterval !== 'function') return;
  _proxyUpdatePollTimer = setInterval(function () {
    if (typeof document !== 'undefined' && document.hidden) return;
    checkProxyUpdates(true);
  }, PROXY_UPDATE_POLL_MS);
}

// Oublie les serveurs supprimés, désactivés, ou reconnectés sans l'extension
// (option retirée côté proxy, proxy remplacé par une version qui ne la publie
// pas). Un serveur en erreur ou en cours de connexion garde son entrée : un
// proxy qui redémarre n'a perdu ni sa mise à jour ni sa config modifiée.
function pruneProxyUpdates() {
  const enabled = listEnabledMcpServers().map(s => s.name);
  const gone = (name, flag) => {
    const st = getMcpStatus(name);
    return enabled.indexOf(name) < 0 || !!(st && st.state === 'ok' && !st[flag]);
  };
  Object.keys(_proxyUpdates).forEach(name => {
    if (!gone(name, 'updateDeclared')) return;
    delete _proxyUpdates[name];
    delete _proxyUpdateAnnounced[name];
    dismissToast(proxyUpdateToastKey(name));
  });
  Object.keys(_proxyLifecycle).forEach(name => {
    if (!gone(name, 'lifecycleDeclared')) return;
    delete _proxyLifecycle[name];
    delete _proxyLifecycleAnnounced[name];
    dismissToast(proxyLifecycleToastKey(name));
  });
  syncProxyUpdateSurfaces();
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

function proxyUpdateToastKey(name) { return 'proxy-update:' + name; }
function proxyLifecycleToastKey(name) { return 'proxy-lifecycle:' + name; }

const _proxyLifecycleAnnounced = {};   // nom → signature de la config déjà annoncée en toast
let _proxyRestartCardSig = '';

// Point de passage après toute lecture ou tout geste : toasts, Application, et
// cartes du drawer MCP — re-rendues seulement si leur bouton « Redémarrer »
// change (une lecture cadencée qui ne change rien ne reconstruit rien).
function syncProxyUpdateSurfaces() {
  syncProxyUpdateToasts();
  syncProxyLifecycleToasts();
  syncProxyUpdateSurface();
  if (typeof document === 'undefined') return;
  const sig = JSON.stringify(Object.keys(_proxyLifecycle).sort().map(n => {
    const st = _proxyLifecycle[n].status;
    return [n, !!(st && st.restartable), _proxyUpdateBusy[n] || ''];
  }));
  if (sig === _proxyRestartCardSig) return;
  _proxyRestartCardSig = sig;
  if (typeof renderMcpServersIfOpen === 'function') renderMcpServersIfOpen();
}

function syncProxyUpdateToasts() {
  const names = Object.keys(_proxyUpdates);
  const offering = names.filter(n => _proxyUpdates[n].status && proxyUpdateAvailable(_proxyUpdates[n].status));
  names.forEach(name => {
    const status = _proxyUpdates[name].status;
    // Un geste en cours ici dit lui-même où il en est : pas de proposition
    // par-dessus.
    if (proxyBusyHoldsOffers(_proxyUpdateBusy[name])) return;
    const action = proxyUpdateToastAction(status, _proxyUpdateAnnounced[name]);
    if (action === 'dismiss') {
      delete _proxyUpdateAnnounced[name];
      dismissToast(proxyUpdateToastKey(name));
      return;
    }
    if (action !== 'show') return;
    _proxyUpdateAnnounced[name] = status.target;
    showToast({ key: proxyUpdateToastKey(name), level: 'info', theme: 'update', persistent: true,
      text: proxyUpdateToastText(status, name, offering.length > 1),
      action: proxyUpdateApplicable(status)
        ? { label: 'Mettre à jour', run: function () { applyProxyUpdate(name); } }
        : { label: 'Réglages › Application', run: function () { openSettingsCategory('application'); } } });
  });
}

// Toast de config : une fois par modification (`proxyLifecycleSignature`),
// persistant. `changed` : action « Redémarrer » sous superviseur, sinon vers
// Réglages › Application ; `invalid` : erreur, sans action, cause gardée.
function syncProxyLifecycleToasts() {
  const names = Object.keys(_proxyLifecycle);
  const offering = names.filter(n => {
    const st = _proxyLifecycle[n].status;
    return !!(st && (st.config.state === 'changed' || st.config.state === 'invalid'));
  });
  names.forEach(name => {
    const status = _proxyLifecycle[name].status;
    if (proxyBusyHoldsOffers(_proxyUpdateBusy[name])) return;
    const action = proxyLifecycleToastAction(status, _proxyLifecycleAnnounced[name]);
    if (action === 'dismiss') {
      delete _proxyLifecycleAnnounced[name];
      dismissToast(proxyLifecycleToastKey(name));
      return;
    }
    if (action !== 'show') return;
    _proxyLifecycleAnnounced[name] = proxyLifecycleSignature(status);
    const invalid = status.config.state === 'invalid';
    const opts = { key: proxyLifecycleToastKey(name), level: invalid ? 'error' : 'info', theme: 'update', persistent: true,
      text: proxyLifecycleToastText(status, name, offering.length > 1) };
    if (!invalid) {
      opts.action = status.restartable
        ? { label: 'Redémarrer', run: function () { restartProxy(name); } }
        : { label: 'Réglages › Application', run: function () { openSettingsCategory('application'); } };
    }
    showToast(opts);
  });
}

function _proxyDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function _proxyUpdateCheckedLabel(iso) {
  const label = _proxyDateLabel(iso);
  return label ? ' Dernière vérification du proxy : ' + label + '.' : '';
}

// Le proxy sert-il (peut-être) cette page ? Cf. proxyMaybeServesPage.
function proxyMaybeServesThisPage(name) {
  const upd = proxyUpdateEntry(name);
  return proxyMaybeServesPage(pageIsServed(), upd && upd.status, BUILD_ID);
}

function _proxyButton(label, disabled, run) {
  const b = document.createElement('button');
  b.className = 'btn-ghost';
  b.type = 'button';
  b.textContent = label;
  b.disabled = !!disabled;
  b.addEventListener('click', run);
  return b;
}

// Réglages › Application : l'état durable, serveur par serveur — mise à jour
// (miaou/self-update) et config (miaou/lifecycle), chacune si le serveur la
// déclare. Rendu à chaque lecture et à chaque ouverture des réglages ; rien à
// faire si le drawer n'a pas été construit (le conteneur manque).
function syncProxyUpdateSurface() {
  const list = typeof document !== 'undefined' && document.getElementById('proxy-update-list');
  if (!list) return;
  const names = [];
  const add = n => { if (names.indexOf(n) < 0) names.push(n); };
  proxyUpdateServers().forEach(s => add(s.name));
  proxyLifecycleServers().forEach(s => add(s.name));
  Object.keys(_proxyUpdates).forEach(add);
  Object.keys(_proxyLifecycle).forEach(add);
  list.textContent = '';
  if (!names.length) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Aucun serveur MCP connecté ne propose de mise à jour ni de redémarrage à la demande (proxy MCP de miaou-mcp-servers ; la mise à jour demande en plus son option self_update).';
    list.appendChild(hint);
    return;
  }
  names.forEach(name => {
    const st = getMcpStatus(name);
    const entry = _proxyUpdates[name] || null;
    const status = entry && entry.status;
    const lc = _proxyLifecycle[name] || null;
    const lcStatus = lc && lc.status;
    const hasUpdate = !!(entry || (st && st.updateDeclared));
    const hasLifecycle = !!(lc || (st && st.lifecycleDeclared));
    const busy = _proxyUpdateBusy[name] || '';
    const row = document.createElement('div');
    row.className = 'proxy-update-row';
    row.setAttribute('data-server', name);
    const line = (cls, t) => {
      const el = document.createElement('span');
      el.className = 'hint ' + cls;
      el.textContent = t;
      row.appendChild(el);
    };
    const head = names.length > 1 ? '« ' + name + ' » : ' : '';
    if (busy === 'reboot') line('proxy-busy', head + 'Redémarrage du proxy en cours…');
    else if (busy === 'apply') line('proxy-busy', head + 'Mise à jour en cours…');
    else if (busy === 'restart') line('proxy-busy', head + 'Mise à jour appliquée, redémarrage du proxy en cours…');
    else {
      if (hasUpdate) {
        line('proxy-update-state', head + (!entry ? 'Lecture de l\'état en cours…'
          : proxyUpdateStateText(status, entry.error) + _proxyUpdateCheckedLabel(status && status.checkedAt)));
      }
      if (status && proxyUpdateAvailable(status) && status.update.subjects.length) {
        const ul = document.createElement('ul');
        ul.className = 'proxy-update-subjects';
        status.update.subjects.forEach(subject => {
          const li = document.createElement('li');
          li.textContent = subject;
          ul.appendChild(li);
        });
        const more = status.update.subjectsTotal - status.update.subjects.length;
        if (more > 0) {
          const li = document.createElement('li');
          li.className = 'proxy-update-more';
          li.textContent = 'et ' + _commitCount(more) + ' de plus';
          ul.appendChild(li);
        }
        row.appendChild(ul);
      }
      if (hasLifecycle) {
        const updateRestarts = !!(status && proxyUpdateAvailable(status) && status.update.kind !== 'miaou');
        line('proxy-lifecycle-state', (hasUpdate ? '' : head) + (!lc ? 'Lecture de la configuration en cours…'
          : proxyLifecycleStateText(lcStatus, lc.error, _proxyDateLabel(lcStatus && lcStatus.startedAt), updateRestarts)));
      }
    }
    const btns = document.createElement('div');
    btns.className = 'btn-row';
    if (proxyUpdateApplicable(status)) btns.appendChild(_proxyButton('Mettre à jour', busy, function () { applyProxyUpdate(name); }));
    // Toujours présent sous superviseur, config modifiée ou non : le
    // redémarrage volontaire est un geste en soi.
    if (lcStatus && lcStatus.restartable) {
      const b = _proxyButton('Redémarrer', busy || lcStatus.restarting, function () { restartProxy(name); });
      b.classList.add('proxy-restart-btn');
      btns.appendChild(b);
    }
    btns.appendChild(_proxyButton('Vérifier maintenant', busy || !getMcpServer(name), function () { onProxyUpdateCheckNow(name); }));
    row.appendChild(btns);
    list.appendChild(row);
  });
}

// Bouton « Redémarrer » de la carte du serveur (drawer Serveurs MCP), appelé
// par `buildMcpCard` : seulement si la carte déclare l'extension et que le
// proxy est relançable par son superviseur.
function appendProxyRestartButton(parent, name, liveStatus) {
  if (!liveStatus || liveStatus.state !== 'ok' || !liveStatus.lifecycleDeclared) return;
  const lc = proxyLifecycleEntry(name);
  const st = lc && lc.status;
  if (!st || !st.restartable) return;
  const busy = _proxyUpdateBusy[name] || '';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'drawer-btn mcp-restart';
  b.textContent = busy === 'reboot' ? 'Redémarrage…' : 'Redémarrer';
  b.disabled = !!busy || st.restarting;
  setTip(b, 'Redémarrer le proxy MCP (il relit sa configuration)');
  b.addEventListener('click', function () { restartProxy(name); });
  parent.appendChild(b);
}

// « Vérifier maintenant » : force une sonde du dépôt (`refresh`, que le proxy
// borne à une par 30 s) et relit la config (relue par le proxy à chaque appel).
async function onProxyUpdateCheckNow(name) {
  const server = getMcpServer(name);
  if (!server || _proxyUpdateBusy[name]) return;
  const st = getMcpStatus(name);
  _proxyUpdateBusy[name] = 'check';
  syncProxyUpdateSurface();
  try {
    await runBackgroundTask('vérification du proxy MCP…', () => Promise.all([
      st && st.updateDeclared ? readProxyUpdateStatus(server, true) : null,
      st && st.lifecycleDeclared ? readProxyLifecycleStatus(server) : null,
    ]));
  } finally {
    delete _proxyUpdateBusy[name];
    syncProxyUpdateSurface();
  }
}

// ── Redémarrage volontaire (miaou/lifecycle/restart) ─────────────────────────

function proxyRestartToastKey(name) { return 'proxy-restart:' + name; }

// Redémarre le proxy, config modifiée ou non. Trois questions possibles avant
// l'issue, chacune en toast d'avertissement dont l'action relance le geste :
// une génération de cet onglet (sans forçage : l'arrêter suffit), des chemins
// de config qui couperont MIAOU du proxy relancé (`confirmed`), des appels en
// vol chez n'importe quel client (refus du proxy, `force` sur confirmation, le
// nombre étant celui du refus). Le retour se reconnaît à l'`instance` rendue
// par `restart` — celle du processus qui s'arrête.
async function restartProxy(name, opts) {
  const o = opts || {};
  const server = getMcpServer(name);
  const lc = proxyLifecycleEntry(name);
  const status = lc && lc.status;
  if (!server || !status || !status.restartable || _proxyUpdateBusy[name]) return;
  const key = proxyRestartToastKey(name);
  const blocked = proxyRestartLocalBlock(_activeGenerations.size);
  if (blocked) {
    showToast({ key: key + ':wait', level: 'info', theme: 'update', text: blocked });
    return;
  }
  const cut = proxyLifecycleCutPaths(status.config.changed, proxyMaybeServesThisPage(name));
  if (!o.confirmed) {
    const warning = proxyRestartWarningText(cut);
    if (warning) {
      showToast({ key: key + ':confirm', level: 'warn', theme: 'update', persistent: true, text: warning,
        action: { label: 'Redémarrer quand même', run: function () { restartProxy(name, { confirmed: true }); } } });
      return;
    }
  }
  _proxyUpdateBusy[name] = 'reboot';
  dismissToast(key + ':confirm');
  dismissToast(proxyLifecycleToastKey(name));
  syncProxyUpdateSurfaces();
  const outcome = await runBackgroundTask('redémarrage du proxy MCP…', async () => {
    try {
      return { result: await mcpRpc(server, MCP_LIFECYCLE_RESTART_METHOD, o.force ? { force: true } : {}) };
    } catch (e) {
      return { error: e || new Error('échec') };
    }
  });
  if (!outcome || outcome.error) {
    delete _proxyUpdateBusy[name];
    const err = outcome && outcome.error;
    const inFlight = proxyRestartInFlight(err);
    if (inFlight !== null && !o.force) {
      showToast({ key: key + ':confirm', level: 'warn', theme: 'update', persistent: true, text: proxyRestartForceText(inFlight),
        action: { label: 'Couper et redémarrer', run: function () { restartProxy(name, { confirmed: true, force: true }); } } });
    } else {
      showToast({ key: key + ':result', level: 'error', theme: 'update', text: proxyRestartFailureText(err) });
    }
    // L'état a pu bouger (config devenue invalide, mise à jour lancée ailleurs) :
    // la surface doit refléter le proxy, pas la tentative.
    delete _proxyLifecycleAnnounced[name];
    await readProxyLifecycleStatus(server);
    return;
  }
  const plan = proxyRestartWaitPlan(proxyRestartAcceptedInstance(outcome.result, status.instance), null);
  let back = false;
  try {
    showToast({ key: key + ':result', level: 'info', theme: 'update', persistent: true, text: 'Redémarrage du proxy MCP…' });
    back = await runBackgroundTask('redémarrage du proxy MCP…', () => waitForProxyRestart(name, plan));
  } finally {
    delete _proxyUpdateBusy[name];
    syncProxyUpdateSurfaces();
  }
  if (!back) {
    showToast({ key: key + ':result', level: 'error', theme: 'update', persistent: true,
      text: proxyRestartTimeoutText(Math.round(PROXY_RESTART_WAIT_MS / 60000), cut) });
    return;
  }
  showToast({ key: key + ':result', level: 'info', theme: 'update', text: 'Proxy MCP redémarré.' });
  const st = getMcpStatus(name);
  if (st && st.updateDeclared) await readProxyUpdateStatus(server, false);
}

// ── Déclenchement ────────────────────────────────────────────────────────────

// La carte du serveur, avec un délai assez long pour `apply` (cf.
// PROXY_UPDATE_APPLY_TIMEOUT_S). Copie : la carte persistée n'est pas touchée.
function _proxyUpdateApplyServer(server) {
  return Object.assign({}, server, { timeout_s: Math.max(mcpTimeoutSeconds(server) || MCP_DEFAULT_TIMEOUT_S, PROXY_UPDATE_APPLY_TIMEOUT_S) });
}

// Déclenche la mise à jour proposée : `apply` avec la cible AFFICHÉE (le proxy
// n'avance qu'à elle, jamais à un sha plus récent paru entre-temps). Le
// prédicat « servi par ce proxy » est évalué AVANT : l'empreinte publiée change
// dès que la mise à jour touche MIAOU.
async function applyProxyUpdate(name) {
  const server = getMcpServer(name);
  const entry = proxyUpdateEntry(name);
  const status = entry && entry.status;
  if (!server || !proxyUpdateApplicable(status) || _proxyUpdateBusy[name]) return;
  const blocked = proxyUpdateLocalBlock(status.update.kind, _activeGenerations.size);
  if (blocked) {
    showToast({ key: proxyUpdateToastKey(name) + ':wait', level: 'info', theme: 'update', text: blocked });
    return;
  }
  const servedByThis = isServedByProxy(pageIsServed(), status.servedBuild, BUILD_ID);
  _proxyUpdateBusy[name] = 'apply';
  dismissToast(proxyUpdateToastKey(name));
  syncProxyUpdateSurface();
  const instanceBefore = status.update.kind === 'miaou' ? null : await proxyInstanceBeforeRestart(server);
  // `runBackgroundTask` avale les rejets : l'échec est capturé ici, pour être dit.
  const outcome = await runBackgroundTask('mise à jour du proxy MCP…', async () => {
    try {
      return { result: await mcpRpc(_proxyUpdateApplyServer(server), MCP_UPDATE_APPLY_METHOD, { target: status.target }) };
    } catch (e) {
      return { error: e || new Error('échec') };
    }
  });
  if (!outcome || outcome.error) {
    delete _proxyUpdateBusy[name];
    showToast({ key: proxyUpdateToastKey(name) + ':result', level: 'error', theme: 'update',
      text: proxyUpdateFailureText(outcome && outcome.error) });
    // L'état a pu bouger (cible périmée, application ailleurs, retour arrière) :
    // la proposition affichée doit refléter le proxy, pas la tentative.
    delete _proxyUpdateAnnounced[name];
    await readProxyUpdateStatus(server, true);
    return;
  }
  await afterProxyUpdateApplied(server, outcome.result || {}, status, servedByThis, instanceBefore);
}

// ── Après `apply` ────────────────────────────────────────────────────────────

// Pur : que faire de la page une fois la mise à jour en place ? `newBuild` :
// l'empreinte servie si elle diffère de celle qui tourne ('' sinon) ;
// `blockReason` : ce qu'un rechargement perdrait (`reloadBlockReason`).
// 'none' (rien de neuf n'est servi), 'reload' (automatique), ou 'offer' (le
// toast « Recharger » existant, qui revérifie lui-même au clic).
function proxyReloadDecision(newBuild, blockReason) {
  if (!newBuild) return 'none';
  return blockReason ? 'offer' : 'reload';
}

// Attente du retour d'un proxy qui redémarre (session morte, relance par son
// superviseur via `uv run` : quelques secondes, davantage si des dépendances
// changent). Reconnexion bornée, par les deux fonctions de la reprise MCP
// (`disconnectMcpServer` puis `connectMcpServer`, comme le glyphe de la
// carte). Un proxy reconnecté n'est « revenu » que s'il est le NOUVEAU
// processus : l'ancien répond encore pendant son arrêt en douceur. Le plan
// (`proxyRestartWaitPlan`) dit comment le reconnaître — `instance` de
// `miaou/lifecycle`, ou `head` en repli. Rend vrai s'il est revenu avant
// `PROXY_RESTART_WAIT_MS`.
const PROXY_RESTART_WAIT_MS = 180000;
const PROXY_RESTART_POLL_MS = 2000;

function _proxyUpdateSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitForProxyRestart(name, plan) {
  const deadline = Date.now() + PROXY_RESTART_WAIT_MS;
  while (Date.now() < deadline) {
    await _proxyUpdateSleep(PROXY_RESTART_POLL_MS);
    // Relue à chaque tour : supprimée ou désactivée entre-temps (ici ou dans un
    // autre onglet), la carte n'est plus à attendre.
    const server = getMcpServer(name);
    if (!server || server.enabled === false) return false;
    disconnectMcpServer(name);
    const ok = await connectMcpServer(server);
    if (typeof renderMcpServersIfOpen === 'function') renderMcpServersIfOpen();
    if (!ok) continue;
    const st = getMcpStatus(name);
    const byInstance = plan && plan.by === 'instance';
    const declared = !!(st && (byInstance ? st.lifecycleDeclared : st.updateDeclared));
    const status = !declared ? null
      : byInstance ? await readProxyLifecycleStatus(server) : await readProxyUpdateStatus(server, false);
    if (proxyRestartLandedFor(plan, declared, status)) return true;
  }
  return false;
}

// L'identité du proxy juste avant un geste qui le redémarre, ou null s'il ne
// déclare pas `miaou/lifecycle` ou ne répond pas : relue à l'instant, jamais
// prise dans la dernière lecture cadencée (un redémarrage fait ailleurs depuis
// la rendrait périmée, et l'ancien processus passerait alors pour le nouveau).
async function proxyInstanceBeforeRestart(server) {
  const st = server && getMcpStatus(server.name);
  if (!st || !st.lifecycleDeclared) return null;
  const status = await readProxyLifecycleStatus(server);
  return status ? status.instance : null;
}

// Suite d'un `apply` réussi. `status` est l'état AFFICHÉ au moment du clic,
// `servedByThis` le prédicat évalué avant l'appel, `instanceBefore` l'identité
// du proxy relue juste avant (cf. applyProxyUpdate).
async function afterProxyUpdateApplied(server, result, status, servedByThis, instanceBefore) {
  const name = server.name;
  const resultKey = proxyUpdateToastKey(name) + ':result';
  const label = proxyUpdateKindLabel(result.kind);
  const plan = proxyUpdateAfterApply(result, servedByThis);
  let done = label + '\u00a0: mise à jour appliquée.';
  try {
    if (plan.waitRestart) {
      _proxyUpdateBusy[name] = 'restart';
      syncProxyUpdateSurface();
      showToast({ key: resultKey, level: 'info', theme: 'update', persistent: true,
        text: label + '\u00a0: mise à jour appliquée, redémarrage du proxy MCP…' });
      const plan = proxyRestartWaitPlan(instanceBefore, result.before);
      const back = await runBackgroundTask('redémarrage du proxy MCP…', () => waitForProxyRestart(name, plan));
      if (!back) {
        showToast({ key: resultKey, level: 'error', theme: 'update', persistent: true,
          text: 'Le proxy MCP n\'est pas revenu après ' + Math.round(PROXY_RESTART_WAIT_MS / 60000)
            + ' minutes. Cause probable\u00a0: son démarrage échoue après la mise à jour (dépendances, configuration)\u00a0; '
            + 'le journal de son superviseur donne la commande de retour arrière.' });
        return;
      }
      done = label + '\u00a0: mise à jour appliquée, proxy MCP revenu.';
    }
    if (plan.checkReload) {
      const newBuild = await fetchNewerServedBuild();
      const why = reloadBlockReason(reloadBlockState());
      const decision = proxyReloadDecision(newBuild, why);
      if (decision === 'reload') {
        location.reload();
        return;
      }
      if (decision === 'offer') {
        // Le toast « Recharger » de la détection de version, avec sa garde au
        // clic : le brouillon tapé pendant l'attente reste protégé.
        announceNewVersion(newBuild);
        done = label + '\u00a0: mise à jour appliquée. Rechargement différé\u00a0: ' + why;
      }
    }
    showToast({ key: resultKey, level: 'info', theme: 'update', text: done });
  } finally {
    delete _proxyUpdateBusy[name];
    syncProxyUpdateSurface();
  }
  await readProxyUpdateStatus(server, false);
}
