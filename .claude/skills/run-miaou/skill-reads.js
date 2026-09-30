// Lecture de skill imposée, neutralisée pour les verify qui n'en parlent pas.
//
// Un outil qui porte `requiresSkill` dans TOOLS (docs__*, js__eval,
// agent__spawn) refuse tant que sa skill n'a pas été lue — cf. docs/tools.md,
// « Lecture de skill imposée avant un outil ». Les verify qui appellent ces
// handlers DIRECTEMENT (callTool / callInternalTool dans un page.evaluate, sans
// modèle) ne portent pas sur cette garde : sans lecture, chacun de leurs appels
// est refusé et tout ce qui suit mesure un refus.
//
// `assumeSkillsRead(page)` enveloppe callInternalTool dans la page : avant
// chaque appel à un outil gardé, l'ack de lecture de SA skill est posé dans la
// file du lot (`_pendingToolAcks`, le chemin « lu dans le même lot » de
// skillReadSince), puis retiré par identité au retour, pour ne rien laisser
// dans une file que le verify inspecte ensuite. La garde tourne avant le premier
// await de chaque handler : le retrait au retour synchrone ne la contourne pas.
//
// À appeler APRÈS le chargement de la page (callInternalTool est une
// déclaration de fonction du bundle, réassignée par le script de l'app : un
// addInitScript serait écrasé), et de nouveau après tout page.reload().
//
// La garde elle-même est couverte par les tests QuickJS (test-tools.js,
// test-agents.js). Un verify qui voudrait l'observer ne doit PAS appeler ceci.

export async function assumeSkillsRead(page) {
  const gated = await page.evaluate(() => {
    const real = callInternalTool;
    window.callInternalTool = function (name, args, ctx) {
      const tool = TOOLS.find((t) => t.name === name);
      const read = tool && tool.requiresSkill ? { kind: 'skill_read', slug: tool.requiresSkill } : null;
      if (read) _pendingToolAcks.push(read);
      try { return real(name, args, ctx); }
      finally {
        if (read) {
          const i = _pendingToolAcks.indexOf(read);
          if (i >= 0) _pendingToolAcks.splice(i, 1);
        }
      }
    };
    return TOOLS.filter((t) => t.requiresSkill).map((t) => t.name);
  });
  // Prémisse : sans outil gardé, l'enveloppe ne fait rien et n'a plus lieu
  // d'être — le dire plutôt que la laisser survivre en silence.
  if (!gated.length) throw new Error('assumeSkillsRead : aucun outil ne déclare requiresSkill, retirer cet appel');
  return gated;
}
