#!/usr/bin/env node
/**
 * After Earth — resource deposit ("Bloodgold mine") on-screen visibility test
 * -----------------------------------------------------------------------------
 * Regression test for a real bug (2026-08-29): ResourceDeposit.draw() (and
 * SpaceMine.draw()/Missile.draw()) each compute their own world-to-screen
 * conversion internally (screenX = (this.x - camera.x) * camera.zoom + ...),
 * but gameLoop() was calling them BEFORE ctx.restore() - while the
 * translate/scale/translate world-to-screen transform established at the top
 * of gameLoop() was still active. That silently double-applies the
 * conversion, sending every deposit thousands of pixels off-canvas on every
 * single frame. No exception, no console error - just permanently invisible,
 * regardless of whether its art has finished loading.
 *
 * This test doesn't guess by eye or rely on a pixel-color screenshot diff
 * (which would either need real network image timing to settle, or fight
 * canvas cross-origin tainting when reading pixels back). Instead it uses
 * the exact technique that originally proved the bug: patch
 * CanvasRenderingContext2D's arc()/drawImage() to capture the LIVE transform
 * matrix (ctx.getTransform()) at the moment the deposit's own draw() call
 * fires, and compute where that call ACTUALLY lands on the canvas. If that
 * final position falls outside the canvas bounds, the deposit is
 * definitively not visible - this is true the instant gameLoop() starts
 * running, independent of whether the real sprite image has finished
 * downloading yet, so the test stays fast and non-flaky while still running
 * the real, unmocked, un-shortcut game exactly as shipped.
 *
 * A real screenshot is always saved next to this file on failure, as a
 * human-checkable CI artifact (see the workflow's "upload-artifact" step).
 *
 * Usage:
 *   node deposit-visibility-test.js "<path-to-index.html>"
 *
 * Exits 0 if the deposit's actual final canvas position is on-screen, 1
 * otherwise (with a screenshot saved and a printed reason).
 */
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const GAME_PATH = process.argv[2];
if (!GAME_PATH) {
    console.error('Usage: node deposit-visibility-test.js "<path-to-index.html>"');
    process.exit(1);
}

const VIEWPORT = { width: 1280, height: 800 };
const SCREENSHOT_PATH = path.join(__dirname, 'deposit-visibility-failure.png');
const CAPTURE_TIMEOUT_MS = 30000; // generous - covers the game's own 20s loading-gate cap

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('dialog', d => d.dismiss());

    // Patch arc()/drawImage() BEFORE any page script runs, so it's active for
    // the very first real gameLoop() frame - no dependency on image load timing.
    await page.addInitScript(() => {
        window.__capturedDrawCall = null;
        const patch = (methodName) => {
            const orig = CanvasRenderingContext2D.prototype[methodName];
            CanvasRenderingContext2D.prototype[methodName] = function (...args) {
                if (window.__capturedDrawCall === null && window.__depositBeingDrawn) {
                    const m = this.getTransform();
                    const x = args[0], y = args[1];
                    window.__capturedDrawCall = {
                        method: methodName,
                        // Apply the LIVE matrix by hand, exactly like the browser
                        // itself does, to get the true final canvas pixel position.
                        finalX: m.a * x + m.c * y + m.e,
                        finalY: m.b * x + m.d * y + m.f,
                    };
                }
                return orig.apply(this, args);
            };
        };
        patch('arc');       // the fallback gold-circle path
        patch('drawImage'); // the real sprite path
    });

    const absoluteGamePath = path.resolve(GAME_PATH);
    await page.goto(pathToFileURL(absoluteGamePath).href, { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
        setDifficulty('normal');
        startGame(0);
        closeVideo();
    });

    // Wrap the target deposit's OWN draw() so the capture above knows exactly
    // which arc()/drawImage() call is the deposit's, distinguishing it from
    // every other object gameLoop() also draws in the same frame.
    await page.evaluate(() => {
        const dep = resourceDeposits[0];
        const origDraw = dep.draw.bind(dep);
        dep.draw = function () {
            window.__depositBeingDrawn = true;
            origDraw();
            window.__depositBeingDrawn = false;
        };
    });

    // Let real animation frames run until the wrapped draw() actually fires -
    // needs no network completion, just gameLoop() ticking, which starts the
    // instant whenImagesReady() releases (worst case ~20s, see index.html).
    await page.waitForFunction(() => window.__capturedDrawCall !== null, { timeout: CAPTURE_TIMEOUT_MS }).catch(() => {});

    const result = await page.evaluate(() => ({
        captured: window.__capturedDrawCall,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
    }));

    let pass = false;
    let reason;
    if (!result.captured) {
        reason = 'never captured a draw() call for the deposit within the timeout - draw() may not be running at all';
    } else {
        const { finalX, finalY, method } = result.captured;
        // Small margin so a sprite/circle merely straddling the very edge isn't
        // flagged - this is about "thousands of pixels off-canvas", not pixel-perfect framing.
        const onScreen = finalX >= -50 && finalX <= result.canvasWidth + 50 && finalY >= -50 && finalY <= result.canvasHeight + 50;
        pass = onScreen;
        reason = `deposit's ${method}() call actually lands at (${finalX.toFixed(0)}, ${finalY.toFixed(0)}) on a ${result.canvasWidth}x${result.canvasHeight} canvas`;
    }

    if (!pass) {
        await page.screenshot({ path: SCREENSHOT_PATH });
        console.error(`[FAIL] ResourceDeposit is not visible on screen: ${reason}`);
        console.error(`Screenshot saved to ${SCREENSHOT_PATH}`);
        await browser.close();
        process.exit(1);
    }

    console.log(`[PASS] ResourceDeposit renders on-screen: ${reason}`);
    await browser.close();
    process.exit(0);
})();
