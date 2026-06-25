/* ── tools.js ──────────────────────────────────────────────────────────────
   Registre additif d'outils exposés au LLM. Un nouvel outil s'ajoute au
   tableau TOOLS sans toucher à la boucle d'appel (api.js). La description en
   langage naturel injectée dans le prompt système est DÉRIVÉE du registre,
   jamais écrite en dur.
   ────────────────────────────────────────────────────────────────────────── */

// Entrée « légère » : ce qui est déjà stocké dans l'index miaou-summaries.
function summaryLight(e) {
  return { id: e.id, title: e.title, timestamp: e.timestamp,
           summary: e.summary, keywords: e.keywords };
}

// Doctrine de déclenchement des outils mémoire — émise UNE SEULE FOIS dans le
// system prompt (via toolsSystemPrompt), jamais dans une function.description
// individuelle (qui elle est dupliquée dans le schéma tools à chaque appel API).
const MEMORY_DOCTRINE =
  "Doctrine de déclenchement pour les outils mémoire :\n\n" +
  "CHEMIN DIRECT — appelle create_memory immédiatement (sans demander) quand l'utilisateur :\n" +
  "  - donne une instruction durable explicite : \"souviens-toi que\", \"retiens\", \"dorénavant\", " +
  "\"désormais\", \"à partir de maintenant\", \"appelle-moi X\", \"ne fais plus jamais Y\"\n" +
  "  - communique un fait stable sur lui-même (métier, projet, contrainte personnelle)\n" +
  "  - exprime une préférence de fond sur le format ou le ton de tes réponses\n" +
  "Sur le chemin direct : tu PEUX narrer « c'est noté » car l'écriture a déjà eu lieu.\n\n" +
  "CHEMIN INFÉRÉ — appelle ask_confirmation quand tu DÉDUIS (sans demande explicite) " +
  "qu'un fait durable mérite d'être retenu. La question doit contenir LITTÉRALEMENT le " +
  "contenu envisagé : « Tu veux que je retienne : « … » ? ». " +
  "Ne JAMAIS écrire en mémoire sans confirmation préalable sur ce chemin. " +
  "Ne JAMAIS affirmer avoir enregistré quelque chose si tu n'as pas appelé create_memory dans ce même tour.\n\n" +
  "CHEMIN CORRECTION — quand l'utilisateur répond en texte libre à une question ask_confirmation " +
  "(au lieu de cliquer Accepter/Rejeter) et que sa réponse contient une valeur corrigée " +
  "(ex. « non, plutôt un modèle Y »), appelle create_memory avec la valeur corrigée. " +
  "Ne pas se contenter d'acquitter en texte.\n\n" +
  "MISE À JOUR / SUPPRESSION : si un souvenir existant devient obsolète ou inexact, " +
  "appelle update_memory (correction in-place) ou delete_memory (tombstone réversible).\n\n" +
  "Le contenu stocké est toujours à la 3e personne, factuel, sans interprétation.\n" +
  "Ne déclenche PAS pour une instruction valable seulement pour la réponse en cours.";

// File d'attente des acks côté client : chaque handler d'outil (écriture mémoire
// OU lecture d'historique) y pousse un descripteur portant son `kind` ; main.js la
// consomme dans onFinal pour injecter les messages 'tool-ack' dans le thread
// (jamais envoyés au modèle). Les returns model-facing restent inchangés.
let _pendingToolAcks = [];
function getPendingToolAcks() { return _pendingToolAcks.slice(); }
function clearPendingToolAcks() { _pendingToolAcks = []; }

const TOOLS = [
  {
    definition: {
      type: 'function',
      function: {
        name: 'get_conversation',
        description:
          "Récupère une conversation passée par son identifiant. Par défaut " +
          "(with_contents=false), retourne seulement son résumé et ses mots-clés ; " +
          "passer with_contents=true pour obtenir le contenu complet des messages.",
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Identifiant de la conversation' },
            with_contents: { type: 'boolean', description: 'Inclure le contenu complet (défaut false)' },
          },
          required: ['id'],
        },
      },
    },
    handler: (args) => {
      const entry = getSummaryEntry(args.id);   // storage.js
      if (!entry || entry.suppressed) return 'Conversation introuvable ou souvenir supprimé.';
      const light = summaryLight(entry);
      _pendingToolAcks.push({ kind: 'conversation_read', title: light.title });
      if (!args.with_contents) return JSON.stringify(light);
      const conv = loadConversation(args.id);   // storage.js
      if (!conv) return JSON.stringify(light);   // résumé présent mais conversation absente : cas limite
      return JSON.stringify(Object.assign({}, light, { messages: conv.messages ?? conv }));
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'list_conversations',
        description:
          "Liste les conversations passées (résumé + mots-clés par défaut). " +
          "Le paramètre since est OPTIONNEL : l'omettre liste TOUTES les " +
          "conversations — appelle l'outil sans hésiter même sans date en tête ; " +
          "le préciser (date ISO 8601) limite aux conversations actives depuis " +
          "cette date. Passer with_contents=true pour inclure aussi le contenu " +
          "complet de chacune (potentiellement volumineux).",
        parameters: {
          type: 'object',
          properties: {
            since: { type: 'string', description: 'Optionnel — date ISO 8601. Omettre pour tout lister.' },
            with_contents: { type: 'boolean', description: 'Inclure le contenu complet (défaut false)' },
          },
        },
      },
    },
    handler: (args) => {
      let entries = listSummaryEntries();        // storage.js — entrées non-tombstone
      if (args.since != null && args.since !== '') {
        const sinceMs = Date.parse(args.since);
        if (Number.isNaN(sinceMs)) return 'Date "since" invalide (attendu ISO 8601).';
        entries = entries.filter(e => (e.timestamp || 0) >= sinceMs);
      }
      const light = entries.map(summaryLight);
      _pendingToolAcks.push({ kind: 'conversation_list', count: light.length });
      if (!args.with_contents) return JSON.stringify(light);
      return JSON.stringify(light.map(e => {
        const conv = loadConversation(e.id);
        return conv ? Object.assign({}, e, { messages: conv.messages ?? conv }) : e;
      }));
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'create_memory',
        description:
          "Enregistre immédiatement un nouveau souvenir persistant. Utiliser sur le " +
          "CHEMIN DIRECT uniquement (instruction explicite de l'utilisateur). Voir doctrine mémoire.",
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Contenu du souvenir (3e personne, factuel)' },
          },
          required: ['content'],
        },
      },
    },
    handler: (args) => {
      if (!args.content || !args.content.trim()) return 'Contenu vide — souvenir ignoré.';
      const id = genMemoryId();
      const now = Date.now();
      const content = args.content.trim();
      saveMemory({ id, content, created_at: now, updated_at: now, suppressed: false });
      _pendingToolAcks.push({ kind: 'memory_create', id, content });
      return 'Souvenir enregistré. Identifiant : ' + id;
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'update_memory',
        description:
          "Corrige un souvenir existant en place (pas de tombstone). Utiliser quand " +
          "un fait enregistré est devenu inexact ou doit être précisé. Voir doctrine mémoire.",
        parameters: {
          type: 'object',
          properties: {
            id:      { type: 'string', description: 'Identifiant du souvenir à corriger' },
            content: { type: 'string', description: 'Nouveau contenu (3e personne, factuel)' },
          },
          required: ['id', 'content'],
        },
      },
    },
    handler: (args) => {
      if (!args.id || !args.content || !args.content.trim()) return 'Paramètres invalides.';
      const content = args.content.trim();
      const existing = loadMemories().find(e => e.id === args.id);   // avant écrasement
      editMemory(args.id, content);
      _pendingToolAcks.push({
        kind: 'memory_update',
        id: args.id,
        content,
        prevContent: existing ? existing.content : null,
      });
      return 'Souvenir mis à jour.';
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'delete_memory',
        description:
          "Supprime un souvenir (tombstone réversible depuis l'interface). Utiliser " +
          "quand un fait enregistré n'est plus pertinent. Voir doctrine mémoire.",
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Identifiant du souvenir à supprimer' },
          },
          required: ['id'],
        },
      },
    },
    handler: (args) => {
      if (!args.id) return 'Identifiant manquant.';
      const existing = loadMemories().find(e => e.id === args.id);
      suppressMemory(args.id);
      _pendingToolAcks.push({ kind: 'memory_delete', id: args.id, content: existing ? existing.content : null });
      return 'Souvenir supprimé (réversible depuis les paramètres).';
    },
  },
  {
    // Outil HALTING : runConversation (api.js) l'intercepte AVANT le dispatch et
    // arrête l'échange — il ne pousse aucun message tool_calls/tool natif, ne
    // relance pas. La reprise se fait au tour suivant via la réponse de
    // l'utilisateur (« Oui »/« Non » ou correction libre) réécrite en texte clair.
    halting: true,
    definition: {
      type: 'function',
      function: {
        name: 'ask_confirmation',
        description:
          "Demande confirmation à l'utilisateur avant d'agir, lorsque tu as INFÉRÉ " +
          "une intention durable qu'il n'a PAS explicitement demandé d'enregistrer. " +
          "La question doit inclure littéralement le contenu concerné, formulée ainsi : " +
          "« Tu veux que je retienne : « … » ? ». Outil bloquant : la génération " +
          "s'arrête après l'appel et la question est posée à l'utilisateur ; tu " +
          "reprendras au tour suivant selon sa réponse. N'enregistre jamais sans cette " +
          "confirmation, et n'affirme jamais avoir enregistré quoi que ce soit ici.",
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Question fermée à poser, contenu inclus littéralement' },
          },
          required: ['question'],
        },
      },
    },
    handler: (args) => {
      // Jamais appelé dans le flux normal (interception halting en amont) ; présent
      // par cohérence du registre (runTool, toolsSystemPrompt) et comme repli inerte.
      return (args && args.question) ? String(args.question) : '';
    },
  },
];

function toolDefinitions() { return TOOLS.map(t => t.definition); }

// Indique si un outil est « halting » : sa simple présence dans un tour de
// tool_calls suspend l'échange (cf. branche dédiée dans runConversation).
function toolIsHalting(name) {
  const tool = TOOLS.find(t => t.definition.function.name === name);
  return !!(tool && tool.halting);
}

function runTool(name, args) {
  const tool = TOOLS.find(t => t.definition.function.name === name);
  if (!tool) return 'Outil inconnu : ' + name;
  try { return tool.handler(args || {}); }
  catch (e) { return 'Erreur outil ' + name + ' : ' + e.message; }
}

// MEMORY_DOCTRINE n'est PAS redondante avec le schéma tools (qui ne décrit que
// les paramètres, jamais la doctrine de déclenchement). Elle doit donc être
// envoyée indépendamment du toggle includeToolsInSystemPrompt, qui ne contrôle
// que la description redondante schéma/texte des outils eux-mêmes.

function toolsSystemPrompt() {
  if (!TOOLS.length) return '';
  const lines = TOOLS.map(t => `- ${t.definition.function.name} : ${t.definition.function.description}`);
  return "Tu disposes des outils suivants. Appelle-les quand ils peuvent t'aider à mieux répondre, " +
         "sinon réponds directement.\n" + lines.join('\n');
}

function memoryDoctrinePrompt() {
  const hasMemoryTools = TOOLS.some(t => t.definition.function.name === 'create_memory' ||
                                         t.definition.function.name === 'ask_confirmation');
  return hasMemoryTools ? MEMORY_DOCTRINE : '';
}
