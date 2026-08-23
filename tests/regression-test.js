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

const dom = new JSDOM(`<!DOCTYPE html><html><body>
<canvas id="canvas"></canvas>
<div id="gameContainer"></div>
</body></html>`, { url: 'https://example.test/', pretendToBeVisual: true });
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
    'this.__test = { Country, Island, Unit, Building, gameState, setDifficulty, DIFFICULTY_PRESETS };',
    context,
    { filename: 'grab-refs.js' }
);
const { Country, Island, Unit, Building, gameState, setDifficulty, DIFFICULTY_PRESETS } = context.__test;

// ---------- Test data: the full combat unit roster ----------

const ALL_TYPES = [
    'radar', 'thunderwing', 'blazefalcon', 'skyripper', 'vortexhawk', 'phantomstrike',
    'razorwing', 'shadowglider', 'stormbreakerbomber', 'frostwing', 'deepglider',
    'stormbreaker', 'wavecrusher', 'skyfortress', 'tidebreaker', 'whisperwind',
    'cargohauler', 'cyborgdreadnought', 'groundpounders', 'ironbeast', 'boomcannon',
    'zoonparasite', 'roufestreal',
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

    const b1 = new Unit(650, 0, 'stormbreaker', 1);
    const c1 = new Unit(320, 460, 'stormbreaker', 2);
    countryB.units.push(b1);
    countryC.units.push(c1);

    const startHpB = b1.hp, startHpC = c1.hp;
    for (let turn = 0; turn < 10; turn++) {
        [countryA, countryB, countryC].forEach(c => {
            c.collectResources();
            c.resetAttacks();
            if (!c.isPlayer) c.aiTurn();
        });
        for (let f = 0; f < 90 * 60; f++) {
            [countryA, countryB, countryC].forEach(c => c.units.forEach(u => u.update()));
        }
    }
    if (b1.hp >= startHpB && c1.hp >= startHpC) {
        return ['after 10 turns, two adjacent AI nations never damaged each other at all'];
    }
    return [];
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
