/* ── tools.js ──────────────────────────────────────────────────────────────
   Registre interne d'outils en forme MCP : { name, description, inputSchema,
   annotations, handler }. La conversion vers le format OpenAI envoyé au modèle
   est produite à l'envoi par toolDefinitions() — un seul sens de traduction.
   ask_confirmation est un primitif halting hors registre MCP (voir ci-dessous).
   ────────────────────────────────────────────────────────────────────────── */

// Contenu d'aide utilisateur servi par l'outil miaou__about : objet
// { slug: markdown } injecté au build depuis src/help.md (parse_help_sections,
// build.py). Même mécanisme que BUILD_CONFIG (storage.js) : marqueur unique en
// position de valeur, forme try/catch pour les sources non buildées (tests
// QuickJS) où __MIAOU_HELP__ est un identifiant nu → ReferenceError → {}.
// L'enum topic de l'outil dérive de Object.keys(HELP_CONTENT) : même source que
// le contenu, pas de drift possible.
const HELP_CONTENT = (function () { try { return __MIAOU_HELP__; } catch (e) { return {}; } })();

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
  "placeholder inventé. N'appelle pas resource__present pour une image sans demande explicite : " +
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
// v2 (dégraissage 2026-07-10) : le workflow image, énoncé trois fois sous trois
// angles dans la v1, est fusionné en UN bullet ; l'interception des binaires
// produits par un outil (enregistrement en ressource + ID + présentation auto)
// n'est plus répétée ici — BINARY_DOCTRINE la couvre déjà, y compris
// l'interdiction resource__present sur image. Les contraintes conservées sont
// inchangées sur le fond : fetch_url obligatoire (snippets ET URLs d'image),
// pas de Markdown pour une ressource déjà présentée, règle des miniatures.
const WEB_DOCTRINE =
  "<ACCES_WEB>\n" +
  "Si des outils te sont fournis pour interroger des moteurs de recherche et/ou " +
  "récupérer des ressources sur le Web :\n" +
  "- utilise-les si c'est pertinent, plutôt que de fabriquer des informations " +
  "récentes\n" +
  "- pour analyser, comparer ou synthétiser des informations issues de résultats " +
  "de recherche, ne te base jamais sur les seuls extraits (snippets) : utilise " +
  "systématiquement l'outil de récupération de contenu (fetch_url) pour lire le " +
  "corps complet des pages\n" +
  "- si l'utilisateur cherche une image ou photo : cherche des pages susceptibles " +
  "d'en contenir, récupère leur contenu, extrais la meilleure candidate. Toute URL " +
  "d'image retenue doit être récupérée avec fetch_url, jamais rendue en simple lien " +
  "ou balise Markdown : l'application enregistre le binaire comme ressource et " +
  "présente l'image à l'utilisateur automatiquement. N'utilise jamais de Markdown " +
  "(type ![alt](url)) pour afficher une ressource déjà présentée ; le Markdown ne " +
  "sert qu'aux MINIATURES — l'URL de la MINIATURE pour l'image affichée, en lien " +
  "vers l'IMAGE originale (PAS la page qui la contient)\n" +
  "</ACCES_WEB>\n\n" +
  "<SANS_ACCES_WEB>\n" +
  "Si aucun outil disponible ne te permet d'accéder au Web, indique-le si c'est " +
  "pertinent, plutôt que de fabriquer des informations récentes.\n" +
  "</SANS_ACCES_WEB>\n";

// Doctrine comportementale : référence à une conversation passée. Toujours
// injectée quand des outils existent (conv__get/conv__list en
// font partie du registre de base) — même statut que BINARY_DOCTRINE. Le
// marqueur [conv_ref:ID] (ou [conv_ref:ID|Titre] si le titre est déjà connu du
// modèle) est résolu côté client en lien cliquable affichant le TITRE, jamais
// l'ID brut ; le titre est optionnel car l'application le retrouve elle-même
// depuis l'index des résumés si absent. Partie de ROOT_SYSTEM_PROMPT.
const CONV_REF_DOCTRINE =
  "Quand tu mentionnes une conversation passée obtenue via conv__get ou " +
  "conv__list (pour que l'utilisateur puisse l'ouvrir), n'écris JAMAIS " +
  "son identifiant technique en clair (pas de guillemets, pas de backticks, pas " +
  "de texte brut du type « conversation abc123 ») : utilise le marqueur " +
  "[conv_ref:ID] ou, si tu connais déjà son titre, [conv_ref:ID|Titre] — " +
  "l'application le remplace automatiquement par un lien affichant le titre.";

// Doctrine de déclenchement des outils mémoire. Partie de ROOT_SYSTEM_PROMPT.
const MEMORY_DOCTRINE =
  "Doctrine de déclenchement pour les outils mémoire :\n\n" +
  "CHEMIN DIRECT — appelle miaou__memory__create immédiatement (sans demander) quand l'utilisateur :\n" +
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
  "Ne JAMAIS affirmer avoir enregistré quelque chose si tu n'as pas appelé miaou__memory__create dans ce même tour.\n\n" +
  "CHEMIN CORRECTION — quand l'utilisateur répond en texte libre à une question ask_confirmation " +
  "(au lieu de cliquer Accepter/Rejeter) et que sa réponse contient une valeur corrigée " +
  "(ex. « non, plutôt un modèle Y »), appelle miaou__memory__create avec la valeur corrigée. " +
  "Ne pas se contenter d'acquitter en texte.\n\n" +
  "MISE À JOUR / SUPPRESSION : si un souvenir existant devient obsolète ou inexact, " +
  "appelle miaou__memory__update (correction in-place) ou miaou__memory__delete (tombstone réversible).\n\n" +
  "Le contenu stocké est toujours à la 3e personne, factuel, sans interprétation.\n" +
  "Ne déclenche PAS pour une instruction valable seulement pour la réponse en cours.";

// Doctrine de déclenchement pour la bibliothèque de fichiers d'espace (lot Cbis,
// D2 path 3). Voie B (décision Cbis-4, revient sur A0.2 après relecture du
// primitif halting existant) : PAS de généralisation du halting — ask_confirmation
// est réutilisé tel quel, comme pour le chemin inféré mémoire ou les skills.
// Le gate repose donc sur la discipline du modèle (cette doctrine), pas sur un
// verrou technique côté handler — même modèle de confiance que MEMORY_DOCTRINE.
// v2 (extraction skill système) : le corps complet (QUAND + COMMENT, indissociables
// ici — c'est une doctrine de déclenchement, pas un mode d'emploi d'API) a été
// déplacé dans la skill système `files-promote` (src/system-skills/files-promote.md,
// cf. docs/skills.md) : usage assez rare pour ne pas justifier sa présence
// permanente dans ROOT_SYSTEM_PROMPT. Ne reste ici qu'un pointeur court.
const FILES_DOCTRINE =
  "Si une pièce jointe du tour courant (att-N) mériterait d'être conservée dans " +
  "la bibliothèque persistante de l'espace, appelle d'abord miaou__skills__read " +
  "avec le slug « files-promote » (skill système, listée dans <miaou_skills_context> " +
  "si présente) : elle donne la doctrine de déclenchement complète (confirmation " +
  "préalable, format d'appel) avant tout appel à miaou__files__promote.";

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

// ── js__eval : compute sandboxé sur un blob client (lot L) ────────────────────
// Paramètres du sandbox (constantes MIAOU dédiées, tranchées à l'audit AL2 sur
// mesure du spike L0). Le cap suit la convention docs__*/fetch_* (20000). La
// mémoire 128 Mo couvre « 32 Mo texte injecté + working set streamé » ; un
// débordement (parse() d'un JSON monstre) meurt en OOM catchable — comportement
// VOULU, pas un bug. Le timeout 5 s laisse respirer une passe sur 32 Mo
// (injection seule ~158 ms au spike ; mais un split('\n') + regex + agrégation
// sur 21 Mo réel a dépassé 2 s en usage — remonté à 5 s, une vraie boucle
// infinie meurt toujours proprement). Référencés UNIQUEMENT dans des corps de
// fonction (runtime), jamais au top-level d'un autre fichier (contrainte de
// portée du test runner, cf. CLAUDE.md).
const JS_EVAL_TIMEOUT_MS = 5000;
const JS_EVAL_MEM_BYTES = 128 * 1024 * 1024;
const JS_EVAL_OUTPUT_CAP = 20000;

// Doctrine js__eval — INCONDITIONNELLE (AL4, décision Julien) : l'outil est natif,
// toujours présent (pas de MCP, pas de toggle), donc dans ROOT_SYSTEM_PROMPT
// comme BINARY_DOCTRINE. Constante STATIQUE (aucune donnée dynamique/modèle) →
// KV-safe (piège 16), byte-stable d'un tour à l'autre.
// v2 (extraction skill système) : SEUL le QUAND (déclencheur du réflexe — cas
// d'usage, fallback docs__read) reste ici, pour ne pas perdre le réflexe
// d'appel (décision explicite : contrairement à FILES_DOCTRINE, on accepte ici
// l'invalidation ponctuelle du KV cache car JS_EVAL_DOCTRINE était la plus
// grosse doctrine du prompt racine). Le COMMENT (signature d'appel, primitives
// énumérées, méthode, contraintes de sortie) est déplacé dans la skill système
// `js-eval` (src/system-skills/js-eval.md, cf. docs/skills.md) : le modèle
// l'appelle via miaou__skills__read avant d'écrire son premier appel.
const JS_EVAL_DOCTRINE =
  "L'outil miaou__js__eval exécute du JavaScript que TU écris dans un bac à sable " +
  "isolé (QuickJS), sur le contenu TEXTUEL d'UN fichier référencé par son handle " +
  "(att-N, file-<id> ou res_<id>), sans jamais charger ce contenu dans ta fenêtre " +
  "de contexte. Sers-t'en pour interroger un gros fichier joint (log, JSON-lines, " +
  "CSV, texte volumineux) — compter, filtrer, agréger, extraire un sous-ensemble — " +
  "quand le lire en entier serait inutile ou impossible. C'est aussi la voie à " +
  "prendre quand docs__read refuse un fichier trop volumineux : n'insiste pas avec " +
  "docs__read, passe directement à miaou__js__eval sur le même handle.\n\n" +
  "Le résultat est ramené en texte : au-delà de " + JS_EVAL_OUTPUT_CAP + " caractères, " +
  "l'appel est REFUSÉ (pas tronqué) — vise toujours une synthèse (compte, top-N, " +
  "échantillon), jamais le fichier brut.\n\n" +
  "Avant ton PREMIER appel à miaou__js__eval dans cette conversation, appelle " +
  "miaou__skills__read avec le slug « js-eval » (skill système, listée dans " +
  "<miaou_skills_context> si présente) : elle donne la signature d'appel exacte, " +
  "les primitives disponibles dans le bac à sable et le détail des contraintes de sortie.";

// Doctrine de déclenchement resource__create / resource__from_result (lot O).
// INCONDITIONNELLE comme JS_EVAL_DOCTRINE (les deux outils sont natifs, toujours
// présents) : posée dès O-1 en couvrant DÉJÀ le réflexe resource__from_result
// (livré en O-2) pour éviter une 2ᵉ invalidation KV cache (piège 16, assumé une
// fois — mémoire project_kv_cache_invalidation_accepted_once). QUAND seulement :
// le QUOI de chaque outil vit dans sa description (pas de duplication de la
// mention js__eval, portée par les deux descriptions d'outils).
const RESOURCE_DOCTRINE =
  "Deux outils permettent de ranger du texte en ressource adressable (res_…), " +
  "exploitable ensuite par miaou__js__eval sans repayer ce texte en tokens : " +
  "miaou__resource__create quand TU as produit ou recomposé un texte volumineux " +
  "que tu voudras interroger plus tard (au lieu de l'écrire en clair dans ta " +
  "réponse) ; miaou__resource__from_result quand un résultat d'outil déjà présent " +
  "plus haut dans la conversation encombre le contexte et que tu veux le garder " +
  "exploitable sans le traîner à chaque tour. N'utilise ni l'un ni l'autre pour " +
  "un texte court que tu peux simplement écrire dans ta réponse.";

// Prompt racine — constante build-time, non modifiable depuis les paramètres.
// Compose les doctrines ; référencé par buildSystemMessage() (main.js).
// v1 — une modification ici invalide le préfixe KV cache sur toutes les conversations.
// (v2, lot L : JS_EVAL_DOCTRINE ajoutée en fin — inconditionnelle, statique.)
// (v3, lot O : RESOURCE_DOCTRINE ajoutée en fin — inconditionnelle, statique.)
const ROOT_SYSTEM_PROMPT = BINARY_DOCTRINE + "\n\n---\n\n" + ATTACHMENT_DOCTRINE + "\n\n---\n\n" +
  WEB_DOCTRINE + "\n\n---\n\n" + CONV_REF_DOCTRINE + "\n\n---\n\n" + MEMORY_DOCTRINE + "\n\n---\n\n" + FILES_DOCTRINE +
  "\n\n---\n\n" + JS_EVAL_DOCTRINE + "\n\n---\n\n" + RESOURCE_DOCTRINE;

// Doctrine de nommage des blocs de code. Injectée INCONDITIONNELLEMENT (comme
// IDENTITY_BLURB) : générer un codeblock n'a aucun rapport avec la présence
// d'outils, donc PAS dans ROOT_SYSTEM_PROMPT. Portée
// directement par systemMessageParts()/buildSystemMessage() (main.js) via out.codeblock.
// v4 — une modification ici invalide le préfixe KV cache sur toutes les conversations,
// même statut que le v1 de ROOT_SYSTEM_PROMPT. (v4 : les règles de syntaxe mermaid-only
// — ex-v2/v3 — sont retirées d'ici et déplacées dans la skill système `mermaid`
// (src/system-skills/mermaid.md, cf. docs/skills.md) : le modèle l'appelle via
// miaou__skills__read avant de générer un diagramme, autotrigger listant sa
// disponibilité dans <miaou_skills_context>. Ne reste ici que la convention
// filename=, générique à tout langage.)
const CODEBLOCK_DOCTRINE =
  "Quand tu génères un bloc de code destiné à être enregistré comme fichier (script, " +
  "config, module…), fournis un nom de fichier sur la ligne d'ouverture de la fence, " +
  "après le langage, séparé par un espace, au format filename=nom.ext (sans espace " +
  "dans le nom, avec son extension). Exemple : ```python filename=fibonacci.py. " +
  "L'application proposera ce nom au téléchargement. Fais-le aussi pour les blocs " +
  "mermaid (ex. ```mermaid filename=flux-auth.mmd) : ce nom sert à nommer les exports " +
  "d'image du diagramme, l'extension est ajustée automatiquement. Pour un extrait " +
  "illustratif court sans vocation de fichier, tu peux l'omettre.\n\n" +
  "Pour générer un diagramme mermaid valide, appelle d'abord miaou__skills__read " +
  "avec le slug « mermaid » (skill système, listée dans <miaou_skills_context> si " +
  "présente) : elle donne les règles de syntaxe à respecter.";

// Blurb d'identité — constante build-time, INCONDITIONNELLE (même statut que
// CODEBLOCK_DOCTRINE) : quelques phrases situant l'application et renvoyant vers
// l'outil miaou__about pour les détails. STATIQUE (piège 16 KV cache) : aucun
// contenu dynamique (date, état, config). Le contenu d'aide lourd vit derrière
// l'outil, pas ici. Portée par systemMessageParts()/buildSystemMessage() (main.js)
// via out.identity, placée EN TÊTE du join. v1 — une modification invalide le
// préfixe KV cache sur toutes les conversations (même statut que ROOT_SYSTEM_PROMPT).
const IDENTITY_BLURB =
  "Tu opères dans MIAOU, un client de chat web pour dialoguer avec un modèle de " +
  "langage via une API compatible OpenAI. MIAOU tourne entièrement dans le " +
  "navigateur de l'utilisateur : conversations, souvenirs, skills, espaces et " +
  "fichiers sont stockés localement. Il offre des espaces de travail étanches, " +
  "une mémoire (souvenirs et résumés), des pièces jointes, des skills, l'agrégation " +
  "d'outils MCP distants, et des exports Markdown/HTML.\n" +
  "Quand l'utilisateur pose une question sur MIAOU lui-même — comment joindre un " +
  "fichier, ce que sont les espaces, où sont stockées ses données, etc. — appelle " +
  "l'outil miaou__about (paramètre topic) plutôt que de deviner : il sert une aide " +
  "utilisateur fiable, section par section.";

// Doctrine de déclenchement des skills (stage 2 — autotrigger). Injectée
// conditionnellement (cf. skillDoctrinePrompt) quand des outils skill sont
// présents, comme INTENT_DOCTRINE. PAS dans ROOT_SYSTEM_PROMPT (constante
// build-time inconditionnelle) : ce bloc dépend de la disponibilité des outils
// skill au runtime, même mécanisme que intentDoctrinePrompt()/INTENT_DOCTRINE.
const SKILL_DOCTRINE_BASE =
  "Doctrine de déclenchement pour les skills :\n\n" +
  "Si un bloc <miaou_skills_context> est présent dans le contexte, il liste des " +
  "skills que l'utilisateur a choisi de rendre disponibles pour un usage proactif " +
  "— ce ne sont PAS des skills que tu es obligé d'utiliser, seulement des fragments " +
  "d'instructions pertinents si la situation s'y prête.\n\n" +
  "Pour utiliser une skill listée (qu'elle vienne de <miaou_skills_context> ou d'un " +
  "appel préalable à miaou__skills__list), appelle miaou__skills__read avec son slug.\n\n";

// PAS de variante CONFIRM_ON : ask_confirmation après skills__read casse le
// mécanisme fork B (cf. skillDoctrinePrompt) — jamais réintroduire cette
// branche sans revoir onHalt (api.js/main.js) pour préserver le contenu lu.
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

// Sortie en échec d'un outil NATIF : pousse un ack `tool_failed` (rouge, cf.
// ackIsError) ET retourne le message, pour que le site d'appel reste une seule
// ligne — `return toolFail('memory__update', 'Souvenir introuvable.')`.
//
// Le retour est la chaîne NUE, inchangée : le tool result envoyé au modèle reste
// byte-identique à ce qu'il était avant l'introduction des acks d'échec (aucun
// effet sur le comportement du modèle, ni sur le KV cache). L'ack est une trace
// PUREMENT UI — le contenu d'un ack n'entre jamais dans le contexte.
//
// Historique : les handlers faisaient `return 'Souvenir introuvable.'` sans
// pousser d'ack. Le modèle recevait bien l'erreur, mais l'appel n'apparaissait
// NULLE PART dans le fil (pas un ack blanc : aucun ack). L'utilisateur ne voyait
// donc pas passer un memory__update qui avait raté sa cible.
//
// `toolName` est le nom NU du handler (`memory__update`), comme déclaré dans TOOLS ;
// le préfixe `miaou__` est ajouté ICI, une seule fois, pour que l'ack porte le nom
// canonique que le modèle a réellement appelé (cohérent avec mcp_call qui affiche
// `server__tool`) sans dupliquer le préfixe sur chaque site d'appel.
function toolFail(toolName, message) {
  _pendingToolAcks.push({ kind: 'tool_failed', name: 'miaou__' + toolName, message, error: true });
  return message;
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

// Validation pure des arguments de resource__create (lot O) — même motif que
// validateFilesPromoteArgs : extraite pour rester testable QuickJS malgré le
// handler async. Retourne un message d'erreur si invalide, '' sinon.
function validateResourceCreateArgs(args) {
  const content = String((args && args.content) || '');
  if (!content) return 'Contenu vide.';
  return '';
}

// Validation pure des arguments de resource__from_result (lot O-2) — schéma
// pleinement contraint (pas de conditionnalité hors-schéma, tout le gain des
// deux outils séparés) : `ref` (id call:…) ET `description` (résumé modèle)
// requis, sans exclusivité à gérer. Testable QuickJS malgré le handler async.
function validateResourceFromResultArgs(args) {
  const ref = String((args && args.ref) || '').trim();
  const description = String((args && args.description) || '').trim();
  if (!ref || !description) return 'Paramètres invalides (ref et description requis).';
  return '';
}

// Détecte qu'un `result` d'ack est DÉJÀ un handle inline model-side (sortie de
// formatInlineHandleForModel) — idempotence de resource__from_result : convertir
// deux fois un même tool result est un refus propre, pas une double
// matérialisation. Marqueur stable de formatInlineHandleForModel.
function isInlineHandleResult(result) {
  return /texte adressable par js__eval \(blob=/.test(String(result || ''));
}

// ── Registre MCP interne ─────────────────────────────────────────────────────
// Forme canonique : { name, description, inputSchema (JSON Schema), annotations,
// handler }. ask_confirmation est exclu (primitif halting, voir ASK_CONFIRMATION_DEF).
const TOOLS = [
  {
    name: 'conv__get',
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
      // Herméticité (brief D2, piège 18) : les DEUX sorties ci-dessous partagent le
      // même message ET le même ack — l'absence d'oracle vise le MODÈLE, et un ack
      // `tool_failed` identique dans les deux cas n'en crée aucun. (L'utilisateur,
      // lui, doit bien voir que le modèle a tenté la lecture : c'est le but.)
      if (!entry || entry.suppressed) return toolFail('conv__get', 'Conversation introuvable ou souvenir supprimé.');
      // activeSpaceId est une global de main.js, accès défensif car tools.js est
      // aussi évalué seul (test runner). Un résumé orphelin (conversation supprimée,
      // index conservé) n'a pas de Space propre : traité comme default Space.
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      const conv = loadConversation(args.id);   // storage.js — un seul chargement (herméticité ET contenu)
      const convSpace = conv ? (conv.spaceId || DEFAULT_SPACE_ID) : DEFAULT_SPACE_ID;
      if (convSpace !== spaceId) return toolFail('conv__get', 'Conversation introuvable ou souvenir supprimé.');
      const light = summaryLight(entry);
      _pendingToolAcks.push({ kind: 'conversation_read', title: light.title, convId: args.id });
      if (!args.with_contents) return JSON.stringify(light);
      if (!conv) return JSON.stringify(light);   // résumé présent mais conversation absente : cas limite
      return JSON.stringify(Object.assign({}, light, { messages: conv.messages ?? conv }));
    },
  },
  {
    name: 'conv__list',
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
        if (Number.isNaN(sinceMs)) return toolFail('conv__list', 'Date "since" invalide (attendu ISO 8601).');
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
    name: 'memory__create',
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
      if (!args.content || !args.content.trim()) return toolFail('memory__create', 'Contenu vide — souvenir ignoré.');
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
    name: 'memory__update',
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
      if (!args.id || !args.content || !args.content.trim()) return toolFail('memory__update', 'Paramètres invalides.');
      const content = args.content.trim();
      const existing = loadMemories().find(e => e.id === args.id);   // avant écrasement
      // Herméticité (brief D3, extension D2) : hors du Space actif (ou scope
      // profile) = « introuvable », même posture sans-oracle que conv__get.
      // Une entrée sans scope (pré-migration) vaut default Space.
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      if (!existing || (existing.scope || DEFAULT_SPACE_ID) !== spaceId) return toolFail('memory__update', 'Souvenir introuvable.');
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
    name: 'resource__present',
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
      if (!id) return toolFail('resource__present', 'Identifiant manquant.');
      // getCachedRecord et makeResourcePresentBlock sont dans resources.js (chargé avant).
      const record = getCachedRecord(id);
      if (!record) return toolFail('resource__present', 'Ressource introuvable (identifiant inconnu ou non disponible en session).');
      // Le rendu du bloc est délégué à placeToolAck (live et reload via même chemin).
      _pendingToolAcks.push({ kind: 'resource_presented', id, resourceName: record.name, mime: record.mime });
      return 'Ressource présentée à l\'utilisateur.';
    },
  },
  {
    name: 'recall_attachment',
    // Description v2 (dégraissage 2026-07-10) : le QUAND appeler (image visible
    // au tour courant = jamais, tours suivants = oui, texte inline = jamais) vit
    // dans ATTACHMENT_DOCTRINE, toujours injectée — la description ne garde que
    // le QUOI par type de contenu. La mention « tu la revois réellement » est
    // conservée : patch comportemental payé (probe A2), pas du verbiage.
    description:
      "Ramène le contenu d'une pièce jointe de l'utilisateur (ref att-N, vu dans un " +
      "descripteur [attachment att-N: ...] du fil) dans ton contexte pour l'examiner de " +
      "nouveau. Image : ré-injectée juste après le résultat de l'outil (tu la revois " +
      "réellement) et ré-affichée à l'utilisateur. Texte : contenu en clair. Binaire : " +
      "descripteur seul.",
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
      if (!ref) return toolFail('recall_attachment', 'Identifiant manquant.');
      // getCachedRecordByAttId est dans resources.js (chargé avant). currentConvId
      // est une global de main.js — accès défensif (tools.js évalué seul par le
      // test runner), même pattern que conv__list ci-dessus.
      const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
      const record = getCachedRecordByAttId(ref, activeId);
      if (!record) return toolFail('recall_attachment', 'Pièce jointe introuvable (identifiant inconnu ou non disponible en session).');
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
      // évalué seul par le test runner), même pattern que conv__get.
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
      if (!recordId) return toolFail('files__read', 'Fichier introuvable.');
      const record = getCachedRecord(recordId);   // resources.js — cache session unifié
      // Foreign-Space ou id inconnu → même posture no-oracle que conv__get/mémoires
      // (message ET ack identiques dans les deux sorties : aucun oracle créé).
      if (!record || record.kind !== 'library' || record.spaceId !== spaceId) return toolFail('files__read', 'Fichier introuvable.');
      _pendingToolAcks.push({ kind: 'files_read', id: args.id, resourceName: record.name, mime: record.mime });
      if (record.mime && record.mime.startsWith('image/')) {
        const model = typeof activeModel === 'function' ? activeModel() : '';
        const server = typeof activeApiServer === 'function' ? activeApiServer() : null;
        if (!serverModelVisionEnabled(server, model)) {
          // Seul échec de ce fichier qui survient APRÈS le push de l'ack files_read
          // (le fichier a bien été trouvé et lu — c'est sa PRÉSENTATION au modèle qui
          // échoue). Pas de toolFail ici : il pousserait un SECOND ack, et le fil
          // afficherait « fichier lu » suivi de « échec » pour un unique appel. On
          // marque l'ack déjà poussé, qui vire au rouge (ackIsError) en gardant sa
          // trace (nom du fichier, mime).
          updateLastPendingToolAck({ error: true });
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
    // Description v2 (dégraissage 2026-07-10) : le protocole de consentement
    // (question ask_confirmation littérale, mêmes ref/description à l'appel,
    // jamais d'appel direct) vit dans FILES_DOCTRINE, toujours injectée — la
    // description garde le QUOI + un rappel court du gate.
    description:
      "Copie une pièce jointe du tour courant (ref att-N) dans la bibliothèque " +
      "persistante de l'espace actif, avec une description de ce que le fichier EST " +
      "(pas un résumé de son contenu). Consentement préalable de l'utilisateur REQUIS " +
      "via ask_confirmation (voir doctrine bibliothèque).",
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
      // validateFilesPromoteArgs reste PURE (testée à part) : elle renvoie le
      // message, c'est le site de sortie qui pousse l'ack.
      const invalid = validateFilesPromoteArgs(args);
      if (invalid) return toolFail('files__promote', invalid);
      const ref = String(args.ref || '');
      const description = String(args.description || '').trim();
      const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
      const record = getCachedRecordByAttId(ref, activeId);   // resources.js — att-N du tour courant
      if (!record) return toolFail('files__promote', 'Fichier introuvable.');   // ref inconnue/périmée, même posture que files__read
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      const name = args.name ? String(args.name).trim() : record.name;
      const stored = await storeLibraryFile(   // resources.js — copie, l'attachment d'origine reste intact
        spaceId, record.mime, name, record.data, record.class, activeId, description, Date.now(), Math.random
      );
      if (!stored) return toolFail('files__promote', 'Échec de l\'enregistrement dans la bibliothèque.');
      _pendingToolAcks.push({ kind: 'file_promote', id: libraryRefFromId(stored.id), resourceName: stored.name });
      return 'Fichier ajouté à la bibliothèque de l\'espace. Identifiant : ' + libraryRefFromId(stored.id);
    },
  },
  {
    name: 'resource__create',
    // Description v1 (lot O) : QUOI (ranger un texte fourni en ressource res_…)
    // + l'aval js__eval (AUDIT-O §7bis) pour guider le modèle sans dupliquer le
    // QUAND, porté par RESOURCE_DOCTRINE (ROOT_SYSTEM_PROMPT). Mode inline
    // UNIQUEMENT — la conversion d'un tool result passé est un outil séparé
    // (resource__from_result).
    description:
      "Range un texte que TU fournis directement (contenu déjà en main : composé, " +
      "recomposé, ou recopié) en ressource res_… adressable, sans l'afficher tel quel " +
      "dans ta réponse. Le handle renvoyé se passe ensuite à miaou__js__eval(handle, code) " +
      "pour compter/filtrer/agréger/extraire sans repayer ce texte en tokens à chaque tour. " +
      "N'accepte PAS de référence à un résultat d'outil passé — pour convertir un tool " +
      "result déjà dans l'historique, utilise miaou__resource__from_result.",
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Texte à matérialiser en ressource' },
        name: { type: 'string', description: 'Nom optionnel du record (défaut : "resource")' },
        mime: { type: 'string', description: 'Type MIME optionnel (défaut : "text/plain")' },
      },
      required: ['content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args) => {
      // validateResourceCreateArgs reste PURE (testée à part) : elle renvoie le
      // message, c'est le site de sortie qui pousse l'ack (cf. toolFail).
      const invalid = validateResourceCreateArgs(args);
      if (invalid) return toolFail('resource__create', invalid);
      const content = String(args.content || '');
      const mime = args.mime ? String(args.mime).trim() : 'text/plain';
      const name = args.name ? String(args.name).trim() : 'resource';
      const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
      const id = await _storeBlock(mime, name, utf8Encode(content), 'inline', activeId, Date.now(), Math.random);
      if (!id) return toolFail('resource__create', 'Échec de stockage.');
      // JAMAIS _makeResourceRef ici (AUDIT-O §5) : un [resource_ref:…] vers un
      // record 'inline' ré-inlinerait tout le contenu au tour suivant. L'ack
      // resource_stored est déjà poussé par _storeBlock, rien à pousser ici.
      return formatInlineHandleForModel(id, mime, getCachedRecord(id));
    },
  },
  {
    name: 'resource__from_result',
    // Description v1 (lot O-2) : QUOI (convertir un tool result passé en
    // ressource res_… + ALLÉGER le contexte, le gros contenu quitte l'historique)
    // + l'aval js__eval mutualisé avec resource__create. Le QUAND est en doctrine
    // (RESOURCE_DOCTRINE). Adressage par id call:… exposé sur chaque tool result
    // réinjecté (expandThread, marqueur [call:…]).
    description:
      "Convertit un RÉSULTAT d'outil déjà présent plus haut dans la conversation " +
      "(ciblé par son id call:… affiché en tête du résultat) en ressource res_… " +
      "adressable, ET allège le contexte : le gros contenu quitte l'historique, " +
      "remplacé par un handle compact + ta description. Le handle se passe ensuite à " +
      "miaou__js__eval(handle, code) pour compter/filtrer/agréger/extraire sans " +
      "repayer ce texte en tokens. Pour ranger un texte que TU fournis directement " +
      "(pas un résultat d'outil passé), utilise miaou__resource__create.",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Id call:… du résultat d\'outil à convertir (affiché en tête de ce résultat)' },
        description: { type: 'string', description: 'Court résumé de ce que contient le résultat converti (tu l\'as lu) — remplace le contenu dans l\'historique' },
        name: { type: 'string', description: 'Nom optionnel du record (défaut : "resource")' },
      },
      required: ['ref', 'description'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args) => {
      const invalid = validateResourceFromResultArgs(args);
      if (invalid) return toolFail('resource__from_result', invalid);
      const ref = String(args.ref || '').trim();
      const description = String(args.description || '').trim();
      const name = args.name ? String(args.name).trim() : 'resource';
      const thread = typeof currentThread !== 'undefined' ? currentThread : [];
      // Résolution + gel de la cible AVANT tout await (réentrance, mémoire
      // await_reentrancy_guard) : findAckByCallId partage la dérivation d'id
      // avec expandThread (source unique, jamais dupliquée).
      const hit = findAckByCallId(thread, ref);
      if (!hit) return toolFail('resource__from_result', 'Résultat introuvable.');
      const targetAck = hit.ack;
      if (isInlineHandleResult(targetAck.result)) {
        return toolFail('resource__from_result', 'Ce résultat est déjà une ressource.');
      }
      const text = targetAck.result != null ? String(targetAck.result) : '';
      if (!text) return toolFail('resource__from_result', 'Résultat vide, rien à convertir.');
      const mime = 'text/plain';
      const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
      const id = await _storeBlock(mime, name, utf8Encode(text), 'inline', activeId, Date.now(), Math.random);
      if (!id) return toolFail('resource__from_result', 'Échec de stockage.');
      // JAMAIS _makeResourceRef (AUDIT-O §5) — record 'inline', un ref
      // ré-inlinerait tout au tour suivant. Handle compact + description modèle.
      const handle = formatInlineHandleForModel(id, mime, getCachedRecord(id)) + ' — ' + description;
      // APRÈS l'await : re-vérifier que la cible existe toujours (suppression/
      // navigation concurrente). Absente → la ressource reste valide, on renvoie
      // le handle sans réécrire (dégradation propre, PLAN-O étape 5).
      const still = findAckByCallId(typeof currentThread !== 'undefined' ? currentThread : [], ref);
      if (still && !isInlineHandleResult(still.ack.result)) {
        // SEUL champ muté : le `result` de l'ack passé (payload modèle). Le rendu
        // UI de l'ack d'origine ne lit pas `result` → inchangé. persistCurrent
        // durabilise et émet conv-updated post-commit (piège 24, via saveConversation).
        still.ack.result = handle;
        if (typeof persistCurrent === 'function') persistCurrent();
      }
      // L'ack resource_stored est déjà poussé par _storeBlock ; rien à pousser.
      return handle;
    },
  },
  {
    name: 'memory__delete',
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
      if (!args.id) return toolFail('memory__delete', 'Identifiant manquant.');
      const existing = loadMemories().find(e => e.id === args.id);
      const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
      if (!existing || (existing.scope || DEFAULT_SPACE_ID) !== spaceId) return toolFail('memory__delete', 'Souvenir introuvable.');
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
    // miaou__skills__read : renvoie le contenu Markdown complet d'une skill activée.
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
      if (!slug) return toolFail('skills__read', 'Slug manquant.');
      const meta = getSkillMeta(slug);                 // cache mémoire (synchrone)
      if (!meta) return toolFail('skills__read', 'Skill introuvable : ' + slug);
      if (meta.enabled === false) return toolFail('skills__read', 'Skill désactivée : ' + slug);
      // Activée : fetch IDB async. L'ack est poussé une fois le contenu obtenu.
      return getSkillContent(slug).then(content => {
        if (content == null) return toolFail('skills__read', 'Contenu indisponible pour la skill : ' + slug);
        // Nom d'affichage de la skill stocké en `title` (pas `name` : onEnrichLastAck
        // écrase `name` avec le nom canonique de l'outil pour la réinjection cross-turn).
        _pendingToolAcks.push({ kind: 'skill_read', slug, title: meta.name });
        return content;
      });
    },
  },
  {
    // miaou__skills__write : crée ou modifie une skill. Garde-fou : modifier un
    // slug EXISTANT exige overwrite:true explicite (sinon erreur claire, aucune
    // écriture) — évite qu'un modèle écrase une skill par un slug déjà pris sans
    // s'en rendre compte. Merge partiel en modification : les champs omis
    // (name/description/content) conservent la valeur existante ; `autotrigger`
    // n'est PAS exposé au modèle (réservé au toggle utilisateur du drawer,
    // cf. docs/skills.md stage 2) et est toujours préservé tel quel depuis
    // l'enregistrement existant (false par défaut en création, comme putSkill).
    // Contrôles slug/existence = cache mémoire (synchrone) ; lecture de
    // l'existant + écriture = IDB (async, pattern skills__read/putSkill).
    name: 'skills__write',
    description:
      "Crée ou modifie une skill (fragment d'instructions Markdown réutilisable). " +
      "Si le slug existe déjà, passe overwrite:true pour la modifier (sinon erreur, " +
      "aucune écriture) ; les champs omis conservent leur valeur actuelle. Une " +
      "nouvelle skill est activée par défaut.",
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Identifiant de la skill (charset lettres/chiffres/tiret/underscore, sans espace)' },
        name: { type: 'string', description: 'Nom affiché de la skill' },
        description: { type: 'string', description: 'Description courte de la skill' },
        content: { type: 'string', description: 'Corps Markdown complet de la skill' },
        enabled: { type: 'boolean', description: 'Skill activée (défaut : true à la création, inchangé en modification)' },
        overwrite: { type: 'boolean', description: 'Requis (true) pour modifier une skill dont le slug existe déjà' },
      },
      required: ['slug'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: (args) => {
      const slug = String((args && args.slug) || '').trim();
      const existingMeta = slug ? getSkillMeta(slug) : null;
      if (existingMeta && existingMeta.system === true) {
        return toolFail('skills__write', 'Skill système : « ' + slug + ' » n\'est pas modifiable par cet outil.');
      }
      // validateSkillSlug reste PURE (testée à part) : elle renvoie le message,
      // c'est le site de sortie qui pousse l'ack.
      const err = validateSkillSlug(slug, existingMeta ? [] : listAllSkillsCache().map(s => s.slug));
      if (err) return toolFail('skills__write', err);
      if (existingMeta && args.overwrite !== true) {
        return toolFail('skills__write', 'Une skill « ' + slug + ' » existe déjà. Passe overwrite:true pour la modifier.');
      }
      const created = !existingMeta;
      const finish = (base) => {
        const rec = {
          slug,
          name: args.name != null ? String(args.name) : (base ? base.name : ''),
          description: args.description != null ? String(args.description) : (base ? base.description : ''),
          content: args.content != null ? String(args.content) : (base ? base.content : ''),
          enabled: args.enabled != null ? args.enabled === true : (base ? base.enabled !== false : true),
          autotrigger: base ? base.autotrigger === true : false,
        };
        return putSkill(rec).then(() => {
          _pendingToolAcks.push({ kind: 'skill_write', slug, title: rec.name, created });
          return (created ? 'Skill créée : ' : 'Skill modifiée : ') + slug;
        });
      };
      return created ? finish(null) : getSkillRecord(slug).then(finish);
    },
  },
  {
    // Aide utilisateur servie à la demande depuis HELP_CONTENT (contenu build-time
    // injecté depuis src/help.md). Handler SYNCHRONE (const en mémoire) → testable
    // QuickJS. L'enum `topic` dérive de Object.keys(HELP_CONTENT) : même source que
    // le contenu, pas de drift. `required` vide : topic absent/inconnu → overview.
    // Sous QuickJS HELP_CONTENT vaut {} → enum vide (assumé par les tests).
    name: 'about',
    description:
      "Sert l'aide utilisateur de MIAOU (l'application), section par section. Appelle " +
      "cet outil quand l'utilisateur demande comment faire quelque chose dans MIAOU, " +
      "ce qu'est une fonctionnalité (espaces, pièces jointes, mémoire, skills, MCP, " +
      "exports…), ou où sont ses données — plutôt que de deviner. Passe un topic ; " +
      "sans topic, tu obtiens la vue d'ensemble.",
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Sujet d\'aide à consulter (défaut : overview).',
          enum: Object.keys(HELP_CONTENT),
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const requested = String((args && args.topic) || '').trim();
      // topic inconnu/absent → overview (défaut). Fallback string vide si même
      // overview manque (HELP_CONTENT={} sous QuickJS non stubé).
      const topic = HELP_CONTENT[requested] != null ? requested : 'overview';
      const content = HELP_CONTENT[topic];
      _pendingToolAcks.push({ kind: 'about_read', topic });
      return content != null ? content : 'Aide indisponible.';
    },
  },
  {
    // miaou__js__eval (lot L) : exécute du JS écrit par le modèle dans un bac à
    // sable QuickJS-WASM sur le contenu TEXTUEL d'un blob client référencé par
    // handle (att-N/file-<id>/res_<id>), sans jamais charger les octets bruts en
    // contexte. Handler ASYNC (lazy-load engine + exécution VM) → renvoie une
    // Promise<string> ; callInternalTool la mappe (précédent skills__read). Les
    // contrôles d'args (handle/code manquants) sont synchrones ; la résolution de
    // handle et l'exécution sont async. L'ack est poussé APRÈS résolution (le
    // résultat — ok/refus/erreur — n'est connu qu'à ce moment), pattern
    // skills__read. Herméticité (piège 18) : resolveHandleRecord lit le cache
    // session, un handle hors-scope → null → « handle introuvable » (pas d'oracle).
    name: 'js__eval',
    description:
      "Exécute du JavaScript (que tu écris) dans un bac à sable isolé sur le contenu " +
      "TEXTUEL d'UN fichier référencé par son handle (att-N, file-<id> ou res_<id>), " +
      "sans charger ce contenu dans ton contexte. Sers-t'en pour interroger un gros " +
      "fichier (log, JSON-lines, CSV, texte) — compter, filtrer, agréger, extraire. " +
      "Primitives disponibles dans le bac à sable : text(), lines(), jsonLines(), " +
      "parse() (voir la doctrine COMPUTE_SANDBOX). La dernière valeur évaluée du code " +
      "est renvoyée (sérialisée en JSON si ce n'est pas une string). Sortie trop " +
      "grosse → refus explicite (réécris pour synthétiser). N'inclus jamais le " +
      "contenu du fichier dans le code : il vient des primitives. Lecture OBLIGATOIRE " +
      "de la skill 'js-eval' avant utilisation dans une conversation.",
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Handle du fichier : att-N, file-<id> ou res_<id> (jamais son contenu ni un chemin)' },
        code: { type: 'string', description: 'Code JavaScript à exécuter ; sa dernière valeur évaluée est le résultat renvoyé' },
      },
      required: ['handle', 'code'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },   // pur compute, aucune écriture d'état
    handler: (args) => {
      const handle = String((args && args.handle) || '').trim();
      const code = args && args.code != null ? String(args.code) : '';
      // Sorties PRÉCOCES (rien n'a été exécuté) → ack tool_failed. Les échecs de
      // l'exécution elle-même (cap, throw guest) gardent leur ack js_eval propre,
      // porteur du code et de ok:false — également rouge (ackIsError), mais avec
      // sa trace complète. Les deux ne se cumulent jamais : une sortie précoce
      // n'atteint pas le .then.
      if (!handle) return toolFail('js__eval', 'Handle manquant.');
      if (!code) return toolFail('js__eval', 'Code manquant.');
      if (classifyHandleRef(handle) === null) {
        return toolFail('js__eval', 'Handle invalide : ' + handle + ' (attendu att-N, file-<id> ou res_<id>).');
      }
      const record = resolveHandleRecord(handle);   // impur : cache session (herméticité)
      if (!record || !record.data) return toolFail('js__eval', 'Handle introuvable : ' + handle + '.');
      const text = utf8Decode(record.data);   // resources.js — AL3 : contenu textuel
      return runInQuickJs(text, code).then(r => {   // ui.js/tools.js — async, lazy-load + VM
        if (r.ok) {
          _pendingToolAcks.push({ kind: 'js_eval', handle, ok: true, outLen: r.output.length, code });
          return r.output;
        }
        if (r.reason === 'cap') {
          _pendingToolAcks.push({ kind: 'js_eval', handle, ok: false, outLen: r.len, code });
          // REFUS explicite (§3), PAS un isError : result texte cadré pour que le
          // modèle re-cible dans le même tour (borné par MAX_TOURS). isError
          // pourrait couper la boucle.
          return 'Sortie refusée : ' + r.len + ' caractères dépassent la limite de ' +
            r.cap + '. Réécris ton code pour renvoyer une synthèse plus petite ' +
            '(un compte, un top-N, un échantillon), jamais le fichier brut.';
        }
        // reason === 'error' : throw guest / timeout / OOM. result texte (pas
        // isError) pour laisser le modèle corriger son code au tour suivant.
        _pendingToolAcks.push({ kind: 'js_eval', handle, ok: false, code });
        return 'Erreur d\'exécution dans le bac à sable : ' + r.message +
          '. Vérifie ton code (syntaxe, borne mémoire/temps).';
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
    // Description v2 (dégraissage 2026-07-10) : la description v1 était
    // mémoire-centrée (gabarit « Tu veux que je retienne… » dupliqué de
    // MEMORY_DOCTRINE) alors que l'outil est générique — les doctrines mémoire,
    // bibliothèque et skills prescrivent chacune leur gabarit de question. La
    // description garde le QUOI générique + la sémantique halting.
    description:
      "Demande confirmation à l'utilisateur avant d'agir, quand une doctrine l'exige " +
      "(fait inféré à retenir, ajout à la bibliothèque, usage d'une skill…). La question " +
      "doit inclure littéralement le contenu concerné. Outil bloquant : la génération " +
      "s'arrête après l'appel, tu reprendras au tour suivant selon la réponse. N'agis " +
      "jamais sans la confirmation, et n'affirme jamais ici avoir déjà agi.",
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
//
// Les échecs MÉTIER (« Souvenir introuvable ») sont poussés par les handlers via
// toolFail et ne sont PAS des isError : le modèle doit pouvoir se corriger sans
// que la boucle d'outils soit coupée. Les trois isError ci-dessous sont les échecs
// TECHNIQUES (outil inconnu, throw d'un handler — un bug) : eux aussi poussent
// désormais un ack `tool_failed`, sinon un plantage JS ne laissait AUCUNE trace à
// l'écran (le plus anormal était le plus invisible). toolFail renvoie le message,
// ce qui évite de le dupliquer entre l'ack et le tool result.
function callInternalTool(toolName, args) {
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) return { content: [{ type: 'text', text: toolFail(toolName, 'Outil inconnu : ' + toolName) }], isError: true };
  try {
    const text = tool.handler(args || {});
    // Handler ASYNC (ex. skills__read lit le contenu en IDB) : il renvoie une
    // Promise<string>. On la mappe vers la forme MCP. Les handlers synchrones
    // (tous les autres) restent synchrones → branche interne testable sans async.
    if (text && typeof text.then === 'function') {
      return text.then(
        t => ({ content: [{ type: 'text', text: String(t) }], isError: false }),
        e => ({ content: [{ type: 'text', text: toolFail(toolName, 'Erreur outil ' + toolName + ' : ' + ((e && e.message) || e)) }], isError: true })
      );
    }
    return { content: [{ type: 'text', text: String(text) }], isError: false };
  } catch (e) {
    return { content: [{ type: 'text', text: toolFail(toolName, 'Erreur outil ' + toolName + ' : ' + e.message) }], isError: true };
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
  // Le REGISTRE tranche, pas la forme du nom : depuis que des outils internes
  // portent un sous-namespace (`memory__`, `conv__`, `resource__`, lot P), le
  // split de parseToolName sur le PREMIER `__` prendrait `memory` pour un préfixe
  // serveur MCP et `memory__update` serait routé vers un serveur inexistant.
  // resolveInternalToolName (utils.js, pur) rend le nom canonique interne si le
  // nom — nu ou préfixé `miaou__` — existe dans TOOLS, sinon null → vrai serveur.
  const internalName = resolveInternalToolName(name, TOOLS);
  if (internalName != null) {
    const intent = args && typeof args.miaou_intent === 'string' ? args.miaou_intent : undefined;
    const cleanArgs = args ? Object.assign({}, args) : {};
    delete cleanArgs.miaou_intent;
    // Repère la position AVANT l'appel : l'intent ne doit enrichir un ack que si
    // CE handler en a poussé un nouveau (length > baseAcks). Un handler qui sort
    // en erreur précoce (souvenir introuvable, id manquant…) ne pousse pas d'ack ;
    // sans ce garde, l'intent se poserait sur l'ack d'un outil ANTÉRIEUR du même
    // tour multi-outils (cf. B5, campagne 2026-07-09).
    const baseAcks = _pendingToolAcks.length;
    const result = callInternalTool(internalName, cleanArgs);
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
  // Préfixe `miaou`/absent mais nom non résolu en interne → outil interne INCONNU
  // (pas un serveur MCP nommé `miaou` ou `''`) : garde la sémantique d'origine
  // (« Outil inconnu ») + son ack d'échec, plutôt qu'un trompeur « Serveur MCP … ».
  if (parsed.serverPrefix === 'miaou' || parsed.serverPrefix === '') {
    return callInternalTool(parsed.toolName, args || {});
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

// Table d'état poussé/non-poussé pour les ressources de session (res_<id>, lot K,
// §4.2) — scopée (conversationId, resId), même forme que _attachmentPushState
// (un res_… porte un conversationId comme un attachment). Table DISTINCTE des deux
// autres (doctrine « tables distinctes, formats de ref différents » ci-dessus) :
// pas de collision de clé possible (att-N vs file-<id> vs res_<id>). Purgée par
// deleteConv via clearResourcePushState, comme clearAttachmentPushState.
let _resourcePushState = {};
function isResourcePushed(conversationId, resId) { return !!_resourcePushState[_pushStateKey(conversationId, resId)]; }
function markResourcePushed(conversationId, resId) { _resourcePushState[_pushStateKey(conversationId, resId)] = true; }
function clearResourcePushState(conversationId) {
  for (const k in _resourcePushState) {
    if (k.indexOf((conversationId || '') + '|') === 0) delete _resourcePushState[k];
  }
}

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

// Motif des refs de ressource de session (res_<id>, lot K) — même forme que
// generateResourceId (resources.js) : 'res_' + base36, underscore après "res"
// (PAS un tiret comme att-/file-). Un res_… est directement l'id d'un record du
// store `resources` (getCachedRecord), matérialisé par store_binary (attachment
// binaire, résultat d'outil, ou octets web via web__fetch_resource, lot K §4.1).
const RESOURCE_REF_RE = /^res_[a-z0-9]+$/;

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

// Classification pure de la famille d'un handle (lot L, §checkpoint 4). Retourne
// 'att' | 'file' | 'resource' | null en réutilisant les trois regex existantes
// (JAMAIS de duplication de leur motif ici — source de vérité unique
// ATTACHMENT_REF_RE/FILE_REF_RE/RESOURCE_REF_RE). Pure et QuickJS-testable :
// c'est le cœur de décision « quelle famille de handle », isolé du lookup record
// (impur, lit le cache session). Consommée par resolveHandleRecord et par le
// handler js__eval.
function classifyHandleRef(ref) {
  if (typeof ref !== 'string') return null;
  if (ATTACHMENT_REF_RE.test(ref)) return 'att';
  if (FILE_REF_RE.test(ref)) return 'file';
  if (RESOURCE_REF_RE.test(ref)) return 'resource';
  return null;
}

// Résolution handle → record IDB, par famille (lot L, factorisation §checkpoint 1).
// LA source de vérité unique pour « quel record derrière ce handle », consommée
// par _resolveInflationRef (chemin docs, wire MCP) ET par le handler js__eval
// (compute sandboxé). Impure (lit le cache session — getCachedRecord*), donc
// PAS QuickJS-testable ; la décision de famille (classifyHandleRef) l'est.
// Retourne le `record` (dont `record.data` est un ArrayBuffer) ou null si la ref
// n'est d'aucune famille reconnue, ou si le record est introuvable/hors scope.
//
// Herméticité (piège 18) — un seul prédicat, hérité gratuitement : les trois
// lookups lisent le cache session (peuplé par loadConversationResources scopé à
// la conversation/Space courant). Un handle d'une autre conversation/Space n'y
// est pas → null → traité comme inexistant (pas d'oracle). AUCUN filtre de scope
// réécrit : le cache EST le filtre (cf. AUDIT-K §2).
function resolveHandleRecord(ref) {
  const family = classifyHandleRef(ref);
  if (family === 'att') {
    const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
    return getCachedRecordByAttId(ref, activeId) || null;
  }
  if (family === 'file') {
    const recordId = parseLibraryRef(ref);   // resources.js (chargé avant)
    const record = recordId ? getCachedRecord(recordId) : null;
    const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
    if (!record || record.kind !== 'library' || record.spaceId !== spaceId) return null;
    return record;
  }
  if (family === 'resource') {
    // res_… EST directement l'id du record (le plus simple des trois lookups :
    // pas de getCachedRecordByAttId ni de parseLibraryRef).
    return getCachedRecord(ref) || null;
  }
  return null;
}

// Prélude JS injecté dans le guest AVANT le code du modèle (lot L). Définit les
// quatre primitives de la surface FERMÉE (brief §6) en JS pur côté guest, au-
// dessus d'UNE seule host function `__miaou_text()` qui renvoie le contenu
// textuel décodé. Choix de discipline VM : ne marshaler qu'UNE valeur host→guest
// (la string), et construire lines()/jsonLines()/parse() en JS standard DANS le
// guest — pas de marshaling manuel de tableaux/objets (coûteux, source de fuites
// de handles). splitLines/checkOutputCap (utils.js) restent la référence pure
// testée ; la découpe guest ci-dessous en est le miroir volontaire (même
// sémantique : normalisation CRLF/CR→LF puis split sur \n). \n est écrit ici en
// séquence d'échappement JS classique (ce prélude est une string source JS
// normale de tools.js, PAS un template imbriqué — le piège d'échappement du
// spike ne s'applique pas, cf. AUDIT-L §Spike note harnais).
const JS_EVAL_GUEST_PRELUDE =
  "var __t = null;\n" +
  "function text(){ if(__t===null){__t=__miaou_text();} return __t; }\n" +
  "function lines(){ return text().replace(/\\r\\n/g,'\\n').replace(/\\r/g,'\\n').split('\\n'); }\n" +
  "function jsonLines(){ var out=[]; var ls=lines(); for(var i=0;i<ls.length;i++){ var s=ls[i]; if(!s) continue; try{ out.push(JSON.parse(s)); }catch(e){} } return out; }\n" +
  "function parse(){ return JSON.parse(text()); }\n";

// Exécute le code modèle dans un bac à sable QuickJS-WASM sur le texte fourni
// (lot L, cœur impur — NON testable QuickJS, vérif runtime L3). Discipline VM
// stricte : tous les handles créés côté host sont disposés en try/finally, le
// runtime porte les guards (setInterruptHandler wall-time, setMemoryLimit), la
// sortie est bornée APRÈS dump (checkOutputCap). Retourne un objet discriminé :
//   { ok:true, output }                    — succès, `output` = string bornée
//   { ok:false, reason:'cap', len, cap }   — sortie trop grosse (REFUS §3)
//   { ok:false, reason:'error', message }  — throw guest / timeout / OOM
// L'appelant (handler js__eval) transforme chaque cas en tool result texte.
// Sécurité (parenté piège 23) : le monde guest est CLOS — on n'injecte QUE
// __miaou_text (host) + le prélude JS ; jamais fetch, DOM, globalThis hôte, ni
// aucun autre pont. Équivalent QuickJS du « jamais allow-same-origin » de
// l'iframe. Ne JAMAIS élargir cette surface sans repenser la posture.
async function runInQuickJs(text, code, opts) {
  const timeoutMs = opts && opts.timeoutMs != null ? opts.timeoutMs : JS_EVAL_TIMEOUT_MS;
  const memBytes = opts && opts.memBytes != null ? opts.memBytes : JS_EVAL_MEM_BYTES;
  const cap = opts && opts.cap != null ? opts.cap : JS_EVAL_OUTPUT_CAP;

  const QuickJS = await ensureQuickJs();   // ui.js — lazy-load, rejet propagé en erreur d'outil
  const ctx = QuickJS.newContext();
  const rt = ctx.runtime;
  let textFn = null;
  try {
    rt.setMemoryLimit(memBytes);
    const start = Date.now();
    rt.setInterruptHandler(() => Date.now() - start > timeoutMs);

    // UNIQUE pont host→guest : renvoie le contenu textuel décodé. newString crée
    // un handle host qu'il FAUT disposer (retourné au guest qui en prend copie).
    textFn = ctx.newFunction('__miaou_text', () => ctx.newString(text));
    ctx.setProp(ctx.global, '__miaou_text', textFn);

    // Prélude (définit text/lines/jsonLines/parse) puis code modèle : évalués
    // ensemble en mode GLOBAL, la dernière valeur du code est le retour. Le
    // prélude est neutre (déclarations, completion-value undefined), le résultat
    // vient de la completion-value du dernier statement du `code`. PAS d'enveloppe
    // IIFE : dans une fonction, un statement d'expression (`lines().length`) n'est
    // PAS retourné sans `return` explicite — l'IIFE forçait donc undefined et
    // contredisait la doctrine « dernière valeur évaluée ». En mode global d'une
    // VM jetable, isoler les `var` du modèle n'apporte rien (aucun état ne survit).
    const res = ctx.evalCode(JS_EVAL_GUEST_PRELUDE + '\n' + code);
    if (res.error) {
      const errObj = ctx.dump(res.error);   // { name, message, stack } — objet, pas string
      res.error.dispose();
      return { ok: false, reason: 'error', message: _jsEvalErrText(errObj) };
    }
    // Marshale le retour ; sérialise en JSON si ce n'est pas déjà une string
    // (un objet/tableau doit sortir en texte lisible, cf. doctrine SORTIE).
    const val = ctx.dump(res.value);
    res.value.dispose();
    const output = typeof val === 'string' ? val : _jsEvalStringify(val);
    const capped = checkOutputCap(output, cap);   // utils.js — REFUS, pas troncature
    if (!capped.ok) return { ok: false, reason: 'cap', len: capped.len, cap: capped.cap };
    return { ok: true, output };
  } catch (e) {
    // Interruption (timeout) et OOM se manifestent soit en res.error ci-dessus,
    // soit en throw host selon l'engine — filet ici pour les deux.
    return { ok: false, reason: 'error', message: _jsEvalErrText((e && e.message) || String(e)) };
  } finally {
    if (textFn) textFn.dispose();
    ctx.dispose();   // dispose le runtime lié
  }
}

// Sérialisation du retour non-string (objet/tableau/nombre…) en texte. JSON pour
// les structures ; String() pour les scalaires non-JSON-ables (undefined, etc.).
function _jsEvalStringify(val) {
  if (val == null) return String(val);
  try { return JSON.stringify(val); } catch (e) { return String(val); }
}

// Message d'erreur guest normalisé, tronqué (une stack QuickJS peut être longue ;
// le modèle a besoin du message, pas de 40 lignes de trace). Un throw guest
// dumpé par ctx.dump(res.error) est un OBJET { name, message, stack } (pas une
// string) : on en extrait « name: message » — un String() nu donnerait
// « [object Object] », inexploitable pour corriger le code au tour suivant.
function _jsEvalErrText(raw) {
  let s;
  if (raw && typeof raw === 'object') {
    const name = raw.name ? String(raw.name) : 'Error';
    const msg = raw.message != null ? String(raw.message) : '';
    s = msg ? name + ': ' + msg : name;
  } else {
    s = String(raw == null ? 'erreur inconnue' : raw);
  }
  s = s.length > 500 ? s.slice(0, 500) + '…' : s;
  // « invalid redefinition of global identifier » (QuickJS mode global) survient
  // typiquement quand le modèle redéclare une primitive du prélude en const/let
  // (ex. `const lines = lines()`). Le message brut ne nomme NI l'identifiant NI
  // la cause — sans ce hint, les modèles tâtonnent (observé : ~10 tours perdus).
  // On rattache la cause probable et le remède directement au message d'erreur.
  if (/invalid redefinition of global identifier/i.test(s)) {
    s += " — tu as probablement redéclaré (const/let) une variable portant le nom " +
      "d'une primitive du bac à sable (text, lines, jsonLines, parse). Ces noms sont " +
      "réservés : renomme ta variable (ex. `const rows = lines();`).";
  }
  return s;
}

// Résolution polymorphe d'une ref d'inflation (lot Cbis, généralisation §4) :
// att-N (conversation-scopé, cache par attId) OU file-<id> (Space-scopé, cache
// unifié par id de record — herméticité : un fichier d'un autre Space n'est
// PAS résolu, comme s'il n'existait pas localement). Retourne null si la ref
// ne correspond à aucune forme reconnue ou si le record est introuvable/hors
// scope. Le record lui-même vient de resolveHandleRecord (source unique, lot L) ;
// cette fonction n'ajoute QUE le descripteur push-MCP (sessionId + tables d'état
// poussé/non-poussé), spécifique au wire docs et distinct par famille de ref
// (les deux tables _attachmentPushState / _filePushState restent séparées).
function _resolveInflationRef(ref) {
  const record = resolveHandleRecord(ref);
  if (!record) return null;
  const activeId = typeof currentConvId !== 'undefined' ? currentConvId : null;
  const family = classifyHandleRef(ref);
  if (family === 'att') {
    return {
      record, sessionId: activeId,
      isPushed: () => isAttachmentPushed(activeId, ref),
      markPushed: () => markAttachmentPushed(activeId, ref),
    };
  }
  if (family === 'file') {
    // session_id reste la conversation courante (le serveur mcp_docs ne connaît
    // que des sessions de conversation) : un fichier d'espace lu depuis une
    // conversation est poussé dans LA session de CETTE conversation — pas de
    // partage de session inter-conversation pour un fichier (dette assumée,
    // le brief H ne le promet pas).
    const recordId = parseLibraryRef(ref);
    const spaceId = typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID;
    return {
      record, sessionId: activeId,
      isPushed: () => isFilePushed(spaceId, recordId),
      markPushed: () => markFilePushed(spaceId, recordId),
    };
  }
  // family === 'resource' (resolveHandleRecord a déjà écarté null/inconnu)
  return {
    record, sessionId: activeId,
    isPushed: () => isResourcePushed(activeId, ref),
    markPushed: () => markResourcePushed(activeId, ref),
  };
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
  return loadSettings().intentTracing ? INTENT_DOCTRINE : '';
}

// Doctrine de déclenchement des skills (stage 2). Injectée seulement si AU
// MOINS une skill autotrigger existe (≈ getAutotriggerSkillsMeta non vide) —
// inutile de payer des tokens de doctrine pour une fonctionnalité sans skill
// éligible à l'utiliser. miaou__skills__read est dans TOOLS inconditionnellement
// (stage 1), donc gater sur sa présence serait toujours vrai (TOOLS est une const
// build-time non vide) ; on gate ici sur le contenu réel du cache skills à la
// place. PAS de confirmation ask_confirmation après skills__read (ex-réglage
// confirmSkillAutoUse, retiré) : le halting jette tout le tour, y compris le
// contenu de skills__read (cf. api.js onHalt) — au tour suivant (« Oui ») le
// modèle n'a plus ce contenu, doit le relire, reconfirme, boucle sans jamais
// agir. Bug structurel du mécanisme fork B (conçu pour memory__create, où la
// question seule suffit), pas un défaut d'obéissance du modèle — observé en
// pratique. La confirmation reste inutile de toute façon : lire une skill n'a
// pas d'effet de bord, seul agir dessus en a un, et l'utilisateur voit l'appel
// d'outil dans l'ack.
function skillDoctrinePrompt() {
  if (!getAutotriggerSkillsMeta().length) return '';
  return SKILL_DOCTRINE_BASE + SKILL_DOCTRINE_CONFIRM_OFF + SKILL_DOCTRINE_TAIL;
}
