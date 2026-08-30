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

- **Every `.mjs` that imports `playwright` MUST live in this directory
  (`.claude/skills/run-miaou/`).** Playwright + Chromium are installed in
  the `node_modules` *scoped to this folder* (see Setup) — nowhere else.
  A script run from the scratchpad or `/tmp` fails instantly at
  `import ... from 'playwright'` with `ERR_MODULE_NOT_FOUND`. This holds
  for **any** such script with no exception: the main verify/shot scripts,
  *and* a throwaway diagnostic probe written "just to isolate a bug". The
  words "temporary / disposable / just to check" are not an exemption —
  put it here, prefix a throwaway one with `_` (e.g. `_probe-foo.mjs`) to
  mark it, and `rm` it when done. The scratchpad is only for files that do
  **not** import from this `node_modules` (data, HTML, notes). This has
  been the single most-repeated mistake driving this skill.
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
- **The `miaou-mcp-servers` proxy listens on port 8765** (moved from 8767,
  definitive as of 2026-08-28). Two scripts talk to a proxy, and they do
  *opposite* things despite sharing the `VERIFY_PROXY_PORT` override:
  `verify-docs-extract.mjs` **reuses** the proxy already running on 8765,
  while `verify-res-docs-wiring.mjs` **spawns its own** on a dedicated
  8799 precisely so it never collides with it. When a verify fails with
  "Le proxy MCP ne répond pas", read it as an environment fact before
  suspecting the app or a stale assertion: check what port the proxy is
  actually on (`lsof -nP -iTCP -sTCP:LISTEN | grep -i python`) rather
  than patching the script.
- **There is no localStorage state across driver runs** — Playwright
  launches a fresh, empty profile each time (`chromium.launch()` with no
  persistent context), so the app always boots to "Nouvelle
  conversation" / default settings. That's a feature for a smoke test,
  not a bug: don't expect prior `node driver.mjs` runs to have left
  state behind.

## Writing assertions in a verify script

A verify is only worth its runtime if each assertion can *fail*. Two ways a
green proves nothing:

- **An assertion that accepts more than one outcome.** Real case (lot T-2bis):
  `check('le compteur suit le registre', pill === null || pill === '1 agent')`
  passed whichever way the counter behaved — the disjunction was written while
  unsure which state was correct, and that uncertainty got frozen into the
  test. Tightened to `pill === null` (the only correct outcome: the remaining
  generation is the displayed one), it immediately caught a regression it had
  been blind to. **Decide the expected value before writing the check**; if you
  genuinely don't know it, find out — never encode the doubt as an `||`.
- **A scenario where the two branches of a predicate can't diverge.** Also lot
  T-2 : removing the active-Space exclusion from the collapsed selector
  produced **0 FAILs**, because no fixture ever made "everything" and
  "elsewhere" differ. A predicate is only tested by a state where a wrong
  implementation would give a different answer.

A third way a verify misleads, and the hardest to read: **a fixture that
manufactures the very defect the check is looking for.** Here the assertion is
sound and the code is correct — the setup collides with itself.

Real case (lot V-8 review): checks around `attId` allocation stored their source
PDFs under `att-1`, `att-7`, `att-9`, while every section shares one conversation
whose counter climbs past those numbers as renders accumulate. Two records ended
up under the same `attId`, and `getCachedRecordByAttId` — first match wins —
started depending on cache iteration order. One check in three failed, reporting
an "unknown format" that read as an accusation against the handler. The fixtures
now sit at `att-90`+, out of the counter's path.

Two things to take from it:

- **An intermittent failure in a verify is a fixture smell before it is a code
  smell.** The app is deterministic here; what varies between runs is iteration
  order over accumulated state. Diagnose by dumping the state the failing lookup
  reads (the whole cache, not the one key you expect), rather than re-reading
  the handler.
- **When a script allocates from a counter that its own fixtures also occupy,
  put the fixtures out of that counter's reach** — and say so in a comment, or
  the next person reads `att-90` as an arbitrary number and "tidies" it back to
  `att-1`. The same holds for any shared sequence: ids, ports, sequence numbers.

Note the sequence: the check added last was *stable*; it merely pushed the
counter two numbers higher, which surfaced a latent flaw that had been sitting
in the script since it was written. A new check that makes an old one flaky is
usually revealing it, not breaking it.

So: **challenge each green by injecting the regression it is supposed to
catch** (edit the source, rebuild, re-run, confirm it goes red, revert). This
is how both blind spots above were found. It complements — and does not replace
— running the verify against the pre-change code (a script green from the very
first run is a signal to re-play, not a licence to skip it).

Assertions accumulate into a `failures` array via a `check(label, cond)` helper
so one run reports every problem, rather than aborting on the first.

## Driving a stubbed model: rig constraints that are not code constraints

Scenario-driven verifies (`verify-agents.mjs`, `verify-generations.mjs`,
`verify-interjections.mjs`) stub `/chat/completions` and gate scripted tool calls
on a per-conversation tag. Three properties of *that rig* have cost real
debugging time. They share a signature that makes them hard to read: **the run
hangs or times out instead of reporting a red assertion**, because the gate
never opens, so the code under test is never reached and has nothing to say.

When a scenario times out with no failed check, suspect the rig in this order
before touching the app:

- **The stub reads its state at request entry, so arming after `send()` is too
  late.** Materialise the conversation and its fixtures, arm the stub, *then*
  send. When the value to arm with is only known after a first turn (a minted
  `res_…`), exploit determinism instead of ordering: `agentDelegatedAlias` is a
  pure function of the record id, so the alias can be computed up front rather
  than captured at runtime.
- **A conversation that already carries a `role:'tool'` message will not fire a
  second tool call** — the stub's `hasToolResult` guard ends the turn instead.
  Consecutive tool-calling scenarios therefore need a **fresh parent
  conversation each**, not one reused across blocks. This is a limit of the
  montage, not of the app: MIAOU chains tool calls fine. Say so in a comment,
  or a later reader will "fix" the app for it.
- **The tag regex is `[A-Z0-9]+` — lowercase is silently truncated.** A tag
  `P10a` matches as `P10`, so the gate keys on the wrong scenario and never
  opens. Keep every tag uppercase (`P10A`, `A10A`). The failure mode is a
  timeout with no diagnostic whatsoever.

General lesson for this rig: when a scenario hangs, **add a temporary DBG
`page.evaluate` dumping what the stub actually saw** (its tag, its armed state)
rather than re-reading the scenario. All three above were found that way, and
none of them were visible by inspection — the script looked right in each case.
Prefix the probe `_` and delete it when done (see the Gotchas rule on throwaway
scripts).

## Troubleshooting

- **`Error: browserType.launch: Executable doesn't exist`**: Chromium
  wasn't downloaded. Re-run `npx playwright install chromium` from
  `.claude/skills/run-miaou/`.
- **Screenshot shows only a thin sliver of the drawer at the right edge**:
  the `translateX` transition hadn't finished — see Gotchas above.
