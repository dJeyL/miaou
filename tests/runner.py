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

JS_ORDER = ['utils.js', 'docs.js', 'sync.js', 'storage.js', 'agents.js', 'resources.js', 'skills.js', 'tools.js', 'api.js', 'ui.js', 'main.js']

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
  // `body` : registerGeneration/unregisterGeneration appellent
  // syncLastAssistantActions, qui bascule la classe `agent-busy` sur le body
  // (glyphes de réécriture grisés tant qu'un agent travaille). Les tests
  // d'agent__spawn passent par ce cycle de vie, donc l'atteignent. Même
  // motif que `insertBefore` plus bas : le stub grandit quand un chemin
  // légitime l'atteint, il n'anticipe pas.
  body: _fakeEl(),
};

function _fakeEl() {
  return {
    value: '', textContent: '', innerHTML: '', style: {}, className: '',
    classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
    appendChild: function() {},
    // Ajouté au lot X-1 : deleteConv (cascade d'agents) atteint renderConvList
    // avec des conversations en base, donc convItemEl — qui insère la pastille
    // d'activité par insertBefore. Le stub s'arrêtait à appendChild parce
    // qu'aucun test n'avait encore emprunté ce chemin.
    insertBefore: function() {},
    removeChild: function() {},
    remove: function() {},
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

// Intl (lot X-1) : QuickJS ne l'implémente pas (project_quickjs_no_intl).
// contextBlockParts s'en sert pour le fuseau du bloc <miaou_context>, et le
// lancement effectif d'un agent construit son payload — donc l'atteint. Stub
// minimal : les tests ne vérifient jamais le contenu du fuseau, seulement que
// la chaîne se construit.
var Intl = { DateTimeFormat: function() {
  return { resolvedOptions: function() { return { timeZone: 'UTC' }; } };
} };

// Timers (lot X-1) : registerGeneration arme le relais multi-onglets par
// setInterval. Les tests qui lancent réellement un agent l'atteignent — les
// précédents ne créaient jamais de génération. Compteurs inertes : rien ne doit
// s'exécuter en différé dans un test synchrone.
var _timerSeq = 0;
function setTimeout(fn, ms) { return ++_timerSeq; }
function clearTimeout(id) {}
function setInterval(fn, ms) { return ++_timerSeq; }
function clearInterval(id) {}

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
        # collapse_blank_code_lines : passe post-strip, au niveau ligne. Elle
        # porte DEUX nettoyages — l'écrasement des runs de lignes vides, et le
        # rstrip. Le second existe parce que le strip d'un commentaire laisse
        # derrière lui soit l'indentation d'une ligne entière, soit les espaces
        # d'alignement d'un commentaire de fin de ligne : ~1100 lignes du dist
        # en portaient, ce qui rendait `git diff --check` inutilisable.
        ('collapse : blanc de fin de ligne retiré (commentaire de fin de ligne)',
         build.collapse_blank_code_lines, 'var a = 1;   \nvar b = 2;',
         'var a = 1;\nvar b = 2;'),
        ('collapse : indentation nue (commentaire pleine ligne retiré) -> vraiment vide',
         build.collapse_blank_code_lines, 'a\n    \nb', 'a\n\nb'),
        ('collapse : tabulation de fin retirée aussi',
         build.collapse_blank_code_lines, 'a\tb\t\nc', 'a\tb\nc'),
        ('collapse : runs de lignes vides écrasés à une seule (comportement historique)',
         build.collapse_blank_code_lines, 'a\n\n\n\nb', 'a\n\nb'),
        ('collapse : run de lignes BLANCHES (non vides) écrasé aussi',
         build.collapse_blank_code_lines, 'a\n  \n\t\n   \nb', 'a\n\nb'),
        ('collapse : indentation de DÉBUT de ligne préservée',
         build.collapse_blank_code_lines, '    var a = 1;   ', '    var a = 1;'),
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

    nominal, nominal_labels = build.parse_help_sections(
        'préambule ignoré\n## apercu\ncorps A\n\n## espaces\ncorps B\n')
    check('help : sections nominales → {slug: corps}',
          nominal == {'apercu': 'corps A', 'espaces': 'corps B'})
    check('help : ordre des sections préservé',
          list(nominal.keys()) == ['apercu', 'espaces'])
    check('help : texte avant la 1re section ignoré',
          'préambule' not in ''.join(nominal.values()))
    check('help : sans tiret cadratin, aucun libellé (le slug reste entier)',
          nominal_labels == {})

    # Libellés : `## slug — libellé`. Le libellé sert la phrase d'orientation
    # d'apercu, composée au runtime ; il ne doit JAMAIS entrer dans le slug (dont
    # dérive l'enum de l'outil), ni le tiret rester collé au corps.
    labelled, labels = build.parse_help_sections(
        '## pieces-jointes — pièces jointes\ncorps A\n## mcp — serveurs compagnons MCP\ncorps B\n')
    check('help : le libellé après « — » sort du slug',
          list(labelled.keys()) == ['pieces-jointes', 'mcp'])
    check('help : les libellés sont collectés à part',
          labels == {'pieces-jointes': 'pièces jointes', 'mcp': 'serveurs compagnons MCP'})
    check('help : le corps d\'une section libellée est intact',
          labelled['pieces-jointes'] == 'corps A')

    fence, _ = build.parse_help_sections(
        '## apercu\navant\n```\n## pas une section\n```\naprès\n## espaces\nx\n')
    check('help : ## dans un fence ne démarre pas de section',
          set(fence.keys()) == {'apercu', 'espaces'}
          and '## pas une section' in fence['apercu'])

    try:
        build.parse_help_sections('## apercu\na\n## apercu\nb\n')
        check('help : slug dupliqué → ValueError', False)
    except ValueError:
        check('help : slug dupliqué → ValueError', True)

    # Un slug dupliqué doit être vu comme tel même si les libellés diffèrent :
    # c'est la clef qui collisionne dans l'enum, pas le texte affiché.
    try:
        build.parse_help_sections('## a — un\nx\n## a — deux\ny\n')
        check('help : slug dupliqué sous deux libellés → ValueError', False)
    except ValueError:
        check('help : slug dupliqué sous deux libellés → ValueError', True)

    try:
        build.parse_help_sections('## — orphelin\nx\n')
        check('help : titre sans slug → ValueError', False)
    except ValueError:
        check('help : titre sans slug → ValueError', True)

    check('help : fichier sans section → dict vide',
          build.parse_help_sections('juste du texte, pas de titre\n') == ({}, {}))

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

    # ── Caps d'octets (lot V-1) : ancrage sur la SOURCE RÉELLE ────────────────
    # Le cap d'entrée (MAX_INLINE_BYTES, utils.js) et la borne de VM aval
    # (JS_EVAL_MEM_BYTES, tools.js) ont été portées ensemble : 32→64 Mo et
    # 128→256 Mo. Les désynchroniser recrée la contradiction garde d'entrée /
    # capacité aval déjà payée — un text() sur le plus gros blob adressable,
    # plus une copie dans le code du modèle, vivent tous deux dans la VM.
    #
    # Le test lit les SOURCES, pas des valeurs recopiées ici : le précédent qui
    # justifie cette précaution est celui des strippers EXPORT_*, corrects et
    # testés mais jamais câblés — une constante juste dans un test et fausse
    # dans le code passerait inaperçue.
    def read_const(src_name: str, const_name: str):
        src = (SRC_JS / src_name).read_text(encoding='utf-8')
        m = re.search(r'^const\s+' + const_name + r'\s*=\s*([0-9*\s]+);', src, re.M)
        if not m:
            return None
        return eval(m.group(1).strip(), {'__builtins__': {}}, {})

    max_inline = read_const('utils.js', 'MAX_INLINE_BYTES')
    js_eval_mem = read_const('tools.js', 'JS_EVAL_MEM_BYTES')

    check('caps : MAX_INLINE_BYTES est déclarée dans src/js/utils.js',
          max_inline is not None)
    check('caps : JS_EVAL_MEM_BYTES est déclarée dans src/js/tools.js',
          js_eval_mem is not None)
    check('caps : MAX_INLINE_BYTES vaut 64 Mo',
          max_inline == 64 * 1024 * 1024)
    check('caps : la borne de VM aval vaut au moins 4x le cap d\'entrée',
          max_inline is not None and js_eval_mem is not None
          and js_eval_mem >= 4 * max_inline)

    # L'ancienne constante ne doit plus subsister nulle part : deux caps
    # d'entrée concurrents, c'est le bug qu'on vient de retirer.
    all_js = '\n'.join((SRC_JS / n).read_text(encoding='utf-8') for n in JS_ORDER
                       if (SRC_JS / n).exists())
    check('caps : ATTACHMENT_BLOB_MAX_BYTES a totalement disparu des sources',
          'ATTACHMENT_BLOB_MAX_BYTES' not in all_js)
    check('caps : plus aucun libellé « 32 Mo » dans les sources JS',
          '32 Mo' not in all_js)

    # ── JS_ORDER : les deux listes doivent rester identiques (lot V-7) ────────
    # build.py et ce runner tiennent chacun leur copie de l'ordre de
    # concaténation. Un fichier ajouté au build mais pas au runner ne serait PAS
    # chargé par les tests : toutes ses fonctions deviendraient introuvables, et
    # les tests qui en dépendent échoueraient en ReferenceError en cascade —
    # load_sources les compte comme erreur, mais la CAUSE serait obscure. Dans
    # l'autre sens (runner à jour, build en retard), les tests passeraient au
    # vert sur un dist/ amputé, ce qui est pire.
    #
    # Ancrage sur les deux SOURCES, jamais sur une liste recopiée ici — même
    # raison que pour les caps ci-dessus.
    check('JS_ORDER : build.py et tests/runner.py listent les mêmes fichiers, dans le même ordre',
          build.JS_ORDER == JS_ORDER)
    check('JS_ORDER : chaque fichier listé existe dans src/js/',
          all((SRC_JS / n).exists() for n in JS_ORDER))
    check('JS_ORDER : aucun .js de src/js/ n\'est absent de la liste',
          sorted(p.name for p in SRC_JS.glob('*.js')) == sorted(JS_ORDER))

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


def run_help_placeholders_check() -> tuple[int, int]:
    """Vérifie que les jetons `{{NOM}}` de `src/help.md` sont tous résolus.

    L'aide est rédigée sans chiffre en dur partout où la prose qualitative
    suffit ; quand un chiffre est plus clair, il s'écrit `{{NOM}}` et
    `resolveHelpPlaceholders` (tools.js) le remplace par la constante vivante,
    de sorte qu'une valeur changée en config.json ne laisse pas l'aide mentir.

    Le défaut que ce test attrape est le jeton ORPHELIN : un `{{TRUC}}` écrit
    dans help.md sans entrée correspondante dans helpPlaceholderValues part tel
    quel au modèle, qui le sert à l'utilisateur comme du texte. La table JS est
    la SEULE énumération — on la lit ici plutôt que de recopier les noms, sans
    quoi ce test serait lui-même une énumération fermée à maintenir."""
    passed = failed = 0
    print('\njetons {{…}} de help.md')

    def check(label: str, cond: bool) -> None:
        nonlocal passed, failed
        if cond:
            passed += 1
            print(f'  PASS  {label}')
        else:
            failed += 1
            print(f'  FAIL  {label}')

    help_md = (ROOT.parent / 'src' / 'help.md').read_text(encoding='utf-8')
    tools_js = (SRC_JS / 'tools.js').read_text(encoding='utf-8')

    m = re.search(r'function helpPlaceholderValues\(\)\s*\{(.*?)\n\}', tools_js, re.S)
    check('helpPlaceholderValues est déclarée dans tools.js', m is not None)
    if not m:
        return passed, failed

    known = set(re.findall(r'^\s*([A-Z0-9_]+):', m.group(1), re.M))
    check('la table de jetons est non vide', bool(known))

    used = set(re.findall(r'\{\{([A-Z0-9_]+)\}\}', help_md))
    unknown = sorted(used - known)
    check(
        'aucun jeton de help.md n\'est absent de helpPlaceholderValues'
        + (f' (orphelins : {", ".join(unknown)})' if unknown else ''),
        not unknown,
    )

    # Un jeton défini mais jamais employé n'est pas un bug d'affichage ; c'est
    # du code mort qui suggère à tort que help.md cite cette valeur. Signalé.
    unused = sorted(known - used)
    check(
        'aucune entrée de la table n\'est inutilisée dans help.md'
        + (f' (mortes : {", ".join(unused)})' if unused else ''),
        not unused,
    )
    return passed, failed


def run_help_enumerations_check() -> tuple[int, int]:
    """Vérifie que les compteurs explicites de `src/help.md` correspondent
    toujours à l'ensemble qu'ils annoncent, quand cet ensemble est déclaré dans
    les sources.

    Angle mort payé SIX fois (cf. CLAUDE.md, question `help.md`). Le dernier en
    date : l'étape PowerPoint du lot V-5 a ajouté un cinquième format ouvert
    nativement, et deux énumérations en sont restées à quatre. Le mécanisme est
    toujours le même — le paragraphe de la nouvelle capacité est bien écrit, et
    c'est une phrase ailleurs dans le fichier, que le diff du lot ne montre pas,
    qui devient fausse. Un modèle lisant le topic en entier rencontre le compte
    fermé AVANT la capacité et conclut qu'elle n'existe pas.

    Portée VOLONTAIREMENT ÉTROITE : on ne compte que ce dont l'ensemble a une
    source de vérité dans le code (les lecteurs de DOC_READERS, les palettes,
    les lots de fontes). Une heuristique qui compterait les items en aval de
    tout « Deux… » serait bruyante et fausse — `help.md` emploie beaucoup de
    tournures narratives (« Deux choses valent d'être sues ») qui ne sont pas
    des énumérations de capacités. Ce test attrape le cas mécanique ; la
    relecture de la section entière reste à la charge de qui écrit."""
    passed = failed = 0
    print('\nhelp.md ↔ compteurs de capacités')

    help_md = (ROOT.parent / 'src' / 'help.md').read_text(encoding='utf-8')
    docs_js = (SRC_JS / 'docs.js').read_text(encoding='utf-8')

    def check(label: str, ok: bool) -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
            print(f'  PASS  {label}')
        else:
            failed += 1
            print(f'  FAIL  {label}')

    # DOC_READERS est la source unique des formats ouverts nativement
    # (nativeDocKinds en dérive déjà le message de refus — même principe ici).
    m = re.search(r'const DOC_READERS = \{(.*?)\n\};', docs_js, re.S)
    if not m:
        check('DOC_READERS introuvable dans docs.js', False)
        return passed, failed
    kinds = re.findall(r'^\s*(\w+)\s*:', m.group(1), re.M)

    # Le mot par lequel help.md nomme chaque format (il s'adresse à
    # l'utilisateur : « classeurs Excel », pas « xlsx »).
    labels = {'zip': 'zip', 'pdf': 'pdf', 'xlsx': 'excel',
              'docx': 'word', 'pptx': 'powerpoint'}

    # (1) Chaque format est nommé quelque part. Garde de base : un format
    # rapatrié dont help.md ne parle nulle part est invisible pour le modèle.
    low = help_md.lower()
    missing = [k for k in kinds if labels.get(k, k) not in low]
    check('help.md : chaque format de DOC_READERS y est nommé'
          + (f' — manquants : {missing}' if missing else ''),
          not missing)

    # (2) LE VRAI CAS PAYÉ : les ÉNUMÉRATIONS. Une ligne qui cite plusieurs
    # formats en liste doit les citer TOUS — c'est là que PowerPoint a été
    # oublié deux fois à l'étape 3 de V-5, sans qu'aucun compteur ne le dise
    # (help.md n'en porte aucun : un test cherchant « cinq formats » passerait
    # à vide, satisfait par l'absence — précisément le défaut relevé dans les
    # verify de V-5). Seuil à 3 : en deçà, c'est une mention ciblée
    # (« un PDF ou un classeur »), pas une énumération de l'offre.
    #
    # L'unité d'analyse est le PARAGRAPHE, pas la ligne : help.md est du markdown
    # reflué, et ses énumérations sont coupées par le retour à la ligne. Un
    # premier jet ligne à ligne signalait deux faux positifs (l.14 et l.310) dont
    # l'énumération était complète mais à cheval sur deux lignes.
    SEUIL = 3
    incomplete = []
    para, start = [], 1
    blocks = []
    for ln_no, ln in enumerate(help_md.splitlines() + [''], 1):
        if ln.strip():
            if not para:
                start = ln_no
            para.append(ln)
        elif para:
            blocks.append((start, ' '.join(para)))
            para = []
    for start, text in blocks:
        low_p = text.lower()
        present = [k for k in kinds if labels.get(k, k) in low_p]
        if len(present) >= SEUIL and len(present) < len(kinds):
            absent = [labels.get(k, k) for k in kinds if labels.get(k, k) not in low_p]
            incomplete.append(f'§l.{start} cite {len(present)}/{len(kinds)} (manque {", ".join(absent)})')
    check(f'help.md : toute énumération d\'au moins {SEUIL} formats les cite tous'
          + (' — ' + ' ; '.join(incomplete) if incomplete else ''),
          not incomplete)

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
    p, fa = run_help_enumerations_check()
    total_passed += p
    total_failed += fa
    p, fa = run_help_placeholders_check()
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
