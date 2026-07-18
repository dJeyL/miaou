/* ── api.js ────────────────────────────────────────────────────────────────
   Couche réseau : endpoint OpenAI-compatible. Streaming SSE, appel « en
   cachette » (silentCompletion) pour titrage et résumés, boucle de tool_calls,
   recherche/scoring des résumés.
   ────────────────────────────────────────────────────────────────────────── */

const MAX_TOURS = 40;   // borne sur les tours de la boucle tool_calls
                        // (20 → 40 : js__eval sur un gros fichier peut demander
                        //  plusieurs passes exploratoires avant la synthèse)

// Controller du stream courant (un seul à la fois). Permet à l'UI d'interrompre
// la génération en cours via abortStream(). Réinitialisé à chaque streamCompletion.
let _currentAbort = null;

// Param(s) mergés dans le body des appels silencieux pour désactiver le raisonnement.
// À modifier ici uniquement si le backend utilise un autre knob (ex. think: false).
const NOTHINK_PARAMS = { reasoning_effort: 'none' };

// Cache session : endpoints ayant rejeté NOTHINK_PARAMS (clé = URL endpoint).
const _noThinkRejected = {};

// Extrait un détail lisible du corps d'une réponse HTTP en échec, pour l'afficher
// à l'utilisateur (chemin onError → .msg-error). Défensif : les backends OpenAI-
// compatibles ne s'accordent pas sur la forme. On gère, par ordre de préférence :
//   { message: "…" }                     (forme vue en pratique, ex. vLLM)
//   { error: { message: "…" } }          (forme OpenAI canonique)
//   { error: "…" }                       (error string)
//   [ { error: { message: "…" } } ]      (forme Gemini/Google : body = tableau)
//   texte brut (JSON illisible ou body non-JSON)
// Toujours pur, jamais throw : entrée = texte brut du body, sortie = string
// (préfixée « : » si non-vide, chaîne vide sinon → l'appelant garde « HTTP <code> » seul).
function formatErrorDetail(bodyText) {
  const raw = (bodyText || '').trim();
  if (!raw) return '';
  let msg = raw;
  try {
    let o = JSON.parse(raw);
    // Google/Gemini enveloppe l'erreur dans un tableau ([{ error: {…} }]) : on
    // déballe le premier élément avant d'appliquer les formes objet ci-dessous.
    if (Array.isArray(o)) o = o[0];
    if (o && typeof o === 'object') {
      if (typeof o.message === 'string' && o.message) msg = o.message;
      else if (o.error && typeof o.error === 'object' && typeof o.error.message === 'string') msg = o.error.message;
      else if (typeof o.error === 'string' && o.error) msg = o.error;
    }
  } catch (_) { /* body non-JSON : on garde le texte brut */ }
  return msg ? ' : ' + msg : '';
}

// Lit le corps d'une réponse en échec (une seule fois, tolère l'échec de lecture)
// et le passe à formatErrorDetail. Impur (I/O) ; la logique de forme est dans
// formatErrorDetail (pure, testée).
async function readErrorDetail(res) {
  let bodyText = '';
  try { bodyText = await res.text(); } catch (_) { /* body illisible : « HTTP <code> » seul */ }
  return formatErrorDetail(bodyText);
}

// Cache session : (endpoint, modèle) ayant rejeté reasoning_effort choisi par
// l'utilisateur. Clé composite (url + '::' + model) — un même endpoint peut
// exposer plusieurs modèles aux capacités de raisonnement différentes, donc on
// ne peut pas généraliser le rejet à tout l'endpoint comme pour NOTHINK_PARAMS
// (qui, lui, ne cible jamais qu'un seul modèle fixe : cfg.model).
const _reasoningEffortRejected = {};
function reasoningEffortRejectedKey(url, model) { return url + '::' + (model || ''); }
function isReasoningEffortRejected(url, model) { return !!_reasoningEffortRejected[reasoningEffortRejectedKey(url, model)]; }
function markReasoningEffortRejected(url, model) { _reasoningEffortRejected[reasoningEffortRejectedKey(url, model)] = true; }

// Cache session : (endpoint, modèle) ayant rejeté des content parts image_url
// (D5, brief A lot 2). Même gabarit que _reasoningEffortRejected — clé
// composite endpoint+modèle, PAS juste l'URL (_noThinkRejected) : un même
// endpoint peut exposer un modèle vision-capable et un autre qui ne l'est pas,
// on ne veut pas dégrader tous les modèles d'un endpoint sur le rejet d'un seul.
const _visionRejected = {};
function visionRejectedKey(url, model) { return url + '::' + (model || ''); }
function isVisionRejected(url, model) { return !!_visionRejected[visionRejectedKey(url, model)]; }
function markVisionRejected(url, model) { _visionRejected[visionRejectedKey(url, model)] = true; }

// Un message porte-t-il des content parts image (tableau avec au moins une
// part image_url) ? Détection structurelle, pas de dépendance à un champ
// attachments (streamCompletion ne connaît que `messages`, pas currentThread).
function messagesHaveImageParts(messages) {
  return messages.some(m => Array.isArray(m.content) && m.content.some(p => p && p.type === 'image_url'));
}

// Dégrade un tableau de messages OpenAI pour un rejeu vision-less (D5) :
// chaque message dont `content` est un tableau de parts redevient une string =
// la concaténation des parts texte + les descripteurs byte-stables des images
// jointes (brief A : « send text + descriptor instead » — les parts image sont
// REMPLACÉES par leur descripteur, jamais strippées sans équivalent textuel).
// `descriptors` (tableau de strings, un par image du tour courant) est calculé
// en amont par dispatchSend depuis message.attachments
// (formatAttachmentDescriptor, resources.js — mêmes lignes que la réécriture
// définitive post-tour) et transite par les opts de streamCompletion
// (o.imageDescriptors) via runConversation. Seul le DERNIER message user du
// payload peut porter des parts image (le filet de dispatchSend collapse les
// messages antérieurs), donc les descripteurs s'appliquent sans ambiguïté au
// message dégradé. Contrairement à la réécriture définitive
// (collapseAttachedMessageContent, resources.js), CETTE dégradation est un
// downgrade de PAYLOAD RÉSEAU ponctuel pour le rejeu — currentThread/storage
// ne sont pas touchés ici (c'est dispatchSend/onFinal qui réécrit le message
// persisté une fois le tour terminé). Ajoute une ligne dans le bloc
// <miaou_context> déjà présent en préfixe du dernier message user (piège 16 —
// jamais dans le system message) : signale que les images ont été remplacées
// par des descripteurs ce tour, PAS de strip silencieux.
const VISION_DEGRADED_NOTE =
  "Note : les images jointes n'ont pas pu être envoyées à ce modèle/endpoint " +
  "(non compatible avec les images) — elles ont été remplacées par leur descripteur textuel.";

function degradeVisionMessages(messages, descriptors) {
  const descBlock = (descriptors && descriptors.length) ? descriptors.join('\n') : '';
  return messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const text = m.content.filter(p => p && p.type === 'text').map(p => p.text || '').join('\n\n');
    return Object.assign({}, m, { content: descBlock ? (text + '\n\n' + descBlock) : text });
  });
}

// Insère VISION_DEGRADED_NOTE dans le dernier message user du payload — dans
// le bloc <miaou_context> existant s'il y en a un (juste avant la balise
// fermante, pour rester DANS le bloc dédié au contenu dynamique éphémère,
// piège 16), sinon en préfixe simple. N'écrit jamais dans le system message.
function injectVisionDegradedNote(messages) {
  let lastUserIdx = -1;
  for (let i = 0; i < messages.length; i++) if (messages[i].role === 'user') lastUserIdx = i;
  if (lastUserIdx < 0) return messages;
  const m = messages[lastUserIdx];
  const content = typeof m.content === 'string' ? m.content : '';
  const marker = '</miaou_context>';
  const idx = content.indexOf(marker);
  const newContent = idx >= 0
    ? content.slice(0, idx) + VISION_DEGRADED_NOTE + '\n' + content.slice(idx)
    : VISION_DEGRADED_NOTE + '\n\n' + content;
  const out = messages.slice();
  out[lastUserIdx] = Object.assign({}, m, { content: newContent });
  return out;
}

const TITLE_PROMPT =
  "Génère un titre court (3 à 6 mots) résumant le sujet principal de la " +
  "conversation. Pas de ponctuation finale, pas de guillemets, pas de préfixe. " +
  "Réponds uniquement par le titre.";

const SUMMARY_PROMPT =
`Tu es un module de résumé. On te fournit une conversation entre un utilisateur
et un assistant. Produis un résumé compact, exploitable pour retrouver cette
conversation plus tard.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, sans balises
Markdown, sans commentaire :
{
  "summary": "5 à 10 lignes : sujet, décisions, conclusions",
  "keywords": ["terme1", "terme2"]
}

keywords : 5 à 12 termes saillants (sujets techniques, noms propres,
technologies, concepts), en minuscules, sans doublons.`;

// Prompt dédié à la description de fichier de bibliothèque (D7, lot Cbis) —
// DISTINCT de SUMMARY_PROMPT (qui vise une conversation, format JSON
// summary+keywords) : ici une sortie texte libre, cap strict, aucune donnée
// volatile (la description atterrit dans le manifeste <miaou_context>,
// byte-stable tant qu'elle ne change pas — une formulation relative à
// « aujourd'hui » romprait cette invariance à chaque relecture). PAS un
// résumé du contenu : décrit ce que le fichier EST (nature, sujets, structure)
// pour que le modèle juge s'il doit l'ouvrir, pas ce qu'il contient en détail.
// Constante, non éditable en v1 (décision D7).
const FILE_DESCRIPTION_PROMPT =
  "Tu es un module de description de document. On te fournit le contenu (ou " +
  "un extrait) d'un fichier. Décris en au plus DEUX phrases factuelles ce " +
  "qu'on y trouve — nature du contenu, sujets/entités couverts, structure " +
  "notable (ex. tableau de prix, journal d'événements, spécification " +
  "technique, liste de contacts) — de façon à ce qu'un lecteur qui n'a PAS " +
  "encore ouvert le fichier puisse juger s'il doit le lire pour répondre à " +
  "un besoin donné. Ce n'est PAS un résumé du contenu (n'essaie pas de " +
  "condenser l'information elle-même, ex. les valeurs d'un tableau ou la " +
  "conclusion d'un rapport) : c'est une description de ce que le fichier EST, " +
  "à des fins d'indexation. N'utilise AUCUNE expression de temps relatif " +
  "(« aujourd'hui », « récemment », « ce mois-ci ») : la description doit " +
  "rester valable indéfiniment. Réponds UNIQUEMENT par la description, sans " +
  "préambule, sans guillemets, sans balises Markdown.";

// ── Appel non streamé, résultat exploité en interne (jamais affiché) ────────
async function silentCompletion(messages, opts) {
  const o = opts || {};
  const temperature = o.temperature == null ? 0.3 : o.temperature;
  const cfg = Object.assign({}, loadSettings(), activeApiConfig());
  const url = cfg.url;

  // Garde-fou : un endpoint qui accepte la connexion puis se tait laisserait le
  // fetch pendre indéfiniment, et avec lui l'indicateur d'activité (le finally de
  // runBackgroundTask ne passerait jamais). Contrôleur LOCAL, indépendant de
  // _currentAbort (le stream foreground) : abortStream() n'y touche pas, et
  // inversement. L'AbortError remonte → runBackgroundTask le capte → null.
  const _attempt = async (extra) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 30000);
    try {
      const res = await fetch(url + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (cfg.key || 'no-key'),
        },
        body: JSON.stringify({ model: cfg.model, messages, stream: false, temperature, ...extra }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('silentCompletion ' + res.status);
      const data = await res.json();
      return (data.choices?.[0]?.message?.content ?? '').trim();
    } finally {
      clearTimeout(timer);
    }
  };

  if (!_noThinkRejected[url]) {
    try {
      return await _attempt(NOTHINK_PARAMS);
    } catch (_) {
      // Assumé : ce catch marque l'endpoint rejetant même sur un timeout/panne
      // réseau transitoire (pas seulement un vrai rejet du param), perdant le
      // no-think pour la session par excès de prudence. Dégradation douce
      // (retry direct juste après, se réactive sur les appels suivants) —
      // pas affiné tant qu'aucun cas réel n'a montré le besoin.
      _noThinkRejected[url] = true;
    }
    return await _attempt({});
  }
  return await _attempt({});
}

// ── Parsing SSE ─────────────────────────────────────────────────────────────
// sseDataObject : ligne -> objet chunk parsé (ou null pour vide / [DONE] / KO).
function sseDataObject(line) {
  if (!line) return null;
  const s = line.trim();
  if (!s.startsWith('data:')) return null;
  const payload = s.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try { return JSON.parse(payload); }
  catch (e) { return null; }
}

// parseSSELine : extrait le delta de contenu d'une ligne (ou null). Utilisé
// par les tests ; la boucle de streaming réelle passe par sseDataObject pour
// accéder aussi aux tool_calls et au finish_reason.
function parseSSELine(line) {
  const data = sseDataObject(line);
  return data?.choices?.[0]?.delta?.content ?? null;
}

// reasoningDelta : extrait le fragment de raisonnement d'un delta, ou null si le
// champ est totalement absent. Plusieurs couches OpenAI-compatibles le nomment
// différemment — `reasoning` (le plus répandu), `reasoning_content` (style
// DeepSeek/vLLM), `thinking` (relais de l'API native Ollama). Une chaîne VIDE
// est une *présence* (le modèle est thinking-capable) : on la renvoie telle
// quelle ; seul un champ entièrement absent donne null. Détection par
// observation directe, jamais via `reasoning_effort` (comportement erratique).
function reasoningDelta(delta) {
  if (!delta) return null;
  const v = delta.reasoning ?? delta.reasoning_content ?? delta.thinking;
  return typeof v === 'string' ? v : null;
}

// Concatène deux segments de raisonnement (entre tours d'un même échange) en
// préservant une séparation lisible, sans introduire de blancs parasites.
function joinReasoning(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a + '\n\n' + b;
}

// ── Température du chat : override console ──────────────────────────────────
// Instrument de mesure, pas un réglage : aucune surface UI, non persisté, non
// broadcasté aux autres onglets. Un reload le perd et la valeur du build
// (BUILD_CHAT_TEMPERATURE) reprend — on ne peut pas laisser une session sur une
// valeur d'essai sans le savoir. Ne concerne que streamCompletion : les appels
// silencieux (titrage, résumé, description de fichier) portent leur température
// explicite au site d'appel et n'ont rien à voir avec ces mesures.
let _chatTempOverride = null;

function setChatTemperature(t) {
  if (t == null) {
    _chatTempOverride = null;
    console.log('[miaou] température chat : défaut build (' + BUILD_CHAT_TEMPERATURE + ')');
    return;
  }
  // !(t >= 0 && t <= 2) plutôt que t < 0 || t > 2 : rejette aussi NaN.
  if (typeof t !== 'number' || !(t >= 0 && t <= 2)) {
    console.warn('[miaou] température invalide, ignorée :', t);
    return;
  }
  _chatTempOverride = t;
  console.log('[miaou] température chat : ' + t + ' (prochains envois)');
}

function activeChatTemperature() {
  return _chatTempOverride == null ? BUILD_CHAT_TEMPERATURE : _chatTempOverride;
}

// ── Streaming d'une complétion (un tour) ────────────────────────────────────
// Agrège le content et les tool_calls (strictement par index). Ne renvoie
// qu'à la fin du stream : { content, toolCalls, finishReason }.
async function streamCompletion(messages, opts) {
  const o = opts || {};
  const cfg = Object.assign({}, loadSettings(), activeApiConfig());
  const model = o.model || cfg.model;
  const body = {
    // Override par conversation (o.model) sinon modèle par défaut des réglages.
    model,
    messages,
    stream: true,
    temperature: o.temperature == null ? activeChatTemperature() : o.temperature,
    stream_options: { include_usage: true },
  };
  if (o.tools && o.tools.length) {
    body.tools = o.tools;
    body.tool_choice = 'auto';
  }
  // reasoning_effort : choix explicite de l'utilisateur (composer), '' = défaut =
  // aucun paramètre envoyé. Jamais posé si l'endpoint+modèle l'a déjà rejeté cette
  // session (cf. isReasoningEffortRejected) — le sélecteur est alors masqué côté UI.
  if (o.reasoningEffort && !isReasoningEffortRejected(cfg.url, model)) {
    body.reasoning_effort = o.reasoningEffort;
  }

  // Dégradation vision-less PROACTIVE (avant tout appel réseau) : remplace les
  // parts image par leur descripteur textuel (o.imageDescriptors, fournis par
  // dispatchSend) + note dans <miaou_context> (jamais le system message, piège
  // 16). Deux déclencheurs :
  //  - D5 lot A (réactif) : (endpoint, modèle) déjà connu non-vision CETTE
  //    session (rejet 400 essuyé sur un tour antérieur, isVisionRejected) — pour
  //    ne pas reproduire le même rejet à chaque tour ;
  //  - D5 brief A2 (manuel) : l'utilisateur a marqué ce modèle « sans vision »
  //    sur le serveur actif (o.visionDisabled, calculé par dispatchSend depuis
  //    serverModelVisionEnabled). Nécessaire car Ollama ne renvoie AUCUN 400
  //    sur un modèle sans projecteur vision (F1) : le chemin réactif ne peut pas
  //    l'attraper, seul le réglage manuel le déclenche.
  if (messagesHaveImageParts(body.messages) && (isVisionRejected(cfg.url, model) || o.visionDisabled)) {
    body.messages = injectVisionDegradedNote(degradeVisionMessages(body.messages, o.imageDescriptors));
  }

  _currentAbort = new AbortController();
  let contentBuffer = '';
  let reasoningBuffer = '';
  let finishReason = null;
  const toolCalls = [];
  let aborted = false;
  let usage = null;

  try {
    const res = await fetch(cfg.url + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (cfg.key || 'no-key'),
      },
      body: JSON.stringify(body),
      signal: _currentAbort.signal,
    });
    if (!res.ok || !res.body) {
      // Hypothèse directe (pas de retry de diagnostic) : si reasoning_effort était
      // posé, on le tient pour responsable de l'échec — marqué pour (endpoint,
      // modèle), le sélecteur se masque pour la suite de la session, et on rejoue
      // LA MÊME requête une fois sans le paramètre (vLLM & co. rejettent en 400
      // les paramètres inconnus : l'utilisateur ne doit pas voir une erreur pour
      // ça). Le flag posé garantit que l'appel récursif n'en fait pas un autre.
      if (body.reasoning_effort) {
        markReasoningEffortRejected(cfg.url, model);
        return streamCompletion(messages, opts);
      }
      // D5 : rejet probable des content parts image (400 avec image_url dans
      // le payload, pas encore flaggé pour ce (endpoint, modèle) — sinon on
      // serait déjà passé par la dégradation proactive ci-dessus). Un SEUL
      // rejeu : le flag posé AVANT l'appel récursif garantit que celui-ci
      // prend la branche proactive plutôt que de re-tenter avec images et
      // reboucler indéfiniment sur un 400 persistant pour une autre raison.
      if (messagesHaveImageParts(body.messages) && !isVisionRejected(cfg.url, model)) {
        markVisionRejected(cfg.url, model);
        return streamCompletion(messages, opts);
      }
      throw new Error('HTTP ' + res.status + await readErrorDetail(res));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);

        const chunk = sseDataObject(line);
        if (!chunk) continue;
        // Chunk terminal stream_options.include_usage : choices=[], capté AVANT
        // le filtrage sur choix vide (piège 4 adapté) — pas de delta à agréger.
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};

        // Le raisonnement précède le contenu (et peut précéder un tool_call) :
        // on l'agrège à part et on le signale en live, sans jamais l'afficher
        // comme du contenu de réponse.
        const rd = reasoningDelta(delta);
        if (rd !== null) {
          reasoningBuffer += rd;
          if (o.onReasoning) o.onReasoning(reasoningBuffer);
        }

        if (delta.content) {
          contentBuffer += delta.content;
          if (o.onDelta) o.onDelta(contentBuffer);
        }

        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const i = tcDelta.index;
            toolCalls[i] = toolCalls[i] || { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tcDelta.id)                  toolCalls[i].id = tcDelta.id;
            if (tcDelta.function?.name)      toolCalls[i].function.name = tcDelta.function.name;
            if (tcDelta.function?.arguments) toolCalls[i].function.arguments += tcDelta.function.arguments;
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }
  } catch (e) {
    // AbortError : interruption volontaire (abortStream). On garde le contenu
    // déjà reçu et on le signale via `aborted` ; pas une erreur réseau.
    if (e && e.name === 'AbortError') aborted = true;
    else throw e;
  } finally {
    _currentAbort = null;
  }

  return { content: contentBuffer, reasoning: reasoningBuffer, toolCalls: toolCalls.filter(Boolean), finishReason, aborted, usage };
}

// Interrompt le stream en cours (s'il y en a un). Le contenu déjà reçu est
// conservé ; aucune relance de tour côté boucle d'outils.
function abortStream() {
  if (_currentAbort) _currentAbort.abort();
}

// ── Boucle complète d'un échange (injection + tool_calls) ───────────────────
// Hooks : onDelta(full), onReasoning(full), onToolTour(), onToolAcks({usage}) [après
//         les outils d'un tour], onFinal(content, reasoning, finishReason, {usage}),
//         onHalt(leadIn, question, {usage}) [outil halting], onError(msg).
// {usage} : usage API du DERNIER tour reçu (Bbis) — jamais sommé sur l'échange,
// tolère null (backend sans stream_options.include_usage).
// h.model (optionnel) : modèle à utiliser pour cet échange (override conv).
// h.noTools (optionnel) : omet `tools` de streamCompletion — utilisé par la
// continuation d'une réponse tronquée (feature C, dispatchSend/main.js) : on ne
// veut pas qu'un tool_call s'immisce dans un simple raccord de texte coupé.
// Le résultat d'un outil n'est JAMAIS affiché : il repart au modèle, on va
// toujours jusqu'à la réponse finale (finish_reason === 'stop').
async function runConversation(messages, hooks) {
  const h = hooks || {};
  // anti-redemande, par échange : clé nom + ':' + arguments bruts (voir plus
  // bas, pas 'nom:id'/'nom:since' — deux appels distincts doivent tous être servis)
  const servedKeys = new Set();
  // Filet : purge toute injection image résiduelle (brief A2/D3) d'un échange
  // précédent avorté avant le drain (le handler push et la boucle draine dans la
  // même itération synchrone, mais on ne laisse rien traîner entre échanges).
  if (typeof clearPendingImageInjections === 'function') clearPendingImageInjections();
  // raisonnement accumulé sur tout l'échange (les tours tool_calls peuvent en
  // produire avant l'appel d'outil) ; relayé en live avec ce préfixe.
  let reasoningAcc = '';

  for (let tour = 1; tour <= MAX_TOURS; tour++) {
    const result = await streamCompletion(messages, {
      model: h.model,
      reasoningEffort: h.reasoningEffort,
      // Descripteurs byte-stables des images du tour courant (D5) : utilisés
      // uniquement si la dégradation vision-less doit remplacer les parts image.
      imageDescriptors: h.imageDescriptors,
      // Flag vision manuel (D5, brief A2) : ce modèle est marqué « sans vision »
      // sur le serveur actif → dégradation proactive même sans 400.
      visionDisabled: h.visionDisabled,
      tools: h.noTools ? undefined : toolDefinitions(),
      onDelta: h.onDelta,
      onReasoning: h.onReasoning ? (full) => h.onReasoning(joinReasoning(reasoningAcc, full)) : undefined,
    });

    // Interruption volontaire : on fige le contenu déjà reçu (pas de rollback)
    // et on NE relance PAS de tour, même au milieu d'une boucle d'outils
    // (piège n°10). Sentinel 'aborted' (≠ null, réservé au cas « backend sans
    // finish_reason ») : main.js pose `truncated` dessus si du contenu a été
    // reçu, pour offrir « Continuer » sur une réponse stoppée à la main.
    if (result.aborted) {
      if (h.onFinal) h.onFinal(result.content, joinReasoning(reasoningAcc, result.reasoning), 'aborted', { usage: result.usage });
      return result.content;
    }

    if (result.finishReason === 'tool_calls') {
      // Flush complet du raisonnement de ce tour AVANT d'exécuter l'outil
      // (pas de traitement en parallèle) ; il reste affiché pendant l'appel.
      reasoningAcc = joinReasoning(reasoningAcc, result.reasoning);

      // Outil HALTING (ex. ask_confirmation) : s'il figure dans ce tour, on
      // suspend l'échange immédiatement — aucun message assistant tool_calls
      // poussé, aucun message tool, aucune relance. onHalt reçoit le lead-in
      // (texte du tour) et la question ; il se charge de la reprise « fork B »
      // (réécriture en message texte clair, cf. main.js). Les éventuels autres
      // tool_calls du même tour sont volontairement ignorés.
      const halting = result.toolCalls.find(tc => toolIsHalting(tc.function.name));
      if (halting) {
        let hargs = {};
        try { hargs = JSON.parse(halting.function.arguments || '{}'); }
        catch (e) { hargs = {}; }
        if (h.onHalt) h.onHalt(result.content, hargs.question || '', { usage: result.usage });
        return result.content;
      }

      // Passe le content du tour à l'UI : s'il est non vide, l'UI le finalise
      // dans sa propre bulle ; sinon elle efface le live et repose le patienteur.
      if (h.onToolTour) h.onToolTour(result.content);

      messages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls,
      });

      // Identifiant de groupe : partagé par tous les tool_calls d'un même tour
      // pour que expandThread puisse reconstruire un seul assistant+N tools.
      const group = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const assistantText = result.content || null;

      for (const tc of result.toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); }
        catch (e) { args = {}; }

        let out;
        // Clé d'anti-redemande sur les arguments BRUTS du tool_call, pas sur
        // id/since seuls : deux appels distincts du même outil (ex. deux
        // memory__create, ou conv__get résumé puis with_contents) ont des
        // arguments distincts et doivent tous être servis. Seul un appel
        // rigoureusement identique (modèle qui boucle) est court-circuité.
        const key = tc.function.name + ':' + (tc.function.arguments || '');
        if (servedKeys.has(key)) {
          out = '(déjà fourni plus haut dans cet échange)';
          // Trace UI du court-circuit : sans elle, l'appel ne laissait AUCUN
          // ack dans le fil (aucun handler n'a tourné). Ack tool_failed rouge
          // + enrichissement standard (args/result/ts/group) pour la fidélité
          // reload/export. isMcp: false — l'ack est poussé dans
          // _pendingToolAcks quel que soit l'outil visé, jamais dans le
          // chemin earlyRendered. Garde typeof : le test runner évalue api.js
          // sans tools.js (cf. internResourcesFromResult plus bas).
          if (typeof pushDuplicateCallAck === 'function') {
            pushDuplicateCallAck(tc.function.name, out);
            if (h.onEnrichLastAck) h.onEnrichLastAck({
              isMcp: false,
              name: tc.function.name,
              args,
              result: out,
              ts: Date.now(),
              group,
              assistantText,
            });
          }
        } else {
          bgActivityStart('outil…');
          try {
            // Pour les outils distants, callRemoteTool pousse l'ack dans
            // _pendingToolAcks de manière synchrone (avant son premier await).
            // On démarre l'appel, on vide immédiatement les acks en attente
            // (onEarlyAcks), puis on attend la réponse : l'ack s'affiche PENDANT
            // le round-trip réseau, pas seulement après.
            const toolPromise = callTool(tc.function.name, args);
            // isMcp = appel d'un serveur MCP DISTANT — déterminé par le préfixe du
            // nom (serveur ≠ 'miaou'/''), pas par le type de retour : un outil
            // interne ASYNC (ex. miaou__skills__read) renvoie aussi une Promise mais
            // n'est pas distant. Le distinguer par le nom évite de router son ack
            // dans le chemin MCP (onEarlyAcks/earlyRendered).
            const isMcp = (function () {
              const p = parseToolName(tc.function.name).serverPrefix;
              return p !== '' && p !== 'miaou';
            })();
            if (h.onEarlyAcks && isMcp) h.onEarlyAcks();
            const rawResult = await toolPromise;
            // Interception ressources : stocke les blocs non-textuels dans IDB,
            // réécrit rawResult.content avec des références. currentConvId est
            // accessible en runtime (global déclaré dans main.js, même scope build).
            if (typeof internResourcesFromResult === 'function') {
              await internResourcesFromResult(rawResult,
                typeof currentConvId !== 'undefined' ? currentConvId : null,
                Date.now, Math.random);
            }
            out = flattenToolResult(rawResult);
            servedKeys.add(key);
            // Enrichit l'ack de ce tool_call avec les champs nécessaires à la
            // réinjection cross-turn (args, result aplati, ts, group). Pour les
            // outils distants l'ack est déjà dans earlyRendered ; pour les
            // outils internes il est encore dans _pendingToolAcks.
            if (h.onEnrichLastAck) h.onEnrichLastAck({
              isMcp,
              name: tc.function.name,
              args,
              result: out,
              ts: Date.now(),
              group,
              assistantText,
            });
          } finally {
            bgActivityEnd();
          }
        }

        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
      }

      // Brief A2 / D3 — ré-injection image intra-échange. Un recall_attachment
      // sur une image a empilé { dataUrl, attId } dans _pendingImageInjections
      // (tools.js) ; on pousse pour chacune un message user SYNTHÉTIQUE porteur
      // de la part image, APRÈS tous les tool results du tour, pour que la
      // relance ci-dessous (continue) le fasse voir au modèle. Sans ça, le
      // modèle ne verrait que le tool result textuel « son contenu suit » et
      // confabulerait. Même forme de content parts que expandThread (envois
      // ultérieurs) — un seul contrat de message image. Accès défensif : le
      // registre n'existe pas dans le test runner qui évalue api.js seul.
      if (typeof getPendingImageInjections === 'function') {
        const injections = getPendingImageInjections();
        clearPendingImageInjections();
        for (const inj of injections) {
          messages.push({ role: 'user', content: [
            { type: 'text', text: '[Contenu de la pièce jointe ' + (inj.attId || '') + ' ré-injecté :]' },
            { type: 'image_url', image_url: { url: inj.dataUrl } },
          ] });
        }
      }

      // Les outils de ce tour ont écrit leurs descripteurs d'ack : on laisse l'UI
      // les vidanger MAINTENANT (avant la réponse finale du tour suivant), pour
      // qu'ils s'affichent au-dessus de la réponse et au fil des tours. api.js
      // reste DOM-free : le hook vit dans main.js.
      if (h.onToolAcks) h.onToolAcks({ usage: result.usage });

      // Interjections utilisateur (lot Q) — drain B, à la frontière de tour :
      // les messages tapés PENDANT la génération sont résolus côté main.js
      // (resolveSend, contenu de skill COURANT) et poussés ici, APRÈS les tool
      // results et les ré-injections image, AVANT la relance — le modèle les
      // voit avant son prochain geste d'outil (réaiguillage mid-boucle).
      // api.js reste libre de toute résolution/DOM : le hook renvoie des
      // messages OpenAI prêts à l'emploi (null si la file est vide). Coût KV
      // assumé : insertion volontaire, déclenchée par l'utilisateur — même
      // nature que la ré-injection image ci-dessus (corollaire du piège 16).
      if (h.onInterjections) {
        const extra = await h.onInterjections();
        if (extra && extra.length) {
          for (const em of extra) messages.push(em);
        }
      }

      continue;   // on relance toujours un appel
    }

    // finish_reason === 'stop' (ou terminal, ex. 'length') : la vraie réponse.
    // finishReason est propagé tel quel à onFinal, qui décide (main.js) s'il
    // pose le flag truncated sur le message persisté.
    if (h.onFinal) h.onFinal(result.content, joinReasoning(reasoningAcc, result.reasoning), result.finishReason, { usage: result.usage });
    return result.content;
  }

  if (h.onError) h.onError("Le modèle n'a pas convergé (trop d'appels d'outils).");
  return '';
}

// ── Titrage automatique ─────────────────────────────────────────────────────
async function generateTitle(thread) {
  const convo = thread
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.role + ': ' + messageTextForSummary(m))
    .join('\n\n');
  const out = await silentCompletion([
    { role: 'system', content: TITLE_PROMPT },
    { role: 'user', content: convo },
  ], { temperature: 0.2, timeout: 60000 });
  return out.replace(/^["'«»\s]+|["'«».\s]+$/g, '').trim().slice(0, 60);
}

// ── Génération d'un résumé ──────────────────────────────────────────────────
async function generateSummary(thread) {
  const convo = thread
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.role + ': ' + messageTextForSummary(m))
    .join('\n\n');
  const out = await silentCompletion([
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: convo },
  ], { temperature: 0.3, timeout: 60000 });

  const parsed = parseSummaryJSON(out);
  if (!parsed || typeof parsed.summary !== 'string') {
    if (typeof console !== 'undefined') console.warn('[miaou] résumé non parsable :', (out || '').slice(0, 200));
    return null;   // abandon silencieux côté UI
  }
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map(k => String(k).toLowerCase()).filter(Boolean)
    : [];
  return { summary: parsed.summary, keywords };
}

// ── Recherche / sélection des résumés pertinents ────────────────────────────
// `spaceId` optionnel (brief D2) : si fourni, exclut aussi les résumés dont la
// conversation n'appartient pas à ce Space (les résumés ne portent pas de
// spaceId propre — jointure via spaceConvIds/loadConversations, storage.js).
function searchSummaries(queryText, excludeId, spaceId) {
  const tokens = tokenize(queryText);
  if (!tokens.length) return [];
  const all = loadSummaries();
  const idsInSpace = spaceId != null ? spaceConvIds(spaceId, loadConversations()) : null;
  const matches = [];
  for (const id in all) {
    if (excludeId && id === excludeId) continue;
    if (idsInSpace && !idsInSpace.has(id)) continue;
    const e = all[id];
    if (!e || e.suppressed || !e.summary) continue;
    const score = scoreSummary(tokens, e);
    if (score >= 2) matches.push(Object.assign({ score }, e));
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, MAX_SUMMARIES);
}

// ── Liste des modèles exposés par l'API ─────────────────────────────────────
async function fetchModels(override) {
  const cfg = Object.assign({}, loadSettings(), activeApiConfig(), override || {});
  // Timeout borné (même motif que streamCompletion) : un endpoint qui pend ne
  // doit pas laisser le chargement de modèles en attente indéfinie.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(cfg.url + '/models', {
      headers: { 'Authorization': 'Bearer ' + (cfg.key || 'no-key') },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('models ' + res.status);
  const data = await res.json();
  const list = data.data || data.models || [];
  return list
    .map(m => (typeof m === 'string' ? m : m.id))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}
