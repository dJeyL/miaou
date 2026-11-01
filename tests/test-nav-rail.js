// tests/test-nav-rail.js
// Rail de navigation du fil (nav-rail.js). Purs seulement : marques, panneau,
// survol et défilement se vérifient en navigateur.

describe('navRailPreview — aperçu d\'un message', function() {
  it('replie les blancs et retire ceux des bords', function() {
    expect(navRailPreview('  Lis\n\n  CLAUDE.md  ', 50)).toBe('Lis CLAUDE.md');
  });
  it('coupe au plafond avec une ellipse, sans blanc avant elle', function() {
    expect(navRailPreview('abc def ghi', 4)).toBe('abc…');
  });
  it('rend le texte intact sous le plafond, vide pour null', function() {
    expect(navRailPreview('court', 10)).toBe('court');
    expect(navRailPreview(null, 10)).toBe('');
  });
});

describe('navRailPitch — pas entre deux marques', function() {
  it('garde le pas de repos quand la colonne tient', function() {
    expect(navRailPitch(5, 300, 12)).toBe(12);
  });
  it('resserre pour tenir dans la hauteur maximale', function() {
    expect(navRailPitch(101, 300, 12)).toBe(3);
  });
  it('une seule marque garde le pas de repos', function() {
    expect(navRailPitch(1, 0, 12)).toBe(12);
  });
});

describe('navRailLitIndices — échanges visibles', function() {
  const spans = [
    { top: 0, bottom: 500 },
    { top: 500, bottom: 520 },
    { top: 520, bottom: 1200 },
  ];
  it('allume chaque échange qui recouvre franchement la vue', function() {
    expect(navRailLitIndices(spans, 400, 900, 24).join(',')).toBe('0,1,2');
  });
  it('un liseré au bord de la vue ne compte pas', function() {
    expect(navRailLitIndices(spans, 490, 1000, 24).join(',')).toBe('1,2');
  });
  it('un échange court vu en entier compte malgré le seuil', function() {
    expect(navRailLitIndices(spans, 505, 1100, 24).join(',')).toBe('2');
    expect(navRailLitIndices(spans, 498, 1100, 24).join(',')).toBe('1,2');
  });
  it('rien d\'allumé hors du fil', function() {
    expect(navRailLitIndices(spans, 1300, 1800, 24).length).toBe(0);
  });
});

describe('navRailSnap — calage sur les pixels physiques', function() {
  it('à 1x, valeurs entières inchangées', function() {
    const s = navRailSnap(12, 2, 1);
    expect(s.pitch).toBe(12); expect(s.thick).toBe(2); expect(s.inset).toBe(5);
  });
  it('à 1,8 (zoom 90 % sur écran 2x), tout tombe sur un pixel d\'écran entier', function() {
    const s = navRailSnap(12, 2, 1.8);
    // 12 × 1,8 = 21,6 → 21 ; 2 × 1,8 = 3,6 → 4 ; (21 - 4) / 2 → 8
    expect(Math.round(s.pitch * 1.8 * 1000) / 1000).toBe(21);
    expect(Math.round(s.thick * 1.8 * 1000) / 1000).toBe(4);
    expect(Math.round(s.inset * 1.8 * 1000) / 1000).toBe(8);
  });
  it('jamais sous un pixel d\'écran, même très resserré', function() {
    const s = navRailSnap(0.2, 2, 1);
    expect(s.pitch).toBe(1); expect(s.thick).toBe(2); expect(s.inset).toBe(0);
  });
});
