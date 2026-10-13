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

const MCP_UPDATE_EXTENSION_ID = 'miaou/self-update';
const MCP_UPDATE_STATUS_METHOD = 'miaou/update/status';
const MCP_UPDATE_APPLY_METHOD = 'miaou/update/apply';

// États publiés par le proxy. Seuls `behind` et `dirty` portent une mise à
// jour (`update` non nul) ; `dirty` la bloque.
const PROXY_UPDATE_OFFER_STATES = ['behind', 'dirty'];
const PROXY_UPDATE_KINDS = ['miaou', 'proxy', 'both'];

// Le serveur déclare-t-il l'extension dans son DiscoverResult ? Même lecture
// que `mcpDeclaresSkillsExtension` : seule la présence de la clé compte, et un
// InitializeResult legacy ne la porte jamais.
function mcpDeclaresUpdateExtension(result) {
  const caps = result && result.capabilities;
  const ext = caps && caps.extensions;
  return !!(ext && typeof ext === 'object' && Object.prototype.hasOwnProperty.call(ext, MCP_UPDATE_EXTENSION_ID));
}

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
// première sonde n'a pas rendu (`checking`).
function proxyRestartLanded(status, before) {
  return !!status && status.head !== before;
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

async function checkProxyUpdates(fromTimer) {
  const now = Date.now();
  if (!fromTimer && !shouldReadProxyUpdates(_proxyUpdateLastRead, now, PROXY_UPDATE_FOCUS_MIN_INTERVAL_MS)) return;
  _proxyUpdateLastRead = now;
  pruneProxyUpdates();
  await Promise.all(proxyUpdateServers().map(s => readProxyUpdateStatus(s, false)));
}

function startProxyUpdatePolling() {
  if (_proxyUpdatePollTimer || typeof setInterval !== 'function') return;
  _proxyUpdatePollTimer = setInterval(function () {
    if (typeof document !== 'undefined' && document.hidden) return;
    checkProxyUpdates(true);
  }, PROXY_UPDATE_POLL_MS);
}

// Oublie les serveurs supprimés, désactivés, ou reconnectés sans l'extension
// (option retirée côté proxy). Un serveur en erreur ou en cours de connexion
// garde son entrée : un proxy qui redémarre n'a pas perdu sa mise à jour.
function pruneProxyUpdates() {
  const enabled = listEnabledMcpServers().map(s => s.name);
  Object.keys(_proxyUpdates).forEach(name => {
    const st = getMcpStatus(name);
    const gone = enabled.indexOf(name) < 0 || (st && st.state === 'ok' && !st.updateDeclared);
    if (!gone) return;
    delete _proxyUpdates[name];
    delete _proxyUpdateAnnounced[name];
    dismissToast(proxyUpdateToastKey(name));
  });
  syncProxyUpdateSurface();
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

function proxyUpdateToastKey(name) { return 'proxy-update:' + name; }

function syncProxyUpdateSurfaces() {
  syncProxyUpdateToasts();
  syncProxyUpdateSurface();
}

function syncProxyUpdateToasts() {
  const names = Object.keys(_proxyUpdates);
  const offering = names.filter(n => _proxyUpdates[n].status && proxyUpdateAvailable(_proxyUpdates[n].status));
  names.forEach(name => {
    const status = _proxyUpdates[name].status;
    // Un geste en cours ici dit lui-même où il en est : pas de proposition
    // par-dessus.
    if (_proxyUpdateBusy[name] === 'apply' || _proxyUpdateBusy[name] === 'restart') return;
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

function _proxyUpdateCheckedLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return ' Dernière vérification du proxy : ' + d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) + '.';
}

// Réglages › Application : l'état durable, serveur par serveur. Rendu à chaque
// lecture et à chaque ouverture des réglages ; rien à faire si le drawer n'a
// pas été construit (le conteneur manque).
function syncProxyUpdateSurface() {
  const list = typeof document !== 'undefined' && document.getElementById('proxy-update-list');
  if (!list) return;
  const servers = proxyUpdateServers();
  const names = servers.map(s => s.name);
  Object.keys(_proxyUpdates).forEach(n => { if (names.indexOf(n) < 0) names.push(n); });
  list.textContent = '';
  if (!names.length) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Aucun serveur MCP connecté ne propose de mise à jour à la demande (option self_update du proxy MCP, lancé par son superviseur).';
    list.appendChild(hint);
    return;
  }
  names.forEach(name => {
    const entry = _proxyUpdates[name] || null;
    const status = entry && entry.status;
    const busy = _proxyUpdateBusy[name] || '';
    const row = document.createElement('div');
    row.className = 'proxy-update-row';
    const text = document.createElement('span');
    text.className = 'hint';
    let t = names.length > 1 ? '« ' + name + ' » : ' : '';
    if (busy === 'apply') t += 'Mise à jour en cours…';
    else if (busy === 'restart') t += 'Mise à jour appliquée, redémarrage du proxy en cours…';
    else if (!entry) t += 'Lecture de l\'état en cours…';
    else t += proxyUpdateStateText(status, entry.error) + _proxyUpdateCheckedLabel(status && status.checkedAt);
    text.textContent = t;
    row.appendChild(text);
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
    const btns = document.createElement('div');
    btns.className = 'btn-row';
    if (proxyUpdateApplicable(status)) {
      const apply = document.createElement('button');
      apply.className = 'btn-ghost';
      apply.type = 'button';
      apply.textContent = 'Mettre à jour';
      apply.disabled = !!busy;
      apply.addEventListener('click', function () { applyProxyUpdate(name); });
      btns.appendChild(apply);
    }
    const check = document.createElement('button');
    check.className = 'btn-ghost';
    check.type = 'button';
    check.textContent = 'Vérifier maintenant';
    check.disabled = !!busy || !getMcpServer(name);
    check.addEventListener('click', function () { onProxyUpdateCheckNow(name); });
    btns.appendChild(check);
    row.appendChild(btns);
    list.appendChild(row);
  });
}

// « Vérifier maintenant » : force une sonde du proxy (`refresh`), que lui-même
// borne (une sonde de moins de 30 s est reprise telle quelle).
async function onProxyUpdateCheckNow(name) {
  const server = getMcpServer(name);
  if (!server || _proxyUpdateBusy[name]) return;
  _proxyUpdateBusy[name] = 'check';
  syncProxyUpdateSurface();
  try {
    await runBackgroundTask('vérification des mises à jour…', () => readProxyUpdateStatus(server, true));
  } finally {
    delete _proxyUpdateBusy[name];
    syncProxyUpdateSurface();
  }
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
  await afterProxyUpdateApplied(server, outcome.result || {}, status, servedByThis);
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
// processus (`proxyRestartLanded`) : l'ancien répond encore pendant son arrêt
// en douceur. Rend vrai s'il est revenu avant `PROXY_RESTART_WAIT_MS`.
const PROXY_RESTART_WAIT_MS = 180000;
const PROXY_RESTART_POLL_MS = 2000;

function _proxyUpdateSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitForProxyRestart(name, before) {
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
    // Revenu sans l'extension (option retirée) : il est revenu, rien à relire.
    if (!st || !st.updateDeclared) return true;
    if (proxyRestartLanded(await readProxyUpdateStatus(server, false), before)) return true;
  }
  return false;
}

// Suite d'un `apply` réussi. `status` est l'état AFFICHÉ au moment du clic,
// `servedByThis` le prédicat évalué avant l'appel (cf. applyProxyUpdate).
async function afterProxyUpdateApplied(server, result, status, servedByThis) {
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
      const back = await runBackgroundTask('redémarrage du proxy MCP…', () => waitForProxyRestart(name, result.before));
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
