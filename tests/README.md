# Regression tests

`regression-test.js` loads the real `index.html` into a headless DOM (via jsdom)
and runs the actual game classes/functions to check rules that have broken
silently before — units that can never hit each other, buildings that can
never be damaged no matter what, difficulty presets crossing over, AI nations
only attacking the player instead of each other, campaign stages not starting
music, etc.

## Running it

```
cd tests
npm install jsdom
node regression-test.js "../index.html"
```

Exits with code 0 if everything passes, 1 with a printed report if anything
fails. Run this before pushing any change that touches combat, unit stats, AI
targeting, or difficulty balance.

## Runs automatically too

`.github/workflows/regression-tests.yml` runs this exact suite on every push
to `main` (and on every pull request), via GitHub Actions. If it fails, the
commit gets a red X in the repo's Actions tab and GitHub emails whoever's
watching the repo / pushed the commit, the same way a failed build notifies
you on any normal software project. This doesn't change how the site is
hosted — GitHub Pages still just serves `index.html` as a static file exactly
as before; the workflow is a separate check that runs alongside it.

## Real-browser tests (`browser/`)

`regression-test.js` fakes the canvas out entirely (every draw call is a
no-op) so it can check game *logic* fast and without a real browser. It has
no way to catch a bug where the code runs fine but LOOKS wrong, or one that
only shows up through an actual mouse click/drag. `browser/` covers both
gaps, driving REAL headless browsers via Playwright — Chromium, Firefox,
and WebKit (Safari's actual engine), so a bug specific to one engine gets
caught too, not just "works in Chrome."

### Visual (`browser/visual-test.js`)

Takes an actual screenshot of specific known game scenes and compares it
pixel-by-pixel against a committed reference image — one baseline per
engine (`browser/baseline/<engine>/`), since different engines legitimately
render fonts/anti-aliasing differently even with nothing wrong in our code.

Time and randomness are frozen before the game script runs, and sprite
images are swapped for a fixed local placeholder, so the same scene renders
consistently every run regardless of network conditions or real-world
timing. (Some residual run-to-run jitter — a couple thousand pixels out of
~1,000,000, from async image-load-queue timing shifting exactly how many
`Math.random()` calls have fired by screenshot time — is expected and
tolerated; a real regression measures in the hundreds of thousands of
pixels, confirmed by deliberately breaking something and checking.)

```
cd tests/browser
npm install
npx playwright install --with-deps chromium firefox webkit
node visual-test.js ../../index.html
```

If a change is a deliberate visual update (not a bug), regenerate the
baseline **from CI, not your own machine** — a baseline generated locally
will almost certainly fail on GitHub's runner from font substitution alone
(see the `bootstrap-visual-baseline` job in the workflow, triggered manually
from the Actions tab; confirm the new screenshots are actually correct by
eye before trusting them).

### Interaction (`browser/interaction-test.js`)

Drives real synthetic mouse events (via Playwright's `page.mouse`) against
the rendered canvas — drag-select a box over a unit, click empty space to
move it, right-click-drag to pan the camera, plain right-click to deselect
— and asserts on the resulting game state. This is the one thing neither
of the other two suites can do: everything else drives the game by calling
its own functions directly, never by actually moving a mouse the way a
player's browser would.

```
cd tests/browser
node interaction-test.js ../../index.html --engines=chromium,firefox,webkit
```

Both run automatically in CI (see `.github/workflows/regression-tests.yml`).

## Balance simulation (`balance/`)

Every other suite answers "does this work correctly" - this one answers a
genuinely different question: "is it *fair*". A nation quietly having a
much easier or harder time than the others isn't a crash or a broken
function, so nothing above would ever catch it; it only shows up
statistically, across many games.

`balance/balance-simulation.js` runs many full AI-vs-AI games (every
nation/faction played by the AI, no player advantage) to a turn cap, using
each nation's own real id/bonuses/units/AI logic exactly as a real game
would, and reports survival rate, average elimination turn, and average
remaining strength per nation/faction.

One deliberate departure from a real game: the real galaxy spaces nations
12,000-50,000 units apart (fine for a long human-paced game, but measured
directly - even 90 simulated turns of travel time left every nation
undefeated, which would make a useful report take hours to generate). Since
what's actually being measured is each nation's own stats and behavior
relative to the others, not how far apart their homeworlds happen to be,
every island gets repositioned onto a single tight ring first (real ids,
bonuses, buildings, and units all untouched) - and *who sits next to whom*
on that ring is reshuffled every run, so a nation's results reflect its own
balance, not which neighbor it happened to get seated next to.

```
cd tests/balance
npm install
node balance-simulation.js ../../index.html --runs=30 --turns=40 --frames=800 --difficulties=easy,normal,hard
# or: npm run report   (same thing)
```

This is a report to READ, not a pass/fail gate - "Nation X wins a bit more
often than average" is a finding for a human to weigh, not something with
an objectively correct target. It only fails (exit code 1) if a run
actually crashes, which is a real bug. A cheap 1-run smoke version of it
runs automatically in CI on every push, purely to catch that; the full
report is manual (`workflow_dispatch`, or `npm run report` locally) since
it takes a while.

**On sample size - measured, not guessed:** an early 15-run report flagged
4 nations as clearly underperforming on Hard. A second, independent
15-run batch flagged an almost entirely different set - including Russia,
which the first batch showed as the single strongest nation. Bumping to
60 runs settled it: every regular nation lands in a tight 82-92% band with
no real outliers. Don't trust a single report under ~30 runs per
difficulty; the script itself warns when you go below that.
