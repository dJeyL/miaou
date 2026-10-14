// ── Secrets volatils : mot de passe saisi dans MIAOU, tenu par le proxy ──────
// Un serveur MCP qui publie l'extension `miaou/volatile-secrets` (proxy de
// miaou-mcp-servers) attend une valeur que l'utilisateur saisit ici : le proxy
// la substitue au marqueur `{"volatile": "<clef>"}` de la config d'un upstream
// avant de le construire, la garde en mémoire seulement, et l'oublie à chaque
// redémarrage. MIAOU garde les valeurs ACCEPTÉES pour la session de l'onglet
// (`sessionStorage`) et les renvoie quand le proxy les a oubliées.
//
// Contrat du proxy (docs/miaou-contract.md, « Secrets volatils ») : extension
// publiée en ère 2026-07-28 seulement, et seulement s'il existe un upstream
// consommateur. Trois méthodes, toutes gardées par le proxy (Host loopback au
// port du proxy ET Origin de même origine) : `miaou/secrets/status` rend
// `{ status: { instance, secrets: [entrée…] } }`, `submit { key, value }` et
// `forget { key }` rendent `{ secret: entrée }`. Refus en erreur JSON-RPC dont
// `data.code` se teste par ÉGALITÉ.
//
// La valeur ne quitte jamais ce fichier autrement que vers `submit` et
// `sessionStorage` : ni console, ni ack, ni message au modèle, ni
// localStorage/IndexedDB, ni BroadcastChannel.

const MCP_SECRETS_EXTENSION_ID = 'miaou/volatile-secrets';
const MCP_SECRETS_STATUS_METHOD = 'miaou/secrets/status';
const MCP_SECRETS_SUBMIT_METHOD = 'miaou/secrets/submit';
const MCP_SECRETS_FORGET_METHOD = 'miaou/secrets/forget';

// Verdicts publiés par le proxy pour un consommateur, issue de la dernière
// saisie (`null` : aucune, ou après « Oublier »). Un verdict inconnu (version
// future du proxy) est lu comme `indeterminate` : il ne dit pas « incorrect »
// et ne fait rien ressaisir.
const VOLATILE_SECRET_VERDICTS = ['accepted', 'rejected', 'indeterminate', 'incomplete', 'untested'];

// Le serveur déclare-t-il l'extension dans son DiscoverResult ? Même lecture
// que `mcpDeclaresUpdateExtension` : seule la présence de la clé compte.
function mcpDeclaresSecretsExtension(result) {
  const caps = result && result.capabilities;
  const ext = caps && caps.extensions;
  return !!(ext && typeof ext === 'object' && Object.prototype.hasOwnProperty.call(ext, MCP_SECRETS_EXTENSION_ID));
}

function _secStr(v) { return typeof v === 'string' && v ? v : null; }

// Entrée d'une clef → forme normalisée, ou null. Les champs du contrat sont
// déjà en camelCase d'un mot : rien à renommer, seulement à filtrer. Un
// consommateur sans nom d'upstream est retiré ; un `state` autre que
// `pending` vaut `ready` (seul `pending` refuse les appels).
function normalizeVolatileSecretEntry(e) {
  if (!e || typeof e !== 'object' || !_secStr(e.key)) return null;
  const consumers = (Array.isArray(e.consumers) ? e.consumers : []).filter(c => c && _secStr(c.upstream)).map(c => {
    let verdict = c.verdict === null || c.verdict === undefined ? null : c.verdict;
    if (verdict !== null && VOLATILE_SECRET_VERDICTS.indexOf(verdict) < 0) verdict = 'indeterminate';
    return { upstream: c.upstream, state: c.state === 'pending' ? 'pending' : 'ready', verdict: verdict, detail: _secStr(c.detail) };
  });
  return { key: e.key, held: e.held === true, consumers: consumers };
}

// Réponse de `status` → `{ instance, secrets }`, ou null si sa forme est
// inattendue. Une clef illisible est retirée, pas la réponse entière.
function normalizeVolatileSecretsStatus(result) {
  const s = result && result.status;
  if (!s || typeof s !== 'object' || !_secStr(s.instance)) return null;
  const secrets = (Array.isArray(s.secrets) ? s.secrets : []).map(normalizeVolatileSecretEntry).filter(Boolean);
  return { instance: s.instance, secrets: secrets };
}

// Réponse de `submit` ou `forget` → entrée normalisée, ou null.
function normalizeVolatileSecretResult(result) {
  return normalizeVolatileSecretEntry(result && result.secret);
}

// ── Disponibilité : qui peut lire et déposer ─────────────────────────────────
// Le proxy n'accepte les trois méthodes que d'une page qu'il sert lui-même
// (sous /app/), avec une carte qui vise la même adresse. MIAOU évalue le même
// prédicat AVANT d'appeler, pour dire quoi faire au lieu d'essuyer un refus.

// Origine d'une URL http(s), lue par MOTIF (`new URL` est absent du moteur
// des tests, cf. `servedAppCandidates`) : schéma et hôte en minuscules,
// userinfo retiré, port par défaut retiré (`location.origin` l'omet). '' si
// l'URL n'est pas http(s).
function volatileSecretOrigin(url) {
  const m = /^(https?):\/\/([^\/?#\s]+)/i.exec(String(url || '').trim());
  if (!m) return '';
  const scheme = m[1].toLowerCase();
  let host = m[2].toLowerCase();
  const at = host.lastIndexOf('@');
  if (at >= 0) host = host.slice(at + 1);
  if (!host) return '';
  if ((scheme === 'http' && /:80$/.test(host)) || (scheme === 'https' && /:443$/.test(host))) host = host.replace(/:\d+$/, '');
  return scheme + '://' + host;
}

// `{ served, pageOrigin, cardUrl, secure }` → `{ ok: true, appUrl }` ou
// `{ ok: false, reason, appUrl }`. `reason` : 'not-served' (file://),
// 'other-origin' (la page n'est pas servie par le proxy de la carte, ou sous un
// autre nom : 127.0.0.1 et localhost sont deux origines), 'insecure' (contexte
// non sécurisé : http hors loopback, le mot de passe passerait en clair).
// `appUrl` = l'adresse de MIAOU servi par le proxy de la carte ('' si l'URL de
// la carte n'est pas http(s)).
function secretsAvailability(o) {
  const a = o || {};
  const cardOrigin = volatileSecretOrigin(a.cardUrl);
  const appUrl = cardOrigin ? cardOrigin + '/app/' : '';
  if (!a.served) return { ok: false, reason: 'not-served', appUrl: appUrl };
  if (!cardOrigin || volatileSecretOrigin(a.pageOrigin) !== cardOrigin) return { ok: false, reason: 'other-origin', appUrl: appUrl };
  if (a.secure === false) return { ok: false, reason: 'insecure', appUrl: appUrl };
  return { ok: true, appUrl: appUrl };
}

// Ce que dit la carte quand la saisie n'est pas possible d'ici.
function secretsUnavailableText(av) {
  const a = av || {};
  const open = a.appUrl ? 'ouvrir MIAOU à l\'adresse ' + a.appUrl : 'ouvrir MIAOU servi par ce proxy, sous /app/';
  if (a.reason === 'insecure') {
    return 'Saisie refusée : la page n\'est pas un contexte sécurisé (http hors de cette machine), le mot de passe passerait en clair.';
  }
  if (a.reason === 'other-origin') {
    return 'Ce serveur attend un mot de passe, qui ne se saisit que dans MIAOU servi par le même proxy, sous le même nom d\'hôte que la carte (127.0.0.1 et localhost sont deux adresses distinctes) : '
      + open + '.';
  }
  return 'Ce serveur attend un mot de passe, qui ne se saisit que dans MIAOU servi par le proxy : ' + open + '.';
}

// ── État d'une clef pour les surfaces ────────────────────────────────────────

function _secQuoted(s) { return '« ' + s + ' »'; }

function _secServices(n) { return n + ' service' + (n > 1 ? 's' : '') + ' en attente'; }

// Une entrée → `{ waiting, phase, text, upstream, replacementRefused }`.
// `waiting` : au moins un consommateur `pending` (ses appels sont refusés).
// `phase`, lue sur les consommateurs EN ATTENTE, dans cet ordre :
//   'rejected'      — refusé par le service : le seul cas « incorrect » ;
//   'indeterminate' — panne autre (annuaire injoignable, délai) : rien à
//                     ressaisir, la cause est dite ;
//   'incomplete'    — configuration incomplète côté proxy : idem ;
//   'untested'      — un consommateur précédent a refusé (il est prêt, c'est
//                     un remplacement refusé) : la valeur reste à fournir ;
//   'required'      — aucune saisie (verdict nul) ;
//   ''              — rien n'attend.
// `replacementRefused` : un consommateur PRÊT a refusé la dernière saisie
// (remplacement à chaud refusé, l'ancienne instance sert toujours) — dit par
// la carte, jamais en toast.
function volatileSecretKeyState(entry) {
  const e = entry || { key: '', consumers: [] };
  const consumers = Array.isArray(e.consumers) ? e.consumers : [];
  const pending = consumers.filter(c => c.state === 'pending');
  const replacementRefused = consumers.some(c => c.state === 'ready' && c.verdict === 'rejected');
  const first = v => pending.find(c => c.verdict === v) || null;
  let phase = '', hit = null;
  if (pending.length) {
    for (const v of ['rejected', 'indeterminate', 'incomplete', 'untested']) {
      hit = first(v);
      if (hit) { phase = v; break; }
    }
    if (!phase) phase = 'required';
  }
  const key = _secQuoted(e.key || '');
  const cause = hit && hit.detail ? ' Cause : ' + hit.detail : '';
  let text = '';
  if (phase === 'rejected') {
    text = 'Mot de passe ' + key + ' incorrect : refusé par ' + _secQuoted(hit.upstream) + '.' + cause;
  } else if (phase === 'indeterminate') {
    text = 'Mot de passe ' + key + ' non vérifié : ' + _secQuoted(hit.upstream) + ' n\'a pas pu le tester, inutile de le ressaisir.' + cause;
  } else if (phase === 'incomplete') {
    text = 'Mot de passe ' + key + ' non vérifié : configuration incomplète pour ' + _secQuoted(hit.upstream) + ' dans le proxy.' + cause;
  } else if (phase === 'untested' || phase === 'required') {
    text = 'Mot de passe ' + key + ' requis : ' + _secServices(pending.length) + '.';
  }
  return { waiting: pending.length > 0, phase: phase, text: text, upstream: hit ? hit.upstream : null, replacementRefused: replacementRefused };
}

// Ce que dit la carte d'un consommateur.
function volatileSecretConsumerText(c) {
  const x = c || {};
  const ready = x.state !== 'pending';
  let t = ready ? 'en service' : 'en attente';
  if (x.verdict === 'accepted') t += ', mot de passe accepté';
  else if (x.verdict === 'rejected') t += ready ? ', nouveau mot de passe refusé (l\'ancien reste en service)' : ', mot de passe refusé';
  else if (x.verdict === 'indeterminate') t += ', vérification impossible';
  else if (x.verdict === 'incomplete') t += ', configuration incomplète';
  else if (x.verdict === 'untested') t += ', non testé';
  if (x.detail && x.verdict !== 'accepted') t += ' (' + x.detail + ')';
  return t;
}

// Nombre de clefs en attente dans un état lu (`normalizeVolatileSecretsStatus`).
// Alimente la pilule de topbar et celle de la carte.
function volatileSecretsWaitingCount(status) {
  if (!status || !Array.isArray(status.secrets)) return 0;
  return status.secrets.filter(e => volatileSecretKeyState(e).waiting).length;
}

// ── Garde en session et renvoi ───────────────────────────────────────────────
// Une entrée `sessionStorage` par (carte, URL de la carte, clef) :
// `{ value, acceptedInstance, resentFor }`. L'URL entre dans la clef : une carte
// dont on change l'adresse ne doit pas renvoyer la valeur au nouveau serveur.

const VOLATILE_SECRET_SESSION_PREFIX = 'miaou-volatile-secret:';

// URL de carte normalisée pour la clef de session : origine (cf.
// `volatileSecretOrigin`) + chemin, sans requête, fragment ni barre finale.
function volatileSecretCardUrl(url) {
  const raw = String(url || '').trim();
  const origin = volatileSecretOrigin(raw);
  if (!origin) return raw;
  const rest = raw.replace(/^https?:\/\/[^\/?#\s]+/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return origin + rest;
}

function volatileSecretSessionKey(cardName, cardUrl, key) {
  return VOLATILE_SECRET_SESSION_PREFIX + JSON.stringify([String(cardName || ''), volatileSecretCardUrl(cardUrl), String(key || '')]);
}

// Faut-il renvoyer la valeur gardée ? `kept` : l'entrée de session (ou null).
// Oui si : une valeur est gardée, au moins un consommateur attend sans verdict
// (le proxy n'a rien reçu depuis son démarrage, ou on l'a fait oublier), le
// proxy n'est pas celui qui l'a acceptée (même instance = « Oublier » fait
// ailleurs, à respecter), et pas déjà renvoyée à CETTE instance (un renvoi
// par redémarrage constaté).
function volatileSecretShouldResend(entry, kept, instance) {
  if (!kept || typeof kept.value !== 'string' || !kept.value || !instance) return false;
  if (kept.acceptedInstance === instance || kept.resentFor === instance) return false;
  const consumers = entry && Array.isArray(entry.consumers) ? entry.consumers : [];
  return consumers.some(c => c.state === 'pending' && c.verdict === null);
}

// Que faire de la garde de session après une saisie ou un renvoi ? `entry` :
// la réponse de `submit` ; `submittedIsKept` : la valeur soumise est celle
// déjà gardée (renvoi, ou ressaisie identique).
//   'drop'  — un refus visant la valeur gardée : elle est oubliée (un renvoi
//             futur la ferait refuser de nouveau, au prix d'un échec à
//             l'annuaire) ;
//   'store' — au moins une acceptation, aucun refus : la valeur soumise est
//             gardée, acceptée par cette instance ;
//   'none'  — rien ne change : refus d'une valeur NOUVELLE (la gardée, peut-
//             être encore en service ailleurs, reste), ou issue indéterminée
//             / incomplète (gardée telle quelle, sans second renvoi).
// Une saisie acceptée par un consommateur puis refusée par le suivant n'est
// pas gardée.
function volatileSecretAfterSubmit(entry, submittedIsKept) {
  const consumers = entry && Array.isArray(entry.consumers) ? entry.consumers : [];
  if (consumers.some(c => c.verdict === 'rejected')) return submittedIsKept ? 'drop' : 'none';
  if (consumers.some(c => c.verdict === 'accepted')) return 'store';
  return 'none';
}

// Texte d'un refus de l'extension elle-même (garde d'origine, paramètres,
// clef inconnue), cause gardée. Code testé par ÉGALITÉ.
function volatileSecretFailureText(err) {
  const e = err || {};
  const code = e.data && typeof e.data.code === 'string' ? e.data.code : '';
  const msg = String(e.message || 'échec');
  if (code === 'SECRET_ORIGIN_REFUSED') return 'Refusé par le proxy (adresse de la page) : ' + msg;
  if (code === 'SECRET_UNKNOWN_KEY') return 'Le proxy n\'attend plus ce mot de passe : ' + msg;
  if (code === 'SECRET_INVALID_PARAMS') return 'Saisie refusée par le proxy : ' + msg;
  if (e.timeout) return 'Le proxy n\'a pas répondu : ' + msg;
  return 'Échec : ' + msg;
}

// ── Lecture de l'état ────────────────────────────────────────────────────────
// Un état par serveur, en mémoire seulement : { status, error, unavailable,
// readAt }. `unavailable` : la disponibilité (`secretsAvailability`) quand la
// page ne peut ni lire ni déposer — aucun appel n'est fait, l'état n'est pas
// lisible (la pilule ne compte rien, la carte dit où ouvrir MIAOU). Chaque
// lecture porte un numéro : une réponse plus ancienne arrivée après une plus
// récente est jetée.
let _volatileSecrets = {};
const _volatileSecretReadSeq = {};
const _volatileSecretBusy = {};            // `<serveur>\n<clef>` → 'submit' | 'resend' | 'forget'
const _volatileSecretReconnectDue = {};    // serveur → reconnexion différée par une génération en cours

function volatileSecretsEntry(name) { return _volatileSecrets[name] || null; }

function _volatileSecretBusyKey(name, key) { return name + '\n' + key; }

function volatileSecretBusy(name, key) { return _volatileSecretBusy[_volatileSecretBusyKey(name, key)] || ''; }

// Disponibilité pour CETTE page et cette carte.
function volatileSecretsAvailabilityFor(server) {
  return secretsAvailability({
    served: typeof pageIsServed === 'function' && pageIsServed(),
    pageOrigin: typeof location !== 'undefined' ? location.origin : '',
    cardUrl: server && server.url,
    secure: typeof window !== 'undefined' && window.isSecureContext !== false,
  });
}

// Nombre de clefs en attente, par carte : second argument de
// `resolveAuthorizationPending`. Une carte dont l'état n'est pas lisible
// d'ici ne compte rien.
function volatileSecretWaitingByServer() {
  const out = {};
  Object.keys(_volatileSecrets).forEach(name => {
    const n = volatileSecretsWaitingCount(_volatileSecrets[name].status);
    if (n) out[name] = n;
  });
  return out;
}

function volatileSecretWaitingFor(name) {
  const e = _volatileSecrets[name];
  return e ? volatileSecretsWaitingCount(e.status) : 0;
}

// Remplace l'entrée d'une clef dans l'état lu d'un serveur (réponse de
// `submit` ou `forget`, qui ne portent pas `instance`).
function _volatileSecretPutEntry(name, entry) {
  const cur = _volatileSecrets[name];
  if (!cur || !cur.status || !entry) return;
  const secrets = cur.status.secrets.slice();
  const i = secrets.findIndex(e => e.key === entry.key);
  if (i >= 0) secrets[i] = entry; else secrets.push(entry);
  cur.status = { instance: cur.status.instance, secrets: secrets };
}

async function readVolatileSecretsStatus(server) {
  if (!server) return null;
  const name = server.name;
  const seq = (_volatileSecretReadSeq[name] || 0) + 1;
  _volatileSecretReadSeq[name] = seq;
  const av = volatileSecretsAvailabilityFor(server);
  let status = null, error = null;
  if (av.ok) {
    try {
      status = normalizeVolatileSecretsStatus(await mcpRpc(server, MCP_SECRETS_STATUS_METHOD, {}));
      if (!status) error = 'réponse illisible';
    } catch (e) {
      error = volatileSecretFailureText(e);
    }
  }
  if (_volatileSecretReadSeq[name] !== seq) return status;   // une lecture plus récente a eu lieu
  _volatileSecrets[name] = { status: status, error: error, unavailable: av.ok ? null : av, readAt: Date.now() };
  syncVolatileSecretSurfaces();
  if (status) await resendVolatileSecrets(server, status);
  if (_volatileSecretReconnectDue[name] && !_activeGenerations.size) await _volatileSecretReconnect(server);
  return status;
}

// Appelé par `connectMcpServer` à chaque connexion réussie d'un serveur qui
// déclare l'extension. C'est le premier moment où un redémarrage du proxy se
// voit (`instance` change), donc celui du renvoi. Sans attente : la connexion
// n'en dépend pas.
function onProxySecretsServerConnected(server) {
  pruneVolatileSecrets();
  readVolatileSecretsStatus(server);
}

// ── Garde en session (sessionStorage, propre à l'onglet) ─────────────────────

function _volatileSecretSession() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch (e) { return null; }
}

function loadKeptVolatileSecret(server, key) {
  const ss = _volatileSecretSession();
  if (!ss || !server) return null;
  try {
    const kept = JSON.parse(ss.getItem(volatileSecretSessionKey(server.name, server.url, key)) || 'null');
    return kept && typeof kept.value === 'string' && kept.value ? kept : null;
  } catch (e) {
    return null;
  }
}

function _saveKeptVolatileSecret(server, key, kept) {
  const ss = _volatileSecretSession();
  if (!ss || !server) return;
  try { ss.setItem(volatileSecretSessionKey(server.name, server.url, key), JSON.stringify(kept)); } catch (e) { /* stockage de session refusé : pas de renvoi */ }
}

function _dropKeptVolatileSecret(server, key) {
  const ss = _volatileSecretSession();
  if (!ss || !server) return;
  try { ss.removeItem(volatileSecretSessionKey(server.name, server.url, key)); } catch (e) { /* idem */ }
}

// Retire les valeurs gardées d'une carte supprimée ou dont l'URL a changé, et
// l'état des serveurs supprimés, désactivés ou reconnectés sans l'extension.
// Un serveur en erreur ou en cours de connexion garde son état : un proxy qui
// redémarre attend toujours ses mots de passe.
function pruneVolatileSecrets() {
  const servers = typeof loadMcpServers === 'function' ? loadMcpServers() : [];
  const ss = _volatileSecretSession();
  if (ss) {
    const valid = {};
    servers.forEach(s => { valid[JSON.stringify([String(s.name || ''), volatileSecretCardUrl(s.url)])] = true; });
    const stale = [];
    try {
      for (let i = 0; i < ss.length; i++) {
        const k = ss.key(i);
        if (!k || k.indexOf(VOLATILE_SECRET_SESSION_PREFIX) !== 0) continue;
        let parts = null;
        try { parts = JSON.parse(k.slice(VOLATILE_SECRET_SESSION_PREFIX.length)); } catch (e) { parts = null; }
        if (!Array.isArray(parts) || !valid[JSON.stringify([parts[0], parts[1]])]) stale.push(k);
      }
      stale.forEach(k => ss.removeItem(k));
    } catch (e) { /* stockage de session refusé */ }
  }
  const enabled = servers.filter(s => s.enabled !== false).map(s => s.name);
  let changed = false;
  Object.keys(_volatileSecrets).forEach(name => {
    const st = getMcpStatus(name);
    if (enabled.indexOf(name) >= 0 && !(st && st.state === 'ok' && !st.secretsDeclared)) return;
    delete _volatileSecrets[name];
    delete _volatileSecretReconnectDue[name];
    changed = true;
  });
  if (changed) syncVolatileSecretSurfaces();
}

// ── Dépôt, renvoi, oubli ─────────────────────────────────────────────────────

// Reconnexion après une acceptation : sans `notifications/tools/list_changed`,
// c'est elle qui fait paraître les outils au tout premier démarrage (cache
// vide côté proxy) et les `instructions` de l'upstream. Différée tant qu'une
// génération tourne : `connectMcpServer` retire les outils du serveur pendant
// son aller-retour, et un tour composé à ce moment les perdrait.
async function _volatileSecretReconnect(server) {
  if (_activeGenerations.size) { _volatileSecretReconnectDue[server.name] = true; return; }
  delete _volatileSecretReconnectDue[server.name];
  await connectMcpServer(server);
  if (typeof renderMcpServersIfOpen === 'function') renderMcpServersIfOpen();
}

// Fin de la dernière génération (`unregisterGeneration`) : les reconnexions
// différées ont lieu maintenant.
function flushVolatileSecretReconnects() {
  Object.keys(_volatileSecretReconnectDue).forEach(name => {
    const server = getMcpServer(name);
    if (server && server.enabled !== false) _volatileSecretReconnect(server);
    else delete _volatileSecretReconnectDue[name];
  });
}

// Un dépôt (`submit`) et ce qu'il entraîne : garde en session, état local,
// signal aux onglets voisins (sans la valeur), reconnexion. `submittedIsKept` :
// la valeur est celle déjà gardée (renvoi). `opts.noReconnect` : le rejeu d'un
// appel d'outil (l'outil existe par construction, et une génération tourne).
// Rend `{ entry, error, instance }`.
async function _depositVolatileSecret(server, key, value, instance, submittedIsKept, opts) {
  const o = opts || {};
  let entry = null, error = null;
  try {
    entry = normalizeVolatileSecretResult(await mcpRpc(server, MCP_SECRETS_SUBMIT_METHOD, { key: key, value: value }));
    if (!entry) error = 'réponse illisible';
  } catch (e) {
    error = volatileSecretFailureText(e);
  }
  if (!entry) return { entry: null, error: error, instance: instance };
  const decision = volatileSecretAfterSubmit(entry, submittedIsKept);
  if (decision === 'store') _saveKeptVolatileSecret(server, key, { value: value, acceptedInstance: instance, resentFor: instance });
  else if (decision === 'drop') _dropKeptVolatileSecret(server, key);
  _volatileSecretPutEntry(server.name, entry);
  syncVolatileSecretSurfaces();
  if (typeof syncPost === 'function') syncPost('secrets-changed', { server: server.name });
  if (entry.consumers.some(c => c.verdict === 'accepted') && !o.noReconnect) await _volatileSecretReconnect(server);
  return { entry: entry, error: null, instance: instance };
}

// Renvoie, pour chaque clef d'un état fraîchement lu, la valeur gardée si le
// proxy l'a oubliée (`volatileSecretShouldResend`). `resentFor` est posé AVANT
// l'envoi : une seconde lecture concurrente ne renvoie pas une seconde fois.
// Séquentiel : une saisie par clef, comme un humain.
async function resendVolatileSecrets(server, status, opts) {
  let resent = false;
  for (const entry of status.secrets) {
    const busy = _volatileSecretBusyKey(server.name, entry.key);
    if (_volatileSecretBusy[busy]) continue;
    const kept = loadKeptVolatileSecret(server, entry.key);
    if (!volatileSecretShouldResend(entry, kept, status.instance)) continue;
    _saveKeptVolatileSecret(server, entry.key, Object.assign({}, kept, { resentFor: status.instance }));
    _volatileSecretBusy[busy] = 'resend';
    try {
      await _depositVolatileSecret(server, entry.key, kept.value, status.instance, true, opts);
      resent = true;
    } finally {
      delete _volatileSecretBusy[busy];
    }
  }
  if (resent) syncVolatileSecretSurfaces();
  return resent;
}

// Appel d'outil refusé en `SECRET_REQUIRED` (callRemoteTool) : relire l'état
// (ce qui met aussi à jour pilule, carte et toast), renvoyer la valeur gardée
// si un renvoi est dû, sans reconnexion. Rend vrai si le consommateur visé
// (`upstream`, ou toute clef si le proxy ne le nomme pas) est désormais prêt :
// l'appel peut être rejoué. Faux hors du cas servi, sans valeur, ou après un
// refus.
async function recoverVolatileSecretForCall(server, upstream) {
  if (!server || !volatileSecretsAvailabilityFor(server).ok) return false;
  let status = null;
  try {
    status = normalizeVolatileSecretsStatus(await mcpRpc(server, MCP_SECRETS_STATUS_METHOD, {}));
  } catch (e) {
    return false;
  }
  if (!status) return false;
  _volatileSecrets[server.name] = { status: status, error: null, unavailable: null, readAt: Date.now() };
  await resendVolatileSecrets(server, status, { noReconnect: true });
  syncVolatileSecretSurfaces();
  const cur = _volatileSecrets[server.name] && _volatileSecrets[server.name].status;
  const consumers = [];
  (cur ? cur.secrets : []).forEach(e => e.consumers.forEach(c => consumers.push(c)));
  const target = upstream ? consumers.filter(c => c.upstream === upstream) : consumers;
  return target.length > 0 && target.every(c => c.state === 'ready');
}

// Saisie de l'utilisateur. L'état est relu juste avant, pour l'`instance` du
// proxy qui va juger la valeur (celle qu'on gardera comme « acceptée par »).
// Rend `{ entry, error }`, jamais la valeur.
async function submitVolatileSecret(name, key, value) {
  const server = getMcpServer(name);
  if (!server || typeof value !== 'string' || !value) return { entry: null, error: 'Rien à envoyer.' };
  const av = volatileSecretsAvailabilityFor(server);
  if (!av.ok) return { entry: null, error: secretsUnavailableText(av) };
  const busy = _volatileSecretBusyKey(name, key);
  if (_volatileSecretBusy[busy]) return { entry: null, error: 'Un envoi est déjà en cours.' };
  _volatileSecretBusy[busy] = 'submit';
  syncVolatileSecretSurfaces();
  try {
    let instance = null;
    try {
      const st = normalizeVolatileSecretsStatus(await mcpRpc(server, MCP_SECRETS_STATUS_METHOD, {}));
      instance = st ? st.instance : null;
    } catch (e) {
      return { entry: null, error: volatileSecretFailureText(e) };
    }
    const kept = loadKeptVolatileSecret(server, key);
    const r = await _depositVolatileSecret(server, key, value, instance, !!(kept && kept.value === value));
    return { entry: r.entry, error: r.error };
  } finally {
    delete _volatileSecretBusy[busy];
    syncVolatileSecretSurfaces();
  }
}

// « Oublier » : le proxy jette les instances construites et remet les
// consommateurs en attente ; la valeur gardée ici et dans les onglets voisins
// (message sans la valeur) est retirée. Rend `{ entry, error }`.
async function forgetVolatileSecret(name, key) {
  const server = getMcpServer(name);
  if (!server) return { entry: null, error: 'Serveur inconnu.' };
  _dropKeptVolatileSecret(server, key);
  if (typeof syncPost === 'function') syncPost('secrets-changed', { server: name, forget: key });
  const av = volatileSecretsAvailabilityFor(server);
  if (!av.ok) { syncVolatileSecretSurfaces(); return { entry: null, error: secretsUnavailableText(av) }; }
  const busy = _volatileSecretBusyKey(name, key);
  _volatileSecretBusy[busy] = 'forget';
  syncVolatileSecretSurfaces();
  try {
    const entry = normalizeVolatileSecretResult(await mcpRpc(server, MCP_SECRETS_FORGET_METHOD, { key: key }));
    if (!entry) return { entry: null, error: 'réponse illisible' };
    _volatileSecretPutEntry(name, entry);
    _volatileSecretMarkAnnounced(name, entry);
    return { entry: entry, error: null };
  } catch (e) {
    return { entry: null, error: volatileSecretFailureText(e) };
  } finally {
    delete _volatileSecretBusy[busy];
    syncVolatileSecretSurfaces();
  }
}

// Réception de `secrets-changed` d'un onglet voisin : retirer la valeur
// oubliée là-bas (`forget`), puis relire l'état du serveur.
function applyPeerSecretsChanged(name, forget) {
  const server = getMcpServer(name);
  if (!server) return;
  if (forget) _dropKeptVolatileSecret(server, forget);
  const st = getMcpStatus(name);
  if (st && st.state === 'ok' && st.secretsDeclared) readVolatileSecretsStatus(server);
}

// ── Cadence ──────────────────────────────────────────────────────────────────
// Lecture à la connexion, au retour de focus ou de visibilité (au plus une
// fois par minute), et sur un minuteur de 5 min suspendu page cachée — même
// patron que la mise à jour du proxy. C'est le minuteur qui voit un
// redémarrage du proxy pendant que l'onglet reste au premier plan.
const VOLATILE_SECRETS_POLL_MS = 300000;
const VOLATILE_SECRETS_FOCUS_MIN_INTERVAL_MS = 60000;
let _volatileSecretsPollTimer = null;
let _volatileSecretsLastRead = 0;

function volatileSecretServers() {
  return listEnabledMcpServers().filter(s => {
    const st = getMcpStatus(s.name);
    return !!(st && st.state === 'ok' && st.secretsDeclared);
  });
}

async function checkVolatileSecrets(fromTimer) {
  const now = Date.now();
  if (!fromTimer && !shouldReadProxyUpdates(_volatileSecretsLastRead, now, VOLATILE_SECRETS_FOCUS_MIN_INTERVAL_MS)) return;
  _volatileSecretsLastRead = now;
  pruneVolatileSecrets();
  await Promise.all(volatileSecretServers().map(s => readVolatileSecretsStatus(s)));
}

function startVolatileSecretsPolling() {
  if (_volatileSecretsPollTimer || typeof setInterval !== 'function') return;
  _volatileSecretsPollTimer = setInterval(function () {
    if (typeof document !== 'undefined' && document.hidden) return;
    checkVolatileSecrets(true);
  }, VOLATILE_SECRETS_POLL_MS);
}

// ── Surfaces ─────────────────────────────────────────────────────────────────
// Critère de docs/toasts.md : l'état durable sur la carte du serveur et la
// pilule, le front en toast. Ici le toast porte aussi la saisie (un toast
// persistant par clef en attente), parce que l'appel qui a besoin du mot de
// passe peut venir de n'importe où et que la carte est dans un drawer fermé.

function volatileSecretToastKey(name, key) { return 'volatile-secret:' + name + ':' + key; }

const _volatileSecretAnnounced = {};   // clé de toast → texte affiché
const _volatileSecretRefocus = {};     // clé de toast → ré-émission voulue après une soumission depuis ce toast
let _volatileSecretCardSig = '';

// Le champ du toast d'une clef est-il en cours de frappe (focus ou contenu) ?
function _volatileSecretToastTyping(toastKey) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return false;
  const toasts = document.querySelectorAll('#toasts .toast');
  for (let i = 0; i < toasts.length; i++) {
    if (toasts[i].dataset.key !== toastKey) continue;
    const pw = toasts[i].querySelector('input.volatile-secret-pw');
    return !!(pw && (pw.value || document.activeElement === pw));
  }
  return false;
}

// Formulaire de saisie d'une clef, pour le toast et pour la carte. Champ
// identifiant visuellement caché dont la valeur est la clef : c'est ce qui
// permet au gestionnaire de mots de passe du navigateur de l'associer (et de
// proposer de l'enregistrer quand le formulaire disparaît après acceptation).
// La valeur ne sort du champ que vers `submitVolatileSecret`.
function buildVolatileSecretForm(name, key, opts) {
  const o = opts || {};
  const form = document.createElement('form');
  form.className = 'volatile-secret-form';
  form.dataset.server = name;
  form.dataset.secretKey = key;
  form.setAttribute('autocomplete', 'on');
  const user = document.createElement('input');
  user.type = 'text';
  user.className = 'volatile-secret-user';
  user.name = 'username';
  user.autocomplete = 'username';
  user.value = key;
  user.tabIndex = -1;
  user.setAttribute('aria-hidden', 'true');
  user.readOnly = true;
  form.appendChild(user);
  const pw = document.createElement('input');
  pw.type = 'password';
  pw.className = 'volatile-secret-pw';
  pw.name = 'password';
  pw.autocomplete = 'current-password';
  pw.spellcheck = false;
  pw.placeholder = o.replace ? 'Nouveau mot de passe' : 'Mot de passe';
  pw.setAttribute('aria-label', 'Mot de passe «\u00a0' + key + '\u00a0»');
  form.appendChild(pw);
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'drawer-btn primary volatile-secret-send';
  btn.textContent = o.replace ? 'Remplacer' : 'Envoyer';
  form.appendChild(btn);
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const value = pw.value;
    if (!value || btn.disabled) return;
    pw.disabled = true;
    btn.disabled = true;
    btn.textContent = 'Vérification…';
    if (o.toastKey) _volatileSecretRefocus[o.toastKey] = true;
    const r = await submitVolatileSecret(name, key, value);
    pw.value = '';
    pw.disabled = false;
    btn.disabled = false;
    btn.textContent = o.replace ? 'Remplacer' : 'Envoyer';
    if (r.error) {
      showToast({ key: volatileSecretToastKey(name, key) + ':error', level: 'error', theme: 'services', text: r.error });
      if (o.toastKey) delete _volatileSecretRefocus[o.toastKey];
    }
    syncVolatileSecretToasts();
  });
  return form;
}

// Un toast persistant par clef en attente, lisible d'ici. Ré-émis seulement
// si son texte change (un toast fermé à la croix ne revient qu'avec un fait
// nouveau), jamais par-dessus une frappe en cours, sauf la ré-émission qui
// suit une soumission depuis ce toast : le nouveau champ, vidé, reçoit alors
// le focus (exception à la règle « jamais de vol de focus » : la frappe était
// déjà là). Retiré dès que la clef n'attend plus.
function syncVolatileSecretToasts() {
  // Même garde que `showToast` : hors d'un vrai navigateur (tests QuickJS, DOM
  // factice), rien à construire.
  if (typeof showToast !== 'function' || typeof requestAnimationFrame !== 'function') return;
  const live = {};
  Object.keys(_volatileSecrets).forEach(name => {
    const e = _volatileSecrets[name];
    if (!e.status) return;
    e.status.secrets.forEach(entry => {
      const toastKey = volatileSecretToastKey(name, entry.key);
      live[toastKey] = true;
      const st = volatileSecretKeyState(entry);
      if (!st.waiting) {
        delete _volatileSecretAnnounced[toastKey];
        delete _volatileSecretRefocus[toastKey];
        dismissToast(toastKey);
        return;
      }
      if (volatileSecretBusy(name, entry.key)) return;
      // Un renvoi est dû (proxy redémarré, valeur gardée) : il part juste après
      // cette synchro, l'attente n'est pas à annoncer.
      const server = getMcpServer(name);
      if (server && volatileSecretShouldResend(entry, loadKeptVolatileSecret(server, entry.key), e.status.instance)) return;
      const refocus = !!_volatileSecretRefocus[toastKey];
      if (!refocus && _volatileSecretAnnounced[toastKey] === st.text) return;
      if (!refocus && _volatileSecretToastTyping(toastKey)) return;
      delete _volatileSecretRefocus[toastKey];
      _volatileSecretAnnounced[toastKey] = st.text;
      const form = buildVolatileSecretForm(name, entry.key, { toastKey: toastKey });
      showToast({ key: toastKey, level: st.phase === 'required' || st.phase === 'untested' ? 'info' : 'warn',
        theme: 'services', persistent: true, text: st.text, body: form });
      if (refocus) {
        const pw = form.querySelector('input.volatile-secret-pw');
        if (pw) pw.focus();
      }
    });
  });
  Object.keys(_volatileSecretAnnounced).forEach(k => {
    if (live[k]) return;
    delete _volatileSecretAnnounced[k];
    dismissToast(k);
  });
}

// Après « Oublier » dans CET onglet : l'attente qui suit est le fait du geste,
// pas une nouvelle à annoncer. Le texte est marqué comme déjà annoncé.
function _volatileSecretMarkAnnounced(name, entry) {
  const st = volatileSecretKeyState(entry);
  if (st.waiting) _volatileSecretAnnounced[volatileSecretToastKey(name, entry.key)] = st.text;
}

// Libellé court de l'état d'une clef, en tête de sa rangée dans la carte.
function volatileSecretRowLabel(entry, busy) {
  if (busy === 'submit' || busy === 'resend') return 'vérification en cours…';
  if (busy === 'forget') return 'oubli en cours…';
  const st = volatileSecretKeyState(entry);
  if (st.phase === 'rejected') return 'mot de passe refusé';
  if (st.phase === 'indeterminate' || st.phase === 'incomplete') return 'non vérifié';
  if (st.waiting) return 'requis';
  if (st.replacementRefused) return 'en service, remplacement refusé';
  return entry.held ? 'en service' : '';
}

// Section « Mots de passe » de la carte d'un serveur qui déclare l'extension.
// Appelée par `buildMcpCard`.
function appendVolatileSecretRows(parent, name, liveStatus) {
  if (!liveStatus || liveStatus.state !== 'ok' || !liveStatus.secretsDeclared) return;
  const e = _volatileSecrets[name] || null;
  const box = document.createElement('div');
  box.className = 'mcp-secrets';
  const title = document.createElement('div');
  title.className = 'mcp-skills-title';
  title.textContent = 'Mots de passe';
  box.appendChild(title);
  const note = text => {
    const n = document.createElement('div');
    n.className = 'mcp-skill-note';
    n.textContent = text;
    box.appendChild(n);
  };
  if (!e) note('Lecture de l\u2019état en cours…');
  else if (e.unavailable) note(secretsUnavailableText(e.unavailable));
  else if (!e.status) note('État illisible\u00a0: ' + (e.error || 'échec'));
  else if (!e.status.secrets.length) note('Aucun mot de passe attendu.');
  if (e && e.status) {
    const server = getMcpServer(name);
    e.status.secrets.forEach(entry => {
      const busy = volatileSecretBusy(name, entry.key);
      const st = volatileSecretKeyState(entry);
      const row = document.createElement('div');
      row.className = 'mcp-skill-row mcp-secret-row';
      row.dataset.state = st.waiting ? 'pending' : (entry.held ? 'approved' : 'absent');
      row.dataset.secretKey = entry.key;
      const head = document.createElement('div');
      head.className = 'mcp-skill-head';
      const label = document.createElement('span');
      label.className = 'mcp-skill-name';
      label.textContent = entry.key;
      head.appendChild(label);
      const state = document.createElement('span');
      state.className = 'mcp-skill-state';
      state.textContent = volatileSecretRowLabel(entry, busy);
      head.appendChild(state);
      const held = entry.held || entry.consumers.some(c => c.state === 'ready');
      if (held || (server && loadKeptVolatileSecret(server, entry.key))) {
        const actions = document.createElement('span');
        actions.className = 'mcp-skill-actions';
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'drawer-btn volatile-secret-forget';
        forget.textContent = 'Oublier';
        forget.disabled = !!busy;
        setTip(forget, 'Le proxy et les onglets de MIAOU oublient ce mot de passe');
        forget.addEventListener('click', async () => {
          const r = await forgetVolatileSecret(name, entry.key);
          if (r.error) showToast({ key: volatileSecretToastKey(name, entry.key) + ':error', level: 'error', theme: 'services', text: r.error });
        });
        actions.appendChild(forget);
        head.appendChild(actions);
      }
      row.appendChild(head);
      const ul = document.createElement('ul');
      ul.className = 'mcp-secret-consumers';
      entry.consumers.forEach(c => {
        const li = document.createElement('li');
        li.textContent = c.upstream + '\u00a0: ' + volatileSecretConsumerText(c);
        ul.appendChild(li);
      });
      row.appendChild(ul);
      if (!busy) row.appendChild(buildVolatileSecretForm(name, entry.key, { replace: held && !st.waiting }));
      box.appendChild(row);
    });
  }
  parent.appendChild(box);
}

// Frappe en cours dans les champs de la liste des cartes : relevée avant que
// `renderMcpServers` ne la reconstruise, remise après. Une lecture d'état
// (minuteur, retour de focus, onglet voisin) ne doit pas effacer ce qu'on
// tape. Rien n'est gardé au-delà du rendu.
function captureVolatileSecretInputs(wrap) {
  const out = [];
  if (!wrap || !wrap.querySelectorAll) return out;
  wrap.querySelectorAll('form.volatile-secret-form').forEach(form => {
    const pw = form.querySelector('input.volatile-secret-pw');
    const focused = typeof document !== 'undefined' && document.activeElement === pw;
    if (!pw || (!pw.value && !focused)) return;
    out.push({ server: form.dataset.server, key: form.dataset.secretKey, value: pw.value, focused: focused,
      start: pw.selectionStart, end: pw.selectionEnd });
  });
  return out;
}

function restoreVolatileSecretInputs(wrap, captured) {
  if (!wrap || !captured || !captured.length) return;
  const forms = wrap.querySelectorAll('form.volatile-secret-form');
  captured.forEach(c => {
    for (let i = 0; i < forms.length; i++) {
      if (forms[i].dataset.server !== c.server || forms[i].dataset.secretKey !== c.key) continue;
      const pw = forms[i].querySelector('input.volatile-secret-pw');
      if (!pw || pw.disabled) return;
      pw.value = c.value;
      if (c.focused) {
        pw.focus();
        try { pw.setSelectionRange(c.start, c.end); } catch (e) { /* type password : sans conséquence */ }
      }
      return;
    }
  });
}

// Point de passage unique après tout changement d'état : toasts, pilule, et
// cartes — re-rendues seulement si ce qu'elles montrent a changé (une
// lecture cadencée qui ne change rien ne reconstruit rien).
function syncVolatileSecretSurfaces() {
  if (typeof document === 'undefined') return;
  const sig = JSON.stringify([_volatileSecrets, _volatileSecretBusy]).replace(/"readAt":\d+,?/g, '');
  if (sig !== _volatileSecretCardSig) {
    _volatileSecretCardSig = sig;
    if (typeof renderMcpServersIfOpen === 'function') renderMcpServersIfOpen();
  } else if (typeof syncAuthorizationPending === 'function') {
    syncAuthorizationPending();
  }
  syncVolatileSecretToasts();
}
