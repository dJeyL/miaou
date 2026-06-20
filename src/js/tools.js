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
];

function toolDefinitions() { return TOOLS.map(t => t.definition); }

function runTool(name, args) {
  const tool = TOOLS.find(t => t.definition.function.name === name);
  if (!tool) return 'Outil inconnu : ' + name;
  try { return tool.handler(args || {}); }
  catch (e) { return 'Erreur outil ' + name + ' : ' + e.message; }
}

// Description en langage naturel, dérivée du registre.
function toolsSystemPrompt() {
  if (!TOOLS.length) return '';
  const lines = TOOLS.map(t => `- ${t.definition.function.name} : ${t.definition.function.description}`);
  return "Tu disposes des outils suivants. Appelle-les quand ils peuvent t'aider à mieux répondre, " +
         "sinon réponds directement.\n" + lines.join('\n');
}
