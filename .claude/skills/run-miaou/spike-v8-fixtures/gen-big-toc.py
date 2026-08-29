"""Fabrique untracked/test-files/big-toc.pdf : un « livre technique » à gros
sommaire hierarchise, pour mesurer le cout des getPageIndex de V-8 chantier A.

Structure visee : 12 parties x 6 chapitres x 4 sections = 300 entrees de niveau
3, plus 12 + 72 entrees de niveaux 1 et 2 => 384 entrees d'outline au total,
au-dela de la borne PDF_OUTLINE_RESOLVE_MAX = 300 envisagee par le PLAN.
C'est deliberé : la fixture doit exercer la borne, pas la frôler.

reportlab pose des destinations NOMMEES (bookmarkPage/addOutlineEntry), ce qui
exerce la branche `typeof dest === 'string'` -> doc.getDestination(nom) que le
PLAN §3.1 identifie comme le piege d'API a ne pas decouvrir en cours de route.
"""
import os
# Chemin dérivé du script (le cwd dérive entre appels — le PDF doit atterrir
# dans untracked/test-files/ quel que soit l'endroit d'où on lance).
OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        "..", "..", "..", "..", "untracked", "test-files"))

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

PARTS, CHAPS, SECTS = 12, 6, 4
OUT = os.path.join(OUT_DIR, "big-toc.pdf")

c = canvas.Canvas(OUT, pagesize=A4)
w, h = A4
entries = 0

for p in range(1, PARTS + 1):
    key = f"part{p}"
    c.setFont("Helvetica-Bold", 22)
    c.drawString(60, h - 100, f"Partie {p}")
    c.bookmarkPage(key)
    c.addOutlineEntry(f"Partie {p} — Fondations et mise en oeuvre", key, level=0)
    entries += 1
    c.showPage()

    for ch in range(1, CHAPS + 1):
        key = f"part{p}.chap{ch}"
        c.setFont("Helvetica-Bold", 16)
        c.drawString(60, h - 100, f"Chapitre {p}.{ch}")
        c.bookmarkPage(key)
        c.addOutlineEntry(f"{p}.{ch} Chapitre consacre au sujet {ch}", key, level=1)
        entries += 1
        c.showPage()

        for s in range(1, SECTS + 1):
            key = f"part{p}.chap{ch}.sect{s}"
            c.setFont("Helvetica-Bold", 12)
            c.drawString(60, h - 100, f"Section {p}.{ch}.{s}")
            c.setFont("Helvetica", 10)
            c.drawString(60, h - 130, "Corps de section, avec une couche texte extractible.")
            c.bookmarkPage(key)
            c.addOutlineEntry(f"{p}.{ch}.{s} Section detaillee du chapitre", key, level=2)
            entries += 1
            c.showPage()

c.save()
print(f"entries={entries} pages={PARTS * (1 + CHAPS * (1 + SECTS))}")
