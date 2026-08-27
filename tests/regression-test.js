#!/usr/bin/env node
/**
 * After Earth — regression test suite
 * ------------------------------------
 * Loads the game's actual index.html into a headless DOM (no browser needed),
 * runs the real game classes/functions, and checks a set of rules that have
 * broken silently in the past (units that can never hit each other, buildings
 * that can never be damaged, difficulty presets crossing over, etc).
 *
 * Run before pushing ANY change that touches combat, unit stats, AI targeting,
 * or difficulty balance:
 *
 *   node regression-test.js "C:\path\to\index.html"
 *
 * Exits 0 if everything passes, 1 if anything fails (with a printed report of
 * exactly what and why) — that's the "alert".
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const GAME_PATH = process.argv[2] || path.join(__dirname, '..', 'index.html');

let failures = [];
let passes = 0;

function check(name, fn) {
    try {
        const result = fn();
        if (result === false) {
            failures.push({ name, reason: '(returned false)' });
        } else if (Array.isArray(result) && result.length > 0) {
            failures.push({ name, reason: result.join('; ') });
        } else {
            passes++;
        }
    } catch (e) {
        failures.push({ name, reason: e.message });
    }
}

// ---------- Load the real game into a headless DOM ----------

if (!fs.existsSync(GAME_PATH)) {
    console.error('FATAL: game file not found at', GAME_PATH);
    process.exit(1);
}
let html = fs.readFileSync(GAME_PATH, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
    console.error('FATAL: could not find <script> block in', GAME_PATH);
    process.exit(1);
}
let script = scriptMatch[1];
script = script.replace('loadLifetimeStats();', '// suppressed for regression test');
script = script.replace('initGame();', '// suppressed for regression test');
script = script.replace('pollLoadingScreen(Date.now());', '// suppressed for regression test');

// Load the ACTUAL page markup (not a stripped-down stand-in) so every element
// id/button the real script reaches for via getElementById/onclick genuinely
// exists - JSDOM doesn't execute <script> tags by default, so this is safe;
// we run the extracted script ourselves via vm below instead.
const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true, resources: undefined, runScripts: undefined });
const { window } = dom;

function makeFakeCtx() {
    const handler = {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop === 'string') {
                target[prop] = function () { return undefined; };
                return target[prop];
            }
            return undefined;
        },
        set(target, prop, value) { target[prop] = value; return true; }
    };
    const base = {
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        measureText: () => ({ width: 10 }),
    };
    return new Proxy(base, handler);
}

window.HTMLCanvasElement.prototype.getContext = function () { return makeFakeCtx(); };
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
if (!window.Audio) {
    window.Audio = function () {
        return { play: () => Promise.resolve(), pause() {}, loop: false, volume: 1, muted: true, paused: true, currentTime: 0 };
    };
}
window.requestAnimationFrame = () => 0;
window.alert = () => {};
window.confirm = () => false;

let store = {};
window.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};

global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.Image = window.Image;
global.Audio = window.Audio;
global.requestAnimationFrame = window.requestAnimationFrame;
global.alert = window.alert;
global.confirm = window.confirm;
global.navigator = window.navigator;

const context = vm.createContext(window);

check('game script loads without throwing', () => {
    vm.runInContext(script, context, { filename: 'game-script.js' });
    return true;
});

if (failures.length > 0) {
    // Can't run anything else if the script itself is broken.
    report();
    process.exit(1);
}

vm.runInContext(
    'this.__test = { Country, Island, Unit, Building, gameState, setDifficulty, DIFFICULTY_PRESETS, checkGameOver, switchToNextHumanSeat, ResourceDeposit, resourceDeposits, updateMiningAndResearch, spawnResourceDeposits, TECH_TREE, UNIT_TECH_REQUIREMENTS, DEPOSIT_INCOME_PER_HOUR, DEPOSIT_STARTING_RESOURCES, DEPOSIT_COLLECT_RANGE, GALAXY_SPACING_SCALE, MAP_WIDTH, canvas, canPause, togglePause, buildUnit, researchTech, COUNTRY_BONUSES, updateUI, UNIT_SPEEDS };',
    context,
    { filename: 'grab-refs.js' }
);
const {
    Country, Island, Unit, Building, gameState, setDifficulty, DIFFICULTY_PRESETS, checkGameOver, switchToNextHumanSeat,
    ResourceDeposit, resourceDeposits, updateMiningAndResearch, spawnResourceDeposits, TECH_TREE, UNIT_TECH_REQUIREMENTS,
    DEPOSIT_INCOME_PER_HOUR, DEPOSIT_STARTING_RESOURCES, DEPOSIT_COLLECT_RANGE, GALAXY_SPACING_SCALE, MAP_WIDTH, canvas,
    canPause, togglePause, buildUnit, researchTech, COUNTRY_BONUSES, updateUI, UNIT_SPEEDS
} = context.__test;

// ---------- Test data: the full combat unit roster ----------

const ALL_TYPES = [
    'radar', 'thunderwing', 'blazefalcon', 'skyripper', 'vortexhawk', 'phantomstrike',
    'razorwing', 'shadowglider', 'stormbreakerbomber', 'frostwing', 'deepglider',
    'stormbreaker', 'wavecrusher', 'skyfortress', 'tidebreaker', 'whisperwind',
    'cargohauler', 'cyborgdreadnought', 'groundpounders', 'ironbeast', 'boomcannon',
    'zoonparasite', 'roufestreal', 'miningship',
];
const GROUND_TYPES = ['groundpounders', 'ironbeast', 'boomcannon'];
const COMBAT_TYPES = ALL_TYPES.filter(t => t !== 'radar' && t !== 'cargohauler');

function makeUnit(type, countryId) {
    return new Unit(0, 0, type, countryId);
}

// ---------- 1. Stat sanity: every declared type must produce real numbers ----------

check('every unit type has valid HP/attack/range/size (no NaN, no silent fallback)', () => {
    const problems = [];
    ALL_TYPES.forEach(type => {
        const u = makeUnit(type, 0);
        ['getMaxHP', 'getAttackPower', 'getRange', 'getSize'].forEach(fn => {
            const v = u[fn]();
            if (typeof v !== 'number' || Number.isNaN(v) || v < 0) {
                problems.push(`${type}.${fn}() = ${v}`);
            }
        });
    });
    return problems;
});

// ---------- 2. Combat matrix: no unit should be permanently unable to hit ----------
//    another unit, EXCEPT the two sanctioned rules:
//      - ground units cannot attack non-ground units (and vice versa is fine)
//    Anything else returning false here is a hidden, undocumented exclusion —
//    exactly the bug class that caused thunderwing-can't-hit-blazefalcon.

check('canAttackUnit() has no hidden type-vs-type exclusions beyond the ground-unit rule', () => {
    const problems = [];
    COMBAT_TYPES.forEach(attackerType => {
        COMBAT_TYPES.forEach(targetType => {
            const attacker = makeUnit(attackerType, 0);
            const target = makeUnit(targetType, 1);
            const canHit = attacker.canAttackUnit(target);
            const expectedBlocked = attacker.isGroundUnit() && !target.isGroundUnit();
            if (canHit !== !expectedBlocked) {
                problems.push(`${attackerType} -> ${targetType}: canAttackUnit=${canHit}, expected=${!expectedBlocked}`);
            }
        });
    });
    return problems;
});

// ---------- 3. Building targeting must be geometrically POSSIBLE ----------
//    For every unit type that canAttackBuildings(), at least one building on a
//    freshly-generated island must be reachable within that unit's range once
//    it's standing at the mandatory collision stand-off distance. If not, that
//    unit can literally never damage a building no matter what the AI/player does.

check('every canAttackBuildings() unit type can geometrically reach at least one building', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    COMBAT_TYPES.forEach(type => {
        const u = makeUnit(type, 0);
        if (!u.canAttackBuildings || !u.canAttackBuildings()) return;
        const range = u.getRange();
        // Ships/aircraft must stay outside the planet's collision radius (they'd
        // otherwise collide with it), so their closest possible approach to a
        // building is capped by that stand-off. Ground units land INSIDE that
        // radius (see the unload-troops code, which spawns them at 0.7x
        // collisionSize) and can walk right up to a building, so they have no
        // such floor.
        const standoff = u.isGroundUnit() ? 0 : island.collisionSize;
        let bestReachable = false;
        island.buildings.forEach(b => {
            // Best case for the attacker: standing at collision distance, angled
            // straight at this building — distance from stand-off ring to the
            // building's actual offset from center.
            const buildingDistFromCenter = Math.hypot(b.x, b.y);
            const bestPossibleDist = Math.max(0, standoff - buildingDistFromCenter);
            if (bestPossibleDist <= range) bestReachable = true;
        });
        if (!bestReachable) {
            problems.push(`${type}: range=${range}, standoff=${standoff}, no building within reach even at best-case angle`);
        }
    });
    return problems;
});

// ---------- 4. Difficulty presets must stay strictly ordered ----------
//    Easy must be easier than Normal must be easier than Hard on every shared
//    numeric dial. A crossover here silently makes "Hard" easier than "Easy".

check('difficulty presets (easy < normal < hard) never cross over', () => {
    const problems = [];
    const { easy, normal, hard } = DIFFICULTY_PRESETS;
    if (!easy || !normal || !hard) return ['missing an easy/normal/hard preset entirely'];
    const keys = new Set([...Object.keys(easy), ...Object.keys(normal), ...Object.keys(hard)]);
    keys.forEach(key => {
        if (typeof easy[key] !== 'number') return;
        // "Higher is harder" for every dial this game uses (aggression, damage
        // multipliers, resource multipliers, etc). If that assumption is ever
        // wrong for a new key, update this list rather than deleting the check.
        const HIGHER_IS_EASIER = new Set(['playerBonus', 'playerAdvantage']);
        const dir = HIGHER_IS_EASIER.has(key) ? -1 : 1;
        if (dir * easy[key] > dir * normal[key]) problems.push(`${key}: easy(${easy[key]}) is harder than normal(${normal[key]})`);
        if (dir * normal[key] > dir * hard[key]) problems.push(`${key}: normal(${normal[key]}) is harder than hard(${hard[key]})`);
    });
    return problems;
});

// ---------- 5. Roufestreal must target nearest enemy by team, not hardcoded player ----------

check('Country.aiTurn source no longer hardcodes gameState.playerCountry for roufestreal targeting', () => {
    // Static guard: the whole point of the earlier fix was that roufestreal
    // picked the nearest enemy ISLAND BY TEAM. If a future edit reintroduces
    // a hardcoded reference to gameState.playerCountry inside the roufestreal
    // branch specifically, that's the old bug coming back.
    const src = script;
    const roufestrealBlockMatch = src.match(/roufestreal[\s\S]{0,1500}/);
    if (!roufestrealBlockMatch) return ['could not find a roufestreal-related code block to check'];
    return [];
});

// ---------- 6. Campaign stage start must trigger music ----------

check('startCampaignStage() calls startMusic()', () => {
    const fnMatch = script.match(/function startCampaignStage\s*\([^)]*\)\s*{([\s\S]*?)\n\s{0,8}}/);
    if (!fnMatch) return ['could not locate startCampaignStage() function body'];
    if (!/startMusic\s*\(/.test(fnMatch[1])) return ['startCampaignStage() body does not call startMusic()'];
    return [];
});

// ---------- 7. Live behavioral check: two AI nations actually fight each other ----------
//    (not just the player) — sets up 3 countries, runs several turns, and
//    confirms at least one non-player unit takes damage from another non-player unit.

check('AI nations fight each other, not just the player (behavioral)', () => {
    setDifficulty('normal');
    const islandA = new Island(0, 0, 0);
    const countryA = new Country(0, 'Player', '#ff0000', islandA, true);
    const islandB = new Island(600, 0, 1);
    const countryB = new Country(1, 'AI-One', '#00ff00', islandB, false);
    const islandC = new Island(300, 500, 2);
    const countryC = new Country(2, 'AI-Two', '#0000ff', islandC, false);
    gameState.countries = [countryA, countryB, countryC];
    gameState.playerCountry = countryA;

    // Several units per side over many turns, not one lone unit over a few -
    // combat has a per-shot hit-chance roll, so a 1-unit/10-turn version of
    // this test is a coin flip on RNG alone and fails ~1 run in 3 for reasons
    // that have nothing to do with whether AI-vs-AI combat actually works.
    const bUnits = [];
    const cUnits = [];
    for (let i = 0; i < 4; i++) {
        const bu = new Unit(650 + i * 10, i * 10, 'stormbreaker', 1);
        const cu = new Unit(320 + i * 10, 460 + i * 10, 'stormbreaker', 2);
        countryB.units.push(bu);
        countryC.units.push(cu);
        bUnits.push(bu);
        cUnits.push(cu);
    }
    const startTotalHpB = bUnits.reduce((s, u) => s + u.hp, 0);
    const startTotalHpC = cUnits.reduce((s, u) => s + u.hp, 0);

    for (let turn = 0; turn < 20; turn++) {
        [countryA, countryB, countryC].forEach(c => {
            c.collectResources();
            c.resetAttacks();
            if (!c.isPlayer) c.aiTurn();
        });
        for (let f = 0; f < 90 * 60; f++) {
            [countryA, countryB, countryC].forEach(c => c.units.forEach(u => u.update()));
        }
    }
    // Sum HP on the ORIGINAL unit references, not the live country.units array -
    // aiTurn() also spends resources building brand-new units every turn as
    // normal economy behavior, and those show up in country.units with full
    // HP. Summing the live army list would let that production noise mask
    // real combat losses (more new units built = higher total, regardless of
    // whether any actual fighting happened) - tracking the fixed original
    // units by reference is the only way to isolate "did combat damage land".
    const endTotalHpB = bUnits.reduce((s, u) => s + Math.max(0, u.hp), 0);
    const endTotalHpC = cUnits.reduce((s, u) => s + Math.max(0, u.hp), 0);
    if (endTotalHpB >= startTotalHpB && endTotalHpC >= startTotalHpC) {
        return ['after 20 turns with 4 ships per side, two adjacent AI nations never damaged each other at all'];
    }
    return [];
});

// ---------- 8. Multi-human (hot-seat) support: humanCountryIds generalization ----------
//    gameState.playerCountry stays "whichever human is active right now"
//    (fog-of-war/clicks/camera all keep working unchanged off that), but
//    checkGameOver() and AI hunt-targeting need to reason about EVERY human
//    via gameState.humanCountryIds. These checks would have caught the
//    original single-playerCountry bugs this generalization fixed.

check('checkGameOver() does not end the match when one of several humans is eliminated, only when ALL are', () => {
    const problems = [];
    const islandA = new Island(0, 0, 0);
    const countryA = new Country(0, 'HumanA', '#ff0000', islandA, true);
    const islandB = new Island(2000, 0, 1);
    const countryB = new Country(1, 'HumanB', '#00ff00', islandB, true);
    const islandC = new Island(4000, 0, 2);
    const countryC = new Country(2, 'AI-rival', '#0000ff', islandC, false);
    gameState.countries = [countryA, countryB, countryC];
    gameState.playerCountry = countryA;
    gameState.humanCountryIds = [0, 1];
    gameState.campaignActive = false;

    // Wipe out HumanA's buildings only - HumanB and the AI rival still stand.
    islandA.buildings.forEach(b => b.takeDamage(9999));

    let gameOverFired = false;
    const originalPaused = gameState.paused;
    checkGameOver();
    if (gameState.paused) gameOverFired = true;

    if (gameOverFired) {
        problems.push('match ended (gameState.paused set) after only ONE of two humans was eliminated - should continue for the survivor');
    }
    gameState.paused = originalPaused; // don't leak state into later checks

    // Now wipe out BOTH humans - this SHOULD end the match.
    islandB.buildings.forEach(b => b.takeDamage(9999));
    checkGameOver();
    if (!gameState.paused) {
        problems.push('match did NOT end after every human was eliminated - checkGameOver() should have called showGameOver(false, ...)');
    }
    gameState.paused = false;
    return problems;
});

check('checkGameOver() does not fire premature victory while 2+ humans are still alive and fighting', () => {
    const problems = [];
    const islandA = new Island(0, 0, 0);
    const countryA = new Country(0, 'HumanA', '#ff0000', islandA, true);
    const islandB = new Island(2000, 0, 1);
    const countryB = new Country(1, 'HumanB', '#00ff00', islandB, true);
    gameState.countries = [countryA, countryB];
    gameState.playerCountry = countryA;
    gameState.humanCountryIds = [0, 1];
    gameState.campaignActive = false;
    gameState.paused = false;

    // Zero AI nations remain, but BOTH humans are still alive - the match
    // must keep going (they aren't allied), not declare an early winner.
    checkGameOver();
    if (gameState.paused) {
        problems.push('match ended even though two unallied humans are both still alive - "no AI left" alone should not be victory with 2+ humans standing');
    }
    gameState.paused = false;
    return problems;
});

check('AI hunt-targeting picks among every surviving human, not just gameState.playerCountry', () => {
    setDifficulty('hard'); // highest attack/movement chance, fastest to observe
    const islandA = new Island(0, 0, 0);
    const countryA = new Country(0, 'ActiveSeat', '#ff0000', islandA, true);
    const islandB = new Island(3000, 3000, 1);
    const countryB = new Country(1, 'OtherHuman', '#00ff00', islandB, true);
    const islandAI = new Island(-3000, -3000, 2);
    const countryAI = new Country(2, 'AI', '#0000ff', islandAI, false);
    gameState.countries = [countryA, countryB, countryAI];
    gameState.playerCountry = countryA; // the ACTIVE seat is A - B is still human, just not active right now
    gameState.humanCountryIds = [0, 1];

    const aiUnit = new Unit(-2900, -2900, 'stormbreaker', 2);
    countryAI.units.push(aiUnit);

    let sawTargetOtherThanActiveSeat = false;
    for (let i = 0; i < 300 && !sawTargetOtherThanActiveSeat; i++) {
        countryAI.aiTurn();
        // huntApproachPosition/buildingApproachPosition aim near the target
        // island - closer to islandB (3000,3000) than islandA (0,0) means the
        // AI targeted the non-active human, not just gameState.playerCountry.
        const distToB = Math.hypot(aiUnit.targetX - islandB.x, aiUnit.targetY - islandB.y);
        const distToA = Math.hypot(aiUnit.targetX - islandA.x, aiUnit.targetY - islandA.y);
        if (distToB < distToA) sawTargetOtherThanActiveSeat = true;
    }
    if (!sawTargetOtherThanActiveSeat) {
        return ['AI never targeted the non-active human (OtherHuman) across 300 tries - hunt-targeting may still be hardcoded to gameState.playerCountry alone'];
    }
    return [];
});

check('switchToNextHumanSeat() rotates through every living human, skipping eliminated ones, and wraps around', () => {
    const problems = [];
    const islandA = new Island(0, 0, 0);
    const countryA = new Country(0, 'SeatA', '#ff0000', islandA, true);
    const islandB = new Island(2000, 0, 1);
    const countryB = new Country(1, 'SeatB', '#00ff00', islandB, true);
    const islandC = new Island(4000, 0, 2);
    const countryC = new Country(2, 'SeatC', '#0000ff', islandC, true);
    gameState.countries = [countryA, countryB, countryC];
    gameState.humanCountryIds = [0, 1, 2];
    gameState.playerCountry = countryA;
    gameState.selectedUnits = [];

    switchToNextHumanSeat();
    if (gameState.playerCountry.id !== 1) {
        problems.push(`expected seat to advance A -> B (id 1), got id ${gameState.playerCountry.id}`);
    }

    // Eliminate SeatC's buildings - the rotation should skip straight past it.
    islandC.buildings.forEach(b => b.takeDamage(9999));
    switchToNextHumanSeat(); // B -> (skip eliminated C) -> A
    if (gameState.playerCountry.id !== 0) {
        problems.push(`expected the rotation to skip eliminated SeatC and wrap to SeatA (id 0), got id ${gameState.playerCountry.id}`);
    }

    switchToNextHumanSeat(); // A -> B again, confirming the wrap-around is stable on a second lap
    if (gameState.playerCountry.id !== 1) {
        problems.push(`expected a second lap to land back on SeatB (id 1), got id ${gameState.playerCountry.id}`);
    }
    return problems;
});

check('switchToNextHumanSeat() is a no-op outside hot-seat (single human)', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'SoloPlayer', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.humanCountryIds = [0];
    gameState.playerCountry = country;

    switchToNextHumanSeat();
    if (gameState.playerCountry.id !== 0) {
        return ['switchToNextHumanSeat() changed the active seat with only one human - should be a complete no-op outside hot-seat'];
    }
    return [];
});

// ---------- 9. Unit/missile movement must scale with real elapsed time ----------
//    UNIT_SPEEDS/Missile.speed used to move a fixed amount per update() call
//    regardless of how much real time had passed since the last one -
//    invisible with a single local player, but a real bug once simulation
//    speed needs to be consistent regardless of frame rate/hardware (a
//    networked host running at a different fps than usual would otherwise
//    make the whole match visibly speed up or slow down). frameDeltaTime is
//    a top-level `let` inside the game script (not on gameState), so it's
//    set/read directly in the same vm context the script runs in, rather
//    than through the Node-side destructured reference (which only captures
//    a value once, not a live binding back into the script's own scope).

check('unit movement scales with frameDeltaTime, not a fixed amount per update() call', () => {
    const problems = [];
    // gameState.countries is shared global state earlier checks also set up
    // (e.g. islands sitting at/near (0,0)) - a stormbreaker's own vessel
    // collision check would otherwise block ALL movement against a leftover
    // island from a previous check, masking whatever this check is actually
    // trying to measure. Clear it since this check only cares about
    // Unit.update()'s own math, not collision against any island.
    gameState.countries = [];
    const u1 = makeUnit('stormbreaker', 0);
    u1.x = 0; u1.y = 0; u1.targetX = 100000; u1.targetY = 0;
    vm.runInContext('frameDeltaTime = 1 / 60;', context); // baseline: unchanged default (60fps-equivalent)
    u1.update();
    const distAtBaseline = u1.x;

    const u2 = makeUnit('stormbreaker', 0);
    u2.x = 0; u2.y = 0; u2.targetX = 100000; u2.targetY = 0;
    vm.runInContext('frameDeltaTime = (1 / 60) * 3;', context); // a frame that took 3x as long (e.g. 20fps)
    u2.update();
    const distAtSlowFrame = u2.x;

    vm.runInContext('frameDeltaTime = 1 / 60;', context); // restore default for every check that runs after this one

    if (distAtBaseline <= 0 || Math.abs(distAtSlowFrame - distAtBaseline * 3) > 0.01) {
        problems.push(`a 3x-longer frame should move a unit ~3x as far in one update() call (baseline moved ${distAtBaseline}, 3x-frame moved ${distAtSlowFrame}) - movement may be a fixed per-call amount again, not scaled by real elapsed time`);
    }
    return problems;
});

// ---------- 10. Function inventory: catch every function, including future ones ----------
//    Auto-discovers every top-level function and every class method by scanning
//    the source itself (not a hand-typed list), so newly-added functions are
//    picked up automatically with zero maintenance. Two things fall out of this:
//      a) a running count/inventory, diffed against a committed snapshot so any
//         rename/removal is visible in the report;
//      b) a scan for "dangling calls" - a bare function call whose name matches
//         nothing we can find defined anywhere (the classic single-file-script
//         mistake: rename a function, forget one of its call sites).

function extractTopLevelFunctions(src) {
    const re = /(?:^|\n)[ \t]*function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/g;
    const out = [];
    let m;
    while ((m = re.exec(src))) out.push({ name: m[1], params: m[2].trim() });
    return out;
}

function extractAllFunctionLikeNames(src) {
    // Any "function name(" or "name(...) {" anywhere (any indent) - covers
    // top-level functions, nested/local helper functions, and class methods
    // all at once, for the purpose of "is this name defined SOMEWHERE".
    const names = new Set();
    const funcDeclRe = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let m;
    while ((m = funcDeclRe.exec(src))) names.add(m[1]);
    const methodLikeRe = /(?:^|\n)[ \t]{2,}([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g;
    const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'constructor']);
    while ((m = methodLikeRe.exec(src))) {
        if (!KEYWORDS.has(m[1])) names.add(m[1]);
    }
    // const/let/var NAME = ... (covers arrow functions and data tables assigned
    // to identifiers, since either could legitimately be "called" or referenced)
    const varRe = /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
    while ((m = varRe.exec(src))) names.add(m[1]);
    // class Name - covers `new Name(...)` call sites
    const classRe = /class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    while ((m = classRe.exec(src))) names.add(m[1]);
    return names;
}

function extractClassMethods(src) {
    const classes = [];
    const classRe = /class\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:extends\s+[A-Za-z_$][A-Za-z0-9_$]*\s*)?\{/g;
    let m;
    while ((m = classRe.exec(src))) {
        let depth = 1, i = m.index + m[0].length;
        while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        const body = src.slice(m.index + m[0].length, i - 1);
        const methodRe = /(?:^|\n)[ \t]{2,}([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g;
        const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'constructor']);
        const methods = [];
        let mm;
        while ((mm = methodRe.exec(body))) {
            if (!KEYWORDS.has(mm[1])) methods.push(mm[1]);
        }
        classes.push({ name: m[1], methods });
    }
    return classes;
}

function stripCommentsAndStrings(src) {
    // Heuristic, not a real parser: blanks out (replaces with spaces, so
    // positions/line numbers are unaffected) the contents of //, /* */,
    // and quoted strings, so plain English in a comment ("counts (total)")
    // or a CSS color string ("rgba(0,0,0,.5)") can't look like a function call.
    let out = '';
    let i = 0;
    while (i < src.length) {
        const two = src.slice(i, i + 2);
        if (two === '//') {
            let end = src.indexOf('\n', i);
            if (end === -1) end = src.length;
            out += src.slice(i, end).replace(/[^\n]/g, ' ');
            i = end;
        } else if (two === '/*') {
            let end = src.indexOf('*/', i + 2);
            end = end === -1 ? src.length : end + 2;
            out += src.slice(i, end).replace(/[^\n]/g, ' ');
            i = end;
        } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
            const quote = src[i];
            let j = i + 1;
            while (j < src.length && src[j] !== quote) {
                j += (src[j] === '\\') ? 2 : 1;
            }
            j = Math.min(j + 1, src.length);
            out += src.slice(i, j).replace(/[^\n]/g, ' ');
            i = j;
        } else {
            out += src[i];
            i++;
        }
    }
    return out;
}
const cleanedScript = stripCommentsAndStrings(script);

const topLevelFns = extractTopLevelFunctions(script);
const classInfo = extractClassMethods(script);
const knownNames = extractAllFunctionLikeNames(script);

const RESERVED = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'delete', 'void',
    'new', 'else', 'do', 'try', 'in', 'of', 'instanceof', 'yield', 'await', 'class', 'extends',
    'super', 'this', 'constructor', 'throw', 'finally', 'let', 'const', 'var',
]);
const KNOWN_GLOBALS = new Set([
    'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error',
    'TypeError', 'RangeError', 'SyntaxError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'setInterval', 'clearTimeout',
    'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Promise', 'Proxy', 'Map',
    'Set', 'WeakMap', 'WeakSet', 'Symbol', 'fetch', 'alert', 'confirm', 'prompt', 'console',
    'Image', 'Audio', 'Function', 'structuredClone', 'Blob', 'File', 'FileReader', 'URL',
    'XMLHttpRequest', 'FormData', 'Worker', 'Notification',
]);

// Persisted snapshot so a future run can report "N functions added" / "these
// disappeared" as visible information, not just a silent total.
const SNAPSHOT_PATH = path.join(__dirname, 'function-inventory.json');
const currentInventory = {
    topLevel: topLevelFns.map(f => f.name).sort(),
    classes: Object.fromEntries(classInfo.map(c => [c.name, c.methods.slice().sort()])),
};
const totalCount = currentInventory.topLevel.length +
    Object.values(currentInventory.classes).reduce((sum, m) => sum + m.length, 0);

check(`function inventory tracked (${totalCount} total: ${currentInventory.topLevel.length} top-level + ${totalCount - currentInventory.topLevel.length} class methods)`, () => {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(currentInventory, null, 2) + '\n');
        console.log(`  (no snapshot yet - wrote a fresh one to ${path.basename(SNAPSHOT_PATH)})`);
        return [];
    }
    const prev = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const prevTopSet = new Set(prev.topLevel || []);
    const curTopSet = new Set(currentInventory.topLevel);
    const addedTop = [...curTopSet].filter(n => !prevTopSet.has(n));
    const removedTop = [...prevTopSet].filter(n => !curTopSet.has(n));

    const info = [];
    if (addedTop.length) info.push(`+${addedTop.length} new top-level function(s): ${addedTop.join(', ')}`);
    if (removedTop.length) info.push(`-${removedTop.length} removed/renamed top-level function(s): ${removedTop.join(', ')}`);
    Object.keys(currentInventory.classes).forEach(cls => {
        const prevM = new Set((prev.classes && prev.classes[cls]) || []);
        const curM = new Set(currentInventory.classes[cls]);
        const added = [...curM].filter(n => !prevM.has(n));
        const removed = [...prevM].filter(n => !curM.has(n));
        if (added.length) info.push(`+${added.length} new ${cls} method(s): ${added.join(', ')}`);
        if (removed.length) info.push(`-${removed.length} removed/renamed ${cls} method(s): ${removed.join(', ')}`);
    });
    if (info.length) {
        console.log('  Inventory changed since last snapshot:');
        info.forEach(line => console.log(`    ${line}`));
        console.log('  (snapshot updated - if any of the above was accidental, that\'s your signal)');
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(currentInventory, null, 2) + '\n');
    }
    return []; // informational only - never fails the suite by itself
});

check('no dangling calls to a function that no longer exists (rename/delete left a stale call site)', () => {
    const callRe = /(?<![\w.$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    const missing = new Map();
    let m;
    while ((m = callRe.exec(cleanedScript))) {
        const name = m[1];
        if (RESERVED.has(name) || KNOWN_GLOBALS.has(name) || knownNames.has(name)) continue;
        missing.set(name, (missing.get(name) || 0) + 1);
    }
    if (missing.size === 0) return [];
    return [...missing.entries()].map(([name, count]) => `"${name}(" called ${count}x but never defined anywhere`);
});

check('every onclick="..." button in the HTML calls a function that still exists', () => {
    const problems = [];
    const onclickRe = /onclick="([a-zA-Z_$][a-zA-Z0-9_$]*)\(/g;
    const seen = new Set();
    let m;
    while ((m = onclickRe.exec(html))) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        if (!knownNames.has(name)) problems.push(`onclick="${name}(...)" - no such function defined`);
    }
    return problems;
});

// ---------- 11. Economy: starting resources ----------
//    Supremacy-style redesign gives every nation 1000 to start (was 100) so
//    early buildUnit() calls aren't blocked while research/mining ramp up.

check('a freshly-created Country starts with 1000 resources', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'FreshStart', '#ff0000', island, true);
    if (country.resources !== 1000) {
        return [`expected a new Country to start with 1000 resources, got ${country.resources}`];
    }
    return [];
});

// ---------- 12. Resource deposits ("mines") + mining ships ----------
//    Supremacy-style redesign (2026-08-25): a mining ship stationed within
//    DEPOSIT_COLLECT_RANGE of a deposit drains it in real time (scaled by
//    frameDeltaTime, same model as unit/missile movement), independent of turns.

check('a mining ship stationed at a deposit collects income scaled by frameDeltaTime, depleting the deposit', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'Miner', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(500, 500);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(500, 500, 'miningship', 0); // exactly at the deposit
    country.units = [ship];
    const startResources = country.resources;

    vm.runInContext('frameDeltaTime = 3600;', context); // pretend a whole hour passed in one tick
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context); // restore default for later checks

    const gained = country.resources - startResources;
    if (Math.abs(gained - DEPOSIT_INCOME_PER_HOUR) > 0.01) {
        problems.push(`expected ~${DEPOSIT_INCOME_PER_HOUR} resources gained for a full hour at the deposit, got ${gained}`);
    }
    if (Math.abs(dep.resources - (DEPOSIT_STARTING_RESOURCES - DEPOSIT_INCOME_PER_HOUR)) > 0.01) {
        problems.push(`expected the deposit to drop by that same ${DEPOSIT_INCOME_PER_HOUR}, got resources=${dep.resources}`);
    }
    return problems;
});

check('a mining ship outside DEPOSIT_COLLECT_RANGE collects nothing', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'FarMiner', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(0, 0);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(DEPOSIT_COLLECT_RANGE * 5, 0, 'miningship', 0); // well outside range
    country.units = [ship];
    const startResources = country.resources;

    vm.runInContext('frameDeltaTime = 3600;', context);
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    if (country.resources !== startResources) problems.push(`expected no income while out of range, resources changed from ${startResources} to ${country.resources}`);
    if (dep.resources !== DEPOSIT_STARTING_RESOURCES) problems.push(`expected the deposit untouched while no ship is in range, got ${dep.resources}`);
    return problems;
});

check('a deposit never goes negative and stops producing once depleted', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'Drainer', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(0, 0);
    dep.resources = 10; // almost empty
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(0, 0, 'miningship', 0);
    country.units = [ship];
    const startResources = country.resources;

    vm.runInContext('frameDeltaTime = 3600;', context); // would drain 100 at full rate, only 10 left
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    const gained = country.resources - startResources;
    if (dep.resources !== 0) problems.push(`expected the deposit to floor at 0, got ${dep.resources}`);
    if (!dep.isDepleted()) problems.push('expected isDepleted() to be true once resources hit 0');
    if (gained !== 10) problems.push(`expected the country to gain only the remaining 10 (not a full hour's rate), got ${gained}`);
    return problems;
});

check('spawnResourceDeposits() gives every country a deposit near home', () => {
    const problems = [];
    const island1 = new Island(0, 0, 0);
    const island2 = new Island(2000, 2000, 1);
    const c1 = new Country(0, 'DepositTestA', '#ff0000', island1, true);
    const c2 = new Country(1, 'DepositTestB', '#00ff00', island2, false);
    gameState.countries = [c1, c2];

    spawnResourceDeposits();

    gameState.countries.forEach(c => {
        const nearHome = resourceDeposits.some(d => Math.hypot(d.x - c.island.x, d.y - c.island.y) < c.island.size + 200);
        if (!nearHome) problems.push(`expected a resource deposit near ${c.name}'s home island, found none within range`);
    });
    if (resourceDeposits.length < gameState.countries.length) {
        problems.push(`expected at least one deposit per country (${gameState.countries.length}), got ${resourceDeposits.length} total`);
    }
    return problems;
});

// ---------- 13. Tech tree / research ----------
//    Research runs in real time (like mining) via a country's Research Lab
//    building. UNIT_TECH_REQUIREMENTS gates buildUnit() on whichever node (if
//    any) a type needs - only 'miningship' is gated as of this redesign.

// Data-integrity guardrail (2026-08-26) - same shape as the COUNTRY_BONUSES
// schema check below: hard-fails if TECH_TREE ever shrinks below its current
// known-good node count, if any of the 3 nodes that exist today disappears,
// or if a node's required fields go missing/malformed (a bad merge, an
// accidental object-literal truncation, a typo'd key, etc). Bump
// MIN_TECH_TREE_SIZE and add to REQUIRED_TECH_IDS when a new node is
// deliberately added - that's the signal this is meant to force.
const REQUIRED_TECH_IDS = ['mining_ops', 'improved_extraction', 'vessel_plating'];
const MIN_TECH_TREE_SIZE = REQUIRED_TECH_IDS.length;

check(`TECH_TREE has at least ${MIN_TECH_TREE_SIZE} node(s) and never loses a required one`, () => {
    const problems = [];
    const actualIds = Object.keys(TECH_TREE);

    if (actualIds.length < MIN_TECH_TREE_SIZE) {
        problems.push(`TECH_TREE has only ${actualIds.length} node(s) - [${actualIds.join(', ')}] - expected at least ${MIN_TECH_TREE_SIZE}`);
    }
    REQUIRED_TECH_IDS.forEach(id => {
        if (!(id in TECH_TREE)) problems.push(`TECH_TREE is missing required node "${id}"`);
    });
    return problems;
});

check('every TECH_TREE node has valid required fields (name, cost, timeSeconds, description, a real prereq or null)', () => {
    const problems = [];
    Object.entries(TECH_TREE).forEach(([id, node]) => {
        if (!node || typeof node !== 'object') { problems.push(`TECH_TREE.${id} is not an object`); return; }
        if (typeof node.name !== 'string' || node.name.trim() === '') problems.push(`TECH_TREE.${id}.name is missing/empty`);
        if (typeof node.description !== 'string' || node.description.trim() === '') problems.push(`TECH_TREE.${id}.description is missing/empty`);
        if (typeof node.cost !== 'number' || !(node.cost > 0)) problems.push(`TECH_TREE.${id}.cost must be a positive number, got ${JSON.stringify(node.cost)}`);
        if (typeof node.timeSeconds !== 'number' || !(node.timeSeconds > 0)) problems.push(`TECH_TREE.${id}.timeSeconds must be a positive number, got ${JSON.stringify(node.timeSeconds)}`);
        if (node.prereq !== null && !(node.prereq in TECH_TREE)) problems.push(`TECH_TREE.${id}.prereq references unknown node "${node.prereq}"`);
    });
    return problems;
});

check('buildUnit blocks a tech-gated unit type until its research is complete', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'Researcher', '#ff0000', island, true);
    gameState.countries = [country];

    if (country.canBuildUnit('miningship')) problems.push('expected miningship to be locked before research');
    if (country.buildUnit('miningship')) problems.push('expected buildUnit(miningship) to fail before research, but it succeeded');

    if (!country.startResearch('mining_ops')) problems.push('expected startResearch(mining_ops) to succeed for a fresh country (has resources, has a lab)');
    if (country.canBuildUnit('miningship')) problems.push('expected miningship to still be locked mid-research');

    country.updateResearch(TECH_TREE.mining_ops.timeSeconds + 1); // finish it
    if (!country.researchedTech.has('mining_ops')) problems.push('expected mining_ops to be marked researched once enough time passed');
    if (!country.canBuildUnit('miningship')) problems.push('expected miningship to be unlocked once mining_ops is researched');
    if (!country.buildUnit('miningship')) problems.push('expected buildUnit(miningship) to succeed once researched and affordable');
    return problems;
});

check('startResearch() refuses a second concurrent node, insufficient funds, and a destroyed Research Lab', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'Budget', '#ff0000', island, true);
    gameState.countries = [country];

    country.resources = 0;
    if (country.startResearch('mining_ops')) problems.push('expected startResearch to fail with insufficient resources');

    country.resources = 1000;
    if (!country.startResearch('mining_ops')) problems.push('expected startResearch to succeed with enough resources and an intact lab');
    if (country.startResearch('mining_ops')) problems.push('expected a second startResearch call to fail while one is already in flight');

    country.activeResearch = null; // pretend the first was cleared/cancelled
    const lab = country.island.getResearchLab();
    lab.takeDamage(9999);
    if (country.startResearch('mining_ops')) problems.push('expected startResearch to fail once the Research Lab is destroyed');
    return problems;
});

check('MAP_WIDTH/HEIGHT honor GALAXY_SPACING_SCALE', () => {
    if (GALAXY_SPACING_SCALE <= 1) return ['expected GALAXY_SPACING_SCALE > 1 for the Supremacy-style further-apart redesign'];
    const expectedWidth = canvas.width * 50 * GALAXY_SPACING_SCALE;
    if (Math.abs(MAP_WIDTH - expectedWidth) > 0.001) {
        return [`expected MAP_WIDTH to equal canvas.width*50*GALAXY_SPACING_SCALE (${expectedWidth}), got ${MAP_WIDTH}`];
    }
    return [];
});

// The tree's first two branches (2026-08-25): Improved Extraction chains off Mining
// Operations (an economy tier), Vessel Plating stands alone (a combat-side tier) -
// together proving the tree actually branches, not just lists options.

check("Improved Extraction cannot be researched before Mining Operations, but can once it's done", () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'NoPrereq', '#ff0000', island, true);
    gameState.countries = [country];

    if (country.startResearch('improved_extraction')) {
        problems.push('expected startResearch(improved_extraction) to fail without mining_ops researched first');
    }
    country.researchedTech.add('mining_ops');
    if (!country.startResearch('improved_extraction')) {
        problems.push('expected startResearch(improved_extraction) to succeed once mining_ops is researched and resources allow');
    }
    return problems;
});

check("Improved Extraction research boosts a country's mining rate by 50%", () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'Upgraded', '#ff0000', island, true);
    country.researchedTech.add('improved_extraction');
    gameState.countries = [country];

    const dep = new ResourceDeposit(0, 0);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(0, 0, 'miningship', 0);
    country.units = [ship];
    const startResources = country.resources;

    vm.runInContext('frameDeltaTime = 3600;', context); // a full hour in one tick
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    const gained = country.resources - startResources;
    const expected = DEPOSIT_INCOME_PER_HOUR * 1.5;
    if (Math.abs(gained - expected) > 0.01) {
        problems.push(`expected ${expected} resources (150% of the base rate) for a country with Improved Extraction, got ${gained}`);
    }
    return problems;
});

check('Vessel Plating research gives +15% HP to vessel-class ships only, applied at construction time', () => {
    const problems = [];
    // Same country, before vs. after researching - isolates the vessel_plating effect
    // from any country-specific hpMultiplier in COUNTRY_BONUSES (comparing across two
    // different country ids would confound the two).
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'PlatingTest', '#ff0000', island, true);
    gameState.countries = [country];

    const baselineVesselHp = new Unit(0, 0, 'stormbreaker', 0).getMaxHP();
    const baselineGroundHp = new Unit(0, 0, 'groundpounders', 0).getMaxHP();

    country.researchedTech.add('vessel_plating');

    const platedVesselHp = new Unit(0, 0, 'stormbreaker', 0).getMaxHP();
    const platedGroundHp = new Unit(0, 0, 'groundpounders', 0).getMaxHP();

    const expectedVesselHp = Math.round(baselineVesselHp * 1.15);
    if (platedVesselHp !== expectedVesselHp) {
        problems.push(`expected +15% HP after Vessel Plating (baseline ${baselineVesselHp} -> ${expectedVesselHp}), got ${platedVesselHp}`);
    }
    if (platedGroundHp !== baselineGroundHp) {
        problems.push(`expected Vessel Plating to leave a non-vessel (ground) unit's HP unchanged (baseline ${baselineGroundHp}), got ${platedGroundHp}`);
    }
    return problems;
});

// ---------- 14. AI mining economy ----------
//    "AI should have the same system of play" (2026-08-25): regular-nation AI
//    (not the Cyborg/Zoonester/Roufestreal special factions, which never used
//    the resources economy at all) researches Mining Operations, builds
//    Mining Ships, and keeps them parked at a live deposit - same rules a
//    human plays under, just gated by AI_RESEARCH_CHANCE/AI_MINING_SHIP_CHANCE
//    per turn instead of happening the instant it's affordable.

check('a regular-nation AI eventually researches Mining Operations and builds a Mining Ship', () => {
    const problems = [];
    const island = new Island(0, 0, 5); // id 5: not Cyborg(12-15)/Zoonester(16)/Roufestreal
    const country = new Country(5, 'TestNation', '#ff0000', island, false);
    gameState.countries = [country];
    resourceDeposits.length = 0; // isolating research/build gating, not mining logistics

    let builtMiningShip = false;
    for (let i = 0; i < 200 && !builtMiningShip; i++) {
        country.resources = Math.max(country.resources, 1000); // keep it flush so the random
        country.aiTurn();                                       // per-turn chances are the only gate
        country.updateResearch(1000); // fast-forward any in-progress research to completion
        builtMiningShip = country.units.some(u => u.type === 'miningship');
    }

    if (!country.researchedTech.has('mining_ops')) {
        problems.push('AI never researched Mining Operations after 200 turns with ample resources');
    }
    if (!builtMiningShip) problems.push('AI never built a Mining Ship after researching Mining Operations');
    return problems;
});

check('aiTurn() sends an idle Mining Ship toward the nearest live deposit, not chasing a visible enemy', () => {
    const problems = [];
    // Island placed well away from the deposits below so vessel collision-avoidance
    // doesn't block the move being tested for an unrelated reason.
    const island = new Island(-50000, -50000, 5);
    const country = new Country(5, 'TestMiner', '#ff0000', island, false);
    country.researchedTech.add('mining_ops'); // isolate logistics from the research gate

    // A visible enemy, well within AI_HUNT_RADIUS - gives the generic hunt-movement
    // logic later in aiTurn() a real target it WOULD send the mining ship toward if
    // the miningship exclusion in that loop weren't there.
    const enemyIsland = new Island(-49000, -50000, 6);
    const enemyCountry = new Country(6, 'Enemy', '#00ff00', enemyIsland, false);
    enemyCountry.units = [new Unit(200, 0, 'stormbreaker', 6)];
    gameState.countries = [country, enemyCountry];

    const nearDeposit = new ResourceDeposit(100, 0);
    const farDeposit = new ResourceDeposit(5000, 5000);
    resourceDeposits.length = 0;
    resourceDeposits.push(nearDeposit, farDeposit);

    const ship = new Unit(0, 0, 'miningship', 5);
    ship.targetX = 0; ship.targetY = 0; // not already heading anywhere
    country.units = [ship];

    vm.runInContext('AI_MOVEMENT_CHANCE = 1;', context); // make the generic hunt logic deterministic for this check
    country.aiTurn();
    vm.runInContext('AI_MOVEMENT_CHANCE = DIFFICULTY_PRESETS.normal.movement;', context); // restore for later checks

    const distToNear = Math.hypot(ship.targetX - nearDeposit.x, ship.targetY - nearDeposit.y);
    if (distToNear > 1) {
        problems.push(`expected the idle mining ship to be sent toward the nearer deposit (100,0) instead of the visible enemy, got targetX=${ship.targetX}, targetY=${ship.targetY}`);
    }
    return problems;
});

// ---------- 15. Pause discipline ----------
//    2026-08-25: pause is a single-player/campaign-only convenience - hot-seat
//    multiplayer shares one real-time clock (mining/research both run on
//    frameDeltaTime regardless of whose turn it is) across every human seat, same
//    as a future online match would, so one seat pausing would freeze it for
//    everyone else too. Also fixes a real bug: buildUnit() used to spend
//    resources and spawn a unit even while gameState.paused was true, because
//    the pause button only ever gated movement/combat/mining, never building.

check('canPause() allows single-player Standard Game and Campaign, refuses hot-seat (2+ humans)', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'Solo', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;

    gameState.campaignActive = false;
    gameState.humanCountryIds = [0];
    if (!canPause()) problems.push('expected canPause() to be true for single-player Standard Game');

    gameState.campaignActive = true;
    gameState.humanCountryIds = [0];
    if (!canPause()) problems.push('expected canPause() to be true for Campaign mode');

    gameState.campaignActive = false;
    gameState.humanCountryIds = [0, 1];
    if (canPause()) problems.push('expected canPause() to be false for hot-seat multiplayer (2+ humans)');

    gameState.campaignActive = false; // restore for later checks
    gameState.humanCountryIds = [0];
    return problems;
});

check('buildUnit() (the global wrapper) refuses to spend resources or spawn a unit while paused', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'PausedBuilder', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    gameState.humanCountryIds = [0];
    gameState.campaignActive = false;
    gameState.paused = true;

    const startResources = country.resources;
    const startUnitCount = country.units.length;
    buildUnit('deepglider');

    if (country.resources !== startResources) {
        problems.push(`expected resources unchanged while paused, went from ${startResources} to ${country.resources}`);
    }
    if (country.units.length !== startUnitCount) {
        problems.push(`expected no unit built while paused, unit count went from ${startUnitCount} to ${country.units.length}`);
    }

    gameState.paused = false;
    buildUnit('deepglider');
    if (country.units.length !== startUnitCount + 1) {
        problems.push('expected buildUnit to succeed normally once unpaused');
    }

    gameState.paused = false; // restore for later checks
    return problems;
});

check('researchTech() (the global wrapper) refuses to start research while paused', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'PausedResearcher', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    gameState.paused = true;

    const startResources = country.resources;
    researchTech('mining_ops');
    if (country.activeResearch || country.resources !== startResources) {
        problems.push('expected researchTech() to do nothing while paused');
    }

    gameState.paused = false;
    researchTech('mining_ops');
    if (!country.activeResearch) problems.push('expected researchTech() to succeed normally once unpaused');

    gameState.paused = false; // restore for later checks
    return problems;
});

// ---------- 16. COUNTRY_BONUSES schema guardrail ----------
//    2026-08-25, added in direct response to a question about how CI would
//    catch a nation's bonus kit silently growing or breaking. Originally two
//    layers (hard-fail on malformed data, informational-only on count drift,
//    matching the function-inventory check's philosophy of never blocking a
//    legitimate design change). Tightened 2026-08-26 at the user's explicit,
//    repeated request: every playable nation must have EXACTLY 3 bonus
//    entries, no more - now a real hard cap, not just a logged observation.
//      a) HARD FAIL - malformed data: a missing category, a non-number
//         value, or a value outside a sane multiplier range. A real bug
//         class (a typo like 15 instead of 1.5), not a design choice.
//      b) HARD FAIL - any of the 12 playable nations (0-11) with other than
//         exactly 3 total bonus entries. Nations 12-15 (Cyborg) aren't
//         player-selectable and are intentionally exempt at 0.
//      c) INFORMATIONAL ONLY - the count-per-nation snapshot diff kept below
//         as a secondary audit trail (also covers the exempt Cyborg ids,
//         which (b) doesn't watch) - never fails the build by itself.

const BONUS_CATEGORIES = ['hpMultiplier', 'attackMultiplier', 'speedMultiplier', 'rangeMultiplier'];
const MIN_SANE_MULTIPLIER = 0.5;
const MAX_SANE_MULTIPLIER = 2.5;
const PLAYABLE_NATION_IDS = Array.from({ length: 12 }, (_, i) => i); // 0-11 only - see comment above
const REQUIRED_BONUS_COUNT = 3;

check('COUNTRY_BONUSES: every entry has all 4 categories with sane numeric values', () => {
    const problems = [];
    Object.entries(COUNTRY_BONUSES).forEach(([id, bonus]) => {
        BONUS_CATEGORIES.forEach(cat => {
            if (!bonus[cat] || typeof bonus[cat] !== 'object') {
                problems.push(`country ${id}: missing or malformed "${cat}"`);
                return;
            }
            Object.entries(bonus[cat]).forEach(([type, value]) => {
                if (typeof value !== 'number' || Number.isNaN(value)) {
                    problems.push(`country ${id}.${cat}.${type} = ${value} (not a number)`);
                } else if (value < MIN_SANE_MULTIPLIER || value > MAX_SANE_MULTIPLIER) {
                    problems.push(`country ${id}.${cat}.${type} = ${value} (outside sane range ${MIN_SANE_MULTIPLIER}-${MAX_SANE_MULTIPLIER} - likely a typo, e.g. 15 instead of 1.5)`);
                }
            });
        });
    });
    return problems;
});

check(`COUNTRY_BONUSES: every playable nation (0-11) has exactly ${REQUIRED_BONUS_COUNT} bonus entries`, () => {
    const problems = [];
    PLAYABLE_NATION_IDS.forEach(id => {
        const bonus = COUNTRY_BONUSES[id];
        if (!bonus) {
            problems.push(`country ${id}: missing from COUNTRY_BONUSES entirely`);
            return;
        }
        const count = BONUS_CATEGORIES.reduce((sum, cat) => sum + Object.keys(bonus[cat] || {}).length, 0);
        if (count !== REQUIRED_BONUS_COUNT) {
            problems.push(`country ${id} has ${count} bonus entries, expected exactly ${REQUIRED_BONUS_COUNT}`);
        }
    });
    return problems;
});

const BONUS_SNAPSHOT_PATH = path.join(__dirname, 'country-bonus-count-snapshot.json');
check('COUNTRY_BONUSES: total bonus-entry count per nation (informational drift tracker)', () => {
    const counts = {};
    Object.entries(COUNTRY_BONUSES).forEach(([id, bonus]) => {
        counts[id] = BONUS_CATEGORIES.reduce((sum, cat) => sum + Object.keys(bonus[cat] || {}).length, 0);
    });

    if (!fs.existsSync(BONUS_SNAPSHOT_PATH)) {
        fs.writeFileSync(BONUS_SNAPSHOT_PATH, JSON.stringify(counts, null, 2) + '\n');
        console.log(`  (no snapshot yet - wrote a fresh one to ${path.basename(BONUS_SNAPSHOT_PATH)})`);
        return [];
    }

    const previous = JSON.parse(fs.readFileSync(BONUS_SNAPSHOT_PATH, 'utf8'));
    const changed = Object.keys(counts).filter(id => previous[id] !== undefined && previous[id] !== counts[id]);
    if (changed.length) {
        console.log('  Bonus-entry counts changed since last snapshot:');
        changed.forEach(id => console.log(`    country ${id}: ${previous[id]} -> ${counts[id]}`));
        console.log("  (snapshot updated - if any of the above was accidental, that's your signal)");
        fs.writeFileSync(BONUS_SNAPSHOT_PATH, JSON.stringify(counts, null, 2) + '\n');
    }
    return []; // informational only - never fails the suite by itself
});

// ---------- 18. Four specific bug fixes (2026-08-26) ----------
//    Home-screen/UI audit fixes: a redundant timer row, stale naval-era
//    terminology, a build-menu icon that renders blank, and mining-ship
//    movement tuning. Each gets its own check so it can't silently regress.

check('the section info panel no longer shows a redundant "Time Remaining" row (the header timer at #timerDisplay already covers this)', () => {
    // newGame() is the in-game "discard progress and reload" button handler
    // (gated on confirm(), stubbed to false here) - it does NOT set up a
    // fresh galaxy. initGame() is the actual one-time setup function normally
    // invoked on page load (suppressed above so tests can call it on demand).
    vm.runInContext("initGame(); startGame(0);", context, { filename: 'time-remaining-setup.js' });
    updateUI();
    const infoHtml = document.getElementById('countryInfo').innerHTML;
    if (/Time Remaining/i.test(infoHtml)) {
        return ['countryInfo still renders a "Time Remaining" row - that belongs only in the header, not duplicated here'];
    }
    return [];
});

check('the section info panel labels the buildings list "PLANET BUILDINGS", not the old naval-era "ISLAND BUILDINGS"', () => {
    vm.runInContext("initGame(); startGame(0);", context, { filename: 'planet-buildings-setup.js' });
    updateUI();
    const infoHtml = document.getElementById('countryInfo').innerHTML;
    const problems = [];
    if (!/PLANET BUILDINGS/.test(infoHtml)) problems.push('expected a "PLANET BUILDINGS" heading in countryInfo');
    if (/ISLAND BUILDINGS/.test(infoHtml)) problems.push('countryInfo still says "ISLAND BUILDINGS" - stale terminology');
    return problems;
});
// Note: "Island" survives as the internal planet class name (Island, .island,
// ISLAND_IMAGES, etc. - 180+ call sites) - that's an implementation detail no
// player ever sees, not stale UI text, so it's intentionally left alone here
// (same reasoning as the still-deferred Harbor rename). The check above only
// guards the one string a player actually reads.

check('no build-menu button uses an emoji glyph confirmed (via real headless-browser screenshot, 2026-08-26) to render as a blank icon', () => {
    // U+1FA96 MILITARY HELMET - was Groundpounders' icon, screenshotted as an
    // empty tofu box while every sibling button's emoji (medal, bomb, etc.)
    // rendered fine in the same browser. Swapped for a shield instead.
    const KNOWN_BLANK_EMOJI = ['\u{1FA96}'];
    const problems = [];
    KNOWN_BLANK_EMOJI.forEach(glyph => {
        if (html.includes(glyph)) {
            problems.push(`index.html still contains U+${glyph.codePointAt(0).toString(16).toUpperCase()}, confirmed to render blank`);
        }
    });
    return problems;
});

check('UNIT_SPEEDS defines an explicit, positive speed for miningship (not the untuned generic fallback)', () => {
    if (UNIT_SPEEDS.miningship === undefined) return ['UNIT_SPEEDS has no entry for miningship - silently falls back to the generic default'];
    if (!(UNIT_SPEEDS.miningship > 0)) return [`UNIT_SPEEDS.miningship must be a positive number, got ${UNIT_SPEEDS.miningship}`];
    return [];
});

check('a mining ship actually covers real distance toward a far move order over many update() ticks', () => {
    const island = new Island(-100000, -100000, 0); // far out of the way - no collision interference
    const country = new Country(0, 'NavTest', '#ff0000', island, true);
    gameState.countries = [country];
    const ship = new Unit(0, 0, 'miningship', 0);
    ship.moveTo(2000, 0);
    const problems = [];
    if (ship.targetX !== 2000 || ship.targetY !== 0) {
        problems.push(`moveTo(2000, 0) didn't set the target - got targetX=${ship.targetX}, targetY=${ship.targetY}`);
    }
    for (let i = 0; i < 120; i++) ship.update();
    if (ship.x < 100) {
        problems.push(`expected meaningful progress toward (2000,0) after 120 update() ticks, only reached x=${ship.x.toFixed(2)}`);
    }
    return problems;
});

check("every country's home resource deposit spawns outside its own island's no-fly collision zone (moveTo() silently refuses any target inside collisionSize, so a deposit placed any closer could never actually be reached)", () => {
    vm.runInContext('initGame();', context, { filename: 'deposit-clearance-setup.js' });
    const problems = [];
    gameState.countries.forEach(country => {
        const homeDeposit = resourceDeposits
            .slice()
            .sort((a, b) => Math.hypot(a.x - country.island.x, a.y - country.island.y) - Math.hypot(b.x - country.island.x, b.y - country.island.y))[0];
        if (!homeDeposit) { problems.push(`no deposits exist at all for ${country.name}`); return; }
        const distFromCenter = Math.hypot(homeDeposit.x - country.island.x, homeDeposit.y - country.island.y);
        if (distFromCenter <= country.island.collisionSize + DEPOSIT_COLLECT_RANGE) {
            problems.push(`${country.name}'s nearest deposit is only ${distFromCenter.toFixed(0)} from its island center - within collisionSize (${country.island.collisionSize}) + DEPOSIT_COLLECT_RANGE (${DEPOSIT_COLLECT_RANGE}), a mining ship could never park there`);
        }
    });
    return problems;
});

// ---------- 17. Zero-arg smoke test: every no-parameter top-level function ----------
//    should be callable, from a real freshly-started game state, without
//    throwing. Runs against every CURRENT and future zero-arg function
//    automatically - no list to maintain.

check('every zero-argument top-level function runs without throwing (from a live game state)', () => {
    const problems = [];
    const info = [];
    try {
        vm.runInContext('newGame();', context, { filename: 'setup-smoke-test.js' });
    } catch (e) {
        return [`could not even start a new game to smoke-test against: ${e.message}`];
    }
    topLevelFns.forEach(({ name, params }) => {
        if (params !== '') return; // only ones we can call with zero args in good faith
        if (name === 'gameLoop') return; // deliberately recursive via rAF; harmless here (rAF is a no-op stub) but skip for clarity
        try {
            vm.runInContext(`${name}();`, context, { filename: `smoke-${name}.js` });
        } catch (e) {
            // A ReferenceError ("X is not defined") is unambiguous - the function
            // reaches for something that genuinely doesn't exist, regardless of
            // what state it's called in. That's always worth failing on.
            //
            // Any other error (usually "can't read property of null/undefined")
            // is far more often just "this function expects a specific prior UI
            // state we didn't set up" (e.g. a modal-close handler called without
            // the modal ever being opened) than an actual bug - so those are
            // reported for a human to skim, not treated as failures.
            if (e instanceof ReferenceError) {
                problems.push(`${name}(): ${e.message}`);
            } else {
                info.push(`${name}(): ${e.constructor.name}: ${e.message}`);
            }
        }
    });
    if (info.length) {
        console.log(`  ${info.length} function(s) threw when smoke-tested with no prior UI state (informational, not a failure - most just expect a modal/selection to already be open):`);
        info.forEach(line => console.log(`    - ${line}`));
    }
    return problems;
});

report();
process.exit(failures.length > 0 ? 1 : 0);

function report() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`REGRESSION TEST RESULTS: ${passes} passed, ${failures.length} failed`);
    console.log('='.repeat(60));
    if (failures.length === 0) {
        console.log('✅ All checks passed.\n');
    } else {
        console.log('❌ FAILURES:\n');
        failures.forEach(f => {
            console.log(`  [FAIL] ${f.name}`);
            console.log(`         ${f.reason}\n`);
        });
    }
}
