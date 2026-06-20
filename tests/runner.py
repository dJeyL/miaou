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

JS_ORDER = ['utils.js', 'storage.js', 'tools.js', 'api.js', 'ui.js', 'main.js']

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
    try:
        ctx.eval(test_code)
    except Exception as e:
        print(f'  [erreur JS] {e}')

    # 4. Récupération des résultats
    logs = ctx.eval('_log_buffer.join("\\n")')
    passed = ctx.eval('_passed')
    failed = ctx.eval('_failed')

    print(f'\n{test_path.name}')
    if logs:
        print(logs)

    return int(passed), int(failed)


def main(args: list[str]) -> int:
    if args:
        files = [ROOT / a if not Path(a).is_absolute() else Path(a) for a in args]
    else:
        files = sorted(ROOT.glob('test-*.js'))

    if not files:
        print('Aucun fichier de test trouvé.')
        return 0

    total_passed = total_failed = 0
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
