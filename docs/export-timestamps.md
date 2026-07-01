# Export Markdown, téléchargements et horodatages

## Export Markdown et téléchargements

- `downloadFile(filename, content, mimeType)` dans `utils.js` : Blob +
  `createObjectURL` + `<a download>` éphémère + clic programmatique +
  `revokeObjectURL`. **N'est pas un outil LLM.** Point d'entrée unique pour
  tout téléchargement côté client (blocs de code, messages, export conversation,
  et futurs backup/import).
- `LANG_TO_EXT` / `langExt(lang)` dans `utils.js` : table langage → extension.
  Fallback `.txt` si le langage est absent ou inconnu.
- Bouton `.code-dl` dans `decoratePre` (ui.js) : posé aux côtés de `.code-copy`,
  télécharge le contenu brut du bloc.
- **`.msg-dl` (bouton download d'un message assistant) porte l'attribut `hidden`
  à la création** (`assistantHead`) et est révélé uniquement par `finalizeAssistant`
  (message live) **et** `buildMsg` (reload depuis storage). Ne jamais l'afficher
  avant finalisation — le contenu est incomplet pendant le streaming.
  Le contenu brut à télécharger est stocké dans `body.dataset.raw`, posé par
  `finalizeAssistant` et `buildMsg` (chemin reload). Si on retouche l'un ou
  l'autre, s'assurer que `dataset.raw` est bien mis à jour.
- **`.conv-dl-btn` (export de la conversation) est désactivé (`disabled`) pendant
  le streaming** via `setSending` (ui.js). CSS : `.conv-dl-btn:disabled` masque
  le bouton. `downloadConvMd()` (main.js) ne garde que les rôles `user`/`assistant`
  pour le texte, et inclut l'horodatage par message si `ts` est défini.
- **Traces d'appels d'outils dans l'export.** `formatToolAcksMd(acks)` (utils.js,
  pure, testée QuickJS) rend un groupe d'acks **enrichis** (`args` non null —
  mêmes acks que `expandThread` réinjecte cross-turn, cf. `docs/tools.md`)
  en blockquote Markdown juste avant le texte de réponse du tour : nom de l'outil
  + `— intent` (si présent), arguments (JSON), résultat (ou « Résultat (erreur) »
  si `m.error`), et pour `resource_presented` une note `Ressource présentée
  automatiquement : nom (mime) — non incluse dans cet export` (**jamais de
  data-URI/base64 embarqué**, cohérent avec D8/D9 (`docs/mcp.md`) — le binaire
  reste en IDB). Un seul appel → « Outil appelé : » ; plusieurs (même `group`) →
  « Outils appelés (n) : » en liste numérotée. Troncature pour la lisibilité du
  fichier (n'affecte ni le storage ni le payload modèle) : args/résultat à 300
  caractères, nom de ressource à 60, suffixe `...` simple (pas de mention
  « tronqué »). Acks **legacy** (sans `args`) restent **omis** de l'export, comme
  avant cette fonctionnalité — pas de fallback sur le label compact écran.
  `downloadConvMd()` tamponne les acks enrichis qui précèdent un message
  assistant (même motif que `renderThread`) ; `downloadMsgMd()` (ui.js) retrouve
  les acks de son propre tour en remontant `currentThread` depuis `msgIndex(wrap)`.
- **`.msg-ts` user est un sibling de `.bubble`**, pas un enfant — `align-items:
  flex-end` du `.msg.user` gère l'alignement à droite. Ne pas le mettre à
  l'intérieur du bubble (sinon il serait exclu/recréé lors des reconstructions
  de `bubble.innerHTML` comme dans `cancelEdit`).

## Horodatages des messages

- `formatMessageTime(ts, now)`, `formatFullDateFr(ts)` et `formatDateRelative(ts, now)`
  dans `utils.js` : fonctions pures, **sans `Intl` ni `toLocaleString`** (déterminisme
  + testabilité QuickJS). Abréviations et noms complets des jours/mois codés en dur
  en français.
- `SHOW_YEAR_AFTER_DAYS = 183` : constante nommée, exprimée en jours (pas en
  mois calendaires), testable par soustraction d'epoch.
- `_startOfDay(d)` : helper interne (minuit local, DST-safe) partagé par
  `formatMessageTime` et `formatDateRelative`. Le delta calendaire se calcule via
  `Math.round((_startOfDay(n) - _startOfDay(d)) / 86400000)` — **`Math.round`, pas
  `Math.floor`** : au passage heure d'été un jour calendaire adjacent dure 23h,
  `floor` le classerait à tort comme « aujourd'hui ».
- `formatMessageTime` distingue le découpage **calendaire** (minuit/minuit) de la
  fenêtre 24h glissante : un message d'hier à 23:50 est « hier » même si < 24h
  se sont écoulées ; un message à 00:10 aujourd'hui est l'heure courte même si
  > 9h se sont écoulées.
- `formatDateRelative` est **date-only** (pas de composante horaire) : tiers
  aujourd'hui / hier / avant-hier / `"3 mars"` / `"12 janvier 2024"`, réutilise
  `SHOW_YEAR_AFTER_DAYS` et `FR_MONTHS_FULL`. Employé par `showSummaryBanner` pour
  les dates des items de la liste.
- `formatFullDateFr` (ex. « jeudi 26 juin 2026 à 14:30 ») est réservé aux
  **tooltips de la sidebar** (`:hover` = contexte de détail, l'année toujours
  présente). Pour les horodatages inline des messages, utiliser `formatMessageTime`.
- Le champ `ts` (epoch ms) est posé par `sendUserText` (user), `onFinal` et
  `onToolTour` (assistant). Absent sur les anciens messages → affichage sans
  horodatage, pas de crash.
