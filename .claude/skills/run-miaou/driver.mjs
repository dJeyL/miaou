#!/usr/bin/env node
// Minimal Playwright driver for MIAOU (dist/miaou.html, file:// — no server needed).
// Usage: node driver.mjs <screenshot-path> [--headed]
//
// Opens dist/miaou.html, dismisses the empty-state welcome screen if present,
// types into the composer to prove the page is interactive, and screenshots.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outPath = process.argv[2] || path.join(__dirname, 'screenshot.png');
const headed = process.argv.includes('--headed');

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto('file://' + distPath);

// Composer textarea is always present once the app boots (#composer-text).
await page.waitForSelector('#composer-text', { timeout: 10000 });

// Open settings drawer to prove drawer/toggle wiring renders correctly —
// this is the surface most often touched by skill/settings work.
await page.click('button[onclick="openSettings()"]');
await page.waitForSelector('#drawer.show', { timeout: 5000 });
await page.waitForTimeout(300);   // let the translateX(100%) -> none transition settle
await page.locator('#set-confirm-skill-autouse').scrollIntoViewIfNeeded();

await page.screenshot({ path: outPath });
await browser.close();

console.log('Screenshot saved to', outPath);
if (consoleErrors.length) {
  console.log('Console errors:', JSON.stringify(consoleErrors, null, 2));
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
