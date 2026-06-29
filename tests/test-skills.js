// tests/test-skills.js — fonctions pures des skills (stage 1).
// IDB n'est pas disponible sous QuickJS : seuls le cache mémoire, la validation,
// le parsing slash et les chemins d'erreur SYNCHRONES des outils sont couverts.
// Les chemins async (lecture du contenu en IDB) se vérifient à la main.

function ct(name, args) { return flattenToolResult(callTool(name, args)); }

describe('validateSkillSlug', function() {
  it('refuse un slug vide', function() {
    expect(validateSkillSlug('', [])).toContain('requis');
    expect(validateSkillSlug('   ', [])).toContain('requis');
  });
  it('refuse les espaces', function() {
    expect(validateSkillSlug('mon skill', [])).toContain('espace');
  });
  it('refuse la barre oblique', function() {
    expect(validateSkillSlug('a/b', [])).toContain('/');
  });
  it('refuse un charset hors [A-Za-z0-9_-]', function() {
    expect(validateSkillSlug('héhé', [])).toContain('autorisés');
    expect(validateSkillSlug('a.b', [])).toContain('autorisés');
  });
  it('refuse un slug trop long', function() {
    var long = '';
    for (var i = 0; i < 60; i++) long += 'x';
    expect(validateSkillSlug(long, [])).toContain('long');
  });
  it('refuse un doublon', function() {
    expect(validateSkillSlug('revue', ['revue', 'autre'])).toContain('utilisé');
  });
  it('accepte un slug valide unique', function() {
    expect(validateSkillSlug('revue-code_1', ['autre'])).toBe(null);
  });
});

describe('parseSlashCommand', function() {
  it('renvoie null si pas de slash en tête', function() {
    expect(parseSlashCommand('bonjour')).toBe(null);
    expect(parseSlashCommand('  /revue')).toBe(null);   // espace avant → pas une commande
  });
  it('extrait le slug seul', function() {
    expect(parseSlashCommand('/revue')).toEqual({ slug: 'revue', rest: '' });
  });
  it('extrait le slug et le reste', function() {
    expect(parseSlashCommand('/revue ce fichier')).toEqual({ slug: 'revue', rest: 'ce fichier' });
  });
  it('reste multi-ligne préservé, slug isolé', function() {
    var r = parseSlashCommand('/revue\nligne2');
    expect(r.slug).toBe('revue');
    expect(r.rest).toBe('ligne2');
  });
  it('rejette un slug avec caractère invalide', function() {
    expect(parseSlashCommand('/a.b')).toBe(null);
  });
});

describe('bakeSkillMessage', function() {
  it('concatène littéral et corps du skill', function() {
    expect(bakeSkillMessage('/revue go', 'INSTRUCTIONS')).toBe('/revue go\n\nINSTRUCTIONS');
  });
  it('corps vide → littéral seul', function() {
    expect(bakeSkillMessage('/revue', '   ')).toBe('/revue');
    expect(bakeSkillMessage('/revue', null)).toBe('/revue');
  });
});

describe('cache skills — synchronisation', function() {
  it('setSkillsCache ne garde que la méta (pas le content)', function() {
    setSkillsCache([{ slug: 'a', name: 'A', description: 'd', enabled: true, content: 'SECRET' }]);
    var meta = getSkillMeta('a');
    expect(meta.slug).toBe('a');
    expect(meta.name).toBe('A');
    expect(meta.content).toBe(undefined);
  });
  it('upsertSkillCache insère puis remplace en place', function() {
    setSkillsCache([]);
    upsertSkillCache({ slug: 'x', name: 'X1' });
    expect(getSkillMeta('x').name).toBe('X1');
    upsertSkillCache({ slug: 'x', name: 'X2' });
    expect(getSkillMeta('x').name).toBe('X2');
    expect(listAllSkillsCache().length).toBe(1);   // pas de doublon
  });
  it('removeSkillCache retire l\'entrée', function() {
    setSkillsCache([{ slug: 'a' }, { slug: 'b' }]);
    removeSkillCache('a');
    expect(getSkillMeta('a')).toBe(null);
    expect(getSkillMeta('b').slug).toBe('b');
  });
  it('enabled par défaut true ; false respecté', function() {
    setSkillsCache([{ slug: 'on' }, { slug: 'off', enabled: false }]);
    expect(getSkillMeta('on').enabled).toBe(true);
    expect(getSkillMeta('off').enabled).toBe(false);
  });
  it('listEnabledSkills exclut les désactivés', function() {
    setSkillsCache([{ slug: 'on' }, { slug: 'off', enabled: false }]);
    var slugs = listEnabledSkills().map(function(s) { return s.slug; });
    expect(slugs).toEqual(['on']);
  });
  it('matchSkillCompletions filtre activés sur slug ET name', function() {
    setSkillsCache([
      { slug: 'revue', name: 'Revue de code' },
      { slug: 'resume', name: 'Synthèse' },
      { slug: 'cache', name: 'revue archivée', enabled: false },
    ]);
    var bySlug = matchSkillCompletions('rev').map(function(s) { return s.slug; });
    expect(bySlug).toEqual(['revue']);
    // 'synth' matche le name de resume ; le skill désactivé 'cache' (name « revue ») exclu
    var byName = matchSkillCompletions('synth').map(function(s) { return s.slug; });
    expect(byName).toEqual(['resume']);
  });
});

describe('miaou__skills__list — outil', function() {
  it('renvoie uniquement les skills activés (slug, name, description)', function() {
    setSkillsCache([
      { slug: 'on', name: 'On', description: 'desc', content: 'X' },
      { slug: 'off', name: 'Off', enabled: false },
    ]);
    var out = ct('miaou__skills__list', {});
    var parsed = JSON.parse(out);
    expect(parsed.length).toBe(1);
    expect(parsed[0].slug).toBe('on');
    expect(parsed[0].description).toBe('desc');
    expect(out.indexOf('off')).toBe(-1);   // désactivé jamais exposé
  });
  it('liste vide → tableau JSON vide', function() {
    setSkillsCache([]);
    expect(ct('miaou__skills__list', {})).toBe('[]');
  });
  it('pousse un ack skill_list avec le compte des skills activés', function() {
    setSkillsCache([{ slug: 'a' }, { slug: 'b' }, { slug: 'off', enabled: false }]);
    clearPendingToolAcks();
    ct('miaou__skills__list', {});
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('skill_list');
    expect(acks[0].count).toBe(2);   // 'off' désactivé exclu
  });
});

describe('miaou__skills__read — chemins d\'erreur synchrones', function() {
  it('slug manquant', function() {
    setSkillsCache([]);
    expect(ct('miaou__skills__read', {})).toContain('manquant');
  });
  it('slug inconnu → introuvable', function() {
    setSkillsCache([{ slug: 'autre' }]);
    expect(ct('miaou__skills__read', { slug: 'absent' })).toContain('introuvable');
  });
  it('skill désactivé → erreur désactivé (jamais de contenu)', function() {
    setSkillsCache([{ slug: 'off', name: 'Off', enabled: false }]);
    var out = ct('miaou__skills__read', { slug: 'off' });
    expect(out).toContain('désactivé');
  });
});
