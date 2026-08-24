#!/usr/bin/env node
/**
 * After Earth — visual regression test
 * -------------------------------------
 * Unlike regression-test.js (which fakes the canvas out entirely so it can
 * check game LOGIC), this drives a real headless Chromium and takes an
 * actual screenshot of the canvas, then compares it pixel-by-pixel against
 * a committed reference image. This is what catches "it still works, but it
 * looks wrong" - a sprite that stopped drawing, a color that changed, a
 * layout that shifted.
 *
 * Time and randomness are frozen before the game script ever runs, so the
 * same scene renders byte-identical every time (no animation drift, no RNG).
 * Sprite images are intercepted and replaced with fixed local placeholders
 * so the test never depends on network access or an external image host
 * being reachable - it can only fail because of a real change in our own
 * code's output.
 *
 * Usage:
 *   node visual-test.js "<path-to-index.html>" [--update]
 *
 * Exits 0 if every scene matches its baseline, 1 if any differs (writing a
 * *-actual.png and *-diff.png next to the baseline so the difference is
 * visible). Pass --update to (re)write the baseline images instead of
 * comparing against them - only do this deliberately, after confirming by
 * eye that the new screenshot is actually correct.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const GAME_PATH = process.argv[2];
const UPDATE = process.argv.includes('--update');
const BASELINE_DIR = path.join(__dirname, 'baseline');
const VIEWPORT = { width: 1280, height: 800 };
const MAX_DIFF_PIXELS = 25; // small tolerance for incidental sub-pixel font/AA noise

if (!GAME_PATH || !fs.existsSync(GAME_PATH)) {
    console.error('Usage: node visual-test.js "<path-to-index.html>" [--update]');
    process.exit(1);
}
fs.mkdirSync(BASELINE_DIR, { recursive: true });

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
// before the screenshot is taken.
// Start with one scene proving the mechanism end-to-end; add more here as
// needed (e.g. a campaign stage in progress) - each one just needs a setup
// function that reaches a specific state via the game's own real functions.
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

async function run() {
    const browser = await chromium.launch();
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

    let failures = [];

    for (const scene of SCENES) {
        try {
            await scene.setup(page);
        } catch (e) {
            failures.push(`${scene.name}: setup threw - ${e.message}`);
            continue;
        }

        const canvas = await page.$('#canvas');
        if (!canvas) {
            failures.push(`${scene.name}: #canvas not found on page`);
            continue;
        }
        const screenshotBuf = await canvas.screenshot();

        const baselinePath = path.join(BASELINE_DIR, `${scene.name}.png`);
        if (UPDATE || !fs.existsSync(baselinePath)) {
            fs.writeFileSync(baselinePath, screenshotBuf);
            console.log(`  [${UPDATE ? 'updated' : 'created'} baseline] ${scene.name}.png`);
            continue;
        }

        const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
        const actual = PNG.sync.read(screenshotBuf);
        if (baseline.width !== actual.width || baseline.height !== actual.height) {
            failures.push(`${scene.name}: size changed (baseline ${baseline.width}x${baseline.height}, actual ${actual.width}x${actual.height})`);
            fs.writeFileSync(path.join(BASELINE_DIR, `${scene.name}-actual.png`), screenshotBuf);
            continue;
        }

        const diff = new PNG({ width: baseline.width, height: baseline.height });
        const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, baseline.width, baseline.height, { threshold: 0.1 });

        if (diffPixels > MAX_DIFF_PIXELS) {
            failures.push(`${scene.name}: ${diffPixels} pixels differ from baseline (tolerance is ${MAX_DIFF_PIXELS})`);
            fs.writeFileSync(path.join(BASELINE_DIR, `${scene.name}-actual.png`), screenshotBuf);
            fs.writeFileSync(path.join(BASELINE_DIR, `${scene.name}-diff.png`), PNG.sync.write(diff));
        } else {
            console.log(`  [match] ${scene.name}.png (${diffPixels} pixels within tolerance)`);
        }
    }

    await browser.close();

    console.log(`\n${'='.repeat(60)}`);
    if (failures.length === 0) {
        console.log(`VISUAL TEST RESULTS: ${SCENES.length} scene(s), all matched.`);
        console.log('='.repeat(60));
        process.exit(0);
    } else {
        console.log(`VISUAL TEST RESULTS: ${failures.length}/${SCENES.length} scene(s) FAILED`);
        console.log('='.repeat(60));
        failures.forEach(f => console.log(`  [FAIL] ${f}`));
        console.log('\nSee *-actual.png / *-diff.png next to the baseline for what changed.');
        process.exit(1);
    }
}

run().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
