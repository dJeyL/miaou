#!/usr/bin/env python3
"""
tests/runner.py — exécute les tests JS via QuickJS
Usage :
  python tests/runner.py              # tous les test-*.js
  python tests/runner.py test-api.js  # un fichier précis
Dépendance : pip install quickjs
"""
import re
import sys
from pathlib import Path

try:
    import quickjs
except ImportError:
    print('Dépendance manquante : pip install quickjs')
    sys.exit(1)

ROOT = Path(__file__).parent
SRC_JS = ROOT.parent / 'src' / 'js'

JS_ORDER = ['utils.js', 'sync.js', 'storage.js', 'resources.js', 'skills.js', 'tools.js', 'api.js', 'ui.js', 'main.js']

# ── Stubs navigateur ──────────────────────────────────────────────────────────
# On simule juste ce qu'il faut pour que le code source charge sans exploser.
# Les tests ne testent que des fonctions pures ; rien ici n'est un vrai mock.

BROWSER_STUBS = r"""
var __TEST_ENV__ = true;

var _log_buffer = [];
function _log(s) { _log_buffer.push(String(s)); }
var console = { log: _log, warn: _log, error: _log, info: _log };

var window   = {};
var navigator = { clipboard: { writeText: function() {} } };

var document = {
  getElementById:      function() { return _fakeEl(); },
  createElement:       function() { return _fakeEl(); },
  querySelector:       function() { return _fakeEl(); },
  querySelectorAll:    function() { return []; },
  addEventListener:    function() {},
};

function _fakeEl() {
  return {
    value: '', textContent: '', innerHTML: '', style: {}, className: '',
    classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
    appendChild: function() {},
    querySelector: function() { return _fakeEl(); },
    querySelectorAll: function() { return []; },
    scrollTop: 0, scrollHeight: 0,
    addEventListener: function() {},
    disabled: false,
    focus: function() {},
    rows: 1,
  };
}

var localStorage = (function() {
  var store = {};
  return {
    getItem:    function(k)    { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem:    function(k, v) { store[k] = String(v); },
    removeItem: function(k)    { delete store[k]; },
    // Le cache RAM conversations/résumés (lot U-1) est désormais la source de
    // vérité des lecteurs synchrones : un clear() qui ne viderait que
    // localStorage laisserait les conversations d'un test fuiter dans le
    // suivant. resetConvCacheForTests est défini dans storage.js (absent tant
    // que ce fichier n'est pas chargé, d'où le typeof).
    clear:      function()     { store = {}; if (typeof resetConvCacheForTests === 'function') resetConvCacheForTests(); },
  };
})();

var fetch = function() { return { then: function() { return this; }, catch: function() { return this; } }; };
"""

# ── Framework de test (JS pur, ~30 lignes) ────────────────────────────────────
FRAMEWORK = r"""
var _passed = 0, _failed = 0;

function describe(label, fn) {
  _log('\n' + label);
  fn();
}

function it(label, fn) {
  try {
    fn();
    _passed++;
    _log('  PASS  ' + label);
  } catch(e) {
    _failed++;
    _log('  FAIL  ' + label + '\n        ' + (e.message || e));
  }
}

function expect(actual) {
  function fail(msg) { throw new Error(msg); }
  return {
    toBe: function(exp) {
      if (actual !== exp) fail('attendu ' + JSON.stringify(exp) + ', reçu ' + JSON.stringify(actual));
    },
    toEqual: function(exp) {
      if (JSON.stringify(actual) !== JSON.stringify(exp))
        fail('attendu ' + JSON.stringify(exp) + ', reçu ' + JSON.stringify(actual));
    },
    toContain: function(exp) {
      if (String(actual).indexOf(exp) < 0)
        fail('devrait contenir ' + JSON.stringify(exp) + ', reçu ' + JSON.stringify(actual));
    },
    toBeTruthy: function() { if (!actual) fail('attendu truthy, reçu ' + JSON.stringify(actual)); },
    toBeFalsy:  function() { if (actual)  fail('attendu falsy, reçu '  + JSON.stringify(actual)); },
    toThrow:    function() {
      if (typeof actual !== 'function') fail('expect(fn).toThrow() — la valeur doit être une fonction');
      try { actual(); fail('la fonction n\'a pas levé d\'exception'); }
      catch(e) { /* OK */ }
    },
  };
}
"""


def load_sources(ctx: "quickjs.Context") -> int:
    """Charge tous les fichiers source dans l'ordre du build. Retourne le
    nombre de fichiers en échec : une erreur ici casse silencieusement TOUS
    les tests qui dépendent de la fonction manquante (ReferenceError en
    cascade) sans faire échouer le run — doit compter comme un échec, pas un
    simple warn (cf. c27)."""
    errors = 0
    for name in JS_ORDER:
        path = SRC_JS / name
        if not path.exists():
            continue
        try:
            ctx.eval(path.read_text(encoding='utf-8'))
        except Exception as e:
            print(f'  [erreur JS] erreur au chargement de {name}: {e}')
            errors += 1
    return errors


def run_file(test_path: Path) -> tuple[int, int]:
    ctx = quickjs.Context()

    # 1. Stubs + framework
    ctx.eval(BROWSER_STUBS)
    ctx.eval(FRAMEWORK)

    # 2. Sources (tout le code applicatif)
    source_errors = load_sources(ctx)

    # 3. Fichier de test
    test_code = test_path.read_text(encoding='utf-8')
    eval_failed = 0
    try:
        ctx.eval(test_code)
    except Exception as e:
        # Une erreur hors it() (syntaxe, exception top-level) saute le reste du
        # fichier : compter un échec, sinon la suite resterait verte en sautant
        # silencieusement des tests (code retour 0 trompeur).
        print(f'  [erreur JS] {e}')
        eval_failed = 1

    # 4. Récupération des résultats
    logs = ctx.eval('_log_buffer.join("\\n")')
    passed = ctx.eval('_passed')
    failed = ctx.eval('_failed')

    print(f'\n{test_path.name}')
    if logs:
        print(logs)

    return int(passed), int(failed) + eval_failed + source_errors


def run_build_unit_tests() -> tuple[int, int]:
    """Tests unitaires (Python) des transformations de build.py — strip des
    commentaires JS/CSS. Exécutés avant les tests QuickJS, mêmes compteurs."""
    sys.path.insert(0, str(ROOT.parent))
    import build

    cases = [
        # (label, fn, entrée, sortie attendue)
        ('CSS : commentaire retiré',
         build.strip_css_comments, 'a { color: red; /* rouge */ }', 'a { color: red;  }'),
        ('CSS : commentaire multi-lignes retiré',
         build.strip_css_comments, 'a {}\n/* bloc\n   long */\nb {}', 'a {}\n\nb {}'),
        ('CSS : /* dans une string double-quotée préservé',
         build.strip_css_comments, 'a::before { content: "/* pas un commentaire */"; }',
         'a::before { content: "/* pas un commentaire */"; }'),
        ('CSS : string simple-quotée avec échappement',
         build.strip_css_comments, "a::before { content: 'l\\'astuce /*x*/'; }",
         "a::before { content: 'l\\'astuce /*x*/'; }"),
        ('CSS : commentaire non terminé → coupé jusqu\'à EOF, sans crash',
         build.strip_css_comments, 'a {}\n/* ouvert', 'a {}\n'),
        ('HTML : commentaire retiré (y compris multi-lignes)',
         build.strip_html_comments, '<div>a</div>\n<!-- com\n   long -->\n<div>b</div>',
         '<div>a</div>\n\n<div>b</div>'),
        ('HTML : plusieurs commentaires, non-greedy',
         build.strip_html_comments, '<!-- a --><p>x</p><!-- b -->', '<p>x</p>'),
        ('HTML : commentaire non terminé laissé tel quel',
         build.strip_html_comments, '<p>x</p><!-- ouvert', '<p>x</p><!-- ouvert'),
        ('JS : // dans une string préservé',
         build.strip_js_comments, "var u = 'http://x'; // com", "var u = 'http://x'; "),
        ('JS : /* dans un template literal préservé',
         build.strip_js_comments, 'var t = `a /* b */ ${1 /* c */} d`;', 'var t = `a /* b */ ${1 } d`;'),
        ('JS : regex literal contenant /* préservée',
         build.strip_js_comments, 'var re = /a\\/*b/; // com', 'var re = /a\\/*b/; '),
    ]

    passed = failed = 0
    print('\nbuild.py (tests unitaires Python)')
    for label, fn, given, expected in cases:
        got = fn(given)
        if got == expected:
            passed += 1
            print(f'  PASS  {label}')
        else:
            failed += 1
            print(f'  FAIL  {label}\n        attendu {expected!r}, reçu {got!r}')

    # parse_help_sections : dict ordonné + cas d'erreur (formes hors gabarit
    # (label, fn, in, out) ci-dessus).
    def check(label, cond):
        nonlocal passed, failed
        if cond:
            passed += 1
            print(f'  PASS  {label}')
        else:
            failed += 1
            print(f'  FAIL  {label}')

    nominal = build.parse_help_sections(
        'préambule ignoré\n## apercu\ncorps A\n\n## espaces\ncorps B\n')
    check('help : sections nominales → {slug: corps}',
          nominal == {'apercu': 'corps A', 'espaces': 'corps B'})
    check('help : ordre des sections préservé',
          list(nominal.keys()) == ['apercu', 'espaces'])
    check('help : texte avant la 1re section ignoré',
          'préambule' not in ''.join(nominal.values()))

    fence = build.parse_help_sections(
        '## apercu\navant\n```\n## pas une section\n```\naprès\n## espaces\nx\n')
    check('help : ## dans un fence ne démarre pas de section',
          set(fence.keys()) == {'apercu', 'espaces'}
          and '## pas une section' in fence['apercu'])

    try:
        build.parse_help_sections('## apercu\na\n## apercu\nb\n')
        check('help : slug dupliqué → ValueError', False)
    except ValueError:
        check('help : slug dupliqué → ValueError', True)

    check('help : fichier sans section → dict vide',
          build.parse_help_sections('juste du texte, pas de titre\n') == {})

    # strip_export_css_comments : EXPORT_CSS est une feuille CSS figée qui vit
    # dans un template literal de ui.js. strip_js_comments laisse le contenu
    # des literals intact (c'est voulu), donc ses commentaires partaient dans
    # dist/miaou.html ET dans chaque fichier exporté. Ces cas visent le
    # CÂBLAGE (quel stripper s'applique à quoi), pas la découpe elle-même :
    # c'est le câblage qui manquait, strip_css_comments était déjà correct.
    ecc = build.strip_export_css_comments

    check('export-css : commentaire du littéral retiré',
          ecc('const EXPORT_CSS = `\na { /* x */ color: red; }\n`;\n')
          == 'const EXPORT_CSS = `\na {  color: red; }\n`;\n')

    check('export-css : le code JS autour est intact',
          ecc('var before = 1;\nconst EXPORT_CSS = `\na { /* x */ }\n`;\nvar after = 2;\n')
          == 'var before = 1;\nconst EXPORT_CSS = `\na {  }\n`;\nvar after = 2;\n')

    check('export-css : un fichier sans EXPORT_CSS est rendu inchangé',
          ecc('var t = `a /* pas touche */ b`;\n') == 'var t = `a /* pas touche */ b`;\n')

    check('export-css : idempotente (rejouable sans dégât)',
          ecc(ecc('const EXPORT_CSS = `\na { /* x */ }\n`;\n'))
          == ecc('const EXPORT_CSS = `\na { /* x */ }\n`;\n'))

    # Ciblage rigide : toute forme hors gabarit doit être un no-op explicite,
    # jamais une découpe approximative dans un template literal (piège 22).
    check('export-css : littéral non terminé → no-op',
          ecc('const EXPORT_CSS = `\na { /* x */ }\n') == 'const EXPORT_CSS = `\na { /* x */ }\n')

    check('export-css : ancre indentée (non colonne 0) → no-op',
          ecc('  const EXPORT_CSS = `\na { /* x */ }\n`;\n')
          == '  const EXPORT_CSS = `\na { /* x */ }\n`;\n')

    check('export-css : content: "/*" dans la feuille préservé',
          ecc('const EXPORT_CSS = `\na::before { content: "/*"; }\n`;\n')
          == 'const EXPORT_CSS = `\na::before { content: "/*"; }\n`;\n')

    # Garde-fou de dernier recours du piège 22 : si la découpe produisait un
    # backtick ou un ${, on préfère ne rien faire que casser le literal.
    # Un backtick ne peut se trouver dans le corps QUE dans un commentaire (le
    # piège 22 l'interdit ailleurs) : le retirer rouvrirait le literal. Cas
    # censé être impossible en vrai — d'où la ceinture, testée ici quand même.
    backtick_case = 'const EXPORT_CSS = `\na { /* ` */ }\n`;\n'
    check('export-css : backtick dans le corps → no-op (piège 22)',
          ecc(backtick_case) == backtick_case)

    interp_case = 'const EXPORT_CSS = `\na { /* ${x} */ }\n`;\n'
    check('export-css : ${ dans le corps → no-op (piège 22)',
          ecc(interp_case) == interp_case)

    # Test d'ANCRAGE sur la source réelle : c'est lui qui hurlera si le
    # littéral est un jour renommé ou ré-indenté — sans quoi la fonction
    # redeviendrait un no-op silencieux et les commentaires repartiraient
    # dans les exports sans que rien ne l'annonce.
    ui_src = (ROOT.parent / 'src' / 'js' / 'ui.js').read_text(encoding='utf-8')
    check('export-css : EXPORT_CSS est bien reconnu dans src/js/ui.js',
          ecc(ui_src) != ui_src)
    def literal_body(text, anchor):
        """Corps du littéral `anchor` dans `text` (même découpe que le build)."""
        i = text.index(anchor) + len(anchor)
        return text[i:text.index('\n`;', i)]

    check('export-css : plus aucun /* dans EXPORT_CSS après strip (source réelle)',
          '/*' not in literal_body(ecc(ui_src), build.EXPORT_CSS_ANCHOR))

    # strip_export_script_comments : EXPORT_SCRIPT est du JS statique embarqué
    # dans les exports INTERACTIFS. On n'y retire QUE les lignes '//' — un
    # scanner JS complet lirait mal ce corps, dont les échappements sont
    # doublés par le template literal (cf. strip_line_comments_only).
    esc = build.strip_export_script_comments

    check('export-script : ligne // retirée',
          esc('const EXPORT_SCRIPT = `\nvar a = 1;\n// com\nvar b = 2;\n`;\n')
          == 'const EXPORT_SCRIPT = `\nvar a = 1;\nvar b = 2;\n`;\n')

    check('export-script : ligne // indentée retirée',
          esc('const EXPORT_SCRIPT = `\n  // com\nvar b = 2;\n`;\n')
          == 'const EXPORT_SCRIPT = `\nvar b = 2;\n`;\n')

    # Le point de la passe « bête » : ne JAMAIS toucher à l'intérieur d'une
    # ligne de code. Une URL, une regex ou une string contenant '//' survit.
    check('export-script : // en milieu de ligne de code préservé',
          esc("const EXPORT_SCRIPT = `\nvar u = 'http://x';\n`;\n")
          == "const EXPORT_SCRIPT = `\nvar u = 'http://x';\n`;\n")

    check('export-script : regex échappée du literal préservée',
          esc('const EXPORT_SCRIPT = `\nvar n = s.replace(/[\\\\/]/g, "_");\n`;\n')
          == 'const EXPORT_SCRIPT = `\nvar n = s.replace(/[\\\\/]/g, "_");\n`;\n')

    check('export-script : un fichier sans EXPORT_SCRIPT est rendu inchangé',
          esc('var t = 1;\n') == 'var t = 1;\n')

    check('export-script : idempotente',
          esc(esc('const EXPORT_SCRIPT = `\n// com\nvar b = 2;\n`;\n'))
          == esc('const EXPORT_SCRIPT = `\n// com\nvar b = 2;\n`;\n'))

    check('export-script : EXPORT_SCRIPT est bien reconnu dans src/js/ui.js',
          esc(ui_src) != ui_src)

    # GARDE DE DOCTRINE (décision Julien) : EXPORT_SCRIPT ne tolère QUE des
    # commentaires '//' en pleine ligne. Un bloc /* */ ou un '//' en fin de
    # ligne de code ne serait PAS retiré — il partirait silencieusement dans
    # chaque export interactif. Ce test est la seule chose qui empêche la
    # règle de dériver : il échoue à l'écriture, pas à la lecture de la doc.
    script_body = literal_body(ui_src, build.EXPORT_SCRIPT_ANCHOR)
    check('export-script : aucun bloc /* */ dans EXPORT_SCRIPT (doctrine)',
          '/*' not in script_body)

    def code_line_has_trailing_comment(line):
        stripped = line.lstrip()
        if stripped.startswith('//') or '//' not in line:
            return False
        # '//' présent hors d'une ligne entièrement commentée : suspect. On
        # tolère les cas où il vit dans une string/regex (http://, [\\/]),
        # que la passe laisse volontairement en place.
        head = line.split('//')[0]
        return head.strip().endswith((';', '{', '}', ')'))

    check('export-script : aucun // en fin de ligne de code (doctrine)',
          not [l for l in script_body.split('\n') if code_line_has_trailing_comment(l)])

    check('export-script : plus aucune ligne // après strip (source réelle)',
          not [l for l in literal_body(esc(ui_src), build.EXPORT_SCRIPT_ANCHOR).split('\n')
               if l.lstrip().startswith('//')])

    # parse_system_skill_file / load_system_skills (skills système, src/system-skills/*.md)
    fake_path = Path('src/system-skills/fake.md')

    nominal_skill = build.parse_system_skill_file(
        '---\nname: Fake\ndescription: Une skill de test\n---\n\nCorps de la skill.\n',
        fake_path)
    check('system-skills : cartouche nominal → {name, description, content}',
          nominal_skill == {'name': 'Fake', 'description': 'Une skill de test',
                             'content': 'Corps de la skill.'})

    no_desc_skill = build.parse_system_skill_file(
        '---\nname: Fake\n---\n\nCorps.\n', fake_path)
    check('system-skills : description absente → chaîne vide',
          no_desc_skill['description'] == '')

    try:
        build.parse_system_skill_file('Pas de cartouche ici.\n', fake_path)
        check('system-skills : cartouche absent → ValueError', False)
    except ValueError:
        check('system-skills : cartouche absent → ValueError', True)

    try:
        build.parse_system_skill_file('---\ndescription: sans nom\n---\nCorps.\n', fake_path)
        check('system-skills : cartouche sans « name » → ValueError', False)
    except ValueError:
        check('system-skills : cartouche sans « name » → ValueError', True)

    try:
        build.parse_system_skill_file('---\nname: Fake\n---\n\n', fake_path)
        check('system-skills : corps vide → ValueError', False)
    except ValueError:
        check('system-skills : corps vide → ValueError', True)

    real_skills = build.load_system_skills()
    check('system-skills : load_system_skills() lit src/system-skills/*.md et trouve « mermaid »',
          'mermaid' in real_skills
          and set(real_skills['mermaid'].keys()) == {'name', 'description', 'content'})
    check('system-skills : trouve aussi « files-promote » et « js-eval » (doctrines extraites de ROOT_SYSTEM_PROMPT)',
          'files-promote' in real_skills and 'js-eval' in real_skills)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        empty_src = Path(tmp) / 'src'
        empty_src.mkdir()
        orig_src = build.SRC
        build.SRC = empty_src
        try:
            check('system-skills : dossier absent → {} (additif, pas un prérequis de build)',
                  build.load_system_skills() == {})
        finally:
            build.SRC = orig_src

    return passed, failed


def run_docs_index_check() -> tuple[int, int]:
    """Vérifie que chaque docs/*.md figure dans la section « Domaines détaillés »
    de CLAUDE.md. Angle mort déjà payé : ajouter un doc de domaine sans mettre à
    jour l'index le rend invisible (context-inspector.md l'était). On borne à la
    section pour attraper le cas d'un doc référencé ailleurs mais hors index."""
    passed = failed = 0
    print('\ndocs/ ↔ index CLAUDE.md')

    claude_md = ROOT.parent / 'CLAUDE.md'
    docs_dir = ROOT.parent / 'docs'
    text = claude_md.read_text(encoding='utf-8')

    # Isoler la section « Domaines détaillés » : de son en-tête ## jusqu'au ##
    # suivant (ou EOF).
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines)
                  if ln.startswith('## ') and 'Domaines détaillés' in ln), None)
    if start is None:
        print("  FAIL  section « Domaines détaillés » introuvable dans CLAUDE.md")
        return passed, failed + 1
    end = next((i for i in range(start + 1, len(lines))
                if lines[i].startswith('## ')), len(lines))
    section = '\n'.join(lines[start:end])

    for f in sorted(docs_dir.glob('*.md')):
        rel = f'docs/{f.name}'
        if rel in section:
            passed += 1
            print(f'  PASS  {rel} indexé')
        else:
            failed += 1
            print(f'  FAIL  {rel} absent de l\'index « Domaines détaillés »')

    return passed, failed


def run_idb_schema_check() -> tuple[int, int]:
    """Vérifie que les DEUX points d'ouverture de la base `miaou` restent
    d'accord : même version demandée, et `onupgradeneeded` identiques.

    Le schéma est déclaré deux fois (`openConvDB` dans storage.js,
    `openResourceDB` dans resources.js) parce que l'un ou l'autre peut ouvrir la
    base en premier. Dette assumée au lot U-1 — mais elle s'est payée au boot
    suivant : `openResourceDB` était resté sur le littéral `3` après le bump v4,
    et demander une version INFÉRIEURE à celle de la base la fait rejeter
    (`VersionError`). Tout ce qui passe par ce chemin (bibliothèque d'espace,
    skills système, pièces jointes) tombait en silence sur un historique migré.

    QuickJS n'a pas IndexedDB : ce contrôle est donc source-à-source, comme
    l'index docs. Grossier mais suffisant — il attrape exactement la divergence
    qui a coûté le bug."""
    passed = failed = 0
    print('\nschéma IDB — accord entre les deux points d\'ouverture')

    src = ROOT.parent / 'src' / 'js'
    storage = (src / 'storage.js').read_text(encoding='utf-8')
    resources = (src / 'resources.js').read_text(encoding='utf-8')

    def upgrade_body(text: str) -> str | None:
        """Corps du onupgradeneeded, commentaires et blancs retirés."""
        i = text.find('req.onupgradeneeded')
        if i < 0:
            return None
        j = text.index('{', i)
        depth, k = 0, j
        while k < len(text):
            if text[k] == '{':
                depth += 1
            elif text[k] == '}':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        body = re.sub(r'//.*', '', text[j:k + 1])
        return re.sub(r'\s+', '', body)

    # 1. Une seule constante de version, et aucun littéral d'ouverture en dur.
    if 'const MIAOU_DB_VERSION' in storage:
        passed += 1
        print('  PASS  MIAOU_DB_VERSION déclarée (storage.js)')
    else:
        failed += 1
        print('  FAIL  MIAOU_DB_VERSION introuvable dans storage.js')

    opens = re.findall(r"indexedDB\.open\(\s*'miaou'\s*,\s*([^)]+?)\s*\)",
                       storage + resources)
    if opens and all(o.strip() == 'MIAOU_DB_VERSION' for o in opens):
        passed += 1
        print(f'  PASS  les {len(opens)} ouvertures passent par la constante')
    else:
        failed += 1
        print(f'  FAIL  ouverture(s) avec une version en dur : {opens}')

    # 2. Les deux onupgradeneeded sont identiques.
    a, b = upgrade_body(storage), upgrade_body(resources)
    if a is None or b is None:
        failed += 1
        print('  FAIL  onupgradeneeded introuvable dans storage.js ou resources.js')
    elif a == b:
        passed += 1
        print('  PASS  les deux onupgradeneeded sont identiques')
    else:
        failed += 1
        print('  FAIL  les deux onupgradeneeded ont divergé')

    return passed, failed


def main(args: list[str]) -> int:
    if args:
        files = [ROOT / a if not Path(a).is_absolute() else Path(a) for a in args]
    else:
        files = sorted(ROOT.glob('test-*.js'))

    if not files:
        print('Aucun fichier de test trouvé.')
        return 0

    total_passed, total_failed = run_build_unit_tests()
    p, fa = run_docs_index_check()
    total_passed += p
    total_failed += fa
    p, fa = run_idb_schema_check()
    total_passed += p
    total_failed += fa
    for f in files:
        if not f.exists():
            print(f'Fichier introuvable : {f}')
            total_failed += 1
            continue
        p, fa = run_file(f)
        total_passed += p
        total_failed += fa

    print(f'\n{"─" * 44}')
    status = 'OK' if total_failed == 0 else 'ÉCHEC'
    print(f'  {status} — {total_passed} passé(s), {total_failed} échoué(s)')
    return 0 if total_failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
