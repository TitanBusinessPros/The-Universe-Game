#!/usr/bin/env node
/**
 * After Earth — interaction regression test
 * -------------------------------------------
 * Everything in regression-test.js and visual-test.js drives the game by
 * calling its own JS functions directly (page.evaluate). Neither one ever
 * actually moves a mouse - so a bug that only shows up through a real
 * click/drag (a broken hit-test, an event listener that stopped firing, a
 * coordinate-math mistake) could pass every other check and still be
 * broken for an actual player.
 *
 * This drives real synthetic mouse events (via Playwright's page.mouse)
 * against the rendered canvas, exactly like a player's browser would
 * dispatch them, and asserts on the resulting game state - not pixels, so
 * this doesn't need frozen time/RNG or cross-engine baselines the way the
 * visual suite does.
 *
 * Usage:
 *   node interaction-test.js "<path-to-index.html>" [--engines=chromium,firefox,webkit]
 */
const fs = require('fs');
const path = require('path');
const playwright = require('playwright');

const GAME_PATH = process.argv[2];
const engineArg = process.argv.find(a => a.startsWith('--engines='));
const ENGINES = engineArg ? engineArg.split('=')[1].split(',') : ['chromium'];
const VIEWPORT = { width: 1280, height: 800 };
const PLACEHOLDER_PNG = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6360000002000155009fe95d0000000049454e44ae426082',
    'hex'
);

if (!GAME_PATH || !fs.existsSync(GAME_PATH)) {
    console.error('Usage: node interaction-test.js "<path-to-index.html>" [--engines=chromium,firefox,webkit]');
    process.exit(1);
}

let failures = [];
let passes = 0;

function check(name, condition, detail) {
    if (condition) {
        passes++;
    } else {
        failures.push(`${name}${detail ? ' - ' + detail : ''}`);
    }
}

// World -> screen conversion, matching the game's own formula exactly
// (see the canvas 'click'/'mousedown' handlers in index.html):
//   screenX = (worldX - camera.x) * zoom + canvas.width / 2
function worldToScreen(world, camera, canvasSize) {
    return {
        x: (world.x - camera.x) * camera.zoom + canvasSize.width / 2,
        y: (world.y - camera.y) * camera.zoom + canvasSize.height / 2,
    };
}

async function setupGame(page) {
    await page.evaluate(() => {
        setDifficulty('normal');
        newGame();
        startGame(0);
        closeVideo();
    });
    await page.waitForFunction(() => spritesLoaded === true, { timeout: 15000 });
    // A controllable unit at a known, fixed offset from the player's
    // homeworld, so every interaction below has a real target to hit
    // without depending on whatever the AI/economy happened to build.
    await page.evaluate(() => {
        const u = new Unit(gameState.playerCountry.island.x + 400, gameState.playerCountry.island.y, 'stormbreaker', gameState.playerCountry.id);
        gameState.playerCountry.units.push(u);
        gameLoop();
    });
}

async function getCanvasGeometry(page) {
    return page.evaluate(() => ({
        camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
        canvasSize: { width: canvas.width, height: canvas.height },
    }));
}

async function runForEngine(engineName) {
    const engine = playwright[engineName];
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    await page.route('**://raw.githubusercontent.com/**', route => {
        route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER_PNG });
    });

    const absoluteGamePath = path.resolve(GAME_PATH);
    await page.goto('file:///' + absoluteGamePath.replace(/\\/g, '/'));

    const tag = (name) => `[${engineName}] ${name}`;

    // ---- Scenario 1: drag-select a box over a unit selects it ----
    // (a plain zero-movement click does NOT select on this game's own
    // control scheme - see the on-screen "Click+Drag to select multiple"
    // instructions - so this has to be a real drag, not a click.)
    await setupGame(page);
    let geo = await getCanvasGeometry(page);
    const unitWorld = { x: geo.camera.x + 400, y: geo.camera.y };
    const unitScreen = worldToScreen(unitWorld, geo.camera, geo.canvasSize);

    await page.mouse.move(unitScreen.x - 40, unitScreen.y - 40);
    await page.mouse.down();
    await page.mouse.move(unitScreen.x + 40, unitScreen.y + 40, { steps: 5 });
    await page.mouse.up();

    let selectedCount = await page.evaluate(() => gameState.selectedUnits.length);
    check(tag('drag-select box over a unit selects it'), selectedCount === 1, `selectedUnits.length = ${selectedCount}`);

    // ---- Scenario 2: clicking empty space with a unit selected issues a move order ----
    const moveTargetWorld = { x: geo.camera.x + 1000, y: geo.camera.y + 500 };
    const moveTargetScreen = worldToScreen(moveTargetWorld, geo.camera, geo.canvasSize);
    await page.mouse.click(moveTargetScreen.x, moveTargetScreen.y);

    const unitOrder = await page.evaluate(() => {
        const u = gameState.playerCountry.units.find(u => u.type === 'stormbreaker');
        return u ? { targetX: u.targetX, targetY: u.targetY, selectedAfter: gameState.selectedUnits.length } : null;
    });
    check(
        tag('click-to-move sends the unit toward the clicked world position'),
        unitOrder && Math.abs(unitOrder.targetX - moveTargetWorld.x) < 50 && Math.abs(unitOrder.targetY - moveTargetWorld.y) < 50,
        unitOrder ? `targetX=${Math.round(unitOrder.targetX)}, targetY=${Math.round(unitOrder.targetY)}, expected near (${moveTargetWorld.x}, ${moveTargetWorld.y})` : 'unit not found'
    );
    check(tag('move order deselects the unit afterward'), unitOrder && unitOrder.selectedAfter === 0, unitOrder ? `selectedUnits.length = ${unitOrder.selectedAfter}` : '');

    // ---- Scenario 3: right-click drag pans the camera ----
    const beforePan = await getCanvasGeometry(page);
    const dragStart = { x: 600, y: 400 };
    const dragDelta = { x: -150, y: 80 };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(dragStart.x + dragDelta.x, dragStart.y + dragDelta.y, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    const afterPan = await getCanvasGeometry(page);

    // Matches the game's own pan formula: camera.x -= dx / zoom
    const expectedCameraX = beforePan.camera.x - dragDelta.x / beforePan.camera.zoom;
    const expectedCameraY = beforePan.camera.y - dragDelta.y / beforePan.camera.zoom;
    check(
        tag('right-click drag pans the camera'),
        Math.abs(afterPan.camera.x - expectedCameraX) < 5 && Math.abs(afterPan.camera.y - expectedCameraY) < 5,
        `camera moved to (${Math.round(afterPan.camera.x)}, ${Math.round(afterPan.camera.y)}), expected near (${Math.round(expectedCameraX)}, ${Math.round(expectedCameraY)})`
    );

    // ---- Scenario 4: a plain right-click (no drag) deselects ----
    // The unit has been moving in real time (the game's own requestAnimationFrame
    // loop keeps running between our scripted actions, same as it would for an
    // actual player) since it was sent toward its scenario-2 destination, so
    // its screen position has to be read fresh here, not assumed from where it
    // originally spawned.
    geo = await getCanvasGeometry(page);
    const unitNowWorld = await page.evaluate(() => {
        const u = gameState.playerCountry.units.find(u => u.type === 'stormbreaker');
        return { x: u.x, y: u.y };
    });
    const unitScreen2 = worldToScreen(unitNowWorld, geo.camera, geo.canvasSize);
    // Re-select via drag first (scenario 2 left nothing selected).
    await page.mouse.move(unitScreen2.x - 40, unitScreen2.y - 40);
    await page.mouse.down();
    await page.mouse.move(unitScreen2.x + 40, unitScreen2.y + 40, { steps: 5 });
    await page.mouse.up();
    const selectedBeforeRightClick = await page.evaluate(() => gameState.selectedUnits.length);

    await page.mouse.click(unitScreen2.x, unitScreen2.y, { button: 'right' });
    const selectedAfterRightClick = await page.evaluate(() => gameState.selectedUnits.length);
    check(
        tag('plain right-click (no drag) deselects'),
        selectedBeforeRightClick > 0 && selectedAfterRightClick === 0,
        `selected before=${selectedBeforeRightClick}, after=${selectedAfterRightClick}`
    );

    await browser.close();
}

async function run() {
    for (const engineName of ENGINES) {
        if (!playwright[engineName]) {
            failures.push(`unknown engine "${engineName}" (expected chromium, firefox, or webkit)`);
            continue;
        }
        await runForEngine(engineName);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`INTERACTION TEST RESULTS: ${passes} passed, ${failures.length} failed`);
    console.log('='.repeat(60));
    if (failures.length === 0) {
        console.log('✅ All checks passed.\n');
        process.exit(0);
    } else {
        console.log('❌ FAILURES:\n');
        failures.forEach(f => console.log(`  [FAIL] ${f}`));
        process.exit(1);
    }
}

run().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
