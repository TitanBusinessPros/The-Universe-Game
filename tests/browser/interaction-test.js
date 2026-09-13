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
const os = require('os');
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
// That "screenX" is canvas-relative (the game itself immediately undoes
// getBoundingClientRect() to get it from the real event's clientX) - so it
// has to be shifted by the canvas's own on-page offset (rect.left/top,
// normally 0 but not guaranteed identical across engines/platforms) before
// it's a valid clientX/clientY to hand to page.mouse.*/synthetic touch
// events, which operate in viewport space, not canvas space.
function worldToScreen(world, camera, canvasSize, rect = { left: 0, top: 0 }) {
    return {
        x: (world.x - camera.x) * camera.zoom + canvasSize.width / 2 + rect.left,
        y: (world.y - camera.y) * camera.zoom + canvasSize.height / 2 + rect.top,
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
    return page.evaluate(() => {
        const r = canvas.getBoundingClientRect();
        return {
            camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
            canvasSize: { width: canvas.width, height: canvas.height },
            rect: { left: r.left, top: r.top },
        };
    });
}

async function runForEngine(engineName) {
    const engine = playwright[engineName];
    const browser = await engine.launch();
    // hasTouch is deliberately NOT set on this context - it's only needed by
    // the dedicated touch-gesture context created further down for scenarios
    // 7-9, and turning it on here as well was observed to make WebKit's
    // handling of plain page.mouse.click() unreliable (a real CI failure:
    // scenario 0 intermittently saw selectedUnits.length stay 0 on WebKit
    // once hasTouch was enabled on this shared context, despite passing
    // consistently locally) - keeping the two input models on separate
    // contexts avoids that cross-contamination entirely.
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    await page.route('**://raw.githubusercontent.com/**', route => {
        route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER_PNG });
    });
    // saveGame()/loadGame() both alert() on success/failure - accept those so
    // they never block the test. Leave confirm()/prompt() alone (dismiss, same
    // as Playwright's own default with no handler at all) - newGame() uses a
    // confirm() that setupGame() below relies on being dismissed (no reload);
    // auto-accepting every dialog indiscriminately turned that into a real
    // page reload mid-setup and broke every scenario - caught by running this
    // suite locally before it ever reached CI.
    page.on('dialog', d => { if (d.type() === 'alert') d.accept(); else d.dismiss(); });

    const absoluteGamePath = path.resolve(GAME_PATH);
    await page.goto('file:///' + absoluteGamePath.replace(/\\/g, '/'));

    const tag = (name) => `[${engineName}] ${name}`;

    await setupGame(page);
    // WebKit-specific warm-up: confirmed via CI diagnostics that on a freshly
    // loaded page, WebKit's very first synthetic mouse click never dispatches
    // a 'click' DOM event at all (every click after the first works fine,
    // including in the same run) - an established-mouse-device quirk, not a
    // game bug. One throwaway move+click off in empty space (nothing there to
    // react to it) is enough to warm it up before the real scenario below.
    await page.mouse.move(5, 5);
    await page.mouse.click(5, 5);

    let geo = await getCanvasGeometry(page);
    const unitWorld = { x: geo.camera.x + 400, y: geo.camera.y };
    const unitScreen = worldToScreen(unitWorld, geo.camera, geo.canvasSize, geo.rect);

    // ---- Scenario 0: a plain tap/click directly on your own unit selects it ----
    // Direct report: "I can't press on a ship after building it and click on
    // another part of the map to send it" - a plain zero-movement click used to
    // do nothing but update the hover inspector; only a real click-drag marquee
    // (scenario 1 below) could select. Now a plain click on the unit itself
    // selects it too, exactly like tapping it on a phone would.
    await page.mouse.click(unitScreen.x, unitScreen.y);
    let tapSelectedCount = await page.evaluate(() => gameState.selectedUnits.length);
    check(tag('a plain click directly on your own unit selects it'), tapSelectedCount === 1, `selectedUnits.length = ${tapSelectedCount}`);
    // Back to a clean slate before the drag-select scenario below.
    await page.mouse.click(unitScreen.x, unitScreen.y, { button: 'right' });

    // ---- Scenario 1: drag-select a box over a unit selects it ----
    await page.mouse.move(unitScreen.x - 40, unitScreen.y - 40);
    await page.mouse.down();
    await page.mouse.move(unitScreen.x + 40, unitScreen.y + 40, { steps: 5 });
    await page.mouse.up();

    let selectedCount = await page.evaluate(() => gameState.selectedUnits.length);
    check(tag('drag-select box over a unit selects it'), selectedCount === 1, `selectedUnits.length = ${selectedCount}`);

    // ---- Scenario 2: clicking empty space with a unit selected issues a move order ----
    const moveTargetWorld = { x: geo.camera.x + 1000, y: geo.camera.y + 500 };
    const moveTargetScreen = worldToScreen(moveTargetWorld, geo.camera, geo.canvasSize, geo.rect);
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
    const unitScreen2 = worldToScreen(unitNowWorld, geo.camera, geo.canvasSize, geo.rect);
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

    // ---- Scenario 4b: clicking to attack while paused does nothing ----
    // Direct report: "the pause button only pauses the timer and not the
    // game functions" - the canvas's own smart-click attack path applied
    // damage directly, completely bypassing gameState.paused (only the
    // MOVE/ATTACK buttons' setActionMode() checked it, and only regression-
    // test.js covers that one directly - this is the other real gap, and it
    // needs a real click on the actual canvas to prove).
    const pauseScenario = await page.evaluate(() => {
        const mine = new Unit(camera.x + 200, camera.y, 'stormbreaker', gameState.playerCountry.id);
        gameState.playerCountry.units.push(mine);
        const enemyCountry = gameState.countries.find(c => c.id !== gameState.playerCountry.id);
        const target = new Unit(mine.x + 10, mine.y, 'stormbreaker', enemyCountry.id);
        enemyCountry.units.push(target);
        selectUnit(mine);
        togglePause();
        return { mineWorld: { x: mine.x, y: mine.y }, targetWorld: { x: target.x, y: target.y }, hpBefore: target.hp, paused: gameState.paused };
    });
    geo = await getCanvasGeometry(page);
    const pausedTargetScreen = worldToScreen(pauseScenario.targetWorld, geo.camera, geo.canvasSize, geo.rect);
    await page.mouse.click(pausedTargetScreen.x, pausedTargetScreen.y);
    const afterPausedClick = await page.evaluate(() => {
        const enemyCountry = gameState.countries.find(c => c.id !== gameState.playerCountry.id);
        const target = enemyCountry.units[enemyCountry.units.length - 1];
        return { hp: target.hp, selected: gameState.selectedUnits.length };
    });
    check(
        tag('clicking to attack an enemy unit while paused does not damage it'),
        pauseScenario.paused && afterPausedClick.hp === pauseScenario.hpBefore,
        `paused=${pauseScenario.paused}, hp before=${pauseScenario.hpBefore}, hp after click=${afterPausedClick.hp}`
    );
    await page.evaluate(() => { togglePause(); }); // unpause so later scenarios aren't affected

    // ---- Scenario 4c: placing a Defense Cannon while paused does nothing ----
    // Direct report (repeated): "the pause button... does not pause actual
    // game" - initiateCannonPlacement() (the build button) already refuses to
    // ARM placeCannon mode while paused, but if it was armed BEFORE the
    // player paused, the actual placement click (spends resources, creates
    // the cannon) had no pause check of its own - a real gap distinct from
    // scenario 4b's move/attack path, needing its own real click to prove.
    const cannonPauseScenario = await page.evaluate(() => {
        gameState.playerCountry.resources = 1000;
        initiateCannonPlacement();
        togglePause();
        return {
            armed: gameState.actionMode === 'placeCannon',
            paused: gameState.paused,
            resourcesBefore: gameState.playerCountry.resources,
            unitCountBefore: gameState.playerCountry.units.length,
            homeWorld: { x: gameState.playerCountry.island.x, y: gameState.playerCountry.island.y },
        };
    });
    geo = await getCanvasGeometry(page);
    const cannonSpot = worldToScreen(
        { x: cannonPauseScenario.homeWorld.x + 200, y: cannonPauseScenario.homeWorld.y },
        geo.camera, geo.canvasSize, geo.rect
    );
    await page.mouse.click(cannonSpot.x, cannonSpot.y);
    const afterCannonClick = await page.evaluate(() => ({
        resources: gameState.playerCountry.resources,
        unitCount: gameState.playerCountry.units.length,
    }));
    check(
        tag('clicking to place a Defense Cannon while paused does not spend resources or create it'),
        cannonPauseScenario.armed && cannonPauseScenario.paused
            && afterCannonClick.resources === cannonPauseScenario.resourcesBefore
            && afterCannonClick.unitCount === cannonPauseScenario.unitCountBefore,
        `armed=${cannonPauseScenario.armed}, paused=${cannonPauseScenario.paused}, resources ${cannonPauseScenario.resourcesBefore} -> ${afterCannonClick.resources}, units ${cannonPauseScenario.unitCountBefore} -> ${afterCannonClick.unitCount}`
    );
    await page.evaluate(() => { togglePause(); cancelAction(); }); // unpause and clear the still-armed mode for later scenarios

    // ---- Scenario 5: Save to File downloads a real file matching live state ----
    // Exercises the actual button (Blob, object URL, synthetic <a download>
    // click) - not just buildSaveData() underneath it, which regression-test.js
    // already covers directly.
    const liveTurnBeforeSave = await page.evaluate(() => gameState.turn);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.evaluate(() => document.querySelector('button[onclick="saveGame()"]').click()),
    ]);
    const savedFilePath = await download.path();
    let saveJson = null;
    let saveJsonError = null;
    try { saveJson = JSON.parse(fs.readFileSync(savedFilePath, 'utf8')); } catch (e) { saveJsonError = e.message; }
    check(
        tag('Save to File downloads valid JSON matching the live turn number'),
        saveJson && saveJson.turn === liveTurnBeforeSave,
        saveJsonError || `save turn=${saveJson && saveJson.turn}, live turn=${liveTurnBeforeSave}`
    );
    const expectedFilename = `universe_game_save_turn${liveTurnBeforeSave}.json`;
    check(
        tag('the downloaded filename encodes the turn number'),
        download.suggestedFilename() === expectedFilename,
        `got "${download.suggestedFilename()}", expected "${expectedFilename}"`
    );

    // ---- Scenario 6: Load From File actually restores state from the chosen file ----
    // Exercises the real native file-picker path (input[type=file] + FileReader),
    // not applySaveData() directly (also already covered by regression-test.js).
    let loadScenarioOk = true;
    let loadScenarioDetail = '';
    if (saveJson) {
        const tmpSavePath = path.join(os.tmpdir(), `ae-interaction-test-save-${Date.now()}.json`);
        const distinctTurn = liveTurnBeforeSave + 500; // clearly not whatever's already live
        fs.writeFileSync(tmpSavePath, JSON.stringify({ ...saveJson, turn: distinctTurn }));
        try {
            const [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser'),
                page.evaluate(() => document.querySelector('button[onclick="loadGame()"]').click()),
            ]);
            await fileChooser.setFiles(tmpSavePath);
            await page.waitForFunction((expected) => gameState.turn === expected, distinctTurn, { timeout: 10000 });
            const turnAfterLoad = await page.evaluate(() => gameState.turn);
            loadScenarioOk = turnAfterLoad === distinctTurn;
            loadScenarioDetail = `turn after load = ${turnAfterLoad}, expected ${distinctTurn}`;
        } catch (e) {
            loadScenarioOk = false;
            loadScenarioDetail = e.message;
        } finally {
            fs.unlinkSync(tmpSavePath);
        }
    } else {
        loadScenarioOk = false;
        loadScenarioDetail = 'skipped - no valid save from the previous scenario to load back in';
    }
    check(tag('Load From File restores game state from the chosen file'), loadScenarioOk, loadScenarioDetail);

    // ---- Scenario 6b: EXIT button asks for confirmation before leaving ----
    // Direct request: "put a safety button on mobile and desktop that asks
    // the user if they really want to exit... when someone accidentally
    // goes out of the game." Distinct from the 'beforeunload' prompt tested
    // in regression-test.js - that one only fires on a browser-level tab
    // close/refresh/navigation (and is inconsistent on mobile by design of
    // the platform, per its own comment in index.html); this is a real,
    // always-visible in-game button (#controls) with its own explicit
    // confirm(), reachable identically on desktop and mobile since it's a
    // plain click/tap target, not touch-gesture-specific. Placed here (using
    // the mouse-based `page`/`context`, before either is closed) rather than
    // after the touch-gesture section below, so it still runs on every
    // engine even where WebKit's lack of constructible Touch/TouchEvent
    // skips that section entirely.
    // The blanket "accept alerts / dismiss everything else" handler
    // registered at the top of this function is still attached - remove it
    // first so it can't race the once() handlers below on the same dialog
    // (both trying to resolve it throws "already handled").
    page.removeAllListeners('dialog');
    const turnBeforeExitAttempt = await page.evaluate(() => gameState.turn);
    let exitDialogMessage = null;
    page.once('dialog', d => { exitDialogMessage = d.message(); d.dismiss(); }); // simulate tapping Cancel
    await page.evaluate(() => document.getElementById('exitGameBtn').click());
    await page.waitForTimeout(100);
    check(
        tag('EXIT button shows a confirmation dialog before doing anything'),
        typeof exitDialogMessage === 'string' && /sure you want to exit/i.test(exitDialogMessage),
        `dialog message: ${JSON.stringify(exitDialogMessage)}`
    );
    const turnAfterDismiss = await page.evaluate(() => gameState.turn);
    check(
        tag('dismissing the EXIT confirmation leaves the match running, untouched'),
        turnAfterDismiss === turnBeforeExitAttempt,
        `turn before=${turnBeforeExitAttempt}, turn after dismiss=${turnAfterDismiss}`
    );

    page.once('dialog', d => d.accept()); // simulate tapping OK
    await page.evaluate(() => document.getElementById('exitGameBtn').click());
    // Checking for the real observable outcome (back at the start screen)
    // rather than the 'load' event itself - confirmed flaky on WebKit,
    // where a file:// location.reload() doesn't reliably fire a 'load'
    // event Playwright's listener catches in time, even though the actual
    // navigation/reload does happen.
    let reachedStartScreen = false;
    try {
        await page.waitForFunction(() => {
            const el = document.getElementById('startScreen');
            return !!el && getComputedStyle(el).display !== 'none';
        }, { timeout: 8000 });
        reachedStartScreen = true;
    } catch (e) { /* checked via the flag below */ }
    check(
        tag('confirming the EXIT dialog actually leaves the match (reloads back to the start screen)'),
        reachedStartScreen,
        `start screen visible after confirmed exit: ${reachedStartScreen}`
    );

    await context.close();

    // ---- Mobile touch scenarios ----
    // Deliberately a brand-new browser context (and fresh game session) with
    // hasTouch:true, rather than reusing the context above - hasTouch is
    // required for the real Touch/TouchEvent constructors these scenarios
    // rely on, but was observed to make WebKit's handling of plain
    // page.mouse.click() unreliable (a real CI failure on scenario 0) when
    // turned on for the same context as the mouse-based scenarios above.
    // Keeping the two input models fully isolated avoids that entirely.
    //
    // Real Touch/TouchEvent objects are dispatched at the canvas, exactly
    // like a phone browser would deliver them - not mouse events with a
    // "touch" label. Each one is classified by the game's own
    // touchstart/touchmove/touchend handlers (index.html), which then
    // replay it as a synthetic MouseEvent via dispatchSyntheticMouseEvent()
    // into the exact same mousedown/mousemove/mouseup/click logic scenarios
    // 0-4 above already exercise directly - so what's actually new here is
    // proving the GESTURE CLASSIFICATION itself (tap vs. immediate-drag-pan
    // vs. long-press-then-drag-select), not re-testing the underlying
    // click/drag behavior twice.
    const touchContext = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
    const touchPage = await touchContext.newPage();
    await touchPage.route('**://raw.githubusercontent.com/**', route => {
        route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER_PNG });
    });
    touchPage.on('dialog', d => { if (d.type() === 'alert') d.accept(); else d.dismiss(); });
    await touchPage.goto('file:///' + absoluteGamePath.replace(/\\/g, '/'));
    await setupGame(touchPage);

    // WebKit's actual Safari never implemented the spec's constructible
    // Touch/TouchEvent (`new Touch(...)`/`new TouchEvent(...)` both throw
    // "Illegal constructor") - a genuine, documented engine gap, not a game
    // bug, and not fixable from here. Real hardware touch input on an iPhone
    // still works fine (WebKit still dispatches real TouchEvent objects it
    // builds internally) - it's only synthesizing one from script for a test
    // that's unsupported. So these gesture-classification scenarios below
    // run on chromium/firefox (both fully support construction) and are
    // skipped with a clear reason on webkit rather than failing on a tooling
    // limitation that has nothing to do with index.html's own code.
    const canConstructTouchEvents = await touchPage.evaluate(() => {
        try {
            const t = new Touch({ identifier: 1, target: canvas, clientX: 0, clientY: 0 });
            new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t] });
            return true;
        } catch (e) {
            return false;
        }
    });

    if (!canConstructTouchEvents) {
        check(tag('mobile touch gesture scenarios (skipped - this engine does not support constructing synthetic Touch/TouchEvent from script)'), true);
        await browser.close();
        return;
    }

    await touchPage.evaluate(() => {
        function fireTouch(type, x, y) {
            const touch = new Touch({
                identifier: 1, target: canvas, clientX: x, clientY: y,
                pageX: x, pageY: y, screenX: x, screenY: y,
                radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
            });
            const list = type === 'touchend' || type === 'touchcancel' ? [] : [touch];
            canvas.dispatchEvent(new TouchEvent(type, {
                touches: list, targetTouches: list, changedTouches: [touch],
                bubbles: true, cancelable: true, view: window,
            }));
        }
        window.__fireTouch = fireTouch;

        // Multi-touch variant for pinch-zoom: `points` is an array of
        // {x, y} - one Touch per finger, all reported in the event's
        // `touches`/`targetTouches` (an empty array for touchend/touchcancel,
        // matching a real lifted-finger event).
        function fireTouchMulti(type, points) {
            const touches = points.map((p, i) => new Touch({
                identifier: i, target: canvas, clientX: p.x, clientY: p.y,
                pageX: p.x, pageY: p.y, screenX: p.x, screenY: p.y,
                radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
            }));
            const list = type === 'touchend' || type === 'touchcancel' ? [] : touches;
            canvas.dispatchEvent(new TouchEvent(type, {
                touches: list, targetTouches: list, changedTouches: touches,
                bubbles: true, cancelable: true, view: window,
            }));
        }
        window.__fireTouchMulti = fireTouchMulti;
    });

    let touchGeo = await getCanvasGeometry(touchPage);
    const touchUnitWorld = { x: touchGeo.camera.x + 400, y: touchGeo.camera.y };
    const touchUnitScreen = worldToScreen(touchUnitWorld, touchGeo.camera, touchGeo.canvasSize, touchGeo.rect);

    // ---- Scenario 7: a quick tap (no hold, no drag) on your own unit selects it ----
    await touchPage.evaluate(({ x, y }) => {
        window.__fireTouch('touchstart', x, y);
        window.__fireTouch('touchend', x, y);
    }, { x: touchUnitScreen.x, y: touchUnitScreen.y });
    const touchTapSelectedCount = await touchPage.evaluate(() => gameState.selectedUnits.length);
    check(tag('a quick tap directly on your own unit selects it (touch)'), touchTapSelectedCount === 1, `selectedUnits.length = ${touchTapSelectedCount}`);
    // Clean slate (a real right-click has no touch equivalent, so deselect via the API directly).
    await touchPage.evaluate(() => deselectAllUnits());

    // ---- Scenario 8: pressing and dragging RIGHT AWAY (no hold) pans the camera ----
    const touchPanStart = { x: 500, y: 400 };
    const touchPanDelta = { x: -120, y: 60 };
    const beforeTouchPan = await getCanvasGeometry(touchPage);
    await touchPage.evaluate(({ sx, sy, dx, dy }) => {
        window.__fireTouch('touchstart', sx, sy);
        window.__fireTouch('touchmove', sx + dx, sy + dy); // fires well within the long-press delay - no real wait here
        window.__fireTouch('touchend', sx + dx, sy + dy);
    }, { sx: touchPanStart.x, sy: touchPanStart.y, dx: touchPanDelta.x, dy: touchPanDelta.y });
    const afterTouchPan = await getCanvasGeometry(touchPage);
    const expectedTouchPanX = beforeTouchPan.camera.x - touchPanDelta.x / beforeTouchPan.camera.zoom;
    const expectedTouchPanY = beforeTouchPan.camera.y - touchPanDelta.y / beforeTouchPan.camera.zoom;
    check(
        tag('an immediate touch-drag (no hold) pans the camera, like a right-mouse-drag'),
        Math.abs(afterTouchPan.camera.x - expectedTouchPanX) < 5 && Math.abs(afterTouchPan.camera.y - expectedTouchPanY) < 5,
        `camera moved to (${Math.round(afterTouchPan.camera.x)}, ${Math.round(afterTouchPan.camera.y)}), expected near (${Math.round(expectedTouchPanX)}, ${Math.round(expectedTouchPanY)})`
    );

    // ---- Scenario 9: press and HOLD past the long-press delay, then drag, box-selects ----
    // Scenario 8 just panned the camera, so the unit's screen position has
    // to be recomputed from its own actual (fixed) world coordinates, not
    // re-derived from an offset off the now-moved camera.
    touchGeo = await getCanvasGeometry(touchPage);
    const holdUnitWorld = await touchPage.evaluate(() => {
        const u = gameState.playerCountry.units.find(u => u.type === 'stormbreaker');
        return { x: u.x, y: u.y };
    });
    const holdUnitScreen = worldToScreen(holdUnitWorld, touchGeo.camera, touchGeo.canvasSize, touchGeo.rect);
    await touchPage.evaluate(({ x, y }) => window.__fireTouch('touchstart', x, y), { x: holdUnitScreen.x - 40, y: holdUnitScreen.y - 40 });
    await touchPage.waitForTimeout(500); // real elapsed time, past the game's own 400ms long-press threshold
    await touchPage.evaluate(({ x, y }) => window.__fireTouch('touchmove', x, y), { x: holdUnitScreen.x + 40, y: holdUnitScreen.y + 40 });
    await touchPage.evaluate(({ x, y }) => window.__fireTouch('touchend', x, y), { x: holdUnitScreen.x + 40, y: holdUnitScreen.y + 40 });
    const touchHoldSelectedCount = await touchPage.evaluate(() => gameState.selectedUnits.length);
    check(tag('press-and-hold past the long-press delay, then drag, box-selects a unit (touch)'), touchHoldSelectedCount === 1, `selectedUnits.length = ${touchHoldSelectedCount}`);

    // ---- Scenario 10: two-finger pinch zooms the camera in and out ----
    // Direct report: "Can't zoom in and out on mobile version" - touch-
    // action:none (needed so single-finger gestures above don't fight the
    // browser's own scroll/zoom) also blocks the browser's native pinch-
    // zoom, so without the game's own pinch handling there was no way to
    // zoom on a touch device at all.
    await touchPage.evaluate(() => { if (touchGestureMode) window.__fireTouch('touchend', 0, 0); }); // clear any stray gesture state from scenario 9
    const zoomBeforePinch = await touchPage.evaluate(() => camera.zoom);
    await touchPage.evaluate(() => window.__fireTouchMulti('touchstart', [{ x: 620, y: 380 }, { x: 660, y: 380 }]));
    await touchPage.evaluate(() => window.__fireTouchMulti('touchmove', [{ x: 540, y: 380 }, { x: 740, y: 380 }])); // fingers spreading apart
    const zoomAfterPinchOut = await touchPage.evaluate(() => camera.zoom);
    await touchPage.evaluate(() => window.__fireTouchMulti('touchend', []));
    check(
        tag('a two-finger pinch-out (fingers spreading apart) zooms the camera in'),
        zoomAfterPinchOut > zoomBeforePinch,
        `zoom went from ${zoomBeforePinch} to ${zoomAfterPinchOut}, expected an increase`
    );

    await touchPage.evaluate(() => window.__fireTouchMulti('touchstart', [{ x: 540, y: 380 }, { x: 740, y: 380 }]));
    await touchPage.evaluate(() => window.__fireTouchMulti('touchmove', [{ x: 600, y: 380 }, { x: 680, y: 380 }])); // fingers pinching together
    const zoomAfterPinchIn = await touchPage.evaluate(() => camera.zoom);
    await touchPage.evaluate(() => window.__fireTouchMulti('touchend', []));
    check(
        tag('a two-finger pinch-in (fingers pinching together) zooms the camera out'),
        zoomAfterPinchIn < zoomAfterPinchOut,
        `zoom went from ${zoomAfterPinchOut} to ${zoomAfterPinchIn}, expected a decrease`
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
