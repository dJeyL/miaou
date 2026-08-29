"""Fabrique untracked/test-files/named-dest-toc.pdf : un PDF dont les entrees
d'outline pointent vers des destinations NOMMEES (chaines), et dont DEUX entrees
pointent vers un nom INEXISTANT.

Raison d'etre : le spike sur big-toc.pdf a montre 0 destination nommee (reportlab
pose des tableaux). La branche `typeof dest === 'string'` -> getDestination(nom)
du PLAN §3.1, et surtout la DEGRADATION par entree du §3.2 (une entree non
resoluble garde son titre, perd son numero), n'etaient donc pas exercees.

Ecrit a la main en PDF brut : c'est le seul moyen de controler exactement la
forme des destinations, et la structure reste assez petite pour rester lisible.
"""

PAGES = 6

import os
# Chemin dérivé du script (le cwd dérive entre appels — le PDF doit atterrir
# dans untracked/test-files/ quel que soit l'endroit d'où on lance).
OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                        "..", "..", "..", "..", "untracked", "test-files"))

objs = {}          # num -> bytes du corps
def add(num, body):
    objs[num] = body.encode('latin-1') if isinstance(body, str) else body

# 1 catalogue, 2 pages, 3 outlines, 4 names ; pages 10..10+N-1 ; contenus 30..
kids = " ".join(f"{10+i} 0 R" for i in range(PAGES))
add(1, f"<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R /Names 4 0 R >>")
add(2, f"<< /Type /Pages /Kids [{kids}] /Count {PAGES} >>")

for i in range(PAGES):
    add(10 + i, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                f"/Resources << /Font << /F1 5 0 R >> >> /Contents {30+i} 0 R >>")
    txt = f"BT /F1 24 Tf 60 760 Td (Page {i+1}) Tj ET"
    add(30 + i, f"<< /Length {len(txt)} >>\nstream\n{txt}\nendstream")
add(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

# Arbre de noms : sect1..sect6 -> pages. sect3 et sect6 sont VOLONTAIREMENT
# absents de l'arbre : leurs entrees d'outline sont non resolubles.
present = [1, 2, 4, 5]
names = " ".join(f"(sect{n}) [{10+n-1} 0 R /XYZ 60 780 0]" for n in present)
add(4, f"<< /Dests << /Names [{names}] >> >>")

# Outline : 6 entrees plates, toutes en destination NOMMEE (chaine).
first, last = 100, 100 + 5
add(3, f"<< /Type /Outlines /First {first} 0 R /Last {last} 0 R /Count 6 >>")
for i in range(6):
    num = 100 + i
    prev = f"/Prev {num-1} 0 R" if i > 0 else ""
    nxt  = f"/Next {num+1} 0 R" if i < 5 else ""
    title = f"Section {i+1}" + (" (destination absente)" if (i+1) not in present else "")
    add(num, f"<< /Title ({title}) /Parent 3 0 R {prev} {nxt} /Dest (sect{i+1}) >>")

# Serialisation avec xref correcte.
out = bytearray(b"%PDF-1.4\n")
offsets = {}
for num in sorted(objs):
    offsets[num] = len(out)
    out += f"{num} 0 obj\n".encode('latin-1') + objs[num] + b"\nendobj\n"

xref_at = len(out)
maxnum = max(objs)
out += f"xref\n0 {maxnum+1}\n".encode('latin-1')
out += b"0000000000 65535 f \n"
for n in range(1, maxnum + 1):
    out += (f"{offsets[n]:010d} 00000 n \n" if n in offsets
            else b"0000000000 65535 f \n".decode('latin-1')).encode('latin-1')
out += f"trailer\n<< /Size {maxnum+1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode('latin-1')

open(os.path.join(OUT_DIR, "named-dest-toc.pdf"), "wb").write(out)
print(f"ecrit: {len(out)} octets, {PAGES} pages, 6 entrees dont 2 non resolubles")
