# Pipeline de build (`build.py`) — ne pas le réécrire

`build.py` lit `src/html/index.html` (template) et produit `dist/miaou.html`
par substitution de placeholders. Ce document détaille les invariants du build ;
`CLAUDE.md` n'en garde que l'ossature (ordres de concaténation, marqueurs). À
lire **avant** de toucher `build.py`, l'injection de config/aide, ou les points
d'injection côté source (`storage.js`, `tools.js`).

## Concaténation CSS/JS et strip des commentaires

Deux placeholders dans le template :

- `/* __CSS__ */` ← les `src/css/*.css` concaténés dans l'ordre `CSS_ORDER`.
  **L'ordre EST la cascade** : `base` porte l'`@import` des fontes,
  `theme-light` doit rester dernier.
- `/* __JS__ */` ← les `src/js/*.js` concaténés dans l'ordre `JS_ORDER`.

**Les deux listes ne sont recopiées nulle part** — ni ici, ni dans `CLAUDE.md` :
la seule énumération est celle de `build.py` (constantes `JS_ORDER` et
`CSS_ORDER`, en tête de fichier), à lire là-bas. Elles l'ont été un temps aux
deux endroits, et ont dérivé exactement comme le décrit la règle des
énumérations fermées de `CLAUDE.md` — chaque copie mise à jour indépendamment,
donc aucune complète : il a manqué `palette` au CSS, puis `docs`, `sync` et
`agents` au JS, sur plusieurs lots. Une liste de fichiers n'annonce pas son
propre compte, donc le `grep` des compteurs explicites ne peut pas l'attraper :
seule la non-duplication protège.

Les commentaires sont retirés au passage — `src/` reste la référence commentée,
`dist/` est compact :

- JS : `strip_js_comments` (respecte strings/templates/regex).
- CSS : `strip_css_comments` (respecte les strings).
- HTML : `strip_html_comments` (sur le template, avant substitution des
  placeholders).

Puis une passe **au niveau ligne**, `collapse_blank_code_lines`, appliquée après
chacun des trois : elle écrase les runs de lignes vides (le strip en laisse
souvent plusieurs à la suite) **et retire le blanc de fin de ligne**. Ce second
nettoyage vit là et **pas dans les strippers**, qui traversent strings et
template literals — y toucher au blanc modifierait le contenu d'une chaîne.
Après strip, l'examen ligne par ligne est sûr. L'invariant à tenir est qu'aucune
ligne de `src/js` ne porte d'espace final **significatif** : c'est vérifié
(aucune n'en porte du tout), et ni CSS ni JS n'y sont sensibles — seule une
template literal de données textuelles le serait, il n'y en a pas.

Sans ce `rstrip`, un commentaire retiré laissait derrière lui son indentation
(ligne de blanc pur) ou ses espaces d'alignement (commentaire de fin de ligne) :
~1100 lignes du `dist` en portaient, ce qui rendait `git diff --check`
inutilisable comme garde-fou sur le dépôt. Corrigé au lot Y ; le passage a
produit un diff cosmétique unique sur `dist/miaou.html`, sans aucun changement
de substance (`git diff -w` le montre : seul le lot Y y apparaît).

Tests unitaires de ces transformations dans `tests/runner.py`
(`run_build_unit_tests`).

## Marqueur de config : `__MIAOU_CONFIG__`

Substitué par l'objet `config.json` entier sérialisé en JSON (JSON ⊂ littéral
objet JS, donc `json.dumps` gère seul quoting/nombres/booléens — pas de marqueur
par clef, pas de distinction guillemets/sans-guillemets). `build.py` échappe
`</` dans le littéral pour ne pas casser le `</script>` porteur.

Côté source (`storage.js`), un **unique point d'injection** :

```js
const BUILD_CONFIG = (function () { try { return __MIAOU_CONFIG__; } catch (e) { return {}; } })();
```

- **Marqueur à occurrence unique, en position de valeur** : `.replace` global,
  donc toute autre occurrence serait substituée aussi.
- **Forme tolérante via `try`** : sources non buildées (tests QuickJS),
  `__MIAOU_CONFIG__` est un identifiant nu → `ReferenceError` attrapée → `{}`.
  (Un `typeof … !== 'undefined'` ne convient pas : la garde elle-même contient
  le marqueur, qui serait substitué → objet dupliqué.)
- Les valeurs dérivées sont **toutes déclarées dans `storage.js`**, juste sous
  `BUILD_CONFIG`, avec leurs défauts — **la liste ne se lit qu'à cet endroit, et
  n'est recopiée nulle part** : elle l'était ici, et avait déjà dérivé (trois
  dérivés manquants) exactement comme le décrit la règle des énumérations
  recopiées de `CLAUDE.md`, qu'aucun grep de compteur ne peut attraper. Elles ne
  sont **référencées ailleurs qu'en corps de fonction** (cf. contrainte
  `const`/test runner dans `CLAUDE.md`) : ne pas les redéclarer dans un autre
  fichier au top-level. Quelques-unes ont un raisonnement propre, développé
  ci-dessous ; les autres suivent le patron `BUILD_CONFIG.<clef> || <défaut>`.
- **`build_ts` n'est pas une clef de `config.json`** : `build.py` l'écrase dans
  `cfg_data` juste avant sérialisation (epoch Unix en secondes). En écrire une
  dans `config.json` ne sert à rien — elle serait remplacée en silence. Son
  défaut `0` côté `storage.js` signifie donc « sources non buildées » (tests
  QuickJS), jamais « config incomplète ». Les autres clefs, elles, viennent
  toutes de `config.json` et sont documentées dans le README.
- `BUILD_REPO_URL` (défaut `DEFAULT_REPO_URL`, le dépôt public) est le seul
  dérivé qui distingue **trois** états et non deux : d'où un `typeof === 'string'`
  et surtout **pas** un `||`, qui écraserait la chaîne vide — laquelle veut dire
  « pas de lien du tout », pas « valeur manquante ». Lu uniquement par le footer
  des exports (`brandHtmlFor`, ui.js), cf. `docs/exports.md`.
- `REQUIRE_API_KEY` (défaut `true`) gouverne l'état « configuré » : si `false`,
  le composer se déverrouille avec l'URL seule (clef optionnelle), cf.
  `syncConfigured` (ui.js).
- `BUILD_EARLY_TITLE` (clef `early_title`, défaut `true`, lot AA) est le seul
  dérivé qui alimente **`DEFAULT_SETTINGS` et non un test direct** : le réglage
  est utilisateur, le build n'en pose que le défaut. Résolu **dans
  `DEFAULT_SETTINGS`** et pas dans `loadSettings` comme `url`/`model`, parce
  qu'il est booléen : « absent » n'y serait pas distinguable de « false ».
  Contrainte d'ordre : sa déclaration précède `DEFAULT_SETTINGS` dans le fichier.

## Marqueur d'aide : `__MIAOU_HELP__`

Substitué par le contenu d'aide utilisateur (`src/help.md`). `parse_help_sections`
(build.py, pur, testé) découpe le `.md` en objet ordonné `{slug: markdown}` :
une section par `## <slug>`, texte avant la 1re section ignoré, `## ` dans un
fence non pris pour un titre, slug dupliqué → erreur. Sérialisé par `json.dumps`
+ échappement `</` exactement comme la config. `load_help()` **échoue bruyamment**
si `src/help.md` est absent (fichier versionné, contrairement à `config.json`
qui warn).

Côté source (`tools.js`), unique point d'injection, mêmes contraintes que
`BUILD_CONFIG` (occurrence unique en position de valeur, forme `try/catch` pour
les tests QuickJS) :

```js
const HELP_CONTENT = (function () { try { return __MIAOU_HELP__; } catch (e) { return {}; } })();
```

`HELP_CONTENT` alimente l'outil `miaou__about` (contenu servi à la demande, une
section par appel) et l'enum `topic` de son `inputSchema` (dérivé de
`Object.keys(HELP_CONTENT)` — même source que le contenu, pas de drift). Sous
QuickJS, `HELP_CONTENT` vaut `{}` (enum vide) : les tests du parseur couvrent
build.py, le test du handler injecte un contenu stub. **`HELP_CONTENT` n'entre
jamais dans le contexte du modèle** : seul le blurb d'identité (statique, court)
et l'enum de slugs y vont ; le contenu des sections n'arrive qu'en tool result,
une section à la fois, sur appel du modèle.

### Jetons `{{NOM}}` : valeurs configurables dans l'aide

`src/help.md` est rédigé **sans valeur chiffrée** partout où une formulation
qualitative suffit (« un fichier trop volumineux » plutôt qu'un plafond) : une
prose qui ne cite pas de nombre ne périme pas. Là où un chiffre aide réellement
l'utilisateur — comprendre pourquoi une pièce jointe a été refusée, savoir
combien d'agents peuvent tourner —, il s'écrit `{{NOM}}` et n'est résolu qu'à
la lecture, depuis la constante vivante.

La raison est que ces valeurs sont **configurables au build** : un chiffre
littéral dans `help.md` serait juste pour le déploiement de référence et faux
pour tout autre, et le modèle le servirait avec assurance — le mode de
confabulation que `help.md` a déjà provoqué plusieurs fois. Le jeton déplace la
valeur du texte vers sa source.

Trois fonctions, dans `tools.js` :

- `helpPlaceholderValues()` — la table `{NOM: valeur}`, **seule énumération**
  des jetons connus. En fonction et non en objet top-level : les constantes
  viennent de `storage.js`, et un `const` ne franchit pas la frontière de
  fichier au top-level dans le test runner.
- `resolveHelpPlaceholders(markdown, values)` — pure, testable. Un jeton inconnu
  est laissé **tel quel** plutôt que remplacé par du vide : un `{{TRUC}}` visible
  se remarque, un trou silencieux non.
- `helpContentResolved()` — l'aide entière résolue.

**Les deux consommateurs partagent la même source résolue** : `about` substitue
la section servie, `about_search` cherche dans `helpContentResolved()`. Résoudre
d'un seul côté ferait qu'une recherche portant sur un chiffre ne trouverait
rien, alors que la lecture de la section l'affiche — le défaut classique du
prédicat non appliqué à toutes ses sources.

`run_help_placeholders_check` (runner.py) lit la table dans `tools.js` plutôt
que d'en recopier les noms, et refuse aussi bien un jeton orphelin dans
`help.md` qu'une entrée de table jamais employée.

Ce contrôle est **statique** : il apparie des noms, sans jamais exécuter la
substitution. `.claude/skills/run-miaou/verify-help-placeholders.mjs` éprouve
l'autre moitié, dans la page buildée — la chaîne `config.json` → constante →
valeur substituée. Il vérifie qu'aucun jeton ne survit dans l'aide servie, que
les valeurs rendues sont bien celles des constantes **vivantes** du build (et
non des littéraux recopiés), et que `about_search` voit la même substitution
qu'`about` — le partage de source décrit ci-dessus, asserté plutôt que
seulement énoncé.

### Libellés de section et `{{TOPIC_LIST}}`

Un titre de section peut porter un libellé lisible après un tiret cadratin :

```markdown
## pieces-jointes — pièces jointes
## traces-outils — traces d'outils et inspection
```

`parse_help_sections` rend désormais un **couple** `({slug: markdown},
{slug: libellé})` ; le libellé est facultatif et n'entre jamais dans le slug,
dont dérive l'enum `topic` de l'outil. Les libellés partent dans
`__MIAOU_HELP_LABELS__`, marqueur distinct de `__MIAOU_HELP__` pour ne pas
changer la forme de `HELP_CONTENT` (consommée par `about`, l'enum et
`about_search`).

Ils servent `{{TOPIC_LIST}}`, la liste des sujets d'`apercu`, composée par
`formatHelpTopicList` depuis les sections **réellement présentes** — une puce
par sujet, `apercu` s'excluant lui-même, un slug sans libellé se rabattant sur
son slug plutôt que de disparaître.

C'est la raison d'être du mécanisme : cette phrase était le dernier endroit du
fichier où ajouter ou scinder une section rendait un texte faux **en silence**.
Une liste rédigée en prose n'annonce pas son propre nombre, donc le grep des
compteurs explicites (« deux types », « les trois modes ») ne pouvait rien
contre elle — le seul remède est de ne pas la rédiger. Ajouter une section
suffit maintenant à l'annoncer ; la seule chose à ne pas oublier est son
libellé, et son absence dégrade proprement.

### Découper une section

Les slugs ne vivent que dans `help.md` (seul `apercu` est codé en dur, comme
défaut de `about`) : renommer ou scinder ne casse donc rien mécaniquement,
l'enum se recalcule. Le coût est **éditorial**, et deux choses sont à reprendre
dans le même lot :

- les **renvois entre sujets** (`voir le sujet \`x\``) qui pointaient vers la
  section d'origine et visent en fait la moitié partie ailleurs ;
- les **renvois relatifs** (« voir plus bas », « décrite plus bas ») qui
  franchissent désormais une frontière de section — un lecteur qui ne reçoit
  qu'une section ne les résout plus.

Les deux ont été payés au découpage de `pieces-jointes` et `interface` : un
renvoi vers `interface` désignait le compteur d'agents (parti dans
`multitache`) et un autre l'inspecteur d'appel (parti dans `traces-outils`).

## Marqueur des skills système : `__MIAOU_SYSTEM_SKILLS__`

Substitué par le contenu des skills système (`src/system-skills/*.md`, cf.
`docs/skills.md` §7) : un fichier par skill, **nom de fichier = slug**.
`parse_system_skill_file` (build.py, pur) lit le cartouche frontmatter en tête
(`name` obligatoire, `description` optionnelle — **pas** de clé `autotrigger`/
`enabled`, une skill système n'expose aucun réglage) puis le corps Markdown ;
erreur bruyante si le cartouche est absent ou sans `name`, ou si le corps est
vide (contrairement à `config.json`, ces fichiers sont censés être valides dès
qu'ils existent). `load_system_skills()` agrège tous les fichiers du dossier
en objet ordonné `{slug: {name, description, content}}` ; dossier absent ou
vide → `{}` (additif, pas un prérequis de build). Sérialisé par `json.dumps` +
échappement `</`, mêmes contraintes que les marqueurs précédents.

Côté source (`skills.js`), unique point d'injection :

```js
const SYSTEM_SKILLS_CONTENT = (function () { try { return __MIAOU_SYSTEM_SKILLS__; } catch (e) { return {}; } })();
```

`ensureSystemSkills()` (`skills.js`, appelée depuis `init()` avant
`loadSkillsCache()`) upsert chaque entrée en IDB **inconditionnellement à
chaque démarrage** : le fichier `.md` source est la seule source de vérité
pour `name`/`description`/`content` ; `enabled` et `autotrigger` sont **figés
à `true`** (aucun réglage utilisateur possible sur une skill système). Sous
QuickJS, `SYSTEM_SKILLS_CONTENT` vaut `{}` (aucune skill système, comportement
identique à l'absence du dossier).
