# Générateurs de fixtures PDF du spike V-8

Les deux PDF que le spike V-8 mesure ne sont pas des documents « trouvés » : ils
sont **fabriqués pour exercer un cas précis**, et ces scripts sont le seul moyen
de les refaire à l'identique. Ils écrivent dans `untracked/test-files/`.

    uv run --with reportlab python3 gen-big-toc.py       # big-toc.pdf
    uv run python3 gen-named-dest-toc.py                 # named-dest-toc.pdf

- **`big-toc.pdf`** (reportlab) — 372 pages, 372 entrées d'outline sur 3 niveaux.
  Mesure le coût des `getPageIndex` sur un sommaire de livre technique.
  Destinations en **tableau** (c'est ce que reportlab produit).

- **`named-dest-toc.pdf`** (PDF brut écrit à la main) — 6 entrées, toutes en
  destination **NOMMÉE** (chaîne), dont 2 pointant vers un nom absent de l'arbre
  `/Names`. Écrit à la main parce que c'est le seul moyen de contrôler la forme
  exacte des destinations : reportlab n'en produit pas de nommées, et c'est
  justement ce que la première passe du spike a révélé (0 destination nommée sur
  372 entrées — la branche `typeof dest === 'string'` de pdf.js n'était donc pas
  exercée du tout).

La leçon vaut au-delà de V-8 : une fixture prouve ce qu'elle contient, pas ce
qu'on espérait qu'elle contienne. Vérifier la composition avant d'écrire les
contrôles.
