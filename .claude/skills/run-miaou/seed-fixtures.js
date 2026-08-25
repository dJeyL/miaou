// Fixtures de développement MIAOU — module ES, consommé par les scripts verify/shot.
//
// Remplace l'ancien `tests/dev-seed.html` (lot U-5). L'enveloppe HTML a disparu
// — plus personne n'ouvrait le fichier à la main, Playwright a remplacé l'usage
// manuel — et les consommateurs n'extraient plus le `<script>` par regex : ils
// importent ce module et passent ses fonctions à `page.evaluate`.
//
// **Les fixtures sont portées à l'identique** depuis `dev-seed.html` : plusieurs
// verify (au premier chef `verify-refactor`) portent des assertions chiffrées
// dessus (nombre de conversations en sidebar, sections, comptes d'acks). Ne pas
// les réécrire au jugé.
//
// Depuis le lot U, conversations et résumés vivent en **IndexedDB** (base
// `miaou`, stores `conversations`/`summaries`), plus en localStorage : le seed
// écrit donc en IDB pour ces deux-là. Souvenirs et Espaces restent en
// localStorage, leur taille étant bornée.
//
// Usage typique dans un verify :
//
//   import { seedAll, SEED_DATA } from './seed-fixtures.js';
//   await seedAll(page);            // conversations + résumés + souvenirs +
//                                   // Espaces + skills + pièces jointes
//   await page.reload();
//
// ou, pour ne semer que l'historique (pas d'IDB resources/skills) :
//
//   await seedConversations(page);
//
// Toutes les fonctions sont **idempotentes** (ids fixes, `put` IDB, garde de
// présence côté localStorage) : un second appel ne duplique rien.

const MODEL = 'gemma4:26b-nvfp4';
const SERVER = 'Par défaut';   // provenance (champ server des messages assistant)

// ── Spaces (lot C) : un second Space « Pro » pour exercer l'herméticité ──────
// seed-01..seed-05 (réseau/backend) partent dans ce Space ; le reste (default
// Space, implicite) sert de contrôle pour vérifier l'isolation bidirectionnelle
// sidebar/recherche/outils. Id fixe → idempotent comme le reste des seeds.
const SPACE_SEED_ID = 'space-seed-pro';
const SPACE_SEED_CONV_IDS = ['seed-01', 'seed-02', 'seed-03', 'seed-04', 'seed-05'];

// IDs fixes → idempotent (re-run ne duplique pas)
const SEEDS = [
  {
    id: 'seed-01',
    title: "Reverse proxy Caddy et Let's Encrypt",
    messages: [
      { role: 'user',      content: "J'essaie de configurer Caddy comme reverse proxy devant mon app Node. Mon Caddyfile : `myapp.example.com { reverse_proxy localhost:3000 }`. Ça marche mais le HTTPS ne se renouvelle pas automatiquement." },
      { role: 'assistant', content: "Le renouvellement auto est géré par le module ACME intégré de Caddy. Deux choses peuvent le bloquer : le port 80 doit être accessible depuis l'extérieur (validation HTTP-01), et Caddy doit avoir les droits d'écriture sur son répertoire de données. Vérifie `journalctl -u caddy -f`. Si tu es derrière un NAT, il faut soit forwarder le 80, soit passer en DNS-01. Quel est ton contexte réseau ?" },
      { role: 'user',      content: "Je suis derrière un NAT. Le routeur forward le 443 mais pas le 80." },
      { role: 'assistant', content: "C'est ça le problème — HTTP-01 exige le port 80. Solutions : forwarder le 80 aussi (juste pour la validation ACME), ou DNS-01 si ton registrar a une API. Caddy a des plugins DNS-01 pour Cloudflare, OVH, Namecheap… Lequel utilises-tu ?" },
    ],
    summary: "Configuration de Caddy comme reverse proxy avec renouvellement automatique Let's Encrypt. Problème de port 80 inaccessible derrière NAT. Solutions : forwarding port 80 ou challenge DNS-01 via plugin Caddy.",
    keywords: ['caddy', 'reverse-proxy', 'lets-encrypt', 'acme', 'nat', 'port-80', 'dns-01', 'certificat', 'https', 'tls'],
  },
  {
    id: 'seed-02',
    title: 'Asyncio — event loop bloqué dans FastAPI',
    messages: [
      { role: 'user',      content: "Mon API FastAPI rame sur certaines requêtes. J'ai une fonction async qui appelle une librairie externe et ça bloque tout l'event loop." },
      { role: 'assistant', content: "Si la lib n'est pas async-native, ses appels sont bloquants et gèlent l'event loop entier. Solution : `await asyncio.to_thread(ma_fonction, args)` (Python 3.9+). Pour des tâches CPU-bound, un ProcessPoolExecutor contourne le GIL. `run_in_executor(None, ...)` fonctionne aussi si tu es en 3.8." },
      { role: 'user',      content: "J'utilise Python 3.11, donc `to_thread` c'est bon. Comment confirmer que c'est bien ça qui bloque ?" },
      { role: 'assistant', content: "Installe `py-spy` et profile avec `py-spy top --pid <pid>`. Autre approche : baisser `asyncio.get_event_loop().slow_callback_duration` (défaut 0.1s) pour faire logger automatiquement les callbacks lents. Un middleware FastAPI qui log le temps de chaque requête aide aussi à isoler les endpoints coupables." },
    ],
    summary: "Diagnostic et résolution d'un blocage d'event loop asyncio dans FastAPI causé par une librairie synchrone. Utilisation d'asyncio.to_thread() pour déléguer au ThreadPoolExecutor. Outils de debug : py-spy, slow_callback_duration.",
    keywords: ['python', 'asyncio', 'fastapi', 'event-loop', 'to-thread', 'run-in-executor', 'blocage', 'py-spy', 'performance', 'threadpool'],
  },
  {
    id: 'seed-03',
    title: 'Git rebase interactif avant PR',
    messages: [
      { role: 'user',      content: "J'ai 12 commits sur ma branche dont 8 sont des « fix typo » ou « wip ». Je veux squasher tout ça avant d'ouvrir la PR." },
      { role: 'assistant', content: "`git rebase -i main`. Dans l'éditeur, laisse le premier commit en `pick` et remplace les suivants par `f` (fixup) pour les WIP — ça jette les messages automatiquement, contrairement à `s` (squash) qui les concatène. Si la branche est déjà poussée : `git push --force-with-lease` ensuite (plus sûr que `--force`)." },
      { role: 'user',      content: "Et si je veux garder 3 commits logiques au lieu d'un seul ?" },
      { role: 'assistant', content: "Même commande, tu organises librement : regroupe avec `s`/`f` après les bons `pick`, réordonne en bougeant les lignes, renomme avec `reword`. Conseil : `git branch backup-avant-rebase` avant — ça coûte rien et sauve parfois." },
    ],
    summary: "Utilisation de git rebase interactif pour nettoyer une branche avant PR. Commandes squash/fixup/reword, push avec --force-with-lease, stratégie de sauvegarde de branche préalable.",
    keywords: ['git', 'rebase', 'squash', 'fixup', 'interactive', 'pr', 'force-with-lease', 'branche', 'historique', 'commit'],
  },
  {
    id: 'seed-04',
    title: 'Optimisation requête PostgreSQL lente',
    messages: [
      { role: 'user',      content: "J'ai une requête qui prend 4 secondes sur une table de 2 M de lignes. J'ai un index sur `user_id` mais il ne semble pas utilisé." },
      { role: 'assistant', content: "Lance `EXPLAIN (ANALYZE, BUFFERS) ta_requête;`. Si tu vois `Seq Scan` là où tu attends `Index Scan`, PostgreSQL a peut-être des stats obsolètes (`ANALYZE ta_table`), ou la sélectivité estimée est mauvaise. Vérifie aussi les types : un cast implicite entre le paramètre et la colonne empêche l'utilisation de l'index." },
      { role: 'user',      content: "J'ai un Seq Scan. EXPLAIN dit « rows=1800000 » alors que la requête n'en ramène que 50." },
      { role: 'assistant', content: "L'estimation à 1,8 M sur 2 M signifie que PostgreSQL pense que ta condition filtre presque rien — il préfère le seq scan. Lance `ANALYZE ta_table` puis relance EXPLAIN. Si ça ne change pas, la distribution est très non-uniforme (quelques user_id représentent 90 % des lignes) : envisage un index partiel ou `CREATE STATISTICS`." },
    ],
    summary: "Diagnostic d'une requête PostgreSQL lente (4s / 2M lignes) malgré un index sur user_id. EXPLAIN ANALYZE révèle un Seq Scan causé par des statistiques obsolètes ou une sélectivité mal estimée. Pistes : ANALYZE, index partiel, statistiques étendues.",
    keywords: ['postgresql', 'sql', 'index', 'explain-analyze', 'seq-scan', 'optimisation', 'statistiques', 'sélectivité', 'performance', 'requête'],
  },
  {
    id: 'seed-05',
    title: 'Docker Compose — communication inter-services',
    messages: [
      { role: 'user',      content: "J'ai deux services dans mon docker-compose.yml : une app Node et une DB Postgres. L'app ne réussit pas à joindre la DB sur localhost." },
      { role: 'assistant', content: "Les conteneurs ne partagent pas le même localhost. Utilise le nom du service comme hostname : si ton service Postgres s'appelle `db`, la connection string sera `postgresql://user:pass@db:5432/mydb`. Docker Compose crée un réseau bridge par défaut et enregistre chaque service par son nom." },
      { role: 'user',      content: "Ça marche ! Maintenant je veux que seule l'app soit accessible depuis l'extérieur, pas la DB." },
      { role: 'assistant', content: "Par défaut Postgres n'est pas exposé si tu ne déclares pas de `ports` pour lui. Mets `ports: [\"3000:3000\"]` uniquement sur ton service Node. La DB reste joignable en interne depuis l'app mais pas depuis l'hôte. Tu peux ajouter `ports: [\"5432:5432\"]` temporairement pour du debug et le retirer en prod." },
    ],
    summary: "Problème de communication entre services Docker Compose : l'app Node ne peut pas joindre Postgres via localhost. Solution : utiliser le nom du service comme hostname. Exposition sélective des ports vers l'extérieur.",
    keywords: ['docker', 'docker-compose', 'networking', 'postgres', 'bridge', 'ports', 'hostname', 'conteneur', 'réseau', 'isolation'],
  },
  {
    id: 'seed-06',
    title: 'SSH port forwarding via bastion',
    messages: [
      { role: 'user',      content: "Je dois accéder à une interface web sur le port 8080 d'un serveur interne, accessible seulement depuis un bastion SSH. Comment faire ?" },
      { role: 'assistant', content: "Forwarding local : `ssh -L 8080:serveur-interne:8080 user@bastion`. Ensuite `localhost:8080` dans ton navigateur passe par le bastion. Pour un tunnel persistant en arrière-plan : `ssh -fNL 8080:serveur-interne:8080 user@bastion` (`-N` = pas de shell, `-f` = background)." },
      { role: 'user',      content: "Et si je veux que des collègues sur mon réseau local puissent aussi utiliser ce tunnel ?" },
      { role: 'assistant', content: "Par défaut `-L` écoute seulement sur localhost. Ajoute le bind address : `ssh -L 0.0.0.0:8080:serveur-interne:8080 user@bastion`. Ton port 8080 devient accessible depuis tout ton réseau. Assure-toi que le firewall de ta machine laisse passer ce port — et réserve ça à un réseau de confiance." },
    ],
    summary: "SSH port forwarding local pour accéder à un service interne via bastion. Options -fN pour tunnel persistant en arrière-plan. Extension du bind address (0.0.0.0) pour partager le tunnel avec le réseau local.",
    keywords: ['ssh', 'tunnel', 'port-forwarding', 'bastion', 'local-forward', 'réseau-interne', 'bind-address', '-fN', 'sécurité', 'accès-distant'],
  },
  {
    id: 'seed-07',
    title: 'TypeScript — génériques et contraintes',
    messages: [
      { role: 'user',      content: "J'ai du mal avec les contraintes de génériques TypeScript. Quand utiliser `extends` dans un type générique ?" },
      { role: 'assistant', content: "`extends` dans un générique contraint les valeurs acceptées. `function foo<T extends string>(x: T)` signifie que T doit être assignable à string. Cas courants : `<T extends object>` pour exclure les primitifs, `<T extends { id: string }>` pour garantir une propriété. Sans contrainte, TypeScript sait seulement que T est « quelque chose » et n'autorise aucune opération dessus." },
      { role: 'user',      content: "Et `infer`, c'est quoi ?" },
      { role: 'assistant', content: "`infer` extrait un type depuis une structure conditionnelle. Exemple : `type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never` — si T est une fonction, R est inféré comme son type de retour. `infer` ne fonctionne que dans les types conditionnels, dans la partie pattern (`extends X`). C'est la base de tous les utilitaires avancés :\n\n| Utilitaire | Extrait |\n|---|---|\n| `ReturnType<T>` | type de retour d'une fonction |\n| `Parameters<T>` | tuple des paramètres d'une fonction |\n| `InstanceType<T>` | type d'instance d'un constructeur |\n| `Awaited<T>` | type résolu d'une Promise |" },
    ],
    summary: "Explication des génériques TypeScript avec contraintes (extends) et inférence de types (infer). Cas d'usage : contraindre des paramètres génériques, extraire des types de retour depuis des signatures de fonctions.",
    keywords: ['typescript', 'generics', 'extends', 'infer', 'contrainte', 'type-conditionnel', 'returntype', 'parameters', 'utilitaires', 'typage'],
  },
  {
    id: 'seed-08',
    title: 'Cron — syntaxe et debugging',
    messages: [
      { role: 'user',      content: "Mon cron job ne s'exécute pas. Ma ligne : `* 8 * * * /home/julien/scripts/backup.sh`. Elle devrait tourner à 8h." },
      { role: 'assistant', content: "`* 8 * * *` tourne toutes les minutes entre 8h00 et 8h59. Pour exactement 8h00 : `0 8 * * *`. Vérifie aussi que le script est exécutable (`chmod +x`) et que son shebang est correct. Les crons tournent avec un PATH minimal — si ton script appelle des binaires en chemin relatif, ça échoue silencieusement." },
      { role: 'user',      content: "Ah oui, `0 8` c'était ça. Comment voir les logs pour confirmer que ça tourne ?" },
      // « ornithorynque » : mot distinctif présent uniquement ici (absent du
      // titre, du résumé et des keywords) — sert de test manuel pour la
      // recherche plein texte (feature D) : retrouver cette conversation en
      // tapant ce mot alors qu'il n'apparaît nulle part ailleurs.
      { role: 'assistant', content: "`journalctl -u cron` ou `grep CRON /var/log/syslog`. Pour capturer la sortie du script : `0 8 * * * /home/julien/scripts/backup.sh >> /tmp/backup.log 2>&1`. Le `2>&1` capture aussi stderr. Pour simuler l'environnement cron (private joke d'équipe : le serveur de test s'appelle ornithorynque) : `env -i HOME=/home/julien PATH=/usr/bin:/bin bash /home/julien/scripts/backup.sh`." },
    ],
    summary: "Correction d'une syntaxe crontab (0 8 au lieu de * 8 pour 8h00 pile). Debug via journalctl/syslog, redirection stdout+stderr en fichier, simulation de l'environnement cron minimal avec env -i.",
    keywords: ['cron', 'crontab', 'linux', 'scheduling', 'bash', 'logs', 'journalctl', 'syslog', 'debug', 'environnement'],
  },
  {
    id: 'seed-09',
    title: 'Pagination API REST : cursor vs offset',
    messages: [
      { role: 'user',      content: "Je dois implémenter la pagination sur mon API. Offset/limit ou cursor-based ?" },
      { role: 'assistant', content: "Offset/limit est simple mais a deux problèmes sur les grandes tables : perf (PostgreSQL doit compter N lignes avant de retourner) et instabilité (insertions/suppressions entre deux pages causent des doublons ou des sauts). Cursor-based (`WHERE id > cursor LIMIT 20`) résout les deux grâce à l'index. Inconvénient : pas de saut direct à la page 42." },
      { role: 'user',      content: "C'est un feed d'événements en temps réel, trié par date desc. Cursor semble mieux ?" },
      { role: 'assistant', content: "Oui, clairement cursor. Utilise un tuple (timestamp, id) comme cursor si les timestamps ne sont pas uniques : `WHERE (created_at, id) < (cursor_ts, cursor_id)`. Encode le cursor en base64 pour l'opacifier. Un index composite sur `(created_at DESC, id DESC)` couvrira la requête efficacement." },
    ],
    summary: "Comparaison offset/limit vs cursor-based pagination pour une API REST. Choix du cursor pour un feed temps réel trié par date. Implémentation avec tuple (timestamp, id) pour l'unicité, encodage base64, index composite PostgreSQL.",
    keywords: ['api', 'rest', 'pagination', 'cursor', 'offset', 'postgresql', 'index', 'feed', 'temps-réel', 'performance'],
  },
  {
    id: 'seed-10',
    title: 'Validation email par regex',
    messages: [
      { role: 'user',      content: "Quelle regex utiliser pour valider une adresse email ?" },
      { role: 'assistant', content: "La vraie réponse : ne pas valider les emails par regex en production. La RFC 5322 est si complexe qu'une regex complète est illisible et toujours incomplète. En pratique : validation minimale pour détecter les erreurs grossières + confirmation par envoi d'email. Les librairies comme `validator.js` offrent un middle-ground raisonnable." },
      { role: 'user',      content: "D'accord, mais pour un formulaire front-end juste pour guider l'utilisateur ?" },
      { role: 'assistant', content: "Pour du feedback UX en temps réel, `/^[^\\s@]+@[^\\s@]+\\.[a-z]{2,}$/i` est suffisant. Déclenche la validation sur `blur` plutôt que sur chaque keystroke pour ne pas stresser l'utilisateur. Et ne bloque jamais la soumission sur la seule base de la regex — laisse le serveur valider aussi." },
    ],
    summary: "Discussion sur la validation d'emails par regex. Recommandation de ne pas sur-valider côté client (RFC 5322 trop complexe). Regex minimale pour feedback UX front-end, déclenchement sur blur, validation serveur indispensable.",
    keywords: ['regex', 'email', 'validation', 'rfc5322', 'front-end', 'ux', 'formulaire', 'tld', 'validator', 'javascript'],
  },
  {
    // Exemple de message avec pièces jointes (brief A / lot 1). Le tableau
    // `attachments` suit le schéma message.attachments : {attId, name, mime,
    // size, kind, w?, h?}. Les blobs réels (IndexedDB, store `resources`) sont
    // écrits séparément par seedAttachmentResources() ci-dessous — recharger la
    // conversation peuple le cache session (loadConversationResources), donc la
    // vignette ET recall_attachment/resource__present trouvent un enregistrement
    // (lots 3-4). Avant l'ajout de ce seed IDB, la chip tombait sur le fallback
    // gracieux (icône, pas de vignette) — toujours le comportement attendu
    // quand le cache session n'a pas le blob (cf. resolveAttachmentThumb, ui.js),
    // mais ce n'est plus le cas ici.
    id: 'seed-10b',
    title: 'Debug capture réseau — pièce jointe',
    // attSeq suit le dernier att-N émis (docs/storage.md) : sans lui,
    // allocateAttId(undefined) ré-émettrait att-1, déjà pris ci-dessous.
    attSeq: 2,
    messages: [
      {
        role: 'user',
        content: "Voici la capture d'écran de l'erreur et le fichier de log associé.",
        attachments: [
          { attId: 'att-1', name: 'erreur-503.png', mime: 'image/png', size: 184320, kind: 'image', w: 1280, h: 720 },
          { attId: 'att-2', name: 'nginx-access.log', mime: 'text/plain', size: 4096, kind: 'text' },
        ],
      },
      { role: 'assistant', content: "D'après la capture, le 503 vient du backend qui timeout — visible aussi dans les dernières lignes du log nginx (upstream timed out). Vérifie le `proxy_read_timeout` de ta conf nginx et la charge du service en amont au moment de l'erreur." },
    ],
    summary: "Diagnostic d'une erreur 503 à partir d'une capture d'écran et d'un log nginx joints au message. Cause : timeout du backend en amont, à corriger via proxy_read_timeout.",
    keywords: ['nginx', '503', 'timeout', 'pièce-jointe', 'attachment', 'capture-écran', 'log', 'debug', 'proxy', 'backend'],
  },
  {
    // Attachment kind:'binary' (brief H — descripteur générique). Contrairement
    // à seed-10b, aucun blob n'est écrit en IDB pour att-1 ici : le descripteur
    // binaire est dérivé des champs FIGÉS du schéma attachment lui-même
    // (formatBinaryAttachmentDescriptor, resources.js), pas des octets — la chip
    // visuelle retombe sur son fallback gracieux (icône, pas de vignette), c'est
    // le comportement attendu et suffisant pour exercer ce lot (l'IDB n'entre en
    // jeu que pour recall_attachment/resource__present, hors périmètre H).
    id: 'seed-10c',
    title: 'Document Word joint — extraction docs',
    messages: [
      {
        role: 'user',
        content: "Peux-tu regarder ce compte-rendu et me dire s'il y a des actions en retard ?",
        attachments: [
          { attId: 'att-1', name: 'compte-rendu-sprint12.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 48200, kind: 'binary' },
        ],
      },
      { role: 'assistant', content: "Sans serveur d'extraction documentaire (mcp_docs) actif, je ne peux pas ouvrir le contenu de ce .docx — seul son descripteur m'est visible. Active un serveur MCP docs pour que je puisse l'analyser (cf. docs/mcp.md §12)." },
    ],
    summary: "Message avec un fichier Word joint (kind:'binary') pour exercer le descripteur générique du brief H, sans serveur mcp_docs actif dans ce seed.",
    keywords: ['docx', 'pièce-jointe', 'attachment', 'binaire', 'mcp_docs', 'descripteur', 'compte-rendu', 'sprint'],
  },

  // ── Conversations avec tool calls ─────────────────────────────────────────

  {
    id: 'seed-11',
    title: 'Conventions Python — mémorisation',
    messages: [
      { role: 'user',      content: "J'utilise toujours snake_case pour les fonctions et variables, PascalCase pour les classes et CapWords pour les exceptions. Mémorise ces conventions Python stp." },
      { role: 'tool-ack',  kind: 'memory_create', id: 'mem-seed-01', content: 'Conventions Python de Julien : snake_case fonctions/variables, PascalCase/CapWords classes et exceptions. Compatible PEP 8.' },
      { role: 'assistant', content: "C'est noté — j'ai créé un souvenir avec tes conventions Python. Je m'y référerai dans les prochaines questions sur ce sujet." },
    ],
    summary: "L'utilisateur demande au modèle de mémoriser ses conventions de nommage Python (snake_case fonctions, PascalCase classes). Souvenir créé.",
    keywords: ['python', 'conventions', 'nommage', 'snake-case', 'pascal-case', 'pep8', 'mémoire', 'style', 'code', 'standardisation'],
  },
  {
    id: 'seed-12',
    title: 'Décision archi — migration microservices',
    messages: [
      { role: 'user',      content: "On vient de décider de découper le monolithe Python en trois services indépendants : auth, catalog, orders. Chaque service aura sa propre base de données. Retiens cette décision d'architecture." },
      { role: 'tool-ack',  kind: 'memory_create', id: 'mem-seed-02', content: "Décision architecture (2026) : migration du monolithe Python vers 3 microservices — auth, catalog, orders. Chaque service dispose de sa propre BDD." },
      { role: 'assistant', content: "Mémorisé. Je garderai ce contexte pour toutes les questions sur l'architecture du projet." },
      { role: 'user',      content: "Ajoute que la communication inter-services passe par RabbitMQ, pas par REST direct." },
      { role: 'tool-ack',  kind: 'memory_update', id: 'mem-seed-02', content: "Décision architecture (2026) : migration du monolithe Python vers 3 microservices — auth, catalog, orders. Chaque service avec sa BDD. Communication inter-services via RabbitMQ (pas REST direct).", prevContent: "Décision architecture (2026) : migration du monolithe Python vers 3 microservices — auth, catalog, orders. Chaque service dispose de sa propre BDD." },
      { role: 'assistant', content: "Mis à jour — j'ai ajouté la précision sur RabbitMQ comme bus de communication inter-services." },
    ],
    summary: "Décision d'architecture : migration d'un monolithe Python vers 3 microservices (auth, catalog, orders) avec BDD par service et RabbitMQ comme bus de communication. Souvenir créé puis mis à jour.",
    keywords: ['microservices', 'architecture', 'python', 'monolithe', 'rabbitmq', 'auth', 'catalog', 'orders', 'décision', 'migration'],
  },
  {
    id: 'seed-13',
    title: 'Recherche historique — conversations PostgreSQL',
    messages: [
      { role: 'user',      content: "Qu'est-ce qu'on a dit sur PostgreSQL récemment ? Cherche dans l'historique." },
      { role: 'tool-ack',  kind: 'conversation_list', count: 2 },
      { role: 'tool-ack',  kind: 'conversation_read', title: 'Optimisation requête PostgreSQL lente' },
      { role: 'tool-ack',  kind: 'conversation_read', title: 'Pagination API REST : cursor vs offset' },
      { role: 'assistant', content: "J'ai retrouvé deux conversations sur PostgreSQL. Dans la première, on avait diagnostiqué une requête lente sur 2 M de lignes : un `Seq Scan` causé par des statistiques obsolètes malgré un index sur `user_id` — conclusion : `ANALYZE ta_table` puis envisager un index partiel si la distribution est non-uniforme. Dans la seconde, on avait choisi la pagination cursor-based pour un feed temps réel, avec un tuple `(timestamp, id)` comme cursor et un index composite `(created_at DESC, id DESC)`." },
    ],
    summary: "Recherche dans l'historique des conversations portant sur PostgreSQL. Deux conversations retrouvées et synthétisées : optimisation de requête lente (Seq Scan, ANALYZE) et pagination cursor-based pour feed temps réel.",
    keywords: ['postgresql', 'historique', 'recherche', 'mémoire', 'requête', 'pagination', 'cursor', 'index', 'seq-scan', 'conversations'],
  },
  {
    id: 'seed-14',
    title: 'Rappel — configuration Caddy',
    messages: [
      { role: 'user',      content: "Rappelle-moi ce qu'on s'était dit sur la config Caddy." },
      { role: 'tool-ack',  kind: 'conversation_read', title: "Reverse proxy Caddy et Let's Encrypt" },
      { role: 'assistant', content: "On avait configuré Caddy comme reverse proxy devant une app Node. Le problème était le renouvellement automatique du certificat Let's Encrypt. La racine : tu es derrière un NAT avec le port 80 non forwardé — HTTP-01 échoue donc. On avait conclu sur deux options : forwarder le 80 aussi (juste pour l'ACME), ou basculer en DNS-01 avec un plugin Caddy adapté à ton registrar." },
    ],
    summary: "L'utilisateur demande un rappel de la conversation sur Caddy. Le modèle consulte l'historique et synthétise : reverse proxy Node, problème ACME HTTP-01 derrière NAT, solutions port 80 ou DNS-01.",
    keywords: ['caddy', 'rappel', 'historique', 'lets-encrypt', 'nat', 'acme', 'reverse-proxy', 'dns-01', 'mémoire', 'récap'],
  },
  {
    id: 'seed-15',
    title: 'Config Go — enregistrement et suppression',
    messages: [
      { role: 'user',      content: "Mémorise que j'utilise Go 1.21 avec les modules et go.work pour les workspaces multi-modules." },
      { role: 'tool-ack',  kind: 'memory_create', id: 'mem-seed-03', content: "Julien utilise Go 1.21 avec les modules Go et go.work (workspaces multi-modules)." },
      { role: 'assistant', content: "Noté — j'ai enregistré ta config Go 1.21 avec workspaces." },
      { role: 'user',      content: "En fait retire ça — j'ai migré sur 1.23 et je n'utilise plus go.work en pratique. Supprime ce souvenir." },
      { role: 'tool-ack',  kind: 'memory_delete', id: 'mem-seed-03', content: "Julien utilise Go 1.21 avec les modules Go et go.work (workspaces multi-modules)." },
      { role: 'assistant', content: "Supprimé. La note sur Go 1.21 et go.work n'est plus dans mes souvenirs." },
    ],
    summary: "Tentative de mémorisation de la config Go (1.21, go.work) puis demande de suppression suite à la migration vers Go 1.23. Démonstration du cycle create → delete sur un souvenir.",
    keywords: ['go', 'golang', 'go-work', 'workspaces', 'mémoire', 'souvenir', 'suppression', 'migration', 'modules', 'conventions'],
  },

  // ── Features récentes : acks ENRICHIS (args/result/ts/group/intent),
  //    mcp_call, raisonnement, provenance serveur, conv_ref, slash-skill ──────

  {
    id: 'seed-16',
    title: 'Météo Brest via outil MCP',
    pinned: true,   // exerce la section « Épinglé » de la sidebar
    messages: [
      { role: 'user',      content: "Quel temps fait-il à Brest ?" },
      // Ack MCP enrichi : intent (rendu deux niveaux), args/result/group
      // (réinjection cross-turn), error absent. `ts` est posé par seed().
      { role: 'tool-ack',  kind: 'mcp_call', server: 'meteo', name: 'meteo__get_weather',
        intent: 'Récupération de la météo à Brest',
        args: { city: 'Brest', miaou_intent: 'Récupération de la météo à Brest' },
        result: '{"city":"Brest","temp_c":14,"sky":"bruine","wind_kmh":32}',
        group: 'g-seed16-a' },
      { role: 'assistant', content: "À Brest en ce moment : 14 °C, bruine, vent d'ouest à 32 km/h. Classique — prends la capuche plutôt que le parapluie.",
        reasoning: "L'utilisateur veut la météo actuelle. L'outil meteo__get_weather renvoie 14°C, bruine, vent 32 km/h. Je formule une réponse courte avec une touche locale (le vent rend le parapluie inutile à Brest)." },
    ],
    summary: "Consultation de la météo à Brest via l'outil MCP meteo__get_weather : 14 °C, bruine, vent 32 km/h.",
    keywords: ['météo', 'brest', 'mcp', 'outil', 'weather', 'vent', 'bruine', 'température'],
  },
  {
    id: 'seed-17',
    title: 'Appel MCP en échec — timeout',
    messages: [
      { role: 'user',      content: "Liste les tickets Jira ouverts sur le projet MIAOU." },
      // Ack MCP en ERREUR (classe .ack-error, label rouge)
      { role: 'tool-ack',  kind: 'mcp_call', server: 'jira', name: 'jira__search_issues',
        intent: 'Recherche des tickets ouverts du projet MIAOU',
        args: { jql: 'project = MIAOU AND status = Open' },
        result: 'Erreur outil distant jira__search_issues : Délai dépassé (30000 ms).',
        error: true, group: 'g-seed17-a' },
      { role: 'assistant', content: "Le serveur Jira ne répond pas (délai dépassé après 30 s). Je ne peux pas lister les tickets pour l'instant — réessaie plus tard ou vérifie que le backend MCP `jira` est joignable." },
    ],
    summary: "Tentative de listage des tickets Jira ouverts du projet MIAOU, échouée sur timeout du serveur MCP distant (30 s).",
    keywords: ['jira', 'mcp', 'timeout', 'erreur', 'tickets', 'projet', 'backend', 'échec'],
  },
  {
    id: 'seed-18',
    title: 'Multi-outils : mémoire + historique',
    messages: [
      { role: 'user',      content: "Retiens que je préfère les réponses courtes, et rappelle-moi de quoi parlait notre discussion Docker." },
      // Deux acks enrichis dans le MÊME tour (group partagé) → expandThread
      // reconstruit un seul assistant + 2 messages tool.
      { role: 'tool-ack',  kind: 'memory_create', id: 'mem-seed-04',
        content: 'Julien préfère les réponses courtes.',
        intent: 'Enregistrement de la préférence de concision',
        args: { content: 'Julien préfère les réponses courtes.' },
        result: 'Souvenir enregistré. Identifiant : mem-seed-04',
        name: 'miaou__memory__create', group: 'g-seed18-a' },
      { role: 'tool-ack',  kind: 'conversation_read', title: 'Docker Compose — communication inter-services',
        convId: 'seed-05',
        intent: 'Relecture de la conversation Docker Compose',
        args: { id: 'seed-05' },
        result: '{"id":"seed-05","title":"Docker Compose — communication inter-services","summary":"Problème de communication entre services Docker Compose…"}',
        name: 'miaou__conv__get', group: 'g-seed18-a' },
      // conv_ref dans le texte : rendu en lien cliquable vers seed-05.
      { role: 'assistant', content: "Noté pour la concision. Côté Docker : on avait vu dans [conv_ref:seed-05] que tes deux services ne partageaient pas le même localhost — solution : utiliser le nom du service comme hostname, et n'exposer les `ports` que sur l'app." },
    ],
    summary: "Enregistrement d'une préférence de concision et rappel de la conversation Docker Compose (hostname par nom de service, exposition sélective des ports). Deux appels d'outils dans le même tour.",
    keywords: ['mémoire', 'préférence', 'concision', 'docker', 'historique', 'multi-outils', 'rappel', 'conversation'],
  },
  {
    id: 'seed-19',
    title: 'Slash-skill : revue de code',
    messages: [
      // displayText = littéral tapé (affiché) ; content = littéral + corps baké
      // (envoyé au modèle). Exerce le rendu displayText + l'export.
      { role: 'user',
        displayText: "/revue Regarde cette fonction : `function add(a,b){return a+b}`",
        content: "/revue Regarde cette fonction : `function add(a,b){return a+b}`\n\n--- skill: revue ---\nTu es un relecteur de code exigeant. Structure ta revue : points bloquants, améliorations, style. Sois direct.\n--- /skill: revue ---" },
      { role: 'assistant', content: "**Points bloquants** : aucun.\n\n**Améliorations** : pas de validation des types — `add('1', 2)` renvoie `'12'`. Si la fonction est censée additionner des nombres, ajoute une garde ou du typage.\n\n**Style** : espaces manquants (`function add(a, b) { return a + b; }`)." },
    ],
    summary: "Revue de code d'une fonction add() via la slash-skill /revue : risque de concaténation implicite sur des strings, style à normaliser.",
    keywords: ['revue', 'code', 'skill', 'slash', 'javascript', 'fonction', 'typage', 'style'],
  },
  {
    id: 'seed-20',
    title: 'Découverte de skill par le modèle',
    messages: [
      { role: 'user',      content: "Rédige un compte-rendu de notre réunion d'architecture d'hier." },
      // Acks skill_list puis skill_read (stage 2 : découverte par le modèle).
      { role: 'tool-ack',  kind: 'skill_list', count: 2,
        intent: 'Recherche d\'une skill de compte-rendu',
        args: {}, result: '[{"slug":"revue","name":"Revue de code"},{"slug":"cr","name":"Compte-rendu"}]',
        name: 'miaou__skills__list', group: 'g-seed20-a' },
      { role: 'tool-ack',  kind: 'skill_read', slug: 'cr', title: 'Compte-rendu',
        intent: 'Lecture de la skill de compte-rendu',
        args: { slug: 'cr' }, result: 'Structure : contexte, décisions, actions (porteur + échéance), risques.',
        name: 'miaou__skills__read', group: 'g-seed20-b' },
      { role: 'assistant', content: "**Contexte** : réunion d'architecture du 2 juillet.\n\n**Décisions** : découpage du monolithe en 3 services (auth, catalog, orders), bus RabbitMQ.\n\n**Actions** : spec des contrats d'API (Julien, 15/07) ; POC RabbitMQ (Sarah, 22/07).\n\n**Risques** : double écriture pendant la transition, à cadrer avant le POC." },
    ],
    summary: "Rédaction d'un compte-rendu de réunion d'architecture en s'appuyant sur la skill 'cr' découverte par le modèle (skills__list puis skills__read).",
    keywords: ['compte-rendu', 'skill', 'réunion', 'architecture', 'microservices', 'actions', 'décisions', 'autotrigger'],
  },
  {
    id: 'seed-21',
    title: 'Migration Kubernetes — troncature',
    messages: [
      { role: 'user',      content: "Détaille-moi toute la procédure de migration d'un cluster Kubernetes on-prem vers EKS, étape par étape, avec les pièges à éviter à chaque phase." },
      // Dernier message assistant coupé à la limite de tokens (feature C) :
      // truncated: true rend le bandeau « Réponse incomplète » + bouton
      // « Continuer » au reload (bouton actif car c'est le dernier assistant).
      { role: 'assistant',
        content: "**Phase 1 — Audit de l'existant** : inventorie les workloads (Deployments, StatefulSets, DaemonSets), les StorageClass utilisées, les CRD installées et les intégrations réseau (CNI, Ingress). Piège fréquent : des PodSecurityPolicy ou des admission webhooks maison qui n'ont pas d'équivalent direct sur EKS.\n\n**Phase 2 — Provisionnement EKS** : crée le cluster avec une version de contrôle proche de l'origine pour limiter les écarts d'API. Attention aux quotas IAM et aux limites par défaut du VPC CNI (nombre d'IP par nœud) si tu as beaucoup de pods par nœud.\n\n**Phase 3 — Réplication du réseau",
        truncated: true },
    ],
    summary: "Procédure détaillée de migration d'un cluster Kubernetes on-prem vers EKS, réponse coupée par la limite de tokens en phase 3 (fixture troncature/continuation).",
    keywords: ['kubernetes', 'eks', 'migration', 'cluster', 'troncature', 'continuer', 'aws'],
  },
  {
    id: 'seed-22',
    title: 'Fibonacci — nom de fichier sur le codeblock',
    messages: [
      { role: 'user', content: "Donne-moi une fonction Fibonacci récursive avec mémoïsation, dans un fichier à part." },
      // filename= (espace, cf. CODEBLOCK_DOCTRINE/docs/tools.md) : coloration Prism
      // normale (lang='python'), download propose 'fibonacci.py' au lieu du
      // générique miaou-snippet.py. Deuxième fence sans filename dans le même
      // message : non-régression (download générique). Troisième fence avec
      // l'ancienne forme cassée virgule (python, filename=...), testée et rejetée
      // par Julien : ne doit plus casser Prism (lang nettoyé de la virgule).
      { role: 'assistant',
        content: "Voici la fonction, avec mémoïsation via `functools.lru_cache` :\n\n```python filename=fibonacci.py\nfrom functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n```\n\nUn extrait d'usage rapide, sans vocation de fichier à part :\n\n```python\nprint(fib(30))\n```\n\nEt la forme historique (virgule collée au langage) pour vérifier la non-régression :\n\n```python, filename=fibonacci_legacy.py\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n```" },
    ],
    summary: "Fonction Fibonacci récursive mémoïsée en Python, fournie dans un bloc de code nommé fibonacci.py (fixture filename=, cf. docs/tools.md).",
    keywords: ['python', 'fibonacci', 'mémoïsation', 'récursion', 'codeblock', 'filename', 'téléchargement'],
  },
  {
    id: 'seed-23',
    title: 'Diagrammes Mermaid — rendu et fallback',
    messages: [
      { role: 'user', content: "Dessine-moi le flux d'authentification OAuth2 en diagramme de séquence, et un petit organigramme de décision." },
      // Fixture lot E : premier bloc mermaid VALIDE (rendu attendu au reload,
      // toggle rendu/source visible, exports E3 : le filename= du fence doit
      // donner flux-oauth.svg / flux-oauth.png), deuxième bloc mermaid INVALIDE (fallback
      // source surlignée + notice .mermaid-error, jamais de rendu cassé),
      // troisième bloc non-mermaid (contrôle : aucun toggle, aucun rendu).
      // Export HTML E4 : le bloc valide doit sortir en SVG embarqué + source
      // repliée (.mermaid-src), l'invalide rester en source surlignée.
      { role: 'assistant',
        content: "Voici le flux OAuth2 (authorization code) :\n\n```mermaid filename=flux-oauth.mmd\nsequenceDiagram\n    participant U as Utilisateur\n    participant C as Client\n    participant A as Serveur d'auth\n    U->>C: Accède à l'app\n    C->>A: Redirige (authorize)\n    A->>U: Formulaire de login\n    U->>A: Identifiants\n    A->>C: Code d'autorisation\n    C->>A: Échange code contre token\n    A->>C: Access token\n```\n\nEt l'organigramme de décision (volontairement cassé, fixture d'erreur) :\n\n```mermaid\ngraph TD\n    A[Début] --> B{Token valide ?}\n    B -->|oui| C[Accès accordé\n    B -->|non D[Refus]]]\n```\n\nPour référence, la requête d'échange en shell :\n\n```bash\ncurl -X POST https://auth.example.com/token -d grant_type=authorization_code -d code=$CODE\n```" },
    ],
    summary: "Flux OAuth2 authorization code en diagramme de séquence Mermaid, plus un organigramme invalide (fixture rendu Mermaid + fallback d'erreur, lot E).",
    keywords: ['mermaid', 'diagramme', 'oauth2', 'séquence', 'rendu', 'fallback', 'toggle'],
  },
  {
    id: 'seed-24',
    title: 'Préviz sandboxée — HTML et SVG',
    messages: [
      { role: 'user', content: "Fais-moi une petite page HTML de démo qui essaie de lire le localStorage, et un SVG animé avec un script embarqué." },
      // Fixture lot E2 : bloc html dont le script SONDE localStorage (l'aperçu
      // sandboxé doit afficher « localStorage inaccessible » — l'iframe est en
      // origine opaque, sans allow-same-origin) ; bloc svg avec <script>
      // embarqué (s'exécute, confiné) ; bloc xml de contrôle (pas de bouton œil).
      { role: 'assistant',
        content: "Voici la page de démo — le script tente de lire `localStorage` et affiche le résultat :\n\n```html\n<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><style>body{font-family:sans-serif;padding:2rem}#out{padding:1rem;border-radius:8px}.ko{background:#fde8e8;color:#b71c1c}.ok{background:#e8f5e9;color:#1b5e20}</style></head>\n<body>\n<h1>Sonde sandbox</h1>\n<div id=\"out\"></div>\n<script>\nvar out = document.getElementById('out');\ntry {\n  var n = window.localStorage.length;\n  out.textContent = 'localStorage ACCESSIBLE (' + n + ' clefs) — sandbox défaillante !';\n  out.className = 'ok';\n} catch (e) {\n  out.textContent = 'localStorage inaccessible (' + e.name + ') — sandbox effective.';\n  out.className = 'ko';\n}\n<\/script>\n</body></html>\n```\n\nEt le SVG animé, avec un script embarqué qui recolore le cercle :\n\n```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"120\">\n  <circle id=\"c\" cx=\"100\" cy=\"60\" r=\"40\" fill=\"tomato\"/>\n  <script>\n    var c = document.getElementById('c');\n    setInterval(function(){ c.setAttribute('fill', c.getAttribute('fill') === 'tomato' ? 'steelblue' : 'tomato'); }, 800);\n  <\/script>\n</svg>\n```\n\nPour comparaison, le même contenu en XML brut (pas d'aperçu attendu) :\n\n```xml\n<config><entry key=\"demo\">valeur</entry></config>\n```" },
    ],
    summary: "Page HTML de démo sondant localStorage et SVG animé à script embarqué (fixture préviz sandboxée lot E2 : sandbox effective, script confiné, xml de contrôle).",
    keywords: ['html', 'svg', 'aperçu', 'sandbox', 'iframe', 'localstorage', 'préviz'],
  },
];

// ── Souvenirs (miaou-memories) : cohérents avec les acks des conversations ────
// mem-seed-01/02 (créés en seed-11/12), mem-seed-03 supprimé (tombstone,
// seed-15), mem-seed-04 (seed-18). Injectés en contexte à chaque tour.
const MEMORY_SEEDS = [
  { id: 'mem-seed-01', content: 'Conventions Python de Julien : snake_case fonctions/variables, PascalCase/CapWords classes et exceptions. Compatible PEP 8.', suppressed: false, scope: SPACE_SEED_ID },
  { id: 'mem-seed-02', content: "Décision architecture (2026) : migration du monolithe Python vers 3 microservices — auth, catalog, orders. Chaque service avec sa BDD. Communication inter-services via RabbitMQ (pas REST direct).", suppressed: false, scope: SPACE_SEED_ID },
  { id: 'mem-seed-03', content: 'Julien utilise Go 1.21 avec les modules Go et go.work (workspaces multi-modules).', suppressed: true, scope: SPACE_SEED_ID },
  { id: 'mem-seed-04', content: 'Julien préfère les réponses courtes.', suppressed: false, scope: 'profile' },
];

// ── Skills (IndexedDB `miaou`, store `skills`) : /revue + cr (autotrigger) ────
// Cohérentes avec seed-19 (slash) et seed-20 (découverte modèle).
const SKILL_SEEDS = [
  { slug: 'revue', name: 'Revue de code', description: 'Relecture de code structurée : bloquants, améliorations, style.',
    enabled: true, autotrigger: false,
    content: 'Tu es un relecteur de code exigeant. Structure ta revue : points bloquants, améliorations, style. Sois direct.' },
  { slug: 'cr', name: 'Compte-rendu', description: 'Compte-rendu de réunion : contexte, décisions, actions, risques.',
    enabled: true, autotrigger: true,
    content: 'Structure : contexte, décisions, actions (porteur + échéance), risques.' },
];


// ── Données exportées ────────────────────────────────────────────────────────
// Un verify qui a besoin de connaître une fixture (titre attendu, contenu d'un
// message) lit ici plutôt que de recopier une chaîne.
export const SEED_DATA = {
  MODEL,
  SERVER,
  SPACE_SEED_ID,
  SPACE_SEED_CONV_IDS,
  SEEDS,
  MEMORY_SEEDS,
  SKILL_SEEDS,
};

// Version du schéma IDB `miaou`. **Doit rester alignée sur `MIAOU_DB_VERSION`
// (storage.js)** : depuis le fix `3210886`, les deux points d'ouverture de
// l'application partagent une seule version, et un script qui ouvre la base sur
// un littéral périmé bloque l'ouverture (`verify-context-inspector-cache-bar`
// portait un `2` en dur). Le `onupgradeneeded` ci-dessous recrée les quatre
// stores à l'identique de l'application, avec la même garde contains-check :
// si MIAOU n'a jamais ouvert la base, le seed la crée sans casser la migration.
export const MIAOU_DB_VERSION = 4;

// ── Corps exécuté DANS la page ───────────────────────────────────────────────
// Ces fonctions sont sérialisées par Playwright (`page.evaluate(fn, arg)`) :
// elles ne peuvent référencer aucune variable de ce module, tout passe par leur
// argument. Chacune résout APRÈS le `tx.oncomplete` de son écriture : c'est ce
// qui remplace le journal DOM de l'ancien fixture, sur lequel les consommateurs
// attendaient par `waitForFunction`. Un appelant peut donc enchaîner
// `page.reload()` directement, sans attente arbitraire.

function pageSeedConversations(data) {
  const { MODEL, SERVER, SPACE_SEED_ID, SPACE_SEED_CONV_IDS, SEEDS, MEMORY_SEEDS, DB_VERSION } = data;
  const MEM_KEY = 'miaou-memories';
  const SPACES_KEY = 'miaou-spaces';
  const spaceConvIds = new Set(SPACE_SEED_CONV_IDS);

  function openDb() {
    return new Promise(function(resolve, reject) {
      const req = indexedDB.open('miaou', DB_VERSION);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        const tx = e.target.transaction;
        if (!db.objectStoreNames.contains('resources')) {
          const store = db.createObjectStore('resources', { keyPath: 'id' });
          store.createIndex('by_conversation', 'conversationId', { unique: false });
          store.createIndex('by_space', 'spaceId', { unique: false });
        } else {
          const store = tx.objectStore('resources');
          if (!store.indexNames.contains('by_space')) {
            store.createIndex('by_space', 'spaceId', { unique: false });
          }
        }
        if (!db.objectStoreNames.contains('skills')) {
          db.createObjectStore('skills', { keyPath: 'slug' });
        }
        if (!db.objectStoreNames.contains('conversations')) {
          const store = db.createObjectStore('conversations', { keyPath: 'id' });
          store.createIndex('by_space', 'spaceId', { unique: false });
        }
        if (!db.objectStoreNames.contains('summaries')) {
          db.createObjectStore('summaries', { keyPath: 'id' });
        }
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }

  const now = Date.now();
  const day = 86400000;

  // Timestamps distincts dans les 30 derniers jours, du plus récent au plus ancien
  const slots = SEEDS.map(() => now - Math.random() * 30 * day)
    .sort((a, b) => b - a);

  // Conversations et résumés à écrire. La forme des enregistrements est celle
  // des stores IDB : une conversation entière (`keyPath:'id'`), et un résumé
  // par entrée portant son `id` (l'ancienne carte `{id: entrée}` de
  // localStorage est devenue un store à clé, cf. la migration U-2).
  const convRecords = [];
  const summRecords = [];
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i];
    const ts = slots[i];

    // Timestamps de messages : 30 s par message non-ack. Un ack ENRICHI (args
    // présents) reçoit aussi un ts (celui de l'appel d'outil, cf. stampTs) ;
    // un ack legacy (sans args) reste sans ts, comme en usage réel.
    // lastMsgTs = ts du dernier message user/assistant, utilisé comme updatedAt.
    let tsCounter = 0;
    let lastMsgTs = ts;
    const messages = s.messages.map(m => {
      if (m.role === 'tool-ack' || m.role === 'memory-ack') {
        return m.args != null ? { ...m, ts: lastMsgTs + 5000 } : { ...m };
      }
      lastMsgTs = ts + tsCounter * 30000;
      tsCounter++;
      return m.role === 'assistant'
        ? { ...m, model: MODEL, server: SERVER, ts: lastMsgTs }
        : { ...m, ts: lastMsgTs };
    });

    const conv = { id: s.id, title: s.title, timestamp: ts, updatedAt: lastMsgTs, messages };
    if (s.pinned) conv.pinned = true;
    if (spaceConvIds.has(s.id)) conv.spaceId = SPACE_SEED_ID;
    convRecords.push(conv);

    // messageCount = messages user/assistant uniquement (pas les tool-acks)
    const msgCount = s.messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
    summRecords.push({
      id: s.id,
      title: s.title,
      timestamp: ts,
      summary: s.summary,
      keywords: s.keywords,
      messageCount: msgCount,
    });
  }

  return openDb().then(function(db) {
    // Une seule transaction sur les deux stores : les ids sont fixes, donc
    // `put` est idempotent et un re-seed ne duplique rien. On n'écrase que les
    // ids seedés : une conversation créée à la main par le test survit.
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
      const convStore = tx.objectStore('conversations');
      const summStore = tx.objectStore('summaries');
      for (const rec of convRecords) convStore.put(rec);
      for (const rec of summRecords) summStore.put(rec);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  }).then(function() {
    // ── Souvenirs (miaou-memories) : taille bornée, restés en localStorage ──
    let mems = [];
    try { mems = JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); } catch {}
    const memIds = new Set(mems.map(m => m.id));
    let addedMems = 0;
    for (const m of MEMORY_SEEDS) {
      if (memIds.has(m.id)) continue;
      mems.push({ ...m, created_at: now - 7 * day, updated_at: now - 7 * day });
      addedMems++;
    }
    localStorage.setItem(MEM_KEY, JSON.stringify(mems));

    // ── Espaces (miaou-spaces, lot C) ────────────────────────────────────────
    // Le default Space lui-même n'est PAS seedé ici : migrateSpacesIfNeeded()
    // (storage.js) le crée au premier chargement de MIAOU, avant tout rendu —
    // le seed n'a besoin d'ajouter que le second Space.
    let spaces = [];
    try { spaces = JSON.parse(localStorage.getItem(SPACES_KEY) || '[]'); } catch {}
    let addedSpaces = 0;
    if (!spaces.some(s => s.id === SPACE_SEED_ID)) {
      spaces.push({
        id: SPACE_SEED_ID,
        name: 'Pro',
        description: 'Contexte infra/réseau à la maison : Pi-hole, Caddy, subnet 192.168.42.*.',
        createdAt: now - 14 * day,
      });
      addedSpaces++;
    }
    localStorage.setItem(SPACES_KEY, JSON.stringify(spaces));

    return {
      conversations: convRecords.length,
      summaries: summRecords.length,
      memories: addedMems,
      spaces: addedSpaces,
    };
  });
}

function pageSeedSkills(data) {
  const { SKILL_SEEDS, DB_VERSION } = data;
  return new Promise(function(resolve, reject) {
    const req = indexedDB.open('miaou', DB_VERSION);
    req.onsuccess = function(e) {
      const db = e.target.result;
      const tx = db.transaction('skills', 'readwrite');
      const store = tx.objectStore('skills');
      for (const s of SKILL_SEEDS) store.put(s);
      tx.oncomplete = function() { resolve({ skills: SKILL_SEEDS.length }); };
      tx.onerror = function(ev) { reject(ev.target.error); };
    };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

// Pièces jointes (brief A, lots 3-4) : blobs réels en IDB pour seed-10b, afin
// que recall_attachment/getCachedRecordByAttId trouvent un enregistrement (le
// commentaire de seed-10b décrit le cas SANS blob — celui-ci ajoute le cas AVEC
// blob, sans dupliquer la conversation). Schéma exact de storeAttachment
// (resources.js) : id `att_…` distinct de attId `att-N`.
function pageSeedAttachments(data) {
  const { DB_VERSION } = data;
  const enc = new TextEncoder();
  const RECORDS = [
    { id: 'att_seed10b_1', attId: 'att-1', conversationId: 'seed-10b', class: 'binary',
      mime: 'image/png', name: 'erreur-503.png', size: 184320, createdAt: Date.now(),
      w: 1280, h: 720,
      // PNG 1x1 minimal valide (transparent) — suffisant pour exercer le rendu
      // <img> de recall_attachment/resource__present, pas la vraie capture d'écran.
      data: Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0)).buffer },
    { id: 'att_seed10b_2', attId: 'att-2', conversationId: 'seed-10b', class: 'inline',
      mime: 'text/plain', name: 'nginx-access.log', size: 0, createdAt: Date.now(),
      data: enc.encode('127.0.0.1 - - [05/Jul/2026:10:00:00] "GET /api/x HTTP/1.1" 503 0 "-" "-"\nupstream timed out (110: Connection timed out) while reading response header from upstream').buffer },
  ];
  RECORDS[1].size = RECORDS[1].data.byteLength;
  return new Promise(function(resolve, reject) {
    const req = indexedDB.open('miaou', DB_VERSION);
    req.onsuccess = function(e) {
      const db = e.target.result;
      const tx = db.transaction('resources', 'readwrite');
      const store = tx.objectStore('resources');
      for (const r of RECORDS) store.put(r);
      tx.oncomplete = function() { resolve({ attachments: RECORDS.length }); };
      tx.onerror = function(ev) { reject(ev.target.error); };
    };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

// ── API Node ─────────────────────────────────────────────────────────────────
// Chaque fonction attend un objet `page` Playwright déjà navigué sur la page
// dist (même origine que l'IDB visée) et **résout après `tx.oncomplete`** : le
// consommateur peut enchaîner `page.reload()` sans attente arbitraire — c'est
// ce qui remplace les `waitForFunction` sur le texte de `#log` de l'ancien
// fixture HTML.

const pageArgs = () => ({
  MODEL: SEED_DATA.MODEL,
  SERVER: SEED_DATA.SERVER,
  SPACE_SEED_ID: SEED_DATA.SPACE_SEED_ID,
  SPACE_SEED_CONV_IDS: SEED_DATA.SPACE_SEED_CONV_IDS,
  SEEDS: SEED_DATA.SEEDS,
  MEMORY_SEEDS: SEED_DATA.MEMORY_SEEDS,
  SKILL_SEEDS: SEED_DATA.SKILL_SEEDS,
  DB_VERSION: MIAOU_DB_VERSION,
});

/** Conversations, résumés, souvenirs et Espaces. N'ouvre pas les stores
 *  `skills`/`resources` : suffisant pour un verify qui n'a besoin que d'un
 *  historique (c'est ce que faisaient les consommateurs qui découpaient
 *  l'ancien script pour n'en garder que `seed()`). */
export async function seedConversations(page) {
  return page.evaluate(pageSeedConversations, pageArgs());
}

/** Skills (`/revue` slash, `cr` autotrigger), cohérentes avec seed-19/seed-20. */
export async function seedSkills(page) {
  return page.evaluate(pageSeedSkills, pageArgs());
}

/** Pièces jointes de seed-10b (une image binaire, un log texte inline). */
export async function seedAttachments(page) {
  return page.evaluate(pageSeedAttachments, pageArgs());
}

/** Tout le fixture, dans l'ordre de l'ancien `dev-seed.html`. */
export async function seedAll(page) {
  const a = await seedConversations(page);
  const b = await seedSkills(page);
  const c = await seedAttachments(page);
  return { ...a, ...b, ...c };
}
