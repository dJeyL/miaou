/* ── api.js ────────────────────────────────────────────────────────────────
   Couche réseau : endpoint OpenAI-compatible. Streaming SSE, appel « en
   cachette » (silentCompletion) pour titrage et résumés, boucle de tool_calls,
   recherche/scoring des résumés.
   ────────────────────────────────────────────────────────────────────────── */

const MAX_TOURS = 4;   // borne sur les tours de la boucle tool_calls

// Controller du stream courant (un seul à la fois). Permet à l'UI d'interrompre
// la génération en cours via abortStream(). Réinitialisé à chaque streamCompletion.
let _currentAbort = null;

// Param(s) mergés dans le body des appels silencieux pour désactiver le raisonnement.
// À modifier ici uniquement si le backend utilise un autre knob (ex. think: false).
const NOTHINK_PARAMS = { reasoning_effort: 'none' };

// Cache session : endpoints ayant rejeté NOTHINK_PARAMS (clé = URL endpoint).
const _noThinkRejected = {};

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

// ── Appel non streamé, résultat exploité en interne (jamais affiché) ────────
async function silentCompletion(messages, opts) {
  const o = opts || {};
  const temperature = o.temperature == null ? 0.3 : o.temperature;
  const cfg = loadSettings();
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

// ── Streaming d'une complétion (un tour) ────────────────────────────────────
// Agrège le content et les tool_calls (strictement par index). Ne renvoie
// qu'à la fin du stream : { content, toolCalls, finishReason }.
async function streamCompletion(messages, opts) {
  const o = opts || {};
  const cfg = loadSettings();
  const body = {
    // Override par conversation (o.model) sinon modèle par défaut des réglages.
    model: o.model || cfg.model,
    messages,
    stream: true,
    temperature: o.temperature == null ? 0.7 : o.temperature,
  };
  if (o.tools && o.tools.length) {
    body.tools = o.tools;
    body.tool_choice = 'auto';
  }

  _currentAbort = new AbortController();
  let contentBuffer = '';
  let reasoningBuffer = '';
  let finishReason = null;
  const toolCalls = [];
  let aborted = false;

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
    if (!res.ok || !res.body) throw new Error('streamCompletion ' + res.status);

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

  return { content: contentBuffer, reasoning: reasoningBuffer, toolCalls: toolCalls.filter(Boolean), finishReason, aborted };
}

// Interrompt le stream en cours (s'il y en a un). Le contenu déjà reçu est
// conservé ; aucune relance de tour côté boucle d'outils.
function abortStream() {
  if (_currentAbort) _currentAbort.abort();
}

// ── Boucle complète d'un échange (injection + tool_calls) ───────────────────
// Hooks : onDelta(full), onReasoning(full), onToolTour(), onToolAcks() [après les
//         outils d'un tour], onFinal(content, reasoning),
//         onHalt(leadIn, question) [outil halting], onError(msg).
// h.model (optionnel) : modèle à utiliser pour cet échange (override conv).
// Le résultat d'un outil n'est JAMAIS affiché : il repart au modèle, on va
// toujours jusqu'à la réponse finale (finish_reason === 'stop').
async function runConversation(messages, hooks) {
  const h = hooks || {};
  // anti-redemande, par échange : clé 'nom:id' ou 'nom:since'
  const servedKeys = new Set();
  // raisonnement accumulé sur tout l'échange (les tours tool_calls peuvent en
  // produire avant l'appel d'outil) ; relayé en live avec ce préfixe.
  let reasoningAcc = '';

  for (let tour = 1; tour <= MAX_TOURS; tour++) {
    const result = await streamCompletion(messages, {
      model: h.model,
      tools: toolDefinitions(),
      onDelta: h.onDelta,
      onReasoning: h.onReasoning ? (full) => h.onReasoning(joinReasoning(reasoningAcc, full)) : undefined,
    });

    // Interruption volontaire : on fige le contenu déjà reçu (pas de rollback)
    // et on NE relance PAS de tour, même au milieu d'une boucle d'outils.
    if (result.aborted) {
      if (h.onFinal) h.onFinal(result.content, joinReasoning(reasoningAcc, result.reasoning));
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
        if (h.onHalt) h.onHalt(result.content, hargs.question || '');
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

      for (const tc of result.toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); }
        catch (e) { args = {}; }

        let out;
        // Clé d'anti-redemande sur les arguments BRUTS du tool_call, pas sur
        // id/since seuls : deux appels distincts du même outil (ex. deux
        // create_memory, ou get_conversation résumé puis with_contents) ont des
        // arguments distincts et doivent tous être servis. Seul un appel
        // rigoureusement identique (modèle qui boucle) est court-circuité.
        const key = tc.function.name + ':' + (tc.function.arguments || '');
        if (servedKeys.has(key)) {
          out = '(déjà fourni plus haut dans cet échange)';
        } else {
          bgActivityStart('mémoire…');
          try {
            out = runTool(tc.function.name, args);
            servedKeys.add(key);
          } finally {
            bgActivityEnd();
          }
        }

        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
      }

      // Les outils de ce tour ont écrit leurs descripteurs d'ack : on laisse l'UI
      // les vidanger MAINTENANT (avant la réponse finale du tour suivant), pour
      // qu'ils s'affichent au-dessus de la réponse et au fil des tours. api.js
      // reste DOM-free : le hook vit dans main.js.
      if (h.onToolAcks) h.onToolAcks();

      continue;   // on relance toujours un appel
    }

    // finish_reason === 'stop' (ou terminal) : la vraie réponse.
    if (h.onFinal) h.onFinal(result.content, joinReasoning(reasoningAcc, result.reasoning));
    return result.content;
  }

  if (h.onError) h.onError("Le modèle n'a pas convergé (trop d'appels d'outils).");
  return '';
}

// ── Titrage automatique ─────────────────────────────────────────────────────
async function generateTitle(thread) {
  const convo = thread
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.role + ': ' + m.content)
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
    .map(m => m.role + ': ' + m.content)
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
function searchSummaries(queryText, excludeId) {
  const tokens = tokenize(queryText);
  if (!tokens.length) return [];
  const all = loadSummaries();
  const matches = [];
  for (const id in all) {
    if (excludeId && id === excludeId) continue;
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
  const cfg = Object.assign({}, loadSettings(), override || {});
  const res = await fetch(cfg.url + '/models', {
    headers: { 'Authorization': 'Bearer ' + (cfg.key || 'no-key') },
  });
  if (!res.ok) throw new Error('models ' + res.status);
  const data = await res.json();
  const list = data.data || data.models || [];
  return list
    .map(m => (typeof m === 'string' ? m : m.id))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}
