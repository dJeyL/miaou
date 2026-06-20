#!/usr/bin/env python3
"""
build.py — assemble dist/miaou.html depuis src/
Usage : python build.py
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
SRC  = ROOT / 'src'
DIST = ROOT / 'dist'

# Ordre de concaténation — les dépendances d'abord
JS_ORDER = [
    'utils.js',
    'storage.js',
    'tools.js',
    'api.js',
    'ui.js',
    'main.js',
]

CSS_PLACEHOLDER = '/* __CSS__ */'
JS_PLACEHOLDER  = '/* __JS__ */'


def read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


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


def assemble_js(cfg_data: dict) -> str:
    build_date = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    parts = [f'/* miaou — built: {build_date} */\n']
    for name in JS_ORDER:
        path = SRC / 'js' / name
        if not path.exists():
            print(f'  [warn] fichier manquant : {path}')
            continue
        parts.append(f'\n/* ── {name} ── */\n')
        parts.append(read(path))
    js = '\n'.join(parts)

    # Injection de config : un seul marqueur, l'objet entier sérialisé en JSON
    # (JSON ⊂ littéral objet JS). json.dumps gère quoting/nombres/booléens. On
    # échappe '</' pour ne pas casser le </script> du HTML porteur.
    cfg_literal = json.dumps(cfg_data, ensure_ascii=False).replace('</', '<\\/')
    js = js.replace('__MIAOU_CONFIG__', cfg_literal)
    return js


def build(use_config: bool = True):
    DIST.mkdir(exist_ok=True)

    template_path = SRC / 'html' / 'index.html'
    if not template_path.exists():
        raise FileNotFoundError(f'Template introuvable : {template_path}')

    template = read(template_path)

    if CSS_PLACEHOLDER not in template:
        raise ValueError(f'Placeholder CSS absent du template : {CSS_PLACEHOLDER!r}')
    if JS_PLACEHOLDER not in template:
        raise ValueError(f'Placeholder JS absent du template : {JS_PLACEHOLDER!r}')

    cfg_data = load_config(use_config)
    css = read(SRC / 'css' / 'main.css')
    js = assemble_js(cfg_data)

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
