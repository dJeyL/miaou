/* ─── Statistiques de consommation de tokens ────────────────────────────────
   Collecte de ce que chaque appel de complétion a consommé, agrégée par (jour,
   serveur, modèle, nature d'appel), cf. docs/usage-stats.md.

   Ce fichier porte les purs de la collecte et le point d'enregistrement commun
   aux deux points réseau (`streamCompletion`, `silentCompletion`, api.js).
   L'accès IndexedDB (`recordModelUsage`) reste dans storage.js avec les autres
   stores. Chargé après storage.js et avant api.js dans JS_ORDER (build.py ET
   tests/runner.py).

   Aucun pur ne lit l'horloge : le jour est calculé par l'appelant, au moment où
   l'appel se termine, et passé en argument. Les tests QuickJS tournent dans le
   fuseau du processus et doivent pouvoir fixer « aujourd'hui ». */

// Clef de jour CALENDAIRE LOCAL, `YYYY-MM-DD`. Même calcul que le nom de
// fichier d'export : on délègue plutôt que de recopier le pad. Un nom à part,
// parce que la clef de statistique n'a rien d'un nom de fichier et qu'elle ne
// doit pas changer si le format des exports change un jour.
function localDayKey(ts) {
  return exportDateStamp(ts);
}

// Nature d'appel telle que l'appelant l'a déclarée, sinon `'other'`. PAS de
// liste fermée : une nature future s'enregistre sans toucher à ce pur, et un
// appelant qui oublie la sienne tombe dans une catégorie visible, jamais dans
// le néant (l'oubli se voit dans les données).
function normalizeUsagePurpose(purpose) {
  return (typeof purpose === 'string' && purpose.trim()) ? purpose.trim() : 'other';
}

// Prédicat unique « cet appel compte-t-il ? », appelé par les deux points
// réseau. Compte un appel dont la requête est partie et que le backend n'a pas
// refusé :
//   - `answered` : réponse 2xx reçue (avec ou sans usage) ;
//   - `aborted`  : interrompu (Stop, chien de garde du stream, timeout de
//     silentCompletion), y compris AVANT les en-têtes — sur un long prefill le
//     calcul a eu lieu, et on ne sait pas distinguer ce cas d'une requête jamais
//     reçue : on compte, comme « non mesuré ».
// Ne comptent pas : une erreur réseau (l'appelant ne passe jamais ici avec
// `answered` ni `aborted`) et un refus HTTP (`refused`, non-2xx), même si un
// abort survient ensuite pendant la lecture du corps d'erreur — un refus n'a
// rien consommé. Un rejeu interne (reasoning_effort, vision) est un appel à
// part, compté par sa propre invocation.
function modelCallCounts(state) {
  const s = state || {};
  if (s.refused) return false;
  return !!(s.answered || s.aborted);
}

// Usage API d'UN appel → incrément à sommer dans l'agrégat. Décodage par
// `usageDerived`, jamais un second. Un appel est « mesuré » dès que le backend
// a rendu au moins un de ses deux compteurs principaux ; le compteur manquant
// compte alors pour 0. Sans aucun des deux (usage absent, stream interrompu
// avant le chunk terminal, backend qui ne le renvoie pas), l'appel est compté
// dans `unmeasured` et n'apporte aucun token : l'écran dit « N appels non
// mesurés » au lieu de sous-compter en silence.
// `cachedKnownCalls` compte les appels mesurés dont le cache était RENSEIGNÉ,
// zéro compris : un `cached_tokens: 0` est une mesure, un champ absent n'en est
// pas une. C'est ce qui permet à la vue de distinguer « n/d » (aucun appel
// connu) d'un total partiel (une partie seulement).
function usageStatsDelta(usage) {
  const d = usageDerived(usage);
  const measured = d.inTokens != null || d.outTokens != null;
  if (!measured) {
    return { calls: 1, unmeasured: 1, inTokens: 0, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 0 };
  }
  const cachedKnown = d.cachedTokens != null;
  return {
    calls: 1,
    unmeasured: 0,
    inTokens: d.inTokens || 0,
    cachedTokens: cachedKnown ? d.cachedTokens : 0,
    cachedKnownCalls: cachedKnown ? 1 : 0,
    outTokens: d.outTokens || 0,
  };
}

// Champs sommés d'un record d'agrégat. Source unique pour la fusion et, aux
// étapes suivantes, pour les totaux de la vue.
const USAGE_STATS_SUM_FIELDS = ['calls', 'unmeasured', 'inTokens', 'cachedTokens', 'cachedKnownCalls', 'outTokens'];

// Clef d'un record, dans l'ordre du keyPath du store `usage_stats`
// (`['day', 'serverId', 'model', 'purpose']`, storage.js). Seul point qui
// compose cette clef : `get` et `put` doivent viser le même record.
function usageStatsKey(k) {
  return [String(k.day || ''), String(k.serverId || ''), String(k.model || ''), normalizeUsagePurpose(k.purpose)];
}

// Fusionne un incrément dans le record existant (`prev`, absent pour un
// premier appel du jour). `serverName` est RÉÉCRIT à chaque fusion : c'est
// l'instantané du dernier nom connu, qui ne sert qu'une fois le serveur
// supprimé (l'écran affiche sinon le nom du serveur vivant, clef par id).
// Rend un objet neuf, `prev` n'est pas muté.
function mergeUsageStatsRecord(prev, delta, key, serverName) {
  const k = usageStatsKey(key);
  const out = { day: k[0], serverId: k[1], model: k[2], purpose: k[3], serverName: String(serverName || '') };
  for (const f of USAGE_STATS_SUM_FIELDS) {
    const a = prev && Number.isFinite(prev[f]) ? prev[f] : 0;
    const b = delta && Number.isFinite(delta[f]) ? delta[f] : 0;
    out[f] = a + b;
  }
  return out;
}

// Point d'enregistrement commun aux deux points réseau. `server` est le serveur
// actif capturé AU DÉBUT de l'appel, au même instant que sa config : lu en fin
// d'appel, un changement de serveur actif pendant la génération attribuerait la
// consommation au mauvais serveur. Le jour est figé ICI, à la fin de l'appel
// (un appel à cheval sur minuit compte le jour où il se termine).
// Jamais attendu par l'appelant : une statistique ratée ne doit ni retarder ni
// faire échouer une génération (`recordModelUsage` ne rejette pas).
function noteModelUsage(server, model, purpose, usage) {
  if (typeof recordModelUsage !== 'function') return;
  const key = { day: localDayKey(Date.now()), serverId: server ? server.id : '', model: model || '', purpose };
  recordModelUsage(key, usageStatsDelta(usage), server ? server.name : '');
}

// ── Consultation : dates civiles ────────────────────────────────────────────
// Toute l'arithmétique des échelles se fait sur des DATES CIVILES (clefs
// `YYYY-MM-DD` passées par `Date.UTC`), jamais en retranchant 86 400 000 à un
// horodatage local : un passage à l'heure d'été ou d'hiver décalerait un bac
// d'un jour. Seul « aujourd'hui » vient de l'heure locale (`localDayKey`), et il
// arrive en argument.
const USAGE_DAY_MS = 86400000;

function _usageKeyParts(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
}
function _usageUtcToKey(ms) {
  const d = new Date(ms);
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}
function _usageKeyToUtc(key) {
  const p = _usageKeyParts(key);
  return p ? Date.UTC(p[0], p[1], p[2]) : NaN;
}

// Clef décalée de `n` jours civils (n négatif = vers le passé).
function usageAddDays(key, n) {
  return _usageUtcToKey(_usageKeyToUtc(key) + n * USAGE_DAY_MS);
}

// Même quantième `n` mois plus tôt (n négatif) ou plus tard. Un quantième
// absent du mois d'arrivée (31 → avril, 29-31 → février) est ramené au DERNIER
// jour de ce mois, année bissextile comprise. Toujours calculé depuis la clef
// d'origine, jamais en chaînant des décalages d'un mois : le repli d'un mois
// court ne doit pas se propager aux suivants.
function usageAddMonths(key, n) {
  const p = _usageKeyParts(key);
  const target = p[1] + n;
  const y = p[0] + Math.floor(target / 12);
  const m = ((target % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return _usageUtcToKey(Date.UTC(y, m, Math.min(p[2], last)));
}

// Nombre de jours civils de `a` à `b` (b − a).
function usageDaysBetween(a, b) {
  return Math.round((_usageKeyToUtc(b) - _usageKeyToUtc(a)) / USAGE_DAY_MS);
}

// ── Consultation : échelles ─────────────────────────────────────────────────
// Ordre croissant = ordre d'affichage ET ordre de la règle « une échelle n'est
// proposée que si elle apporte des données que la précédente n'a pas ».
// `span` : étendue en unités de la granularité. « 3 mois » = 13 semaines
// pleines (91 jours) : trois mois glissants ne font pas un nombre entier de
// semaines, et des bacs de largeur égale restent comparables entre eux.
const USAGE_SCALES = [
  { id: 'week',    label: '1 semaine', granularity: 'day',   span: 7 },
  { id: 'month',   label: '1 mois',    granularity: 'day',   months: 1 },
  { id: 'quarter', label: '3 mois',    granularity: 'week',  span: 13 },
  { id: 'half',    label: '6 mois',    granularity: 'month', span: 6 },
  { id: 'year',    label: '1 an',      granularity: 'month', span: 12 },
];
const USAGE_DEFAULT_SCALE = 'month';

function _usageScale(id) {
  return USAGE_SCALES.find(s => s.id === id) || null;
}

// Fenêtre d'une échelle, bornes INCLUSES, comptée à rebours depuis
// aujourd'hui (glissante, jamais alignée sur le lundi ni sur le 1er). Un mois
// glissant va du lendemain du même quantième le mois précédent jusqu'à
// aujourd'hui : c'est ce qui rend les bacs mensuels contigus sans se
// recouvrir.
function usageScaleWindow(scaleId, todayKey) {
  const s = _usageScale(scaleId);
  if (!s) return null;
  let start;
  if (s.months) start = usageAddDays(usageAddMonths(todayKey, -s.months), 1);
  else if (s.granularity === 'day') start = usageAddDays(todayKey, -(s.span - 1));
  else if (s.granularity === 'week') start = usageAddDays(todayKey, -(s.span * 7 - 1));
  else start = usageAddDays(usageAddMonths(todayKey, -s.span), 1);
  return { start, end: todayKey };
}

// Échelles proposées pour une sélection dont la plus ancienne donnée est
// `oldestKey`. La première l'est toujours (dès qu'il y a des données) ; chaque
// suivante seulement si la donnée la plus ancienne précède le début de la
// PRÉCÉDENTE — sinon elle montrerait exactement la même chose, en plus large.
function availableUsageScales(oldestKey, todayKey) {
  if (!_usageKeyParts(oldestKey)) return [];
  const out = [USAGE_SCALES[0].id];
  for (let i = 1; i < USAGE_SCALES.length; i++) {
    const prev = usageScaleWindow(USAGE_SCALES[i - 1].id, todayKey);
    if (oldestKey < prev.start) out.push(USAGE_SCALES[i].id);
    else break;
  }
  return out;
}

// Échelle à afficher : le choix courant s'il est encore proposé, sinon le
// défaut (« 1 mois ») s'il l'est, sinon la plus grande proposée.
function resolveUsageScale(current, available) {
  if (!available.length) return null;
  if (current && available.indexOf(current) >= 0) return current;
  if (available.indexOf(USAGE_DEFAULT_SCALE) >= 0) return USAGE_DEFAULT_SCALE;
  return available[available.length - 1];
}

// ── Consultation : sélection et totaux ──────────────────────────────────────
// Filtre serveur/modèle : `null` (ou absent) = tous. Jamais `''` pour « tous » :
// `''` est une valeur RÉELLE de clef (appel sans modèle configuré, ou sans
// serveur), et la confondre avec « tous » rendait cette ligne impossible à
// isoler. La nature d'appel n'est PAS un filtre (enregistrée, pas encore
// exploitée à l'écran).
function filterUsageRecords(records, filter) {
  const f = filter || {};
  return (records || []).filter(r =>
    (f.serverId == null || r.serverId === f.serverId) && (f.model == null || r.model === f.model));
}

function usageOldestDay(records) {
  let oldest = null;
  for (const r of (records || [])) if (oldest === null || r.day < oldest) oldest = r.day;
  return oldest;
}

// Serveurs proposés au filtre : les serveurs VIVANTS (ordre de la liste des
// réglages, nom vivant — un renommage ne pose aucune question puisque tout est
// clefé par id), puis ceux qui n'existent plus mais ont des statistiques, sous
// le dernier nom enregistré (celui du record le plus récent) et marqués
// supprimés.
function usageServerOptions(records, liveServers) {
  const live = (liveServers || []).map(s => ({ id: s.id, name: s.name || s.url || s.id, deleted: false }));
  const liveIds = new Set(live.map(s => s.id));
  const gone = new Map();
  for (const r of (records || [])) {
    if (liveIds.has(r.serverId)) continue;
    const prev = gone.get(r.serverId);
    if (!prev || r.day >= prev.day) gone.set(r.serverId, { day: r.day, name: r.serverName });
  }
  const deleted = [...gone.entries()]
    .map(([id, g]) => ({ id, name: g.name || 'Serveur sans nom', deleted: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return live.concat(deleted);
}

// Modèles présents dans les statistiques du serveur choisi (`null` = tous), triés.
// Par NOM, homonymes compris (décision du 2026-09-29) : sous « Tous les
// serveurs », choisir un modèle servi par deux serveurs montre une ligne par
// serveur (cf. usageTotals), ce qui compare le même modèle d'un serveur à
// l'autre ; une option par couple ferait doublon avec le filtre serveur.
function usageModelOptions(records, serverId) {
  const set = new Set();
  for (const r of filterUsageRecords(records, { serverId })) set.add(r.model);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// État du cache d'un total, pour l'affichage :
//   'unknown' → aucun appel mesuré n'a renseigné le cache (« n/d ») ;
//   'partial' → une partie seulement (valeur marquée d'une astérisque) ;
//   'known'   → tous les appels mesurés l'ont renseigné.
// Les appels non mesurés n'entrent pas dans la question : ils n'ont rapporté
// aucun compteur, ils ont leur propre colonne.
function usageCacheState(t) {
  const measured = t.calls - t.unmeasured;
  if (!t.cachedKnownCalls || measured <= 0) return 'unknown';
  return t.cachedKnownCalls < measured ? 'partial' : 'known';
}

// Totaux d'une sélection sur une fenêtre (bornes incluses) : une ligne par
// couple (serveur, modèle), triée par volume d'entrée décroissant, et la somme.
// Champs sommés : `USAGE_STATS_SUM_FIELDS`, la même liste que la fusion.
// Clef par COUPLE, jamais par nom seul : un même modèle servi par deux serveurs
// (travail et maison) fait deux lignes. `sharedName` marque les lignes dont le
// nom apparaît sur plusieurs serveurs de la sélection — c'est lui qui décide
// d'afficher le serveur, pas le filtre : sous un filtre serveur, il est toujours
// faux par construction.
function usageTotals(records, win) {
  const zero = () => {
    const o = {};
    for (const f of USAGE_STATS_SUM_FIELDS) o[f] = 0;
    return o;
  };
  const byPair = new Map();
  const total = zero();
  for (const r of (records || [])) {
    if (win && (r.day < win.start || r.day > win.end)) continue;
    const key = JSON.stringify([r.serverId, r.model]);
    if (!byPair.has(key)) byPair.set(key, Object.assign({ serverId: r.serverId, model: r.model }, zero()));
    const row = byPair.get(key);
    for (const f of USAGE_STATS_SUM_FIELDS) {
      const v = Number.isFinite(r[f]) ? r[f] : 0;
      row[f] += v;
      total[f] += v;
    }
  }
  const serversByName = new Map();
  for (const row of byPair.values()) serversByName.set(row.model, (serversByName.get(row.model) || 0) + 1);
  const rows = [...byPair.values()]
    .map(t => Object.assign(t, { sharedName: serversByName.get(t.model) > 1, cacheState: usageCacheState(t) }))
    .sort((a, b) => (b.inTokens - a.inTokens) || a.model.localeCompare(b.model) || String(a.serverId).localeCompare(String(b.serverId)));
  return { rows, total: Object.assign({ cacheState: usageCacheState(total) }, total) };
}

// Nombre du tableau, en notation compacte au-delà de 9 999 : trois chiffres
// significatifs et une unité (« 12,3 k », « 1,23 M », « 123 M », « 1,50 G »).
// La largeur reste bornée à sept caractères quel que soit le volume — en
// valeur exacte, cinq colonnes de centaines de millions ne laissaient presque
// rien au nom du modèle. La valeur exacte passe en infobulle
// (`usageExactCount`). Seuil à 10 000 : en dessous, le nombre exact n'est pas
// plus large que sa forme compacte.
function formatUsageCount(n) {
  if (!Number.isFinite(n) || Math.abs(n) < 10000) return formatTokenCount(Number.isFinite(n) ? n : 0);
  const units = [[1e3, 'k'], [1e6, 'M'], [1e9, 'G']];
  for (let i = 0; i < units.length; i++) {
    const v = n / units[i][0];
    // Arrondi APRÈS le choix de l'unité : 999 500 donnerait « 1000 k », d'où
    // le passage à l'unité suivante dès que l'arrondi atteint 1 000.
    if (Math.abs(v) < 999.5 || i === units.length - 1) {
      const a = Math.abs(v);
      const s = a < 9.995 ? v.toFixed(2) : a < 99.95 ? v.toFixed(1) : v.toFixed(0);
      return s.replace('.', ',') + '\u202f' + units[i][1];
    }
  }
}

// Valeur exacte d'un nombre compacté par formatUsageCount, `null` s'il ne l'a
// pas été (l'infobulle répéterait la cellule).
function usageExactCount(n) {
  return Number.isFinite(n) && Math.abs(n) >= 10000 ? formatTokenCount(n) : null;
}

// « 28 septembre 2026 » depuis une clef de jour.
function formatUsageDay(key) {
  const p = _usageKeyParts(key);
  if (!p) return '';
  return p[2] + (p[2] === 1 ? 'er' : '') + ' ' + FR_MONTHS_FULL[p[1]] + ' ' + p[0];
}

// ── Consultation : graphe (purs) ────────────────────────────────────────────
// Trois panneaux alignés sur le même axe du temps : entrée (hors cache /
// servie par le cache / cache non renseigné), sortie, requêtes. Deux panneaux
// plutôt qu'un axe double : la sortie pèse quelques pour cent de l'entrée et
// resterait collée à la ligne de base. Pas de ventilation par modèle dans le
// graphe : le tableau et le filtre modèle font ce travail.

const USAGE_MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Jour de la semaine d'une clef (0 = dimanche), sur la date civile.
function _usageDow(key) {
  const p = _usageKeyParts(key);
  return new Date(Date.UTC(p[0], p[1], p[2])).getUTCDay();
}

// Bacs d'une fenêtre, dans l'ordre chronologique, bornes incluses : un par jour
// (1 semaine, 1 mois), par 7 jours (3 mois : 13 bacs) ou par mois glissant au
// quantième (6 mois, 1 an). Tout est compté à rebours depuis la fin de la
// fenêtre (aujourd'hui) : le dernier bac finit aujourd'hui, jamais un dimanche
// ni un fin de mois. Chaque bac mensuel est calculé DEPUIS la fin, jamais en
// chaînant : le repli d'un quantième absent (31 → 30 avril) ne se propage pas
// aux bacs suivants, et deux bacs voisins restent contigus.
function usageBins(win, scaleId) {
  const s = _usageScale(scaleId);
  if (!s || !win) return [];
  const out = [];
  if (s.granularity === 'day') {
    const n = usageDaysBetween(win.start, win.end) + 1;
    for (let i = 0; i < n; i++) {
      const d = usageAddDays(win.start, i);
      out.push({ start: d, end: d });
    }
  } else if (s.granularity === 'week') {
    for (let k = s.span - 1; k >= 0; k--) {
      out.push({ start: usageAddDays(win.end, -7 * k - 6), end: usageAddDays(win.end, -7 * k) });
    }
  } else {
    for (let k = s.span - 1; k >= 0; k--) {
      out.push({ start: usageAddDays(usageAddMonths(win.end, -(k + 1)), 1), end: usageAddMonths(win.end, -k) });
    }
  }
  return out;
}

// Repères calendaires : position en FRACTION de la largeur des bacs, au prorata
// du jour dans son bac (le repère tombe sur le bord gauche du jour qu'il marque).
// Mois (1ers) toujours ; semaines (lundis) seulement aux échelles au jour. Un
// 1er qui tombe un lundi est un repère de mois, un seul. Aucun repère au bord
// gauche : le début du graphe n'a pas à être marqué.
function calendarMarkers(bins, granularity) {
  const out = [];
  const n = bins.length;
  for (let i = 0; i < n; i++) {
    const b = bins[i];
    const len = usageDaysBetween(b.start, b.end) + 1;
    for (let j = 0; j < len; j++) {
      if (i === 0 && j === 0) continue;
      const d = usageAddDays(b.start, j);
      const isMonth = _usageKeyParts(d)[2] === 1;
      const isWeek = granularity === 'day' && _usageDow(d) === 1;
      if (!isMonth && !isWeek) continue;
      out.push({ day: d, kind: isMonth ? 'month' : 'week', pos: (i + j / len) / n });
    }
  }
  return out;
}

// Totaux par bac d'une sélection déjà filtrée. Mêmes champs que usageTotals
// (`USAGE_STATS_SUM_FIELDS`), plus la décomposition de l'entrée pour la pile :
// chaque ENREGISTREMENT (jour, serveur, modèle, nature) est classé à part par
// `usageCacheState` — cache renseigné, même partiellement : part hors cache
// (`freshIn`) et part en cache (`cachedIn`) ; jamais renseigné : tout dans
// `unknownIn`. Classer le bac d'un bloc aurait versé dans « non renseigné » un
// modèle qui le renseigne dès qu'un voisin du même jour ne le renseigne pas.
// Un enregistrement hors de tous les bacs est ignoré.
function usageBinTotals(records, bins) {
  const out = bins.map(b => {
    const o = { start: b.start, end: b.end, freshIn: 0, cachedIn: 0, unknownIn: 0 };
    for (const f of USAGE_STATS_SUM_FIELDS) o[f] = 0;
    return o;
  });
  for (const r of (records || [])) {
    // Bacs contigus et triés : recherche dichotomique du dernier bac qui
    // commence au plus tard ce jour-là.
    let lo = 0, hi = bins.length - 1, i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bins[mid].start <= r.day) { i = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (i < 0 || r.day > bins[i].end) continue;
    const b = out[i];
    const v = {};
    for (const f of USAGE_STATS_SUM_FIELDS) {
      v[f] = Number.isFinite(r[f]) ? r[f] : 0;
      b[f] += v[f];
    }
    if (usageCacheState(v) === 'unknown') b.unknownIn += v.inTokens;
    else {
      const cached = Math.min(Math.max(v.cachedTokens, 0), v.inTokens);
      b.cachedIn += cached;
      b.freshIn += v.inTokens - cached;
    }
  }
  for (const b of out) b.cacheState = usageCacheState(b);
  return out;
}

// Pas « rond » d'une graduation (1, 2, 2,5 ou 5 × 10^n) couvrant `v`.
function usageNiceStep(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v * (1 - 1e-9)) return m * p;
  return 10 * p;
}

// Axe d'un panneau : `ticks` pas ronds au-dessus de la ligne de base, et un
// maximum qui couvre la plus haute barre. Un panneau vide garde un axe (1 pas).
// Le pas est entier et jamais sous 1 : on ne gradue pas des fractions de
// token (un pas de 2,5 devient 3).
function usageChartAxis(maxValue, ticks) {
  const step = Math.max(1, Math.ceil(usageNiceStep((maxValue > 0 ? maxValue : 0) / (ticks || 1))));
  return { step, max: Math.max(step, Math.ceil(maxValue / step - 1e-9) * step) };
}

// Libellé de graduation : la notation compacte du tableau, sans les zéros de
// queue (« 1,5 M » plutôt que « 1,50 M », « 1 M » plutôt que « 1,00 M »).
// Compacte dès 1 000, et non 10 000 comme le tableau : sur un même axe,
// « 5 000 » sous « 10 k » mêlerait deux notations.
function formatUsageTick(n) {
  if (Math.abs(n) >= 1000 && Math.abs(n) < 10000) {
    return String(Math.round(n / 10) / 100).replace('.', ',') + '\u202fk';
  }
  return formatUsageCount(n).replace(/(,\d*?)0+(?= )/, '$1').replace(/,(?= )/, '');
}

// « 7 sept. », « 1er oct. » ; avec le jour de la semaine : « lun. 28 sept. ».
function usageShortDay(key, withDow) {
  const p = _usageKeyParts(key);
  if (!p) return '';
  return (withDow ? FR_DAYS_ABBR[_usageDow(key)] + '. ' : '') + (p[2] === 1 ? '1er' : p[2]) + ' ' + USAGE_MONTHS_SHORT[p[1]];
}

// Libellé d'un repère : le mois abrégé (l'année en janvier, seul mois où elle
// change), ou le jour pour une semaine.
function usageMarkerLabel(m) {
  const p = _usageKeyParts(m.day);
  if (!p) return '';
  if (m.kind === 'month') return USAGE_MONTHS_SHORT[p[1]] + (p[1] === 0 ? ' ' + p[0] : '');
  return usageShortDay(m.day, false);
}

// Titre d'infobulle d'un bac : le jour, ou la période.
function usageBinTitle(b) {
  if (b.start === b.end) return formatUsageDay(b.start);
  return 'Du ' + formatUsageDay(b.start) + ' au ' + formatUsageDay(b.end);
}

// Cache d'un total, en texte : « 870 k », « 870 k* » (renseigné par une partie
// des appels seulement : un minimum, comme l'astérisque du tableau), « n/d ».
function _usageCacheText(t) {
  if (t.cacheState === 'unknown') return 'n/d';
  return formatUsageCount(t.cachedTokens) + (t.cacheState === 'partial' ? '*' : '');
}

// Détail d'infobulle d'un bac, construit ici (nombres et dates seulement :
// aucun nom d'origine backend n'y entre).
function usageBinTipDetail(b) {
  if (!b.calls) return 'Aucun appel';
  const lines = [
    'Entrée : ' + formatUsageCount(b.inTokens) + ' (cache : ' + _usageCacheText(b) + ')',
    'Sortie : ' + formatUsageCount(b.outTokens),
    'Requêtes : ' + formatUsageCount(b.calls) + (b.unmeasured
      ? ', dont ' + formatUsageCount(b.unmeasured) + ' non mesurée' + (b.unmeasured > 1 ? 's' : '') : ''),
  ];
  if (b.cacheState === 'partial') lines.push('* cache renseigné par une partie des appels seulement');
  return lines.join('\n');
}

// Nom accessible du graphe : ce qu'il montre et les totaux de la période. Le
// détail bac par bac reste à la souris (aucun arrêt de tabulation par bac) ; le
// tableau porte les valeurs.
function usageChartSummary(total, win, granularity, binCount) {
  const per = { day: 'par jour', week: 'par semaine', month: 'par mois' }[granularity] || '';
  let cache;
  if (total.cacheState === 'unknown') cache = 'cache non renseigné';
  else cache = (total.cacheState === 'partial' ? 'dont au moins ' : 'dont ') + formatUsageCount(total.cachedTokens) + ' servis par le cache';
  return 'Consommation ' + per + ' (' + binCount + ' barres), du ' + formatUsageDay(win.start) + ' au ' + formatUsageDay(win.end) +
    ' : entrée ' + formatUsageCount(total.inTokens) + ' tokens, ' + cache +
    ' ; sortie ' + formatUsageCount(total.outTokens) + ' tokens ; ' + formatUsageCount(total.calls) +
    ' requête' + (total.calls > 1 ? 's' : '') + '. Valeurs dans le tableau ci-dessous.';
}

// Géométrie verticale d'une pile de segments (valeurs de bas en haut, en px
// depuis le haut du panneau). Un espace de surface de `gap` px sépare deux
// segments ; un segment non nul garde au moins 1 px pour rester visible ; les
// segments nuls sont omis. Le dernier rendu porte le bout arrondi (`top`).
function usageStackGeometry(values, vmax, h, gap) {
  const out = [];
  let acc = 0;
  const nz = values.map((v, k) => [k, v]).filter(e => e[1] > 0);
  nz.forEach(([k, v], j) => {
    const y0 = h - (acc / vmax) * h;
    acc += v;
    const y1 = h - (acc / vmax) * h;
    const g = j > 0 ? gap : 0;
    const hh = Math.max(1, (y0 - y1) - g);
    // Le minimum de 1 px ne doit pas faire sortir un segment fin par le haut du
    // panneau (dans le bandeau de titre) quand la pile touche le maximum.
    out.push({ index: k, y: Math.max(0, y0 - g - hh), h: hh, top: j === nz.length - 1 });
  });
  return out;
}

// ── Consultation : drawer ───────────────────────────────────────────────────
// Relu en entier à CHAQUE ouverture (aucun broadcast, cf. docs/multitab-sync.md) :
// un appel fait dans un autre onglet apparaît à la prochaine ouverture, et le
// drawer ne se met pas à jour pendant qu'il est ouvert.
//
// Points d'entrée : palette (touche `u`), réglages › Connexion, le glyphe
// « barres » de chaque fiche serveur, qui ouvre le drawer filtré sur ce
// serveur, et celui de chaque ligne de son tableau des modèles, filtré en plus
// sur le modèle. Ouvert par-dessus les drawers des réglages et des serveurs sans les
// fermer (empilement, Échap les dépile un par un — trackDrawer, ui.js).
let _usageRecords = [];
let _usageFilter = { serverId: null, model: null };
// Valeur de pilule pour « tous » : une chaîne qu'aucun id de serveur ni nom de
// modèle ne peut prendre (`''` en est une, cf. filterUsageRecords).
const USAGE_ALL = '\u0000all';
// Échelle CHOISIE par l'utilisateur, distincte de l'échelle affichée : si un
// filtre la rend indisponible, on affiche le repli, et elle revient d'elle-même
// quand le filtre la rend de nouveau pertinente.
let _usageScaleChoice = null;
let _usageSeq = 0;

async function openUsageStats(opts) {
  const o = opts || {};
  // `model` (glyphe d'une ligne du tableau des modèles) : filtre par nom, comme la
  // pilule. Un modèle sans statistiques retombe sur « tous » au rendu.
  _usageFilter = {
    serverId: typeof o.serverId === 'string' ? o.serverId : null,
    model: typeof o.model === 'string' && o.model ? o.model : null,
  };
  $('usage-drawer').classList.add('show');
  $('usage-backdrop').classList.add('show');
  const body = $('usage-body');
  $('usage-filters').innerHTML = '';
  body.textContent = 'Lecture des statistiques…';
  // Jeton de séquence : un drawer refermé puis rouvert pendant la lecture fait
  // abandonner le rendu devenu obsolète (piège 24, relire après l'await).
  const seq = ++_usageSeq;
  let recs;
  try { recs = await readAllUsageStats(); }
  catch (e) {
    if (seq !== _usageSeq) return;
    body.textContent = 'Statistiques illisibles\u00a0: ' + (e && e.message ? e.message : 'erreur inconnue') + '.';
    return;
  }
  if (seq !== _usageSeq) return;
  _usageRecords = recs || [];
  renderUsageStats();
}

function closeUsageStats() {
  _usageSeq++;
  $('usage-drawer').classList.remove('show');
  $('usage-backdrop').classList.remove('show');
}

function renderUsageStats() {
  const filtersEl = $('usage-filters');
  const body = $('usage-body');
  if (!filtersEl || !body) return;
  const records = _usageRecords;
  const today = localDayKey(Date.now());

  // Filtre serveur. Un id qui n'est plus proposé (serveur supprimé sans
  // statistiques) retombe sur « tous ».
  const servers = usageServerOptions(records, loadApiServers());
  if (_usageFilter.serverId != null && !servers.some(s => s.id === _usageFilter.serverId)) _usageFilter.serverId = null;
  const models = usageModelOptions(records, _usageFilter.serverId);
  if (_usageFilter.model != null && models.indexOf(_usageFilter.model) < 0) _usageFilter.model = null;
  const fromPill = v => (v === USAGE_ALL ? null : v);
  const toPill = v => (v == null ? USAGE_ALL : v);

  const sel = filterUsageRecords(records, _usageFilter);
  const available = availableUsageScales(usageOldestDay(sel), today);
  const scaleId = resolveUsageScale(_usageScaleChoice, available);

  filtersEl.innerHTML = '';
  const serverPill = cfgPillSelect('usage-filter-server',
    [{ value: USAGE_ALL, label: 'Tous les serveurs' }].concat(servers.map(s =>
      ({ value: s.id, label: s.deleted ? s.name + ' (supprimé)' : s.name }))),
    toPill(_usageFilter.serverId),
    (v) => { _usageFilter = { serverId: fromPill(v), model: null }; renderUsageStats(); });
  const modelPill = cfgPillSelect('usage-filter-model',
    [{ value: USAGE_ALL, label: 'Tous les modèles' }].concat(models.map(m => ({ value: m, label: usageModelLabel(m) }))),
    toPill(_usageFilter.model),
    (v) => { _usageFilter.model = fromPill(v); renderUsageStats(); });
  filtersEl.append(serverPill.root, modelPill.root);
  if (scaleId) {
    const scalePill = cfgPillSelect('usage-filter-scale',
      available.map(id => ({ value: id, label: _usageScale(id).label })),
      scaleId,
      (v) => { _usageScaleChoice = v; renderUsageStats(); });
    filtersEl.appendChild(scalePill.root);
  }

  body.innerHTML = '';
  if (!records.length) {
    body.appendChild(usageNote('Aucune consommation enregistrée pour l’instant. Chaque appel au modèle est compté à partir de maintenant.'));
    return;
  }
  if (!sel.length) {
    body.appendChild(usageNote('Aucune consommation enregistrée pour cette sélection.'));
    return;
  }
  const win = usageScaleWindow(scaleId, today);
  const totals = usageTotals(sel, win);
  const period = document.createElement('div');
  period.className = 'usage-period';
  period.textContent = 'Du ' + formatUsageDay(win.start) + ' au ' + formatUsageDay(win.end) +
    '. Statistiques tenues depuis le ' + formatUsageDay(usageOldestDay(records)) + '.';
  body.appendChild(period);
  if (!totals.rows.length) {
    body.appendChild(usageNote('Aucune consommation sur cette période.'));
    return;
  }
  _usageChartArgs = { sel, win, scaleId, total: totals.total };
  const chart = buildUsageChart(_usageChartArgs, body.clientWidth);
  body.appendChild(chart);
  placeUsageMarkerLabels(chart);
  const serverNames = new Map(servers.map(s => [s.id, s.deleted ? s.name + ' (supprimé)' : s.name]));
  body.appendChild(buildUsageTotalsTable(totals, serverNames));
}

// ── Consultation : graphe (dessin) ──────────────────────────────────────────
// SVG dessiné à la largeur MESURÉE du corps du drawer (le texte des axes ne
// s'étire pas comme le ferait un viewBox), redessiné seul, en place, quand
// cette largeur change — sans reconstruire les pilules, dont un menu ouvert se
// refermerait.
let _usageChartArgs = null;
let _usageChartResizeWired = false;

const USAGE_SVG_NS = 'http://www.w3.org/2000/svg';
const USAGE_CHART = {
  gutter: 46,      // colonne des graduations, à gauche
  padRight: 4,
  titleH: 18,      // bandeau titre + légende au-dessus de chaque panneau
  gapH: 12,        // entre deux panneaux
  axisH: 20,       // libellés de l'axe du temps
  barMax: 24,      // largeur maximale d'une barre
  segGap: 2,       // espace de surface entre deux segments empilés
  radius: 4,       // bout arrondi, côté données
};

function _usageSvg(tag, attrs, parent) {
  const e = document.createElementNS(USAGE_SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// Colonne à bout arrondi en haut, carrée sur la ligne de base.
function _usageBarPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return 'M' + x + ',' + (y + h) + 'V' + (y + rr) + 'Q' + x + ',' + y + ' ' + (x + rr) + ',' + y +
    'H' + (x + w - rr) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + rr) + 'V' + (y + h) + 'Z';
}

function buildUsageChart(args, width) {
  const C = USAGE_CHART;
  const scale = _usageScale(args.scaleId);
  const bins = usageBins(args.win, args.scaleId);
  const binTotals = usageBinTotals(args.sel, bins);
  const markers = calendarMarkers(bins, scale.granularity);

  const wrap = document.createElement('div');
  wrap.className = 'usage-chart';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', usageChartSummary(args.total, args.win, scale.granularity, bins.length));

  const W = Math.max(240, Math.floor(width || 0) || 560);
  const plotW = W - C.gutter - C.padRight;
  const band = plotW / bins.length;
  const barW = Math.max(2, Math.min(C.barMax, band - C.segGap));
  const xOf = i => C.gutter + i * band + (band - barW) / 2;

  // Panneaux : titre, hauteur, segments de bas en haut [classe, valeur] et
  // légende. Un segment n'entre dans la légende que si la période en contient :
  // « cache non renseigné » n'apparaît qu'avec des données qui le sont, « hors
  // cache » et « servie par le cache » disparaissent sous un serveur qui ne
  // renseigne jamais son cache, « non mesurées » n'apparaît qu'avec des appels
  // non mesurés. La sortie, série
  // unique, n'a pas de légende : son titre la nomme.
  const has = f => binTotals.some(b => b[f] > 0);
  const hasUnmeasured = has('unmeasured');
  const panels = [
    { key: 'in', title: 'Entrée', h: 132, ticks: 3,
      legend: [['fresh', 'hors cache', has('freshIn')], ['cached', 'servie par le cache', has('cachedIn')],
        ['unknown', 'cache non renseigné', has('unknownIn')]].filter(e => e[2]),
      segs: b => [['fresh', b.freshIn], ['cached', b.cachedIn], ['unknown', b.unknownIn]] },
    { key: 'out', title: 'Sortie', h: 64, ticks: 3, legend: [],
      segs: b => [['out', b.outTokens]] },
    { key: 'calls', title: 'Requêtes', h: 34, ticks: 1,
      legend: hasUnmeasured ? [['calls', 'mesurées'], ['unmeasured', 'non mesurées']] : [],
      segs: b => [['calls', b.calls - b.unmeasured], ['unmeasured', b.unmeasured]] },
  ];

  const H = panels.reduce((s, p) => s + C.titleH + p.h + C.gapH, 0) - C.gapH + C.axisH;
  const svg = _usageSvg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'usage-chart-svg',
    'aria-hidden': 'true', 'data-plot-left': C.gutter, 'data-plot-width': plotW });
  wrap.appendChild(svg);

  let y = 0;
  const plotBoxes = [];
  for (const p of panels) {
    const head = document.createElement('div');
    head.className = 'usage-chart-head';
    head.style.top = y + 'px';
    head.style.left = C.gutter + 'px';
    const title = document.createElement('span');
    title.className = 'usage-chart-title';
    title.textContent = p.title;
    head.appendChild(title);
    for (const [seg, label] of p.legend) {
      const item = document.createElement('span');
      item.className = 'usage-legend-item';
      const sw = document.createElement('i');
      sw.className = 'usage-swatch usage-seg-' + seg;
      item.append(sw, document.createTextNode(label));
      head.appendChild(item);
    }
    wrap.appendChild(head);
    y += C.titleH;
    const top = y;
    plotBoxes.push([top, p.h]);

    const g = _usageSvg('g', { class: 'usage-panel', 'data-panel': p.key }, svg);
    const max = binTotals.reduce((m, b) => Math.max(m, p.segs(b).reduce((a, s) => a + s[1], 0)), 0);
    const axis = usageChartAxis(max, p.ticks);
    const nTicks = Math.round(axis.max / axis.step);
    for (let k = 0; k <= nTicks; k++) {
      const ty = Math.round(top + p.h - (k * axis.step / axis.max) * p.h) + 0.5;
      _usageSvg('line', { x1: C.gutter, x2: W - C.padRight, y1: ty, y2: ty, class: k === 0 ? 'usage-chart-base' : 'usage-chart-grid' }, g);
      if (k > 0) {
        const tx = _usageSvg('text', { x: C.gutter - 6, y: ty + 3.5, class: 'usage-chart-tick' }, g);
        tx.textContent = formatUsageTick(k * axis.step);
      }
    }
    binTotals.forEach((b, i) => {
      const segs = p.segs(b);
      for (const s of usageStackGeometry(segs.map(e => e[1]), axis.max, p.h, C.segGap)) {
        const x = xOf(i), sy = top + s.y;
        const d = s.top ? _usageBarPath(x, sy, barW, s.h, C.radius)
          : 'M' + x + ',' + sy + 'h' + barW + 'v' + s.h + 'h' + (-barW) + 'Z';
        _usageSvg('path', { d, class: 'usage-seg usage-seg-' + segs[s.index][0], 'data-bin': i }, g);
      }
    });
    y += p.h + C.gapH;
  }
  const plotBottom = y - C.gapH;

  // Repères calendaires. Aux échelles au jour et à la semaine, un filet dans
  // chaque panneau (jamais à travers les titres) ; à l'échelle au mois, chaque
  // bac contient un 1er et un filet par bac ferait une seconde grille : une
  // coche sur l'axe seulement. Libellés posés par priorité, mois avant
  // semaine ; un libellé qui en chevaucherait un autre est omis, et le dernier
  // passe à gauche de son filet s'il sortait du graphe. À l'échelle d'une
  // semaine, chaque bac porte sa date et les repères n'ont pas de libellé.
  const labelBins = args.scaleId === 'week';
  const fullLines = scale.granularity !== 'month';
  const marks = _usageSvg('g', { class: 'usage-chart-marks' }, svg);
  const ordered = markers.slice().sort((a, b) => (a.kind === b.kind ? a.pos - b.pos : a.kind === 'month' ? -1 : 1));
  for (const m of ordered) {
    const x = Math.round(C.gutter + m.pos * plotW) + 0.5;
    const cls = m.kind === 'month' ? 'usage-mark-month' : 'usage-mark-week';
    if (fullLines) {
      for (const [pt, ph] of plotBoxes) _usageSvg('line', { x1: x, x2: x, y1: pt, y2: pt + ph, class: cls }, marks);
    }
    _usageSvg('line', { x1: x, x2: x, y1: plotBottom, y2: plotBottom + 5, class: cls + ' usage-mark-tick', 'data-day': m.day, 'data-kind': m.kind }, marks);
    if (labelBins) continue;
    // Posé dans l'ordre de priorité ; le tri des chevauchements se fait une
    // fois le graphe dans le document (placeUsageMarkerLabels), seul moment où
    // la largeur du texte se mesure.
    const tx = _usageSvg('text', { x: x + 3, y: plotBottom + 15, class: 'usage-mark-label' + (m.kind === 'month' ? ' is-month' : ''),
      'data-day': m.day, 'data-x': x }, marks);
    tx.textContent = usageMarkerLabel(m);
  }
  if (labelBins) {
    bins.forEach((b, i) => {
      const tx = _usageSvg('text', { x: xOf(i) + barW / 2, y: plotBottom + 15, class: 'usage-bin-label' }, svg);
      tx.textContent = usageShortDay(b.start, true);
    });
  }

  // Couche de survol : une colonne HTML par bac, sur toute la hauteur des
  // panneaux — la cible est le bac entier, pas un segment de 3 px. Infobulle
  // MIAOU, texte construit localement. Pas d'arrêt de tabulation : le tableau
  // porte les valeurs, le graphe un nom qui les résume.
  binTotals.forEach((b, i) => {
    const col = document.createElement('div');
    col.className = 'usage-chart-hit';
    col.setAttribute('data-bin', i);
    col.style.left = (C.gutter + i * band) + 'px';
    col.style.width = band + 'px';
    col.style.top = (C.titleH - 2) + 'px';
    col.style.height = (plotBottom - C.titleH + 2) + 'px';
    setTip(col, { label: usageBinTitle(b), detail: usageBinTipDetail(b) });
    wrap.appendChild(col);
  });
  wrap.style.height = H + 'px';

  // Largeur suivie par un ResizeObserver sur le corps du drawer, pas par
  // `resize` : la mesure est prise avant l'ajout du graphe et du tableau, et
  // la barre de défilement verticale qu'ils font apparaître (hors barres en
  // surimpression) rétrécit le corps sans que la fenêtre change.
  if (!_usageChartResizeWired && typeof ResizeObserver === 'function' && $('usage-body')) {
    _usageChartResizeWired = true;
    new ResizeObserver(refreshUsageChart).observe($('usage-body'));
  }
  return wrap;
}

// Libellés des repères, une fois le graphe dans le document (la largeur d'un
// texte SVG ne se mesure pas hors document). Parcourus dans l'ordre où
// buildUsageChart les a posés — mois d'abord : un libellé qui en chevaucherait
// un déjà placé est retiré (« 31 août » s'efface devant « sept. » à un jour
// d'écart) ; celui qui sortirait à droite passe à gauche de son filet.
function placeUsageMarkerLabels(wrap) {
  const svg = wrap && wrap.querySelector('svg');
  if (!svg) return;
  const W = Number(svg.getAttribute('width'));
  const placed = [];
  for (const tx of [...svg.querySelectorAll('.usage-mark-label')]) {
    const x = Number(tx.getAttribute('data-x'));
    const w = tx.getComputedTextLength();
    let x0 = x + 3, x1 = x + 3 + w;
    if (x1 > W) {
      tx.setAttribute('x', x - 3);
      tx.setAttribute('text-anchor', 'end');
      x0 = x - 3 - w; x1 = x - 3;
    }
    if (placed.some(([a, b]) => x0 < b + 6 && x1 > a - 6)) { tx.remove(); continue; }
    placed.push([x0, x1]);
  }
}

// Redessine le graphe seul, à la nouvelle largeur du corps du drawer.
function refreshUsageChart() {
  const drawer = $('usage-drawer');
  const body = $('usage-body');
  if (!_usageChartArgs || !drawer || !drawer.classList.contains('show') || !body) return;
  const old = body.querySelector('.usage-chart');
  if (!old) return;
  const w = body.clientWidth;
  if (Math.abs(w - Number(old.querySelector('svg').getAttribute('width'))) < 1) return;
  const chart = buildUsageChart(_usageChartArgs, w);
  old.replaceWith(chart);
  placeUsageMarkerLabels(chart);
}

function usageNote(text) {
  const el = document.createElement('div');
  el.className = 'usage-empty';
  el.textContent = text;
  return el;
}

function usageModelLabel(model) {
  return model || '(modèle non renseigné)';
}

// Tableau des totaux. Une ligne par couple (serveur, modèle) et une ligne de
// total dès qu'il y en a plusieurs — y compris sous un filtre modèle, quand ce
// modèle est servi par plusieurs serveurs ; une seule ligne sinon (le total la
// répéterait). Le serveur ne s'affiche que sur un nom partagé (`sharedName`),
// sous son nom vivant ou son dernier nom marqué « supprimé » (`serverNames`,
// le même libellé que la pilule). Tout le texte est posé en `textContent` : les
// noms de modèle viennent du backend.
function buildUsageTotalsTable(totals, serverNames) {
  const table = document.createElement('table');
  table.className = 'usage-table';
  const head = document.createElement('tr');
  const cols = [
    ['Modèle', ''],
    ['Requêtes', 'Appels au modèle, tours d’outils compris\u00a0: chaque tour où le modèle appelle des outils est une requête de plus.'],
    ['Entrée', 'Tokens envoyés au modèle, contexte compris.'],
    ['dont cache', 'Part de l’entrée servie depuis le cache du serveur, quand il la déclare.'],
    ['Sortie', 'Tokens produits par le modèle, raisonnement compris quand le serveur le compte.'],
    ['Non mesurés', 'Appels comptés sans compteurs de tokens\u00a0: interrompus avant la fin, ou serveur qui ne les renvoie pas. Leurs tokens manquent aux totaux.'],
  ];
  for (const [label, tip] of cols) {
    const th = document.createElement('th');
    th.textContent = label;
    if (tip) setTip(th, tip);
    head.appendChild(th);
  }
  const thead = document.createElement('thead');
  thead.appendChild(head);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  const rows = totals.rows.map(r => ({
    label: usageModelLabel(r.model),
    server: r.sharedName ? (serverNames.get(r.serverId) || 'Serveur sans nom') : null,
    t: r, total: false,
  }));
  if (totals.rows.length > 1) rows.push({ label: 'Total', server: null, t: totals.total, total: true });
  for (const row of rows) tbody.appendChild(buildUsageTotalsRow(row.label, row.server, row.t, row.total));
  table.appendChild(tbody);
  return table;
}

function buildUsageTotalsRow(label, server, t, isTotal) {
  const tr = document.createElement('tr');
  if (isTotal) tr.className = 'usage-total';
  const cell = (text, cls) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
    return td;
  };
  const name = cell(label, 'usage-model');
  if (server) {
    const sv = document.createElement('span');
    sv.className = 'usage-server';
    sv.textContent = '\u00a0· ' + server;
    name.appendChild(sv);
  }
  // Nombre compact, valeur exacte en infobulle quand il a été compacté.
  const num = (n, cls) => {
    const td = cell(formatUsageCount(n), cls || 'usage-num');
    const exact = usageExactCount(n);
    if (exact) setTip(td, exact);
    return td;
  };
  num(t.calls);
  num(t.inTokens);
  const cached = cell('', 'usage-num');
  const measured = t.calls - t.unmeasured;
  const cachedExact = usageExactCount(t.cachedTokens);
  if (t.cacheState === 'unknown') {
    cached.textContent = 'n/d';
    setTip(cached, 'Aucun appel de cette sélection n’a renvoyé le détail du cache.');
  } else if (t.cacheState === 'partial') {
    cached.textContent = formatUsageCount(t.cachedTokens) + '*';
    setTip(cached, (cachedExact ? cachedExact + '. ' : '') +
      'Cache renseigné par ' + t.cachedKnownCalls + ' appel' + (t.cachedKnownCalls > 1 ? 's' : '') +
      ' sur ' + measured + ' mesuré' + (measured > 1 ? 's' : '') + '\u00a0: ce total est un minimum.');
  } else {
    cached.textContent = formatUsageCount(t.cachedTokens);
    if (cachedExact) setTip(cached, cachedExact);
  }
  num(t.outTokens);
  num(t.unmeasured, 'usage-num' + (t.unmeasured ? '' : ' usage-zero'));
  return tr;
}
