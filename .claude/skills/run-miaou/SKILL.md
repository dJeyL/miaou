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
- **Wait for `.boot-done` as a STATE, never with `waitForSelector`.** The boot
  overlay hides the app until it is ready, and the class marking the end of
  boot is put on that overlay *as it becomes invisible*. `waitForSelector`
  waits for **visibility**, so once the overlay is gone the call can only time
  out: it keeps resolving the element, reporting it hidden, and retrying until
  the timeout fires — the whole budget spent, and not one word of diagnostic
  (`locator resolved to hidden <div class="boot-overlay boot-ready boot-done">`
  repeated N times). Use
  `page.waitForFunction(() => document.querySelector('.boot-done') !== null)`.
  Waiting on `#composer-text` alone is not equivalent: it exists *under* the
  overlay, so a screenshot taken then is a full-page shot of the splash cat
  (the DOM measurements around it are still valid — only the pixels are
  wrong). Both waits together is the safe form: composer for the app, class
  for the overlay.
  **It is a race, which is why it looks like a working idiom.** The overlay is
  visible for a while *after* it gets the class, so an early
  `waitForSelector('.boot-done')` resolves (measured ~1.3s — it is waiting for
  the app, then catching the overlay still on screen). Called later — after
  `#composer-text` has already resolved, i.e. once the overlay is gone — the
  same line can only time out. That is why the ~17 scripts already in this
  folder get away with it: they all append `.catch(() => {})`, so whichever way
  the race falls, the failure is swallowed and something downstream does the
  real synchronising. `waitForFunction` is 4ms and deterministic in both
  positions. Don't copy those call sites as an idiom, and above all don't copy
  one *without* its `.catch`.
  **The overlay is never removed from the DOM** — `finishBoot` (main.js) only
  adds the class, and not before a floor of `BOOT_MIN_AFTER_READY_MS` (1.8s).
  So `waitForFunction(() => !document.getElementById('boot-overlay'))` waits
  forever. **After a `page.reload()` this matters most**: `waitForSelector('#composer-text')`
  releases well before boot ends, so every DOM assertion passes (they query the
  DOM, not pixels) while the screenshot shows the MIAOU splash. It reads exactly
  like an app bug ("the thread doesn't render after reload") and is expensive to
  diagnose precisely because everything else is green. Add ~400ms after the class
  for the fade before screenshotting. Model in place: `verify-ack-errors.mjs`.
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

  **The commonest instance, and the one that reads as fully covered: a check on
  code that CLEARS state, exercised on a fresh path.** Lot AB-3 : deleting
  `clearAuthorizationRefusal` (which wipes the authorization fields when a
  retried call succeeds) left every check green. The scenario sent a *new* call
  that succeeded — and a new call has nothing to clear, so present and absent
  cleanup produce the same state. The fix is not a better assertion but a
  different scenario: drive the failure first, then the success **on the same
  entry** (here `callRemoteTool(..., reuseAckEntry)` twice), so the stale state
  exists to survive. Nothing looks wrong in the meantime — the assertion is
  sound, the premise true, the code correct; only the setup is inert.

  Generalised: **any guard that removes, resets, expires or invalidates needs a
  scenario where the thing removed was there in the first place.** The nominal
  path almost never creates it, which is why these are systematically the
  checks that survive mutation. Ask of every such check: *what would this
  assert if the cleanup simply never ran?* — if the answer is "the same thing",
  the scenario, not the assertion, is what needs rewriting. Assert the premise
  too (the refusal DID mark the entry), or the absences that follow are vacuous.

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
- **Patching a global function (not `window.fetch`) must happen AFTER the app
  script has loaded, never in `addInitScript`.** `addInitScript` runs before
  any page script, so `window.callTool = ...` there captures `undefined` as
  the "real" function, and — worse — is silently overwritten right back: the
  build concatenates every file into one script under `'use strict'`, so
  `function callTool(...) {...}` at top level is a function *declaration*,
  hoisted and (re)assigned to the global the moment that script runs — after
  your init script, wiping your patch with zero error. `window.fetch` survives
  in `addInitScript` because nothing in the app ever reassigns `window.fetch`
  itself. For anything else exported as a bare top-level `function`, arm the
  patch with a `page.evaluate` call placed after `page.goto`/boot-wait,
  keeping a reference to the original to delegate to (cf.
  `verify-stop-deferred.mjs`, gating `callTool` to reproduce the exact window
  where `gen.abort` is null between tool-call tours).

- **A protocol stub must serve the handshake, not only the call.** Replacing
  `mcpRpc` wholesale to suspend a tool call (to hold open the window where an
  ack is painted but not yet enriched) also suspends `initialize` and
  `tools/list`, which `connectMcpServer` issues first: the connection never
  completes, the tool is never registered, the model's `tool_call` has no
  target, and the scenario being measured cannot occur. Answer `initialize` /
  `notifications/initialized` / `tools/list` normally and gate **only**
  `tools/call`. Same signature as the entries above — it hangs rather than
  failing a check. Then assert the premise you now depend on (« the tool IS in
  the registry ») as the *first* check of the script: without it, every check
  after it would pass while measuring nothing (cf. the vacuous-stub section
  below).

General lesson for this rig: when a scenario hangs, **add a temporary DBG
`page.evaluate` dumping what the stub actually saw** (its tag, its armed state)
rather than re-reading the scenario. All three above were found that way, and
none of them were visible by inspection — the script looked right in each case.
Prefix the probe `_` and delete it when done (see the Gotchas rule on throwaway
scripts).

### A stub that is never solicited makes the whole check vacuous

The rig failures above hang. This class does the opposite and is nastier: the
run **passes**, quickly, having tested nothing — the stub was never reached, so
the app took some other path and every assertion held for the wrong reason.
Three ways it happened while reproducing the stalled-stream bug (2026-09-01):

- **The route pattern does not match the URL actually called.** Settings written
  to `miaou-settings` are NOT necessarily what the app uses: a registered API
  server card (`miaou-api-servers` / `miaou-active-api-server`) wins over them,
  so the app kept calling the real backend (`macmini:11434`) while the stub sat
  on `stub.local`. Clear both keys when stubbing, and prefer a regex
  (`/chat\/completions/`) over a glob tied to a host.
- **A `page.route` handler that neither fulfills nor continues aborts the
  request.** To simulate a connection that hangs, the handler must stay alive on
  a never-settling promise (`await new Promise(() => {})`); doing nothing makes
  Playwright cancel it, `fetch` rejects at once, and the app takes its error
  path — the opposite of what was being tested.
- **The discriminant matched the wrong requests.** Telling a summary call from a
  chat call by grepping the system prompt for « résumé » matched *everything*:
  MIAOU's own system message contains the word. Discriminate on a structural
  property instead — `body.stream` is true for chat, absent for summary and
  titling.

**Always make the stub prove it was solicited.** A counter incremented in the
handler and printed at the end (`hangs`, `calls`) is what exposed all three; each
time the checklist looked plausible and the counter read `0`. An assertion that
the stub was hit at least once belongs in the checklist itself, next to the
behavioural ones — a green run with a cold stub is indistinguishable from a real
pass (form 1 of the "green check proves nothing" taxonomy).

### A red check may be accusing the app of a rig defect

The two classes above hang or pass vacuously. This one **fails loudly, with a
plausible-looking message**, and the message names the app. Twice in a row while
verifying early titling (2026-09-02):

- **A chat stub served as JSON leaves the assistant message with empty
  `content`.** Everything downstream that reads it then abstains *correctly*:
  `maybeTitle` has an 8-character guard (pitfall 5, do not title an aborted
  exchange), so the checklist read "the end-of-exchange pass does not title" —
  a true observation about a message the rig had emptied. **Chat must be served
  as SSE**; only the titling/summary calls go through `silentCompletion` and are
  legitimately stubbed as plain JSON. Both live in the same handler, so
  discriminate before responding (`body.stream`, or the system prompt).
- **Counters reset before earlier generations have finished** attribute their
  late titling call to the block being measured. Reset *after* the reload and a
  settle delay, not before.

**What settles it is replaying on the revision from before the change**, not
re-reading the code: `git worktree add /tmp/<name> HEAD --detach`, point the
script at that `dist/miaou.html`, run it. If the same red appears there, the rig
is lying — the behaviour predates the work in progress. This costs a minute and
is the only thing that distinguishes "I broke it" from "the rig cannot see it",
which reading the source cannot do: the code looks correct in both cases.

Corollary for the checklist: a red assertion about an **absence** (does not
title, does not call, does not write) deserves this treatment before any other,
since a rig that silently disables the trigger produces exactly that shape.

## Re-run the PREVIOUS lot's verify, not only the new one

When a lot touches code an earlier lot already covered, run that earlier lot's
verify script too, unchanged. It is the cheapest check available (no writing,
no maintenance) and it measures something the new script structurally cannot:
a fresh verify asserts what the current lot aims at, the previous lot's verify
asserts what the current lot broke.

Paid on 2026-08-30 (X-1e): the new verify was green on all 43 checks while the
cross-run of `verify-agents.mjs` failed on two scenarios. One was a real
pre-existing CSS defect; the other was a regression introduced in that very
session, in a code path the new verify had no reason to visit — it would have
shipped. Neither was reachable by inspection, and neither belonged in the new
script's scope, so no amount of care writing it would have caught them.

Practical form: at the end of a lot, before committing, run every verify whose
domain the diff touches. A failure there is not noise to be silenced — decide
case by case whether it is a genuine regression (fix the code) or a legitimately
changed premise (fix the script, and say so in the commit).

## Troubleshooting

- **`Error: browserType.launch: Executable doesn't exist`**: Chromium
  wasn't downloaded. Re-run `npx playwright install chromium` from
  `.claude/skills/run-miaou/`.
- **Screenshot shows only a thin sliver of the drawer at the right edge**:
  the `translateX` transition hadn't finished — see Gotchas above.
