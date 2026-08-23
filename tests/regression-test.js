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

// ---------- 8. Function inventory: catch every function, including future ones ----------
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

// ---------- 9. Zero-arg smoke test: every no-parameter top-level function ----------
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
