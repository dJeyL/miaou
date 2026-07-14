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

describe('findSlashTriggers', function() {
  it('détecte un trigger en position 0', function() {
    var t = findSlashTriggers('/revue ce fichier');
    expect(t.length).toBe(1);
    expect(t[0].slug).toBe('revue');
    expect(t[0].atStart).toBe(true);
    expect(t[0].start).toBe(0);
  });
  it('détecte un trigger mid-string précédé d\'un espace', function() {
    var t = findSlashTriggers('avant /audit après');
    expect(t.length).toBe(1);
    expect(t[0].slug).toBe('audit');
    expect(t[0].atStart).toBe(false);
    expect(t[0].start).toBe(6);
  });
  it('ne déclenche PAS sur un / non précédé d\'espace (URL, and/or)', function() {
    expect(findSlashTriggers('voir https://exemple.com').length).toBe(0);
    expect(findSlashTriggers('fromage and/or vin').length).toBe(0);
  });
  it('détecte plusieurs occurrences, dans l\'ordre', function() {
    var t = findSlashTriggers('/revue ce fichier puis /audit la sécu');
    expect(t.length).toBe(2);
    expect(t[0].slug).toBe('revue');
    expect(t[1].slug).toBe('audit');
  });
  it('trigger précédé d\'un saut de ligne', function() {
    var t = findSlashTriggers('texte\n/revue');
    expect(t.length).toBe(1);
    expect(t[0].slug).toBe('revue');
  });
  it('slug vide (juste un /) reste un trigger valide', function() {
    var t = findSlashTriggers('/');
    expect(t.length).toBe(1);
    expect(t[0].slug).toBe('');
    expect(t[0].atStart).toBe(true);
  });
});

describe('bakeSkillMessage', function() {
  it('concatène littéral et corps de la skill (un seul, étiqueté)', function() {
    expect(bakeSkillMessage('/revue go', [{ slug: 'revue', content: 'INSTRUCTIONS' }]))
      .toBe('/revue go\n\n--- skill: revue ---\nINSTRUCTIONS\n--- /skill: revue ---');
  });
  it('corps vide ou liste vide → littéral seul', function() {
    expect(bakeSkillMessage('/revue', [{ slug: 'revue', content: '   ' }])).toBe('/revue');
    expect(bakeSkillMessage('/revue', [])).toBe('/revue');
    expect(bakeSkillMessage('/revue', null)).toBe('/revue');
  });
  it('tolère un élément null/incomplet dans resolved (garde-fou, pas de TypeError)', function() {
    expect(bakeSkillMessage('txt', [null, { slug: 'a' }, { slug: 'b', content: 'C' }]))
      .toBe('txt\n\n--- skill: b ---\nC\n--- /skill: b ---');
  });
  it('plusieurs skills : blocs étiquetés en fin de message, dans l\'ordre', function() {
    var out = bakeSkillMessage('/revue ce fichier puis /audit la sécu', [
      { slug: 'revue', content: 'CONTENU_REVUE' },
      { slug: 'audit', content: 'CONTENU_AUDIT' },
    ]);
    expect(out).toBe(
      '/revue ce fichier puis /audit la sécu\n\n' +
      '--- skill: revue ---\nCONTENU_REVUE\n--- /skill: revue ---\n\n' +
      '--- skill: audit ---\nCONTENU_AUDIT\n--- /skill: audit ---'
    );
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
    // 'synth' matche le name de resume ; la skill désactivée 'cache' (name « revue ») exclue
    var byName = matchSkillCompletions('synth').map(function(s) { return s.slug; });
    expect(byName).toEqual(['resume']);
  });
  it('autotrigger par défaut false (opposé de enabled) ; true respecté', function() {
    setSkillsCache([{ slug: 'a' }, { slug: 'b', autotrigger: true }]);
    expect(getSkillMeta('a').autotrigger).toBe(false);
    expect(getSkillMeta('b').autotrigger).toBe(true);
  });
});

describe('getAutotriggerSkillsMeta (stage 2)', function() {
  it('liste vide si aucune skill autotrigger', function() {
    setSkillsCache([{ slug: 'a' }, { slug: 'b', enabled: false, autotrigger: true }]);
    expect(getAutotriggerSkillsMeta()).toEqual([]);
  });
  it('exclut une skill autotrigger mais désactivée', function() {
    setSkillsCache([{ slug: 'a', enabled: false, autotrigger: true }]);
    expect(getAutotriggerSkillsMeta()).toEqual([]);
  });
  it('inclut seulement enabled ET autotrigger, forme {slug, name, description}', function() {
    setSkillsCache([
      { slug: 'a', name: 'A', description: 'desc-a', autotrigger: true },
      { slug: 'b', name: 'B', description: 'desc-b' },                       // pas autotrigger
      { slug: 'c', name: 'C', description: 'desc-c', autotrigger: true, enabled: false },
    ]);
    var out = getAutotriggerSkillsMeta();
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({ slug: 'a', name: 'A', description: 'desc-a' });
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
  it('ackLabel skill_list : branches 0 / 1 / n / null', function() {
    expect(ackLabel('skill_list', { count: 0 })).toContain('Aucune');
    expect(ackLabel('skill_list', { count: 1 })).toBe('1 skill listée');
    expect(ackLabel('skill_list', { count: 3 })).toBe('3 skills listées');
    expect(ackLabel('skill_list', {})).toContain('?');
  });
  it('ackLabel skill_list : intent préfixe le libellé', function() {
    expect(ackLabel('skill_list', { count: 3, intent: 'trouver un outil' })).toBe('trouver un outil : 3 skills listées');
    expect(ackLabel('skill_list', { count: 0, intent: 'trouver un outil' })).toBe('trouver un outil : Aucune skill disponible');
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

describe('slugifySkillName', function() {
  it('minuscules, espaces → tirets', function() {
    expect(slugifySkillName('Revue de Code')).toBe('revue-de-code');
  });
  it('caractères hors charset retirés', function() {
    expect(slugifySkillName('Revue: Code!')).toBe('revue-code');
  });
  it('tirets multiples et bords nettoyés', function() {
    expect(slugifySkillName('  --revue--code--  ')).toBe('revue-code');
  });
  it('null/undefined → chaîne vide', function() {
    expect(slugifySkillName(null)).toBe('');
    expect(slugifySkillName(undefined)).toBe('');
  });
});

describe('parseSkillFrontmatter', function() {
  it('absence de cartouche → null', function() {
    expect(parseSkillFrontmatter('Corps sans cartouche.')).toBe(null);
    expect(parseSkillFrontmatter('')).toBe(null);
  });
  it('extrait name/description/disable-model-invocation', function() {
    var text = '---\nname: handoff\ndescription: Compact la conversation.\ndisable-model-invocation: true\n---\n\nCorps.';
    var fm = parseSkillFrontmatter(text);
    expect(fm.name).toBe('handoff');
    expect(fm.description).toBe('Compact la conversation.');
    expect(fm.disableModelInvocation).toBe(true);
  });
  it('clé absente du cartouche → champ null (ne pas toucher au formulaire)', function() {
    var text = '---\nname: solo\n---\nCorps.';
    var fm = parseSkillFrontmatter(text);
    expect(fm.name).toBe('solo');
    expect(fm.description).toBe(null);
    expect(fm.disableModelInvocation).toBe(null);
  });
  it('disable-model-invocation absent ou false → false/null distingués', function() {
    var text = '---\nname: x\ndisable-model-invocation: false\n---\n';
    expect(parseSkillFrontmatter(text).disableModelInvocation).toBe(false);
  });
  it('valeurs entre guillemets dépouillées', function() {
    var text = '---\nname: "avec guillemets"\ndescription: \'simples\'\n---\n';
    var fm = parseSkillFrontmatter(text);
    expect(fm.name).toBe('avec guillemets');
    expect(fm.description).toBe('simples');
  });
  it('cartouche non fermé (pas de second ---) → null', function() {
    expect(parseSkillFrontmatter('---\nname: x\nsans fermeture')).toBe(null);
  });
});

describe('resolveSkillDropTarget', function() {
  it('pas de cartouche → création, slug vide', function() {
    var t = resolveSkillDropTarget(null, ['autre']);
    expect(t.mode).toBe('create');
    expect(t.slug).toBe('');
  });
  it('cartouche sans name → création, slug vide', function() {
    var t = resolveSkillDropTarget({ name: null, description: 'x', disableModelInvocation: null }, ['autre']);
    expect(t.mode).toBe('create');
    expect(t.slug).toBe('');
  });
  it('name dont le slug ne matche AUCUNE skill existante → création, slug dérivé', function() {
    var t = resolveSkillDropTarget({ name: 'Nouvelle Skill', description: null, disableModelInvocation: null }, ['autre']);
    expect(t.mode).toBe('create');
    expect(t.slug).toBe('nouvelle-skill');
  });
  it('name dont le slug matche une skill EXISTANTE → édition de ce slug', function() {
    var t = resolveSkillDropTarget({ name: 'Handoff', description: null, disableModelInvocation: null }, ['handoff', 'autre']);
    expect(t.mode).toBe('edit');
    expect(t.slug).toBe('handoff');
  });
});
