# MIAOU installable (PWA)

MIAOU reste un fichier HTML unique, qu'on peut ouvrir en `file://`. Servi en
http(s), typiquement par le proxy MCP (miaou-mcp-servers, clé `miaou_dist`,
sous `/app/`), il devient aussi une application installable : fenêtre à part,
icône, entrée dans le menu du système. Ce document décrit ce qui ne marche
qu'en http(s), et pourquoi. Le côté build (manifeste, icônes, empreinte) est
dans `docs/build.md`.

## Trois origines, trois stockages

`file://`, `http://127.0.0.1:8765` et `http://localhost:8765` sont trois
origines distinctes, chacune avec son `localStorage` et son IndexedDB. Passer
du fichier à la version servie, c'est retrouver une appli vierge : réglages,
serveurs, conversations, souvenirs, skills. L'export/import complet `.zip` (réglages,
catégorie « Données ») est le seul moyen de transférer. Un geste guidé
(transfert direct entre les deux origines) a été écarté : beaucoup de travail
pour un usage unique par utilisateur.

Corollaire : un même proxy atteint par `localhost` ou par `127.0.0.1` donne deux
historiques selon le lien cliqué. C'est vrai aussi pour les verify Playwright.

## Fichiers servis

Voisins de `miaou.html` dans `dist/`, tous versionnés : `manifest.webmanifest`
(seul nom figé côté proxy), les icônes qu'il cite, et `version.json`
(empreinte de build). Le proxy les sert avec `Cache-Control: no-cache` et un
ETag : chaque chargement revalide, un 304 répond si rien n'a changé.

Piège d'instrument : « Disable cache » coché dans les DevTools fait voir un 200
à chaque chargement, ce qui ressemble à une revalidation cassée. Elle marche
(304 vérifié derrière Caddy, dont `encode` réécrit l'ETag puis retire son
suffixe de l'`If-None-Match` avant le proxy).

## Le `<head>` : manifeste et couleur de barre de titre

Le lien du manifeste est posé par le script de tête, **en http(s) seulement** :
en `file://`, une balise statique mènerait à un fichier non servi et lèverait
une erreur en console, sans autre effet. Le chemin est relatif
(`manifest.webmanifest`), donc il suit le préfixe `/app/` du proxy sans le
connaître. `start_url`, `scope` et `id` valent `./`, relatifs au manifeste.

`<meta name="theme-color">` colore la barre de titre de la fenêtre installée.
`theme_color` du manifeste est statique, alors que MIAOU a plusieurs luminosités
et palettes : la balise est réécrite au runtime par `syncThemeColor` (ui.js),
appelée par `applyTheme` ET `applyPalette` (la couleur de la topbar dépend des
deux). Ces deux appelants couvrent aussi `init`, le suivi de la préférence
système et la synchro multi-onglets. La couleur est lue sur les jetons
(`--topbar-bg` composé sur `--bg`, celui du body qui est derrière la topbar) par
une sonde sans transition, jamais sur la topbar elle-même, où une transition de
fond en cours rendrait une valeur intermédiaire. Purs testés : `parseCssRgb`,
`compositeHexColor`. Avant `init`, le script de tête pose une valeur grossière
selon la seule luminosité (celle d'Ambre).

Dans la fenêtre installée, le navigateur préfixe la barre de titre du nom de
l'application (« MIAOU - … ») : `documentTitleFor` (ui.js) y rend le titre de
conversation nu, sans le suffixe « — MIAOU » des onglets
(`isStandaloneDisplay`, pwa.js, passé par ses trois appelants).

L'export HTML autonome compose son propre `<head>` (`buildExportHtml`) et ne
porte ni manifeste, ni `theme-color`, ni service worker : un test le garde.

## Service worker (`src/pwa/sw.js`)

Il n'est **pas** requis pour installer : mesuré sur le poste cible, Edge et
Chrome sous Windows proposent l'installation sans SW. Il est là pour une autre
raison : lancer MIAOU proxy coupé. Copié dans `dist/` par le build (commentaires
retirés), enregistré par `registerServiceWorker` (`pwa.js`, appelée en fin
d'`init`) en page servie seulement (`isServedProtocol`, pur). Sa portée est son
dossier, `/app/` derrière le proxy, sans en-tête `Service-Worker-Allowed`. Un
contexte non sécurisé (IP du LAN en http clair) n'expose pas l'API : l'appli
marche comme avant, sans SW ni installation.

Il ne répond qu'à trois familles de requêtes GET, et laisse **tout le reste**
au réseau sans `respondWith` : appels au backend LLM (SSE), POST `/mcp`,
`version.json`, manifeste, icônes. Un flux SSE relayé par un worker peut se
bloquer, et rien de non idempotent n'a à passer par un cache.

1. **Navigation dans la portée : réseau d'abord, cache en repli.** Une seule
   entrée, sous la racine de la portée. Le délai `NAV_TIMEOUT_MS` (4 s) borne
   l'attente d'un proxy qui pend ; passé ce délai le cache répond s'il existe,
   sinon on continue d'attendre le réseau. La mise en cache est confiée à
   `waitUntil`, appelé tant que `respondWith` est en attente (seule fenêtre où
   c'est permis hors du gestionnaire), donc elle aboutit même quand c'est le
   cache qui a répondu.
2. **Bibliothèques des CDN** (cdnjs, jsdelivr, fonts.gstatic) : URL
   versionnées, donc immuables. Cache d'abord, mise en cache au premier usage,
   aucun préchargement. Le paramètre `miaou-retry` que `loadCdnScript` ajoute
   pour contourner une requête pendue est retiré de la CLÉ de cache (pas de la
   requête) : chaque tentative laisserait sinon une entrée de plus.
3. **Feuille Google Fonts** : URL non versionnée, contenu selon le navigateur.
   Servie du cache, rafraîchie en arrière-plan.

Les requêtes CDN sont refaites en mode `cors` : une réponse opaque est comptée
très au-delà de sa taille dans le quota, partagé avec IndexedDB et la détection
de stockage plein. Mesuré : tous ces CDN répondent
`Access-Control-Allow-Origin: *`, une réponse cors satisfait les `<script>` et
`<link>` no-cors de la page, et le SW voit aussi le fetch du worker pdf.js et
les `importScripts` du worker de parsing (SheetJS, mammoth).

`skipWaiting` + `clients.claim` : une nouvelle version de `sw.js` prend la main
tout de suite (elle ne touche qu'aux requêtes, pas à la page en cours). Aucun
nettoyage de cache : les montées de version des tiers sont rares, une ancienne
URL ne coûte que sa place. Le cache s'appelle `miaou-v1`.

**Vérification** : `verify-pwa-sw.mjs` (file:// sans manifeste ni SW, lien et
manifeste servis, `theme-color` comparée au fond calculé de la topbar sur trois
couples thème/palette, SW de l'appli et sa portée, navigation pendue servie
depuis le cache après le délai, démarrage proxy coupé et hors ligne avec
bibliothèques, worker et fontes servis par le cache, `version.json` laissé au
réseau, témoin d'une grammaire Prism jamais chargée qui échoue). **Il désactive
le cache HTTP par CDP** : sans ça, le cache mémoire du moteur sert les
`<script>` déjà vus sans passer par le SW, et la phase hors ligne passe sans
rien prouver.

## Détection de nouvelle version

Le build écrit l'empreinte du contenu de `miaou.html` dans `dist/version.json`,
et la même dans le JS (`BUILD_ID`, cf. `docs/build.md`). La page servie relit
le fichier (`checkForNewVersion`, pwa.js) au démarrage et aux deux signaux de
retour déjà câblés pour la reprise MCP (`visibilitychange`, `focus` de fenêtre),
au plus une fois par `VERSION_CHECK_MIN_INTERVAL_MS` (2 min), sans cache HTTP
(`cache: 'no-store'`) et sans le SW, qui laisse passer ce fichier. Lecture bornée
(`VERSION_FETCH_TIMEOUT_MS`). Proxy coupé, fichier absent ou illisible : silence.
Jamais en `file://` ni hors build. La lecture au démarrage couvre une page
lancée depuis le cache du SW parce que le proxy tardait.

Empreinte servie différente (`servedNewerBuild`, pur) : toast persistant
« Nouvelle version de MIAOU disponible », thème `update`, action « Recharger ».
Une annonce par version et par session : fermé à la croix, il ne revient pas à
chaque retour dans la fenêtre, seulement si une autre version paraît. Limite
assumée : un toast d'information peut être évincé par une rafale qui dépasse
`TOAST_MAX_VISIBLE`, et ne revient pas non plus.

**« Recharger » refuse quand un rechargement perdrait quelque chose**
(`reloadBlockReason`, pur, sur l'état relevé par `reloadBlockState`) : une
génération au registre (réponse, agent ou compaction : tous dans
`_activeGenerations`), une file d'interjections non vide, ou un message en cours
de rédaction (texte du composer ou pièces jointes en attente) — ni la file ni le
brouillon ne sont persistés. Le refus rend `false` à `showToast`, qui garde
alors le toast de mise à jour ouvert (`docs/toasts.md`), et un second toast
(`app-update-wait`) dit ce qu'il faut attendre. Les tâches de fond (résumé,
titrage) ne bloquent pas : elles se relancent d'elles-mêmes après un
rechargement.

Aucune coordination entre onglets : chacun relit le fichier pour lui-même, et un
onglet resté sur l'ancien bundle est déjà protégé côté stockage
(`releaseSupersededDb`, `docs/storage.md`). Un nouveau `sw.js` prend la main de
toutes les fenêtres (`skipWaiting`, `clients.claim`) sans recharger la page : il
ne touche qu'aux requêtes.

**Vérification** : `verify-pwa-version.mjs` (aucun toast tant que l'empreinte
servie est la même, relecture sur le vrai `focus` et délai minimal respecté,
silence proxy coupé, toast persistant sur une nouvelle empreinte, refus de
« Recharger » avec un brouillon puis avec une génération au registre — toast
maintenu et toast d'attente —, rechargement effectif une fois libre). La
génération y est simulée par une entrée posée au registre : c'est la lecture du
registre qui est vérifiée, pas le cycle d'une génération. Sur une connexion
détruite, Chromium rejoue d'office un GET idempotent : deux arrivées serveur
pour une seule lecture de l'appli.

## Ctrl+N : nouvelle fenêtre de l'appli

Sur macOS, la fenêtre installée a sa barre de menus et Cmd+N y ouvre une
fenêtre MIAOU sans rien demander à la page. Sous Windows et Linux, Chrome garde
Ctrl+N et ouvre une fenêtre de navigateur. Dans une fenêtre d'application,
Chromium ne réserve pas ses raccourcis : la page reçoit la touche, et
`isNewAppWindowShortcut` (pur : fenêtre installée, hors macOS, Ctrl seul, pas
de répétition) décide de l'intercepter. Dans un onglet ou en file://, la touche
ne parvient pas à la page et le prédicat l'écarte de toute façon ; sur macOS,
Ctrl+N reste à l'édition de texte.

`openNewAppWindow` ouvre l'adresse de l'appli (sans requête ni ancre) en
`window.open` nu : depuis une fenêtre d'application, Chrome ouvre une fenêtre
de l'appli, agrandie si la courante l'est. La fonctionnalité `popup` donne
aussi une fenêtre de l'appli, mais à taille fixe, jamais agrandie : écartée
après essai des deux sous Windows. Vérification à la main seulement
(`docs/manual-tests.md`, « MIAOU installable ») : la réception de la touche
dépend de la fenêtre d'application, qu'aucun navigateur piloté ne reproduit.

## Pastille de l'icône d'application

Un point sur l'icône du Dock (barre des tâches sous Windows) tant qu'une
réponse terminée attend d'être lue, tous Espaces confondus : Badging API,
`navigator.setAppBadge()` sans nombre / `clearAppBadge()`, posés par
`syncAppBadge` (pwa.js) depuis `syncActivityBadges` — donc à chaque repeinture
des pastilles, synchro multi-onglets comprise ; chaque fenêtre pose la même
valeur, tirée du même état partagé. `appBadgeAction` (pur) n'appelle l'API
qu'au changement d'état ; un refus oublie l'état posé pour réessayer. Ce qui
allume, et pourquoi c'est l'agrégat plutôt que `_unreadConvs` : cf.
`docs/badges.md`, qui porte aussi la règle de focus (une fin de génération
fenêtre sans focus est non lue, même sur la conversation affichée) et
l'effacement au retour.

API absente (Firefox, file://) : rien. Dans un onglet, le navigateur ignore
l'appel ou l'applique à l'appli installée du même site. Aucune permission
requise : constaté le 2026-10-10 sur macOS avec Chrome, appli installée sans
autorisation de notification, la pastille s'affiche. Chrome la dessine en rouge
avec un petit point blanc au centre (le « • » qu'il transmet au Dock pour une
pastille sans nombre) ; seul un nombre (`setAppBadge(n)`) l'éviterait, écarté.

**Pas de clignotement** : le web n'expose ni le rebond de l'icône du Dock ni le
flash de la barre des tâches, et une notification système ne fait ni l'un ni
l'autre — écartée pour cette raison (l'appli de bureau Claude ne fait pas
mieux).

## Installer, ou passer à la version servie (Réglages › Application)

La catégorie « Application » des réglages varie selon le contexte ; son état est
tranché par un pur, `installSurfaceState`, et posé par `syncInstallSurface`
(pwa.js) à chaque ouverture des réglages et à chaque événement d'installation.

- **Page servie, invite disponible** : Chromium émet `beforeinstallprompt`,
  dont le comportement par défaut est empêché et l'événement gardé, pour être
  déclenché par le bouton « Installer MIAOU » (`onInstallClick` ; un événement
  ne sert qu'une fois). Les écouteurs sont posés au chargement du script, avant
  `init` : l'événement peut partir tôt.
- **Fenêtre installée** (`display-mode: standalone`) ou `appinstalled` reçu
  dans la session : plus de bouton. Dans un onglet, un MIAOU déjà installé n'est
  pas détectable autrement : Chromium n'émet simplement pas l'invite, d'où la
  ligne générique du cas suivant, qui le mentionne.
- **Pas d'invite** (Firefox, Safari, ou déjà installé) : une ligne qui dit
  comment faire selon le navigateur.
- **Contexte non sécurisé** (IP du LAN en http clair) : l'installation est
  impossible et la ligne le dit.
- **file://** : MIAOU ne s'installe pas. Une ligne fixe rappelle que fichier et
  version servie ont chacun leur stockage, et renvoie à l'export/import complet.

**Sonde de la version servie depuis file://** (`probeServedApp`, au démarrage).
Candidats : les origines http(s) des serveurs MCP configurés, suffixées de
`/app/` (`servedAppCandidates`, pur, origine lue par motif — `URL` manque au
moteur des tests). Une réponse lisible de `<candidat>version.json` prouve d'un
coup que le proxy répond ET qu'il sert MIAOU ; lecture bornée, candidats
essayés dans l'ordre. C'est le sens inverse de ce que la décision sur le seed
MCP interdit : rien n'est dérivé de `location` pour les serveurs, ici une URL de
serveur sert à TROUVER l'appli, pour l'affichage seul. Trouvée : la catégorie
nomme l'adresse et propose « Ouvrir la version servie », et un toast
(`served-app`) le signale une fois par session (`sessionStorage`). Depuis
`file://`, la requête part avec `Origin: null` : le CORS du proxy (`*`, sans
credentials) couvre `/app/`, vérifié sur le fil.

**Vérification** : `verify-pwa-install.mjs` (file:// sans serveur MCP, puis
proxy arrêté, puis proxy qui sert MIAOU derrière un candidat mort : toast une
fois par session, adresse nommée, bouton « Ouvrir la version servie » ; page
servie : bouton « Installer » si et seulement si une invite est gardée,
`beforeinstallprompt` différé et consommé au clic, `appinstalled` qui masque le
bouton). Les deux événements d'installation y sont synthétiques : l'installation
réelle se vérifie à la main (`docs/manual-tests.md`, « MIAOU installable »).
