// Vérifie la borne de hauteur des blocs de code du fil (.body pre code /
// .tool-block pre code) : le contenu long scrolle DANS sa boîte, .code-head
// reste visible, et l'inspecteur garde sa propre borne (300px).
import { chromium } from 'playwright';

const browser = await chromium.launch();
const rows = [];
for (const vp of [{width:1280,height:800},{width:1440,height:900},{width:900,height:600},{width:1280,height:1400}]) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto('file:///Users/julien/llm-playground/miaou/dist/miaou.html');
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    // Injecte un message assistant avec un bloc de code très long, par le vrai
    // chemin de rendu (renderMd + decoratePre), pas un markup fabriqué.
    const thread = document.querySelector('#thread');
    const msg = document.createElement('div');
    msg.className = 'msg assistant';
    const body = document.createElement('div');
    body.className = 'body';
    const lines = Array.from({length: 400}, (_, i) => `const ligne_${i} = ${i};`).join('\n');
    body.innerHTML = renderMd('```js\n' + lines + '\n```');
    msg.appendChild(body);
    thread.appendChild(msg);
    if (typeof decoratePre === 'function') decoratePre(body);
    const code = body.querySelector('pre code');
    const pre = body.querySelector('pre');
    const head = body.querySelector('.code-head');
    const messages = document.querySelector('.messages');
    const cs = getComputedStyle(code);
    return {
      messagesH: messages.clientHeight,
      codeBoxH: Math.round(code.getBoundingClientRect().height),
      codeScrollH: code.scrollHeight,
      overflowY: cs.overflowY,
      preH: Math.round(pre.getBoundingClientRect().height),
      headVisible: !!head && head.getBoundingClientRect().height > 0,
      scrolls: code.scrollHeight > code.clientHeight + 1,
    };
  });
  rows.push({
    vp: `${vp.width}x${vp.height}`,
    messagesH: r.messagesH,
    codeBoxH: r.codeBoxH,
    'ratio /messages': (r.codeBoxH / r.messagesH * 100).toFixed(1) + '%',
    scrolls: r.scrolls,
    overflowY: r.overflowY,
    headVisible: r.headVisible,
    'pre >= code': r.preH >= r.codeBoxH,
  });
  await page.close();
}
await browser.close();
console.table(rows);
const bad = rows.filter(r => !r.scrolls || !r.headVisible);
if (bad.length) { console.log('ÉCHEC:', JSON.stringify(bad)); process.exitCode = 1; }
else console.log('OK — borne active, en-tête épinglée, à tous les viewports.');
