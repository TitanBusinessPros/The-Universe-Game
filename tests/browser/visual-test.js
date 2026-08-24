#!/usr/bin/env node
/**
 * After Earth — visual regression test
 * -------------------------------------
 * Unlike regression-test.js (which fakes the canvas out entirely so it can
 * check game LOGIC), this drives a real headless browser and takes an
 * actual screenshot of the canvas, then compares it pixel-by-pixel against
 * a committed reference image. This is what catches "it still works, but it
 * looks wrong" - a sprite that stopped drawing, a color that changed, a
 * layout that shifted.
 *
 * Runs against Chromium, Firefox, AND WebKit (Safari's real engine) by
 * default - each has its OWN baseline (tests/browser/baseline/<engine>/),
 * since different engines legitimately render fonts/anti-aliasing
 * differently even when nothing in our code is wrong. Comparing Firefox's
 * screenshot against a Chromium-generated baseline would fail constantly
 * for reasons that have nothing to do with a real bug.
 *
 * Time and randomness are frozen before the game script ever runs, so the
 * same scene renders byte-identical every time (no animation drift, no RNG).
 * Sprite images are intercepted and replaced with fixed local placeholders
 * so the test never depends on network access or an external image host
 * being reachable - it can only fail because of a real change in our own
 * code's output.
 *
 * Usage:
 *   node visual-test.js "<path-to-index.html>" [--update] [--engines=chromium,firefox,webkit]
 *
 * Exits 0 if every scene matches its baseline on every engine, 1 if any
 * differs (writing a *-actual.png and *-diff.png next to the baseline so
 * the difference is visible). Pass --update to (re)write the baseline
 * images instead of comparing against them - only do this deliberately,
 * after confirming by eye that the new screenshots are actually correct
 * (see the bootstrap-visual-baseline CI job, which is how this normally
 * gets regenerated - baselines must come from the same environment that
 * checks them, not a developer's own machine, or font substitution alone
 * will produce false failures).
 */
const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const GAME_PATH = process.argv[2];
const UPDATE = process.argv.includes('--update');
const engineArg = process.argv.find(a => a.startsWith('--engines='));
const ENGINES = engineArg ? engineArg.split('=')[1].split(',') : ['chromium', 'firefox', 'webkit'];
const BASELINE_ROOT = path.join(__dirname, 'baseline');
const VIEWPORT = { width: 1280, height: 800 };
// Tolerance for incidental noise, not real regressions. Verified empirically:
// Chromium/WebKit stay under ~10px run-to-run; Firefox specifically runs the
// concurrency-limited sprite-load queue with slightly different real
// event-loop timing each run, which shifts exactly how many Math.random()
// calls have fired by the time a frame is drawn (star positions, rotated-
// square edge anti-aliasing) - confirmed by eye it's cosmetic jitter, not a
// structural difference, and it holds steady around ~2000px across many
// runs rather than growing unbounded. A REAL regression (verified by
// deliberately breaking the camera zoom) produced 141,000+ pixels - three
// orders of magnitude larger - so this tolerance still catches anything
// that actually matters.
const MAX_DIFF_PIXELS = 3000;

if (!GAME_PATH || !fs.existsSync(GAME_PATH)) {
    console.error('Usage: node visual-test.js "<path-to-index.html>" [--update] [--engines=chromium,firefox,webkit]');
    process.exit(1);
}

// A small, SOLID, fully-opaque placeholder image, served for every real
// sprite request so scenes never depend on network access or the actual art
// looking any particular way - we're checking OUR drawing code (position,
// size, layering, HP bars, colors we set), not whether GitHub's CDN is up.
// Deliberately opaque and brightly colored: a transparent placeholder would
// make every drawImage() call invisible, silently defeating the entire
// point of a visual test (found this the hard way - the first baseline
// looked like an empty starfield because a 1x1 transparent PNG made every
// planet/ship sprite render as nothing).
function makePlaceholderPng() {
    const size = 16;
    const png = new PNG({ width: size, height: size });
    for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = 255;     // R
        png.data[i + 1] = 0;   // G
        png.data[i + 2] = 255; // B
        png.data[i + 3] = 255; // A - fully opaque
    }
    return PNG.sync.write(png);
}
const PLACEHOLDER_PNG = makePlaceholderPng();

// Each scene: a name, and a function that drives the page (via page.evaluate
// calling the game's own real functions) into a specific, reproducible state
// before the screenshot is taken. Add more here as needed (e.g. a campaign
// stage in progress) - each one just needs a setup function that reaches a
// specific state via the game's own real functions.
const SCENES = [
    {
        name: 'country-select-screen',
        setup: async (page) => {
            await page.evaluate(() => {
                setDifficulty('normal');
                newGame();
                gameLoop();
            });
        },
    },
    {
        name: 'in-game-homeworld',
        setup: async (page) => {
            await page.evaluate(() => {
                setDifficulty('normal');
                newGame();
                startGame(0); // pick the first country (USA)
                closeVideo(); // skip the briefing video, actually enter play
            });
            // Sprite images (planets/ships) load asynchronously through a
            // concurrency-limited queue - wait for that to actually finish
            // before rendering the frame we're going to screenshot, or the
            // "baseline" would just be whatever happened to have loaded yet.
            await page.waitForFunction(() => spritesLoaded === true, { timeout: 15000 });
            await page.evaluate(() => gameLoop());
        },
    },
];

async function runForEngine(engineName) {
    const engine = playwright[engineName];
    const baselineDir = path.join(BASELINE_ROOT, engineName);
    fs.mkdirSync(baselineDir, { recursive: true });

    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    // Freeze time and randomness BEFORE any page script runs, so every draw
    // call that depends on Date.now()/Math.random() (idle pulses, starfield,
    // AI decisions during setup, etc.) produces the exact same output every
    // single run.
    await page.addInitScript(() => {
        const FIXED_TIME = 1735689600000; // arbitrary fixed instant
        Date.now = () => FIXED_TIME;
        performance.now = () => 0;
        let seed = 88675123;
        Math.random = () => {
            // xorshift32 - deterministic, same sequence every run as long as
            // call order is unchanged.
            seed ^= seed << 13; seed |= 0;
            seed ^= seed >>> 17;
            seed ^= seed << 5; seed |= 0;
            return ((seed >>> 0) / 4294967296);
        };
    });

    // Serve a fixed placeholder for every remote sprite/image request instead
    // of hitting the real network - keeps this test offline-safe and immune
    // to the actual art assets changing.
    await page.route('**://raw.githubusercontent.com/**', route => {
        route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER_PNG });
    });

    const absoluteGamePath = path.resolve(GAME_PATH);
    await page.goto('file:///' + absoluteGamePath.replace(/\\/g, '/'));

    const failures = [];
    let matched = 0;

    for (const scene of SCENES) {
        const label = `[${engineName}] ${scene.name}`;
        try {
            await scene.setup(page);
        } catch (e) {
            failures.push(`${label}: setup threw - ${e.message}`);
            continue;
        }

        const canvas = await page.$('#canvas');
        if (!canvas) {
            failures.push(`${label}: #canvas not found on page`);
            continue;
        }
        const screenshotBuf = await canvas.screenshot();

        const baselinePath = path.join(baselineDir, `${scene.name}.png`);
        if (UPDATE || !fs.existsSync(baselinePath)) {
            fs.writeFileSync(baselinePath, screenshotBuf);
            console.log(`  [${UPDATE ? 'updated' : 'created'} baseline] ${label}`);
            continue;
        }

        const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
        const actual = PNG.sync.read(screenshotBuf);
        if (baseline.width !== actual.width || baseline.height !== actual.height) {
            failures.push(`${label}: size changed (baseline ${baseline.width}x${baseline.height}, actual ${actual.width}x${actual.height})`);
            fs.writeFileSync(path.join(baselineDir, `${scene.name}-actual.png`), screenshotBuf);
            continue;
        }

        const diff = new PNG({ width: baseline.width, height: baseline.height });
        const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, baseline.width, baseline.height, { threshold: 0.1 });

        if (diffPixels > MAX_DIFF_PIXELS) {
            failures.push(`${label}: ${diffPixels} pixels differ from baseline (tolerance is ${MAX_DIFF_PIXELS})`);
            fs.writeFileSync(path.join(baselineDir, `${scene.name}-actual.png`), screenshotBuf);
            fs.writeFileSync(path.join(baselineDir, `${scene.name}-diff.png`), PNG.sync.write(diff));
        } else {
            console.log(`  [match] ${label} (${diffPixels} pixels within tolerance)`);
            matched++;
        }
    }

    await browser.close();
    return { engineName, matched, total: SCENES.length, failures };
}

async function run() {
    let allFailures = [];
    let totalMatched = 0, totalScenes = 0;

    for (const engineName of ENGINES) {
        if (!playwright[engineName]) {
            allFailures.push(`unknown engine "${engineName}" (expected chromium, firefox, or webkit)`);
            continue;
        }
        const result = await runForEngine(engineName);
        totalMatched += result.matched;
        totalScenes += result.total;
        allFailures.push(...result.failures);
    }

    console.log(`\n${'='.repeat(60)}`);
    if (allFailures.length === 0) {
        console.log(`VISUAL TEST RESULTS: ${totalMatched}/${totalScenes} scene(s) across ${ENGINES.length} engine(s), all matched.`);
        console.log('='.repeat(60));
        process.exit(0);
    } else {
        console.log(`VISUAL TEST RESULTS: ${allFailures.length} failure(s) across ${ENGINES.length} engine(s)`);
        console.log('='.repeat(60));
        allFailures.forEach(f => console.log(`  [FAIL] ${f}`));
        console.log('\nSee *-actual.png / *-diff.png next to the relevant baseline for what changed.');
        process.exit(1);
    }
}

run().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
