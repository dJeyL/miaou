#!/usr/bin/env node
// Checklist Playwright : drop pleine-zone (#main-col) + paste de fichier
// (image et non-image) dans le composer. Vérifie handleAttachFiles est bien
// atteint depuis les deux points d'entrée étendus (onMainDrop / onComposerPaste).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('file://' + distPath);
await page.waitForTimeout(300);

let failed = false;
function check(label, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? ' — ' + detail : ''));
  if (!ok) failed = true;
}

// 1. Drop sur .main-col loin de .input-wrap (topbar) doit attacher le fichier.
const dropResult = await page.evaluate(async () => {
  const dt = new DataTransfer();
  dt.items.add(new File(['contenu note'], 'note.md', { type: 'text/markdown' }));
  const topbar = document.querySelector('.topbar');
  const main = document.getElementById('main-col');
  topbar.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const hadDragoverClass = main.classList.contains('dragover');
  topbar.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 300));
  const chips = document.getElementById('attach-chips');
  return {
    hadDragoverClass,
    dragoverClearedAfterDrop: !main.classList.contains('dragover'),
    chipsVisible: chips && !chips.hidden,
    chipsHtml: chips ? chips.innerHTML : '',
  };
});
check('dragover class posée sur #main-col pendant le survol (loin du composer)', dropResult.hadDragoverClass);
check('dragover class retirée après drop', dropResult.dragoverClearedAfterDrop);
check('chip attachment visible après drop sur topbar', dropResult.chipsVisible && dropResult.chipsHtml.includes('note.md'), dropResult.chipsHtml.slice(0, 200));

// 2. Reset attachments, then paste a non-image file into composer textarea.
await page.evaluate(() => { pendingAttachments.length = 0; renderComposerAttachments(); });
const pasteResult = await page.evaluate(async () => {
  const dt = new DataTransfer();
  dt.items.add(new File(['# titre\ncontenu'], 'plan.md', { type: 'text/markdown' }));
  const ta = document.getElementById('composer-text');
  ta.focus();
  const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  ta.dispatchEvent(evt);
  await new Promise(r => setTimeout(r, 300));
  const chips = document.getElementById('attach-chips');
  return { chipsVisible: chips && !chips.hidden, chipsHtml: chips ? chips.innerHTML : '' };
});
check('paste fichier .md dans le composer → chip attachment', pasteResult.chipsVisible && pasteResult.chipsHtml.includes('plan.md'), pasteResult.chipsHtml.slice(0, 200));

// 3. Reset, then paste an image file (regression check on existing behavior).
await page.evaluate(() => { pendingAttachments.length = 0; renderComposerAttachments(); });
const pasteImgResult = await page.evaluate(async () => {
  // 1x1 png
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }));
  const ta = document.getElementById('composer-text');
  ta.focus();
  const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  ta.dispatchEvent(evt);
  await new Promise(r => setTimeout(r, 300));
  const chips = document.getElementById('attach-chips');
  return { chipsVisible: chips && !chips.hidden, chipsHtml: chips ? chips.innerHTML : '' };
});
check('paste image toujours fonctionnel (non-régression)', pasteImgResult.chipsVisible && pasteImgResult.chipsHtml.includes('pixel.png'), pasteImgResult.chipsHtml.slice(0, 200));

await browser.close();
console.log(failed ? '\n=> ECHEC' : '\n=> OK');
process.exit(failed ? 1 : 0);
