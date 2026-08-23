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
