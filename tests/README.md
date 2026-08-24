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
