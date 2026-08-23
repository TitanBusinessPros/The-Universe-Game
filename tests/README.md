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
