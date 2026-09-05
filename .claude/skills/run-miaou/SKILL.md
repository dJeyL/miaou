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

## Ask before running — and ask again before capturing

**Never launch anything from this skill on your own initiative.** Scripts,
screenshots, box-model measurements, ad-hoc checks: all of it costs generated
tokens — the script, its output, the captures read back. Julien has a browser
and eyes; a visual check costs him nothing and costs the session a lot.

**The decision point is before writing the script, not before running it.**
Producing eighty lines of `.mjs` and then asking "shall I run it?" has already
spent what the rule exists to save. Ask when the idea appears: "a Playwright
script would help here to measure X — shall I write it?" Say *Playwright
script*; "the verification script" means nothing to him.

- *Visual check* ("does it look right?", "is the toggle greyed out?") → do not
  offer a script at all. Build, run the tests, then say what to look at and
  where.
- *Fine measurement or awkward case* (pixel-level CSS, a JS behaviour in an
  extreme case, a value nobody can guess) → offer it; he will likely accept,
  but wants to say so first.

**An authorisation is never transitive.** It does not carry to the next script,
and — the variant paid on 2026-09-05 — it does not carry to *screenshots slipped
inside an authorised one*. Measuring computed opacity to assert a disabled
control is greyed out is a legitimate measurement; adding `page.screenshot` next
to that assertion is a separate decision, and one he had already answered by
looking at his own screen. The tell: the capture proves nothing the assertions
do not already prove, and exists only so *I* can look. If a capture is genuinely
the artefact being asked for, it was in the request; otherwise leave it out.

Once authorised, batch everything into **one checklist script** (PASS/FAIL
assertions plus targeted captures) rather than multiplying exploratory runs.

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

  **One sub-directory is allowed and ignored: `untracked/`.** It holds the
  artefact scripts — the `shot-*` captures and the `measure-*` one-off
  arbitrations — as opposed to the non-regressions that live at this level, are
  versioned, and are cited from their domain doc. The sorting question is not
  the prefix but: *would this script go red if someone broke something?* If yes
  it belongs up here; if it only produces something to look at, it goes in
  `untracked/`. Two scripts show the prefix is not the criterion:
  `verify-move-bar-width.mjs` is down there (it measures a box model for a
  one-off diagnosis), and `shot-agent-busy-glyphs.mjs` too despite carrying
  assertions, because it only frames what `verify-agent-busy-rewrite.mjs`
  already measures. `import ... from 'playwright'` still resolves from there
  (Node walks up to this folder's `node_modules`), but **two paths shift by one
  level**: the repo root is `../../../..` and a local import is
  `../seed-fixtures.js`.
- **`npx playwright install chromium` prints nothing on success.** Don't
  mistake silence for failure — verify with
  `node -e "console.log(require('playwright').chromium.executablePath())"`
  or just run the driver.
- **The Settings drawer slides in via CSS `transform: translateX(100%) → none`
  (220ms).** Screenshotting right after `waitForSelector('#drawer.show')`
  catches it mid-transition (drawer rendered, but pushed off-screen so
  only a sliver shows). Add a short `waitForTimeout` after the selector
  resolves, before the screenshot.
- **A transition breaks assertions too, not only screenshots** — and there the
  fixed delay is a race rather than a blur. `animateGroupPanelSwap` only sets
  `hidden` on the outgoing ack panel when its transition ends (~220ms), so a
  `waitForTimeout(300)` followed by `check(list.hidden === false && slot.hidden
  === true)` passes or fails depending on the machine. Caught here with the slot
  at `opacity: 0.000121` — **neither visible nor `hidden`**, a state no
  assertion was written for, and one that instrumentation printed while a
  separate debug read of the same element (evaluated a few lines later in the
  same `page.evaluate`) already showed the settled values. Wait for the terminal
  state itself: `page.waitForFunction(() => document.querySelector('.ack-slot')
  .hidden === true)`. Then re-run the script two or three times — a race fixed
  by luck and a race fixed properly look identical on a single green run.
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

### Screenshots: wait for `.boot-done`, or capture the boot overlay instead

`#boot-overlay` covers the whole application while `init()` fades it out. The
trap is that **the DOM is already correct underneath**: `getBoundingClientRect`
returns the real coordinates, `el.hidden` is `false`, computed styles are right —
every DOM assertion passes. Only the pixels are wrong, and a clip computed from
those correct coordinates frames the overlay.

Cost here (AB-5): three empty topbar captures in a row, each blamed on the clip.
The clip was recomputed from `getBoundingClientRect` — the documented remedy for
a mis-framed capture — then zoomed, and stayed empty, because the cause was not
framing at all. What broke the loop was capturing the **full page** and looking
at it: the logo, unmistakably.

Wait on the application's own signal rather than a guessed delay, right after
the `waitForFunction` on app globals:

```js
await page.waitForFunction(() => {
  const o = document.getElementById('boot-overlay');
  return !o || o.classList.contains('boot-done') || getComputedStyle(o).opacity === '0';
}, { timeout: 10000 });
await page.waitForTimeout(900);   // couvre la transition d'opacité
```

Generalises to any full-surface overlay: **when a capture is empty but every DOM
measurement agrees, the question is not "where did I frame?" but "what is painted
on top?"** — and one `fullPage` screenshot answers it immediately, where another
round of clip arithmetic cannot.

The symmetric case: **hover-revealed controls photograph as nothing.** The
message action glyphs (`.msg-edit`, `.msg-regen`, `.msg-copy-user`) live at
`opacity: 0` and only rise when their own bubble is hovered. A screenshot taken
to show one of them — greyed out, say — shows an empty gutter, and this time
nothing is painted on top: the pixels are genuinely absent while every measure
is right. Hover the **bubble** first, then the button itself if its `:hover`
rules are part of what is being shown, with a short settle for the opacity
transition:

```js
await page.hover('#thread .msg.user');           // reveals the action row
await page.hover('#thread .msg.user .msg-edit'); // triggers the button's own :hover
await page.waitForTimeout(250);
```

Then clip around the element rather than shooting full-page — two 14px glyphs
are invisible in 820px of height. Worth stating because the reflex when a
capture looks empty is to widen the frame, which here makes it strictly worse.

## Writing assertions in a verify script

A verify is only worth its runtime if each assertion can *fail*. Ways a green
proves nothing — the list grows, so it is deliberately not counted here:

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

A fourth way, specific to asserting that a control is **absent, hidden or
disabled**: **counting nodes measures the markup, not what the user can act
on.** MIAOU hides rather than removes — `applyActivityBadge` sets `hidden` and
leaves the node in place, `activityBadgeEl` creates one per row even at state
`null`, the hamburger and space selector carry theirs permanently, and the edit
/ regenerate glyphs sit at `opacity: 0` until their bubble is hovered. So
`querySelectorAll('.activity-dot').length === 0` is green on a page covered in
badges. Paid on 2026-09-05: three assertions green by construction, including
the one meant to count the conversation list's badges.

Ask the DOM what is *visible*, and read greying off the **computed style**, not
off the class:

```js
const visible = [...document.querySelectorAll(sel)]
  .filter(el => !el.hidden && el.offsetParent !== null).length;
const cs = getComputedStyle(btn);   // opacity, cursor — not classList.contains
```

Asserting `classList.contains('agent-busy')` only proves the JS ran; it says
nothing about whether the cascade followed, which is the half that actually
breaks (a more specific rule elsewhere silently wins). Assert both when the
class is itself the contract, but never the class alone.

So: **challenge each green by injecting the regression it is supposed to
catch** (edit the source, rebuild, re-run, confirm it goes red, revert). This
is how both blind spots above were found. It complements — and does not replace
— running the verify against the pre-change code (a script green from the very
first run is a signal to re-play, not a licence to skip it).

**Rebuild on the way back too.** The revert is the half that gets skipped: the
app under test is `dist/miaou.html`, so restoring `src/` without re-running
`python3 build.py` leaves the *previous* regression live in the bundle. Every
subsequent run then measures code you believe you have restored. Paid on
2026-09-05 — a `cp` of a backup with no rebuild, then four diagnostic probes
spent accusing correct application code of not repainting, because the bundle
still held the mutilated version. The tell is specific and worth recognising:
**a probe calling the function directly succeeds while the same call through
its normal caller does nothing.** That shape means the two are not the same
code — i.e. a stale artefact — and no amount of reading the source will show
it. Script the cycle so the rebuild cannot be forgotten:

```bash
reg() { python3 build.py >/dev/null; node .claude/skills/run-miaou/<verify>.mjs …; \
        cp /tmp/<file>.bak src/js/<file>.js; }   # then one final build.py
```

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

- **A stub that does not discriminate destroys its own control.** A verify that
  proves "the degraded card looks degraded" needs a healthy card beside it,
  otherwise the assertion passes on a page where every card looks the same. But
  a stub keyed only on the method — `mcpRpc = (server, method) => …` ignoring
  `server` — serves the same degraded payload to every configured server, so the
  control *becomes a second degraded server*. The failure mode is worse than a
  vacuous green: the run goes **red**, and the failing checks point at the
  application ("the count says 2, expected 1"), which is the correct answer to
  what the rig actually said. Cost here: a diagnostic session on healthy code
  before reading the stub. When a scenario has a control, the stub must branch on
  whatever distinguishes it — `if (server.name !== 'miaou-proxy') return …` —
  and the control assertion must be phrased as a control ("témoin : le serveur
  sain reste vert"), so a red on that line reads as "the fixture lost its
  control" rather than "the code regressed".

- **A stub keyed on a call counter serves the wrong turn.** `if (turn === 1)`
  and `if (phase === 0)` read as "the user's turn", but the application
  legitimately issues several requests of its own before it — titling,
  summarising — so by the time `send()` fires the counter has already passed the
  branch that mattered. Measured here: `__stubPhase` was at **4**. The gated
  tool-calling turn is then never served, the generation ends immediately, and
  everything downstream reports the truth about a scenario that never happened.
  Branch on the **content of the request** instead: the user's text for the
  first turn, `msgs.some(m => m.role === 'tool')` for the one after the tool
  ran. This is the same failure as the non-discriminating stub below, on a
  different axis — that one fails to discriminate *between servers*, this one
  discriminates on *ordering*, which is not a property the rig controls.

  Worth recognising because it lies in two opposite ways. In
  `verify-tool-inspector-live-ack.mjs` it hung: a timeout on `__mcpCalled` with
  no red assertion. In `verify-interjections.mjs` it went loudly red on three
  checks that accused the app of queueing nothing — a faithful description of
  what the rig had produced, since `sending` had already fallen back to false
  and the interjection went out as an ordinary message. Both were fixed by the
  same one-line change of branching key.

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

## Replaying the whole suite: scripts rot, and they rot in four ways

The rules above are about the script being written now. This one is about the
parc: 85 scripts replayed in one sitting (2026-09-05) produced **16 reds, and
not one application bug**. `src/` came out of that session untouched. A verify
that was correct when written decays as the code it watches moves on, and the
decay is not random — four causes account for the lot (the script counts below
overlap: two scripts carried two causes each):

- **Stale closed enumerations** (5 scripts). `=== 5` for "2 seeded + 3 system
  skills" when there are now five system skills; `count === 3` for the
  `resource__` namespace when `resource__append` made it four. This is the
  project's closed-enumeration rule (`CLAUDE.md`) striking inside the test
  scripts, where **no grep watches**: `run_help_enumerations_check` covers
  `help.md`, nothing covers `.mjs`. Do not re-bump the number — it will expire
  again at the next addition. Read it from the live source
  (`Object.keys(SYSTEM_SKILLS_CONTENT).length`), or drop the cardinal for the
  expected **set of names**, which also says *which* one is missing when it
  fails. A bare count cannot.
- **Stubs keyed on ordering rather than content** (2 scripts) — see the rig
  section above.
- **Contracts that moved** (4 scripts). A handler became `async`, so
  `flattenToolResult(r)` flattened a Promise into `''` while the
  synchronously-pushed acks kept passing — three red text assertions beside
  green ack assertions, which is the tell. A settings toggle the smoke test
  scrolled to no longer exists. A doctrine string stopped mentioning the token
  being searched for. One script resolved the bundle through `process.cwd()`,
  so it only ran from the repo root.
- **Timing races** (2 scripts) — see the transition gotcha above.

**How to read a red, in this order.** A verify's red is a claim about the app,
and it is wrong more often than it is right. Before touching `src/`: (1) is the
assertion's premise still true — grep the wording, the id, the field it names;
(2) does a green assertion right beside it contradict the red one (acks green /
text red = the rig, not the app); (3) does the app do the right thing when
called directly in a probe (if yes and it fails through its normal caller, cf.
the stale-artefact rule); (4) only then, the pre-change replay
(`git worktree add /tmp/<name> HEAD --detach`), which settles it definitively.

**Corollary on maintenance.** A repaired verify is worth more than a deleted
one, but a *silenced* one is worth less than nothing. When a premise has
genuinely changed, fix the assertion **and say what replaced it** in a comment —
`verify-brief-h-batch.mjs` now asserts "prefer native over server" where it used
to assert `content_b64`, and the comment records why the old token vanished.
Without that line the next reader restores the old assertion.

## Troubleshooting

- **`Error: browserType.launch: Executable doesn't exist`**: Chromium
  wasn't downloaded. Re-run `npx playwright install chromium` from
  `.claude/skills/run-miaou/`.
- **Screenshot shows only a thin sliver of the drawer at the right edge**:
  the `translateX` transition hadn't finished — see Gotchas above.
