---
name: run-miaou
description: Build, run, and drive MIAOU (the single-file web chat client). Use when asked to build MIAOU, run its tests, start the app, take a screenshot of its UI, or interact with the running app (drawers, composer, settings).
---

MIAOU is a static single-file web app (`dist/miaou.html`, built from
`src/` by `build.py`) — there is no dev server and no backend to launch.
"Running" it means opening the built HTML file directly in a headless
browser via `file://` and driving it with the Playwright script in this
skill directory: `.claude/skills/run-miaou/driver.mjs`.

All paths below are relative to the repo root.

## Prerequisites

Node + npm (used only to install the Playwright driver, not the app
itself, which has zero JS runtime dependencies). Python via `uv` for the
build and test suite (see project `CLAUDE.md`).

## Setup

One-time install of the driver's dependency (Playwright + a bundled
Chromium, ~150MB), scoped inside the skill directory so it never touches
the app's own dependency-free build:

```bash
cd .claude/skills/run-miaou
npm install
npx playwright install chromium
cd -
```

## Build

```bash
python3 build.py            # src/ → dist/miaou.html, with local config.json if present
python3 build.py --no-config   # neutral build, no embedded URL/key — used for the public github-main branch
```

## Run (agent path)

```bash
cd .claude/skills/run-miaou
node driver.mjs ./screenshot.png
cd -
```

This opens `dist/miaou.html` via `file://`, waits for the composer to be
ready, opens the Settings drawer (`#drawer.show`), waits out the
`translateX` slide-in transition, scrolls to the skills-confirmation
toggle, screenshots, and reports any browser console errors (non-zero
exit if any). It is a smoke test for the most fragile surface in this
app: the Settings drawer's hand-written HTML (`check-row`/`label-col`
divs nest by hand — a single unclosed tag has previously broken the
entire drawer's flex layout silently, with no console error).

Pass `--headed` to watch it run instead of headless:

```bash
node driver.mjs ./screenshot.png --headed
```

There's no REPL — for a one-off different interaction, copy `driver.mjs`
and edit the Playwright calls between `page.goto` and `page.screenshot`
(open a different drawer, click a different button, fill the composer,
etc.) using the selectors in `src/html/index.html`.

## Run (human path)

Just open the file in a real browser:

```bash
open dist/miaou.html   # macOS
```

Nothing to stop — it's a static file, not a server.

## Test

```bash
uv run --with quickjs python tests/runner.py
```

Expected: `OK — 291 passé(s), 0 échoué(s)` (count grows over time — 0
échoué(s) is what matters). This only covers pure functions (see
`CLAUDE.md` → Tests); UI/drawer rendering is what `driver.mjs` is for.

---

## Gotchas

- **`npx playwright install chromium` prints nothing on success.** Don't
  mistake silence for failure — verify with
  `node -e "console.log(require('playwright').chromium.executablePath())"`
  or just run the driver.
- **The Settings drawer slides in via CSS `transform: translateX(100%) → none`
  (220ms).** Screenshotting right after `waitForSelector('#drawer.show')`
  catches it mid-transition (drawer rendered, but pushed off-screen so
  only a sliver shows). Add a short `waitForTimeout` after the selector
  resolves, before the screenshot.
- **`config.json` (if present) gets embedded in `dist/miaou.html`,**
  including local backend URL/model — visible in a screenshot's
  "URL DE L'API" field. Harmless for local dev screenshots, but never
  ship a build for `github-main`/public consumption without
  `build.py --no-config` first (see project `CLAUDE.md` →
  "Synchronisation main → github-main").
- **There is no localStorage state across driver runs** — Playwright
  launches a fresh, empty profile each time (`chromium.launch()` with no
  persistent context), so the app always boots to "Nouvelle
  conversation" / default settings. That's a feature for a smoke test,
  not a bug: don't expect prior `node driver.mjs` runs to have left
  state behind.

## Troubleshooting

- **`Error: browserType.launch: Executable doesn't exist`**: Chromium
  wasn't downloaded. Re-run `npx playwright install chromium` from
  `.claude/skills/run-miaou/`.
- **Screenshot shows only a thin sliver of the drawer at the right edge**:
  the `translateX` transition hadn't finished — see Gotchas above.
