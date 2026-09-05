// Prouve que MIAOU sait lire la forme vLLM/Mistral du stream : delta.content
// est un TABLEAU de parts, dont `{type:'thinking', thinking:[{text}]}` porte le
// raisonnement et `{type:'text', text}` la réponse. Symptôme d'origine (Julien,
// mistral-medium-3.5 au boulot) : « [object Object] » répété avant la vraie
// réponse, et pendant le raisonnement un curseur clignotant au lieu des mots
// qui défilent.
//
// Deux choses vérifiées, que les tests QuickJS ne couvrent pas :
//  - le raisonnement défile EN DIRECT (plusieurs états croissants observés
//    pendant le stream, pas seulement un état final) ;
//  - aucun « [object Object] » nulle part, et la réponse finale est propre.
//
// Le stub sert la MÊME conversation dans les deux formes (vLLM puis Ollama)
// pour prouver qu'on n'a pas cassé le chemin historique.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(dir, '../../../dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// ── Stub réseau, injecté AVANT tout script de page ───────────────────────────
// window.__stubFormat pilote la forme des deltas : 'vllm' (tableau de parts)
// ou 'ollama' (champ reasoning + content string). Lue à CHAQUE requête, donc
// modifiable entre deux envois depuis le test.
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
  } catch (e) {}

  window.__stubFormat = 'vllm';
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      const reasoningParts = ['Je ', 'décompose ', 'la ', 'question... '];
      const contentParts = ['Voici ', 'la ', 'réponse ', 'finale.'];
      const vllm = window.__stubFormat === 'vllm';
      const lines = [];
      for (const r of reasoningParts) {
        const delta = vllm
          ? { content: [{ type: 'thinking', thinking: [{ type: 'text', text: r }] }] }
          : { reasoning: r };
        lines.push('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
      }
      for (const c of contentParts) {
        const delta = vllm
          ? { content: [{ type: 'text', text: c }] }
          : { content: c };
        lines.push('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
      }
      lines.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      lines.push('data: [DONE]\n\n');
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          let i = 0;
          const push = function () {
            if (i < lines.length) {
              controller.enqueue(enc.encode(lines[i++]));
              // Étalé : laisse le temps d'échantillonner le raisonnement en vol.
              setTimeout(push, 180);
            } else { controller.close(); }
          };
          push();
        },
      });
      return Promise.resolve(new Response(body, {
        status: 200, headers: { 'Content-Type': 'text/event-stream' },
      }));
    }
    if (url.indexOf('/models') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return realFetch(input, opts);
  };
};

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
await context.addInitScript(initScript);

const errors = [];
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(300);

// Envoie un message et échantillonne le raisonnement PENDANT le stream.
const sendAndSample = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
  const samples = [];
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => {
      const nodes = document.querySelectorAll('#thread .msg.assistant .reasoning-content');
      const last = nodes[nodes.length - 1];
      return last ? last.textContent : '';
    });
    if (s) samples.push(s);
    const done = await page.evaluate(() => typeof sending !== 'undefined' && !sending);
    if (done && samples.length) break;
  }
  await page.waitForFunction(() => typeof sending !== 'undefined' && !sending, { timeout: 15000 });
  await page.waitForTimeout(200);
  return samples;
};

// ── Cas 1 : forme vLLM (tableau de parts) ────────────────────────────────────
const vllmSamples = await sendAndSample('Question vLLM.');

const uniq = [...new Set(vllmSamples)];
check('raisonnement observé pendant le stream (pas seulement à la fin)', uniq.length > 0);
check('raisonnement DÉFILE en direct (plusieurs états croissants)', uniq.length >= 2);

const finalState = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#thread .msg.assistant');
  const last = msgs[msgs.length - 1];
  const rc = last && last.querySelector('.reasoning-content');
  const body = last && last.querySelector('.body');
  return {
    reasoning: rc ? rc.textContent : '',
    body: body ? body.textContent : '',
    threadReasoning: (typeof currentThread !== 'undefined' && currentThread.length)
      ? (currentThread[currentThread.length - 1].reasoning || '') : '',
    threadContent: (typeof currentThread !== 'undefined' && currentThread.length)
      ? (currentThread[currentThread.length - 1].content || '') : '',
  };
});

check('raisonnement complet reconstitué', finalState.reasoning.includes('Je décompose la question...'));
check('réponse finale propre', finalState.body.includes('Voici la réponse finale.'));
check('AUCUN [object Object] dans la réponse', finalState.body.indexOf('[object Object]') === -1);
check('AUCUN [object Object] dans le raisonnement', finalState.reasoning.indexOf('[object Object]') === -1);
check('content persisté = string propre', finalState.threadContent === 'Voici la réponse finale.');
check('raisonnement persisté hors du content', finalState.threadReasoning.includes('Je décompose'));

// ── Cas 2 : non-régression forme Ollama (champ dédié + content string) ───────
await page.evaluate(() => { window.__stubFormat = 'ollama'; });
const ollamaSamples = await sendAndSample('Question Ollama.');
check('forme Ollama : raisonnement toujours en direct', [...new Set(ollamaSamples)].length >= 2);

const ollamaFinal = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#thread .msg.assistant');
  const last = msgs[msgs.length - 1];
  const rc = last && last.querySelector('.reasoning-content');
  const body = last && last.querySelector('.body');
  return { reasoning: rc ? rc.textContent : '', body: body ? body.textContent : '' };
});
check('forme Ollama : réponse intacte', ollamaFinal.body.includes('Voici la réponse finale.'));
check('forme Ollama : raisonnement intact', ollamaFinal.reasoning.includes('Je décompose la question...'));

check('aucune erreur console', errors.length === 0);
if (errors.length) console.log('  erreurs: ' + errors.join(' | '));

await browser.close();
console.log(failures.length ? '\nÉCHEC (' + failures.length + ')' : '\nOK');
process.exit(failures.length ? 1 : 0);
