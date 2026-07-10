/* ── tools.js ──────────────────────────────────────────────────────────────
   Registre interne d'outils en forme MCP : { name, description, inputSchema,
   annotations, handler }. La conversion vers le format OpenAI envoyé au modèle
   est produite à l'envoi par toolDefinitions() — un seul sens de traduction.
   ask_confirmation est un primitif halting hors registre MCP (voir ci-dessous).
   ────────────────────────────────────────────────────────────────────────── */

// Entrée « légère » : ce qui est déjà stocké dans l'index miaou-summaries.
function summaryLight(e) {
  return { id: e.id, title: e.title, timestamp: e.timestamp,
           summary: e.summary, keywords: e.keywords };
}

// Doctrine comportementale : ressources binaires. Toujours injectée quand des outils
// existent — indépendamment de includeToolsInSystemPrompt (qui ne gouverne que
// l'énumération textuelle). Partie de ROOT_SYSTEM_PROMPT.
const BINARY_DOCTRINE =
  "Quand un outil renvoie des données binaires (image, fichier, base64…), l'application " +
  "les enregistre sous forme de ressource et t'en communique l'ID. Les images sont " +
  "affichées directement dans l'interface : tu peux les introduire par UNE phrase courte au plus " +
  "(« Voici l'image demandée. »), mais ne reproduis jamais, n'encode pas, ne simule pas " +
  "et ne décris pas le contenu binaire — pas de base64, pas d'image Markdown, pas de " +
  "placeholder inventé. N'appelle pas present_resource pour une image sans demande explicite : " +
  "l'application l'a déjà présentée à l'utilisateur.";

// Doctrine comportementale : pièces jointes de message (brief A, D4 ; corrigée
// brief A2 / D3-D4). Toujours injectée quand des outils existent — même statut
// que BINARY_DOCTRINE, mais distincte : BINARY_DOCTRINE couvre les ressources
// PRODUITES par un outil, celle-ci couvre les fichiers ATTACHÉS par l'utilisateur
// à un message (descripteurs [attachment att-N: ...] visibles dans le fil après
// le tour d'attache, cf. piège n°17 CLAUDE.md). Distinctions VÉRIFIÉES contre
// l'implémentation, ne pas les « simplifier » : un fichier TEXTE garde son
// contenu inline à jamais (D3, pas de rewrite) — le rappeler serait redondant ;
// une IMAGE rappelée est RÉ-INJECTÉE dans le contexte (probe A2 : message user
// synthétique porteur de la part image, inséré après le tool result — tu la
// revois réellement) et aussi ré-affichée à l'utilisateur. Partie de
// ROOT_SYSTEM_PROMPT.
const ATTACHMENT_DOCTRINE =
  "Les fichiers joints par l'utilisateur apparaissent dans ses messages sous forme de " +
  "descripteurs [attachment att-N: ...]. Un fichier TEXTE joint garde son contenu " +
  "inline dans le message (bloc de code sous son descripteur) : ne rappelle jamais un " +
  "fichier dont le contenu est déjà visible dans la conversation. Une IMAGE jointe " +
  "n'est visible par toi qu'au tour où elle a été attachée ; ensuite seul son " +
  "descripteur reste. Une image que tu VOIS déjà dans le message courant (elle t'est " +
  "fournie directement au tour où l'utilisateur l'attache) ne doit JAMAIS être rappelée : " +
  "réponds directement à partir de ce que tu vois, n'appelle pas l'outil par précaution. " +
  "Ce n'est qu'aux tours SUIVANTS, quand seul le descripteur subsiste et que tu dois de " +
  "nouveau examiner l'image, que tu appelles miaou__recall_attachment(ref=\"att-N\") : son " +
  "contenu t'est alors ré-injecté juste après le résultat de l'outil et tu peux l'analyser " +
  "normalement. Ne décris jamais une image de mémoire sans l'avoir rappelée. Pour un " +
  "fichier binaire, le contenu n'est pas lisible directement, sauf si un outil " +
  "d'extraction est disponible (cf. ci-dessous).";

// Doctrine d'accès Web. Toujours injectée quand des outils Web sont disponibles.
// Partie de ROOT_SYSTEM_PROMPT.
const WEB_DOCTRINE =
  "<ACCES_WEB>\n" +
  "Si des outils te sont fournis pour interroger des moteurs de recherche et/ou " +
  "récupérer des ressources sur le Web :\n" +
  "- utilise-les si c'est pertinent, plutôt que de fabriquer des informations " +
  "récentes\n" +
  "- lorsque l'utilisateur te demande d'analyser, de comparer ou de synthétiser " +
  "des informations provenant de sources web (via des résultats de recherche), ne " +
  "te base pas uniquement sur les extraits (snippets) fournis par l'outil de " +
  "recherche ; tu as l'obligation d'utiliser systématiquement l'outil de " +
  "récupération de contenu (fetch_url) pour lire le corps complet des pages afin " +
  "de garantir une analyse exhaustive et précise\n" +
  "- si des outils permettent de récupérer une ressource binaire (image, base64...), " +
  "tu peux les appeler, l'application interceptera les réponses pour les " +
  "enregistrer comme ressources dont il te donnera l'ID, et présentera les images " +
  "à l'utilisateur automatiquement le cas échéant\n" +
  "- si l'utilisateur te demande de trouver une image ou photo, cherche des pages " +
  "susceptibles d'en contenir, récupère leur contenu, extrais la meilleure image " +
  "candidate, et récupère-la avec son URL : l'application la lui présentera " +
  "automatiquement. Pour les images, n'appelle JAMAIS present_resource et n'utilise " +
  "jamais de balise Markdown (type ![alt](url)) pour afficher une ressource déjà " +
  "présentée par l'application ; tu peux en utiliser pour présenter des MINIATURES, " +
  "dans ce cas fais-en un lien vers l'IMAGE originale (PAS la page qui la contient), " +
  "en utilisant l'URL de la MINIATURE pour l'image affichée en Markdown\n" +
  "- lorsque tu trouves une URL pointant vers une image via une recherche, ne te " +
  "contente pas d'afficher un lien Markdown ; utilise systématiquement l'outil " +
  "`fetch_url` pour récupérer le contenu de cette image afin qu'elle soit traitée " +
  "comme une ressource native (et présentée automatiquement à l'utilisateur par " +
  "l'application)\n" +
  "</ACCES_WEB>\n\n" +
  "<SANS_ACCES_WEB>\n" +
  "Si aucun outil disponible ne te permet d'accéder au Web, indique-le si c'est " +
  "pertinent, plutôt que de fabriquer des informations récentes.\n" +
  "</SANS_ACCES_WEB>\n";

// Doctrine comportementale : référence à une conversation passée. Toujours
// injectée quand des outils existent (get_conversation/list_conversations en
// font partie du registre de base) — même statut que BINARY_DOCTRINE. Le
// marqueur [conv_ref:ID] (ou [conv_ref:ID|Titre] si le titre est déjà connu du
// modèle) est résolu côté client en lien cliquable affichant le TITRE, jamais
// l'ID brut ; le titre est optionnel car l'application le retrouve elle-même
// depuis l'index des résumés si absent. Partie de ROOT_SYSTEM_PROMPT.
const CONV_REF_DOCTRINE =
  "Quand tu mentionnes une conversation passée obtenue via get_conversation ou " +
  "list_conversations (pour que l'utilisateur puisse l'ouvrir), n'écris JAMAIS " +
  "son identifiant technique en clair (pas de guillemets, pas de backticks, pas " +
  "de texte brut du type « conversation abc123 ») : utilise le marqueur " +
  "[conv_ref:ID] ou, si tu connais déjà son titre, [conv_ref:ID|Titre] — " +
  "l'application le remplace automatiquement par un lien affichant le titre.";

// Doctrine de déclenchement des outils mémoire. Partie de ROOT_SYSTEM_PROMPT.
const MEMORY_DOCTRINE =
  "Doctrine de déclenchement pour les outils mémoire :\n\n" +
  "CHEMIN DIRECT — appelle miaou__create_memory immédiatement (sans demander) quand l'utilisateur :\n" +
  "  - donne une instruction durable explicite : \"souviens-toi que\", \"retiens\", \"dorénavant\", " +
  "\"désormais\", \"à partir de maintenant\", \"appelle-moi X\", \"ne fais plus jamais Y\"\n" +
  "  - communique un fait stable sur lui-même (métier, projet, contrainte personnelle)\n" +
  "  - exprime une préférence de fond sur le format ou le ton de tes réponses\n" +
  "Sur le chemin direct : tu PEUX narrer « c'est noté » car l'écriture a déjà eu lieu.\n\n" +
  "CHEMIN INFÉRÉ — appelle ask_confirmation quand tu DÉDUIS (sans demande explicite) " +
  "qu'un fait durable mérite d'être retenu. Élargis le périmètre des faits durables pour " +
  "inclure systématiquement la localisation géographique et l'environnement quotidien : " +
  "si un tel détail apparaît, même s'il sert de contexte à une question technique, utilise " +
  "ce chemin pour proposer de le retenir. La question doit contenir LITTÉRALEMENT le " +
  "contenu envisagé : « Tu veux que je retienne : « … » ? ». " +
  "Ne JAMAIS écrire en mémoire sans confirmation préalable sur ce chemin. " +
  "Ne JAMAIS affirmer avoir enregistré quelque chose si tu n'as pas appelé miaou__create_memory dans ce même tour.\n\n" +
  "CHEMIN CORRECTION — quand l'utilisateur répond en texte libre à une question ask_confirmation " +
  "(au lieu de cliquer Accepter/Rejeter) et que sa réponse contient une valeur corrigée " +
  "(ex. « non, plutôt un modèle Y »), appelle miaou__create_memory avec la valeur corrigée. " +
  "Ne pas se contenter d'acquitter en texte.\n\n" +
  "MISE À JOUR / SUPPRESSION : si un souvenir existant devient obsolète ou inexact, " +
  "appelle miaou__update_memory (correction in-place) ou miaou__delete_memory (tombstone réversible).\n\n" +
  "Le contenu stocké est toujours à la 3e personne, factuel, sans interprétation.\n" +
  "Ne déclenche PAS pour une instruction valable seulement pour la réponse en cours.";

// Doctrine de déclenchement pour la bibliothèque de fichiers d'espace (lot Cbis,
// D2 path 3). Voie B (décision Cbis-4, revient sur A0.2 après relecture du
// primitif halting existant) : PAS de généralisation du halting — ask_confirmation
// est réutilisé tel quel, comme pour le chemin inféré mémoire ou les skills.
// Le gate repose donc sur la discipline du modèle (cette doctrine), pas sur un
// verrou technique côté handler — même modèle de confiance que MEMORY_DOCTRINE.
const FILES_DOCTRINE =
  "Doctrine de déclenchement pour miaou__files__promote (bibliothèque de fichiers " +
  "de l'espace) :\n\n" +
  "N'appelle JAMAIS miaou__files__promote directement. Si tu identifies qu'une " +
  "pièce jointe du tour courant (att-N) mériterait d'être conservée dans la " +
  "bibliothèque persistante de l'espace (contenu de référence, réutilisable au-delà " +
  "de cette conversation), appelle d'abord ask_confirmation avec une question qui " +
  "inclut LITTÉRALEMENT le nom du fichier, son type, sa taille approximative, et la " +
  "description que tu proposes de stocker (ce que le fichier EST, pas son contenu) : " +
  "« Tu veux que j'ajoute « nom_fichier » à la bibliothèque de l'espace, avec cette " +
  "description : « … » ? ».\n\n" +
  "SEULEMENT si l'utilisateur confirme positivement au tour suivant, appelle " +
  "miaou__files__promote(ref, description, name?) avec le MÊME ref, description et " +
  "name (si fourni) que ceux annoncés dans la question — ne reformule pas la " +
  "description entre la question et l'appel. Ne JAMAIS affirmer avoir ajouté un " +
  "fichier à la bibliothèque si tu n'as pas appelé miaou__files__promote avec " +
  "succès dans ce même tour. Si l'utilisateur décline, n'appelle pas l'outil et " +
  "n'insiste pas.";

// Doctrine docs (brief H) : injectée SEULEMENT si un outil du registre distant
// déclare le contrat ref+content_b64 (anyToolDeclaresAttachmentInflation) —
// zéro pollution des setups sans serveur d'extraction. Nommage par CRITÈRE
// (« un outil déclarant ref et content_b64 ») + EXEMPLE (docs__read) : robuste
// au renommage du serveur MCP par l'utilisateur, cohérent avec la discipline
// no-hardcode du lot A. PAS dans ROOT_SYSTEM_PROMPT (dépend de l'état runtime
// du registre distant), même mécanisme que skillDoctrinePrompt/intentDoctrinePrompt.
const DOCS_DOCTRINE =
  "Un fichier binaire joint par l'utilisateur (descripteur [attachment att-N: file " +
  "\"...\", <mime>, <taille> — binary content, not inlined]) n'est pas lisible " +
  "directement, mais si un outil du registre déclare dans son schéma d'entrée à la " +
  "fois un paramètre `ref` et un paramètre `content_b64` (par exemple docs__read), " +
  "cet outil sait ouvrir la pièce jointe : appelle-le avec ref=\"att-N\" pour en " +
  "extraire et lire le contenu, sans attendre que l'utilisateur te le demande " +
  "explicitement si la conversation porte sur ce fichier.";

function docsDoctrinePrompt() {
  return anyToolDeclaresAttachmentInflation() ? DOCS_DOCTRINE : '';
}

// Prompt racine — constante build-time, non modifiable depuis les paramètres.
// Compose les six doctrines ; référencé par buildSystemMessage() (main.js).
// v1 — une modification ici invalide le préfixe KV cache sur toutes les conversations.
const ROOT_SYSTEM_PROMPT = BINARY_DOCTRINE + "\n\n---\n\n" + ATTACHMENT_DOCTRINE + "\n\n---\n\n" +
  WEB_DOCTRINE + "\n\n---\n\n" + CONV_REF_DOCTRINE + "\n\n---\n\n" + MEMORY_DOCTRINE + "\n\n---\n\n" + FILES_DOCTRINE;

// Doctrine de nommage des blocs de code. Injectée INCONDITIONNELLEMENT (contrairement
// aux six ci-dessus) : générer un codeblock n'a aucun rapport avec la présence
// d'outils, donc PAS dans ROOT_SYSTEM_PROMPT (gouverné par TOOLS.length). Portée
// directement par systemMessageParts()/buildSystemMessage() (main.js) via out.codeblock.
// v2 — une modification ici invalide le préfixe KV cache sur toutes les conversations,
// même statut que le v1 de ROOT_SYSTEM_PROMPT. (v2, lot E3 : doctrine étendue
// aux blocs mermaid — le filename= nomme les exports d'image SVG/PNG, extension
// ajustée côté application par diagramImageName. v3 : contraintes de syntaxe des
// labels mermaid — parenthèses dans un [label] font échouer le parse ; balises
// HTML (<b>/<i>) inertes car htmlLabels:false, cf. docs/rendering.md.)
const CODEBLOCK_DOCTRINE =
  "Quand tu génères un bloc de code destiné à être enregistré comme fichier (script, " +
  "config, module…), fournis un nom de fichier sur la ligne d'ouverture de la fence, " +
  "après le langage, séparé par un espace, au format filename=nom.ext (sans espace " +
  "dans le nom, avec son extension). Exemple : ```python filename=fibonacci.py. " +
  "L'application proposera ce nom au téléchargement. Fais-le aussi pour les blocs " +
  "mermaid (ex. ```mermaid filename=flux-auth.mmd) : ce nom sert à nommer les exports " +
  "d'image du diagramme, l'extension est ajustée automatiquement. Pour un extrait " +
  "illustratif court sans vocation de fichier, tu peux l'omettre.\n\n" +
  "Pour les diagrammes mermaid, respecte ces contraintes de syntaxe sous peine de " +
  "diagramme non rendu :\n" +
  "- Si un texte de nœud contient une parenthèse, une accolade, un crochet, un guillemet " +
  "ou tout autre caractère spécial, entoure TOUT le texte de guillemets doubles. " +
  "Exemple : A[\"France vs Maroc (2-0)\"] et non A[France vs Maroc (2-0)] — une " +
  "parenthèse nue dans un [label] casse le parse.\n" +
  "- N'utilise PAS de balises HTML de mise en forme (<b>, <i>, <em>, <strong>…) dans les " +
  "labels : elles ne sont pas interprétées et s'affichent littéralement. Seul <br/> est " +
  "reconnu, pour un saut de ligne.";

// Doctrine de déclenchement des skills (stage 2 — autotrigger). Injectée
// conditionnellement (cf. skillDoctrinePrompt) quand des outils skill sont
// présents, comme INTENT_DOCTRINE. PAS dans ROOT_SYSTEM_PROMPT (constante
// build-time inconditionnelle) : ce bloc dépend de la disponibilité des outils
// skill au runtime, même mécanisme que intentDoctrinePrompt()/INTENT_DOCTRINE.
// Le modèle n'a aucun moyen d'observer la valeur de confirmSkillAutoUse (c'est
// un réglage localStorage, pas une donnée de contexte) : il ne faut donc PAS lui
// demander de vérifier « si le réglage est activé ». C'est skillDoctrinePrompt()
// qui lit le réglage et choisit le paragraphe CONFIRMATION à injecter — la
// doctrine envoyée au modèle est déjà résolue, jamais une branche conditionnelle
// textuelle. SKILL_DOCTRINE_BASE est commun aux deux variantes.
const SKILL_DOCTRINE_BASE =
  "Doctrine de déclenchement pour les skills :\n\n" +
  "Si un bloc <miaou_skills_context> est présent dans le contexte, il liste des " +
  "skills que l'utilisateur a choisi de rendre disponibles pour un usage proactif " +
  "— ce ne sont PAS des skills que tu es obligé d'utiliser, seulement des fragments " +
  "d'instructions pertinents si la situation s'y prête.\n\n" +
  "Pour utiliser une skill listée (qu'elle vienne de <miaou_skills_context> ou d'un " +
  "appel préalable à miaou__skills__list), appelle miaou__skills__read avec son slug.\n\n";

const SKILL_DOCTRINE_CONFIRM_ON =
  "CONFIRMATION : APRÈS que miaou__skills__read a renvoyé son contenu et AVANT " +
  "d'agir dessus, appelle l'outil ask_confirmation (nu, non préfixé) pour décrire " +
  "ce que tu t'apprêtes à faire avec cette skill. Cette règle s'applique à TOUT " +
  "appel à miaou__skills__read, que la skill ait été découverte via " +
  "<miaou_skills_context> ou via miaou__skills__list — elle ne dépend pas du " +
  "chemin de découverte. Elle ne s'applique PAS à l'invocation par slash-commande " +
  "(/slug) : c'est une action explicite de l'utilisateur, déjà un consentement, " +
  "et miaou__skills__read n'est jamais appelé sur ce chemin.\n\n";

const SKILL_DOCTRINE_CONFIRM_OFF =
  "Tu peux agir directement sur le contenu renvoyé par miaou__skills__read, sans " +
  "confirmation préalable.\n\n";

const SKILL_DOCTRINE_TAIL =
  "Ne JAMAIS affirmer avoir appliqué les instructions d'une skill si tu n'as pas " +
  "appelé miaou__skills__read dans ce même tour.";

// Doctrine de traçage des intentions (traces en langage naturel). Injectée
// conditionnellement dans buildSystemMessage() selon le toggle intentTracing.
const INTENT_DOCTRINE =
  "Pour chaque appel d'outil, inclus miaou_intent dans les ARGUMENTS de l'appel (jamais dans le nom de l'outil). " +
  "Sa valeur est une courte phrase décrivant le but de l'action à l'utilisateur — " +
  "pas une paraphrase du nom technique, mais l'intention concrète. " +
  "Exemples : « Récupération de la météo à Paris », « Enregistrement de la préférence de langue », " +
  "« Liste des conversations de la semaine passée ». Nom d'action sans point final, sans guillemets supplémentaires.";

// File d'attente des acks côté client : chaque handler d'outil (écriture mémoire
// OU lecture d'historique) y pousse un descripteur portant son `kind` ; main.js la
// consomme dans onFinal pour injecter les messages 'tool-ack' dans le thread
// (jamais envoyés au modèle). Les returns model-facing restent inchangés.
let _pendingToolAcks = [];
function getPendingToolAcks() { return _pendingToolAcks.slice(); }
function clearPendingToolAcks() { _pendingToolAcks = []; }
// Brief A2 / D3 — injections image du tour COURANT. Un recall_attachment sur une
// image ne peut pas remettre les pixels dans son résultat role:'tool' (textuel) :
// il annonce l'image et pousse ici { dataUrl, attId }. La boucle runConversation
// (api.js) draine ce registre APRÈS avoir poussé les tool results du tour et,
// pour chaque entrée, pousse un message user synthétique porteur de la part
// image DANS `messages` — pour que le tour suivant (relance de la boucle) le
// voie. C'est le pendant intra-échange de resolveRecallImages/expandThread, qui
// eux ne régénèrent le message qu'aux ENVOIS ultérieurs (thread rechargé). Sans
// ce canal, le modèle répondrait au tour d'après sans jamais recevoir l'image
// (il ne verrait que « son contenu suit ») et confabulerait.
let _pendingImageInjections = [];
function getPendingImageInjections() { return _pendingImageInjections.slice(); }
function clearPendingImageInjections() { _pendingImageInjections = []; }
// Enrichit le dernier ack en attente (outils internes synchrones). Les outils
// distants (asynchrones) voient leur ack déjà drainé dans earlyRendered ; leur
// enrichissement est fait directement par le hook onEnrichLastAck dans main.js.
// `minLength` (optionnel) : n'enrichit que si _pendingToolAcks a CRÛ au-delà de
// cette borne — garde-fou contre l'enrichissement de l'ack d'un AUTRE outil
// quand le handler courant sort en erreur précoce sans pousser d'ack (tour
// multi-outils : sinon l'intent du 2e appel écrase celui du 1er). Voir callTool.
function updateLastPendingToolAck(fields, minLength) {
  if (!_pendingToolAcks.length) return;
  if (typeof minLength === 'number' && _pendingToolAcks.length <= minLength) return;
  Object.assign(_pendingToolAcks[_pendingToolAcks.length - 1], fields);
}

// File des blocs NON-text renvoyés par un outil distant (image / resource /
// binaire). Vidée par le hook UI au même moment que les acks (après l'exécution
// des outils d'un tour) et rendue dans la bulle assistant courante via la cascade
// D8 — purement éphémère, RIEN n'est persisté (cf. brief D8, persistance des
// pièces jointes explicitement reportée). Les blocs `text` ne passent JAMAIS par
// ici : ils sont aplatis pour le modèle (flattenToolResult), pas affichés.
let _pendingToolBlocks = [];
function getPendingToolBlocks() { return _pendingToolBlocks.slice(); }
function clearPendingToolBlocks() { _pendingToolBlocks = []; }
// Filtre in-place _pendingToolBlocks (appelé par internResourcesFromResult pour
// retirer les blocs D8 dont le stockage IDB prend le relais).
function retainPendingToolBlocks(keepFn) { _pendingToolBlocks = _pendingToolBlocks.filter(keepFn); }

// Validation pure des arguments de files__promote (lot Cbis) — extraite du
// handler (async, non testable synchrone via callTool/QuickJS, cf. pattern
// callInternalTool : un handler async renvoie TOUJOURS un thenable, même sur
// un retour anticipé avant le premier await) pour rester couverte par les
// tests QuickJS. Retourne un message d'erreur si invalide, '' sinon.
function validateFilesPromoteArgs(args) {
  const ref = String((args && args.ref) || '');
  const description = String((args && args.description) || '').trim();
  if (!ref || !description) return 'Paramètres invalides (ref et description requis).';
  return '';
}

// ── Registre MCP interne ─────────────────────────────────────────────────────
// Forme canonique : { name, description, inputSchema (JSON Schema), annotations,
// handler }. ask_confirmation est exclu (primitif halting, voir ASK_CONFIRMATION_DEF).
const TOOLS = [
  {
    name: 'get_conversation',
    description:
      "Récupère une conversation passée par son identifiant. Par défaut " +
      "(with_contents=false), retourne seulement son résumé et ses mots-clés ; " +
      "passer with_contents=true pour obtenir le contenu complet des messages.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de la conversation' },
        with_contents: { type: 'boolean', description: 'Inclure le contenu complet (défaut false)' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const entry = getSummaryEntry(args.id);   // storage.js
      if (!entry || entry.suppressed) return 'Conversation introuvable ou souvenir supprimé.';
      // Herméticité (brief D2) : une conversation d'un autre Space répond comme
      // inexistante — même message, pas d'oracle. activeSpaceId est une global
      // de main.js, accès défensif car tools.js est aussi évalué seul (test runner).
      // Un résumé orphelin (conversation supprimée, index conservé) n'a pas de
      // Space propre : traité comme default Space (visible seulement là).
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      const conv = loadConversation(args.id);   // storage.js — un seul chargement (herméticité ET contenu)
      const convSpace = conv ? (conv.spaceId || DEFAULT_SPACE_ID) : DEFAULT_SPACE_ID;
      if (convSpace !== spaceId) return 'Conversation introuvable ou souvenir supprimé.';
      const light = summaryLight(entry);
      _pendingToolAcks.push({ kind: 'conversation_read', title: light.title, convId: args.id });
      if (!args.with_contents) return JSON.stringify(light);
      if (!conv) return JSON.stringify(light);   // résumé présent mais conversation absente : cas limite
      return JSON.stringify(Object.assign({}, light, { messages: conv.messages ?? conv }));
    },
  },
  {
    name: 'list_conversations',
    description:
      "Liste les conversations passées (résumé + mots-clés par défaut), hors " +
      "la conversation en cours. Le paramètre since est OPTIONNEL : l'omettre " +
      "liste TOUTES les conversations — appelle l'outil sans hésiter même sans " +
      "date en tête ; le préciser (date ISO 8601) limite aux conversations " +
      "actives depuis cette date. Passer query pour ne garder que les " +
      "conversations dont le résumé ou les mots-clés correspondent (recherche " +
      "par mots, pas de sous-chaîne exacte) — utile pour retrouver une " +
      "conversation sur un sujet précis sans tout lister. Passer " +
      "with_contents=true pour inclure aussi le contenu complet de chacune " +
      "(potentiellement volumineux).",
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Optionnel — date ISO 8601. Omettre pour tout lister.' },
        query: { type: 'string', description: 'Optionnel — mots-clés à rechercher dans le résumé/titre.' },
        with_contents: { type: 'boolean', description: 'Inclure le contenu complet (défaut false)' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      let entries = listSummaryEntries();        // storage.js — entrées non-tombstone
      // Herméticité (brief D2) : ne jamais exposer une conversation d'un autre
      // Space au modèle. Même accès défensif que currentConvId ci-dessous. Un
      // résumé orphelin (conversation supprimée) est traité comme default Space.
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      const allConvs = loadConversations();
      const idsInSpace = spaceConvIds(spaceId, allConvs);
      const convIds = new Set(allConvs.map(c => c.id));
      entries = entries.filter(e => idsInSpace.has(e.id) || (!convIds.has(e.id) && spaceId === DEFAULT_SPACE_ID));
      // Exclut la conversation en cours : lister "les conversations passées" n'a
      // de sens que pour les AUTRES ; currentConvId est une global de main.js
      // (accès défensif car tools.js est aussi évalué seul par le test runner).
      const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
      if (activeId) entries = entries.filter(e => e.id !== activeId);
      if (args.since != null && args.since !== '') {
        const sinceMs = Date.parse(args.since);
        if (Number.isNaN(sinceMs)) return 'Date "since" invalide (attendu ISO 8601).';
        entries = entries.filter(e => (e.timestamp || 0) >= sinceMs);
      }
      if (args.query != null && args.query !== '') {
        const qTokens = tokenize(args.query);     // utils.js
        entries = entries.filter(e => scoreSummary(qTokens, e) >= 1);
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
    name: 'create_memory',
    description:
      "Enregistre immédiatement un nouveau souvenir persistant. Utiliser sur le " +
      "CHEMIN DIRECT uniquement (instruction explicite de l'utilisateur). Voir doctrine mémoire.",
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Contenu du souvenir (3e personne, factuel)' },
      },
      required: ['content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: (args) => {
      if (!args.content || !args.content.trim()) return 'Contenu vide — souvenir ignoré.';
      const id = genMemoryId();
      const now = Date.now();
      const content = args.content.trim();
      // Stampe le Space actif (brief D3) : pas de paramètre scope exposé au
      // modèle, écriture toujours dans le Space courant ; promotion vers
      // 'profile' réservée à une action UI (jamais depuis cet outil).
      const scope = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      saveMemory({ id, content, created_at: now, updated_at: now, suppressed: false, scope });
      _pendingToolAcks.push({ kind: 'memory_create', id, content });
      return 'Souvenir enregistré. Identifiant : ' + id;
    },
  },
  {
    name: 'update_memory',
    description:
      "Corrige un souvenir existant en place (pas de tombstone). Utiliser quand " +
      "un fait enregistré est devenu inexact ou doit être précisé. Voir doctrine mémoire.",
    inputSchema: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'Identifiant du souvenir à corriger' },
        content: { type: 'string', description: 'Nouveau contenu (3e personne, factuel)' },
      },
      required: ['id', 'content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    handler: (args) => {
      if (!args.id || !args.content || !args.content.trim()) return 'Paramètres invalides.';
      const content = args.content.trim();
      const existing = loadMemories().find(e => e.id === args.id);   // avant écrasement
      // Herméticité (brief D3, extension D2) : hors du Space actif (ou scope
      // profile) = « introuvable », même posture sans-oracle que get_conversation.
      // Une entrée sans scope (pré-migration) vaut default Space.
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      if (!existing || (existing.scope || DEFAULT_SPACE_ID) !== spaceId) return 'Souvenir introuvable.';
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
    name: 'present_resource',
    description:
      "Présente une ressource stockée (image, texte, fichier binaire) à l'utilisateur " +
      "en l'affichant dans le thread. Utiliser l'identifiant renvoyé lors du stockage de " +
      "la ressource (commence par res_). Pour une image, elle s'affiche inline ; pour un " +
      "texte/JSON, un bloc de code surligné ; pour un binaire, un bouton de téléchargement.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de la ressource (res_…)' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const id = String(args.id || '');
      if (!id) return 'Identifiant manquant.';
      // getCachedRecord et makeResourcePresentBlock sont dans resources.js (chargé avant).
      const record = getCachedRecord(id);
      if (!record) return 'Ressource introuvable (identifiant inconnu ou non disponible en session).';
      // Le rendu du bloc est délégué à placeToolAck (live et reload via même chemin).
      _pendingToolAcks.push({ kind: 'resource_presented', id, resourceName: record.name, mime: record.mime });
      return 'Ressource présentée à l\'utilisateur.';
    },
  },
  {
    name: 'recall_attachment',
    description:
      "Ramène le contenu d'une pièce jointe attachée par l'utilisateur à un message " +
      "(identifiant att-N vu dans un descripteur [attachment att-N: ...] du fil) DANS ton " +
      "contexte, pour que tu puisses de nouveau l'examiner. Pour une image : elle t'est " +
      "ré-injectée juste après le résultat de l'outil (tu la revois réellement) et est " +
      "aussi ré-affichée à l'utilisateur. Pour un fichier texte : renvoie son contenu en " +
      "clair. Pour un binaire : renvoie le descripteur (contenu non lisible directement).",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Identifiant de la pièce jointe (att-N)' },
      },
      required: ['ref'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const ref = String(args.ref || '');
      if (!ref) return 'Identifiant manquant.';
      // getCachedRecordByAttId est dans resources.js (chargé avant). currentConvId
      // est une global de main.js — accès défensif (tools.js évalué seul par le
      // test runner), même pattern que list_conversations ci-dessus.
      const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
      const record = getCachedRecordByAttId(ref, activeId);
      if (!record) return 'Pièce jointe introuvable (identifiant inconnu ou non disponible en session).';
      _pendingToolAcks.push({ kind: 'attachment_recalled', attId: ref, resourceName: record.name, mime: record.mime, convId: activeId });
      if (record.mime && record.mime.startsWith('image/')) {
        // Brief A2 / D3 (probe validée 2026-07-05, voie (b)) : les pixels SONT
        // ré-injectés au modèle, non pas dans ce résultat role:'tool' (textuel,
        // et un contenu image y confabule quand il est strippé — cf. contrôle
        // de probe), mais via un message user SYNTHÉTIQUE porteur de la part
        // image. Deux voies complémentaires selon le moment :
        //  - tour COURANT : on empile ici l'injection ; la boucle runConversation
        //    (api.js) la draine et pousse le message user DANS `messages` après
        //    les tool results, pour que le tour suivant le voie ;
        //  - envois ULTÉRIEURS (thread rechargé) : resolveRecallImages +
        //    expandThread régénèrent le message depuis l'ack persisté (attId).
        // La dataUrl est reconstruite depuis le record FIGÉ (byte-stable) et
        // n'est jamais persistée (seul attId l'est). Le tool result ci-dessous
        // ne fait qu'annoncer l'image qui suit.
        if (record.data) {
          _pendingImageInjections.push({
            attId: ref,
            dataUrl: 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data),
          });
        }
        return 'Image att-' + ref.replace(/^att-/, '') + ' ré-affichée à l\'utilisateur ; son contenu suit dans le message suivant.';
      }
      if (record.class === 'inline') {
        return utf8Decode(record.data);
      }
      return formatResourceDescriptor({ id: record.id, mime: record.mime, name: record.name, size: record.size }) +
        ' — contenu non lisible directement.';
    },
  },
  {
    name: 'files__list',
    description:
      "Liste les fichiers de la bibliothèque de l'espace actif (id, nom, type, " +
      "taille, provenance). Utiliser avant files__read pour retrouver l'identifiant " +
      "d'un fichier (file-N).",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: () => {
      // Herméticité (piège 18, lot Cbis) : bibliothèque du Space actif SEULEMENT.
      // activeSpaceId est une global de main.js — accès défensif (tools.js aussi
      // évalué seul par le test runner), même pattern que get_conversation.
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      const entries = getCachedLibraryEntriesBySpace(spaceId);   // resources.js (chargé avant)
      const light = entries.map(e => ({
        id: libraryRefFromId(e.id), name: e.name, mime: e.mime, size: e.size,
        source: e.source || null,
      }));
      _pendingToolAcks.push({ kind: 'files_list', count: light.length });
      return JSON.stringify(light);
    },
  },
  {
    name: 'files__read',
    description:
      "Lit un fichier de la bibliothèque de l'espace actif par son identifiant " +
      "(file-N, obtenu via files__list). Un fichier texte est renvoyé en clair ; " +
      "un binaire (PDF, Office, zip…) est routé vers les outils d'extraction de " +
      "documents ; une image est soumise à la capacité de vision du modèle actif.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant du fichier (file-N)' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      const recordId = parseLibraryRef(String(args.id || ''));   // resources.js
      if (!recordId) return 'Fichier introuvable.';
      const record = getCachedRecord(recordId);   // resources.js — cache session unifié
      // Foreign-Space ou id inconnu → même posture no-oracle que get_conversation/mémoires.
      if (!record || record.kind !== 'library' || record.spaceId !== spaceId) return 'Fichier introuvable.';
      _pendingToolAcks.push({ kind: 'files_read', id: args.id, resourceName: record.name, mime: record.mime });
      if (record.mime && record.mime.startsWith('image/')) {
        const model = typeof activeModel === 'function' ? activeModel() : '';
        const server = typeof activeApiServer === 'function' ? activeApiServer() : null;
        if (!serverModelVisionEnabled(server, model)) {
          return 'Ce contenu (image) ne peut pas être présenté à ce modèle (pas de capacité de vision).';
        }
        // Pas de placeholder muet, mais pas non plus de ré-injection de pixels ici :
        // v1 se limite à la posture explicite ; la ré-injection suivrait le même
        // mécanisme que recall_attachment si un besoin se confirme (hors scope Cbis-3).
        return formatResourceDescriptor({ id: record.id, mime: record.mime, name: record.name, size: record.size }) +
          ' — image, capacité de vision présente mais non ré-injectée par cet outil.';
      }
      if (record.class === 'inline') return utf8Decode(record.data);
      // Binaire (PDF/Office/zip…) : routé via le hook d'inflation généralisé
      // (callDocsInflatedRemoteTool, §4/D3) — le modèle lit via les outils
      // mcp_docs list/read, comme pour un attachment de message.
      return formatResourceDescriptor({ id: record.id, mime: record.mime, name: record.name, size: record.size }) +
        ' — contenu binaire, non inlinable directement ; utiliser les outils de lecture de documents (mcp_docs).';
    },
  },
  {
    name: 'files__promote',
    description:
      "Copie une pièce jointe du tour courant (ref att-N) dans la bibliothèque " +
      "persistante de l'espace actif, avec une description de ce qu'elle contient " +
      "(pas un résumé de son contenu — ce que le fichier EST, pour qu'un futur " +
      "appel décide s'il faut le lire). Consentement de l'utilisateur REQUIS au " +
      "préalable (voir doctrine bibliothèque) : n'appelle cet outil qu'après avoir " +
      "posé la question via ask_confirmation et reçu une réponse positive.",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Identifiant de la pièce jointe du tour courant (att-N)' },
        description: { type: 'string', description: 'Description factuelle de ce que contient le fichier (≤ 2 phrases), pas un résumé de son contenu' },
        name: { type: 'string', description: 'Nom optionnel (défaut : nom du fichier d\'origine)' },
      },
      required: ['ref', 'description'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args) => {
      const invalid = validateFilesPromoteArgs(args);
      if (invalid) return invalid;
      const ref = String(args.ref || '');
      const description = String(args.description || '').trim();
      const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
      const record = getCachedRecordByAttId(ref, activeId);   // resources.js — att-N du tour courant
      if (!record) return 'Fichier introuvable.';   // ref inconnue/périmée, même posture que files__read
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      const name = args.name ? String(args.name).trim() : record.name;
      const stored = await storeLibraryFile(   // resources.js — copie, l'attachment d'origine reste intact
        spaceId, record.mime, name, record.data, record.class, activeId, description, Date.now(), Math.random
      );
      if (!stored) return 'Échec de l\'enregistrement dans la bibliothèque.';
      _pendingToolAcks.push({ kind: 'file_promote', id: libraryRefFromId(stored.id), resourceName: stored.name });
      return 'Fichier ajouté à la bibliothèque de l\'espace. Identifiant : ' + libraryRefFromId(stored.id);
    },
  },
  {
    name: 'delete_memory',
    description:
      "Supprime un souvenir (tombstone réversible depuis l'interface). Utiliser " +
      "quand un fait enregistré n'est plus pertinent. Voir doctrine mémoire.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant du souvenir à supprimer' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    handler: (args) => {
      if (!args.id) return 'Identifiant manquant.';
      const existing = loadMemories().find(e => e.id === args.id);
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      if (!existing || (existing.scope || DEFAULT_SPACE_ID) !== spaceId) return 'Souvenir introuvable.';
      suppressMemory(args.id);
      _pendingToolAcks.push({ kind: 'memory_delete', id: args.id, content: existing ? existing.content : null });
      return 'Souvenir supprimé (réversible depuis les paramètres).';
    },
  },
  {
    // Sous-namespace miaou__skills__ : énumère les skills ACTIVÉS (slug + name +
    // description) pour que le modèle découvre ce qu'il peut lire via skills__read.
    // Les skills désactivés n'apparaissent JAMAIS (l'utilisateur les a coupés).
    name: 'skills__list',
    description:
      "Liste les skills disponibles (méta : slug, nom, description). Une skill est " +
      "un fragment d'instructions réutilisable. Appelle cet outil quand la demande " +
      "de l'utilisateur pourrait correspondre à une skill ; lis ensuite son contenu " +
      "avec miaou__skills__read en passant le slug. Ne liste que les skills activées.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: () => {
      // listEnabledSkills (skills.js) lit le cache mémoire — synchrone.
      const list = listEnabledSkills().map(s => ({ slug: s.slug, name: s.name, description: s.description }));
      _pendingToolAcks.push({ kind: 'skill_list', count: list.length });
      return JSON.stringify(list);
    },
  },
  {
    // miaou__skills__read : renvoie le contenu Markdown complet d'un skill activé.
    // Les contrôles (introuvable / désactivé) lisent le cache mémoire → ERREUR
    // SYNCHRONE (testable QuickJS). Le contenu lui-même est en IDB → fetch ASYNC
    // (Promise) ; callInternalTool gère un handler thenable. NE passe PAS par
    // l'injection figée de la slash-commande : c'est un tool_result normal, dont
    // le contenu doit être disponible au modèle dès ce tour.
    name: 'skills__read',
    description:
      "Lit le contenu complet d'une skill par son slug (obtenu via miaou__skills__list). " +
      "Renvoie les instructions de la skill, à suivre pour la suite de la réponse. " +
      "Erreur claire si le slug est inconnu ou la skill désactivée.",
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Slug de la skill à lire' },
      },
      required: ['slug'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const slug = String(args.slug || '').trim();
      if (!slug) return 'Slug manquant.';
      const meta = getSkillMeta(slug);                 // cache mémoire (synchrone)
      if (!meta) return 'Skill introuvable : ' + slug;
      if (meta.enabled === false) return 'Skill désactivée : ' + slug;
      // Activée : fetch IDB async. L'ack est poussé une fois le contenu obtenu.
      return getSkillContent(slug).then(content => {
        if (content == null) return 'Contenu indisponible pour la skill : ' + slug;
        // Nom d'affichage du skill stocké en `title` (pas `name` : onEnrichLastAck
        // écrase `name` avec le nom canonique de l'outil pour la réinjection cross-turn).
        _pendingToolAcks.push({ kind: 'skill_read', slug, title: meta.name });
        return content;
      });
    },
  },
];

// ── ask_confirmation : primitif halting hors registre MCP ────────────────────
// Outil HALTING : runConversation (api.js) l'intercepte AVANT le dispatch et
// arrête l'échange — il ne pousse aucun message tool_calls/tool natif, ne
// relance pas. La reprise se fait au tour suivant via la réponse de l'utilisateur
// (« Oui »/« Non » ou correction libre) réécrite en texte clair (fork B).
// Il n'est PAS dans le registre TOOLS (pas de callTool) mais est inclus dans
// toolDefinitions() pour que le modèle puisse l'appeler.
const ASK_CONFIRMATION_DEF = {
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
};

// ── Agrégation distante : cache de session + client MCP ──────────────────────
// MIAOU est un client/agrégateur MCP (cf. brief V2) : il fusionne ses outils
// internes et ceux de N serveurs distants en UN seul registre, invisible au
// modèle. État en mémoire UNIQUEMENT (jamais persisté), reconstruit au démarrage
// par connectMcpServer pour chaque serveur activé (cf. main.js init).
const MCP_PROTOCOL_VERSION = '2025-06-18';

// Code d'erreur machine partagé avec le serveur mcp_docs (brief D, D1) : un
// `ref` inconnu sans `content_b64` fourni. Porté dans `error.data.code` (slot
// applicatif standard JSON-RPC 2.0, cf. mcpRpcAttempt) — UNE seule constante,
// ne pas la dupliquer en dur ailleurs.
const REF_UNKNOWN_ERROR_CODE = 'REF_UNKNOWN';

let _remoteTools = {};   // { servername: [ { name:'servername__x', description, inputSchema }, … ] }
let _remoteStatus = {};  // { servername: { state:'connecting'|'ok'|'error', count, error?, sessionId? } }

function getMcpStatus(name) { return _remoteStatus[name] || null; }

// Outils distants exposables : déjà préfixés `servername__` et filtrés (D7).
function remoteToolDefs() {
  const out = [];
  for (const name of Object.keys(_remoteTools)) {
    for (const t of _remoteTools[name]) out.push(t);
  }
  return out;
}

// Registre EXPOSÉ au modèle (forme canonique MCP) : outils internes préfixés
// `miaou__` + outils distants (déjà préfixés). Le préfixe interne est ajouté ICI,
// à l'exposition seulement — TOOLS reste stocké en noms NUS (le préfixe est une
// vue, pas un stockage). ask_confirmation reste HORS de ce registre (halting).
function exposedTools() {
  const internal = TOOLS.map(t => ({
    name: 'miaou__' + t.name, description: t.description, inputSchema: t.inputSchema,
  }));
  return internal.concat(remoteToolDefs());
}

// ── Client JSON-RPC 2.0 sur transport streamable-http (cf. D4/D10) ───────────
let _mcpRpcId = 0;

// UNE tentative d'appel JSON-RPC (un seul POST ; réponse JSON OU flux SSE). Timeout
// via AbortController (cf. D5). Lève sur erreur ; sur HTTP 404 ALORS qu'on détenait
// un Mcp-Session-Id, tague l'erreur `staleSession = true` (le serveur a redémarré
// et ne reconnaît plus la session → déclenche le ré-handshake dans mcpRpc). Un 404
// SANS session détenue est un vrai 404 (mauvais endpoint), non tagué.
async function mcpRpcAttempt(server, method, params, opts) {
  const o = opts || {};
  const ctrl = new AbortController();
  const tmo = server.timeout || 30000;
  const timer = setTimeout(() => ctrl.abort(), tmo);
  const id = o.notify ? undefined : (++_mcpRpcId);
  const body = { jsonrpc: '2.0', method };
  if (!o.notify) body.id = id;
  if (params !== undefined) body.params = params;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (server.authorization_token) headers['Authorization'] = 'Bearer ' + server.authorization_token;
  const st = _remoteStatus[server.name];
  const hadSession = !!(st && st.sessionId);
  if (hadSession) headers['Mcp-Session-Id'] = st.sessionId;
  try {
    const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const newSid = res.headers && res.headers.get && res.headers.get('Mcp-Session-Id');
    if (newSid && _remoteStatus[server.name]) _remoteStatus[server.name].sessionId = newSid;
    if (o.notify) return null;
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      if (res.status === 404 && hadSession) err.staleSession = true;   // session invalidée, pas un vrai 404 d'URL
      throw err;
    }
    const ctype = (res.headers && res.headers.get && res.headers.get('Content-Type')) || '';
    const msg = ctype.indexOf('text/event-stream') >= 0 ? await readSseJsonRpc(res, id) : await res.json();
    if (!msg) throw new Error('Réponse vide.');
    if (msg.error) {
      const err = new Error((msg.error && msg.error.message) || 'Erreur JSON-RPC.');
      if (hadSession && /session/i.test(err.message)) err.staleSession = true;   // signalée par erreur JSON-RPC
      // Code machine applicatif (brief D, contrat REF_UNKNOWN) : slot standard
      // JSON-RPC 2.0 pour les données d'erreur applicatives, `code` restant
      // réservé à l'entier protocolaire. err.data.code, jamais err.code.
      if (msg.error && msg.error.data) err.data = msg.error.data;
      throw err;
    }
    return msg.result;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Délai dépassé (' + tmo + ' ms).');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Refait le handshake initialize (+ notification initialized) pour récupérer un
// nouveau Mcp-Session-Id après invalidation (serveur redémarré). NE re-liste PAS
// les outils — le cache reste valide. Passe par mcpRpcAttempt (pas mcpRpc) pour
// éviter toute récursion de ré-handshake.
async function mcpReinitialize(server) {
  if (_remoteStatus[server.name]) _remoteStatus[server.name].sessionId = null;   // ne plus renvoyer l'id mort
  await mcpRpcAttempt(server, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'miaou', version: '2' },
  }, {});
  try { await mcpRpcAttempt(server, 'notifications/initialized', undefined, { notify: true }); } catch (_) {}
}

// Émet une requête JSON-RPC, avec RÉ-HANDSHAKE PARESSEUX (cf. brief Correction B) :
// si l'appel échoue par session invalidée (404 avec session détenue, ou erreur
// JSON-RPC « session »), refait initialize pour capturer un nouvel id et REJOUE
// l'appel UNE seule fois. Un nouvel échec (ré-handshake ou rejeu) est propagé → la
// dégradation gracieuse D10 prend le relais côté appelant. On ne re-sonde JAMAIS la
// session préventivement — on ne réagit qu'à sa mort avérée, et au plus une fois.
async function mcpRpc(server, method, params, opts) {
  const o = opts || {};
  if (server.transport === 'sse') throw new Error('Transport sse non implémenté (différé en V2).');
  try {
    return await mcpRpcAttempt(server, method, params, o);
  } catch (e) {
    if (!e || !e.staleSession || method === 'initialize' || o.notify) throw e;
    await mcpReinitialize(server);                          // peut lever → propagé
    return await mcpRpcAttempt(server, method, params, o);  // rejeu unique
  }
}

// Lit un flux SSE de réponse streamable-http, renvoie le 1er message JSON-RPC
// dont l'id correspond (repli : 1er message porteur de result/error si id absent).
// Normalise CRLF→LF AVANT découpage : le SDK MCP encadre ses événements en
// `\r\n\r\n`, un découpage sur `\n\n` seul échouerait (→ « Réponse vide »). Les
// octets sont du texte (data: = JSON, CR/LF y sont échappés), normaliser est sûr.
async function readSseJsonRpc(res, wantId) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', found = null;
  for (;;) {
    const r = await reader.read();
    if (r.value) buf += dec.decode(r.value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of evt.split('\n')) {
        if (line.indexOf('data:') !== 0) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j && j.id === wantId) { try { reader.cancel(); } catch (_) {} return j; }
          if (found == null && j && (j.result !== undefined || j.error)) found = j;
        } catch (_) { /* fragment non JSON, ignoré */ }
      }
    }
    if (r.done) break;
  }
  return found;
}

// Handshake d'activation (cf. D10) : initialize → notification initialized →
// tools/list ; préfixe, filtre (D7), met en cache. DÉGRADE GRACIEUSEMENT : tout
// échec marque le serveur en erreur et n'expose AUCUN de ses outils, sans jamais
// lever vers l'appelant — un mauvais backend ne gèle jamais MIAOU.
async function connectMcpServer(server) {
  const s = server;
  _remoteStatus[s.name] = { state: 'connecting', count: 0, sessionId: null };
  delete _remoteTools[s.name];
  try {
    await mcpRpc(s, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'miaou', version: '2' },
    });
    try { await mcpRpc(s, 'notifications/initialized', undefined, { notify: true }); } catch (_) {}
    const listed = await mcpRpc(s, 'tools/list', {});
    const tools = (listed && Array.isArray(listed.tools)) ? listed.tools : [];
    const filtered = filterMcpTools(tools, s.toolAllowlist, s.toolDenylist);
    _remoteTools[s.name] = filtered.map(t => ({
      name: s.name + '__' + t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    _remoteStatus[s.name] = Object.assign(_remoteStatus[s.name] || {}, {
      state: 'ok', count: _remoteTools[s.name].length, error: null,
    });
    return true;
  } catch (e) {
    delete _remoteTools[s.name];
    _remoteStatus[s.name] = { state: 'error', count: 0, error: (e && e.message) || 'échec', sessionId: null };
    return false;
  }
}

function disconnectMcpServer(name) {
  delete _remoteTools[name];
  delete _remoteStatus[name];
}

// Route un appel vers un serveur distant : tools/call → { content, isError }.
// Pousse les blocs NON-text dans _pendingToolBlocks (rendu UI éphémère D8). Le
// retour conserve TOUS les blocs ; flattenToolResult ne gardera que le text pour
// le modèle (D9). Échec/timeout → résultat isError textuel, jamais de throw.
// L'ack mcp_call est poussé dans _pendingToolAcks de manière SYNCHRONE, avant le
// premier await, pour permettre le rendu pendant le round-trip (cf. onEarlyAcks).
// `intent` : description en langage naturel extraite de miaou_intent par callTool
// (déjà strippée des args envoyés au serveur). Stockée dans l'ack pour l'UI.
// `reuseAckEntry` (D6, rejeu REF_UNKNOWN) : réutilise la ligne d'ack du premier
// essai au lieu d'en pousser une seconde — même rendu qu'un rejeu staleSession
// (dont le rejeu vit SOUS un seul callRemoteTool) : UNE ligne d'appel pour
// l'échange complet, l'erreur transitoire est effacée si le rejeu réussit.
async function callRemoteTool(server, toolName, args, intent, reuseAckEntry) {
  const fullName = server.name + '__' + toolName;
  const ackEntry = reuseAckEntry || { kind: 'mcp_call', server: server.name, name: fullName };
  if (intent != null) ackEntry.intent = intent;
  if (!reuseAckEntry) _pendingToolAcks.push(ackEntry);   // synchrone — avant tout await

  try {
    const result = await mcpRpc(server, 'tools/call', { name: toolName, arguments: args || {} });
    const content = (result && Array.isArray(result.content)) ? result.content : [];
    const nonText = content.filter(b => b && b.type !== 'text');
    if (nonText.length) _pendingToolBlocks.push.apply(_pendingToolBlocks, nonText);
    if (result && result.isError) ackEntry.error = true;
    else if (reuseAckEntry) delete ackEntry.error;   // rejeu réussi : échec transitoire effacé
    return { content, isError: !!(result && result.isError), ackEntry };
  } catch (e) {
    ackEntry.error = true;
    // errorCode et ackEntry (pas dans ACK_COPY_FIELDS : jamais persistés, lus
    // synchrones par l'appelant immédiat callDocsInflatedRemoteTool, cf. D6) :
    // errorCode porte le code machine brut (ex. REF_UNKNOWN) depuis err.data.code
    // (mcpRpcAttempt) — évite de dépendre du texte libre du message pour une
    // décision de rejeu ; ackEntry permet au rejeu de réutiliser la même ligne.
    const errorCode = e && e.data && e.data.code;
    return {
      content: [{ type: 'text', text: 'Erreur outil distant ' + fullName + ' : ' + ((e && e.message) || e) }],
      isError: true,
      errorCode,
      ackEntry,
    };
  }
}

// ── Dispatcher MCP ───────────────────────────────────────────────────────────
// Dispatch interne synchrone (outils miaou, noms NUS). Cœur unit-testé.
function callInternalTool(toolName, args) {
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) return { content: [{ type: 'text', text: 'Outil inconnu : ' + toolName }], isError: true };
  try {
    const text = tool.handler(args || {});
    // Handler ASYNC (ex. skills__read lit le contenu en IDB) : il renvoie une
    // Promise<string>. On la mappe vers la forme MCP. Les handlers synchrones
    // (tous les autres) restent synchrones → branche interne testable sans async.
    if (text && typeof text.then === 'function') {
      return text.then(
        t => ({ content: [{ type: 'text', text: String(t) }], isError: false }),
        e => ({ content: [{ type: 'text', text: 'Erreur outil ' + toolName + ' : ' + ((e && e.message) || e) }], isError: true })
      );
    }
    return { content: [{ type: 'text', text: String(text) }], isError: false };
  } catch (e) {
    return { content: [{ type: 'text', text: 'Erreur outil ' + toolName + ' : ' + e.message }], isError: true };
  }
}

// Point d'entrée unique de dispatch (cf. brief D1). Splitte le nom canonique sur
// le PREMIER `__` : préfixe `miaou` (ou absent) → dispatch interne SYNCHRONE ;
// sinon → serveur distant activé portant ce nom → appel ASYNCHRONE (fetch).
// Préfixe inconnu / serveur désactivé → erreur propre. Résultat :
// { content:[...blocks], isError }. ask_confirmation n'atteint jamais ici
// (interception halting en amont dans api.js).
// Type de retour MIXTE assumé : objet (interne/erreur) OU Promise (distant) — les
// appelants font `await callTool(...)`, et `await` sur un objet le renvoie tel
// quel. Cela garde les branches interne/erreur synchrones, donc testables sans
// async (le runner QuickJS n'attend pas les promesses).
// miaou_intent est strippé des args avant tout dispatch : les handlers internes
// et serveurs MCP ne doivent jamais le recevoir. Pour les outils distants, l'intent
// est passé à callRemoteTool pour être stocké dans l'ack. Les args originaux
// (avec miaou_intent) restent dans l'objet référencé par api.js → stockés dans
// entry.args via onEnrichLastAck → réinjectés tels quels aux tours suivants.
function callTool(name, args) {
  const parsed = parseToolName(name);
  if (parsed.serverPrefix === 'miaou' || parsed.serverPrefix === '') {
    const intent = args && typeof args.miaou_intent === 'string' ? args.miaou_intent : undefined;
    const cleanArgs = args ? Object.assign({}, args) : {};
    delete cleanArgs.miaou_intent;
    // Repère la position AVANT l'appel : l'intent ne doit enrichir un ack que si
    // CE handler en a poussé un nouveau (length > baseAcks). Un handler qui sort
    // en erreur précoce (souvenir introuvable, id manquant…) ne pousse pas d'ack ;
    // sans ce garde, l'intent se poserait sur l'ack d'un outil ANTÉRIEUR du même
    // tour multi-outils (cf. B5, campagne 2026-07-09).
    const baseAcks = _pendingToolAcks.length;
    const result = callInternalTool(parsed.toolName, cleanArgs);
    // Attache l'intent au dernier ack en attente. La plupart des handlers poussent
    // leur ack de façon synchrone (avant le retour de callInternalTool) ; certains
    // (ex. skills__read) ne le poussent qu'après résolution de leur Promise — dans
    // ce cas on attend cette résolution avant d'enrichir, sinon l'ack n'existe pas
    // encore dans _pendingToolAcks.
    if (intent != null) {
      if (result && typeof result.then === 'function') {
        return result.then(r => { updateLastPendingToolAck({ intent }, baseAcks); return r; });
      }
      updateLastPendingToolAck({ intent }, baseAcks);
    }
    return result;
  }
  const server = getMcpServer(parsed.serverPrefix);   // storage.js
  if (!server || server.enabled === false) {
    return { content: [{ type: 'text', text: 'Serveur MCP inconnu ou désactivé : ' + parsed.serverPrefix }], isError: true };
  }
  const intent = args && typeof args.miaou_intent === 'string' ? args.miaou_intent : undefined;
  const serverArgs = args ? Object.assign({}, args) : {};
  delete serverArgs.miaou_intent;
  return callDocsInflatedRemoteTool(server, parsed.toolName, serverArgs, intent);
}

// ── Hook d'inflation dispatcher (brief A, D6 — moitié client du lot D) ───────
// Table d'état poussé/non-poussé par (conversationId, attId) : évite de
// réinjecter le contenu à chaque appel une fois le serveur docs l'a matérialisé
// en session. En mémoire uniquement (comme _remoteStatus/_remoteTools), pas de
// persistance — un rechargement de page revient à "non poussé", cohérent avec
// la session serveur elle-même éphémère (TTL sweep, brief D D2).
let _attachmentPushState = {};
function _pushStateKey(conversationId, attId) { return (conversationId || '') + '|' + attId; }
function isAttachmentPushed(conversationId, attId) { return !!_attachmentPushState[_pushStateKey(conversationId, attId)]; }
function markAttachmentPushed(conversationId, attId) { _attachmentPushState[_pushStateKey(conversationId, attId)] = true; }
// Appelée par deleteConv (main.js) à la suppression d'une conversation : purge
// les clés (conversationId, *) de la table de push, sinon elles fuient jusqu'au
// rechargement de page.
function clearAttachmentPushState(conversationId) {
  for (const k in _attachmentPushState) {
    if (k.indexOf((conversationId || '') + '|') === 0) delete _attachmentPushState[k];
  }
}

// Table d'état poussé/non-poussé pour les fichiers de bibliothèque d'espace
// (lot Cbis, §4) — même principe que ci-dessus mais scopée (spaceId, fileId)
// plutôt que (conversationId, attId) : un fichier d'espace n'a pas de
// conversation propre. Table distincte (pas de collision de clé possible avec
// _attachmentPushState — formats de ref différents, att-N vs file-<id>).
let _filePushState = {};
function _filePushStateKey(spaceId, fileId) { return (spaceId || '') + '|' + fileId; }
function isFilePushed(spaceId, fileId) { return !!_filePushState[_filePushStateKey(spaceId, fileId)]; }
function markFilePushed(spaceId, fileId) { _filePushState[_filePushStateKey(spaceId, fileId)] = true; }

// Détection de capability SANS nom de serveur en dur (cf. audit lot A) :
// l'outil distant déclare, dans son inputSchema (issu de tools/list, mis en
// cache par connectMcpServer), à la fois `ref` et `content_b64` — signature
// stable du contrat brief D, peu de faux positifs, aucune dépendance à un nom
// de serveur/outil précis (l'utilisateur peut nommer son serveur MCP docs
// comme il veut).
function toolDeclaresAttachmentInflation(server, toolName) {
  const fullName = server.name + '__' + toolName;
  const list = _remoteTools[server.name] || [];
  const def = list.find(t => t.name === fullName);
  const props = def && def.inputSchema && def.inputSchema.properties;
  return !!(props && props.ref && props.content_b64);
}

// Motif conversation-scopé des attachments (att-1, att-2, …) — même forme que
// allocateAttId (resources.js).
const ATTACHMENT_REF_RE = /^att-\d+$/;

// Motif des refs de bibliothèque d'espace (file-<id>, lot Cbis) — même forme
// que LIBRARY_REF_RE (resources.js), dupliqué ici pour ne pas coupler tools.js
// au détail interne du parsing (parseLibraryRef fait le travail réel).
const FILE_REF_RE = /^file-[a-z0-9]+$/;

// Généralisation de toolDeclaresAttachmentInflation (brief H) : balaye TOUT le
// registre _remoteTools (tous serveurs confondus), sans nom de serveur/outil en
// dur — même discipline no-hardcode que le prédicat par-outil. Sert à décider
// SI docsDoctrinePrompt() doit être injecté, indépendamment de quel(s) serveur(s)
// exposent le contrat ref+content_b64 (brief D). Renvoie true dès qu'AU MOINS
// un outil déclare la signature, quel que soit son nom.
function anyToolDeclaresAttachmentInflation() {
  for (const serverName of Object.keys(_remoteTools)) {
    for (const t of _remoteTools[serverName]) {
      const props = t && t.inputSchema && t.inputSchema.properties;
      if (props && props.ref && props.content_b64) return true;
    }
  }
  return false;
}

// Un serveur d'extraction documentaire (brief D/H) expose typiquement PLUSIEURS
// outils qui déclarent tous `ref`+`content_b64` (structure/lecture/recherche —
// ex. mcp_docs list/read/search), car les trois partagent le même mécanisme de
// matérialisation de fichier. Quand c'est le MODÈLE qui choisit l'outil (hook
// §4, toolDeclaresAttachmentInflation), il voit les vrais noms et description
// et choisit lui-même — aucune ambiguïté à lever côté client. Mais un appel
// APPLICATIF direct (D7, ci-dessous) doit choisir tout seul : il lui faut un
// signal qui distingue « renvoie du contenu texte lisible en continu » de
// « renvoie une structure » ou « cherche un motif ». Convention de contrat
// (brief D/H, documentée pour tout futur serveur d'extraction) : l'outil de
// LECTURE déclare en plus, dans son schéma, au moins un paramètre de bornage
// de contenu (`char_start` ou `line_start` — pagination d'un extrait) et
// aucun paramètre `query` obligatoire-par-nature (une recherche). C'est déjà
// le contrat réel de mcp_docs (`read` déclare char_start/line_start, ni
// `list` ni `search` ne les déclarent).
function _declaresContentReadSignature(props) {
  return !!(props && (props.char_start || props.line_start) && !props.query);
}

// Trouve le (server, toolName nu) qui déclare le contrat d'inflation ET le
// signal de lecture de contenu ci-dessus (lot Cbis, D7) — utilisé pour
// l'extraction binaire d'un résumé de fichier, un appel APPLICATIF direct
// (pas un tool_call du modèle, aucune conversation en cours). Même discipline
// no-hardcode que anyToolDeclaresAttachmentInflation : aucun nom de serveur ni
// d'outil en dur, seulement des signatures de schéma. `getMcpServer`
// (storage.js) résout l'objet serveur complet depuis son nom ; un serveur peut
// avoir disparu du registre localStorage entre la connexion et cet appel
// (désactivé/supprimé) → filtré (server null).
function findDocsInflationTool() {
  for (const serverName of Object.keys(_remoteTools)) {
    const server = getMcpServer(serverName);
    if (!server) continue;
    for (const t of _remoteTools[serverName]) {
      const props = t && t.inputSchema && t.inputSchema.properties;
      if (props && props.ref && props.content_b64 && _declaresContentReadSignature(props)) {
        const bareName = t.name.indexOf(serverName + '__') === 0 ? t.name.slice(serverName.length + 2) : t.name;
        return { server, toolName: bareName };
      }
    }
  }
  return null;
}

// Extrait le texte d'un fichier binaire de bibliothèque pour la description D7,
// via le même contrat d'inflation que le hook dispatcher (§4), mais en appel
// APPLICATIF direct (mcpRpc, pas callRemoteTool) : aucun ack ne doit apparaître
// dans un thread (l'ingestion peut survenir hors de toute conversation
// ouverte, ex. upload direct depuis l'écran Space). `session_id` synthétique
// dédié (PAS un id de conversation — l'ingestion n'en a pas forcément une) :
// le serveur mcp_docs traite chaque session comme un répertoire de travail
// isolé, une valeur stable par fichier suffit à ne pas collisionner. Retourne
// le texte extrait (tronqué au cap fourni) ou null si aucun outil ne qualifie
// ou si l'appel échoue (dégradé, jamais bloquant — cf. D7 "pas de queue/retry").
async function extractBinaryFileTextForDescription(record, maxChars) {
  const found = findDocsInflationTool();
  if (!found) return null;
  try {
    const result = await mcpRpc(found.server, 'tools/call', {
      name: found.toolName,
      arguments: {
        ref: libraryRefFromId(record.id),
        content_b64: arrayBufferToBase64(record.data),
        session_id: 'lib-description-' + record.id,
      },
    });
    const content = (result && Array.isArray(result.content)) ? result.content : [];
    const text = content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
    return text ? text.slice(0, maxChars) : null;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] extractBinaryFileTextForDescription:', e && e.message);
    return null;
  }
}

// Résolution polymorphe d'une ref d'inflation (lot Cbis, généralisation §4) :
// att-N (conversation-scopé, cache par attId) OU file-<id> (Space-scopé, cache
// unifié par id de record — herméticité : un fichier d'un autre Space n'est
// PAS résolu, comme s'il n'existait pas localement). Retourne null si la ref
// ne correspond à aucune forme reconnue ou si le record est introuvable/hors
// scope. `pushKey` est la clé de la table d'état poussé adaptée à la forme de
// ref — les deux tables (_attachmentPushState, _filePushState) restent
// distinctes, pas de format de clé partagé entre les deux familles de refs.
function _resolveInflationRef(ref) {
  if (ATTACHMENT_REF_RE.test(ref)) {
    const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
    const record = getCachedRecordByAttId(ref, activeId);
    if (!record) return null;
    return {
      record, sessionId: activeId,
      isPushed: () => isAttachmentPushed(activeId, ref),
      markPushed: () => markAttachmentPushed(activeId, ref),
    };
  }
  if (FILE_REF_RE.test(ref)) {
    const recordId = parseLibraryRef(ref);   // resources.js (chargé avant)
    const record = recordId ? getCachedRecord(recordId) : null;
    const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
    if (!record || record.kind !== 'library' || record.spaceId !== spaceId) return null;
    // session_id reste la conversation courante (le serveur mcp_docs ne connaît
    // que des sessions de conversation) : un fichier d'espace lu depuis une
    // conversation est poussé dans LA session de CETTE conversation — pas de
    // partage de session inter-conversation pour un fichier (dette assumée,
    // le brief H ne le promet pas).
    const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
    return {
      record, sessionId: activeId,
      isPushed: () => isFilePushed(spaceId, recordId),
      markPushed: () => markFilePushed(spaceId, recordId),
    };
  }
  return null;
}

// Point d'accroche D6 : juste avant callRemoteTool. Si l'outil ciblé déclare le
// contrat d'inflation ET que args.ref référence un att-N ou un file-<id> connu
// (lot Cbis, §4 — généralisation, PAS de duplication du hook), injecte SUR LE
// WIRE UNIQUEMENT — les `args` déjà capturés par l'appelant (callTool) pour la
// réinjection cross-turn via onEnrichLastAck restent les args ORIGINAUX, non
// inflés (contexte modèle intact, cf. brief) :
// - session_id (= conversation id courante, quelle que soit la forme de ref)
//   sur CHAQUE appel : le serveur docs en a besoin pour localiser son
//   répertoire de session, et le modèle ne connaît pas l'id de la conversation
//   courante — il ne peut pas le fournir lui-même ;
// - content_b64 seulement au premier appel pour cette ref (table d'état
//   adaptée à la forme de ref, cf. _resolveInflationRef).
// Sur erreur REF_UNKNOWN (contenu pas encore matérialisé côté serveur malgré
// notre état "pushed" — ex. session serveur TTL-expirée), UN seul rejeu avec le
// contenu inliné, puis on marque poussé si ce rejeu réussit.
async function callDocsInflatedRemoteTool(server, toolName, args, intent) {
  const ref = args && typeof args.ref === 'string' ? args.ref : null;
  const capable = ref && toolDeclaresAttachmentInflation(server, toolName);
  if (!capable) return callRemoteTool(server, toolName, args, intent);

  const resolved = _resolveInflationRef(ref);
  if (!resolved) return callRemoteTool(server, toolName, args, intent);   // ref inconnue/hors scope localement, laisser le serveur répondre

  const { record, sessionId, isPushed, markPushed } = resolved;
  const alreadyPushed = isPushed();
  const wireArgs = Object.assign({}, args);
  if (sessionId != null) wireArgs.session_id = sessionId;
  if (!alreadyPushed) wireArgs.content_b64 = arrayBufferToBase64(record.data);
  const result = await callRemoteTool(server, toolName, wireArgs, intent);
  if (!alreadyPushed && !result.isError) { markPushed(); return result; }
  if (alreadyPushed && result.isError && _isRefUnknownError(result)) {
    // Rejeu unique avec contenu inliné (discipline "un seul rejeu", cf.
    // mcpRpc/staleSession). result.ackEntry réutilisé : une seule ligne d'ack
    // pour l'échange complet, l'erreur transitoire s'efface si le rejeu réussit.
    const retryArgs = Object.assign({}, wireArgs, { content_b64: arrayBufferToBase64(record.data) });
    const retryResult = await callRemoteTool(server, toolName, retryArgs, intent, result.ackEntry);
    if (!retryResult.isError) markPushed();
    return retryResult;
  }
  return result;
}

// Lit le code machine porté par callRemoteTool (result.errorCode, depuis
// err.data.code — cf. mcpRpcAttempt/callRemoteTool) plutôt que de chercher une
// sous-chaîne dans le texte d'erreur (fragile, dépendrait de la formulation
// libre du message serveur).
function _isRefUnknownError(result) {
  return !!(result && result.errorCode === REF_UNKNOWN_ERROR_CODE);
}

// Aplatit un résultat MCP en string pour le message role:'tool' renvoyé au modèle.
// Blocs `text` → passés tels quels. Blocs `resource` avec `resource.text` → passés
// tels quels (JSON ou texte structuré renvoyé par le serveur, utile au LLM).
// Blocs non-text sans contenu textuel (image, audio, resource binaire) → MARQUEUR
// NEUTRE (jamais le base64). Cf. D8 : ces blocs sont rendus par l'UI ; le marqueur
// évite qu'un résultat image/resource-only laisse un message `tool` vide, ce qui
// pousserait le modèle à simuler/encoder le contenu. Fonction pure, unit-testable.
function flattenToolResult(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content.map(b => {
    if (b.type === 'text') return b.text;
    if (b.type === 'image')    return '[image rendue dans l\'interface]';
    if (b.type === 'resource') return b.resource && b.resource.text != null ? b.resource.text : '[ressource rendue dans l\'interface]';
    if (b.type === 'audio')    return '[audio rendu dans l\'interface]';
    return '[contenu rendu dans l\'interface]';
  }).filter(s => s != null && s !== '').join('\n');
}

// Indique si un outil est « halting » (seul ask_confirmation l'est, et il reste
// NU — hors registre, donc non préfixé).
function toolIsHalting(name) { return name === 'ask_confirmation'; }

// Dérive le tableau OpenAI tools depuis le registre EXPOSÉ (interne préfixé +
// distant) + ASK_CONFIRMATION_DEF. Les noms d'outils internes y sont désormais
// `miaou__*` : V2 rompt délibérément le byte-identical de V1 (le préfixe sert à
// router interne vs distant sans cas particulier).
// Si intentTracing est activé, `miaou_intent` est ajouté au schema de chaque
// outil (hors ask_confirmation) pour que le modèle décrive son intention.
// Nom sans underscore initial : évite les traitements spéciaux des parsers de
// grammar (Ollama/llama.cpp) qui peuvent interpréter `_xxx` comme un champ privé.
function toolDefinitions() {
  const intentEnabled = !!loadSettings().intentTracing;
  const intentProp = { type: 'string', title: 'Intention', description: 'Phrase courte décrivant le but de l\'appel, pour l\'utilisateur.' };
  const mcpDefs = exposedTools().map(t => {
    const params = intentEnabled
      ? Object.assign({}, t.inputSchema, {
          properties: Object.assign({}, t.inputSchema.properties || {}, { miaou_intent: intentProp }),
        })
      : t.inputSchema;
    return { type: 'function', function: { name: t.name, description: t.description, parameters: params } };
  });
  return mcpDefs.concat([ASK_CONFIRMATION_DEF]);
}

// MEMORY_DOCTRINE n'est PAS redondante avec le schéma tools (qui ne décrit que
// les paramètres, jamais la doctrine de déclenchement). Elle doit donc être
// envoyée indépendamment du toggle includeToolsInSystemPrompt, qui ne contrôle
// que la description redondante schéma/texte des outils eux-mêmes.

function toolsSystemPrompt() {
  const all = exposedTools().map(t => ({ name: t.name, description: t.description }))
    .concat([{ name: ASK_CONFIRMATION_DEF.function.name, description: ASK_CONFIRMATION_DEF.function.description }]);
  const lines = all.map(t => '- ' + t.name + ' : ' + t.description);
  return "Tu disposes des outils suivants. Appelle-les quand ils peuvent t'aider à mieux répondre, " +
         "sinon réponds directement.\n" + lines.join('\n');
}

function intentDoctrinePrompt() {
  return TOOLS.length && loadSettings().intentTracing ? INTENT_DOCTRINE : '';
}

// Doctrine de déclenchement des skills (stage 2). Injectée seulement si AU
// MOINS une skill autotrigger existe (≈ getAutotriggerSkillsMeta non vide) —
// inutile de payer des tokens de doctrine pour une fonctionnalité sans skill
// éligible à l'utiliser. miaou__skills__read est dans TOOLS inconditionnellement
// (stage 1), donc gater sur sa présence comme intentDoctrinePrompt gate sur
// TOOLS.length serait toujours vrai ; on gate ici sur le contenu réel du cache
// skills à la place. Le paragraphe CONFIRMATION est choisi ICI selon la valeur
// COURANTE de confirmSkillAutoUse (réglage localStorage, invisible au modèle) —
// la doctrine envoyée est déjà résolue, jamais une condition que le modèle
// devrait évaluer lui-même.
function skillDoctrinePrompt() {
  if (!getAutotriggerSkillsMeta().length) return '';
  const confirmPart = loadSettings().confirmSkillAutoUse !== false ? SKILL_DOCTRINE_CONFIRM_ON : SKILL_DOCTRINE_CONFIRM_OFF;
  return SKILL_DOCTRINE_BASE + confirmPart + SKILL_DOCTRINE_TAIL;
}
