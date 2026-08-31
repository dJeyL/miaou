#!/usr/bin/env python3
"""
build.py — assemble dist/miaou.html depuis src/
Usage : python build.py
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
SRC  = ROOT / 'src'
DIST = ROOT / 'dist'

# Ordre de concaténation — les dépendances d'abord
JS_ORDER = [
    'utils.js',
    'docs.js',
    'sync.js',
    'storage.js',
    'agents.js',
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
    'palette.css',
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
    un template literal empile un contexte 'template' ; le PREMIER '}'
    rencontré dépile vers le contexte parent (pas de comptage d'accolades de
    code internes) — conservateur : un objet littéral nu dans un ${...} (ex.
    `${ {a:1}.a }`) dépile prématurément, mais le frame template dégénéré
    recopie tout verbatim, donc la sortie reste correcte (au pire un
    commentaire à l'intérieur du ${...} survivrait). Aucune occurrence réelle
    dans src/js à ce jour."""
    out = []
    i = 0
    n = len(src)
    # Pile de frames : ('code',) en haut niveau, ('template',) quand on est à
    # l'intérieur d'un ${...} — dépilé au premier '}' rencontré (voir docstring).
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


EXPORT_CSS_ANCHOR = 'const EXPORT_CSS = `'
EXPORT_SCRIPT_ANCHOR = 'const EXPORT_SCRIPT = `'


def _rewrite_export_literal(src: str, anchor: str, transform) -> str:
    """Applique `transform` au CORPS d'un littéral d'export de ui.js.

    Facteur commun de strip_export_css_comments / strip_export_script_comments :
    même repérage, même posture de prudence, seul le nettoyage diffère.

    Ciblage volontairement rigide : littéral ancré en colonne 0, terminé par une
    ligne '`;'. Toute forme hors gabarit (renommage, ré-indentation) rend la
    source INCHANGÉE plutôt que de risquer une découpe fausse dans un template
    literal. Le contrôle 'ni backtick ni ${ dans le corps candidat' est le
    garde-fou de dernier recours du piège 22 ; il porte sur l'ENTRÉE : un
    backtick y signale que la recherche du '\n`;' s'est arrêtée au mauvais
    endroit. Contrôler la SORTIE ne servirait à rien — le strip aurait
    justement effacé le commentaire fautif, donc le signal."""
    start = src.find(anchor)
    if start == -1:
        return src
    if start != 0 and src[start - 1] != '\n':
        return src
    i = start + len(anchor)
    end = src.find('\n`;', i)
    if end == -1:
        return src
    body = src[i:end]
    if '`' in body or '${' in body:
        return src
    return src[:i] + transform(body) + src[end:]


def strip_line_comments_only(src: str) -> str:
    """Retire les lignes ENTIÈREMENT commentées (premier caractère non-blanc
    '//'), et rien d'autre.

    Délibérément plus bête que strip_js_comments : on ne scanne JAMAIS
    l'intérieur d'une ligne de code, donc aucun arbitrage division / regex
    literal / string. C'est ce qui rend la passe sûre sur EXPORT_SCRIPT, dont
    le corps est du JS vivant à l'intérieur d'un template literal — les
    échappements y sont doublés (un '\\\\' en source produit un '\\' à
    l'exécution),
    si bien qu'un scanner JS complet ne lit PAS la même chaîne que le moteur.
    Corollaire : EXPORT_SCRIPT ne tolère que des commentaires '//' en pleine
    ligne (cf. docs/exports.md) — un bloc /* */ ou un '//' en fin de ligne de
    code survivrait ici, silencieusement."""
    return '\n'.join(l for l in src.split('\n') if not l.lstrip().startswith('//'))


def strip_export_script_comments(src: str) -> str:
    """Retire les commentaires de ligne du littéral EXPORT_SCRIPT (ui.js).

    Même motivation que strip_export_css_comments : ce JS statique part dans
    chaque export INTERACTIF (~2 Ko de commentaires sur 7). Le nettoyage est
    volontairement limité aux lignes '//' — voir strip_line_comments_only pour
    la raison, et la garde run_build_unit_tests qui interdit les blocs."""
    return _rewrite_export_literal(src, EXPORT_SCRIPT_ANCHOR, strip_line_comments_only)


def strip_export_css_comments(src: str) -> str:
    """Retire les commentaires du littéral EXPORT_CSS (ui.js).

    strip_js_comments laisse intact le CONTENU des template literals — c'est
    voulu (une chaîne JS n'est pas du code). Mais EXPORT_CSS est une feuille de
    style figée (piège 22) : ses commentaires partaient dans dist/miaou.html ET
    dans CHAQUE fichier exporté (~6,5 Ko sur 17 Ko de feuille). On les retire
    donc explicitement, en réutilisant strip_css_comments.

    Repérage et gardes : cf. _rewrite_export_literal."""
    return _rewrite_export_literal(src, EXPORT_CSS_ANCHOR, strip_css_comments)


def strip_html_comments(src: str) -> str:
    """Retire les commentaires <!-- … --> du TEMPLATE HTML. Appelé AVANT la
    substitution des placeholders : le JS/CSS injectés ne sont jamais
    re-scannés (un '<!--' dans une string JS survivrait donc). Un commentaire
    non terminé est laissé tel quel (préférable à avaler la fin du fichier)."""
    return re.sub(r'<!--.*?-->', '', src, flags=re.S)


def collapse_blank_code_lines(src: str) -> str:
    """Réduit les runs de lignes entièrement vides à une seule (le strip des
    commentaires en laisse souvent plusieurs à la suite) ET retire le blanc de
    fin de ligne. Opère au niveau ligne, après strip_js_comments : à ce stade
    il ne reste plus de commentaires, donc plus besoin de distinguer
    regex/division/template — seul un examen ligne par ligne est nécessaire.

    Le rstrip vit ICI et non dans les strippers, qui traversent strings et
    template literals : y toucher au blanc modifierait le CONTENU d'une chaîne.
    À ce stade la passe est sûre — mais elle traverse quand même les templates
    (EXPORT_CSS/EXPORT_SCRIPT), donc l'invariant à tenir est qu'aucune ligne de
    src/js ne porte d'espace final SIGNIFICATIF. Il est vérifié : aucune n'en
    porte du tout, et ni CSS ni JS n'y sont sensibles. Une template literal de
    données textuelles serait le seul cas contraire — il n'y en a pas.

    Sans le rstrip, un commentaire retiré laissait son indentation (ligne de
    blanc pur, que le test `line.strip() == ''` détectait déjà sans la nettoyer)
    ou ses espaces d'alignement (commentaire de fin de ligne). ~1100 lignes du
    dist en portaient, ce qui rendait `git diff --check` inutilisable comme
    garde-fou sur le dépôt."""
    lines = src.split('\n')
    out_lines = []
    blank_run = 0
    for line in lines:
        line = line.rstrip()
        if line == '':
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
    première section est ignoré (le fichier commence par `## apercu`). Un slug
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


_SKILL_FRONTMATTER_RE = re.compile(r'^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)')


def parse_system_skill_file(text: str, path: Path) -> dict:
    """Parse un fichier `src/system-skills/<slug>.md` : cartouche frontmatter
    `---\\nclé: valeur\\n---` en tête (name, description) suivi du corps
    Markdown. Le slug est dérivé du nom de fichier (sans extension), pas du
    cartouche : c'est la clé IDB, elle doit être stable et lisible depuis le
    nom du fichier source. Pas de clé `autotrigger` ni `enabled` : une skill
    système est TOUJOURS activée et autotrigger (figé par ensureSystemSkills,
    skills.js — aucun réglage possible dessus, cf. docs/skills.md)."""
    m = _SKILL_FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError(f'{path} : cartouche frontmatter --- manquant en tête de fichier.')
    meta = {}
    for line in m.group(1).split('\n'):
        kv = re.match(r'^([A-Za-z_-]+)\s*:\s*(.*)$', line.strip())
        if not kv:
            continue
        key = kv.group(1).strip().lower()
        val = kv.group(2).strip().strip('"\'')
        meta[key] = val
    if 'name' not in meta:
        raise ValueError(f'{path} : cartouche sans clé « name ».')
    body = text[m.end():].strip('\n')
    if not body:
        raise ValueError(f'{path} : corps de skill vide.')
    return {
        'name': meta['name'],
        'description': meta.get('description', ''),
        'content': body,
    }


def load_system_skills() -> dict:
    """Lit `src/system-skills/*.md` → dict ordonné {slug: {name, description,
    content}}. Dossier absent ou vide → {} (pas d'erreur : les skills système
    sont une fonctionnalité additive, pas un prérequis de build)."""
    d = SRC / 'system-skills'
    if not d.exists():
        return {}
    out = {}
    for path in sorted(d.glob('*.md')):
        slug = path.stem
        out[slug] = parse_system_skill_file(read(path), path)
    return out


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
    # Un config.json présent mais malformé reste une ERREUR (un fallback
    # silencieux sur {} produirait un build aux valeurs par défaut sans le
    # dire), mais nommée : la JSONDecodeError brute pointe sur json/decoder.py
    # et ne mentionne jamais config.json. Piège classique : les guillemets
    # simples, que JSON n'accepte pas.
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        sys.exit(f'[erreur] config.json : JSON invalide ligne {e.lineno}, '
                 f'colonne {e.colno} — {e.msg}. Rappel : JSON exige des '
                 f'guillemets DOUBLES (\"...\"), jamais simples.')


def assemble_css() -> str:
    parts = []
    for name in CSS_ORDER:
        path = SRC / 'css' / name
        if not path.exists():
            print(f'  [warn] fichier manquant : {path}')
            continue
        parts.append(read(path))
    return collapse_blank_code_lines(strip_css_comments('\n'.join(parts)))


def assemble_js(cfg_data: dict, help_data: dict, system_skills_data: dict) -> str:
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
        src_js = strip_export_css_comments(read(path))
        src_js = strip_export_script_comments(src_js)
        parts.append(strip_js_comments(src_js))
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

    # Injection des skills système : même mécanisme, dict {slug: {name,
    # description, autotrigger, content}} sérialisé en JSON (skills.js les
    # upsert en IDB à l'init, cf. docs/skills.md).
    system_skills_literal = json.dumps(system_skills_data, ensure_ascii=False).replace('</', '<\\/')
    js = js.replace('__MIAOU_SYSTEM_SKILLS__', system_skills_literal)
    return js


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
    system_skills_data = load_system_skills()
    css = assemble_css()
    js = assemble_js(cfg_data, help_data, system_skills_data)

    output = template.replace(CSS_PLACEHOLDER, css).replace(JS_PLACEHOLDER, js)

    out_path = DIST / 'miaou.html'
    out_path.write_text(output, encoding='utf-8')
    print(f'Build OK → {out_path}')



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Assemble dist/miaou.html depuis src/')
    parser.add_argument('--no-config', action='store_true',
                        help='ignorer config.json : build neutre, valeurs par défaut au runtime')
    args = parser.parse_args()
    build(use_config=not args.no_config)
