# Interjections mid-génération (lot Q)

Permet à l'utilisateur de taper un message **pendant** qu'une génération est en
cours, sans l'interrompre, pour réorienter le modèle **avant** qu'il ait fini —
notamment au milieu d'une longue boucle d'outils. Inspiré du comportement de
Claude Code (message mis en file, pris en compte au prochain point de
respiration).

## Modèle mental : une file PAR CONVERSATION, deux drains, une mécanique

Il n'y a pas de « mode mid-boucle » séparé. Un registre par conversation, deux
points de vidange, un seul chemin de résolution.

- **Registre** : `_pendingInterjections` (main.js), **`Map<convId, items[]>`**
  d'entrées `{ id, literal }`, **en mémoire, local à l'onglet**. Jamais
  persisté, jamais broadcasté (lot J non concerné — meurt avec l'onglet, comme
  la génération qu'il attend : un reload ne laisse ni l'un ni l'autre, décision
  Julien X-1e). Chaque entrée ne garde que le **littéral** : les slash-skills
  sont re-résolues au drain (contenu COURANT), jamais un contenu baké figé —
  même doctrine que `editUserMessage`. Lecture par `interjectionsFor(convId)`,
  jamais un `.get()` nu (sans conversation — accueil — la réponse est une liste
  vide, pas `undefined`).

### Pourquoi la clef par conversation (révision X-1e)

Le lot Q en avait fait un **état d'écran** : un tableau unique, drainé par la
génération qui possédait l'écran (`genOwnsScreen`). Cohérent tant qu'une
génération appartenait à l'affichage — ce qui a cessé d'être vrai au lot T.

Le défaut constaté en test (Julien, X-1) : une interjection tapée dans une
conversation restait affichée au-dessus du composer **après un changement de
conversation**, sur un fil qui ne générait pas et n'avait donc aucun point
d'étape à venir. La question « qui va recevoir ce message ? » n'avait pas de
réponse stable — le destinataire changeait avec l'écran, sans que rien ne le
signale. Le seul geste sûr était de supprimer la puce.

Depuis X-1e, la file appartient à la **conversation où l'on a tapé**, comme
`_pendingAgentResults`. Les deux drains la ciblent par `gen.convId`, jamais par
l'écran ; le rail (`renderInterjectionRail`) montre la file de la conversation
AFFICHÉE, et elle seule — c'est la réponse visible à la question. Il est appelé
à chaque changement de conversation (`openConversation`, `resetToEmpty`) :
c'est cet appel qui manquait.

**Les deux files restent distinctes** (`_pendingInterjections` /
`_pendingAgentResults`), mais plus pour la raison écrite au lot Q (« leurs
conditions de drain sont OPPOSÉES » — elles ne le sont plus). Ce qui les sépare
désormais est ce qu'elles portent : une interjection est annulable, éditable, et
reflue dans le composer à un arrêt ; un résultat d'agent est un fait acquis que
personne ne retire. Les fusionner ferait qu'un stop utilisateur refoulerait dans
le composer le compte rendu d'un agent.
- **Drain B (nominal, le cœur)** : hook `onInterjections` appelé par
  `runConversation` (api.js) à la **frontière de tour** de la boucle d'outils,
  APRÈS `onToolAcks`, AVANT la relance. Le modèle voit l'interjection après les
  tool results du tour courant, avant son prochain geste d'outil → réaiguillage
  mid-boucle. Granularité = la frontière de tour (un tour est un seul appel
  réseau streamé, non interruptible en son milieu).
- **Drain A (résiduel)** : `settleInterjectionQueue(convId, nominal)` dans le
  `finally` de `dispatchSend`, APRÈS `setSending(false)`. `convId` est celui de
  la GÉNÉRATION qui se termine, jamais l'écran. Quatre cas, deux axes :

  | | conversation AFFICHÉE | conversation DÉTACHÉE |
  |---|---|---|
  | fin **nominale** | drain A par le chemin d'envoi normal (`sendUserText` → `dispatchSend`) | drain A par le chemin **détaché** : `parentThreadFor` + `startParentWakeGeneration` (agents.js) |
  | fin **non nominale** | reflux composer (« stop veut dire stop ») | la file **reste en place** |

  Le drain A détaché réutilise le chemin du **réveil de parent** (lot X-1) plutôt
  que d'en ouvrir un second : c'est le même geste — pousser une entrée user dans
  le thread d'une conversation, puis démarrer une génération dessus.
  `sendUserText` ne convient pas, il écrit dans `currentThread`/`persistCurrent`
  et rangerait l'interjection dans le fil AFFICHÉ (piège 28). Relecture APRÈS
  l'await de résolution (piège 24 b) : la conversation a pu être supprimée, ou
  l'écran être revenu dessus.

  Le reflux non-nominal détaché n'a **pas** lieu : il vise le composer, qui
  affiche autre chose — y déverser les littéraux les perdrait de vue et les
  mélangerait au brouillon d'un autre fil. L'utilisateur retrouve ses puces
  intactes en revenant sur la conversation.

## Composer en mode file

Pendant `sending`, Entrée (`onComposerKey`, ui.js) appelle
`enqueueInterjection` au lieu de `sendMessage` — jamais d'envoi direct
concurrent. Le bouton du composer reste le **stop** (`onSendBtn` inchangé). Le
placeholder passe en « Le modèle travaille — Entrée ajoute à la file… »
(`setComposerStreaming`).

`enqueueInterjection` (main.js) valide le slug **à la mise en file** (arbitrage
lot Q, pas au drain) : même chemin que `sendMessage` — `resolveSend` sur le
littéral, un `/slug` inconnu/désactivé en position 0 bloque ici avec l'erreur
composer habituelle, saisie préservée. Le contenu baké est **jeté** ; la file ne
garde que le littéral. Garde `_ijResolving` (motif B7) : ferme la fenêtre de
double-Entrée pendant l'`await resolveSend`. Texte seul (arbitrage lot Q) : une
pièce jointe en attente refuse la mise en file (erreur visible, jamais de
détachement silencieux).

## Puces : rail visible, annulable, éditable

Rail `#ij-rail` au-dessus du composer (`index.html`), rendu par
`renderInterjectionRail` (main.js appelle, fonctions DOM dans ui.js). Chaque
puce (`buildInterjectionChip`) :

- **Annulation** (croix) → `cancelInterjection` : retire du registre, la puce
  plonge (`dismissInterjectionChip(id, 'down')`).
- **Édition** (clic sur le corps) → `editInterjection` : retire du registre,
  re-remplit le composer (préfixé à un brouillon éventuel). Ré-appuyer Entrée
  RE-MET EN FILE (le mode file reste actif tant que `sending`).
- **Drain en cours** : `markInterjectionChipsDraining` fige les puces du batch
  (classe `.ij-draining`, non interactives) DANS le splice synchrone de
  `takePendingInterjections`, AVANT tout `await` — l'invariant de réentrance
  rendu visible (voir plus bas).

Le CSS vit dans `composer.css` (section « Rail d'interjections »). Animations
gouvernées par le kill-switch global `html[data-motion="reduced"]` (base.css) —
aucune règle motion locale à gater. `dismissInterjectionChip` a un filet
`setTimeout(400)` si `transitionend` ne tire pas (kill-switch, onglet masqué).

## Intégration au fil : bulle assistant matérialisée

Point le plus subtil. Au drain B, la suite du travail du modèle doit se
matérialiser **sous** l'interjection (revue maquette 2026-07-17). Séquence dans
`currentThread` produite par `onInterjections` :

```
tool-ack, tool-ack,               ← acks du tour interrompu (poussés par onToolAcks)
assistant { content:'', _acksOnly:true, ts },   ← bulle matérialisée
user (interjection, ts, displayText?),          ← buildInterjectionEntry
… (tour suivant : nouveaux acks, réponse finale)
```

**Pourquoi la bulle assistant vide ?** Pendant la génération, `currentThread`
reçoit des entrées `tool-ack` autonomes (pas de paire assistant+tool avant
`onFinal`). Les acks du tour interrompu n'ont donc **pas d'assistant hôte**.
Sans lui, `renderThread` (au reload) les rendrait **nus** (branche orpheline,
ligne `else` : `buildToolAck` sans bulle, sans en-tête, sans horodatage). On
matérialise donc un message `assistant` à content vide — même geste que
`onToolTour` pour un tour à texte — pour donner aux acks un hôte. **Live ET
reload passent alors par le MÊME chemin** (`placeToolAck` dans cette bulle),
sans classe DOM spéciale.

**`content` toujours vide** : `onToolTour` (api.js l'appelle AVANT les acks) a
déjà consommé le texte du tour s'il y en avait (finalisé dans sa propre bulle,
`wrap` neuf ouvert). Au moment de `onInterjections`, `wrap` ne porte que les
acks. Re-lire un texte serait une double bulle.

**Flag `_acksOnly`** : `expandThread` (utils.js) élague cette bulle du payload
(un assistant vide sans `tool_calls` entre les tool results et l'interjection
user est du bruit KV, et certains backends REJETTENT en 400 tout assistant sans
content ni `tool_calls`). Depuis le fix post-lot Q, le prédicat d'élagage est
**généralisé à tout assistant à content blanc** (null/vide/blancs purs) : il
couvre aussi la bulle vide d'un stop avant le premier token (`onFinal 'aborted'`
sans contenu — affordance « Régénérer » côté UI, aucune valeur payload). Le flag
`_acksOnly` reste posé par `onInterjections` comme documentation d'origine de la
bulle, mais l'élagage ne dépend plus de lui. Le groupe d'acks qui précède a déjà
produit son `assistant+tool_calls`.

**Bulle user authentique** : `buildInterjectionEntry` produit un message user
normal — `content` = ce qui part sur le fil (baké si skill), `displayText` =
littéral dès qu'ils divergent (doctrine invariant n°1). **Jamais `_synthetic`**
(contrairement au recall d'image) : c'est un vrai message user, l'injection
`<miaou_context>` doit pouvoir le viser au tour suivant. Rendu via
`appendUserMessage`, horodatage compris.

Un `wrap` neuf est ouvert après (`startAssistantMessage`) : la suite s'y place,
l'ancien ne reçoit plus rien → invariant lot N préservé (un seul groupe d'acks
contigu par bulle assistant).

## Byte-stabilité et coût KV

`content` est stocké tel qu'envoyé au drain → `expandThread` rejoue à
l'identique aux envois suivants (byte-stable, KV-safe côté préfixe historique).

Le coût KV assumé : l'insertion d'un message user au milieu de la séquence
**invalide le préfixe KV à partir de ce point** pour les tours suivants.
**Volontaire, déclenché par l'utilisateur, ponctuel** — même nature que la
ré-injection d'image (brief A2/D3), corollaire du piège 16. Documenté comme
choix, pas régression.

## Fins non-nominales : reflux, jamais d'envoi auto

Toute fin NON-nominale — stop manuel (`aborted`), halte `ask_confirmation`,
erreur réseau, `MAX_TOURS` — REFOULE les littéraux dans le composer
(`settleInterjectionQueue(false)`, joints par `\n\n`, préfixés au brouillon),
puces vidées. « Stop veut dire stop » : rien ne part tout seul après un arrêt,
rien n'est perdu. Seul `finish_reason: 'stop'` (`endedNominal = true`, posé dans
`onFinal`) déclenche le drain A.

## Réentrance

`takePendingInterjections` **splice le snapshot du registre synchroniquement
avant tout `await`** du drain (invariant projet `await_reentrancy_guard`). Un
clic éditer/annuler pendant la résolution (`resolveSend`) ne peut plus saisir un
élément en vol — il est déjà sorti du registre, sa puce figée en `.ij-draining`.

## Continuations `noTools`

Une continuation (`isContinuation`, reprise d'une troncature) tourne avec
`noTools` : aucun tour d'outils, donc drain B ne tire jamais. Drain A couvre
(fin nominale). Aucun code spécifique.

## Couverture de tests

QuickJS (`tests/test-utils.js`, describe « interjections mid-génération ») :
`joinInterjectionLiterals` (fusion/trim/filtre, tolérance null, frontière
`/slug` après jointure), `buildInterjectionEntry` (displayText conditionnel,
jamais `_synthetic`), `expandThread` (élagage `_acksOnly`, et élagage généralisé
de tout assistant à content blanc — null/vide/blancs purs — les non-vides
restant émis). Le câblage orchestration (timing du hook, branche
composer, drains, rendu des puces) relève de la vérification manuelle /
Playwright — voir `docs/manual-tests.md`.
