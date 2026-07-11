#!/usr/bin/env python3
"""
build.py — assemble dist/miaou.html depuis src/
Usage : python build.py
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
SRC  = ROOT / 'src'
DIST = ROOT / 'dist'

# Ordre de concaténation — les dépendances d'abord
JS_ORDER = [
    'utils.js',
    'storage.js',
    'resources.js',
    'skills.js',
    'tools.js',
    'api.js',
    'ui.js',
    'main.js',
]

# Ordre de concaténation CSS — l'ordre EST la cascade (les surcharges de même
# spécificité comptent sur lui) : base d'abord (@import des fontes en tête de
# feuille, exigence CSS), thème clair en dernier.
CSS_ORDER = [
    'base.css',
    'sidebar.css',
    'chat.css',
    'composer.css',
    'drawers.css',
    'tools.css',
    'responsive.css',
    'theme-light.css',
]

CSS_PLACEHOLDER = '/* __CSS__ */'
JS_PLACEHOLDER  = '/* __JS__ */'


def read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def strip_js_comments(src: str) -> str:
    """Retire les commentaires // et /* */ d'une source JS, en respectant les
    strings ('...', "...", `...` avec ${...} imbriqués à l'infini) et les
    regex literals. Le contenu des strings/template literals n'est jamais
    modifié (un '//' dans une URL, par ex., doit survivre).

    Implémentation à pile explicite : chaque niveau de ${...} imbriqué dans
    un template literal empile un contexte 'template' ; un '}' dépile vers
    le contexte parent une fois les accolades de code rééquilibrées. Ça évite
    de dupliquer le scanner pour chaque profondeur d'imbrication."""
    out = []
    i = 0
    n = len(src)
    # Pile de frames : ('code',) en haut niveau, ('template', brace_depth)
    # quand on est à l'intérieur d'un ${...} — brace_depth compte les accolades
    # de code ouvertes dans ce ${...} pour savoir quel '}' referme l'expression.
    stack = [('code',)]

    def prev_significant_char():
        for j in range(len(out) - 1, -1, -1):
            chunk = out[j]
            for k in range(len(chunk) - 1, -1, -1):
                c = chunk[k]
                if not c.isspace():
                    return c
        return ''

    def consume_string(quote):
        nonlocal i
        out.append(quote)
        i += 1
        while i < n:
            if src[i] == '\\' and i + 1 < n:
                out.append(src[i:i + 2])
                i += 2
                continue
            out.append(src[i])
            if src[i] == quote:
                i += 1
                return
            i += 1

    def consume_template_start():
        # Ouvre un template literal : empile juste le marqueur de backtick,
        # le contenu est traité par la boucle principale caractère par
        # caractère (pour détecter ${ et le backtick fermant).
        nonlocal i
        out.append('`')
        i += 1
        stack.append(('template',))

    while i < n:
        frame = stack[-1]
        c = src[i]

        if frame[0] == 'template':
            if c == '\\' and i + 1 < n:
                out.append(src[i:i + 2])
                i += 2
                continue
            if c == '`':
                out.append(c)
                i += 1
                stack.pop()
                continue
            if c == '$' and i + 1 < n and src[i + 1] == '{':
                out.append('${')
                i += 2
                stack.append(('code',))
                continue
            out.append(c)
            i += 1
            continue

        # frame == 'code' (top-level ou intérieur d'un ${...})
        if c == '}' and len(stack) > 1:
            out.append(c)
            i += 1
            stack.pop()
            continue

        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            i = n if j == -1 else j
            continue

        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j == -1 else j + 2
            continue

        if c == "'" or c == '"':
            consume_string(c)
            continue

        if c == '`':
            consume_template_start()
            continue

        if c == '/':
            # Distinction division / regex literal : heuristique standard
            # basée sur le dernier caractère significatif précédent.
            prev = prev_significant_char()
            regex_context = prev == '' or prev in '([{,;:!&|?=+-*%^~<>' or prev == '\n'
            if regex_context:
                j = i + 1
                in_class = False
                closed = False
                while j < n:
                    ch = src[j]
                    if ch == '\\':
                        j += 2
                        continue
                    if ch == '[':
                        in_class = True
                    elif ch == ']':
                        in_class = False
                    elif ch == '/' and not in_class:
                        closed = True
                        j += 1
                        break
                    elif ch == '\n':
                        break
                    j += 1
                if closed:
                    while j < n and src[j].isalpha():
                        j += 1
                    out.append(src[i:j])
                    i = j
                    continue

        out.append(c)
        i += 1

    return ''.join(out)


def strip_css_comments(src: str) -> str:
    """Retire les commentaires /* */ d'une source CSS en respectant les strings
    ('…' et "…", échappements \\ compris) : un content: '/*' doit survivre.
    Le CSS n'a ni //, ni regex literals, ni templates — un scanner à deux
    contextes (code / string) suffit, bien plus simple que strip_js_comments."""
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"' or c == "'":
            quote = c
            out.append(c)
            i += 1
            while i < n:
                if src[i] == '\\' and i + 1 < n:
                    out.append(src[i:i + 2])
                    i += 2
                    continue
                out.append(src[i])
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = n if j == -1 else j + 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def strip_html_comments(src: str) -> str:
    """Retire les commentaires <!-- … --> du TEMPLATE HTML. Appelé AVANT la
    substitution des placeholders : le JS/CSS injectés ne sont jamais
    re-scannés (un '<!--' dans une string JS survivrait donc). Un commentaire
    non terminé est laissé tel quel (préférable à avaler la fin du fichier)."""
    return re.sub(r'<!--.*?-->', '', src, flags=re.S)


def collapse_blank_code_lines(src: str) -> str:
    """Réduit les runs de lignes entièrement vides à une seule (le strip des
    commentaires en laisse souvent plusieurs à la suite). Opère au niveau
    ligne, après strip_js_comments : à ce stade il ne reste plus de
    commentaires, donc plus besoin de distinguer regex/division/template —
    seul un examen ligne par ligne est nécessaire."""
    lines = src.split('\n')
    out_lines = []
    blank_run = 0
    for line in lines:
        if line.strip() == '':
            blank_run += 1
            if blank_run > 1:
                continue
        else:
            blank_run = 0
        out_lines.append(line)
    return '\n'.join(out_lines)


_HELP_SECTION_RE = re.compile(r'^##\s+(\S.*?)\s*$')


def parse_help_sections(text: str) -> dict:
    """Parse `src/help.md` en dict ordonné {slug: markdown}.

    Une section démarre sur une ligne `## <slug>` en début de ligne. Le contenu
    d'une section court jusqu'au prochain `## ` ou la fin. Le texte avant la
    première section est ignoré (le fichier commence par `## overview`). Un slug
    dupliqué est une erreur (l'enum de l'outil dérive de ces clefs : pas de
    collision silencieuse). Les `## ` à l'intérieur d'un fence ``` ... ``` ne
    démarrent PAS de section.
    """
    sections = {}
    current = None
    buf = []
    in_fence = False

    def flush():
        if current is not None:
            sections[current] = '\n'.join(buf).strip('\n')

    for line in text.split('\n'):
        stripped = line.lstrip()
        if stripped.startswith('```') or stripped.startswith('~~~'):
            in_fence = not in_fence
            if current is not None:
                buf.append(line)
            continue
        m = None if in_fence else _HELP_SECTION_RE.match(line)
        if m:
            flush()
            slug = m.group(1)
            if slug in sections:
                raise ValueError(f'help.md : section « {slug} » dupliquée')
            current = slug
            buf = []
        elif current is not None:
            buf.append(line)
    flush()
    return sections


def load_help() -> dict:
    """Lit et parse `src/help.md`. Absent → échec bruyant (fichier versionné,
    son absence est une erreur, contrairement à config.json qui warn)."""
    p = SRC / 'help.md'
    if not p.exists():
        raise FileNotFoundError(
            f'{p} introuvable — contenu d\'aide requis (outil miaou__about). '
            'Ce fichier est versionné : son absence est une erreur de build.')
    sections = parse_help_sections(p.read_text(encoding='utf-8'))
    if not sections:
        raise ValueError(f'{p} ne contient aucune section « ## <slug> ».')
    return sections


def load_config(use_config: bool = True) -> dict:
    if not use_config:
        print('[info] build sans config (--no-config) — le JS produit embarque '
              'un objet vide, valeurs par défaut au runtime.')
        return {}
    p = ROOT / 'config.json'
    if not p.exists():
        print('[warn] config.json introuvable — copier config.sample.json et le '
              'renseigner. Le marqueur __MIAOU_CONFIG__ restera tel quel dans le '
              'JS produit (sources non buildées : valeurs par défaut au runtime).')
        return {}
    return json.loads(p.read_text(encoding='utf-8'))


def assemble_css() -> str:
    parts = []
    for name in CSS_ORDER:
        path = SRC / 'css' / name
        if not path.exists():
            print(f'  [warn] fichier manquant : {path}')
            continue
        parts.append(read(path))
    return collapse_blank_code_lines(strip_css_comments('\n'.join(parts)))


def assemble_js(cfg_data: dict, help_data: dict) -> str:
    now = datetime.now(timezone.utc)
    build_date = now.strftime('%Y-%m-%d %H:%M UTC')
    cfg_data['build_ts'] = int(now.timestamp())
    parts = [f'/* miaou — built: {build_date} */\n']
    for name in JS_ORDER:
        path = SRC / 'js' / name
        if not path.exists():
            print(f'  [warn] fichier manquant : {path}')
            continue
        parts.append(f'\n/* ── {name} ── */\n')
        parts.append(strip_js_comments(read(path)))
    js = collapse_blank_code_lines('\n'.join(parts))

    # Injection de config : un seul marqueur, l'objet entier sérialisé en JSON
    # (JSON ⊂ littéral objet JS). json.dumps gère quoting/nombres/booléens. On
    # échappe '</' pour ne pas casser le </script> du HTML porteur.
    cfg_literal = json.dumps(cfg_data, ensure_ascii=False).replace('</', '<\\/')
    js = js.replace('__MIAOU_CONFIG__', cfg_literal)

    # Injection du contenu d'aide : même mécanisme que __MIAOU_CONFIG__ — objet
    # {slug: markdown} sérialisé en JSON, marqueur unique en position de valeur,
    # échappement '</' pour le </script> porteur.
    help_literal = json.dumps(help_data, ensure_ascii=False).replace('</', '<\\/')
    js = js.replace('__MIAOU_HELP__', help_literal)
    return js


# Bannières de section : `// ── Titre ──…` (JS) / `/* ── Titre ──… */` et
# `/* ═══ Titre ═══ */` (CSS). On capture le titre, débarrassé des filets.
_JS_SECTION_RE  = re.compile(r'^\s*(?://|/\*)\s*[─═]+\s*(.*?)\s*[─═]*\s*(?:\*/)?\s*$')
_JS_FUNC_RE     = re.compile(r'^(?:async\s+)?function\s+(\w+)')
_JS_TOPCONST_RE = re.compile(r'^(?:const|let)\s+(\w+)\s*=')


def generate_code_map() -> None:
    """Génère docs/code-map.md : index « où se trouve quoi » — fonctions et
    const/let top-level des fichiers JS, bannières de section JS et CSS, avec
    numéros de ligne. Fichier GÉNÉRÉ à chaque build, ne jamais l'éditer :
    toute correction se fait dans les sources ou dans ce générateur."""
    lines = [
        '# Code map — MIAOU',
        '',
        '> **Généré par `build.py` à chaque build — ne pas éditer.**',
        '> Index de repérage : fonctions/const top-level (JS) et sections (JS/CSS),',
        '> avec numéros de ligne dans `src/`.',
    ]

    for name in JS_ORDER:
        path = SRC / 'js' / name
        if not path.exists():
            continue
        lines.append('')
        lines.append(f'## src/js/{name}')
        lines.append('')
        for no, raw in enumerate(read(path).split('\n'), 1):
            m = _JS_SECTION_RE.match(raw)
            if m and m.group(1):
                lines.append(f'- **{m.group(1)}** (L{no})')
                continue
            m = _JS_FUNC_RE.match(raw)
            if m:
                lines.append(f'  - `{m.group(1)}()` — L{no}')
                continue
            m = _JS_TOPCONST_RE.match(raw)
            if m:
                lines.append(f'  - `{m.group(1)}` — L{no}')

    for name in CSS_ORDER:
        path = SRC / 'css' / name
        if not path.exists():
            continue
        lines.append('')
        lines.append(f'## src/css/{name}')
        lines.append('')
        for no, raw in enumerate(read(path).split('\n'), 1):
            m = _JS_SECTION_RE.match(raw)
            if m and m.group(1):
                lines.append(f'- **{m.group(1)}** (L{no})')

    out = ROOT / 'docs' / 'code-map.md'
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'Code map → {out}')


def build(use_config: bool = True):
    DIST.mkdir(exist_ok=True)

    template_path = SRC / 'html' / 'index.html'
    if not template_path.exists():
        raise FileNotFoundError(f'Template introuvable : {template_path}')

    template = collapse_blank_code_lines(strip_html_comments(read(template_path)))

    if CSS_PLACEHOLDER not in template:
        raise ValueError(f'Placeholder CSS absent du template : {CSS_PLACEHOLDER!r}')
    if JS_PLACEHOLDER not in template:
        raise ValueError(f'Placeholder JS absent du template : {JS_PLACEHOLDER!r}')

    cfg_data = load_config(use_config)
    help_data = load_help()
    css = assemble_css()
    js = assemble_js(cfg_data, help_data)

    output = template.replace(CSS_PLACEHOLDER, css).replace(JS_PLACEHOLDER, js)

    out_path = DIST / 'miaou.html'
    out_path.write_text(output, encoding='utf-8')
    print(f'Build OK → {out_path}')

    generate_code_map()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Assemble dist/miaou.html depuis src/')
    parser.add_argument('--no-config', action='store_true',
                        help='ignorer config.json : build neutre, valeurs par défaut au runtime')
    args = parser.parse_args()
    build(use_config=not args.no_config)
