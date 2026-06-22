# Vérification manuelle (réseau)

Les tests automatiques (`tests/runner.py`) ne couvrent que les fonctions pures :
pas de `fetch` réel sous QuickJS. Les chemins réseau, DOM et la boucle
`tool_calls` se vérifient à la main. Avec une vraie configuration, ouvrir
`dist/miaou.html` et passer la liste ci-dessous.

1. **Backfill** : avec des conversations dans l'historique, l'indicateur
   d'activité affiche `résumés n/N` et `miaou-summaries` se remplit.
2. **Mode proposer** : poser une question liée à une conversation passée → la
   bannière mémoire apparaît, « Injecter » fait que la réponse en tient compte.
3. **Message système unique** : inspecter le payload réseau — un seul message
   `role: 'system'`, blocs concaténés (outils / prompt système / résumés).
4. **Outil** : question dont le résumé ne suffit pas → le modèle appelle
   `get_conversation` (ou `list_conversations`), et on va **jusqu'à la réponse
   finale**, pas seulement jusqu'au résultat de l'outil.
5. **Plusieurs tool_calls par tour** : tous exécutés dans le même tour.
6. **Anti-redemande** : redemander un appel rigoureusement identique dans le même
   échange ne redéclenche pas le handler ; deux appels distincts du même outil
   (ex. deux `propose_memory`) sont tous deux servis.
7. **Suppression réversible** : supprimer un souvenir → plus jamais re-résumé,
   même après redémarrage ; « Ré-autoriser » → régénéré au passage suivant.
8. **Souvenirs** : envoyer un message mentionnant un fait personnel → le modèle
   propose `propose_memory` ; accepter l'entrée → elle s'affiche dans le drawer
   Souvenirs et est réinjectée dans les tours suivants. Modifier ou supprimer
   depuis le drawer (suppression → tombstone réversible ; oublier → définitif).
   `propose_memory_update` et `propose_memory_delete` : vérifier les cartes
   Accepter/Rejeter et la cohérence de la liste après chaque action.
9. **Pas de résumé sur conversation fraîche** : créer une conversation, envoyer
   un message, la quitter sans contenu substantiel → aucun résumé généré.
10. **Arrêt du streaming** : lancer une génération longue, cliquer le bouton stop
    → le texte s'arrête et reste affiché, le composer redevient normal, aucune
    erreur loggée (l'`AbortError` est avalé). Stop pendant un appel d'outil
    interrompt sans relancer de tour.
11. **Timeout background** : figer l'endpoint pendant un titrage ou un backfill →
    l'indicateur d'activité s'éteint au bout de ~30 s (abort), pas de blocage.
12. **Édition de message** : éditer un message en milieu de fil → tout ce qui
    suit disparaît, la réponse est régénérée (injection mémoire + tool_calls
    actifs). Échap annule. Recharger après édition → thread tronqué persisté.
13. **Sélecteur de modèle** : activer le réglage → le dropdown apparaît dans le
    composer (si `/models` répond). Changer de modèle en cours de conversation
    n'efface pas l'historique ; le choix persiste au rechargement ; une nouvelle
    conversation repart sur le modèle par défaut. Réglage masqué de nouveau → les
    conversations gardent leur override. Modèle non fonctionnel sélectionné →
    l'erreur s'affiche dans la bulle, pas de retry silencieux.
