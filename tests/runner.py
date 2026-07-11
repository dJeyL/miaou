#!/usr/bin/env python3
"""
tests/runner.py — exécute les tests JS via QuickJS
Usage :
  python tests/runner.py              # tous les test-*.js
  python tests/runner.py test-api.js  # un fichier précis
Dépendance : pip install quickjs
"""
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
    clear:      function()     { store = {}; },
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


def load_sources(ctx: "quickjs.Context") -> None:
    """Charge tous les fichiers source dans l'ordre du build."""
    for name in JS_ORDER:
        path = SRC_JS / name
        if not path.exists():
            continue
        try:
            ctx.eval(path.read_text(encoding='utf-8'))
        except Exception as e:
            print(f'  [warn] erreur au chargement de {name}: {e}')


def run_file(test_path: Path) -> tuple[int, int]:
    ctx = quickjs.Context()

    # 1. Stubs + framework
    ctx.eval(BROWSER_STUBS)
    ctx.eval(FRAMEWORK)

    # 2. Sources (tout le code applicatif)
    load_sources(ctx)

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

    return int(passed), int(failed) + eval_failed


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
        'préambule ignoré\n## overview\ncorps A\n\n## spaces\ncorps B\n')
    check('help : sections nominales → {slug: corps}',
          nominal == {'overview': 'corps A', 'spaces': 'corps B'})
    check('help : ordre des sections préservé',
          list(nominal.keys()) == ['overview', 'spaces'])
    check('help : texte avant la 1re section ignoré',
          'préambule' not in ''.join(nominal.values()))

    fence = build.parse_help_sections(
        '## overview\navant\n```\n## pas une section\n```\naprès\n## spaces\nx\n')
    check('help : ## dans un fence ne démarre pas de section',
          set(fence.keys()) == {'overview', 'spaces'}
          and '## pas une section' in fence['overview'])

    try:
        build.parse_help_sections('## overview\na\n## overview\nb\n')
        check('help : slug dupliqué → ValueError', False)
    except ValueError:
        check('help : slug dupliqué → ValueError', True)

    check('help : fichier sans section → dict vide',
          build.parse_help_sections('juste du texte, pas de titre\n') == {})

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
