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
// existent. Partie de ROOT_SYSTEM_PROMPT.
// v2 : la v1 disait « l'application l'a déjà présentée à l'utilisateur » sans borner
// la portée de « ressource ». Un résultat d'outil texte/JSON rangé en ressource
// (branche store_inline, resources.js) N'EST PAS affiché — seul l'ack « Ressource
// enregistrée » l'est, qui trace l'appel et non le contenu — mais le modèle lisait
// « enregistre sous forme de ressource » + « déjà présentée » et répondait comme si
// l'utilisateur avait le contenu sous les yeux (observé en prod). La distinction
// affiché/non-affiché est désormais explicite ici, et NOT_PRESENTED_NOTE
// (resources.js) la rappelle sur chaque résultat concerné.
const BINARY_DOCTRINE =
  "Quand un outil renvoie des données BINAIRES (image, audio, fichier, base64…), " +
  "l'application les enregistre sous forme de ressource et t'en communique l'ID. Les " +
  "images sont affichées directement dans l'interface : tu peux les introduire par UNE " +
  "phrase courte au plus (« Voici l'image demandée. »), mais ne reproduis jamais, " +
  "n'encode pas, ne simule pas et ne décris pas le contenu binaire — pas de base64, pas " +
  "d'image Markdown, pas de placeholder inventé. N'appelle pas resource__present pour " +
  "une image sans demande explicite : l'application l'a déjà présentée à l'utilisateur.\n\n" +
  "Cette présentation est faite à L'UTILISATEUR, pas à toi : d'une image ainsi " +
  "enregistrée tu ne détiens que le handle, jamais les pixels. Pour la REGARDER — la " +
  "décrire, l'analyser, y lire quelque chose — appelle miaou__recall_attachment avec " +
  "son handle : elle t'est alors ré-injectée et tu la vois réellement. Son contenu " +
  "n'est pas du texte : ne tente jamais de le lire avec un outil de calcul ou " +
  "d'extraction, tu n'y trouverais que des octets illisibles.\n\n" +
  "Cette présentation automatique vaut UNIQUEMENT pour les binaires affichables ci-dessus. " +
  "Un résultat d'outil TEXTUEL (texte, JSON, XML, CSV…), même rangé en ressource et même " +
  "si une trace « Ressource enregistrée » apparaît dans la conversation, n'est PAS montré " +
  "à l'utilisateur : cette trace signale l'appel d'outil, jamais son contenu. Un tel " +
  "contenu n'est lisible que par toi. Ne dis donc jamais à l'utilisateur qu'il peut le " +
  "voir, ni qu'il lui a été affiché, ni « comme tu peux le constater ci-dessus » : s'il " +
  "en a besoin, cite, extrais ou résume toi-même dans ta réponse ce qui lui est utile.";

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
  "normalement. Ce même outil accepte AUSSI un handle de bibliothèque (file-<id>) ou de " +
  "ressource (res_<id>) : c'est par lui que tu regardes n'importe quelle image, y compris " +
  "celle que tu viens de télécharger ou de produire, et pas seulement une pièce jointe. " +
  "Ne décris jamais une image de mémoire sans l'avoir rappelée. Pour un " +
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
  "Si une pièce jointe du tour courant (att-N) ou une ressource de session (res_…, " +
  "y compris une ressource que tu viens de créer toi-même) mériterait d'être " +
  "conservée dans la bibliothèque persistante de l'espace — ou si l'utilisateur te " +
  "demande d'y déposer un fichier — appelle d'abord miaou__skills__read " +
  "avec le slug « files-promote » (skill système, listée dans <miaou_skills_context> " +
  "si présente) : elle donne la doctrine de déclenchement complète (confirmation " +
  "préalable, format d'appel) avant tout appel à miaou__files__promote.";

// Doctrine docs (brief H, v2 lot V-1) : STATIQUE et INCONDITIONNELLE, dans
// ROOT_SYSTEM_PROMPT. La v1 était injectée conditionnellement par
// docsDoctrinePrompt() selon anyToolDeclaresAttachmentInflation() (présence d'un
// outil serveur déclarant ref+content_b64) : les deux ont disparu avec V-1. Deux
// raisons. (a) Avec des outils d'ouverture NATIFS (docs__list/docs__extract,
// toujours présents), la condition est devenue partiellement fausse. (b) Surtout,
// la faire dépendre de l'état de branchement MCP ferait bouger le prompt système
// à chaque connexion/déconnexion de serveur — invalidation KV RÉCURRENTE, ce que
// vise précisément le piège 16.
//
// Motif exact de WEB_DOCTRINE : deux blocs balisés dont la conditionnalité est
// LUE PAR LE MODÈLE (« si le registre te propose… »), jamais calculée par le
// code. Le cas dégradé (format sans ouvreur) est rattrapé par l'OUTIL, pas par
// la doctrine : docsUnsupportedFormatMessage() lit findDocsInflationTool() au
// moment de l'appel et nomme l'outil serveur réellement branché, ou dit qu'il
// n'y en a aucun. La doctrine se contente de dire au modèle de SUIVRE ce
// message — elle n'en redonde jamais le contenu.
//
// Cas Office (tranché Julien 2026-08-28) : un document Office EST un zip, le
// natif savait donc l'ouvrir mécaniquement — mais il n'en livrait que du XML
// brut là où l'outil serveur en extrayait le texte utile. La doctrine orientait
// vers le serveur tant qu'il existait, le natif restant un filet. Rouvert en
// V-5 format par format : ce qui restait sur la puce serveur était ce qui
// n'avait pas encore son lecteur natif, et la puce s'est vidée au fil des
// étapes.
//
// v6 (lot V-5, étape 3) : le POWERPOINT quitte la puce serveur, qui était son
// dernier occupant — ELLE DISPARAÎT DONC ENTIÈREMENT. Plus aucun format connu
// n'est renvoyé vers un outil serveur : les cinq (zip, PDF, Excel, Word,
// PowerPoint) ont leur lecteur natif, et le cas d'un format inconnu reste
// rattrapé par docsUnsupportedFormatMessage, qui nomme au moment de l'appel le
// serveur réellement branché. La doctrine décrit ce qui est vrai quand elle est
// lue : il n'y a plus rien à orienter ailleurs.
//
// v5 (lot V-5, étape 2) : le WORD quitte la puce serveur. PowerPoint y reste
// seul, jusqu'à l'étape 3.
//
// v4 (lot V-5, étape 1) : l'EXCEL quitte la puce serveur à son tour. Word et
// PowerPoint y restent jusqu'aux étapes 2 et 3 — la doctrine décrit ce qui est
// vrai au moment où elle est lue, jamais ce qui est prévu. Une puce qui
// annoncerait un lecteur pas encore écrit serait pire qu'une puce périmée : le
// modèle appellerait un outil qui refuse.
//
// v3 (lot V-4) : le PDF quitte la puce serveur et rejoint la ligne native, avec
// miaou__docs__read. Le serveur n'y est plus la voie du PDF — il reste le
// FALLBACK, et la doctrine dit désormais de préférer le natif : un modèle qui
// voit miaou__docs__read ET miaou-proxy__docs__read tirerait au sort sinon
// (décision 6 du cadrage — le serveur survit en fallback offline).
//
// VOLONTAIREMENT COURTE. Le mode d'emploi détaillé (formes de selector, quand
// passer as_resource, comment lire chaque refus) n'est PAS ici : depuis le lot
// V-7 il vit dans la skill système « docs » (src/system-skills/docs.md), que le
// modèle lit avant son premier appel docs__*. Ce qui reste ici est le QUAND — le
// déclencheur. Ne pas y reverser du COMMENT : ce serait défaire le split.
//
// Une modification ici invalide le préfixe KV cache sur toutes les conversations
// (ponctuel, assumé : la doctrine change une fois puis se re-stabilise).
const DOCS_DOCTRINE =
  "<OUVERTURE_DE_DOCUMENTS>\n" +
  "Un fichier binaire joint par l'utilisateur ou déposé dans la bibliothèque de " +
  "l'espace (descripteur [attachment att-N: file \"...\", <mime>, <taille> — binary " +
  "content, not inlined]) n'est pas lisible directement : son contenu n'est jamais " +
  "dans ton contexte, seul son handle l'est.\n" +
  "MIAOU ouvre SEUL cinq formats, sans aucun serveur : ARCHIVE ZIP, PDF, EXCEL " +
  "(.xlsx), WORD (.docx) et POWERPOINT (.pptx). Le geste est toujours le même : " +
  "miaou__docs__list d'abord, qui rend la structure du document sans en charger " +
  "le contenu — puis miaou__docs__read pour en lire une unité (page, feuille, " +
  "section, slide), ou miaou__docs__extract pour matérialiser un membre " +
  "d'archive en ressource res_… que tu passes ensuite à miaou__js__eval.\n" +
  "Si une page de PDF n'a pas de texte extractible (document scanné), ou si son " +
  "texte est visiblement le produit d'un mauvais OCR, ou encore si l'information " +
  "est dans un schéma ou un graphique : miaou__docs__render_page en rend UNE page " +
  "en image et te la met sous les yeux, pour que tu la lises toi-même.\n" +
  "Appelle ces outils sans attendre que l'utilisateur te le demande explicitement, " +
  "dès lors que la conversation porte sur le fichier joint. Si un outil te répond " +
  "qu'il ne sait pas ouvrir un format, sa réponse te dit quoi faire à la place : " +
  "suis-la, ne suppose jamais le contenu du fichier.\n" +
  "Quand un même outil existe en natif (préfixe miaou__) et via un serveur " +
  "(autre préfixe), PRÉFÈRE LE NATIF : le serveur est un fallback pour le cas " +
  "sans réseau.\n" +
  "Avant ton PREMIER appel à un outil miaou__docs__* dans cette conversation, " +
  "appelle miaou__skills__read avec le slug « docs » (skill système, listée dans " +
  "<miaou_skills_context> si présente) : elle donne la forme exacte du selector " +
  "de chaque format, quand sortir une lecture en ressource, et comment lire les " +
  "refus.\n" +
  "</OUVERTURE_DE_DOCUMENTS>\n\n" +
  "<SANS_OUVERTURE_DE_DOCUMENTS>\n" +
  "Si aucun outil disponible ne sait ouvrir le format d'un fichier joint, dis-le à " +
  "l'utilisateur plutôt que de supposer ou de fabriquer son contenu. Tu connais son " +
  "nom, son type et sa taille par son descripteur : c'est tout ce dont tu disposes.\n" +
  "</SANS_OUVERTURE_DE_DOCUMENTS>\n";

// ── js__eval : compute sandboxé sur un blob client (lot L) ────────────────────
// Paramètres du sandbox (constantes MIAOU dédiées, tranchées à l'audit AL2 sur
// mesure du spike L0). Le cap suit la convention docs__*/fetch_* (20000). La
// mémoire couvre « texte injecté + working set streamé » ; un débordement
// (parse() d'un JSON monstre) meurt en OOM catchable — comportement VOULU, pas
// un bug. Référencés UNIQUEMENT dans des corps de fonction (runtime), jamais au
// top-level d'un autre fichier (contrainte de portée du test runner, CLAUDE.md).
//
// JS_EVAL_MEM_BYTES est la CONTREPARTIE AVAL de MAX_INLINE_BYTES (utils.js) :
// elle doit rester largement supérieure au plus gros blob adressable, car un
// text() sur ce blob plus une copie dans le code du modèle vivent tous deux
// dans la VM. Les deux ont été portées ENSEMBLE au lot V-1 (32→64 Mo d'entrée,
// 128→256 Mo de VM) : les désynchroniser recréerait la contradiction garde
// d'entrée / capacité aval déjà payée. Un test d'ancrage lit la source réelle
// et garde le rapport (run_build_unit_tests).
//
// Le timeout suit le même mouvement (5 s → 10 s, décision Julien). Historique :
// 2 s à l'origine, remonté à 5 s après qu'un split('\n') + regex + agrégation
// sur un log de 21 Mo réel les a dépassées (l'injection seule tenait en ~158 ms
// au spike L0). Le cap d'entrée ayant doublé, 5 s redevenaient serrées sur un
// blob proche du plafond. Une vraie boucle infinie meurt toujours proprement.
const JS_EVAL_TIMEOUT_MS = 10000;
const JS_EVAL_MEM_BYTES = 256 * 1024 * 1024;
const JS_EVAL_OUTPUT_CAP = 20000;

// Cap sur le NOMBRE de ressources en entrée (lot L-2). Garde-fou anti-abus sur le
// nombre de clés, indépendant du volume : setMemoryLimit (JS_EVAL_MEM_BYTES) reste
// la seule garde sur le volume cumulé, inchangée par ce lot. Quatre suffit au cas
// qui a motivé le lot (croiser deux résultats d'outils) avec de la marge, sans
// ouvrir la porte à un appel qui décoderait dix blobs pour n'en lire qu'un.
const JS_EVAL_MAX_INPUTS = 4;

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
  "isolé (QuickJS), sur le contenu TEXTUEL d'une à " + JS_EVAL_MAX_INPUTS + " ressources " +
  "référencées par handle (att-N, file-<id> ou res_<id>), sans jamais charger ce " +
  "contenu dans ta fenêtre de contexte. Sers-t'en pour interroger un gros fichier " +
  "joint (log, JSON-lines, CSV, texte volumineux) — compter, filtrer, agréger, " +
  "extraire un sous-ensemble — quand le lire en entier serait inutile ou impossible. " +
  "Sers-t'en AUSSI pour CROISER plusieurs ressources en un seul appel (rapprocher " +
  "deux résultats d'outils par une clé commune, comparer deux versions) : chaque " +
  "ressource reçoit une clé que tu choisis, et le croisement se fait dans le bac à " +
  "sable — jamais en faisant transiter leur contenu par ton contexte. C'est aussi la " +
  "voie à prendre quand docs__read refuse un fichier trop volumineux : n'insiste pas " +
  "avec docs__read, passe directement à miaou__js__eval sur le même handle.\n\n" +
  "Le résultat est ramené en texte : au-delà de " + JS_EVAL_OUTPUT_CAP + " caractères, " +
  "l'appel est REFUSÉ (pas tronqué) — vise toujours une synthèse (compte, top-N, " +
  "échantillon), jamais le fichier brut.\n\n" +
  "Avant ton PREMIER appel à miaou__js__eval dans cette conversation, appelle " +
  "miaou__skills__read avec le slug « js-eval » (skill système, listée dans " +
  "<miaou_skills_context> si présente) : elle donne la signature d'appel exacte, " +
  "les primitives disponibles dans le bac à sable et le détail des contraintes de sortie.";

// Doctrine de déclenchement resource__create / resource__from_result (lot O),
// étendue à resource__append (lot Y).
// INCONDITIONNELLE comme JS_EVAL_DOCTRINE (les trois outils sont natifs, toujours
// présents) : posée dès O-1 en couvrant DÉJÀ le réflexe resource__from_result
// (livré en O-2) pour éviter une 2ᵉ invalidation KV cache (piège 16, assumé une
// fois — mémoire project_kv_cache_invalidation_accepted_once). L'ajout de la
// clause resource__append (lot Y) est la SECONDE invalidation ponctuelle de ce
// bloc, et pour la même raison : une clause de plus dans le bloc existant, pas
// un deuxième bloc doctrinal. QUAND seulement : le QUOI de chaque outil vit dans
// sa description (pas de duplication de la mention js__eval, portée par les
// descriptions d'outils).
const RESOURCE_DOCTRINE =
  "Trois outils permettent de ranger du texte en ressource adressable (res_…), " +
  "exploitable ensuite par miaou__js__eval sans repayer ce texte en tokens : " +
  "miaou__resource__create quand TU as produit ou recomposé un texte volumineux " +
  "que tu voudras interroger plus tard (au lieu de l'écrire en clair dans ta " +
  "réponse) ; miaou__resource__from_result quand un résultat d'outil déjà présent " +
  "plus haut dans la conversation encombre le contexte et que tu veux le garder " +
  "exploitable sans le traîner à chaque tour ; miaou__resource__append quand tu " +
  "as déjà une ressource res_… et du contenu à y ajouter, en plusieurs appels ou " +
  "plusieurs tours — tu n'écris que le morceau nouveau, jamais ce qui est déjà " +
  "stocké. N'utilise aucun des trois pour un texte court que tu peux simplement " +
  "écrire dans ta réponse.";

// Doctrine de déclenchement des agents (lot X-1, question structurante 5).
// Split QUAND / COMMENT (project_doctrine_extraction_quand_comment_split) : le
// DÉCLENCHEUR est ici, court, inconditionnel, KV-safe ; le MODE D'EMPLOI (rédiger
// un prompt autosuffisant, choisir la trousse, exploiter un résultat, lire un
// `exhausted` ou un outil manquant) est en skill système « agents ».
//
// Quatre éléments, dans cet ordre : la borne négative, son MOTIF vérifiable, la
// disqualification des faux signaux, l'interdiction de confabuler.
//
// LE CALIBRAGE EST LE VRAI TRAVAIL, entre deux bornes documentées :
//  - trop insistant → le modèle n'en lance JAMAIS, y compris sur demande
//    explicite (motif payé en V-8 : une borne générique écrase une obligation
//    spécifique posée ailleurs) ;
//  - trop discret → il n'ose pas, parce que rien ne lui dit qu'il peut
//    (project_model_facing_text_indicative_and_reachable).
// D'où : INDICATIF, jamais une condition à évaluer sur soi-même (« si tu penses
// que c'est trop long pour toi » ferait s'abstenir) ; la permission est énoncée
// AVANT l'interdiction, pour que le texte ne se lise pas comme un veto ; et la
// capacité annoncée (« tu seras prévenu ») a bien son handle — le réveil du
// parent existe (deliverAgentResult, agents.js), sinon on mentirait au modèle.
//
// AUCUNE CONSTANTE CHIFFRÉE ici ni dans la skill : les bornes vivent dans le JS
// (MAX_AGENTS_PER_CONV, MAX_AGENTS_TOTAL, MAX_AGENT_TURNS) et se font connaître
// par leur message de refus, qui les nomme.
//
// Assumé d'avance : ce texte rendra un modèle correct discipliné, pas un modèle
// faible. Pour les autres la garde est TECHNIQUE (borne de tours, borne d'agents
// simultanés). Ne pas durcir le texte pour compenser : c'est ce durcissement qui
// produit le modèle qui n'ose plus.
const AGENT_DOCTRINE =
  "miaou__agent__spawn lance un agent : une sous-conversation autonome qui traite " +
  "une tâche pendant que tu continues la tienne. Lance-en un quand l'utilisateur " +
  "te le demande, ou quand une tâche est réellement indépendante de ce que tu es " +
  "en train de faire et assez longue pour valoir d'être menée en parallèle.\n\n" +
  "En dehors de ces deux cas, fais le travail toi-même. Le motif est vérifiable : " +
  "un agent REDÉMARRE À FROID. Il n'a rien de cette conversation — ni le fichier " +
  "que tu viens d'ouvrir, ni ce que l'utilisateur t'a expliqué, ni ce que tu as " +
  "déjà déduit. Tout cela devrait être re-dérivé, ou réécrit dans son prompt. " +
  "Déléguer ce que tu as déjà en main coûte plus que de le faire.\n\n" +
  "Une tâche « à plusieurs angles », « approfondie » ou « en plusieurs parties » " +
  "n'est pas une demande d'agent : c'est une tâche que tu traites toi-même, en " +
  "plusieurs temps.\n\n" +
  "Tu es prévenu automatiquement quand un agent termine, et son résultat arrive " +
  "dans la conversation. N'attends pas en appelant miaou__agent__status en boucle. " +
  "Tant qu'un agent n'a pas rendu son résultat, le seul état que tu peux annoncer " +
  "est qu'il travaille encore — ne prétends jamais savoir ce qu'il a trouvé.\n\n" +
  "Avant ton PREMIER appel à miaou__agent__spawn dans cette conversation, appelle " +
  "miaou__skills__read avec le slug « agents » : elle dit comment écrire un prompt " +
  "qu'un agent sans contexte peut suivre, comment choisir les outils à lui confier, " +
  "et quoi faire d'un résultat incomplet.";

// Prompt racine — constante build-time, non modifiable depuis les paramètres.
// Compose les doctrines ; référencé par buildSystemMessage() (main.js).
// v1 — une modification ici invalide le préfixe KV cache sur toutes les conversations.
// (v2, lot L : JS_EVAL_DOCTRINE ajoutée en fin — inconditionnelle, statique.)
// (v3, lot O : RESOURCE_DOCTRINE ajoutée en fin — inconditionnelle, statique.)
// (v5, lot X-1 : AGENT_DOCTRINE ajoutée en fin — inconditionnelle, statique.
//  Un AGENT la lit aussi, alors qu'il n'a jamais agent__spawn dans son payload :
//  c'est la conséquence assumée de X-d (prompt système strictement identique à
//  celui du parent, pour le partage de préfixe KV). Ce qui l'empêche d'annoncer
//  un lancement impossible n'est pas un gate de prompt — ce serait rouvrir la
//  divergence que X-d ferme — mais la phrase de cadrage de son premier message
//  user, en position de dernier texte lu (AGENT_SCOPE_NOTICE, agents.js).)
// (v4, lot V-1 : DOCS_DOCTRINE entre ici, juste après ATTACHMENT_DOCTRINE dont
//  elle prolonge le sujet — elle était jusque-là injectée conditionnellement
//  hors racine par docsDoctrinePrompt(), supprimée avec V-1.)
const ROOT_SYSTEM_PROMPT = BINARY_DOCTRINE + "\n\n---\n\n" + ATTACHMENT_DOCTRINE + "\n\n---\n\n" +
  DOCS_DOCTRINE + "\n\n---\n\n" +
  WEB_DOCTRINE + "\n\n---\n\n" + CONV_REF_DOCTRINE + "\n\n---\n\n" + MEMORY_DOCTRINE + "\n\n---\n\n" + FILES_DOCTRINE +
  "\n\n---\n\n" + JS_EVAL_DOCTRINE + "\n\n---\n\n" + RESOURCE_DOCTRINE +
  "\n\n---\n\n" + AGENT_DOCTRINE;

// Doctrine de nommage des blocs de code. Injectée INCONDITIONNELLEMENT (comme
// IDENTITY_BLURB) : générer un codeblock n'a aucun rapport avec la présence
// d'outils, donc PAS dans ROOT_SYSTEM_PROMPT. Portée
// directement par systemMessageParts()/buildSystemMessage() (main.js) via out.codeblock.
// v6 — une modification ici invalide le préfixe KV cache sur toutes les conversations,
// même statut que le v1 de ROOT_SYSTEM_PROMPT. (v6 : la règle des fences imbriquées
// de v5 est REFORMULÉE et DÉPLACÉE en fin de doctrine. Retour d'usage Julien, trois
// défauts de la v5 : (a) elle était insérée entre la convention filename= et le renvoi
// vers la skill mermaid, coupant en deux le fil mermaid alors qu'elle n'a aucun rapport
// avec lui ; (b) « un backtick de plus par niveau d'imbrication supplémentaire » ne
// disait pas À QUI l'ajouter et se lisait naturellement comme « aux enfants » — l'exact
// inverse de la règle ; (c) elle exposait le pourquoi (CommonMark) avant le quoi. D'où
// une consigne impérative en tête, la raison ensuite, et le sens de l'imbrication nommé
// explicitement (vers l'EXTÉRIEUR). Ne règle PAS à soi seul le cas observé d'un modèle
// qui ignore la règle : aucun lien de causalité établi entre ces défauts de forme et ce
// refus, cf. la limite d'obéissance des modèles faibles. (v5 : ajout de la règle des
// fences imbriquées. Constat d'usage : le modèle produit trois backticks pour la fence
// externe ET pour la fence interne — markdown RÉELLEMENT ambigu, pas un défaut de
// parseur : en CommonMark trois backticks seuls ferment la fence ouverte, marked a
// donc raison de couper là. Avec quatre backticks en fence externe l'imbrication
// est rendue correctement (vérifié sur marked 12.0.0), d'où un correctif côté
// génération et rien à changer au rendu — aucune heuristique de re-balancement,
// elle casserait les cas légitimes.) (v4 : les règles de syntaxe mermaid-only
// — ex-v2/v3 — sont retirées d'ici et déplacées dans la skill système `mermaid`
// (src/system-skills/mermaid.md, cf. docs/skills.md) : le modèle l'appelle via
// miaou__skills__read avant de générer un diagramme, autotrigger listant sa
// disponibilité dans <miaou_skills_context>. Ne reste ici que la convention
// filename=, générique à tout langage.)
const CODEBLOCK_DOCTRINE =
  "Quand tu génères un bloc de code destiné à être enregistré comme fichier (script, " +
  "config, module…), fournis un nom de fichier sur la ligne d'ouverture de la fence, " +
  "après le langage, séparé par un espace, au format filename=nom.ext (sans espace " +
  "dans le nom, avec son extension). Exemple : trois backticks suivis de " +
  "`python filename=fibonacci.py`. L'application proposera ce nom au téléchargement. " +
  "Fais-le aussi pour les blocs mermaid (trois backticks suivis de " +
  "`mermaid filename=flux-auth.mmd`) : ce nom sert à nommer les exports " +
  "d'image du diagramme, l'extension est ajustée automatiquement. Pour un extrait " +
  "illustratif court sans vocation de fichier, tu peux l'omettre.\n\n" +
  "Pour générer un diagramme mermaid valide, appelle d'abord miaou__skills__read " +
  "avec le slug « mermaid » (skill système, listée dans <miaou_skills_context> si " +
  "présente) : elle donne les règles de syntaxe à respecter.\n\n" +
  "Un bloc de code qui contient lui-même une fence s'ouvre et se ferme avec QUATRE " +
  "backticks ; les fences à l'intérieur gardent leurs trois backticks, inchangées. " +
  "C'est TOUJOURS le bloc ENGLOBANT qui en porte le plus, jamais celui qu'il " +
  "contient.\n\n" +
  "Raison : une fence se ferme sur toute ligne portant au moins autant de backticks " +
  "que son ouverture. Avec trois backticks des deux côtés, la fermeture du bloc " +
  "intérieur ferme aussi le bloc englobant et la mise en page est cassée.\n\n" +
  "Si ce bloc englobant en contient lui-même un autre déjà imbriqué, monte à cinq " +
  "backticks, et ainsi de suite : chaque niveau vers l'EXTÉRIEUR ajoute un backtick.";

// Blurb d'identité — constante build-time, INCONDITIONNELLE (même statut que
// CODEBLOCK_DOCTRINE) : quelques phrases situant l'application et renvoyant vers
// l'outil miaou__about pour les détails. STATIQUE : aucun contenu dynamique
// (date, état, config). Le contenu d'aide lourd vit derrière l'outil, pas ici.
// Portée par systemMessageParts()/buildSystemMessage() (main.js) via out.identity,
// placée EN TÊTE du join. Une modification re-stabilise le préfixe au tour suivant :
// pas de coût récurrent à surveiller (cf. piège 16).
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
  "utilisateur fiable, section par section.\n" +
  "Les outils de découverte (miaou__about, skills) répondent à un besoin précis du " +
  "moment ; ce ne sont PAS des étapes préalables à franchir avant d'agir. Ne les " +
  "parcours pas de façon exhaustive ni par curiosité : lis seulement ce que la tâche " +
  "ou la question en cours réclame réellement, puis avance.";

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
  "d'instructions pertinents si la situation s'y prête. N'en lis une que si elle " +
  "correspond réellement à ce que tu es en train de faire ; ne les parcours pas " +
  "toutes pour voir. D'autres skills, non listées ici, sont invoquées directement " +
  "par l'utilisateur à sa discrétion : tu n'as pas à les découvrir ni à les charger.\n\n" +
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

// Ack du court-circuit anti-redemande (servedKeys, api.js — piège n°3) : un
// tool_call rigoureusement identique à un appel déjà servi dans l'échange est
// court-circuité SANS exécuter d'outil — aucun handler ne tourne, donc aucun
// ack n'est poussé par le chemin normal, et le court-circuit était totalement
// invisible dans le fil (même angle mort que l'historique de toolFail).
// Kind `tool_failed` (rouge, triangle) : du point de vue du tour c'est bien un
// appel qui n'a rien produit. Contrairement à toolFail, `name` arrive déjà
// CANONIQUE (le nom exact du tool_call, préfixé `miaou__…` ou distant
// `server__…`) : pas de préfixe ajouté ici.
function pushDuplicateCallAck(name, message) {
  _pendingToolAcks.push({ kind: 'tool_failed', name, message, error: true });
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
//
// Depuis le lot V, `ref` accepte DEUX familles de handle (pas seulement att-N) :
// une pièce jointe du tour courant, ou une ressource de session res_… — ce qui
// ouvre le chemin « le modèle produit un contenu → resource__create → promotion »,
// absent jusque-là (le modèle ne pouvait déposer aucun fichier qu'il avait
// lui-même fabriqué). `file-<id>` est REFUSÉ explicitement : promouvoir un
// fichier de bibliothèque dans la bibliothèque n'a pas de sens, et le silence
// laisserait le modèle croire à une copie. La décision de famille reste ici
// (pure, testée) ; le lookup du record est délégué à resolveHandleRecord.
function validateFilesPromoteArgs(args) {
  const ref = String((args && args.ref) || '');
  const description = String((args && args.description) || '').trim();
  if (!ref || !description) return 'Paramètres invalides (ref et description requis).';
  const family = classifyHandleRef(ref);
  if (family === 'file') return 'Ce fichier est déjà dans la bibliothèque de l\'espace.';
  if (family !== 'att' && family !== 'resource') {
    return 'Handle invalide : ' + ref + ' (attendu att-N ou res_<id>).';
  }
  return '';
}

// Message d'erreur d'un docs__* natif appelé sur un format qu'il ne sait pas
// ouvrir (lot V-1). C'est ICI que vit le rattrapage du cas dégradé, PAS dans la
// doctrine : DOCS_DOCTRINE est statique et ne connaît jamais l'état de
// branchement MCP (piège 16 — sinon le prompt système bougerait à chaque
// connexion/déconnexion de serveur). L'outil, lui, tourne au moment de l'appel :
// il peut donc regarder ce qui est RÉELLEMENT branché et nommer l'outil serveur
// disponible, ou dire qu'il n'y en a aucun. Impure par nature (lit _remoteTools).
function docsUnsupportedFormatMessage(record) {
  const what = record && record.name ? '« ' + record.name + ' »' : 'ce fichier';
  const mime = record && record.mime ? ' (' + record.mime + ')' : '';
  const head = what + mime + " n'est pas un format que MIAOU sait ouvrir seul : " +
    'son ouverture native ne gère à ce jour que ' + formatNativeDocKindsLabel(nativeDocKinds()) + '.';
  const inflation = findDocsInflationTool();
  if (inflation) {
    return head + ' Un serveur d\'extraction documentaire est branché : utilise ' +
      inflation.server.name + '__' + inflation.toolName + ' pour ce format.';
  }
  return head + " Aucun outil branché ne sait ouvrir ce format — dis-le plutôt que " +
    'de supposer son contenu.';
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

// Validation pure des arguments de resource__append (lot Y) — même motif que
// ses siblings, testable QuickJS malgré le handler async. La GARDE DE FAMILLE
// est ici, au niveau du schéma, pas plus bas : `att-N` et `file-<id>` ne sont
// pas des records appendables (cycle de vie différent — une pièce jointe est
// figée, un fichier de bibliothèque est un dépôt utilisateur), et les accepter
// pour échouer plus profond serait moins clair qu'un refus nommant le format
// attendu. Retourne un message d'erreur si invalide, '' sinon.
function validateResourceAppendArgs(args) {
  const id = String((args && args.id) || '').trim();
  const content = args && args.content != null ? String(args.content) : '';
  if (!id) return 'Handle manquant.';
  if (!content) return 'Contenu vide, rien à ajouter.';
  if (classifyHandleRef(id) !== 'resource') {
    return 'Handle invalide : ' + id + ' (attendu res_<id> — seule une ressource ' +
      'peut être prolongée).';
  }
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
    handler: (args, ctx) => {
      // Branche AGENT (lot X-1, 3bis) : le parent atteint ses enfants PAR ID —
      // « pas trouvable » n'est pas « pas atteignable ». Elle est nécessaire et
      // pas seulement permissive : un agent n'est jamais résumé, donc
      // getSummaryEntry ne rendrait rien et la lecture échouerait alors que la
      // décision 3bis l'autorise explicitement.
      // Garde de parenté UNIQUE (resolveOwnedAgent, agents.js), partagée avec
      // les quatre handlers agent__* : un agent d'une autre conversation répond
      // comme inexistant, sans oracle (même posture que le hors-Space juste
      // en dessous). `ctx` explicite, jamais currentConvId (piège 28).
      const owned = resolveOwnedAgent(args.id, ctx);
      if (owned) {
        const label = owned.agentIntent || 'Agent sans libellé';
        _pendingToolAcks.push({ kind: 'conversation_read', title: label, convId: args.id });
        const head = { id: owned.id, intent: owned.agentIntent || '', status: agentStatus(owned.id) };
        if (!args.with_contents) return JSON.stringify(head);
        return JSON.stringify(Object.assign({}, head, { messages: owned.messages || [] }));
      }
      // Un agent qui n'est PAS le sien (ou une conversation d'agent atteinte
      // depuis ailleurs) doit répondre comme inexistant, pas retomber sur la
      // branche résumé ci-dessous : sans ce court-circuit, la réponse
      // différerait selon que l'agent a ou non un résumé — donc un oracle.
      const targetConv = loadConversation(args.id);
      if (targetConv && isAgentConversation(targetConv)) {
        return toolFail('conv__get', 'Conversation introuvable ou souvenir supprimé.');
      }
      const entry = getSummaryEntry(args.id);   // storage.js
      // Herméticité (brief D2, piège 18) : les DEUX sorties ci-dessous partagent le
      // même message ET le même ack — l'absence d'oracle vise le MODÈLE, et un ack
      // `tool_failed` identique dans les deux cas n'en crée aucun. (L'utilisateur,
      // lui, doit bien voir que le modèle a tenté la lecture : c'est le but.)
      if (!entry || entry.suppressed) return toolFail('conv__get', 'Conversation introuvable ou souvenir supprimé.');
      // Espace de la GÉNÉRATION qui exécute cet outil (ctx, lot T-1c) — jamais
      // celui de l'écran. Un résumé orphelin (conversation supprimée, index
      // conservé) n'a pas de Space propre : traité comme default Space.
      const spaceId = ctx.spaceId;
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
    handler: (args, ctx) => {
      let entries = listSummaryEntries();        // storage.js — entrées non-tombstone
      // Herméticité (brief D2) : ne jamais exposer une conversation d'un autre
      // Space au modèle. Espace de la GÉNÉRATION (ctx, lot T-1c). Un
      // résumé orphelin (conversation supprimée) est traité comme default Space.
      const spaceId = ctx.spaceId;
      const allConvs = loadConversations();
      const idsInSpace = spaceConvIds(spaceId, allConvs);
      // Agents (lot X-1, exclusion 4 de 3ter) : jamais trouvables par le modèle.
      // Garde EXPLICITE et non déduite — un agent n'étant jamais résumé, il
      // n'atteindrait déjà pas cette liste, mais s'appuyer sur cette propriété
      // d'une autre couche ferait dépendre l'exclusion d'un invariant qu'aucun
      // test ne relie ici. Deux filtres qui composent (piège 18), jamais fusionnés.
      const agentIds = new Set(allConvs.filter(isAgentConversation).map(c => c.id));
      entries = entries.filter(e => !agentIds.has(e.id));
      const convIds = new Set(allConvs.map(c => c.id));
      entries = entries.filter(e => idsInSpace.has(e.id) || (!convIds.has(e.id) && spaceId === DEFAULT_SPACE_ID));
      // Exclut la conversation en cours : lister "les conversations passées" n'a
      // Exclut la conversation en cours : lister "les conversations passées" n'a
      // de sens que pour les AUTRES — et « en cours » est celle de la GÉNÉRATION
      // (ctx, lot T-1c), pas celle affichée.
      const activeId = ctx.convId;
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
    handler: (args, ctx) => {
      if (!args.content || !args.content.trim()) return toolFail('memory__create', 'Contenu vide — souvenir ignoré.');
      const id = genMemoryId();
      const now = Date.now();
      const content = args.content.trim();
      // Stampe le Space actif (brief D3) : pas de paramètre scope exposé au
      // modèle, écriture toujours dans le Space courant ; promotion vers
      // 'profile' réservée à une action UI (jamais depuis cet outil).
      const scope = ctx.spaceId;
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
    handler: (args, ctx) => {
      if (!args.id || !args.content || !args.content.trim()) return toolFail('memory__update', 'Paramètres invalides.');
      const content = args.content.trim();
      const existing = loadMemories().find(e => e.id === args.id);   // avant écrasement
      // Herméticité (brief D3, extension D2) : hors de portée du Space actif =
      // « introuvable », même posture sans-oracle que conv__get. La portée est
      // celle de `isMemoryInScope` — Space actif ET scope transverse 'profile',
      // soit exactement ce que `buildMemoryEntriesBlock()` injecte au modèle :
      // refuser un souvenir de profil qu'on vient de lui montrer avec son id
      // n'était pas de l'herméticité, juste un prédicat inter-Spaces recopié
      // trop loin. `editMemory` mute en place sans toucher au scope.
      const spaceId = ctx.spaceId;
      if (!isMemoryInScope(existing, spaceId)) return toolFail('memory__update', 'Souvenir introuvable.');
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
      "Ramène le contenu d'un fichier dans ton contexte pour l'examiner : une pièce " +
      "jointe de l'utilisateur (att-N, vue dans un descripteur [attachment att-N: ...] " +
      "du fil), un fichier de la bibliothèque (file-<id>) ou une ressource (res_<id>) — " +
      "y compris une IMAGE que tu as toi-même téléchargée ou produite. Image : " +
      "ré-injectée juste après le résultat de l'outil, tu en vois réellement les pixels. " +
      "C'est le SEUL moyen de regarder une image : son handle seul ne te la montre pas, " +
      "et son contenu binaire n'est pas lisible comme du texte. Texte : contenu en " +
      "clair. Binaire non-image : descripteur seul.",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Handle du fichier : att-N, file-<id> ou res_<id>' },
      },
      required: ['ref'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    // Handler ASYNC depuis X-1d : élargi aux handles de RESSOURCE, une image
    // stockée par _storeBlock (fetch_url, docs__extract) n'ayant aucun attId —
    // or c'est l'attId, et lui seul, qui adresse le chemin de ré-injection des
    // pixels (piège 19). Il faut donc pouvoir en allouer un à la volée, ce qui
    // impose une écriture IDB, donc l'asynchronie.
    handler: async (args, ctx) => {
      const ref = String(args.ref || '');
      if (!ref) return toolFail('recall_attachment', 'Identifiant manquant.');
      // getCachedRecordByAttId est dans resources.js (chargé avant). La
      // conversation de rattachement est celle de la GÉNÉRATION (ctx, lot
      // T-1c), même pattern que conv__list ci-dessus.
      const activeId = ctx.convId;
      // DEUX familles de ref (X-1d). `att-N` garde son lookup conversation-scopé
      // historique ; tout autre handle passe par resolveHandleRecord — LE
      // résolveur unique, donc la délégation d'agent (X-1b) s'applique
      // gratuitement. Sans cette branche, un agent à qui son parent a confié une
      // image ne pouvait pas en voir les pixels : il tenait un handle, et aucun
      // outil de sa trousse ne le convertissait en image (il finissait par
      // tenter de lire le PNG avec js__eval).
      const family = classifyHandleRef(ref);
      let record = (family === 'att')
        ? getCachedRecordByAttId(ref, activeId)
        : resolveHandleRecord(ref, ctx);
      const invalid = recallableImageError(record);
      if (invalid) return toolFail('recall_attachment', invalid);
      // L'attId est la CLEF du chemin de ré-injection, pas un attribut décoratif :
      // l'ack le porte, resolveRecallImages le relit à chaque envoi ultérieur.
      // Un record qui n'en a pas (tout ce qui vient de _storeBlock) s'en voit
      // donc attribuer un ici, UNE fois — idempotent, puisqu'on ne le fait que
      // s'il est absent, et le record muté est celui du cache session comme du
      // store. reserveAttIdFor reste le SEUL allocateur (resources.js).
      let attRef = record.attId || '';
      if (!attRef) {
        attRef = reserveAttIdFor(activeId);
        if (!attRef) return toolFail('recall_attachment', 'Conversation introuvable pour rattacher l\'image.');
        record.attId = attRef;
        // `conversationId` n'est JAMAIS réécrit : le record appartient à la
        // conversation qui l'a stocké. Le réaffecter à l'agent volerait le
        // fichier à son parent — et c'est précisément pour cela que le rappel
        // s'adresse désormais par `recordId` plutôt que par le couple
        // (attId, convId), qui ment dès que les deux diffèrent.
        try { await putResource(record); } catch (e) { /* cache session déjà à jour */ }
      }
      _pendingToolAcks.push({ kind: 'attachment_recalled', attId: attRef, recordId: record.id,
        resourceName: record.name, mime: record.mime, convId: activeId });
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
            attId: attRef,
            dataUrl: 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data),
          });
        }
        return 'Image ' + attRef + ' ré-affichée à l\'utilisateur ; son contenu suit dans le message suivant.';
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
    handler: (args, ctx) => {
      // Herméticité (piège 18, lot Cbis) : bibliothèque du Space actif SEULEMENT.
      // Espace de la GÉNÉRATION (ctx, lot T-1c), jamais celui affiché —
      // même pattern que conv__get.
      const spaceId = ctx.spaceId;
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
    handler: (args, ctx) => {
      const spaceId = ctx.spaceId;
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
    // Description v3 (lot V) : deux familles de source (att-N et res_…), pour
    // ouvrir le dépôt d'un contenu produit par le modèle lui-même. Le protocole
    // de consentement (question ask_confirmation littérale, mêmes ref/description
    // à l'appel, jamais d'appel direct) vit dans FILES_DOCTRINE / la skill
    // système files-promote — la description garde le QUOI + un rappel court du gate.
    description:
      "Copie un contenu dans la bibliothèque persistante de l'espace actif, avec une " +
      "description de ce que le fichier EST (pas un résumé de son contenu). La source " +
      "est soit une pièce jointe du tour courant (att-N), soit une ressource de session " +
      "res_… — y compris une ressource que TU as toi-même créée via " +
      "miaou__resource__create, ce qui te permet de déposer dans la bibliothèque un " +
      "fichier que tu as produit. Consentement de l'utilisateur REQUIS, sauf s'il " +
      "vient de te le demander explicitement (voir doctrine bibliothèque).",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Source à déposer : pièce jointe du tour courant (att-N) ou ressource de session (res_<id>)' },
        description: { type: 'string', description: 'Description factuelle de ce que le fichier EST, pas un résumé de son contenu. Phrase complète : majuscule initiale, point final, ≤ 2 phrases' },
        name: { type: 'string', description: 'Nom optionnel (défaut : nom du fichier d\'origine ; à fournir pour une ressource créée sans nom)' },
      },
      required: ['ref', 'description'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args, ctx) => {
      // validateFilesPromoteArgs reste PURE (testée à part) : elle renvoie le
      // message, c'est le site de sortie qui pousse l'ack.
      const invalid = validateFilesPromoteArgs(args);
      if (invalid) return toolFail('files__promote', invalid);
      const ref = String(args.ref || '');
      const description = String(args.description || '').trim();
      const activeId = ctx.convId;
      // resolveHandleRecord (source de vérité unique handle → record, lot L) au
      // lieu d'un getCachedRecordByAttId direct : couvre att-N ET res_… d'un
      // seul geste, et hérite gratuitement de l'herméticité (piège 18 — le cache
      // session EST le filtre, aucun scope réécrit ici). La famille file-<id> a
      // déjà été refusée par le validateur pur.
      const record = resolveHandleRecord(ref, ctx);
      if (!record) return toolFail('files__promote', 'Fichier introuvable.');   // ref inconnue/périmée, même posture que files__read
      const spaceId = ctx.spaceId;
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
    handler: async (args, ctx) => {
      // validateResourceCreateArgs reste PURE (testée à part) : elle renvoie le
      // message, c'est le site de sortie qui pousse l'ack (cf. toolFail).
      const invalid = validateResourceCreateArgs(args);
      if (invalid) return toolFail('resource__create', invalid);
      const content = String(args.content || '');
      const mime = args.mime ? String(args.mime).trim() : 'text/plain';
      const name = args.name ? String(args.name).trim() : 'resource';
      const activeId = ctx.convId;
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
    handler: async (args, ctx) => {
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
      const activeId = ctx.convId;
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
    name: 'resource__append',
    // Lot Y — écriture INCRÉMENTALE. Outil séparé plutôt qu'un mode de
    // resource__create (précédent lot O : deux outils plutôt qu'un bimodal, les
    // formes de paramètres divergent — ici `id` requis, ni `mime` ni `name`).
    // Le QUAND vit en doctrine (RESOURCE_DOCTRINE), le QUOI dans cette
    // description.
    description:
      "Ajoute du texte À LA FIN d'une ressource res_… existante, sans jamais " +
      "retransmettre ce qu'elle contient déjà. Sers-t'en pour construire un gros " +
      "contenu (CSV, rapport, agrégat) en plusieurs appels ou plusieurs tours : tu " +
      "n'écris à chaque fois que le morceau nouveau. Le handle reste le même et " +
      "s'utilise ensuite avec miaou__js__eval. Ne fonctionne que sur une ressource " +
      "res_… (pas sur une pièce jointe att-N ni un fichier de bibliothèque file-<id>).",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Handle res_<id> de la ressource existante à prolonger' },
        content: { type: 'string', description: 'Texte à ajouter à la fin du contenu actuel (le morceau NOUVEAU seulement)' },
      },
      required: ['id', 'content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args, ctx) => {
      const invalid = validateResourceAppendArgs(args);
      if (invalid) return toolFail('resource__append', invalid);
      const id = String(args.id || '').trim();
      // Cache session (herméticité, piège 18) : un res_… hors-scope y est absent
      // → « introuvable », jamais un oracle d'existence.
      const record = resolveHandleRecord(id, ctx);   // ctx EXPLICITE (piège 28)
      if (!record) return toolFail('resource__append', 'Ressource introuvable : ' + id + '.');
      // _appendBlock est adressé par l'ID DE RECORD (record.id), JAMAIS par le
      // handle : pour un agent, un res_… peut être un ALIAS délégué au spawn
      // (resolveDelegatedRecordId, lot X-1b) qui n'est l'id d'aucun record — le
      // relire par handle échouerait silencieusement. resolveHandleRecord est le
      // seul résolveur, et c'est SON résultat qui adresse l'écriture.
      const out = await _appendBlock(record.id, String(args.content));
      if (!out.ok) return toolFail('resource__append', out.message);
      // JAMAIS _makeResourceRef (record 'inline' → ré-inlinerait tout au tour
      // suivant, piège du lot M) : handle compact, comme resource__create.
      return formatInlineHandleForModel(id, out.record.mime, out.record) +
        ' Ajout de ' + out.appendedLen + ' caractères.';
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
    handler: (args, ctx) => {
      if (!args.id) return toolFail('memory__delete', 'Identifiant manquant.');
      const existing = loadMemories().find(e => e.id === args.id);
      // Même portée que memory__update (cf. commentaire là-bas) : Space actif +
      // 'profile'. `suppressMemory` pose un tombstone sans toucher au scope.
      const spaceId = ctx.spaceId;
      if (!isMemoryInScope(existing, spaceId)) return toolFail('memory__delete', 'Souvenir introuvable.');
      suppressMemory(args.id);
      _pendingToolAcks.push({ kind: 'memory_delete', id: args.id, content: existing ? existing.content : null });
      return 'Souvenir supprimé (réversible depuis les paramètres).';
    },
  },
  {
    // Sous-namespace miaou__skills__ : énumère les skills ACTIVÉES (slug + name +
    // description) pour que le modèle découvre ce qu'il peut lire via skills__read.
    // Les skills désactivées n'apparaissent JAMAIS (l'utilisateur les a coupées).
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
    // le contenu, pas de drift. `required` vide : topic absent/inconnu → apercu.
    // Sous QuickJS HELP_CONTENT vaut {} → enum vide (assumé par les tests).
    name: 'about',
    description:
      "Sert l'aide utilisateur de MIAOU (l'application), section par section. Appelle " +
      "cet outil quand l'utilisateur demande comment faire quelque chose dans MIAOU, " +
      "ce qu'est une fonctionnalité (espaces, pièces jointes, mémoire, skills, MCP, " +
      "exports…), ou où sont ses données — plutôt que de deviner. Passe un topic ; " +
      "sans topic, tu obtiens la vue d'ensemble. Consulte UN topic ciblé, celui qui " +
      "répond à la question posée. Ne parcours JAMAIS tous les topics par principe ou " +
      "par curiosité : c'est une perte de temps qui ne sert pas l'utilisateur. Si tu " +
      "ne sais pas quel topic viser, utilise about_search plutôt que de tout lire.",
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Sujet d\'aide à consulter (défaut : apercu).',
          enum: Object.keys(HELP_CONTENT),
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const requested = String((args && args.topic) || '').trim();
      // topic inconnu/absent → apercu (défaut). Fallback string vide si même
      // apercu manque (HELP_CONTENT={} sous QuickJS non stubé).
      const topic = HELP_CONTENT[requested] != null ? requested : 'apercu';
      const content = HELP_CONTENT[topic];
      _pendingToolAcks.push({ kind: 'about_read', topic });
      return content != null ? content : 'Aide indisponible.';
    },
  },
  {
    // Recherche de mots-clefs dans les sections d'aide, pour trouver le bon
    // `topic` sans deviner ou lister tous les sujets. Délègue à
    // searchHelpContent (utils.js, pure) — même garantie que `about` : aucun
    // drift possible, HELP_CONTENT est la seule source. Handler SYNCHRONE.
    name: 'about_search',
    description:
      "Cherche un ou plusieurs mots-clefs (séparés par des espaces) dans l'aide " +
      "utilisateur de MIAOU et renvoie les sections (topics) qui contiennent TOUS " +
      "ces mots-clefs, avec des extraits de chacune. Ces extraits sont indicatifs " +
      "et PEUVENT NE PAS couvrir le passage pertinent (une section peut mentionner " +
      "autre chose ailleurs). Ne conclus JAMAIS qu'une fonctionnalité n'existe pas " +
      "sur la seule base des extraits : si un topic est trouvé et que la question " +
      "porte sur un détail précis, appelle `about(topic)` pour lire la section " +
      "entière avant de répondre.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Mots-clefs à chercher, séparés par des espaces (ET logique).',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const query = String((args && args.query) || '').trim();
      if (!query) return toolFail('about_search', 'query manquant.');
      const results = searchHelpContent(HELP_CONTENT, query);
      _pendingToolAcks.push({ kind: 'about_search', query, count: results.length });
      if (results.length === 0) {
        return 'Aucun sujet d\'aide ne contient tous ces mots-clefs : ' + query;
      }
      return JSON.stringify(results);
    },
  },
  {
    // miaou__js__eval (lot L) : exécute du JS écrit par le modèle dans un bac à
    // sable QuickJS-WASM sur le contenu TEXTUEL d'une à JS_EVAL_MAX_INPUTS ressources
    // clientes, chacune référencée par handle (att-N/file-<id>/res_<id>) sous une clé
    // que le modèle choisit (lot L-2), sans jamais charger les octets bruts en
    // contexte. Handler ASYNC (lazy-load engine + exécution VM) → renvoie une
    // Promise<string> ; callInternalTool la mappe (précédent skills__read). Les
    // contrôles d'args (forme d'input_handles, code manquant) sont synchrones ; la
    // résolution des handles et l'exécution sont async. Résolution en REFUS TOTAL :
    // la PREMIÈRE clé fautive arrête tout, aucune exécution partielle sur des
    // entrées incomplètes (même doctrine que le refus de cap : refuser, pas dégrader). L'ack est poussé APRÈS résolution (le
    // résultat — ok/refus/erreur — n'est connu qu'à ce moment), pattern
    // skills__read. Herméticité (piège 18) : resolveHandleRecord lit le cache
    // session, un handle hors-scope → null → « handle introuvable » (pas d'oracle).
    name: 'js__eval',
    description:
      "Exécute du JavaScript (que tu écris) dans un bac à sable isolé sur le contenu " +
      "TEXTUEL d'une à " + JS_EVAL_MAX_INPUTS + " ressources référencées par handle " +
      "(att-N, file-<id> ou res_<id>), sans charger ce contenu dans ton contexte. " +
      "Sers-t'en pour interroger un gros fichier (log, JSON-lines, CSV, texte) — " +
      "compter, filtrer, agréger, extraire — ou pour CROISER plusieurs ressources en " +
      "un seul appel. Primitives disponibles dans le bac à sable, toutes prenant la " +
      "clé de la ressource à lire : text(cle), lines(cle), jsonLines(cle), " +
      "parse(cle) (voir la skill 'js-eval' pour le détail). La dernière valeur évaluée du code " +
      "est renvoyée (sérialisée en JSON si ce n'est pas une string). Sortie trop " +
      "grosse → refus explicite (réécris pour synthétiser) ; pour PRODUIRE un gros " +
      "contenu sans buter sur cette limite, passe output_handle et écris au fil de " +
      "l'eau avec emit(). N'inclus jamais le " +
      "contenu du fichier dans le code : il vient des primitives. Lecture OBLIGATOIRE " +
      "de la skill 'js-eval' avant utilisation dans une conversation.",
    inputSchema: {
      type: 'object',
      properties: {
        input_handles: {
          type: 'object',
          description: 'Ressources en entrée, sous la forme {"cle": "handle"} — de une à ' +
            JS_EVAL_MAX_INPUTS + ' clés (handles att-N, file-<id> ou res_<id> ; jamais le ' +
            'contenu ni un chemin). Tu choisis chaque clé : elle nomme la ressource dans ' +
            'ton code, où text("cle") la lit',
        },
        code: { type: 'string', description: 'Code JavaScript à exécuter ; sa dernière valeur évaluée est le résultat renvoyé' },
        output_handle: { type: 'string', description: 'Optionnel — handle res_<id> d\'une ressource existante (créée via miaou__resource__create) où écrire au fil de l\'eau. Sans ce paramètre, la primitive emit() n\'existe pas dans le bac à sable' },
      },
      required: ['input_handles', 'code'],
    },
    // readOnlyHint: false INCONDITIONNEL (lot Y). L'outil ÉCRIT dès qu'un
    // output_handle est fourni ; JSON Schema ne sait pas conditionner une
    // annotation à la présence d'un paramètre optionnel, et un hint qui MENT dans
    // un mode d'usage réel est pire qu'un hint légèrement pessimiste dans l'autre.
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: (args, ctx) => {
      const rawInputs = args && args.input_handles;
      const code = args && args.code != null ? String(args.code) : '';
      // Sorties PRÉCOCES (rien n'a été exécuté) → ack tool_failed. Les échecs de
      // l'exécution elle-même (cap, throw guest) gardent leur ack js_eval propre,
      // porteur du code et de ok:false — également rouge (ackIsError), mais avec
      // sa trace complète. Les deux ne se cumulent jamais : une sortie précoce
      // n'atteint pas le .then.
      //
      // Array.isArray est indispensable en plus du typeof : un tableau JSON est un
      // `typeof === 'object'`, et Object.keys y rendrait des indices numériques —
      // on accepterait silencieusement une forme positionnelle que le schéma ne
      // déclare pas, et dont les « clés » (0, 1, 2) ne porteraient aucune intention.
      if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
        return toolFail('js__eval', 'input_handles manquant ou invalide (attendu un objet {"cle": "handle"}).');
      }
      const inputKeys = Object.keys(rawInputs);
      if (inputKeys.length === 0) {
        return toolFail('js__eval', 'input_handles est vide : au moins une ressource est requise.');
      }
      if (inputKeys.length > JS_EVAL_MAX_INPUTS) {
        return toolFail('js__eval', 'input_handles porte ' + inputKeys.length + ' clés, maximum ' +
          JS_EVAL_MAX_INPUTS + '.');
      }
      if (!code) return toolFail('js__eval', 'Code manquant.');
      // REFUS TOTAL (décision 4 du brief) : la PREMIÈRE clé fautive arrête tout,
      // avant le moindre runInQuickJs. Pas d'exécution partielle sur des entrées
      // incomplètes — un code qui croise deux ressources et n'en reçoit qu'une
      // produirait un résultat faux d'apparence valide, bien pire qu'un refus.
      // Le message nomme la clé ET le handle : la clé est ce que le modèle a écrit
      // lui-même dans son code, la retrouver dans l'erreur lui dit quoi corriger.
      const texts = {};
      for (const key of inputKeys) {
        const handle = String(rawInputs[key] || '').trim();
        if (!handle) return toolFail('js__eval', 'Handle manquant pour la clé "' + key + '".');
        if (classifyHandleRef(handle) === null) {
          return toolFail('js__eval', 'Handle invalide pour la clé "' + key + '" : ' + handle +
            ' (attendu att-N, file-<id> ou res_<id>).');
        }
        const record = resolveHandleRecord(handle, ctx);   // ctx EXPLICITE (piège 28) ; impur : cache session (herméticité)
        if (!record || !record.data) {
          return toolFail('js__eval', 'Handle introuvable pour la clé "' + key + '" : ' + handle + '.');
        }
        texts[key] = utf8Decode(record.data);   // resources.js — AL3 : contenu textuel
      }
      // output_handle (lot Y) — validé AVANT d'exécuter quoi que ce soit : un
      // handle de sortie invalide doit échouer sans faire calculer la VM pour
      // rien, et sans exposer un emit() qui n'aurait nulle part où écrire.
      // Même garde de famille que resource__append : SEULE la famille res_…
      // (les records _storeBlock) est appendable.
      const outHandle = String((args && args.output_handle) || '').trim();
      let outRecordId = null;
      if (outHandle) {
        if (classifyHandleRef(outHandle) !== 'resource') {
          return toolFail('js__eval', 'output_handle invalide : ' + outHandle +
            ' (attendu res_<id> — seule une ressource peut recevoir emit()).');
        }
        const outRec = resolveHandleRecord(outHandle, ctx);   // ctx EXPLICITE (piège 28)
        if (!outRec) return toolFail('js__eval', 'output_handle introuvable : ' + outHandle + '.');
        // Même raison qu'en resource__append : c'est l'id de RECORD résolu qui
        // adresse l'écriture, pas le handle (qui peut être un alias d'agent).
        outRecordId = outRec.id;
      }
      return runInQuickJs(texts, code, { emit: !!outHandle }).then(async r => {   // ui.js/tools.js — async, lazy-load + VM
        // FLUSH INCONDITIONNEL (tranché, PLAN-Y étape 2) : le buffer part en un
        // SEUL _appendBlock, y compris quand l'exécution guest a échoué (throw,
        // timeout, OOM) ou que le retour texte a été refusé au cap. Ce n'est pas
        // une troncature déguisée (doctrine « refus explicite, pas troncature »,
        // qui porte sur le CANAL DE RETOUR) mais l'inverse : ne pas jeter un
        // travail déjà committé par le guest — 900 lignes émises avant un timeout
        // valent mieux que rien, et le modèle apprend l'échec par le result texte,
        // donc sait que l'écriture est partielle.
        let appendedLen = null;
        let appendError = '';
        // « Le calcul s'est-il interrompu ? » — VRAI seulement pour reason
        // 'error' (throw guest / timeout / OOM). Un refus de cap laisse
        // l'écriture COMPLÈTE : le code est allé au bout, seul le retour texte
        // a été refusé. Confondre les deux peindrait en rouge une ressource
        // parfaitement finie.
        const partial = !r.ok && r.reason === 'error';
        if (outHandle && r.emitted) {
          const out = await _appendBlock(outRecordId, r.emitted, partial);
          if (out.ok) appendedLen = out.appendedLen;
          else appendError = ' (échec d\'écriture dans ' + outHandle + ' : ' + out.message + ')';
        }
        const emitNote = appendedLen != null
          ? ' ' + appendedLen + ' caractères ont été ajoutés à ' + outHandle +
            (partial ? ' AVANT l\'interruption : cette ressource est incomplète, ' +
              'relis-la avant de reprendre pour ne pas réécrire ce qui y est déjà.' : '.')
          : (appendError || '');
        if (r.ok) {
          _pendingToolAcks.push({ kind: 'js_eval', inputHandles: rawInputs, ok: true, outLen: r.output.length, code,
            outputHandle: outHandle || null, appendedLen });
          return r.output + (emitNote ? '\n' + emitNote : '');
        }
        if (r.reason === 'cap') {
          _pendingToolAcks.push({ kind: 'js_eval', inputHandles: rawInputs, ok: false, outLen: r.len, code,
            outputHandle: outHandle || null, appendedLen });
          // REFUS explicite (§3), PAS un isError : result texte cadré pour que le
          // modèle re-cible dans le même tour (borné par MAX_TOURS). isError
          // pourrait couper la boucle.
          return 'Sortie refusée : ' + r.len + ' caractères dépassent la limite de ' +
            r.cap + '. Réécris ton code pour renvoyer une synthèse plus petite ' +
            '(un compte, un top-N, un échantillon), jamais le fichier brut.' + emitNote;
        }
        // reason === 'error' : throw guest / timeout / OOM. result texte (pas
        // isError) pour laisser le modèle corriger son code au tour suivant.
        _pendingToolAcks.push({ kind: 'js_eval', inputHandles: rawInputs, ok: false, code,
          outputHandle: outHandle || null, appendedLen });
        return 'Erreur d\'exécution dans le bac à sable : ' + r.message +
          '. Vérifie ton code (syntaxe, borne mémoire/temps).' + emitNote;
      });
    },
  },
  {
    // miaou__docs__list (lot V-1, élargi V-4) : décrit la structure d'un document
    // référencé par handle, SANS EN RENDRE LE CONTENU. Le type est reconnu AUX
    // OCTETS par sniffDocumentKind (docs.js, pur), jamais au mime ni à
    // l'extension — tous deux déclaratifs.
    //
    // Sur un zip, le central directory suffit (AUDIT §2) : on ne charge même pas
    // fflate, le listing est un parsing d'en-têtes, pur et testé en QuickJS. Les
    // autres formats passent par DOC_READERS, dont les lecteurs sont lazy-loadés.
    //
    // Handler ASYNC depuis V-4 (il était le seul du couple à être synchrone, et
    // ce commentaire l'affirmait — le lazy-load d'un lecteur l'a rendu faux).
    // callInternalTool mappe déjà les handlers thenables, rien à changer côté
    // plomberie ; la branche zip reste synchrone dans les faits.
    //
    // Herméticité (piège 18) : resolveHandleRecord lit le cache session, un
    // handle hors-scope → null → « introuvable » (no-oracle, comme conv__get).
    name: 'docs__list',
    description:
      "Donne la STRUCTURE d'un document référencé par son handle (att-N, file-<id> " +
      "ou res_<id>), sans en renvoyer le contenu : les pages et le sommaire d'un " +
      "PDF, les feuilles et leurs dimensions d'un classeur Excel, les sections " +
      "d'un document Word, les slides d'une présentation PowerPoint, ou les " +
      "membres d'une archive zip (nom et taille, avec " +
      "mention explicite de ceux qui ne sont pas extractibles — chiffrés, chemin " +
      "non sûr). Appelle-le TOUJOURS en premier : ce qu'il rend est exactement ce " +
      "que tu peux ensuite demander à miaou__docs__read (par un selector) ou à " +
      "miaou__docs__extract (par un chemin de membre).",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Handle du document : att-N, file-<id> ou res_<id> (jamais son contenu ni un chemin disque)' },
      },
      required: ['ref'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },   // lecture seule, aucune écriture d'état
    handler: async (args, ctx) => {
      const ref = String((args && args.ref) || '').trim();
      if (!ref) return toolFail('docs__list', 'Handle manquant.');
      if (classifyHandleRef(ref) === null) {
        return toolFail('docs__list', 'Handle invalide : ' + ref + ' (attendu att-N, file-<id> ou res_<id>).');
      }
      const record = resolveHandleRecord(ref, ctx);   // ctx EXPLICITE (piège 28)
      if (!record || !record.data) return toolFail('docs__list', 'Handle introuvable : ' + ref + '.');
      const u8 = new Uint8Array(record.data);
      const kind = sniffDocumentKind(u8, record.name);   // utils.js, pur — aux octets

      // Le handler ne fait plus que router : tout ce qui sait lire un format
      // vit dans DOC_READERS, y compris le zip. Un type sans lecteur est refusé
      // par un message qui nomme ce que MIAOU ouvre réellement et l'outil
      // serveur branché s'il y en a un — le cas dégradé est rattrapé par
      // l'outil, jamais par la doctrine (décision 6 du cadrage).
      const reader = DOC_READERS[kind];
      if (!reader || !reader.list) return toolFail('docs__list', docsUnsupportedFormatMessage(record));
      return reader.list(u8, record, ref);
    },
  },
  {
    // miaou__docs__extract (lot V-1) : matérialise UN membre d'archive en
    // ressource res_… adressable par js__eval. Handler ASYNC (lazy-load fflate +
    // _storeBlock) → Promise<string>, mappée par callInternalTool comme js__eval.
    // Les quatre refus (membre introuvable, répertoire, chiffré, zip-slip, cap)
    // vivent dans decideZipMemberExtraction (utils.js, PUR et testé) : ils sont
    // pris sur le seul central directory, donc AVANT toute allocation — on ne
    // décompresse jamais pour découvrir après coup que c'était trop gros.
    name: 'docs__extract',
    description:
      "Extrait UN membre d'une archive zip (handle + chemin exact du membre, tel que " +
      "donné par miaou__docs__list) et le matérialise en ressource res_… adressable, " +
      "sans charger son contenu dans ton contexte. Le handle renvoyé se passe ensuite " +
      "à miaou__js__eval(handle, code) pour compter/filtrer/agréger/extraire. Un seul " +
      "membre par appel : pour en analyser plusieurs, rejoue l'extraction puis le même " +
      "script sur chaque handle.",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Handle de l\'archive : att-N, file-<id> ou res_<id>' },
        path: { type: 'string', description: 'Chemin exact du membre dans l\'archive, tel que listé par miaou__docs__list' },
      },
      required: ['ref', 'path'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },   // écrit un record IDB
    handler: async (args, ctx) => {
      const ref = String((args && args.ref) || '').trim();
      const path = String((args && args.path) || '').trim();
      if (!ref) return toolFail('docs__extract', 'Handle manquant.');
      if (!path) return toolFail('docs__extract', 'Chemin de membre manquant.');
      if (classifyHandleRef(ref) === null) {
        return toolFail('docs__extract', 'Handle invalide : ' + ref + ' (attendu att-N, file-<id> ou res_<id>).');
      }
      const record = resolveHandleRecord(ref, ctx);   // ctx EXPLICITE (piège 28)
      if (!record || !record.data) return toolFail('docs__extract', 'Handle introuvable : ' + ref + '.');
      const u8 = new Uint8Array(record.data);
      const entries = parseZipCentralDirectory(u8);
      if (!entries) return toolFail('docs__extract', docsUnsupportedFormatMessage(record));

      const decision = decideZipMemberExtraction(entries, path, MAX_INLINE_BYTES);   // utils.js, pur
      if (!decision.ok) {
        // REFUS métier : ack rouge (ok:false, lu par ackIsError) mais result
        // TEXTE non-isError — le modèle doit pouvoir re-cibler dans le même tour
        // sans que la boucle d'outils soit coupée (doctrine js__eval, piège 25).
        _pendingToolAcks.push({ kind: 'docs_extract', handle: ref, path, ok: false, message: decision.message });
        return decision.message;
      }

      let ff;
      try { ff = await ensureFflate(); }   // ui.js — échec PROPAGÉ, pas dégradé
      catch (e) {
        return toolFail('docs__extract', 'Moteur de décompression indisponible : ' +
          (e && e.message ? e.message : 'échec de chargement') + '.');
      }

      let data;
      try {
        // Le filtre borne la décompression au SEUL membre visé : fflate ne
        // décompresse rien d'autre (AUDIT §2). La garde de taille est déjà
        // passée (decideZipMemberExtraction), elle est ici redondante par
        // prudence — `size` du central directory est déclaratif donc
        // falsifiable, et originalSize vu par fflate en est une seconde lecture.
        const out = ff.unzipSync(u8, {
          filter: f => f.name === decision.entry.name && Number(f.originalSize) <= MAX_INLINE_BYTES,
        });
        data = out && out[decision.entry.name];
      } catch (e) {
        return toolFail('docs__extract', 'Échec de décompression du membre ' + path + ' : ' +
          (e && e.message ? e.message : 'archive illisible') + '.');
      }
      if (!data) return toolFail('docs__extract', 'Le membre ' + path + ' n\'a pas pu être décompressé.');

      // Classement inline/binary par la fonction EXISTANTE (resources.js) : un
      // membre image ou PDF imbriqué suit la règle commune, on ne force jamais
      // 'inline' (brief §3). Le mime vient de l'extension du membre : c'est la
      // seule information disponible dans un zip.
      const mime = zipMemberMime(decision.entry.name);   // utils.js, pur
      const cls = _isTextualMime(mime) ? 'inline' : 'binary';
      const name = zipMemberBaseName(decision.entry.name);   // utils.js, pur
      const id = await _storeBlock(mime, name, data, cls, ctx.convId, Date.now(), Math.random);
      if (!id) return toolFail('docs__extract', 'Échec de stockage du membre extrait.');

      _pendingToolAcks.push({
        kind: 'docs_extract', handle: ref, path, ok: true,
        resourceName: name, mime, size: data.byteLength,
      });
      // JAMAIS _makeResourceRef ici (piège 26c) : un [resource_ref:…] vers un
      // record 'inline' serait résolu en utf8Decode(data) au tour suivant et
      // ré-inlinerait le membre ENTIER dans le contexte (bug lot M : ~5,6M
      // tokens fantômes puis 400). Le handle transporte l'id, jamais le texte.
      return formatInlineHandleForModel(id, mime, getCachedRecord(id));
    },
  },
  {
    // miaou__docs__read (lot V-4) : lecture PAGINÉE d'un document, par UNITÉ
    // (page pour un PDF ; V-5 étendra aux feuilles et aux slides). Handler ASYNC.
    //
    // FORME TRANCHÉE (décision 2) : selector 'N' ou 'N-M', et RIEN d'autre. Le
    // serveur mcp_docs offre en plus une fenêtre char_start/line_start ; elle
    // n'est PAS portée, et c'est le seul écart assumé du lot au principe
    // « aucune perte de capacité ». La raison : MIAOU a déjà une pagination fine
    // et plus puissante — js__eval — et en faire naître une seconde, concurrente,
    // coûterait le portage de _apply_range (69 lignes denses, quatre notices, le
    // cas « la ligne unique dépasse le cap » déjà payé côté serveur en F7).
    // Ce qui est perdu : « lis les lignes 500-800 de la page 3 » en un appel.
    // La contrepartie : as_resource + js__eval, en deux appels, sur n'importe
    // quelle taille de document.
    name: 'docs__read',
    description:
      "Lit une partie d'un document référencé par handle (att-N, file-<id> ou " +
      "res_<id>) : PDF, classeur Excel, document Word et présentation PowerPoint. " +
      "Appelle miaou__docs__list d'abord : il te donne les unités disponibles, " +
      "donc ce que tu peux écrire en selector. Pour un zip, ce n'est pas cet " +
      "outil : liste avec miaou__docs__list puis matérialise un membre avec " +
      "miaou__docs__extract.",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Handle du document : att-N, file-<id> ou res_<id> (jamais son contenu ni un chemin disque)' },
        // V-7 : les quatre formes détaillées (une par format) sont parties dans
        // la skill système « docs ». Ce qui reste dit COMMENT trouver la forme
        // (la lire dans le listing), pas quelle elle est — et un selector mal
        // formé est de toute façon refusé par un message qui rappelle la forme
        // attendue, garde posée délibérément en V-4.
        selector: { type: 'string', description: "L'unité à lire, dans la forme propre au format : une page ou une plage de pages pour un PDF, une feuille (éventuellement restreinte à une plage de cellules) pour un classeur, un titre de section pour un document Word, un numéro de slide ou une plage pour une présentation. Reprends-la telle que miaou__docs__list vient de la rendre — c'est lui qui te donne les unités disponibles. La skill système « docs » donne la forme exacte de chaque format." },
        // Le « parce que » est OBLIGATOIRE dans la description d'un booléen
        // (mémoire project_model_written_field_shape_two_levels) : un modèle
        // faible à qui on donne « si true, alors X » choisit au hasard. Ici il
        // doit comprendre le CRITÈRE — le volume — pas la mécanique.
        as_resource: { type: 'boolean', description: "Range le texte lu dans une ressource res_… au lieu de le renvoyer dans ton contexte, parce qu'une lecture large (des dizaines de pages, une feuille de plusieurs milliers de lignes, une section de document longue, des dizaines de slides) le saturerait. Le handle rendu se passe ensuite à miaou__js__eval pour chercher, compter ou filtrer dedans. Par défaut false : une ou deux pages, une petite plage de cellules, ou une section ordinaire, se lisent directement." },
      },
      required: ['ref', 'selector'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },   // as_resource écrit un record IDB
    handler: async (args, ctx) => {
      const ref = String((args && args.ref) || '').trim();
      const selector = String((args && args.selector) || '').trim();
      const asResource = !!(args && args.as_resource);
      if (!ref) return toolFail('docs__read', 'Handle manquant.');
      if (!selector) return toolFail('docs__read', "Selector manquant (attendu 'N' ou 'N-M', par exemple '3' ou '2-5').");
      if (classifyHandleRef(ref) === null) {
        return toolFail('docs__read', 'Handle invalide : ' + ref + ' (attendu att-N, file-<id> ou res_<id>).');
      }
      const record = resolveHandleRecord(ref, ctx);   // ctx EXPLICITE (piège 28)
      if (!record || !record.data) return toolFail('docs__read', 'Handle introuvable : ' + ref + '.');
      const u8 = new Uint8Array(record.data);
      const kind = sniffDocumentKind(u8, record.name);   // utils.js, pur — aux octets

      // Même routage que docs__list, mais sur la capacité `read` : un format
      // peut être listable sans être lisible page à page (le zip l'est — ses
      // « unités » sont des membres, et c'est docs__extract qui les sert).
      const reader = DOC_READERS[kind];
      if (!reader || !reader.read) {
        if (reader && reader.list) {
          return toolFail('docs__read', 'Ce document (' + kind + ') ne se lit pas par unités : ' +
            'appelle miaou__docs__list pour en voir la structure, puis miaou__docs__extract ' +
            'sur le membre qui t\'intéresse.');
        }
        return toolFail('docs__read', docsUnsupportedFormatMessage(record));
      }

      const out = await reader.read(u8, record, ref, selector);
      if (typeof out === 'string') return out;   // refus déjà formaté par le lecteur
      const text = out.text;
      // Ce qui a été EFFECTIVEMENT servi (après clamp), et sous quel nom le
      // ranger : les deux viennent du lecteur, seul à savoir ce qu'est une unité
      // de son format (une page se dit '2-5', une feuille se dit
      // 'Synthèse!B2:E31'). Repli sur le selector brut pour un lecteur qui ne
      // les fournirait pas — mais tous les lecteurs de la table les fournissent.
      const label = out.label || selector;

      if (!asResource) {
        _pendingToolAcks.push({
          kind: 'docs_read', handle: ref, resourceName: record.name,
          selector: label, sourceName: record.name,
          size: text.length,
        });
        // Cap de contexte : REFUS explicite plutôt que troncature (doctrine du
        // cap js__eval, piège 25). La notice renvoie vers as_resource, qui est
        // la réponse — pas vers une pagination char/ligne, qui n'existe pas.
        if (text.length > JS_EVAL_OUTPUT_CAP) {
          return 'Lecture trop volumineuse pour le contexte : ' + text.length +
            ' caractères, au-delà de la limite de ' + JS_EVAL_OUTPUT_CAP + '. ' +
            'Relance le même appel avec as_resource: true (le texte ira dans une ' +
            'ressource res_… interrogeable par miaou__js__eval), ou demande une ' +
            'plage plus courte.';
        }
        return text;
      }

      const name = out.resourceName || docReadResourceName(record.name, '');   // utils.js, pur
      const id = await _storeBlock('text/plain', name, utf8Encode(text), 'inline',
        ctx.convId, Date.now(), Math.random);
      if (!id) return toolFail('docs__read', 'Échec de stockage du texte lu.');
      _pendingToolAcks.push({
        kind: 'docs_read', handle: ref, ok: true, resourceName: name,
        // sourceName = le document LU, resourceName = l'extrait PRODUIT : c'est
        // du premier que se déduit le mot d'unité de l'ack (« Section … lue »),
        // le second étant ici un .txt qui ne dit plus rien du format d'origine.
        selector: label, sourceName: record.name,
        mime: 'text/plain', size: text.length,
      });
      // JAMAIS _makeResourceRef (piège 26c) : un [resource_ref:…] vers un record
      // 'inline' ré-inlinerait le texte ENTIER au tour suivant.
      return formatInlineHandleForModel(id, 'text/plain', getCachedRecord(id));
    },
  },
  {
    // miaou__docs__render_page (lot V-8) : rend UNE page de PDF en image, pour
    // qu'un modèle à vision la lise lui-même. Ce n'est PAS de l'OCR — MIAOU rend,
    // le modèle lit.
    //
    // OUTIL SÉPARÉ, et pas un booléen as_image sur docs__read (arbitrage V-8) :
    // un second booléen sur le même outil est ce qui fait trébucher les modèles
    // faibles (mémoire project_weak_model_discovery_tool_oversweep), les deux ne
    // sont pas orthogonaux (as_image + as_resource n'a aucun sens et demanderait
    // un refus de plus), et surtout le CONTRAT DE SORTIE change de nature : un
    // texte d'un côté, une annonce + une injection d'image de l'autre. Le coût
    // (un schéma de plus à chaque tour) est assumé, borné par une description
    // courte — le COMMENT vit dans la skill système « docs », comme le reste du
    // namespace depuis V-7.
    //
    // UNE PAGE PAR APPEL, structurellement : le selector est un entier, pas une
    // plage. C'est la garde qui applique le « jamais de rendu en lot » (chaque
    // page coûte du contexte) — pas une valeur à surveiller, une forme d'API.
    name: 'docs__render_page',
    description:
      "Rend UNE page d'un PDF (handle att-N, file-<id> ou res_<id>) en image et te la " +
      "met sous les yeux, pour que tu la lises toi-même. À utiliser quand la " +
      "page n'a pas de texte extractible (document scanné), quand son texte est " +
      "visiblement issu d'un OCR de mauvaise qualité, ou quand l'information est dans " +
      "un schéma, un graphique ou un tableau mis en forme que l'extraction de texte " +
      "perd. Une page par appel : demande la suivante seulement si tu en as besoin. " +
      "Si l'image te revient illisible, dis-le et lis le texte avec miaou__docs__read.",
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Handle du PDF : att-N, file-<id> ou res_<id> (jamais son contenu ni un chemin disque)' },
        page: { type: 'integer', description: "Numéro de la page à rendre, tel que miaou__docs__list l'a annoncé (le sommaire donne la page de chaque section). Une seule page par appel — pas de plage." },
      },
      required: ['ref', 'page'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },   // stocke un attachment IDB
    handler: async (args, ctx) => {
      const ref = String((args && args.ref) || '').trim();
      if (!ref) return toolFail('docs__render_page', 'Handle manquant.');
      const pageNum = Math.floor(Number(args && args.page));
      if (!(pageNum >= 1)) {
        return toolFail('docs__render_page', "Numéro de page invalide (attendu un entier ≥ 1, par exemple 3).");
      }
      if (classifyHandleRef(ref) === null) {
        return toolFail('docs__render_page', 'Handle invalide : ' + ref + ' (attendu att-N, file-<id> ou res_<id>).');
      }
      const record = resolveHandleRecord(ref, ctx);   // ctx EXPLICITE (piège 28)
      if (!record || !record.data) return toolFail('docs__render_page', 'Handle introuvable : ' + ref + '.');
      const u8 = new Uint8Array(record.data);
      const kind = sniffDocumentKind(u8, record.name);   // utils.js, pur — aux octets
      if (kind !== 'pdf') {
        // Refus MÉTIER : seul le PDF se rend en image aujourd'hui. Le message
        // nomme la voie qui existe pour ce document plutôt que de constater.
        return toolFail('docs__render_page', 'Seul un PDF peut être rendu en image ; ' +
          'ce document est ' + (kind ? 'de type ' + kind : 'de format inconnu') + '. ' +
          'Utilise miaou__docs__list pour voir sa structure.');
      }

      // L'attId est RÉSERVÉ avant tout await (réentrance — cf. reserveAttIdFor,
      // resources.js) et dans la conversation de LA GÉNÉRATION, jamais celle
      // affichée (piège 28).
      const attId = reserveAttIdFor(ctx.convId);   // resources.js
      if (!attId) return toolFail('docs__render_page', 'Conversation introuvable pour rattacher l\'image.');

      const out = await renderPdfPageImage(u8, record, pageNum);   // docs.js
      if (out.fail) return out.fail;   // ack d'échec déjà poussé par toolFail

      const name = pdfRenderResourceName(record.name, pageNum);   // docs.js, pur
      const b64 = dataUrlBase64Payload(out.dataUrl);              // docs.js, pur
      if (!b64) return toolFail('docs__render_page', 'Image illisible après rendu.');
      const bytes = base64ToArrayBuffer(b64);                      // resources.js
      const stored = await storeAttachment(attId, 'image/png', name, bytes, 'binary',
        ctx.convId, Date.now(), Math.random, { w: out.w, h: out.h });   // resources.js
      if (!stored) return toolFail('docs__render_page', 'Échec du stockage de l\'image rendue.');

      // MÊME kind que recall_attachment, DÉLIBÉRÉMENT : c'est lui qui fait que
      // resolveRecallImages (resources.js) reprend l'image aux envois ultérieurs,
      // sans un second prédicat de ré-injection à maintenir en parallèle (le
      // chemin image est unique, piège 19). `origin` ne sert qu'à l'AFFICHAGE de
      // l'ack — libellé et icône (ui.js) —, jamais au routage.
      _pendingToolAcks.push({
        kind: 'attachment_recalled', origin: 'docs_render',
        attId, resourceName: name, sourceName: record.name,
        selector: String(pageNum), mime: 'image/png', convId: ctx.convId,
      });
      // Tour COURANT : les pixels partent par le registre d'injections, drainé
      // par runConversation (api.js) après les tool results. Le result ci-dessous
      // ne fait qu'annoncer l'image qui suit — un contenu image dans un
      // role:'tool' confabule (probe A2/D3).
      _pendingImageInjections.push({ attId, dataUrl: out.dataUrl });
      // « te la montre » et pas « affichée à l'utilisateur » : c'est le DERNIER
      // texte que le modèle lit avant de recevoir les pixels, et la version
      // précédente lui désignait l'utilisateur comme destinataire — un modèle de
      // test en a conclu « Julien a la vision » et a failli s'abstenir. Le
      // destinataire de l'image, ici, c'est LUI et lui seul : l'image n'est PAS
      // affichée dans le fil (matière de travail — ackImageIsDisplayable,
      // utils.js), seul l'ack y paraît avec son bouton de téléchargement.
      //
      // L'ID DU RECORD EST DONNÉ, et c'est la contrepartie du masquage : sans
      // lui, le modèle n'aurait aucun moyen de montrer la page à l'utilisateur
      // qui la demande. C'est le handle qu'il passe à miaou__resource__present.
      return 'Page ' + pageNum + ' de « ' + record.name + ' » rendue en image (' +
        out.w + 'x' + out.h + ') ; MIAOU te la montre, ' +
        'son contenu suit dans le message suivant. ' +
        "Elle n'est pas affichée dans la conversation : si l'utilisateur demande à " +
        'la voir, montre-la-lui avec miaou__resource__present (identifiant : ' +
        stored.id + ').';
    },
  },
  {
    // miaou__docs__pack (lot V-2) : agrège N ressources déjà stockées en UNE
    // archive zip téléchargeable. Premier outil du namespace docs__ à ÉCRIRE un
    // format plutôt qu'à le lire — le namespace suit le format, pas le sens de
    // l'opération (décision 1 du lot : nom identique au serveur pour que la
    // disparition de mcp_docs reste invisible au modèle).
    // Handler ASYNC (lazy-load fflate + _storeBlock). Le PUR — nom de membre et
    // validation du plan — vit dans utils.js et est testé en QuickJS.
    // Herméticité (piège 18) : resolveHandleRecord lit le cache session, un
    // handle hors-scope → null → « introuvable » (no-oracle, comme docs__list).
    name: 'docs__pack',
    description:
      "Regroupe plusieurs ressources déjà stockées (handles att-N, file-<id> ou res_<id>) " +
      "en une seule archive zip que l'utilisateur peut télécharger depuis le fil. " +
      "À utiliser quand tu as produit ou rassemblé plusieurs fichiers au cours de " +
      "l'échange et que l'utilisateur veut le tout d'un bloc, parce qu'un téléchargement " +
      "unique lui évite de récupérer les pièces une par une. Ne crée aucun contenu : les " +
      "ressources doivent déjà exister. Le contenu des membres n'entre jamais dans ton contexte.",
    inputSchema: {
      type: 'object',
      properties: {
        handles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Handles des ressources à archiver : att-N, file-<id> ou res_<id>. Au moins un.',
        },
        name: {
          type: 'string',
          description: 'Nom du fichier d\'archive produit, extension .zip incluse (défaut : archive.zip)',
        },
      },
      required: ['handles'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },   // écrit un record IDB
    handler: async (args, ctx) => {
      const handles = args && Array.isArray(args.handles) ? args.handles : null;
      if (!handles || !handles.length) {
        return toolFail('docs__pack', 'Aucun handle fourni : passe au moins une ressource à archiver.');
      }

      // Résolution de CHAQUE handle AVANT le premier await, ctx EXPLICITE
      // (piège 28). Les records sont GELÉS ici : le handler est async, et un
      // état relu après un await appartiendrait peut-être à une autre
      // génération (piège 26b). Échec NOMINATIF — le modèle doit savoir lequel.
      const resolved = [];
      const taken = new Set();
      for (const raw of handles) {
        const ref = String(raw == null ? '' : raw).trim();
        if (!ref) return toolFail('docs__pack', 'Handle vide dans la liste.');
        if (classifyHandleRef(ref) === null) {
          return toolFail('docs__pack', 'Handle invalide : ' + ref + ' (attendu att-N, file-<id> ou res_<id>).');
        }
        const record = resolveHandleRecord(ref, ctx);   // ctx EXPLICITE (piège 28)
        if (!record || !record.data) return toolFail('docs__pack', 'Handle introuvable : ' + ref + '.');
        const memberName = buildZipMemberName(record, taken);   // utils.js, pur
        taken.add(memberName);
        resolved.push({ ref, record, name: memberName, size: record.data.byteLength });
      }

      const plan = validateZipPlan(resolved.map(r => ({ name: r.name, size: r.size })));   // utils.js, pur
      if (!plan.ok) {
        // REFUS métier : ack rouge (ok:false) mais result TEXTE non-isError —
        // le modèle re-cible dans le même tour (même posture que docs__extract).
        _pendingToolAcks.push({ kind: 'docs_pack', ok: false, message: plan.message, count: resolved.length });
        return plan.message;
      }

      let ff;
      try { ff = await ensureFflate(); }   // ui.js — échec PROPAGÉ, pas dégradé
      catch (e) {
        return toolFail('docs__pack', 'Moteur de compression indisponible : ' +
          (e && e.message ? e.message : 'échec de chargement') + '.');
      }

      let data;
      try {
        // zipSync prend un objet { nom: octets } : c'est PRÉCISÉMENT pourquoi la
        // déduplication de buildZipMemberName n'est pas cosmétique — deux clés
        // homonymes s'écraseraient ici en silence, sans que fflate y soit pour
        // quoi que ce soit. validateZipPlan a déjà refusé ce cas.
        const files = {};
        for (const r of resolved) files[r.name] = new Uint8Array(r.record.data);
        data = ff.zipSync(files, { level: 6 });
      } catch (e) {
        return toolFail('docs__pack', 'Échec de compression : ' +
          (e && e.message ? e.message : 'inconnu') + '.');
      }

      // Classe 'binary' EXPLICITE : un application/zip n'est pas textuel, et son
      // contenu ne doit jamais pouvoir être inliné dans le contexte.
      const archiveName = normalizeArchiveName(args && args.name);   // utils.js, pur
      const id = await _storeBlock('application/zip', archiveName, data, 'binary',
                                   ctx.convId, Date.now(), Math.random);
      if (!id) return toolFail('docs__pack', 'Échec de stockage de l\'archive.');

      _pendingToolAcks.push({
        kind: 'docs_pack', ok: true, resourceName: archiveName,
        mime: 'application/zip', size: data.byteLength, count: resolved.length, id,
      });

      // DESCRIPTEUR, jamais le contenu, et JAMAIS _makeResourceRef (piège 26c).
      // formatInlineHandleForModel ne conviendrait PAS ici : sa note « texte
      // adressable par js__eval » serait FAUSSE sur un binaire — js__eval y
      // décoderait les octets compressés en UTF-8 et rendrait du bruit.
      // La mention du téléchargement est délibérée : sans elle, le modèle peut
      // annoncer à l'utilisateur qu'il doit demander autre chose alors que le
      // bouton est déjà dans le fil (précédent NOT_PRESENTED_NOTE, resources.js).
      const rec = getCachedRecord(id);
      const desc = rec ? formatResourceDescriptor(rec)
                       : '[resource id=' + id + ' mime=application/zip name="' + archiveName + '"]';
      return desc + ' — archive de ' +
        (resolved.length === 1 ? '1 membre' : resolved.length + ' membres') +
        ', déjà proposée au téléchargement dans le fil : l\'utilisateur n\'a rien d\'autre à demander.';
    },
  },

  // ── Agents (lot X-1) ──────────────────────────────────────────────────────
  // Quatre outils, tous passés à l'examen de la décision 6 (« ne pas
  // multiplier ») : spawn (lancer), status (consulter), result (relire), abort
  // (interrompre). `agent__status` a été conservé pour une raison PRÉCISE et
  // pas pour le polling — cf. sa description.
  //
  // GARDE DE PARENTÉ commune aux quatre (3bis) : un agent n'est adressable que
  // par SON parent. Prédicat UNIQUE resolveOwnedAgent (agents.js), partagé avec
  // l'extension de conv__get. Un agent d'une autre conversation répond comme
  // inexistant — MÊME message, pas d'oracle (posture du piège 18).
  // `ctx` en argument explicite partout (piège 28) : jamais currentConvId.
  {
    name: 'agent__spawn',
    // Description construite DYNAMIQUEMENT (agentSpawnToolDef, plus bas) : le
    // défaut annoncé de reasoning_effort est le niveau COURANT de la
    // conversation, sans dire que c'est le sien (astuce X-h). Ce qui suit est le
    // gabarit statique ; la partie variable est injectée à la construction.
    description: '',
    inputSchema: { type: 'object', properties: {}, required: ['prompt', 'intent'] },
    annotations: { readOnlyHint: false, destructiveHint: false },   // crée une conversation et démarre une génération
    handler: (args, ctx) => {
      const prompt = String((args && args.prompt) || '').trim();
      const intent = String((args && args.intent) || '').trim();
      if (!prompt) return toolFail('agent__spawn', 'Paramètre « prompt » manquant : décris la tâche à confier.');
      if (!intent) return toolFail('agent__spawn', 'Paramètre « intent » manquant : décris en une phrase ce que tu demandes à l\'agent.');
      const c = toolCtx(ctx);
      if (!c.convId) return toolFail('agent__spawn', 'Aucune conversation active : impossible de lancer un agent.');
      // Un agent ne lance pas d'agent (X-b) : la garde est ici EN PLUS du filtre
      // de liste d'outils, parce qu'un agent qui recevrait agent__spawn par un
      // autre chemin doit être arrêté au handler, pas seulement à la validation.
      const self = loadConversation(c.convId);
      if (self && isAgentConversation(self)) {
        return toolFail('agent__spawn', 'Un agent ne peut pas en lancer un autre : la profondeur est bornée à un niveau.');
      }
      // Deux bornes, et le refus NOMME celle qui est atteinte (Q3). Les
      // constantes vivent dans storage.js (dérivation BUILD_CONFIG) et ne sont
      // lues qu'ici, en corps de fonction (contrainte de portée inter-fichier).
      const limitError = agentSpawnLimitError(
        countWorkingAgentsOf(c.convId), countWorkingAgentsTotal(),
        MAX_AGENTS_PER_CONV, MAX_AGENTS_TOTAL);
      if (limitError) return toolFail('agent__spawn', limitError);
      // Validation de la liste d'outils déléguée : nom inconnu → refus listant
      // les noms valides (referme la découverte sans outil dédié).
      const v = validateAgentToolList(args && args.tools, agentDelegatableToolNames());
      if (!v.ok) return toolFail('agent__spawn', v.error);
      // Fichiers délégués (X-1b) : résolus ICI, dans le référentiel du PARENT
      // (`c`), parce que c'est le seul instant et le seul ctx où les handles du
      // parent résolvent quelque chose. Ce qui est figé est l'ID DE RECORD, pas
      // le handle : l'agent recevra un alias res_… (agents.js). Le lookup
      // (impur) reste ici, la décision (pure, testée) est dans
      // buildAgentDelegatedFiles — même partage que validateAgentToolList.
      const refs = (args && args.attachments != null) ? args.attachments : null;
      let files = [];
      if (refs != null) {
        if (!Array.isArray(refs)) {
          return toolFail('agent__spawn', 'Le paramètre « attachments » doit être un tableau de handles.');
        }
        const resolved = refs.map(r => {
          const ref = (typeof r === 'string') ? r.trim() : '';
          return { ref: ref, record: ref ? resolveHandleRecord(ref, c) : null };
        });
        const fv = buildAgentDelegatedFiles(resolved);
        if (!fv.ok) return toolFail('agent__spawn', fv.error);
        files = fv.files;
      }
      // Le défaut de reasoning_effort DOIT être réellement appliqué ici : un
      // schéma qui annonce un niveau pendant que le code retombe sur '' est
      // project_doc_promises_intent_code_never_confronted — ça n'échoue jamais,
      // et un lot suivant le fossilise. C'est agentDefaultReasoningEffort(ctx)
      // qui répond, la MÊME fonction que celle qui construit la description.
      const effort = (args && typeof args.reasoning_effort === 'string' && args.reasoning_effort.trim())
        ? args.reasoning_effort.trim()
        : agentDefaultReasoningEffort(c);
      const id = spawnAgent({
        parentConvId: c.convId,
        spaceId: c.spaceId,
        prompt: prompt,
        intent: intent,   // JAMAIS de normalisation de casse : c'est le libellé rédigé par le modèle
        tools: v.tools,
        files: files,
        reasoningEffort: effort,
      });
      if (!id) return toolFail('agent__spawn', 'Lancement impossible.');
      _pendingToolAcks.push({ kind: 'agent_spawn', convId: id, title: intent });
      // Le retour NOMME les fichiers délégués avec l'alias vu par l'agent : le
      // parent doit pouvoir en reparler dans un prompt de relance, et sans cette
      // ligne il ne connaîtrait que ses propres handles (que l'agent, lui,
      // n'accepte pas).
      const filesLine = files.length
        ? files.map(f => f.ref + ' → ' + f.alias + ' (« ' + f.name + ' »)').join(', ')
        : 'aucun';
      return 'Agent lancé — identifiant : ' + id + '.\n' +
        'Ton tour continue : ne l\'attends pas. Tu seras prévenu automatiquement quand il aura terminé.\n' +
        'Outils qui lui ont été délégués : ' + (v.tools.length ? v.tools.join(', ') : 'aucun') + '.\n' +
        'Fichiers qui lui ont été délégués : ' + filesLine + '.';
    },
  },
  {
    name: 'agent__status',
    // La DEUXIÈME phrase est ce qui transforme un outil de polling en outil de
    // consultation. Sans elle, le modèle appelle en boucle pour « attendre » et
    // brûle des tours pour rien — alors qu'un parent dont le tour est fini ne
    // peut rien appeler du tout, et qu'un parent dont le tour est en cours sera
    // de toute façon réveillé.
    description:
      "Renvoie l'état d'un agent que tu as lancé, À L'INSTANT DE L'APPEL. Tu seras " +
      "prévenu automatiquement quand un agent termine — n'appelle donc pas cet outil " +
      "pour attendre, il ne t'apprendra rien de plus. Sers-t'en pour jeter un œil " +
      "pendant que tu fais autre chose. Pour voir comment il travaille (son fil " +
      "complet, plus coûteux), utilise miaou__conv__get avec son identifiant.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifiant de l\'agent, rendu par agent__spawn' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args, ctx) => {
      const conv = resolveOwnedAgent(args && args.id, toolCtx(ctx));
      if (!conv) return toolFail('agent__status', AGENT_NOT_FOUND);
      const st = agentStatus(conv.id);
      _pendingToolAcks.push({ kind: 'agent_status', convId: conv.id, title: conv.agentIntent || '' });
      return JSON.stringify({
        id: conv.id,
        intent: conv.agentIntent || '',
        status: st,
        status_label: AGENT_STATUS_LABELS[st] || st,
        turns: conv.agentTurns || 0,
        messages: (conv.messages || []).length,
      });
    },
  },
  {
    name: 'agent__result',
    // Reste utile MALGRÉ le réveil : un parent peut vouloir RELIRE un résultat
    // plusieurs tours plus tard sans l'avoir gardé en contexte.
    description:
      "Renvoie le résultat d'un agent terminé, ou l'indication qu'il travaille encore. " +
      "Utile pour relire un résultat que tu n'as plus sous les yeux — tu n'as pas " +
      "besoin de l'appeler pour recevoir un résultat, il t'est transmis " +
      "automatiquement quand l'agent termine.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifiant de l\'agent, rendu par agent__spawn' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args, ctx) => {
      const conv = resolveOwnedAgent(args && args.id, toolCtx(ctx));
      if (!conv) return toolFail('agent__result', AGENT_NOT_FOUND);
      const st = agentStatus(conv.id);
      _pendingToolAcks.push({ kind: 'agent_result', convId: conv.id, title: conv.agentIntent || '' });
      if (st === 'running') {
        return 'Agent ' + conv.id + ' : toujours en cours. Tu seras prévenu quand il aura terminé.';
      }
      // Même formatage que la délivrance automatique : une seule formule, sinon
      // relire un résultat ne dirait pas la même chose que le recevoir.
      return formatAgentResultForParent({
        id: conv.id,
        status: st,
        intent: conv.agentIntent || '',
        text: lastAgentText(conv.messages),
        toolFailures: collectAgentToolFailures(conv.messages),
      });
    },
  },
  {
    name: 'agent__abort',
    description:
      "Interrompt un agent que tu as lancé et qui travaille encore. Son travail " +
      "partiel reste consultable. Utilise-le quand tu constates qu'il part dans une " +
      "mauvaise direction ou que sa tâche n'a plus lieu d'être.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifiant de l\'agent, rendu par agent__spawn' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    handler: (args, ctx) => {
      const conv = resolveOwnedAgent(args && args.id, toolCtx(ctx));
      if (!conv) return toolFail('agent__abort', AGENT_NOT_FOUND);
      if (agentStatus(conv.id) !== 'running') {
        return 'Agent ' + conv.id + ' : déjà terminé, rien à interrompre.';
      }
      // Statut posé AVANT l'abort : deliverAgentResult, appelé depuis le finally
      // du cycle de vie, relit le statut terminal du record. Le poser après
      // laisserait la délivrance retomber sur le défaut « aborted » du reload —
      // qui se trouve être la bonne valeur ici, mais par coïncidence.
      setAgentTerminalStatus(conv.id, 'aborted');
      abortStream(conv.id);
      _pendingToolAcks.push({ kind: 'agent_abort', convId: conv.id, title: conv.agentIntent || '' });
      return 'Agent ' + conv.id + ' interrompu.';
    },
  },
];

// ── Liste des outils délégables à un agent (X-e + X-i) ──────────────────────
// UN paramètre, une liste de noms d'outils : le modèle ne distingue pas les
// outils natifs des MCP, il voit une liste de noms préfixés. Jamais un second
// axe « serveurs » à tenir en phase avec le premier.
//
// Les quatre agent__* en sont exclus : agent__spawn par la borne de profondeur
// (X-b), les trois autres parce qu'un agent n'a pas d'enfants à consulter — les
// lui donner serait annoncer une capacité sans handle atteignable
// (project_model_facing_text_indicative_and_reachable).
function agentDelegatableToolNames() {
  return exposedTools().map(t => t.name).filter(n => n.indexOf('miaou__agent__') !== 0);
}

// Défaut de reasoning_effort annoncé ET appliqué (X-h). UNE fonction pour les
// deux usages : la description d'outil et le handler. Deux formules
// divergentes, c'est exactement le schéma qui promet ce que le code ne fait pas.
//
// `ctx` optionnel : hors génération (drawer d'outils, inspecteur de contexte),
// on retombe sur l'état d'écran via toolCtx — c'est le repli documenté, pas une
// lecture de globale déguisée.
function agentDefaultReasoningEffort(ctx) {
  const c = toolCtx(ctx);
  const conv = c.convId ? loadConversation(c.convId) : null;
  const convLevel = conv && conv.reasoningEffort;
  if (convLevel) return String(convLevel);
  try { return loadSettings().reasoningEffort || ''; } catch (e) { return ''; }
}

// Description dynamique d'agent__spawn. Appelée par toolDefinitions() : la
// description CHANGE avec le réglage de raisonnement de la conversation —
// invalidation KV PONCTUELLE au geste utilisateur, cas explicitement autorisé
// par le piège 16 (et déjà le régime d'intentTracing, qui modifie
// toolDefinitions() de la même façon).
//
// Le défaut est annoncé SANS dire que c'est le niveau courant du parent : le
// modèle lit une valeur par défaut comme dans n'importe quel schéma, et n'a
// aucune raison de se demander d'où elle sort. C'est ce qui évite d'ajouter au
// contexte une information sur LUI-MÊME, dont il tirerait des conclusions
// (motif payé en V-8).
function agentSpawnToolDef(ctx) {
  const effort = agentDefaultReasoningEffort(ctx);
  return {
    description:
      "Lance un agent : une sous-conversation autonome à qui tu confies une tâche " +
      "précise, et qui travaille en parallèle pendant que tu continues. Rend son " +
      "identifiant IMMÉDIATEMENT — ton tour continue, tu ne l'attends pas. Tu seras " +
      "prévenu automatiquement quand il aura terminé, avec son résultat. L'agent " +
      "démarre À FROID : il n'a ni ton historique ni ton contexte, seulement le " +
      "prompt que tu lui écris — celui-ci doit donc être autosuffisant. Il ne voit " +
      "aucun de tes fichiers non plus : pour qu'il travaille sur l'un d'eux, nomme " +
      "son handle dans `attachments`. Voir la " +
      "skill 'agents' pour rédiger un prompt d'agent et choisir sa trousse d'outils.",
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string',
          description: 'La tâche confiée, rédigée pour quelqu\'un qui n\'a AUCUN contexte : rappelle tout ce qui est nécessaire, y compris la forme de sortie attendue.' },
        intent: { type: 'string',
          description: 'Ce que tu demandes à l\'agent, en une phrase, tel que tu l\'expliquerais à l\'utilisateur — c\'est ce libellé qui s\'affichera dans la conversation à la place d\'un titre, parce qu\'un agent n\'est jamais titré.' },
        tools: { type: 'array', items: { type: 'string' },
          description: 'Noms des outils délégués à l\'agent (ex. "miaou__js__eval"). Par défaut AUCUN : nomme ce dont la tâche a besoin, et rien de plus. Un nom invalide te sera renvoyé avec la liste des noms valides.' },
        attachments: { type: 'array', items: { type: 'string' },
          description: 'Handles des fichiers mis à la disposition de l\'agent : att-N, file-<id> ou res_<id>, tels que TU les adresses. Par défaut AUCUN — un agent ne voit aucun de tes fichiers si tu ne les nommes pas ici, et tu ne peux pas non plus lui en recopier le contenu. Il les recevra sous des handles réécrits, listés dans ma réponse.' },
        reasoning_effort: { type: 'string',
          description: 'Effort de raisonnement de l\'agent' + (effort ? ' (par défaut : ' + effort + ')' : ' (par défaut : celui de l\'application)') + '. Une tâche mécanique se traite bien à un niveau bas.' },
      },
      required: ['prompt', 'intent'],
    },
  };
}

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
let _remoteStatus = {};  // { servername: { state:'connecting'|'ok'|'error', count, error?, sessionId?, unauthorizedUpstreams? } }

function getMcpStatus(name) { return _remoteStatus[name] || null; }

// La table entière, pour les consommateurs qui raisonnent sur TOUS les serveurs
// (pastille d'autorisation, revérification au retour de focus) plutôt que sur
// un seul. Fonction et non lecture directe de `_remoteStatus` : un `let` de
// portée fichier ne franchit pas la frontière dans le test runner, qui évalue
// chaque fichier séparément.
function mcpStatusSnapshot() { return _remoteStatus; }

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
//
// Les définitions DYNAMIQUES sont résolues ici (X-1e), pas chez l'appelant.
// `agent__spawn` porte `description: ''` et un `inputSchema` vide dans TOOLS :
// sa vraie définition est construite par `agentSpawnToolDef` (le défaut annoncé
// de `reasoning_effort` est le niveau courant de la conversation). Tant que
// cette résolution vivait dans `toolDefinitions`, le SEUL consommateur qui la
// voyait était le payload modèle — le drawer « Voir les outils exposés », qui
// lit `exposedTools()`, affichait donc `agent__spawn` sans description ni
// paramètre, comme un outil vide. La fonction s'appelle « exposedTools » : ce
// qu'elle rend doit être ce qui est réellement exposé, pour tous ses lecteurs.
// `ctx` optionnel : repli documenté de `toolCtx` quand l'appelant n'en a pas
// (le drawer n'en a pas — il décrit l'outil, il ne l'appelle pas).
function exposedTools(ctx) {
  const internal = TOOLS.map(t => {
    const dyn = t.name === 'agent__spawn' ? agentSpawnToolDef(ctx) : null;
    return {
      name: 'miaou__' + t.name,
      description: dyn ? dyn.description : t.description,
      inputSchema: dyn ? dyn.inputSchema : t.inputSchema,
    };
  });
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
    // Surface FACULTATIVE (lot AB-5) : `listed._meta` arrive dans le même objet
    // que `listed.tools`, donc sans requête ni changement de transport. Son
    // extraction est défensive par contrat — cette fonction dégrade
    // gracieusement, et une surface optionnelle ne doit jamais y déclencher la
    // branche d'erreur, qui masquerait TOUS les outils du serveur.
    //
    // Posée sur `_remoteStatus`, dont elle partage exactement la durée de vie et
    // l'origine : état de session, reconstruit à chaque connexion. La branche
    // d'erreur ci-dessous réécrit l'objet en entier, donc l'information
    // disparaît à la déconnexion — c'est le comportement voulu.
    _remoteStatus[s.name] = Object.assign(_remoteStatus[s.name] || {}, {
      state: 'ok', count: _remoteTools[s.name].length, error: null,
      unauthorizedUpstreams: unauthorizedUpstreamsFromList(listed),
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
// ── Contexte d'exécution d'un outil (lot T-1c) ──────────────────────────────
// Un outil s'exécute POUR une conversation et DANS un Espace — ceux de la
// génération qui l'a demandé, jamais ceux de l'écran. Avec N générations
// concurrentes (lot T), un conv__get / files__list / recall_attachment lancé par
// la génération de A pendant que l'écran affiche B répondrait dans le
// référentiel de B : mauvaise réponse, silencieuse, herméticité des Spaces
// comprise (piège 18).
//
// Le contexte transite en ARGUMENT EXPLICITE (arbitrage A1), jamais en variable
// de module : trois handlers sont `async` (files__promote, resource__create,
// resource__from_result) et tout état de module relu APRÈS leur premier `await`
// verrait le contexte d'une AUTRE génération — le bug d'origine sous une forme
// plus difficile à détecter.
//
// `toolCtx(ctx)` normalise et est LE seul point de lecture. Le repli sur les
// globales d'écran couvre les appels hors génération (drawer d'outils, tests) ;
// aucun site ne lit `currentConvId`/`activeSpaceId` directement — c'est
// vérifiable par grep, cf. docs/generations.md.
function toolCtx(ctx) {
  if (ctx && ctx.convId !== undefined && ctx.spaceId !== undefined) return ctx;
  return {
    convId: (ctx && ctx.convId !== undefined)
      ? ctx.convId
      : (typeof currentConvId !== 'undefined' ? currentConvId : null),
    spaceId: (ctx && ctx.spaceId !== undefined)
      ? ctx.spaceId
      : (typeof activeSpaceId !== 'undefined' ? activeSpaceId : DEFAULT_SPACE_ID),
  };
}

// Pose / retire les marqueurs de refus d'autorisation sur un ack (campagne AB).
// Extraits de callRemoteTool — qui est async et réseau, donc intestable en
// QuickJS — pour que l'invariant qui les lie soit vérifié plutôt que commenté :
// ces champs sont posés ENSEMBLE et retirés ENSEMBLE. En laisser un derrière au
// rejeu afficherait un lien « Autoriser » périmé sous un appel qui a réussi ;
// en oublier un à la pose donnerait un ack qu'`ackAuthorizationTarget` refuse
// sans rien dire.
//
// `data` est l'objet applicatif d'`error.data` (cf. mcpRpcAttempt), en
// snake_case comme tout ce qui vient du fil ; les champs d'ack sont en
// camelCase. Le renommage a lieu ICI, à la frontière, et nulle part ailleurs.
// Pures, testables en QuickJS.
function applyAuthorizationRefusal(ackEntry, errorCode, data, mcpServerName) {
  if (!ackEntry) return ackEntry;
  if (errorCode !== AUTHORIZATION_REQUIRED_ERROR_CODE) return ackEntry;
  ackEntry.errorCode = errorCode;
  if (data && data.authorization_url != null) ackEntry.authorizationUrl = data.authorization_url;
  if (data && data.upstream != null) ackEntry.upstream = data.upstream;
  // Le nom du serveur MCP configuré, pas son URL : celle-ci est résolue à
  // l'AFFICHAGE depuis la config (cf. _ackMcpServerUrl, ui.js). Figer l'URL ici
  // ferait pointer un ack relu vers l'adresse d'hier.
  if (mcpServerName) ackEntry.mcpServer = mcpServerName;
  return ackEntry;
}

// Texte du tool result quand un serveur MCP refuse faute d'autorisation.
//
// Le message serveur dit déjà l'essentiel (« exige une autorisation OAuth qui
// n'a pas encore été accordée »), mais il est rédigé à l'impératif sans nommer
// son destinataire : « Ouvrir ce lien pour l'accorder » se lit comme une
// consigne AU MODÈLE, qui n'a aucun moyen d'ouvrir quoi que ce soit — il n'y a
// aucun outil d'autorisation, et il n'y en aura pas (ce serait une initiative
// modèle là où seul l'utilisateur peut consentir). Un modèle qui prend cette
// phrase pour lui cherche l'outil, ne le trouve pas, et conclut de travers.
//
// D'où trois choses dites explicitement, qu'aucune ne soit à déduire :
// qui agit (l'utilisateur, pas le modèle), que le lien est DÉJÀ affiché (donc
// rien à transmettre ni à recopier), et que l'échec est temporaire (sinon le
// modèle raye la capacité de ses options et n'y revient plus).
//
// L'URL n'est PAS reprise ici : elle est dans le message serveur, qui suit, et
// la répéter la ferait apparaître deux fois dans le contexte — dont une dans
// une phrase que le modèle pourrait recopier dans sa réponse, remettant un lien
// d'origine réseau sur un chemin de rendu qui, lui, n'a pas la garde de
// `ackAuthorizationTarget`.
// Pure, testable en QuickJS.
function formatAuthorizationRefusalForModel(fullName, serverMessage) {
  return 'Erreur outil distant ' + fullName + ' : ' + (serverMessage || '') +
    '\n\nCet appel est en attente d\'une autorisation que seul l\'utilisateur peut ' +
    'accorder ; tu n\'as pas d\'outil pour le faire toi-même. Le lien nécessaire lui ' +
    'est déjà affiché dans la conversation — inutile de le lui transmettre. Signale-lui ' +
    'simplement que cette action requiert son autorisation, et poursuis avec ce que tu ' +
    'peux faire sans elle. Une fois l\'autorisation accordée, le même appel fonctionnera.';
}

function clearAuthorizationRefusal(ackEntry) {
  if (!ackEntry) return ackEntry;
  delete ackEntry.errorCode;
  delete ackEntry.authorizationUrl;
  delete ackEntry.upstream;
  delete ackEntry.mcpServer;
  return ackEntry;
}

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
    else if (reuseAckEntry) {
      delete ackEntry.error;              // rejeu réussi : échec transitoire effacé
      clearAuthorizationRefusal(ackEntry);   // les marqueurs d'autorisation suivent `error`
    }
    return { content, isError: !!(result && result.isError), ackEntry };
  } catch (e) {
    ackEntry.error = true;
    // errorCode porte le code machine brut (ex. REF_UNKNOWN) depuis err.data.code
    // (mcpRpcAttempt) — évite de dépendre du texte libre du message pour une
    // décision de rejeu ; ackEntry permet au rejeu de réutiliser la même ligne.
    // Ce champ du RÉSULTAT reste hors ACK_COPY_FIELDS : lu en synchrone par
    // l'appelant immédiat callDocsInflatedRemoteTool (hook d'inflation, brief A).
    const errorCode = e && e.data && e.data.code;
    // Refus d'autorisation (campagne AB) : le seul code qui doive SURVIVRE au
    // tour, parce qu'il n'appelle pas une décision de rejeu mais une action de
    // l'utilisateur — qui peut fort bien quitter la conversation et y revenir.
    // Il passe donc par l'ACK (persisté via ACK_COPY_FIELDS), là où le chemin
    // `result.errorCode` ci-dessus est éphémère par construction.
    //
    // `err.data` porte l'objet applicatif COMPLET (cf. mcpRpcAttempt), pas
    // seulement `code` : `authorization_url` et `upstream` sont déjà là, rien à
    // ajouter au transport.
    applyAuthorizationRefusal(ackEntry, errorCode, e && e.data, server && server.name);
    const serverMessage = (e && e.message) || e;
    // Le refus d'autorisation reçoit un texte propre (cf. sa fonction) : le
    // message serveur seul s'adresse mal au modèle. Tout autre échec garde la
    // forme historique.
    const text = errorCode === AUTHORIZATION_REQUIRED_ERROR_CODE
      ? formatAuthorizationRefusalForModel(fullName, serverMessage)
      : 'Erreur outil distant ' + fullName + ' : ' + serverMessage;
    return {
      content: [{ type: 'text', text }],
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
function callInternalTool(toolName, args, ctx) {
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) return { content: [{ type: 'text', text: toolFail(toolName, 'Outil inconnu : ' + toolName) }], isError: true };
  try {
    // ctx normalisé UNE fois ici : chaque handler le reçoit déjà résolu et n'a
    // plus aucune raison de lire une globale (ni de garde `typeof`).
    const text = tool.handler(args || {}, toolCtx(ctx));
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
function callTool(name, args, ctx) {
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
    const result = callInternalTool(internalName, cleanArgs, ctx);
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
    const cleanArgs = args ? Object.assign({}, args) : {};
    delete cleanArgs.miaou_intent;
    return callInternalTool(parsed.toolName, cleanArgs, ctx);
  }
  const server = getMcpServer(parsed.serverPrefix);   // storage.js
  if (!server || server.enabled === false) {
    return { content: [{ type: 'text', text: 'Serveur MCP inconnu ou désactivé : ' + parsed.serverPrefix }], isError: true };
  }
  const intent = args && typeof args.miaou_intent === 'string' ? args.miaou_intent : undefined;
  const serverArgs = args ? Object.assign({}, args) : {};
  delete serverArgs.miaou_intent;
  return callDocsInflatedRemoteTool(server, parsed.toolName, serverArgs, intent, ctx);
}

// ── Hook d'inflation dispatcher (brief A, D6 — moitié client du lot D) ───────
// Table d'état poussé/non-poussé par (conversationId, attId) : évite de
// réinjecter le contenu à chaque appel une fois le serveur docs l'a matérialisé
// en session. En mémoire uniquement (comme _remoteStatus/_remoteTools), pas de
// persistance — un rechargement de page revient à "non poussé", cohérent avec
// la session serveur elle-même éphémère (TTL sweep, brief D D2).
let _attachmentPushState = {};
function _conversationScopedPushKey(conversationId, attId) { return (conversationId || '') + '|' + attId; }
function isAttachmentPushed(conversationId, attId) { return !!_attachmentPushState[_conversationScopedPushKey(conversationId, attId)]; }
function markAttachmentPushed(conversationId, attId) { _attachmentPushState[_conversationScopedPushKey(conversationId, attId)] = true; }
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
function isResourcePushed(conversationId, resId) { return !!_resourcePushState[_conversationScopedPushKey(conversationId, resId)]; }
function markResourcePushed(conversationId, resId) { _resourcePushState[_conversationScopedPushKey(conversationId, resId)] = true; }
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
// no-hardcode que DOCS_DOCTRINE (nommage par contrat) : aucun nom de serveur ni
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

// Extrait le texte d'un fichier binaire de bibliothèque pour la description D7.
// Deux chemins depuis V-1 : archive zip → listing natif (voir la bifurcation en
// tête de corps), sinon le contrat d'inflation serveur ci-dessous.
// Chemin serveur : même contrat d'inflation que le hook dispatcher (§4), en appel
// APPLICATIF direct (mcpRpc, pas callRemoteTool) : aucun ack ne doit apparaître
// dans un thread (l'ingestion peut survenir hors de toute conversation
// ouverte, ex. upload direct depuis l'écran Space). `session_id` synthétique
// dédié (PAS un id de conversation — l'ingestion n'en a pas forcément une) :
// le serveur mcp_docs traite chaque session comme un répertoire de travail
// isolé, une valeur stable par fichier suffit à ne pas collisionner. Retourne
// le texte extrait (tronqué au cap fourni) ou null si aucun outil ne qualifie
// ou si l'appel échoue (dégradé, jamais bloquant — cf. D7 "pas de queue/retry").
// `out` (objet optionnel) : canal de retour annexe traversant, lot V-9. Passé tel
// quel au describer de la table ; seul le PDF y écrit aujourd'hui (`scanned`),
// et un describer qui l'ignore ne change rien. L'appelant (describeFileIfNeeded)
// s'en sert pour décider s'il vaut la peine de rendre une image de la page 1.
async function extractBinaryFileTextForDescription(record, maxChars, out) {
  // Bifurcation par type EN AMONT du chemin serveur (lot V-1, §6 du brief) :
  // une archive zip se décrit par la LISTE de son contenu (noms + tailles
  // décompressées indicatives), jamais par le contenu d'un membre — décision
  // Julien. Le listing natif produit exactement ça sans rien décompresser (le
  // central directory suffit), donc sans charger fflate. Placé avant
  // findDocsInflationTool() pour que MIAOU seul, sans serveur compagnon,
  // décrive quand même ses archives : le dégradé du chemin serveur ne doit pas
  // masquer un format que le natif SAIT traiter (leçon U-1 — un console.warn
  // sur un chemin d'infrastructure achète du silence, pas de la robustesse).
  // Posture du chemin préservée : aucun ack (l'ingestion peut survenir hors
  // conversation), jamais bloquant.
  //
  // V-4 : le PDF rejoint cette bifurcation (décision 3). Un fichier de
  // bibliothèque décrit par son CONTENU vaut infiniment mieux qu'un mime et une
  // taille, et la version serveur savait déjà le faire — le natif doit suivre,
  // sinon rapatrier le PDF ferait RÉGRESSER la description.
  //
  // Ce que ça implique et qu'on assume : ce chemin tourne hors conversation, au
  // dépôt d'un fichier, et déclenchera donc le lazy-load de 1,4 Mo de pdf.js
  // sans qu'aucune conversation ne l'ait demandé. La variante « seulement si
  // pdf.js est déjà chargé » a été ÉCARTÉE : elle rendait la description non
  // déterministe, ce qui est pire qu'un téléchargement.
  const u8 = record && record.data ? new Uint8Array(record.data) : null;
  const kind = u8 ? sniffDocumentKind(u8, record.name) : null;   // utils.js, pur

  // V-5 : l'Excel puis le Word rejoignent la bifurcation, pour la même raison
  // que le PDF en V-4 (décrire par le CONTENU plutôt que par le mime) — et de
  // façon plus tranchée encore : le listing zip d'un .xlsx ou d'un .docx ne
  // montre que sa plomberie XML.
  //
  // Table plutôt que cascade de `kind !== 'x' && kind !== 'y'` : c'est le même
  // motif que DOC_READERS, et pour la même raison. La cascade s'allonge d'un
  // terme par format, et chaque terme oublié fait silencieusement retomber un
  // format sur son listing zip — l'exact défaut qu'on vient de corriger.
  const describer = DOC_DESCRIBERS[kind];
  if (kind && !describer) {
    const zipEntries = parseZipCentralDirectory(u8);
    if (zipEntries) return formatZipListing(zipEntries, { maxBytes: MAX_INLINE_BYTES }).slice(0, maxChars);
  }

  if (describer) {
    const text = await describer(u8, maxChars, out);
    if (text) return text;
    // Échec de lazy-load ou document illisible : on RETOMBE sur le chemin
    // serveur plutôt que d'abandonner. Un serveur branché sait peut-être le
    // lire, et le dégradé de ce chemin est « description vide », jamais
    // « dépôt refusé ».
  }

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
// Décision pure : ce record peut-il être ramené en PIXELS dans le contexte ?
// (lot X-1d). Extraite du handler (async, non testable en QuickJS via callTool)
// pour rester couverte — même motif que validateFilesPromoteArgs.
//
// Le seul chemin qui met des pixels dans un contexte est celui du piège 19
// (ack `attachment_recalled` + `attId` → resolveRecallImages → message user
// synthétique). Il est adressé par `attId`, jamais par id de record : une image
// stockée par `_storeBlock` (fetch_url, docs__extract) n'en a donc AUCUN et
// reste hors du chemin, alors que le modèle en détient le handle et lit une
// doctrine qui lui dit qu'il sait examiner des images. Capacité annoncée sans
// prise (project_model_facing_text_indicative_and_reachable).
// Retourne '' si le rappel est possible, sinon le message de refus.
function recallableImageError(record) {
  if (!record) return 'Pièce jointe introuvable (identifiant inconnu ou non disponible en session).';
  if (!record.data) return 'Contenu indisponible en session pour ce handle.';
  return '';
}

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
function resolveHandleRecord(ref, ctx) {
  const c = toolCtx(ctx);
  const family = classifyHandleRef(ref);
  // DÉROGATION D'AGENT (X-1b), AVANT tout lookup de famille. Un agent démarre
  // dans SA conversation : les handles du parent n'y résolvent rien, et le
  // partage passe donc par une table FIGÉE au spawn (alias res_… → id de record
  // réel). Placée en tête parce qu'un alias a la forme d'un res_… : sans cela,
  // le lookup `resource` répondrait le premier — et il répondrait null (l'alias
  // n'est l'id d'aucun record), donc l'ordre n'est pas une commodité, il décide.
  //
  // Ce n'est PAS un élargissement de scope : agentDelegatedFilesOf rend [] pour
  // toute conversation racine, et la table ne contient que ce que le parent a
  // NOMMÉ. Un agent n'atteint rien de plus — même posture que la trousse
  // d'outils, où le non-délégué est absent plutôt que refusé.
  const delegatedId = resolveDelegatedRecordId(ref, agentDelegatedFilesOf(c.convId));
  if (delegatedId) return getCachedRecord(delegatedId) || null;
  if (family === 'att') {
    return getCachedRecordByAttId(ref, c.convId) || null;
  }
  if (family === 'file') {
    const recordId = parseLibraryRef(ref);   // resources.js (chargé avant)
    const record = recordId ? getCachedRecord(recordId) : null;
    if (!record || record.kind !== 'library' || record.spaceId !== c.spaceId) return null;
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
// Lot L-2 : les quatre primitives prennent désormais une clé OBLIGATOIRE — celle
// sous laquelle le modèle a rangé la ressource dans input_handles. Pas de forme
// sans argument conservée en raccourci : une seule syntaxe à documenter, et un
// text() nu sur un appel à deux ressources serait une ambiguïté silencieuse.
// La mémoïsation passe du scalaire à un objet indexé par clé (chaque ressource
// n'est marshalée du host qu'une fois, même relue plusieurs fois dans le code).
const JS_EVAL_GUEST_PRELUDE =
  "var __t = {};\n" +
  "function text(key){ if(!(key in __t)){__t[key]=__miaou_text(key);} return __t[key]; }\n" +
  "function lines(key){ return text(key).replace(/\\r\\n/g,'\\n').replace(/\\r/g,'\\n').split('\\n'); }\n" +
  "function jsonLines(key){ var out=[]; var ls=lines(key); for(var i=0;i<ls.length;i++){ var s=ls[i]; if(!s) continue; try{ out.push(JSON.parse(s)); }catch(e){} } return out; }\n" +
  "function parse(key){ return JSON.parse(text(key)); }\n";

// Cinquième primitive (lot Y), AJOUTÉE AU PRÉLUDE UNIQUEMENT quand l'appel porte
// un `output_handle`. C'est la seule primitive d'ÉCRITURE de la surface guest, et
// la seule addition à la liste fermée du piège 25 — au-dessus d'un host bridge
// DÉDIÉ (`__miaou_emit`), jamais d'une extension de `__miaou_text` : le pont
// d'entrée reste ce qu'il était, on en ouvre un second, explicitement, pour la
// sortie. Aucun autre pont.
//
// TRANCHÉ (PLAN-Y étape 2, recommandation suivie) : `emit` n'est PAS défini quand
// `output_handle` est absent. Un `ReferenceError: emit is not defined` remonte au
// modèle par le chemin d'erreur guest normal et lui dit exactement ce qui manque ;
// une primitive toujours présente mais no-op documenterait un comportement muet
// qui inviterait à l'appeler sans handle, et perdrait le travail en silence.
const JS_EVAL_EMIT_PRELUDE =
  "function emit(chunk){ __miaou_emit(String(chunk)); }\n";

// Exécute le code modèle dans un bac à sable QuickJS-WASM sur les textes fournis
// (`texts` : objet {clé: string}, une à JS_EVAL_MAX_INPUTS entrées depuis le lot
// L-2 ; le handler a déjà résolu et décodé chaque handle) (lot L, cœur impur — NON testable QuickJS, vérif runtime L3). Discipline VM
// stricte : tous les handles créés côté host sont disposés en try/finally, le
// runtime porte les guards (setInterruptHandler wall-time, setMemoryLimit), la
// sortie est bornée APRÈS dump (checkOutputCap). Retourne un objet discriminé :
//   { ok:true, output }                    — succès, `output` = string bornée
//   { ok:false, reason:'cap', len, cap }   — sortie trop grosse (REFUS §3)
//   { ok:false, reason:'error', message }  — throw guest / timeout / OOM
// L'appelant (handler js__eval) transforme chaque cas en tool result texte.
// Sécurité (parenté piège 23) : le monde guest est CLOS — on n'injecte QUE
// __miaou_text (host, élargi à un argument `key` au lot L-2 — élargi, PAS
// dédoublé) et, SI et seulement si un `emit` est demandé (lot Y),
// __miaou_emit ; jamais fetch, DOM, globalThis hôte, ni aucun autre pont.
// Équivalent QuickJS du « jamais allow-same-origin » de l'iframe. Ne JAMAIS
// élargir cette surface sans repenser la posture.
//
// Lot Y — `opts.emit` (booléen) active la primitive de sortie. Ce qui est émis
// est BUFFERISÉ CÔTÉ HOST (jamais accumulé dans le guest : la mémoire VM est
// bornée par JS_EVAL_MEM_BYTES et déjà partagée avec le texte d'entrée — y
// accumuler la sortie recréerait exactement le plafond que cette feature existe
// pour lever), puis retourné TEL QUEL à l'appelant dans `emitted`. Cette
// fonction NE TOUCHE PAS au stockage : c'est le handler js__eval qui décide
// d'écrire, en un seul _appendBlock. Séparation voulue — la VM reste de la
// plomberie sans dépendance IDB.
//
// `emitted` est renseigné dans TOUS les cas de retour, succès comme échec :
// cf. la doctrine de flush, côté handler.
async function runInQuickJs(texts, code, opts) {
  const timeoutMs = opts && opts.timeoutMs != null ? opts.timeoutMs : JS_EVAL_TIMEOUT_MS;
  const memBytes = opts && opts.memBytes != null ? opts.memBytes : JS_EVAL_MEM_BYTES;
  const cap = opts && opts.cap != null ? opts.cap : JS_EVAL_OUTPUT_CAP;
  const wantEmit = !!(opts && opts.emit);

  const QuickJS = await ensureQuickJs();   // ui.js — lazy-load, rejet propagé en erreur d'outil
  const ctx = QuickJS.newContext();
  const rt = ctx.runtime;
  let textFn = null;
  let emitFn = null;
  // Buffer LOCAL À L'APPEL (jamais un état de module — deux générations
  // concurrentes peuvent exécuter du js__eval en parallèle, piège 28).
  const buffered = [];
  const emittedSoFar = () => buffered.join('');
  try {
    rt.setMemoryLimit(memBytes);
    const start = Date.now();
    rt.setInterruptHandler(() => Date.now() - start > timeoutMs);

    // UNIQUE pont host→guest d'ENTRÉE : renvoie le contenu textuel décodé de la
    // ressource rangée sous `key`. newString crée un handle host qu'il FAUT
    // disposer (retourné au guest qui en prend copie).
    //
    // Lot L-2 : la signature est ÉLARGIE (un argument `key`), PAS doublée d'un
    // second pont — le compte de ctx.newFunction reste à deux, et un test le
    // vérifie (piège 25). Une clé absente lève une exception CATCHABLE côté guest
    // via le protocole { error: handle } de quickjs-emscripten (`ctx.throwError`
    // n'existe pas en 0.32.0, vérifié en spike sur la version gelée) : le modèle
    // reçoit un vrai throw JS qu'il peut corriger, jamais un undefined silencieux
    // qui produirait un résultat faux d'apparence valide.
    textFn = ctx.newFunction('__miaou_text', keyHandle => {
      const key = ctx.getString(keyHandle);
      if (!Object.prototype.hasOwnProperty.call(texts, key)) {
        return { error: ctx.newError('Clé "' + key + '" absente de input_handles (clés fournies : ' +
          Object.keys(texts).join(', ') + ').') };
      }
      return ctx.newString(texts[key]);
    });
    ctx.setProp(ctx.global, '__miaou_text', textFn);

    // SECOND pont (lot Y), présent seulement sur demande : sortie guest→host.
    // Le chunk est marshalé immédiatement (ctx.getString) et empilé côté host ;
    // rien n'est conservé côté guest. Retourne undefined au guest (ctx.undefined
    // est une valeur constante du contexte, pas un handle à disposer).
    if (wantEmit) {
      emitFn = ctx.newFunction('__miaou_emit', chunkHandle => {
        buffered.push(ctx.getString(chunkHandle));
        return ctx.undefined;
      });
      ctx.setProp(ctx.global, '__miaou_emit', emitFn);
    }

    // Prélude (définit text/lines/jsonLines/parse) puis code modèle : évalués
    // ensemble en mode GLOBAL, la dernière valeur du code est le retour. Le
    // prélude est neutre (déclarations, completion-value undefined), le résultat
    // vient de la completion-value du dernier statement du `code`. PAS d'enveloppe
    // IIFE : dans une fonction, un statement d'expression (`lines().length`) n'est
    // PAS retourné sans `return` explicite — l'IIFE forçait donc undefined et
    // contredisait la doctrine « dernière valeur évaluée ». En mode global d'une
    // VM jetable, isoler les `var` du modèle n'apporte rien (aucun état ne survit).
    const prelude = JS_EVAL_GUEST_PRELUDE + (wantEmit ? JS_EVAL_EMIT_PRELUDE : '');
    const res = ctx.evalCode(prelude + '\n' + code);
    if (res.error) {
      const errObj = ctx.dump(res.error);   // { name, message, stack } — objet, pas string
      res.error.dispose();
      return { ok: false, reason: 'error', message: _jsEvalErrText(errObj), emitted: emittedSoFar() };
    }
    // Marshale le retour ; sérialise en JSON si ce n'est pas déjà une string
    // (un objet/tableau doit sortir en texte lisible, cf. doctrine SORTIE).
    const val = ctx.dump(res.value);
    res.value.dispose();
    const output = typeof val === 'string' ? val : _jsEvalStringify(val);
    const capped = checkOutputCap(output, cap);   // utils.js — REFUS, pas troncature
    if (!capped.ok) return { ok: false, reason: 'cap', len: capped.len, cap: capped.cap, emitted: emittedSoFar() };
    return { ok: true, output, emitted: emittedSoFar() };
  } catch (e) {
    // Interruption (timeout) et OOM se manifestent soit en res.error ci-dessus,
    // soit en throw host selon l'engine — filet ici pour les deux. `emitted` est
    // renseigné ici AUSSI : c'est précisément le cas (timeout après 900 lignes
    // sur 1000) où le travail partiel a le plus de valeur.
    return { ok: false, reason: 'error', message: _jsEvalErrText((e && e.message) || String(e)),
      emitted: emittedSoFar() };
  } finally {
    if (textFn) textFn.dispose();
    if (emitFn) emitFn.dispose();
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
function _resolveInflationRef(ref, ctx) {
  const c = toolCtx(ctx);
  const record = resolveHandleRecord(ref, c);
  if (!record) return null;
  const activeId = c.convId;
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
    const spaceId = c.spaceId;
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
async function callDocsInflatedRemoteTool(server, toolName, args, intent, ctx) {
  const ref = args && typeof args.ref === 'string' ? args.ref : null;
  const capable = ref && toolDeclaresAttachmentInflation(server, toolName);
  if (!capable) return callRemoteTool(server, toolName, args, intent);

  const resolved = _resolveInflationRef(ref, ctx);
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
// `allow` (lot X-1) : liste BLANCHE de noms d'outils exposés à CET envoi, ou
// null/undefined pour tout exposer (le cas de toute conversation ordinaire).
// C'est ce paramètre qui restreint le payload d'un agent — les outils non
// délégués ne sont pas « appelables et refusés », ils sont ABSENTS du payload.
// `ask_confirmation` suit la même règle : un agent n'a pas d'utilisateur à qui
// poser une question, l'exposer serait annoncer un handle inatteignable.
//
// `ctx` (lot X-1) : contexte d'exécution pour les descriptions dynamiques
// (agent__spawn annonce le niveau de raisonnement courant, X-h). Optionnel — le
// repli sur l'écran est celui de toolCtx, documenté.
function toolDefinitions(allow, ctx) {
  const intentEnabled = !!loadSettings().intentTracing;
  const intentProp = { type: 'string', title: 'Intention', description: 'Phrase courte décrivant le but de l\'appel, pour l\'utilisateur.' };
  const allowSet = Array.isArray(allow) ? new Set(allow) : null;
  // Les définitions dynamiques (agent__spawn) sont déjà résolues par
  // exposedTools(ctx) — d'où le ctx passé ici. UNE source pour la description
  // et pour le handler (agentDefaultReasoningEffort) : deux formules
  // divergentes seraient le schéma qui promet ce que le code ne fait pas.
  const mcpDefs = exposedTools(ctx)
    .filter(t => !allowSet || allowSet.has(t.name))
    .map(t => {
    const schema = t.inputSchema;
    const params = intentEnabled
      ? Object.assign({}, schema, {
          properties: Object.assign({}, schema.properties || {}, { miaou_intent: intentProp }),
        })
      : schema;
    return { type: 'function', function: { name: t.name, description: t.description, parameters: params } };
  });
  return allowSet ? mcpDefs : mcpDefs.concat([ASK_CONFIRMATION_DEF]);
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
