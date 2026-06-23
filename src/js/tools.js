/* ── tools.js ──────────────────────────────────────────────────────────────
   Registre additif d'outils exposés au LLM. Un nouvel outil s'ajoute au
   tableau TOOLS sans toucher à la boucle d'appel (api.js). La description en
   langage naturel injectée dans le prompt système est DÉRIVÉE du registre,
   jamais écrite en dur.
   ────────────────────────────────────────────────────────────────────────── */

// ── File d'attente des propositions de souvenirs ─────────────────────────────
// Les handlers des outils propose_* poussent ici ; onFinal (main.js) consomme.
let _pendingMemoryProposals = [];
function getPendingMemoryProposals() { return _pendingMemoryProposals.slice(); }
function clearPendingMemoryProposals() { _pendingMemoryProposals = []; }

// Entrée « légère » : ce qui est déjà stocké dans l'index miaou-summaries.
function summaryLight(e) {
  return { id: e.id, title: e.title, timestamp: e.timestamp,
           summary: e.summary, keywords: e.keywords };
}

// Doctrine de déclenchement des outils mémoire — émise UNE SEULE FOIS dans le
// system prompt (via toolsSystemPrompt), jamais dans une function.description
// individuelle (qui elle est dupliquée dans le schéma tools à chaque appel API).
const MEMORY_DOCTRINE =
  "Doctrine de déclenchement pour propose_memory / propose_memory_update / propose_memory_delete :\n" +
  "Déclenche l'un de ces outils quand l'utilisateur :\n" +
  "  - donne une instruction durable sur ton comportement (\"dorénavant\", \"désormais\", " +
  "\"à partir de maintenant\", \"appelle-moi X\", \"ne fais plus jamais Y\")\n" +
  "  - communique un fait stable sur lui-même (métier, projet, contrainte personnelle)\n" +
  "  - exprime une préférence de fond sur le format/ton de tes réponses\n" +
  "Ne déclenche PAS pour une instruction valable seulement pour la réponse en cours.\n" +
  "Le contenu proposé (content / new_content) est toujours à la 3e personne, factuel, " +
  "sans interprétation.";

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
        name: 'propose_memory',
        description:
          "Propose d'enregistrer un nouveau souvenir persistant pour l'utilisateur. " +
          "Soumis à validation — ne rien écrire directement. Voir doctrine mémoire.",
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
      if (!args.content || !args.content.trim()) return 'Contenu vide — proposition ignorée.';
      _pendingMemoryProposals.push({ type: 'add', content: args.content.trim() });
      return 'Proposition mise en attente de validation par l\'utilisateur.';
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'propose_memory_update',
        description:
          "Propose de remplacer un souvenir existant par un contenu mis à jour. " +
          "Soumis à validation. Voir doctrine mémoire — spécifique : l'utilisateur " +
          "référence explicitement un souvenir existant et signale un changement d'état.",
        parameters: {
          type: 'object',
          properties: {
            old_id:      { type: 'string', description: 'Identifiant du souvenir à remplacer' },
            new_content: { type: 'string', description: 'Nouveau contenu (3e personne, factuel)' },
          },
          required: ['old_id', 'new_content'],
        },
      },
    },
    handler: (args) => {
      if (!args.old_id || !args.new_content || !args.new_content.trim()) return 'Paramètres invalides.';
      _pendingMemoryProposals.push({ type: 'update', old_id: args.old_id, new_content: args.new_content.trim() });
      return 'Proposition mise en attente de validation par l\'utilisateur.';
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'propose_memory_delete',
        description:
          "Propose de supprimer un souvenir existant. Soumis à validation. " +
          "Voir doctrine mémoire — spécifique : l'utilisateur référence explicitement " +
          "un souvenir existant et en demande le retrait.",
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
      _pendingMemoryProposals.push({ type: 'delete', id: args.id });
      return 'Proposition mise en attente de validation par l\'utilisateur.';
    },
  },
];

function toolDefinitions() { return TOOLS.map(t => t.definition); }

function runTool(name, args) {
  const tool = TOOLS.find(t => t.definition.function.name === name);
  if (!tool) return 'Outil inconnu : ' + name;
  try { return tool.handler(args || {}); }
  catch (e) { return 'Erreur outil ' + name + ' : ' + e.message; }
}

// Description en langage naturel, dérivée du registre — la doctrine mémoire
// n'est ajoutée qu'une fois, en aval de la liste, pas par outil.
function toolsSystemPrompt() {
  if (!TOOLS.length) return '';
  const lines = TOOLS.map(t => `- ${t.definition.function.name} : ${t.definition.function.description}`);
  const hasMemoryTools = TOOLS.some(t => t.definition.function.name.startsWith('propose_memory'));
  const doctrineBlock = hasMemoryTools ? '\n\n' + MEMORY_DOCTRINE : '';
  return "Tu disposes des outils suivants. Appelle-les quand ils peuvent t'aider à mieux répondre, " +
         "sinon réponds directement.\n" + lines.join('\n') + doctrineBlock;
}
