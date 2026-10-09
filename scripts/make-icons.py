#!/usr/bin/env python3
"""
make-icons.py — génère les icônes PWA de MIAOU depuis src/svg/cat.svg.

Usage : uv run --with resvg-py python scripts/make-icons.py

À relancer quand le logo change : build.py compare l'empreinte du SVG d'icône
à src/pwa/icons.sha256 et échoue tant que les PNG n'ont pas été régénérés. Le
script vit à part pour que build.py reste sans dépendance ; il importe build.py
pour rasteriser EXACTEMENT ce que la garde empreinte (icon_svg).

Sorties dans src/pwa/ (versionnées, copiées dans dist/ par build.py) :
  - icon-192.png, icon-512.png : le chat sur fond transparent ;
  - icon-maskable-512.png : fond plein, chat dans la zone sûre (cercle central
    de 80 % du côté, que le système peut découper en cercle, carré arrondi…).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402
import resvg_py  # noqa: E402

# Fond de la variante maskable : le --sidebar-bg du thème clair, palette ambre
# (hsl(41 29.5% 87.2%)). Le --bg du sombre, essayé d'abord, contrastait trop
# dans le Dock de macOS.
MASKABLE_BG = '#e8e2d5'
# Côté du chat dans la variante maskable, en % du canevas. Le dessin doit tenir
# dans le cercle de la zone sûre (diamètre 80 % du canevas). Ce qui compte est
# le point visible le plus éloigné du centre du viewBox, pas la boîte englobante
# (dont les coins sont vides) : pointes d'oreilles et de queue, à ~30,4/64 du
# côté. Plafond 40 / (30,4 / 64) ≈ 84 ; 80 garde une marge.
MASKABLE_LOGO_PCT = 80


def render(svg: str, size: int) -> bytes:
    return bytes(resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size))


def maskable_svg(icon: str) -> str:
    off = (100 - MASKABLE_LOGO_PCT) / 2
    nested = icon.replace(
        '<svg ', f'<svg x="{off}" y="{off}" width="{MASKABLE_LOGO_PCT}" height="{MASKABLE_LOGO_PCT}" ', 1)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<rect width="100" height="100" fill="{MASKABLE_BG}"/>{nested}</svg>')


def main() -> None:
    svg = build.read_logo_svg()
    icon = build.icon_svg(svg)
    out = build.PWA_SRC
    out.mkdir(exist_ok=True)
    (out / 'icon-192.png').write_bytes(render(icon, 192))
    (out / 'icon-512.png').write_bytes(render(icon, 512))
    (out / 'icon-maskable-512.png').write_bytes(render(maskable_svg(icon), 512))
    (out / build.PWA_ICON_FINGERPRINT).write_text(build.icon_fingerprint(svg) + '\n', encoding='utf-8')
    print(f'Icônes écrites dans {out}')


if __name__ == '__main__':
    main()
