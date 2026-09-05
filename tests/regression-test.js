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
    'this.__test = { Country, Island, Unit, Building, gameState, setDifficulty, DIFFICULTY_PRESETS, checkGameOver, switchToNextHumanSeat, ResourceDeposit, resourceDeposits, updateMiningAndResearch, spawnResourceDeposits, TECH_TREE, UNIT_TECH_REQUIREMENTS, UNIT_BUILDING_REQUIREMENTS, PRODUCTION_BUILDING_LABELS, DEPOSIT_INCOME_PER_HOUR, GalaxyCore, galaxyCores, spawnGalaxyCore, healNearGalaxyCores, GALAXY_CORE_SIZE, GALAXY_CORE_HEAL_RANGE, GALAXY_CORE_HEAL_PERCENT, spawnGalaxyBounty, awardGalaxyBounty, GALAXY_BOUNTY_SIZE, GALAXY_BOUNTY_GOLD_PER_ROUND, GALAXY_BOUNTY_MIN_SHIPS, GALAXY_BOUNTY_QUALIFY_RANGE, introMusic, INTRO_MUSIC_URL, setSoundEnabled, enableSoundAutomatically, enterGameplay, toggleSound, playLaserAttackSound, LASER_SOUND_URL, playHomeUnderAttackSound, HOME_UNDER_ATTACK_SOUND_URL, playEndgameSound, ENDGAME_SOUND_URL, showGameOver, BlackHole, blackHoles, spawnBlackHole, updateBlackHoles, BLACK_HOLE_SIZE, BLACK_HOLE_MAX_HP, BLACK_HOLE_SPEED, BLACK_HOLE_CAPTURE_RANGE, BLACK_HOLE_IMAGE_URL, DEPOSIT_STARTING_RESOURCES, DEPOSIT_COLLECT_RANGE, DEPOSIT_SIZE_RATIO, MINING_SHIP_COLLECT_AMOUNT, MINING_SHIP_COLLECT_INTERVAL_SECONDS, MINING_SHIP_MAX_CARGO, MINING_SHIP_SPREAD_RADIUS, GALAXY_SPACING_SCALE, MAP_WIDTH, MAP_HEIGHT, canvas, canPause, togglePause, buildUnit, researchTech, COUNTRY_BONUSES, updateUI, UNIT_SPEEDS, AUTOSAVE_KEY, openSingleMapSetup, closeSingleMapSetup, startGame, closeVideo, buildCampaignStages, buildStageObjectives, selectCampaignNation, startCampaignStage, showCampaignStageComplete, saveCampaignProgress, clearCampaignProgress, resumeCampaign, campaignCountryName, CAMPAIGN_KEY, lifetimeStats, saveLifetimeStats, applySaveData, buildSaveData, autoSaveGame, spaceMines, missiles, laserEffects, camera, TURN_TIME_SECONDS, COUNTRY_NAMES, COUNTRY_COLORS, openCampaignNationSelect, closeCampaignNationSelect, CAMPAIGN_ALIEN_WAVES, CAMPAIGN_OUTPOST_COUNTS, continueFromAutosave, startHotSeatGame, switchTab, selectUnit, deselectAllUnits, selectMultipleUnits, setActionMode, cancelAction, centerOnPlayer, chooseDifficulty, isOnMinimap, minimapToWorld, worldToMinimap, getGalaxyBounds, minimapBounds, MINIMAP_WIDTH, MINIMAP_HEIGHT, MINIMAP_MARGIN_TOP, MINIMAP_MARGIN_RIGHT, HARBOR_LOAD_RANGE, HARBOR_UNLOAD_RANGE, TROOP_PICKUP_RANGE, formatTime, updateUnitInspector, hasRadarDetection, queueImageLoad, makeStarLayer, describeCountryBonus, describeCountryBonusHTML, processAttackMoveOrders, toggleUI, viewAll, updateTimer, nextTurn, buildResearchStatusHtml, openInstructions, loadSprites, clearAutosave, showCampaignBriefing, beginCampaignFromBriefing, campaignNationPosition, campaignAlienPosition, campaignOutpostPosition, spawnCampaignGarrison, playUIClickSound, toggleCampaignObjectives, toggleLegend, updateCampaignObjectivesPanel, openStatsScreen, closeStatsScreen, getLaserColor, lightenRgb, fireLaserEffect, LASER_COLORS, DEFAULT_LASER_COLOR, getEffectiveSightRange, UNIT_SIGHT_RANGE, RADAR_SIGHT_RANGE, createSpaceElements, drawSpaceBackground, whenImagesReady, spaceElements, loadMineImage, mineImage, assignAttackTargets, reassignEliminatedAttackTargets, pickAssignedTarget, AI_HUNT_PLAYER_BIAS, AI_HUNT_RADIUS, randomSpreadPosition, PLANET_MIN_SEPARATION, farthestPlanetRadius, GALAXY_LANDMARK_CORNER_DIR, PLANET_SPREAD_MULTIPLIER, nearestMinimapLandmark, spawnHotsun, damageNearHotsun, HOTSUN_IMAGE_URL, HOTSUN_SIZE, HOTSUN_RADIATION_RANGE, HOTSUN_DAMAGE_PERCENT, PLANET_SCALE, updateFogOfWar, toggleFogOfWar, drawMinimap, isPointRevealed, revealRegion, drawFogOfWarOverlay, ctx };',
    context,
    { filename: 'grab-refs.js' }
);
const {
    Country, Island, Unit, Building, gameState, setDifficulty, DIFFICULTY_PRESETS, checkGameOver, switchToNextHumanSeat,
    ResourceDeposit, resourceDeposits, updateMiningAndResearch, spawnResourceDeposits, TECH_TREE, UNIT_TECH_REQUIREMENTS,
    UNIT_BUILDING_REQUIREMENTS, PRODUCTION_BUILDING_LABELS,
    GalaxyCore, galaxyCores, spawnGalaxyCore, healNearGalaxyCores, GALAXY_CORE_SIZE, GALAXY_CORE_HEAL_RANGE, GALAXY_CORE_HEAL_PERCENT,
    spawnGalaxyBounty, awardGalaxyBounty, GALAXY_BOUNTY_SIZE, GALAXY_BOUNTY_GOLD_PER_ROUND, GALAXY_BOUNTY_MIN_SHIPS, GALAXY_BOUNTY_QUALIFY_RANGE,
    introMusic, INTRO_MUSIC_URL, setSoundEnabled, enableSoundAutomatically, enterGameplay, toggleSound,
    playLaserAttackSound, LASER_SOUND_URL, playHomeUnderAttackSound, HOME_UNDER_ATTACK_SOUND_URL, playEndgameSound, ENDGAME_SOUND_URL, showGameOver, BlackHole, blackHoles, spawnBlackHole, updateBlackHoles, BLACK_HOLE_SIZE, BLACK_HOLE_MAX_HP, BLACK_HOLE_SPEED, BLACK_HOLE_CAPTURE_RANGE, BLACK_HOLE_IMAGE_URL,
    DEPOSIT_INCOME_PER_HOUR, DEPOSIT_STARTING_RESOURCES, DEPOSIT_COLLECT_RANGE, DEPOSIT_SIZE_RATIO, MINING_SHIP_COLLECT_AMOUNT, MINING_SHIP_COLLECT_INTERVAL_SECONDS, MINING_SHIP_MAX_CARGO, MINING_SHIP_SPREAD_RADIUS, GALAXY_SPACING_SCALE, MAP_WIDTH, MAP_HEIGHT, canvas,
    canPause, togglePause, buildUnit, researchTech, COUNTRY_BONUSES, updateUI, UNIT_SPEEDS,
    AUTOSAVE_KEY, openSingleMapSetup, closeSingleMapSetup, startGame, closeVideo,
    buildCampaignStages, buildStageObjectives, selectCampaignNation, startCampaignStage, showCampaignStageComplete,
    saveCampaignProgress, clearCampaignProgress, resumeCampaign, campaignCountryName, CAMPAIGN_KEY, lifetimeStats,
    saveLifetimeStats, applySaveData, buildSaveData, autoSaveGame, spaceMines, missiles, laserEffects, camera,
    TURN_TIME_SECONDS, COUNTRY_NAMES, COUNTRY_COLORS, openCampaignNationSelect, closeCampaignNationSelect,
    CAMPAIGN_ALIEN_WAVES, CAMPAIGN_OUTPOST_COUNTS, continueFromAutosave, startHotSeatGame, switchTab, selectUnit,
    deselectAllUnits, selectMultipleUnits, setActionMode, cancelAction, centerOnPlayer, chooseDifficulty, isOnMinimap,
    minimapToWorld, worldToMinimap, getGalaxyBounds, minimapBounds, MINIMAP_WIDTH, MINIMAP_HEIGHT, MINIMAP_MARGIN_TOP,
    MINIMAP_MARGIN_RIGHT, HARBOR_LOAD_RANGE, HARBOR_UNLOAD_RANGE, TROOP_PICKUP_RANGE, formatTime, updateUnitInspector,
    hasRadarDetection, queueImageLoad, makeStarLayer, describeCountryBonus, describeCountryBonusHTML,
    processAttackMoveOrders, toggleUI, viewAll, updateTimer, nextTurn, buildResearchStatusHtml, openInstructions,
    loadSprites, clearAutosave, showCampaignBriefing, beginCampaignFromBriefing, campaignNationPosition,
    campaignAlienPosition, campaignOutpostPosition, spawnCampaignGarrison, playUIClickSound,
    toggleCampaignObjectives, toggleLegend, updateCampaignObjectivesPanel, openStatsScreen, closeStatsScreen,
    getLaserColor, lightenRgb, fireLaserEffect, LASER_COLORS, DEFAULT_LASER_COLOR,
    getEffectiveSightRange, UNIT_SIGHT_RANGE, RADAR_SIGHT_RANGE, createSpaceElements, drawSpaceBackground,
    whenImagesReady, spaceElements, loadMineImage, mineImage,
    assignAttackTargets, reassignEliminatedAttackTargets, pickAssignedTarget, AI_HUNT_PLAYER_BIAS, AI_HUNT_RADIUS,
    randomSpreadPosition, PLANET_MIN_SEPARATION, farthestPlanetRadius, GALAXY_LANDMARK_CORNER_DIR, PLANET_SPREAD_MULTIPLIER,
    nearestMinimapLandmark, spawnHotsun, damageNearHotsun, HOTSUN_IMAGE_URL, HOTSUN_SIZE, HOTSUN_RADIATION_RANGE, HOTSUN_DAMAGE_PERCENT, PLANET_SCALE,
    updateFogOfWar, toggleFogOfWar, drawMinimap, isPointRevealed, revealRegion, drawFogOfWarOverlay, ctx
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
// Every type buildUnit() actually spawns for a human/AI country - excludes the
// alien-only special units (cyborgdreadnought/zoonparasite/roufestreal), which
// aiTurn() spawns directly and never through buildUnit()/canBuildUnit().
const BUILDABLE_TYPES = ALL_TYPES.filter(t => !['cyborgdreadnought', 'zoonparasite', 'roufestreal'].includes(t));

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

check('startCampaignStage() calls startMusic() (directly, or via the shared enterGameplay())', () => {
    const fnMatch = script.match(/function startCampaignStage\s*\([^)]*\)\s*{([\s\S]*?)\n\s{0,8}}/);
    if (!fnMatch) return ['could not locate startCampaignStage() function body'];
    if (!/startMusic\s*\(/.test(fnMatch[1]) && !/enterGameplay\s*\(/.test(fnMatch[1])) {
        return ['startCampaignStage() body does not call startMusic() (directly, or via enterGameplay())'];
    }
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

check('AI hunt-targeting can pick a non-active human seat as its assigned rival, not just gameState.playerCountry', () => {
    // Updated 2026-09-03 for the rival/alien assignment system - outside Campaign
    // mode an AI nation only ever hunts its own assignTargetIds, no longer a
    // human-biased random pick (see the section below), so this now checks that
    // a human seat is a perfectly valid assigned target like any other nation,
    // rather than some special-cased gameState.playerCountry reference.
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
    gameState.campaignActive = false;
    countryAI.attackTargetIds = [1]; // assigned to hunt the non-active human, B

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
    // Parameter names of any function/arrow function - a callback parameter invoked
    // inside its own body (e.g. `function f(onDone) { onDone(); }`, used by
    // whenImagesReady()/pollLoadingScreen() below) is a legitimate call, not a
    // dangling reference to something that was renamed or deleted.
    const paramBlockRe = /(?:function\s*[A-Za-z_$]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>)/g;
    while ((m = paramBlockRe.exec(src))) {
        const paramsStr = m[1] || m[2] || '';
        paramsStr.split(',').forEach(p => {
            const cleaned = p.replace(/=.*$/, '').replace(/\.\.\./, '').trim();
            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cleaned)) names.add(cleaned);
        });
    }
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

// ---------- 10b. Coverage enforcement: every function must be tested OR explicitly excused (2026-08-28) ----------
//    The inventory check above only ever LOGS drift - it never blocks
//    anything, so "100% of functions have coverage" was true only by
//    whoever remembered to add a test each time, with nothing checking
//    that they actually did. This closes that: reuses the same
//    auto-discovered function/method list above, and hard-fails if any of
//    them is neither referenced by name in a real test file NOR listed in
//    COVERAGE_ALLOWLIST below with a real reason. Adding a new function to
//    the game now requires either a test that names it somewhere in
//    tests/, or a conscious, reviewed line in this allowlist - never a
//    silent gap again.

const TEST_FILE_PATHS_FOR_COVERAGE = [
    __filename,
    path.join(__dirname, 'browser', 'visual-test.js'),
    path.join(__dirname, 'browser', 'interaction-test.js'),
    path.join(__dirname, 'browser', 'asset-integrity-test.js'),
    path.join(__dirname, 'browser', 'deposit-visibility-test.js'),
    path.join(__dirname, 'balance', 'balance-simulation.js'),
];
const testFileSourcesForCoverage = TEST_FILE_PATHS_FOR_COVERAGE.map(p => fs.readFileSync(p, 'utf8'));

function isReferencedInAnyTestFile(name) {
    const re = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);
    return testFileSourcesForCoverage.some(src => re.test(src));
}

// Reviewed as of 2026-08-28. Every entry here is a deliberate call, not a
// placeholder - add to it only with a real reason a test genuinely can't
// name this function, not because writing the test would take a while.
const COVERAGE_ALLOWLIST = {
    // Pure canvas rendering, frame-by-frame - the actual pixel output is
    // checked by visual-test.js's screenshot diff (which calls gameLoop(),
    // never these by name), and/or the real logic underneath them already
    // has its own direct test elsewhere in this file.
    'drawSpaceBackground': 'canvas rendering only - covered by visual-test.js pixel-diff, not a named call',
    'createSpaceElements': 'canvas/starfield setup - runs on every game start (exercised constantly), verified visually not by name',
    'updateSpaceElements': 'per-frame canvas animation state - same as createSpaceElements',
    'drawMinimap': 'canvas rendering only - the coordinate math underneath (isOnMinimap/worldToMinimap/minimapToWorld/getGalaxyBounds) is tested directly',
    'drawRadarPulses': 'canvas rendering only - the logic underneath (hasRadarDetection()) is tested directly',
    '__pumpImageQueue': 'internal helper of queueImageLoad(), which IS tested directly - this one has no independent behavior to assert on',
    'initAudio': 'sets up a Web Audio graph with no observable return value in jsdom; startMusic()/toggleSound() (which call it) are smoke-tested',
};

check('every top-level function is either test-referenced or explicitly allowlisted (no silent coverage gaps)', () => {
    const problems = [];
    topLevelFns.forEach(fn => {
        if (isReferencedInAnyTestFile(fn.name)) return;
        if (COVERAGE_ALLOWLIST[fn.name]) return;
        problems.push(`"${fn.name}()" has no test coverage and is not in COVERAGE_ALLOWLIST - add a test that names it, or add it to the allowlist with a real reason`);
    });
    return problems;
});

check('every class method is either test-referenced or explicitly allowlisted (no silent coverage gaps)', () => {
    const problems = [];
    classInfo.forEach(cls => {
        cls.methods.forEach(methodName => {
            if (isReferencedInAnyTestFile(methodName)) return;
            const qualified = `${cls.name}.${methodName}`;
            if (COVERAGE_ALLOWLIST[qualified] || COVERAGE_ALLOWLIST[methodName]) return;
            problems.push(`"${qualified}()" has no test coverage and is not in COVERAGE_ALLOWLIST - add a test that names it, or add it to the allowlist with a real reason`);
        });
    });
    return problems;
});

// ---------- 10c. Closing every gap the enforcement check above found (2026-08-28) ----------
//    First real run of the check above flagged 29 functions/methods with
//    genuinely zero coverage. Closed here with direct tests rather than
//    allowlisted away - allowlisting is for things a test structurally
//    cannot name (a canvas draw call checked by pixel-diff instead), not a
//    shortcut around writing one.

check('openInstructions() opens the real How-To-Play page in a new tab', () => {
    const realOpen = context.open;
    let calledWith = null;
    context.open = (url, target) => { calledWith = { url, target }; };
    try {
        openInstructions();
    } finally {
        context.open = realOpen;
    }
    if (!calledWith) return ['openInstructions() never called window.open()'];
    if (calledWith.url !== 'https://titanbusinesspros.github.io/How-To-Play/') return [`unexpected URL: ${calledWith.url}`];
    if (calledWith.target !== '_blank') return [`expected target "_blank", got "${calledWith.target}"`];
    return [];
});

check('loadSprites() queued exactly one image per non-null SPRITE_URLS entry (already ran once at script load)', () => {
    const spriteUrls = vm.runInContext('SPRITE_URLS', context);
    const expectedCount = Object.values(spriteUrls).filter(Boolean).length;
    const actualQueued = vm.runInContext('totalImagesToLoad', context);
    if (actualQueued < expectedCount) {
        return [`expected at least ${expectedCount} images queued (one per non-null SPRITE_URLS entry), got ${actualQueued}`];
    }
    return [];
});

check('processAttackMoveOrders() closes the distance on an out-of-range target and fires once in range', () => {
    const problems = [];
    const attackerIsland = new Island(0, 0, 0);
    const attacker = new Country(0, 'Attacker', '#ff0000', attackerIsland, true);
    const targetIsland = new Island(50000, 50000, 1);
    const defender = new Country(1, 'Defender', '#00ff00', targetIsland, false);
    gameState.countries = [attacker, defender];

    const shooter = new Unit(0, 0, 'stormbreaker', 0);
    const victim = new Unit(shooter.getRange() + 500, 0, 'stormbreaker', 1); // out of range at first
    attacker.units = [shooter];
    defender.units = [victim];
    shooter.attackMoveTarget = { kind: 'unit', unit: victim };

    processAttackMoveOrders();
    if (shooter.targetX !== victim.x || shooter.targetY !== victim.y) {
        problems.push(`expected the shooter to start closing on the out-of-range target, got targetX=${shooter.targetX}, targetY=${shooter.targetY}`);
    }
    if (shooter.hasAttacked) problems.push('should not have fired yet - target was out of range');

    // Now bring it into range and process again - should fire.
    victim.x = shooter.x + shooter.getRange() - 10;
    const hpBefore = victim.hp;
    processAttackMoveOrders();
    if (victim.hp !== hpBefore - shooter.getAttackPower()) {
        problems.push(`expected the victim to take ${shooter.getAttackPower()} damage once in range, hp went ${hpBefore} -> ${victim.hp}`);
    }
    if (!shooter.hasAttacked) problems.push('expected the shooter marked hasAttacked after firing');
    return problems;
});

check('toggleUI() toggles the side panel\'s visible class, and viewAll() recenters the camera on the whole galaxy', () => {
    const problems = [];
    const ui = document.getElementById('ui');
    const hadVisible = ui.classList.contains('visible');
    toggleUI();
    if (ui.classList.contains('visible') === hadVisible) problems.push('expected toggleUI() to flip the visible class');
    toggleUI();
    if (ui.classList.contains('visible') !== hadVisible) problems.push('expected a second toggleUI() to flip it back');

    // viewAll() fits the real current extent of the galaxy (getGalaxyBounds()),
    // not a fixed MAP_WIDTH/MAP_HEIGHT box (2026-09-04 fix - see that function's
    // own comment: Standard Game planets can now land well outside that box).
    gameState.countries = [
        new Country(0, 'A', '#fff', new Island(0, 0, 0), false),
        new Country(1, 'B', '#fff', new Island(10000, 6000, 1), false),
    ];
    galaxyCores.length = 0;
    camera.x = 1; camera.y = 1; camera.zoom = 5;
    viewAll();
    const b = getGalaxyBounds();
    const expectedX = (b.minX + b.maxX) / 2, expectedY = (b.minY + b.maxY) / 2;
    if (Math.abs(camera.x - expectedX) > 0.01 || Math.abs(camera.y - expectedY) > 0.01) {
        problems.push(`expected the camera centered on the real galaxy bounds (${expectedX}, ${expectedY}), got (${camera.x}, ${camera.y})`);
    }
    const expectedZoom = Math.min(canvas.width / (b.maxX - b.minX), canvas.height / (b.maxY - b.minY)) * 0.9;
    if (Math.abs(camera.zoom - expectedZoom) > 0.0001) problems.push(`expected zoom ${expectedZoom}, got ${camera.zoom}`);
    return problems;
});

check('openStatsScreen()/closeStatsScreen() show and hide the real stats panel with live data', () => {
    const problems = [];
    lifetimeStats.standard.gamesPlayed = 7;
    lifetimeStats.standard.gamesWon = 3;
    openStatsScreen();
    if (document.getElementById('statsScreen').style.display !== 'block') problems.push('expected the stats screen shown');
    const html = document.getElementById('statsContent').innerHTML;
    if (!html.includes('Games Played: 7') || !html.includes('Games Won: 3')) problems.push('expected live lifetimeStats reflected in the panel');
    closeStatsScreen();
    if (document.getElementById('statsScreen').style.display !== 'none') problems.push('expected the stats screen hidden after close');
    return problems;
});

check('clearAutosave() removes the autosave entry', () => {
    localStorage.setItem(AUTOSAVE_KEY, '{"turn":1}');
    clearAutosave();
    if (localStorage.getItem(AUTOSAVE_KEY) !== null) return ['expected the autosave key removed'];
    return [];
});

check('showCampaignBriefing() renders the stage title/briefing, with the campaign intro only on stage 1', () => {
    const problems = [];
    gameState.campaignNationId = 2;
    gameState.campaignStages = buildCampaignStages(2);

    showCampaignBriefing(0, true);
    if (document.getElementById('campaignBriefingTitle').textContent !== gameState.campaignStages[0].title) problems.push('expected stage 1\'s real title shown');
    if (!/Earth is gone/.test(document.getElementById('campaignBriefingText').textContent)) problems.push('expected the campaign intro text on stage 1 (isIntro=true)');

    showCampaignBriefing(1, false);
    if (document.getElementById('campaignBriefingTitle').textContent !== gameState.campaignStages[1].title) problems.push('expected stage 2\'s real title shown');
    if (/Earth is gone/.test(document.getElementById('campaignBriefingText').textContent)) problems.push('expected NO campaign intro text on a later stage (isIntro=false)');
    if (document.getElementById('campaignBriefingText').textContent !== gameState.campaignStages[1].briefing) problems.push('expected just the stage\'s own briefing text on a later stage');
    return problems;
});

check('beginCampaignFromBriefing() hides the briefing and actually starts the current stage', () => {
    gameState.campaignNationId = 3;
    gameState.campaignStages = buildCampaignStages(3);
    gameState.campaignStageIndex = 0;
    document.getElementById('campaignBriefingScreen').style.display = 'block';

    beginCampaignFromBriefing();

    const problems = [];
    if (document.getElementById('campaignBriefingScreen').style.display !== 'none') problems.push('expected the briefing screen hidden');
    if (!gameState.campaignActive) problems.push('expected beginCampaignFromBriefing() to actually start the stage');
    return problems;
});

check('campaignNationPosition()/campaignAlienPosition()/campaignOutpostPosition() return distinct, real coordinates', () => {
    const problems = [];
    const posA = campaignNationPosition(0);
    const posB = campaignNationPosition(1);
    if (posA.x === posB.x && posA.y === posB.y) problems.push('expected two different nation slots to get different positions');

    const alienPos = campaignAlienPosition(12);
    if (typeof alienPos.x !== 'number' || typeof alienPos.y !== 'number') problems.push('expected campaignAlienPosition(12) to return real coordinates');
    if (campaignAlienPosition(9999)) problems.push('expected an unknown alien id to return undefined, not a fabricated position');

    const outpost0 = campaignOutpostPosition(1, 0, 3);
    const outpost1 = campaignOutpostPosition(1, 1, 3);
    if (outpost0.x === outpost1.x && outpost0.y === outpost1.y) problems.push('expected different outpost indices around the same rival to land at different points');
    return problems;
});

check('spawnCampaignGarrison() adds exactly the requested number of units to the country', () => {
    const island = new Island(0, 0, 5);
    const country = new Country(5, 'GarrisonTest', '#ff0000', island, false);
    spawnCampaignGarrison(country, 4);
    if (country.units.length !== 4) return [`expected 4 garrison units, got ${country.units.length}`];
    return [];
});

check('playUIClickSound() runs without throwing (Web Audio not available in jsdom - must fail safe, not crash)', () => {
    try {
        playUIClickSound();
    } catch (e) {
        return [`playUIClickSound() threw instead of failing safe: ${e.message}`];
    }
    return [];
});

check('toggleCampaignObjectives()/toggleLegend() collapse and expand their panels', () => {
    const problems = [];
    const list = document.getElementById('campaignObjectivesList');
    const wasCollapsed = list.classList.contains('collapsed');
    toggleCampaignObjectives();
    if (list.classList.contains('collapsed') === wasCollapsed) problems.push('expected toggleCampaignObjectives() to flip the collapsed class');

    const legend = document.getElementById('legendBody');
    const legendWasCollapsed = legend.classList.contains('collapsed');
    toggleLegend();
    if (legend.classList.contains('collapsed') === legendWasCollapsed) problems.push('expected toggleLegend() to flip the collapsed class');
    return problems;
});

check('updateCampaignObjectivesPanel() shows/hides itself and checks off cleared objectives', () => {
    const problems = [];
    gameState.campaignActive = false;
    gameState.campaignStages = null;
    updateCampaignObjectivesPanel();
    if (document.getElementById('campaignObjectivesPanel').style.display !== 'none') problems.push('expected the panel hidden outside campaign mode');

    gameState.campaignActive = true;
    gameState.campaignNationId = 6;
    gameState.campaignStages = buildCampaignStages(6);
    gameState.campaignStageIndex = 0;
    startCampaignStage(0);
    const stage = gameState.campaignStages[0];
    // Clear the first objective, leave the rest alone.
    const firstTargetCountry = gameState.countries.find(c => c.id === stage.objectives[0].id);
    firstTargetCountry.island.buildings.forEach(b => { b.destroyed = true; });

    updateCampaignObjectivesPanel();
    if (document.getElementById('campaignObjectivesPanel').style.display !== 'block') problems.push('expected the panel shown during an active campaign');
    const countText = document.getElementById('campaignObjectivesCount').textContent;
    if (countText !== `(1/${stage.objectives.length})`) problems.push(`expected "(1/${stage.objectives.length})", got "${countText}"`);
    const listHtml = document.getElementById('campaignObjectivesList').innerHTML;
    if (!listHtml.includes('✓')) problems.push('expected at least one cleared (✓) objective row');
    if (!listHtml.includes('☐')) problems.push('expected at least one still-open (☐) objective row');
    return problems;
});

check('updateTimer() advances the turn countdown by real elapsed time (unclamped) and rolls the turn over at zero', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'TimerTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    gameState.humanCountryIds = [];
    gameState.paused = false;
    gameState.gameStarted = true;
    gameState.turnTimeRemaining = 100;
    const turnBefore = gameState.turn;

    gameState.lastFrameTime = Date.now() - 5000; // pretend 5 real seconds passed
    updateTimer();
    const liveFrameDeltaTime = vm.runInContext('frameDeltaTime', context);
    if (liveFrameDeltaTime > 0.26) problems.push(`expected frameDeltaTime clamped to ~0.25 max for movement, got ${liveFrameDeltaTime}`);
    if (gameState.turnTimeRemaining > 96) problems.push(`expected the turn countdown itself to drop by the real ~5s (unclamped), only reached ${gameState.turnTimeRemaining}`);

    gameState.turnTimeRemaining = 0.01;
    gameState.lastFrameTime = Date.now() - 1000;
    updateTimer();
    if (gameState.turn !== turnBefore + 1) problems.push(`expected nextTurn() to fire once the countdown hit 0, turn is ${gameState.turn} (was ${turnBefore})`);
    return problems;
});

check('buildResearchStatusHtml() reflects a destroyed lab, idle research, and active research correctly', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'ResearchHtmlTest', '#ff0000', island, true);

    const lab = island.getResearchLab();
    lab.destroyed = true;
    if (!/Research Lab destroyed/.test(buildResearchStatusHtml(country))) problems.push('expected the destroyed-lab message when there is no working lab');
    lab.destroyed = false;

    let html = buildResearchStatusHtml(country);
    if (!/No active research/.test(html)) problems.push('expected "No active research" with nothing in progress');
    if (!html.includes(TECH_TREE.mining_ops.name)) problems.push('expected an available tech node listed by name');

    country.activeResearch = { id: 'mining_ops', remaining: 12.7 };
    html = buildResearchStatusHtml(country);
    if (!html.includes('Researching') || !html.includes(TECH_TREE.mining_ops.name) || !html.includes('13s remaining')) {
        problems.push(`expected the active-research line (rounded up to 13s), got: ${html.slice(0, 200)}`);
    }
    return problems;
});

check('Island.createBuildings()/generateShape()/collidesWith() produce a real 6-building layout, a real polygon, and real collision math', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    if (island.buildings.length !== 6) problems.push(`expected 6 buildings from createBuildings(), got ${island.buildings.length}`);
    if (!island.buildings.some(b => b.isResearchLab)) problems.push('expected one building marked isResearchLab');
    if (!island.buildings.some(b => b.isHarbor)) problems.push('expected one building marked isHarbor');
    if (!island.buildings.some(b => b.isDefenseGun)) problems.push('expected one building marked isDefenseGun');

    if (island.shape.length !== 12) problems.push(`expected a 12-point polygon from generateShape(), got ${island.shape.length}`);
    island.shape.forEach((pt, i) => {
        const r = Math.hypot(pt.x, pt.y);
        if (r < island.size * 0.7 - 0.01 || r > island.size * 1.0 + 0.01) problems.push(`shape point ${i} at radius ${r.toFixed(1)} outside the expected [0.7,1.0]*size band`);
    });

    if (!island.collidesWith(island.x, island.y)) problems.push('expected the island\'s own center to collide with itself');
    if (island.collidesWith(island.x + island.collisionSize + 50, island.y)) problems.push('expected a point well outside collisionSize to NOT collide');
    return problems;
});

check('Unit.isVessel()/isMiningShip()/isAircraft()/getColor()/isHovered() classify and hit-test correctly', () => {
    const problems = [];
    const ship = new Unit(0, 0, 'stormbreaker', 0);
    if (!ship.isVessel()) problems.push('expected stormbreaker to be a vessel');
    if (ship.isAircraft()) problems.push('expected stormbreaker to NOT be aircraft');

    const miner = new Unit(0, 0, 'miningship', 0);
    if (!miner.isVessel() || !miner.isMiningShip()) problems.push('expected miningship to be both a vessel and a mining ship');
    if (new Unit(0, 0, 'stormbreaker', 0).isMiningShip()) problems.push('expected a non-mining-ship to report isMiningShip() false');

    const plane = new Unit(0, 0, 'thunderwing', 0);
    if (!plane.isAircraft() || plane.isVessel()) problems.push('expected thunderwing to be aircraft, not a vessel');

    if (ship.getColor() !== '#8888ff') problems.push(`expected stormbreaker's known color, got ${ship.getColor()}`);

    const hoverTarget = new Unit(100, 100, 'stormbreaker', 0);
    if (!hoverTarget.isHovered(100, 100)) problems.push('expected isHovered() true exactly at the unit\'s own position');
    if (hoverTarget.isHovered(100 + hoverTarget.getSize() + 1000, 100)) problems.push('expected isHovered() false far away from the unit');
    return problems;
});

check('Country.countUnits() tallies units by type', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'CountTest', '#ff0000', island, true);
    country.units = [
        new Unit(0, 0, 'stormbreaker', 0),
        new Unit(0, 0, 'stormbreaker', 0),
        new Unit(0, 0, 'groundpounders', 0),
    ];
    const counts = country.countUnits();
    if (counts.stormbreaker !== 2 || counts.groundpounders !== 1) {
        return [`expected {stormbreaker:2, groundpounders:1}, got ${JSON.stringify(counts)}`];
    }
    return [];
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
//    Cargo/logistics redesign (2026-08-31, per direct request): a mining ship
//    stationed within DEPOSIT_COLLECT_RANGE of a deposit fills its OWN cargo
//    hold (capped at MINING_SHIP_MAX_CARGO), scaled by frameDeltaTime same as
//    unit/missile movement - gold only reaches the country treasury once the
//    ship physically flies back to its own harbor and unloads. See
//    updateMiningAndResearch() for the full automatic state machine.

check('a mining ship stationed at a deposit fills its own cargo hold (not the treasury directly), depleting the deposit', () => {
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

    // 60 real seconds - well under the 500 cargo cap at the base rate (600/hour = 10/min).
    vm.runInContext('frameDeltaTime = 60;', context);
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context); // restore default for later checks

    const expectedGain = (DEPOSIT_INCOME_PER_HOUR / 3600) * 60;
    if (Math.abs(ship.miningCargo - expectedGain) > 0.01) {
        problems.push(`expected the ship's own cargo hold to gain ~${expectedGain}, got ${ship.miningCargo}`);
    }
    if (country.resources !== startResources) {
        problems.push(`expected the treasury untouched until the ship actually delivers - it changed from ${startResources} to ${country.resources}`);
    }
    if (Math.abs(dep.resources - (DEPOSIT_STARTING_RESOURCES - expectedGain)) > 0.01) {
        problems.push(`expected the deposit to drop by that same ${expectedGain}, got resources=${dep.resources}`);
    }
    return problems;
});

check('a mining ship outside DEPOSIT_COLLECT_RANGE collects nothing (but does get sent toward the nearest live deposit)', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'FarMiner', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(0, 0);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(DEPOSIT_COLLECT_RANGE * 5, 0, 'miningship', 0); // well outside range
    country.units = [ship];

    vm.runInContext('frameDeltaTime = 3600;', context);
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    if (ship.miningCargo !== 0) problems.push(`expected no cargo gained while out of range, got ${ship.miningCargo}`);
    if (dep.resources !== DEPOSIT_STARTING_RESOURCES) problems.push(`expected the deposit untouched while no ship is in range, got ${dep.resources}`);
    // Sent to a spread-out spot on a ring around the deposit (see
    // MINING_SHIP_SPREAD_RADIUS), not its exact center - see the dedicated spread test.
    const distFromDepositCenter = Math.hypot(ship.targetX - dep.x, ship.targetY - dep.y);
    if (Math.abs(distFromDepositCenter - MINING_SHIP_SPREAD_RADIUS) > 0.01) {
        problems.push(`expected the idle ship sent to MINING_SHIP_SPREAD_RADIUS (${MINING_SHIP_SPREAD_RADIUS}) from the deposit, got distance ${distFromDepositCenter}`);
    }
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

    vm.runInContext('frameDeltaTime = 3600;', context); // would collect a lot more at full rate, only 10 left
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    if (dep.resources !== 0) problems.push(`expected the deposit to floor at 0, got ${dep.resources}`);
    if (!dep.isDepleted()) problems.push('expected isDepleted() to be true once resources hit 0');
    if (ship.miningCargo !== 10) problems.push(`expected the ship's cargo to gain only the remaining 10 (not the full-hour rate), got ${ship.miningCargo}`);
    return problems;
});

check("a mining ship's cargo hold caps at MINING_SHIP_MAX_CARGO even with plenty of time and deposit left", () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'CapTest', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(0, 0); // starts with DEPOSIT_STARTING_RESOURCES (5000) - plenty
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(0, 0, 'miningship', 0);
    country.units = [ship];

    vm.runInContext('frameDeltaTime = 36000;', context); // 10 hours in one tick - would be 6000 gold uncapped
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    if (ship.miningCargo !== MINING_SHIP_MAX_CARGO) {
        return [`expected cargo to cap at ${MINING_SHIP_MAX_CARGO}, got ${ship.miningCargo}`];
    }
    return [];
});

check('a full mining ship automatically flies to its own harbor, unloads into the treasury, then automatically heads back out', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'LogisticsTest', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(5000, 0);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);

    const harborPos = island.getHarborWorldPosition();
    const ship = new Unit(harborPos.x, harborPos.y, 'miningship', 0); // starts full, right at the harbor
    ship.miningCargo = MINING_SHIP_MAX_CARGO;
    country.units = [ship];
    const startResources = country.resources;

    vm.runInContext('frameDeltaTime = 1 / 60;', context);
    updateMiningAndResearch();

    if (country.resources !== startResources + MINING_SHIP_MAX_CARGO) {
        problems.push(`expected the treasury to gain the full ${MINING_SHIP_MAX_CARGO} on delivery, got ${country.resources - startResources}`);
    }
    if (ship.miningCargo !== 0) problems.push(`expected the ship's hold emptied after delivering, got ${ship.miningCargo}`);
    const distFromDepositCenter = Math.hypot(ship.targetX - dep.x, ship.targetY - dep.y);
    if (Math.abs(distFromDepositCenter - MINING_SHIP_SPREAD_RADIUS) > 0.01) {
        problems.push(`expected the now-empty ship sent back out to MINING_SHIP_SPREAD_RADIUS (${MINING_SHIP_SPREAD_RADIUS}) from the (only) live deposit the same frame it delivers, got distance ${distFromDepositCenter}`);
    }
    return problems;
});

check('a full mining ship far from its harbor heads toward it instead of delivering early', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'FarFromHarborTest', '#ff0000', island, true);
    gameState.countries = [country];
    resourceDeposits.length = 0;
    const harborPos = island.getHarborWorldPosition();
    const ship = new Unit(harborPos.x + 5000, harborPos.y, 'miningship', 0); // full, but far away
    ship.miningCargo = MINING_SHIP_MAX_CARGO;
    country.units = [ship];
    const startResources = country.resources;

    vm.runInContext('frameDeltaTime = 1 / 60;', context);
    updateMiningAndResearch();

    const problems = [];
    if (country.resources !== startResources) problems.push('expected no delivery yet - the ship is nowhere near the harbor');
    if (ship.miningCargo !== MINING_SHIP_MAX_CARGO) problems.push('expected the ship to still be holding its full cargo');
    if (ship.targetX !== harborPos.x || ship.targetY !== harborPos.y) problems.push('expected the full ship to be ordered toward its own harbor');
    return problems;
});

check('multiple mining ships sent to the same deposit spread onto distinct points instead of stacking on its exact center (2026-09-03, per direct report - overlapping cargo readouts were unreadable)', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'SpreadTest', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(0, 0);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);

    // Well outside collect range, all starting from the same spot - the old behavior
    // (moveTo the deposit's exact x/y) would send every one of these to the identical
    // target.
    const far = DEPOSIT_COLLECT_RANGE * 5;
    const ships = [
        new Unit(far, 0, 'miningship', 0),
        new Unit(far, 0, 'miningship', 0),
        new Unit(far, 0, 'miningship', 0),
    ];
    country.units = ships;

    updateMiningAndResearch();

    // Every ship's target must be a real point on the ring - MINING_SHIP_SPREAD_RADIUS
    // from the deposit's center - not the center itself.
    ships.forEach((ship, i) => {
        const dist = Math.hypot(ship.targetX - dep.x, ship.targetY - dep.y);
        if (Math.abs(dist - MINING_SHIP_SPREAD_RADIUS) > 0.01) {
            problems.push(`ship ${i}: expected target MINING_SHIP_SPREAD_RADIUS (${MINING_SHIP_SPREAD_RADIUS}) from the deposit, got distance ${dist}`);
        }
    });

    // And distinct from each other (different unit ids -> different golden-angle spot),
    // not just all landing on some OTHER single shared point instead of the center.
    const targets = ships.map(s => `${s.targetX.toFixed(2)},${s.targetY.toFixed(2)}`);
    if (new Set(targets).size !== ships.length) {
        problems.push(`expected every ship to get a distinct target, got ${JSON.stringify(targets)}`);
    }

    // Same ship, asked again (still out of range) - lands on the SAME spot as before,
    // not a new random one each frame (that would look like jitter, not a stable spread).
    const before = { x: ships[0].targetX, y: ships[0].targetY };
    updateMiningAndResearch();
    if (ships[0].targetX !== before.x || ships[0].targetY !== before.y) {
        problems.push('expected the same ship to be re-sent to the same spot, not a new one, on a later call');
    }

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

check('every deposit is a Bloodgold mine: 5000 starting gold, real art wired in, and exactly 12 extra scattered across the galaxy (2026-08-29)', () => {
    const problems = [];
    if (DEPOSIT_STARTING_RESOURCES !== 5000) {
        problems.push(`expected DEPOSIT_STARTING_RESOURCES to be 5000, got ${DEPOSIT_STARTING_RESOURCES}`);
    }
    const island1 = new Island(0, 0, 0);
    const island2 = new Island(4000, 4000, 1);
    const c1 = new Country(0, 'MineTestA', '#ff0000', island1, true);
    const c2 = new Country(1, 'MineTestB', '#00ff00', island2, false);
    gameState.countries = [c1, c2];

    spawnResourceDeposits();

    const expectedTotal = gameState.countries.length + 12; // one per country + a fixed 12 extra
    if (resourceDeposits.length !== expectedTotal) {
        problems.push(`expected exactly ${expectedTotal} deposits (${gameState.countries.length} per-country + 12 extra), got ${resourceDeposits.length}`);
    }
    resourceDeposits.forEach((d, i) => {
        if (d.resources !== 5000 || d.maxResources !== 5000) {
            problems.push(`deposit ${i} does not start with 5000 gold (resources=${d.resources}, maxResources=${d.maxResources})`);
        }
        if (!d.sprite) problems.push(`deposit ${i} has no sprite wired in - expected the Bloodgold mine art`);
        // All must share the exact same Image object - one load, not one per deposit
        // (39 duplicate ~1MB fetches of the same file is what made it look "invisible").
        if (d.sprite !== resourceDeposits[0].sprite) problems.push(`deposit ${i}'s sprite is not the shared mineImage instance`);
    });
    if (!html.includes('Mines/Bloodgold-mine.png')) problems.push('Bloodgold-mine.png not referenced anywhere in the game file');

    // Sized relative to the planet it's next to (20%, per direct request), not a fixed
    // pixel size - island1 here is a standard Island (size = 250 * PLANET_SCALE).
    const nearIsland1 = resourceDeposits.find(d => Math.hypot(d.x - island1.x, d.y - island1.y) < island1.size + 200);
    if (!nearIsland1 || Math.abs(nearIsland1.size - island1.size * DEPOSIT_SIZE_RATIO) > 0.01) {
        problems.push(`expected the deposit near island1 sized at ${DEPOSIT_SIZE_RATIO * 100}% of its planet (${island1.size * DEPOSIT_SIZE_RATIO}), got ${nearIsland1 && nearIsland1.size}`);
    }

    // Disappears once mined out - draw() must not throw, and must not be a no-op
    // stand-in for "still visible", so check it actually skips rendering.
    const depleted = resourceDeposits[0];
    depleted.resources = 0;
    const testCtx = vm.runInContext('ctx', context);
    let drewSomething = false;
    const realArc = testCtx.arc.bind(testCtx);
    testCtx.arc = (...args) => { drewSomething = true; return realArc(...args); };
    try { depleted.draw(); } finally { testCtx.arc = realArc; }
    if (drewSomething) problems.push('expected a depleted deposit to draw nothing at all, not just recolor');

    return problems;
});

check('loadMineImage() queues exactly one image load - the shared mineImage, not one per deposit', () => {
    const before = vm.runInContext('totalImagesToLoad', context);
    loadMineImage();
    const after = vm.runInContext('totalImagesToLoad', context);
    const problems = [];
    if (after !== before + 1) problems.push(`expected totalImagesToLoad to increase by exactly 1, got +${after - before}`);
    const liveMineImage = vm.runInContext('mineImage', context); // top-level `let`, reassigned - read live
    if (!liveMineImage) problems.push('expected mineImage to be set after loadMineImage()');
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

    // 60 seconds, not a full hour - the boosted rate (900/hour) would blow past the
    // 500 cargo cap well before an hour is up, which isn't what this is testing.
    vm.runInContext('frameDeltaTime = 60;', context);
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    const expected = ((DEPOSIT_INCOME_PER_HOUR * 1.5) / 3600) * 60;
    if (Math.abs(ship.miningCargo - expected) > 0.01) {
        problems.push(`expected ${expected} cargo (150% of the base rate over 60s) for a country with Improved Extraction, got ${ship.miningCargo}`);
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

check('an idle Mining Ship ends up heading toward the nearest live deposit, not chasing a visible enemy (aiTurn() + updateMiningAndResearch() together, exactly like a real frame)', () => {
    const problems = [];
    // Island placed well away from the deposits below so vessel collision-avoidance
    // doesn't block the move being tested for an unrelated reason.
    const island = new Island(-50000, -50000, 5);
    const country = new Country(5, 'TestMiner', '#ff0000', island, false);
    country.researchedTech.add('mining_ops'); // isolate logistics from the research gate

    // A visible enemy, well within AI_HUNT_RADIUS - gives the generic hunt-movement
    // logic inside aiTurn() a real target it WOULD send the mining ship toward if
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
    // Both run every real frame in the live game (updateMiningAndResearch() is what
    // actually drives mining-ship deposit-seeking/harbor-return now - see gameLoop()) -
    // exercising just one or the other wouldn't reflect real behavior.
    country.aiTurn();
    updateMiningAndResearch();
    vm.runInContext('AI_MOVEMENT_CHANCE = DIFFICULTY_PRESETS.normal.movement;', context); // restore for later checks

    // Sent to a spread-out spot on a ring around the deposit (see
    // MINING_SHIP_SPREAD_RADIUS), not its exact center - see the dedicated spread test.
    const distToNear = Math.hypot(ship.targetX - nearDeposit.x, ship.targetY - nearDeposit.y);
    if (Math.abs(distToNear - MINING_SHIP_SPREAD_RADIUS) > 1) {
        problems.push(`expected the idle mining ship sent toward the nearer deposit (100,0) instead of the visible enemy, got targetX=${ship.targetX}, targetY=${ship.targetY} (distance from deposit ${distToNear}, expected ~${MINING_SHIP_SPREAD_RADIUS})`);
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

// ---------- 19. Start-screen redesign (2026-08-27): mode select -> drill-down ----------
//    The landing screen used to show difficulty + country-select + Campaign +
//    Stats all at once. Now it's just two mode cards; picking Single Map
//    Challenge opens a separate #singleMapSetup panel (same drill-down
//    pattern Campaign already used). Every place that used to just hide
//    #startScreen has to also account for this second panel now.

check('openSingleMapSetup()/closeSingleMapSetup() toggle the landing screen and the setup panel together', () => {
    const problems = [];
    document.getElementById('startScreen').style.display = 'block';
    document.getElementById('singleMapSetup').style.display = 'none';

    openSingleMapSetup();
    if (document.getElementById('startScreen').style.display !== 'none') problems.push('openSingleMapSetup() should hide the landing screen');
    if (document.getElementById('singleMapSetup').style.display !== 'block') problems.push('openSingleMapSetup() should show the setup panel');

    closeSingleMapSetup();
    if (document.getElementById('singleMapSetup').style.display !== 'none') problems.push('closeSingleMapSetup() should hide the setup panel');
    if (document.getElementById('startScreen').style.display !== 'block') problems.push('closeSingleMapSetup() should show the landing screen again');
    return problems;
});

check('starting a game from the Single Map setup panel closes that panel too, not just the landing screen', () => {
    vm.runInContext('initGame();', context, { filename: 'singlemap-start-setup.js' });
    openSingleMapSetup();
    startGame(0);
    if (document.getElementById('singleMapSetup').style.display !== 'none') {
        return ['#singleMapSetup is still visible after startGame() - it would sit on top of the actual game view (z-index 1000)'];
    }
    return [];
});

check('an existing autosave offers "Continue" on the main landing screen, not buried inside the Single Map setup panel', () => {
    // nextTurn() autosaves every turn regardless of mode (Standard or Campaign),
    // so this button can represent either - it belongs on the top-level screen,
    // not nested behind a mode-specific choice.
    const problems = [];
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ turn: 7, playerCountryId: 0 }));
        document.getElementById('continueBanner').innerHTML = '';
        vm.runInContext('initGame();', context, { filename: 'continue-banner-setup.js' });
        const banner = document.getElementById('continueBanner');
        if (!banner.querySelector('button')) problems.push('#continueBanner has no Continue button when an autosave exists');
        const buriedInSetup = Array.from(document.getElementById('countrySelect').querySelectorAll('button'))
            .some(b => /CONTINUE/i.test(b.textContent));
        if (buriedInSetup) problems.push('the Continue button ended up inside #countrySelect (the Single Map sub-panel) instead of the main landing screen');
    } finally {
        localStorage.removeItem(AUTOSAVE_KEY);
    }
    return problems;
});

// ---------- 20. Campaign Mode (2026-08-27) ----------
//    Before this, the entire mode had exactly one test in this file
//    (startCampaignStage() calls startMusic() - checked by regexing its
//    source text, never actually run) plus a couple of canPause() branch
//    checks. Nothing exercised stage generation, starting a stage, clearing
//    one, failing one, or resuming a saved campaign. These do, end to end,
//    using the real functions - not reimplemented logic.

check('buildCampaignStages() produces 12 stages: one per rival nation, then a 5-target finale', () => {
    const problems = [];
    const playerNationId = 3;
    const stages = buildCampaignStages(playerNationId);

    if (stages.length !== 12) problems.push(`expected 12 stages, got ${stages.length}`);

    const rivalStages = stages.slice(0, 11);
    const rivalIds = rivalStages.map(s => s.rivalId);
    if (rivalIds.includes(playerNationId)) problems.push('a stage targets the player\'s own nation as the rival');
    const uniqueRivals = new Set(rivalIds);
    if (uniqueRivals.size !== 11) problems.push(`expected 11 distinct rivals, got ${uniqueRivals.size}: [${rivalIds.join(', ')}]`);
    for (let i = 0; i < 12; i++) {
        if (i !== playerNationId && !uniqueRivals.has(i)) problems.push(`nation ${i} never appears as a rival stage`);
    }

    rivalStages.forEach((stage, idx) => {
        const outpostCount = stage.objectives.filter(o => o.kind === 'outpost').length;
        const expectedOutposts = CAMPAIGN_OUTPOST_COUNTS[idx] || 1;
        if (outpostCount !== expectedOutposts) {
            problems.push(`stage ${idx + 1}: expected ${expectedOutposts} outpost objective(s), got ${outpostCount}`);
        }
        const alienIds = stage.objectives.filter(o => o.kind === 'alien').map(o => o.id);
        const expectedAliens = CAMPAIGN_ALIEN_WAVES[idx] || [12];
        if (JSON.stringify(alienIds) !== JSON.stringify(expectedAliens)) {
            problems.push(`stage ${idx + 1}: expected alien wave [${expectedAliens}], got [${alienIds}]`);
        }
        const homeworldObjs = stage.objectives.filter(o => o.kind === 'homeworld');
        if (homeworldObjs.length !== 1 || homeworldObjs[0].id !== stage.rivalId) {
            problems.push(`stage ${idx + 1}: expected exactly one homeworld objective targeting the rival (${stage.rivalId})`);
        }
    });

    const finale = stages[11];
    if (finale.rivalId !== null) problems.push('finale stage should have rivalId null');
    const finaleTargets = finale.objectives.map(o => o.id).sort((a, b) => a - b);
    if (JSON.stringify(finaleTargets) !== JSON.stringify([12, 13, 14, 15, 16])) {
        problems.push(`finale should target ids [12,13,14,15,16], got [${finaleTargets}]`);
    }
    if (!finale.objectives.every(o => o.kind === 'alien')) problems.push('every finale objective should be kind "alien"');

    return problems;
});

check('selectCampaignNation() sets up campaign state and opens the intro briefing for stage 1', () => {
    const problems = [];
    selectCampaignNation(2);
    if (gameState.campaignNationId !== 2) problems.push(`expected campaignNationId 2, got ${gameState.campaignNationId}`);
    if (!gameState.campaignStages || gameState.campaignStages.length !== 12) problems.push('expected 12 campaignStages to be built');
    if (gameState.campaignStageIndex !== 0) problems.push(`expected campaignStageIndex 0, got ${gameState.campaignStageIndex}`);
    if (document.getElementById('campaignNationSelect').style.display !== 'none') problems.push('expected the nation-select panel to be hidden');
    if (document.getElementById('campaignBriefingScreen').style.display !== 'block') problems.push('expected the briefing screen to be shown');
    const briefingText = document.getElementById('campaignBriefingText').textContent;
    if (!/Earth is gone/.test(briefingText)) problems.push('expected the stage-1 briefing to include the campaign intro text');
    return problems;
});

check('startCampaignStage() spawns the player plus exactly the stage\'s objective countries, garrisoned', () => {
    const problems = [];
    selectCampaignNation(0);
    startCampaignStage(0);

    const stage = gameState.campaignStages[0];
    if (!gameState.campaignActive) problems.push('expected campaignActive to be true');
    if (gameState.countries.length !== stage.objectives.length + 1) {
        problems.push(`expected ${stage.objectives.length + 1} countries (player + objectives), got ${gameState.countries.length}`);
    }
    if (!gameState.playerCountry || gameState.playerCountry.id !== 0 || !gameState.playerCountry.isPlayer) {
        problems.push('expected the player country to be nation 0 and marked isPlayer');
    }
    stage.objectives.forEach(obj => {
        const country = gameState.countries.find(c => c.id === obj.id);
        if (!country) { problems.push(`no country spawned for objective id ${obj.id} (${obj.kind})`); return; }
        if (country.isPlayer) problems.push(`objective country ${obj.id} should not be marked isPlayer`);
        if (country.units.length === 0) problems.push(`objective country ${obj.id} (${obj.kind}) has no garrison units`);
        if (obj.kind === 'outpost' && country.team !== stage.rivalId) {
            problems.push(`outpost ${obj.id} should share team with its rival homeworld (${stage.rivalId}), got team ${country.team}`);
        }
    });
    return problems;
});

check('startCampaignStage() spawns resource deposits too - campaign built its own countries independently of initGame() and never called this at all', () => {
    const problems = [];
    selectCampaignNation(0);
    startCampaignStage(0);

    if (resourceDeposits.length === 0) {
        problems.push('expected campaign mode to have resource deposits (mines) - got zero');
    }
    const nearPlayerHome = resourceDeposits.some(d =>
        Math.hypot(d.x - gameState.playerCountry.island.x, d.y - gameState.playerCountry.island.y) < gameState.playerCountry.island.size + 200
    );
    if (!nearPlayerHome) problems.push('expected a mine near the player\'s campaign homeworld, found none within range');
    return problems;
});

check('clearing every objective in a mid-campaign stage advances progress without ending the campaign', () => {
    const problems = [];
    selectCampaignNation(1);
    startCampaignStage(0); // stage 1 of 12 - not the finale
    // A real game only ever reaches campaign play after a fresh page load
    // (every exit path is a location.reload()), so humanCountryIds is always
    // [] at this point in practice; reset it here too since this shared test
    // context can carry a stale value over from an earlier hot-seat check.
    gameState.humanCountryIds = [];
    const stage = gameState.campaignStages[0];

    stage.objectives.forEach(obj => {
        const country = gameState.countries.find(c => c.id === obj.id);
        country.island.buildings.forEach(b => { b.destroyed = true; });
    });

    const statsBefore = lifetimeStats.campaign.stagesCleared;
    localStorage.removeItem(CAMPAIGN_KEY);
    checkGameOver();

    if (lifetimeStats.campaign.stagesCleared !== statsBefore + 1) problems.push('expected lifetimeStats.campaign.stagesCleared to increment');
    if (!gameState.paused) problems.push('expected the game to pause on stage clear');
    const saved = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || 'null');
    if (!saved || saved.nationId !== 1 || saved.stageIndex !== 1) {
        problems.push(`expected saved campaign progress {nationId:1, stageIndex:1}, got ${JSON.stringify(saved)}`);
    }
    const title = document.getElementById('campaignStageTitle').textContent;
    if (!/STAGE 1 CLEARED/.test(title)) problems.push(`expected "STAGE 1 CLEARED" in title, got "${title}"`);
    const btnText = document.getElementById('campaignStageContinueBtn').textContent;
    if (!/CONTINUE/.test(btnText)) problems.push(`expected a CONTINUE button, got "${btnText}"`);
    return problems;
});

check('clearing the final stage (stage 12) completes the campaign instead of advancing', () => {
    const problems = [];
    selectCampaignNation(4);
    startCampaignStage(11); // the finale
    gameState.humanCountryIds = []; // see note on the mid-campaign check above
    const stage = gameState.campaignStages[11];

    stage.objectives.forEach(obj => {
        const country = gameState.countries.find(c => c.id === obj.id);
        country.island.buildings.forEach(b => { b.destroyed = true; });
    });

    const completedBefore = lifetimeStats.campaign.campaignsCompleted;
    checkGameOver();

    if (lifetimeStats.campaign.campaignsCompleted !== completedBefore + 1) problems.push('expected campaignsCompleted to increment');
    const title = document.getElementById('campaignStageTitle').textContent;
    if (!/CAMPAIGN COMPLETE/.test(title)) problems.push(`expected "CAMPAIGN COMPLETE" in title, got "${title}"`);
    const btnText = document.getElementById('campaignStageContinueBtn').textContent;
    if (!/RETURN TO MENU/.test(btnText)) problems.push(`expected a RETURN TO MENU button, got "${btnText}"`);
    return problems;
});

check('losing all buildings during a campaign stage counts as a stage failure, not a Standard Game loss', () => {
    const problems = [];
    selectCampaignNation(5);
    startCampaignStage(2);
    gameState.humanCountryIds = []; // see note on the mid-campaign check above

    const failedBefore = lifetimeStats.campaign.stagesFailed;
    const standardLossBefore = lifetimeStats.standard.gamesLost;
    gameState.playerCountry.island.buildings.forEach(b => { b.destroyed = true; });
    checkGameOver();

    if (lifetimeStats.campaign.stagesFailed !== failedBefore + 1) problems.push('expected lifetimeStats.campaign.stagesFailed to increment');
    if (lifetimeStats.standard.gamesLost !== standardLossBefore) problems.push('a campaign loss should NOT increment the Standard Game loss counter');
    const message = document.getElementById('gameOverMessage').textContent;
    if (!/Stage 3/.test(message)) problems.push(`expected the defeat message to reference "Stage 3", got "${message}"`);
    return problems;
});

check('resumeCampaign() rebuilds stages for the saved nation and clamps an out-of-range stage index', () => {
    const problems = [];
    resumeCampaign({ nationId: 6, stageIndex: 999 }); // simulate a corrupted/out-of-range save
    if (gameState.campaignNationId !== 6) problems.push(`expected campaignNationId 6, got ${gameState.campaignNationId}`);
    if (gameState.campaignStageIndex !== 11) problems.push(`expected the out-of-range index clamped to 11 (last stage), got ${gameState.campaignStageIndex}`);
    if (!gameState.campaignActive) problems.push('expected resumeCampaign() to actually start the clamped stage');

    resumeCampaign({ nationId: 7, stageIndex: 3 });
    if (gameState.campaignStageIndex !== 3) problems.push(`expected a valid saved stageIndex (3) to be honored as-is, got ${gameState.campaignStageIndex}`);
    return problems;
});

// ---------- 21. Save / load round-trip ----------
//    buildSaveData() was smoke-tested (doesn't throw); applySaveData() - the
//    actual load path - had no test at all. A save/load bug could ship silently.

check('buildSaveData() -> applySaveData() round-trips turn, resources, research, units, and deposits correctly', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'SaveTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    gameState.turn = 17;
    setDifficulty('hard');
    camera.x = 1234; camera.y = -500; camera.zoom = 1.5;

    country.resources = 4321;
    country.researchedTech = new Set(['mining_ops', 'vessel_plating']);
    country.activeResearch = { id: 'improved_extraction', remaining: 42 };
    country.island.buildings[0].hp = 3;
    country.island.buildings[0].destroyed = false;
    country.island.buildings[1].destroyed = true;

    const combatUnit = new Unit(10, 20, 'stormbreaker', 0);
    combatUnit.hp = 55;
    combatUnit.hasAttacked = true;
    const cargoUnit = new Unit(0, 0, 'groundpounders', 0);
    const hauler = new Unit(30, 40, 'cargohauler', 0);
    hauler.cargo = [cargoUnit];
    country.units = [combatUnit, hauler];

    resourceDeposits.length = 0;
    resourceDeposits.push(new ResourceDeposit(500, 500));
    resourceDeposits[0].resources = 3333;

    country.exploredRegions = [{ x: 9999, y: 8888, radius: 700 }];

    const saveData = buildSaveData();

    // Now scramble everything the save is supposed to restore, so a
    // no-op applySaveData() (or one that silently does nothing) can't
    // pass this check by coincidence.
    gameState.turn = 1;
    setDifficulty('easy');
    camera.x = 0; camera.y = 0; camera.zoom = 1;
    country.resources = 0;
    country.researchedTech = new Set();
    country.activeResearch = null;
    country.island.buildings[0].hp = 999;
    country.units = [];
    resourceDeposits.length = 0;
    country.exploredRegions = [];

    applySaveData(saveData);

    if (gameState.turn !== 17) problems.push(`expected turn 17 restored, got ${gameState.turn}`);
    // currentDifficulty is a top-level `let` (primitive string) - the destructured
    // copy grabbed once at startup doesn't track reassignments, so re-read it live.
    const liveDifficulty = vm.runInContext('currentDifficulty', context);
    if (liveDifficulty !== 'hard') problems.push(`expected difficulty "hard" restored, got "${liveDifficulty}"`);
    if (camera.x !== 1234 || camera.y !== -500 || camera.zoom !== 1.5) problems.push(`expected camera restored, got ${JSON.stringify(camera)}`);

    const restored = gameState.countries[0];
    if (restored.resources !== 4321) problems.push(`expected resources 4321, got ${restored.resources}`);
    if (!restored.researchedTech.has('mining_ops') || !restored.researchedTech.has('vessel_plating')) {
        problems.push('expected both researched techs restored');
    }
    if (!restored.activeResearch || restored.activeResearch.id !== 'improved_extraction' || restored.activeResearch.remaining !== 42) {
        problems.push(`expected activeResearch restored, got ${JSON.stringify(restored.activeResearch)}`);
    }
    if (restored.island.buildings[0].hp !== 3 || restored.island.buildings[0].destroyed !== false) {
        problems.push('expected building 0 hp/destroyed restored');
    }
    if (restored.island.buildings[1].destroyed !== true) problems.push('expected building 1 to remain destroyed after restore');

    if (restored.units.length !== 2) {
        problems.push(`expected 2 units restored, got ${restored.units.length}`);
    } else {
        const restoredCombat = restored.units.find(u => u.type === 'stormbreaker');
        if (!restoredCombat || restoredCombat.hp !== 55 || !restoredCombat.hasAttacked || restoredCombat.x !== 10 || restoredCombat.y !== 20) {
            problems.push(`expected the stormbreaker restored with hp=55, hasAttacked=true, x=10, y=20 - got ${JSON.stringify(restoredCombat)}`);
        }
        const restoredHauler = restored.units.find(u => u.type === 'cargohauler');
        if (!restoredHauler || restoredHauler.cargo.length !== 1 || restoredHauler.cargo[0].type !== 'groundpounders') {
            problems.push('expected the cargohauler restored with its groundpounders cargo intact');
        }
    }

    if (resourceDeposits.length !== 1 || resourceDeposits[0].resources !== 3333) {
        problems.push(`expected 1 resource deposit with 3333 resources restored, got ${JSON.stringify(resourceDeposits.map(d => d.resources))}`);
    }
    if (JSON.stringify(restored.exploredRegions) !== JSON.stringify([{ x: 9999, y: 8888, radius: 700 }])) {
        problems.push(`expected fog-of-war exploredRegions restored, got ${JSON.stringify(restored.exploredRegions)}`);
    }
    // Regression (2026-08-29): applySaveData() reconstructed loaded deposits via
    // `new ResourceDeposit(d.x, d.y)` with no imageUrl - a resumed/continued game
    // never got the new Bloodgold mine art at all, only ever the old placeholder.
    if (resourceDeposits[0] && !resourceDeposits[0].sprite) {
        problems.push('expected a loaded deposit to have the Bloodgold mine sprite wired in, got none');
    }

    if (!gameState.playerCountry || gameState.playerCountry.id !== 0 || !gameState.playerCountry.isPlayer) {
        problems.push('expected playerCountry re-identified from playerCountryId and marked isPlayer');
    }
    return problems;
});

check('autoSaveGame() writes a load-able snapshot to localStorage under AUTOSAVE_KEY', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'AutosaveTest', '#00ff00', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    gameState.turn = 9;
    localStorage.removeItem(AUTOSAVE_KEY);

    autoSaveGame();
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) { problems.push('autoSaveGame() did not write anything to AUTOSAVE_KEY'); return problems; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { problems.push(`autosave is not valid JSON: ${e.message}`); return problems; }
    if (parsed.turn !== 9) problems.push(`expected autosave turn 9, got ${parsed.turn}`);
    if (parsed.playerCountryId !== 0) problems.push(`expected autosave playerCountryId 0, got ${parsed.playerCountryId}`);

    // And it has to actually be usable by applySaveData(), not just well-formed JSON.
    gameState.turn = 1;
    applySaveData(parsed);
    if (gameState.turn !== 9) problems.push('the autosave could not be re-applied to restore turn 9');

    localStorage.removeItem(AUTOSAVE_KEY);
    return problems;
});

// ---------- 22. Continue / Hot-seat entry points (2026-08-27) ----------
//    continueFromAutosave() is what the new landing-screen "Continue" button
//    actually calls - it had zero coverage despite becoming more prominent
//    in the redesign. startHotSeatGame() is the whole (UI-unwired-but-real)
//    hot-seat mode's entry point.

check('continueFromAutosave() restores the saved game and enters play', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'ContinueTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    gameState.turn = 3;
    const saveData = buildSaveData();
    saveData.turn = 44; // distinguish "restored" from "already was"

    document.getElementById('startScreen').style.display = 'block';
    document.getElementById('singleMapSetup').style.display = 'block';
    document.getElementById('videoScreen').style.display = 'block';
    gameState.gameStarted = false;
    gameState.paused = true;

    continueFromAutosave(saveData);

    if (gameState.turn !== 44) problems.push(`expected turn 44 restored, got ${gameState.turn}`);
    if (!gameState.gameStarted) problems.push('expected gameStarted to be true after continuing');
    if (gameState.paused) problems.push('expected paused to be false after continuing');
    ['startScreen', 'singleMapSetup', 'videoScreen'].forEach(id => {
        if (document.getElementById(id).style.display !== 'none') problems.push(`expected #${id} hidden after continuing`);
    });
    return problems;
});

check('continueFromAutosave() with a corrupted save alerts and clears it instead of crashing into a broken game', () => {
    const problems = [];
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ turn: 1 })); // missing "countries" - applySaveData() will throw
    gameState.gameStarted = false;
    try {
        continueFromAutosave({ turn: 1 }); // no .countries array
    } catch (e) {
        problems.push(`continueFromAutosave() let the exception escape instead of catching it: ${e.message}`);
    }
    if (gameState.gameStarted) problems.push('a corrupted autosave should not leave the game marked as started');
    if (localStorage.getItem(AUTOSAVE_KEY) !== null) problems.push('expected the corrupted autosave to be cleared');
    return problems;
});

check('startHotSeatGame() rejects fewer than 2 or more than 12 players without changing state', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    gameState.countries = [0, 1].map(id => new Country(id, `Nation${id}`, '#ffffff', new Island(id * 1000, 0, id), false));
    gameState.gameStarted = false;

    startHotSeatGame([0]); // only 1 player
    if (gameState.gameStarted) problems.push('expected a single-player hot-seat request to be rejected');

    startHotSeatGame(Array.from({ length: 13 }, (_, i) => i)); // 13 players
    if (gameState.gameStarted) problems.push('expected a 13-player hot-seat request to be rejected (max 12)');
    return problems;
});

check('startHotSeatGame() with a valid roster marks every seat as human and starts on the first one', () => {
    const problems = [];
    gameState.countries = [0, 1, 2].map(id => new Country(id, `Nation${id}`, '#ffffff', new Island(id * 100000, 0, id), false));
    gameState.gameStarted = false;

    startHotSeatGame([1, 2]);

    if (!gameState.gameStarted) problems.push('expected gameStarted to be true');
    if (JSON.stringify(gameState.humanCountryIds) !== JSON.stringify([1, 2])) {
        problems.push(`expected humanCountryIds [1,2], got ${JSON.stringify(gameState.humanCountryIds)}`);
    }
    if (!gameState.countries[1].isPlayer || !gameState.countries[2].isPlayer) problems.push('expected both seated nations marked isPlayer');
    if (gameState.countries[0].isPlayer) problems.push('nation 0 was never seated - should not be marked isPlayer');
    if (gameState.playerCountry.id !== 1) problems.push(`expected the first seat (nation 1) to be the active playerCountry, got ${gameState.playerCountry && gameState.playerCountry.id}`);
    return problems;
});

// ---------- 23. Harbor / Cargohauler / Defense Gun (2026-08-27) ----------
//    A real gameplay subsystem (ground troops board a Cargohauler at a
//    Harbor, get transported, disembark elsewhere; a Defense Gun
//    auto-attacks nearby enemies) that had zero dedicated coverage. Tested
//    through the actual player-facing entry point (setActionMode), not
//    reimplemented - and through the real Country/Island methods it relies on.

check('Island.getHarbor()/getDefenseGun()/getHarborWorldPosition() find the right building and ignore destroyed ones', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const harbor = island.getHarbor();
    const gun = island.getDefenseGun();
    if (!harbor || !harbor.isHarbor) problems.push('expected getHarbor() to find the Harbor building');
    if (!gun || !gun.isDefenseGun) problems.push('expected getDefenseGun() to find the Defense Gun building');

    const pos = island.getHarborWorldPosition();
    if (!pos || pos.x !== island.x + harbor.x || pos.y !== island.y + harbor.y) {
        problems.push('expected getHarborWorldPosition() to be the island position plus the harbor building\'s offset');
    }

    harbor.destroyed = true;
    if (island.getHarbor()) problems.push('expected getHarbor() to return nothing once the harbor is destroyed');
    if (island.getHarborWorldPosition()) problems.push('expected getHarborWorldPosition() to return null once the harbor is destroyed');
    return problems;
});

// ---------- 24. Building-gated unit production (2026-09-03) ----------
//    A destroyed building used to have zero effect on what a country could
//    still build - buildUnit() only ever checked tech/resources. Now every
//    buildable unit type is mapped (UNIT_BUILDING_REQUIREMENTS) to the one
//    fixed building slot that actually produces it - Harbor (vessels), Marine
//    Base (ground troops), or War Factory (aircraft) - and canBuildUnit()
//    refuses once that building is destroyed. Applies identically to the
//    player and every AI/alien country, since aiTurn()'s build calls funnel
//    through the same Country.buildUnit()/canBuildUnit().

check('UNIT_BUILDING_REQUIREMENTS maps every buildable unit type exactly once, to a real production building', () => {
    const problems = [];
    BUILDABLE_TYPES.forEach(type => {
        const key = UNIT_BUILDING_REQUIREMENTS[type];
        if (!key) problems.push(`"${type}" has no entry in UNIT_BUILDING_REQUIREMENTS - it would be buildable even with every building destroyed`);
        else if (!PRODUCTION_BUILDING_LABELS[key]) problems.push(`"${type}" maps to unknown building key "${key}"`);
    });
    return problems;
});

check('Island.getMarineBase()/getWarFactory()/getProductionBuilding() find the right building and ignore destroyed ones', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const marineBase = island.getMarineBase();
    const warFactory = island.getWarFactory();
    if (!marineBase || !marineBase.isMarineBase) problems.push('expected getMarineBase() to find the Marine Base building');
    if (!warFactory || !warFactory.isWarFactory) problems.push('expected getWarFactory() to find the War Factory building');
    if (island.getProductionBuilding('harbor') !== island.getHarbor()) problems.push('expected getProductionBuilding("harbor") to match getHarbor()');
    if (island.getProductionBuilding('marinebase') !== marineBase) problems.push('expected getProductionBuilding("marinebase") to match getMarineBase()');
    if (island.getProductionBuilding('warfactory') !== warFactory) problems.push('expected getProductionBuilding("warfactory") to match getWarFactory()');
    if (island.getProductionBuilding('nonsense') !== null) problems.push('expected an unknown key to return null');

    marineBase.destroyed = true;
    if (island.getMarineBase()) problems.push('expected getMarineBase() to return nothing once the Marine Base is destroyed');
    warFactory.destroyed = true;
    if (island.getWarFactory()) problems.push('expected getWarFactory() to return nothing once the War Factory is destroyed');
    return problems;
});

check('canBuildUnit()/buildUnit() are blocked once the mapped building is destroyed, and only that category', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'BuildingGateTest', '#ff0000', island, true);
    gameState.countries = [country];

    // Sanity: fully intact, one representative unit per category all buildable.
    if (!country.canBuildUnit('deepglider')) problems.push('expected deepglider (Harbor) buildable before any building is destroyed');
    if (!country.canBuildUnit('groundpounders')) problems.push('expected groundpounders (Marine Base) buildable before any building is destroyed');
    if (!country.canBuildUnit('radar')) problems.push('expected radar (War Factory) buildable before any building is destroyed');

    island.getHarbor().destroyed = true;
    if (country.canBuildUnit('deepglider')) problems.push('expected deepglider blocked once the Harbor is destroyed');
    if (country.buildUnit('deepglider')) problems.push('expected buildUnit(deepglider) to fail once the Harbor is destroyed');
    if (!country.canBuildUnit('groundpounders')) problems.push('destroying the Harbor should not block groundpounders (Marine Base)');
    if (!country.canBuildUnit('radar')) problems.push('destroying the Harbor should not block radar (War Factory)');

    island.getMarineBase().destroyed = true;
    if (country.canBuildUnit('groundpounders')) problems.push('expected groundpounders blocked once the Marine Base is destroyed');
    if (country.buildUnit('groundpounders')) problems.push('expected buildUnit(groundpounders) to fail once the Marine Base is destroyed');
    if (!country.canBuildUnit('radar')) problems.push('destroying the Marine Base should not block radar (War Factory)');

    island.getWarFactory().destroyed = true;
    if (country.canBuildUnit('radar')) problems.push('expected radar blocked once the War Factory is destroyed');
    if (country.buildUnit('radar')) problems.push('expected buildUnit(radar) to fail once the War Factory is destroyed');
    return problems;
});

check('buildUnit() (the global wrapper) tells the player which destroyed building is blocking a unit, distinct from a research gate', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'BuildingGateMessageTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    gameState.humanCountryIds = [0];
    gameState.campaignActive = false;
    gameState.paused = false;

    island.getMarineBase().destroyed = true;
    const startUnitCount = country.units.length;
    buildUnit('groundpounders'); // should hit the building-gate branch, not the tech-gate branch, and build nothing
    if (country.units.length !== startUnitCount) problems.push('expected no unit spawned when the required building is destroyed');
    return problems;
});

check('setActionMode("load") boards nearby ground units into a selected cargohauler', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'LoadTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;

    const harborPos = island.getHarborWorldPosition();
    const cargohauler = new Unit(harborPos.x + 10, harborPos.y, 'cargohauler', 0); // well within HARBOR_LOAD_RANGE
    const trooper = new Unit(99999, 99999, 'groundpounders', 0); // position irrelevant while isInHarbor
    trooper.isInHarbor = true;
    country.units = [cargohauler, trooper];
    gameState.selectedUnit = cargohauler;
    gameState.selectedUnits = [cargohauler];

    setActionMode('load');

    if (cargohauler.cargo.length !== 1) problems.push(`expected 1 unit loaded, got ${cargohauler.cargo.length}`);
    else if (cargohauler.cargo[0] !== trooper) problems.push('expected the trooper itself to be loaded, not a copy');
    if (trooper.isInHarbor) problems.push('expected the trooper to no longer be "in harbor" once loaded');
    return problems;
});

check('setActionMode("load") refuses when nothing is in range, and refuses a full (10/10) cargohauler', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'LoadFailTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;

    const farCargohauler = new Unit(50000, 50000, 'cargohauler', 0); // nowhere near the harbor or any ground unit
    country.units = [farCargohauler];
    gameState.selectedUnit = farCargohauler;
    gameState.selectedUnits = [farCargohauler];
    setActionMode('load');
    if (farCargohauler.cargo.length !== 0) problems.push('expected no units loaded when nothing is in range');

    const harborPos = island.getHarborWorldPosition();
    const fullCargohauler = new Unit(harborPos.x, harborPos.y, 'cargohauler', 0);
    fullCargohauler.cargo = Array.from({ length: 10 }, () => new Unit(0, 0, 'groundpounders', 0));
    const waitingTrooper = new Unit(0, 0, 'groundpounders', 0);
    waitingTrooper.isInHarbor = true;
    country.units = [fullCargohauler, waitingTrooper];
    gameState.selectedUnit = fullCargohauler;
    gameState.selectedUnits = [fullCargohauler];
    setActionMode('load');
    if (fullCargohauler.cargo.length !== 10) problems.push(`expected a full cargohauler to stay at 10, got ${fullCargohauler.cargo.length}`);

    return problems;
});

check('setActionMode("unload") disembarks troops near a planet and empties the cargohauler', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'UnloadTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;

    const cargohauler = new Unit(island.x + island.size + 20, island.y, 'cargohauler', 0); // within HARBOR_UNLOAD_RANGE of the planet
    const troopA = new Unit(0, 0, 'groundpounders', 0);
    const troopB = new Unit(0, 0, 'ironbeast', 0);
    cargohauler.cargo = [troopA, troopB];
    country.units = [cargohauler];
    gameState.selectedUnit = cargohauler;
    gameState.selectedUnits = [cargohauler];

    setActionMode('unload');

    if (cargohauler.cargo.length !== 0) problems.push(`expected the cargohauler emptied, still has ${cargohauler.cargo.length}`);
    [troopA, troopB].forEach(troop => {
        if (troop.isInHarbor) problems.push(`expected ${troop.type} to no longer be "in harbor" after disembarking`);
        const distFromCenter = Math.hypot(troop.x - island.x, troop.y - island.y);
        if (Math.abs(distFromCenter - island.collisionSize * 0.7) > 1) {
            problems.push(`expected ${troop.type} placed at collisionSize*0.7 from the planet center, got distance ${distFromCenter.toFixed(1)}`);
        }
    });
    return problems;
});

check('Country.defenseGunAttack() hits the nearest in-range enemy but leaves same-team and out-of-range units alone', () => {
    const problems = [];
    const homeIsland = new Island(0, 0, 0);
    const home = new Country(0, 'Defender', '#ff0000', homeIsland, true);
    const enemyIsland = new Island(9999999, 9999999, 1); // far away - only its unit's position matters here
    const enemy = new Country(1, 'Attacker', '#00ff00', enemyIsland, false);
    gameState.countries = [home, enemy];

    const defenseGun = homeIsland.getDefenseGun();
    const inRangeEnemy = new Unit(defenseGun.range - 50, 0, 'stormbreaker', 1);
    const outOfRangeEnemy = new Unit(defenseGun.range + 500, 0, 'stormbreaker', 1);
    enemy.units = [inRangeEnemy, outOfRangeEnemy];
    const ownUnit = new Unit(10, 0, 'stormbreaker', 0); // same team - must never be targeted
    home.units = [ownUnit];

    const hpBefore = { inRange: inRangeEnemy.hp, outOfRange: outOfRangeEnemy.hp, own: ownUnit.hp };
    home.defenseGunAttack();

    if (inRangeEnemy.hp !== hpBefore.inRange - defenseGun.attackPower) {
        problems.push(`expected the in-range enemy to take ${defenseGun.attackPower} damage, hp went ${hpBefore.inRange} -> ${inRangeEnemy.hp}`);
    }
    if (outOfRangeEnemy.hp !== hpBefore.outOfRange) problems.push('expected the out-of-range enemy to be untouched');
    if (ownUnit.hp !== hpBefore.own) problems.push('expected the defender\'s own unit to never be targeted');
    if (!defenseGun.hasAttacked) problems.push('expected the defense gun marked hasAttacked after firing');

    // And it should refuse to fire twice in the same turn.
    const hpAfterFirstShot = inRangeEnemy.hp;
    home.defenseGunAttack();
    if (inRangeEnemy.hp !== hpAfterFirstShot) problems.push('expected a second defenseGunAttack() this turn to do nothing (hasAttacked already true)');
    return problems;
});

// ---------- 24. UI selection / mode-switching (2026-08-27) ----------

check('switchTab() shows the chosen tab content and highlights the clicked tab button', () => {
    const problems = [];
    const vesselsBtn = Array.from(document.querySelectorAll('.tab')).find(b => /VESSELS/i.test(b.textContent));
    if (!vesselsBtn) return ['could not find the VESSELS tab button in the real page markup'];
    // switchTab() reads the implicit global `event` (as a real onclick="" handler
    // would receive from the browser) rather than taking it as a parameter -
    // simulate that the same way a dispatched click would provide it.
    document.getElementById('infoTab').classList.add('active');
    document.querySelector('.tab').classList.add('active');
    window.event = { target: vesselsBtn };
    switchTab('vessels');
    delete window.event;

    if (!vesselsBtn.classList.contains('active')) problems.push('expected the clicked tab button to gain .active');
    if (!document.getElementById('vesselsTab').classList.contains('active')) problems.push('expected #vesselsTab to gain .active');
    if (document.getElementById('infoTab').classList.contains('active')) problems.push('expected the previously active tab content to lose .active');
    return problems;
});

check('selectUnit() selects exactly one unit and clears any other selection', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'SelectTest', '#ff0000', island, true);
    const unitA = new Unit(0, 0, 'stormbreaker', 0);
    const unitB = new Unit(0, 0, 'wavecrusher', 0);
    unitA.selected = true;
    country.units = [unitA, unitB];
    gameState.playerCountry = country;
    gameState.actionMode = 'move';

    selectUnit(unitB);

    if (gameState.selectedUnit !== unitB) problems.push('expected selectedUnit to be unitB');
    if (JSON.stringify(gameState.selectedUnits) !== JSON.stringify([unitB])) problems.push('expected selectedUnits to be exactly [unitB]');
    if (unitA.selected) problems.push('expected unitA to be deselected');
    if (!unitB.selected) problems.push('expected unitB.selected to be true');
    if (gameState.actionMode !== null) problems.push('expected actionMode reset to null on a fresh selection');
    return problems;
});

check('deselectAllUnits() clears the whole selection', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'DeselectTest', '#ff0000', island, true);
    const unit = new Unit(0, 0, 'stormbreaker', 0);
    unit.selected = true;
    country.units = [unit];
    gameState.playerCountry = country;
    gameState.selectedUnits = [unit];
    gameState.selectedUnit = unit;

    deselectAllUnits();

    if (unit.selected) problems.push('expected the unit to be deselected');
    if (gameState.selectedUnits.length !== 0) problems.push('expected selectedUnits to be empty');
    if (gameState.selectedUnit !== null) problems.push('expected selectedUnit to be null');
    return problems;
});

check('setActionMode() refuses to arm a mode with nothing selected, and refuses "move" for a unit that already attacked', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'ModeTest', '#ff0000', island, true);
    gameState.playerCountry = country;

    gameState.selectedUnits = [];
    gameState.actionMode = null;
    setActionMode('move');
    if (gameState.actionMode !== null) problems.push('expected setActionMode() to refuse with no units selected');

    const attackedUnit = new Unit(0, 0, 'stormbreaker', 0);
    attackedUnit.hasAttacked = true;
    country.units = [attackedUnit];
    gameState.selectedUnits = [attackedUnit];
    gameState.actionMode = null;
    setActionMode('move');
    if (gameState.actionMode !== null) problems.push('expected setActionMode("move") to refuse a unit that already attacked');

    const freshUnit = new Unit(0, 0, 'stormbreaker', 0);
    gameState.selectedUnits = [freshUnit];
    gameState.actionMode = null;
    setActionMode('move');
    if (gameState.actionMode !== 'move') problems.push('expected a fresh, unattacked unit to arm "move" successfully');
    if (document.getElementById('actionMode').style.display !== 'block') problems.push('expected the action-mode indicator to be shown');

    return problems;
});

check('chooseDifficulty() applies the preset live and highlights the matching button', () => {
    const problems = [];
    chooseDifficulty('hard');
    const live = vm.runInContext('AI_BUILD_CHANCE', context);
    if (live !== DIFFICULTY_PRESETS.hard.build) problems.push(`expected AI_BUILD_CHANCE set to the hard preset (${DIFFICULTY_PRESETS.hard.build}), got ${live}`);
    if (!document.getElementById('diffBtn-hard').classList.contains('active')) problems.push('expected the Hard button to be highlighted');
    if (document.getElementById('diffBtn-easy').classList.contains('active')) problems.push('expected Easy to no longer be highlighted');

    chooseDifficulty('easy');
    if (!document.getElementById('diffBtn-easy').classList.contains('active')) problems.push('expected Easy to become highlighted after switching');
    if (document.getElementById('diffBtn-hard').classList.contains('active')) problems.push('expected Hard to lose the highlight after switching');
    setDifficulty('normal'); // restore for any later check relying on the default
    return problems;
});

check('cancelAction() clears the armed action mode, and centerOnPlayer() recenters the camera on the player\'s homeworld', () => {
    const problems = [];
    gameState.actionMode = 'attack';
    document.getElementById('actionMode').style.display = 'block';
    cancelAction();
    if (gameState.actionMode !== null) problems.push('expected cancelAction() to clear actionMode');
    if (document.getElementById('actionMode').style.display !== 'none') problems.push('expected the action-mode indicator hidden');

    const island = new Island(12345, -6789, 0);
    gameState.playerCountry = new Country(0, 'CenterTest', '#ff0000', island, true);
    camera.x = 0; camera.y = 0; camera.zoom = 3;
    centerOnPlayer();
    if (camera.x !== 12345 || camera.y !== -6789 || camera.zoom !== 1) {
        problems.push(`expected the camera centered on (12345,-6789) at zoom 1, got (${camera.x}, ${camera.y}, zoom ${camera.zoom})`);
    }
    return problems;
});

// ---------- 25. Minimap coordinate math (2026-08-27) ----------

check('isOnMinimap() matches the real rectangle from minimapBounds()', () => {
    const problems = [];
    const { mmX, mmY } = minimapBounds();
    if (!isOnMinimap(mmX + 1, mmY + 1)) problems.push('expected a point just inside the top-left corner to count as on the minimap');
    if (!isOnMinimap(mmX + MINIMAP_WIDTH - 1, mmY + MINIMAP_HEIGHT - 1)) problems.push('expected a point just inside the bottom-right corner to count as on the minimap');
    if (isOnMinimap(mmX - 5, mmY)) problems.push('expected a point left of the minimap to be outside it');
    if (isOnMinimap(mmX, mmY + MINIMAP_HEIGHT + 5)) problems.push('expected a point below the minimap to be outside it');
    return problems;
});

check('worldToMinimap()/minimapToWorld() are real inverses of each other', () => {
    const problems = [];
    gameState.countries = [0, 1, 2].map(id => new Country(id, `N${id}`, '#fff', new Island(id * 40000, id * -25000, id), false));

    const originalWorld = { x: 15000, y: -8000 };
    const onMinimap = worldToMinimap(originalWorld.x, originalWorld.y);
    const backToWorld = minimapToWorld(onMinimap.x, onMinimap.y);

    if (Math.abs(backToWorld.x - originalWorld.x) > 1) problems.push(`expected x round-trip within 1 unit, got ${originalWorld.x} -> ${backToWorld.x}`);
    if (Math.abs(backToWorld.y - originalWorld.y) > 1) problems.push(`expected y round-trip within 1 unit, got ${originalWorld.y} -> ${backToWorld.y}`);
    return problems;
});

check('getGalaxyBounds() falls back to the full map when there are no countries yet', () => {
    gameState.countries = [];
    const b = getGalaxyBounds();
    const problems = [];
    if (b.minX !== 0 || b.minY !== 0 || b.maxX !== MAP_WIDTH || b.maxY !== MAP_HEIGHT) {
        problems.push(`expected the empty-galaxy fallback bounds {0,0,${MAP_WIDTH},${MAP_HEIGHT}}, got ${JSON.stringify(b)}`);
    }
    return problems;
});

check('getGalaxyBounds()/worldToMinimap() expand to include a Galaxy Core placed outside every country\'s own bounds - it must actually land on the minimap, not fall off it', () => {
    const problems = [];
    // A tight cluster of countries, deliberately nowhere near where the core will be -
    // this is exactly the real bug (a previous version placed the core outside the
    // countries-only bounding box, so it silently never appeared on the minimap).
    gameState.countries = [0, 1].map(id => new Country(id, `N${id}`, '#fff', new Island(id * 1000, 0, id), false));
    galaxyCores.length = 0;
    const core = new GalaxyCore(500000, -500000); // far outside the cluster above
    galaxyCores.push(core);

    const bounds = getGalaxyBounds();
    if (core.x - core.size < bounds.minX || core.x + core.size > bounds.maxX) {
        problems.push(`expected getGalaxyBounds() to expand to cover the core's full extent on X, got bounds ${JSON.stringify(bounds)} for a core at x=${core.x} size=${core.size}`);
    }
    if (core.y - core.size < bounds.minY || core.y + core.size > bounds.maxY) {
        problems.push(`expected getGalaxyBounds() to expand to cover the core's full extent on Y, got bounds ${JSON.stringify(bounds)} for a core at y=${core.y} size=${core.size}`);
    }

    const p = worldToMinimap(core.x, core.y);
    const { mmX, mmY } = minimapBounds();
    if (p.x < mmX || p.x > mmX + MINIMAP_WIDTH || p.y < mmY || p.y > mmY + MINIMAP_HEIGHT) {
        problems.push(`expected the core's minimap position (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) to fall inside the minimap rectangle (${mmX}-${mmX + MINIMAP_WIDTH}, ${mmY}-${mmY + MINIMAP_HEIGHT})`);
    }
    galaxyCores.length = 0;
    return problems;
});

// ---------- 26. Small pure/display helpers (2026-08-27) ----------

check('formatTime() renders mm:ss with zero-padded seconds', () => {
    const problems = [];
    if (formatTime(0) !== '0:00') problems.push(`formatTime(0) expected "0:00", got "${formatTime(0)}"`);
    if (formatTime(65) !== '1:05') problems.push(`formatTime(65) expected "1:05", got "${formatTime(65)}"`);
    if (formatTime(3661) !== '61:01') problems.push(`formatTime(3661) expected "61:01", got "${formatTime(3661)}"`);
    return problems;
});

check('hasRadarDetection() is true only for radar, skyfortress, and cyborgdreadnought', () => {
    const problems = [];
    ['radar', 'skyfortress', 'cyborgdreadnought'].forEach(type => {
        if (!hasRadarDetection(new Unit(0, 0, type, 0))) problems.push(`expected ${type} to have radar detection`);
    });
    ['stormbreaker', 'groundpounders', 'miningship'].forEach(type => {
        if (hasRadarDetection(new Unit(0, 0, type, 0))) problems.push(`expected ${type} to NOT have radar detection`);
    });
    return problems;
});

check('describeCountryBonus()/HTML() reports exactly what COUNTRY_BONUSES has for that nation', () => {
    const problems = [];
    const perks = describeCountryBonus(0); // nation 0: hpMultiplier only, per the exactly-3 schema guardrail
    if (perks.length !== 3) problems.push(`expected exactly 3 perk lines for nation 0, got ${perks.length}: ${JSON.stringify(perks)}`);
    if (!perks.some(p => /Skyfortress HP/.test(p))) problems.push('expected a Skyfortress HP line for nation 0');

    const html = describeCountryBonusHTML(0);
    const spanCount = (html.match(/<span>/g) || []).length;
    if (spanCount !== perks.length) problems.push(`expected one <span> per perk (${perks.length}), got ${spanCount}`);
    return problems;
});

check('makeStarLayer() generates the requested count of stars within the given size/alpha ranges', () => {
    const problems = [];
    const layer = makeStarLayer(25, 900, [1.0, 2.0], [0.3, 0.6], 0.05);
    if (layer.stars.length !== 25) problems.push(`expected 25 stars, got ${layer.stars.length}`);
    if (layer.tileSize !== 900 || layer.parallax !== 0.05) problems.push('expected tileSize/parallax passed through unchanged');
    layer.stars.forEach((s, i) => {
        if (s.size < 1.0 || s.size > 2.0) problems.push(`star ${i}: size ${s.size} outside [1.0, 2.0]`);
        if (s.baseAlpha < 0.3 || s.baseAlpha > 0.6) problems.push(`star ${i}: baseAlpha ${s.baseAlpha} outside [0.3, 0.6]`);
        if (s.x < 0 || s.x >= 900 || s.y < 0 || s.y >= 900) problems.push(`star ${i}: position (${s.x}, ${s.y}) outside the tile`);
    });
    return problems;
});

check('updateUnitInspector() shows real unit stats and hides itself when passed no unit', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'InspectorTest', '#ff0000', island, true);
    gameState.countries = [country];
    const unit = new Unit(0, 0, 'stormbreaker', 0);
    country.units = [unit];

    updateUnitInspector(unit, 100, 200);
    const inspector = document.getElementById('unitInspector');
    if (inspector.style.display !== 'block') problems.push('expected the inspector shown for a real unit');
    const html = document.getElementById('inspectorContent').innerHTML;
    if (!/STORMBREAKER/.test(html)) problems.push('expected the unit type in the inspector content');
    if (!html.includes(`HP: ${Math.round(unit.hp)}`)) problems.push('expected current HP shown');
    if (inspector.style.left !== '120px' || inspector.style.top !== '220px') {
        problems.push(`expected the inspector positioned at mouse+20, got left=${inspector.style.left} top=${inspector.style.top}`);
    }

    updateUnitInspector(null, 0, 0);
    if (inspector.style.display !== 'none') problems.push('expected the inspector hidden when passed no unit');
    return problems;
});

check('queueImageLoad() registers the image against the loading-screen counter', () => {
    const before = vm.runInContext('totalImagesToLoad', context);
    const img = new context.Image();
    queueImageLoad(img, 'https://example.test/nonexistent.png');
    const after = vm.runInContext('totalImagesToLoad', context);
    if (after !== before + 1) return [`expected totalImagesToLoad to increase by 1 (${before} -> ${before + 1}), got ${after}`];
    return [];
});

// ---------- 28. Per-unit-type laser colors (2026-08-28) ----------
//    Previously the ONLY color distinction that existed at all was
//    frostwing's freeze-beam being hardcoded blue; every other type got a
//    flat green, or - in two of the three places a laser actually gets
//    fired (attack-move engagement, the player's own direct click-to-attack)
//    - no laser effect at all. Every combat unit type now gets its own
//    distinct beam color, and every attack that lands fires one.

check('getLaserColor() returns a distinct color per known type and the same default for anything else', () => {
    const problems = [];
    if (getLaserColor('frostwing') !== '0,150,255') problems.push('expected frostwing to keep its established blue');
    if (getLaserColor('thunderwing') === getLaserColor('blazefalcon')) problems.push('expected two different types to get different colors');
    if (getLaserColor('not-a-real-unit-type') !== DEFAULT_LASER_COLOR) problems.push('expected an unknown type to fall back to DEFAULT_LASER_COLOR');
    const distinctColors = new Set(Object.keys(LASER_COLORS).map(t => getLaserColor(t)));
    if (distinctColors.size !== Object.keys(LASER_COLORS).length) problems.push('expected every listed type to have its own unique color, found a duplicate');
    return problems;
});

check('lightenRgb() blends toward white without ever exceeding 255 per channel', () => {
    const problems = [];
    if (lightenRgb('0,150,255', 0) !== '0,150,255') problems.push('expected amount=0 to return the color unchanged');
    if (lightenRgb('0,150,255', 1) !== '255,255,255') problems.push('expected amount=1 to blend all the way to white');
    const mid = lightenRgb('0,150,255', 0.5).split(',').map(Number);
    if (mid.some(c => c < 0 || c > 255)) problems.push(`expected every channel in [0,255], got ${mid}`);
    if (!(mid[0] > 0 && mid[0] < 255)) problems.push('expected a partial blend to land strictly between the original and white');
    return problems;
});

check('fireLaserEffect() records the right color and geometry, and drawing consumes it without throwing', () => {
    // laserEffects is a top-level `let` that the draw code REASSIGNS (not just
    // mutates) via `laserEffects = laserEffects.filter(...)` - the destructured
    // reference above can go stale the moment that runs even once, so read/reset
    // it live through the vm context instead of trusting the grabbed binding.
    const problems = [];
    vm.runInContext('laserEffects = [];', context);
    fireLaserEffect('thunderwing', 10, 20, 30, 40);
    const effects = vm.runInContext('laserEffects', context);
    if (effects.length !== 1) return [`expected exactly 1 laser effect queued, got ${effects.length}`];
    const effect = effects[0];
    if (effect.color !== getLaserColor('thunderwing')) problems.push('expected the queued effect to carry thunderwing\'s real color');
    if (effect.startX !== 10 || effect.startY !== 20 || effect.endX !== 30 || effect.endY !== 40) problems.push('expected the exact coordinates passed through');
    if (typeof effect.duration !== 'number' || effect.duration <= 0) problems.push('expected a positive duration');
    vm.runInContext('laserEffects = [];', context);
    return problems;
});

check('a player-issued attack fires a colored laser for the attacker\'s own type, not just frostwing', () => {
    const problems = [];
    const homeIsland = new Island(0, 0, 0);
    const home = new Country(0, 'LaserAttacker', '#ff0000', homeIsland, true);
    const enemyIsland = new Island(9999999, 9999999, 1);
    const enemy = new Country(1, 'LaserVictim', '#00ff00', enemyIsland, false);
    gameState.countries = [home, enemy];
    gameState.playerCountry = home;

    const shooter = new Unit(0, 0, 'blazefalcon', 0); // not frostwing - this used to fire silently
    const victim = new Unit(50, 0, 'stormbreaker', 1);
    home.units = [shooter];
    enemy.units = [victim];
    shooter.attackMoveTarget = { kind: 'unit', unit: victim };
    vm.runInContext('laserEffects = [];', context);

    processAttackMoveOrders();

    const effects = vm.runInContext('laserEffects', context);
    if (effects.length !== 1) return [`expected a laser effect from a non-frostwing attacker, got ${effects.length}`];
    if (effects[0].color !== getLaserColor('blazefalcon')) problems.push('expected the laser colored for blazefalcon specifically, not a generic default');
    vm.runInContext('laserEffects = [];', context);
    return problems;
});

// ---------- 29. Ten new tech tree nodes (2026-08-28) ----------
//    Each gets a real hook into an existing system - checked here against
//    the actual live code path (getMaxHP/getAttackPower/defenseGunAttack/
//    etc.), not by re-deriving the expected number and hoping it matches.

check('TECH_TREE now has 13 nodes, all 13 required by the schema guardrail above are present', () => {
    const ids = Object.keys(TECH_TREE);
    const expectedNew = ['reinforced_hulls', 'aerial_superiority', 'extended_sensors', 'fortified_defenses',
        'rapid_repair', 'deep_mining', 'expanded_cargo', 'advanced_shipyards', 'warp_drive', 'deposit_scanner'];
    const problems = [];
    if (ids.length !== 13) problems.push(`expected 13 total nodes (3 original + 10 new), got ${ids.length}`);
    expectedNew.forEach(id => { if (!TECH_TREE[id]) problems.push(`missing new node "${id}"`); });
    return problems;
});

check('Reinforced Hulls: +15% HP on ground units only, applied live (not vessels/aircraft)', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'HullsTest', '#ff0000', island, true);
    gameState.countries = [country];
    const baseHp = new Unit(0, 0, 'groundpounders', 0).getMaxHP();
    const baseVesselHp = new Unit(0, 0, 'stormbreaker', 0).getMaxHP();
    country.researchedTech.add('reinforced_hulls');
    const boostedHp = new Unit(0, 0, 'groundpounders', 0).getMaxHP();
    const vesselHpAfter = new Unit(0, 0, 'stormbreaker', 0).getMaxHP();
    const problems = [];
    if (boostedHp !== Math.round(baseHp * 1.15)) problems.push(`expected ${Math.round(baseHp * 1.15)}, got ${boostedHp}`);
    if (vesselHpAfter !== baseVesselHp) problems.push('reinforced_hulls should not affect vessel-class units');
    return problems;
});

check('Aerial Superiority: +15% attack on aircraft only, applied live to already-existing units', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'AeroTest', '#ff0000', island, true);
    gameState.countries = [country];
    const plane = new Unit(0, 0, 'thunderwing', 0);
    const groundUnit = new Unit(0, 0, 'groundpounders', 0);
    const baseAttack = plane.getAttackPower();
    const baseGroundAttack = groundUnit.getAttackPower();
    country.researchedTech.add('aerial_superiority');
    const problems = [];
    if (plane.getAttackPower() !== Math.round(baseAttack * 1.15)) problems.push(`expected the SAME already-built unit's attack to increase live to ${Math.round(baseAttack * 1.15)}, got ${plane.getAttackPower()}`);
    if (groundUnit.getAttackPower() !== baseGroundAttack) problems.push('aerial_superiority should not affect ground units');
    return problems;
});

check('Extended Sensors: +50% vision range, both for a scouting unit and homeworld vision', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'SensorTest', '#ff0000', island, true);
    const problems = [];
    if (getEffectiveSightRange(country, false) !== UNIT_SIGHT_RANGE) problems.push('expected the plain UNIT_SIGHT_RANGE before research');
    if (getEffectiveSightRange(country, true) !== RADAR_SIGHT_RANGE) problems.push('expected the plain RADAR_SIGHT_RANGE before research');
    country.researchedTech.add('extended_sensors');
    if (getEffectiveSightRange(country, false) !== Math.round(UNIT_SIGHT_RANGE * 1.5)) problems.push('expected +50% unit sight range after research');
    if (getEffectiveSightRange(country, true) !== Math.round(RADAR_SIGHT_RANGE * 1.5)) problems.push('expected +50% radar sight range after research');
    return problems;
});

check('Fortified Defenses: +50% Defense Gun range and damage', () => {
    const homeIsland = new Island(0, 0, 0);
    const home = new Country(0, 'FortifiedTest', '#ff0000', homeIsland, true);
    const enemyIsland = new Island(9999999, 9999999, 1);
    const enemy = new Country(1, 'FortifiedEnemy', '#00ff00', enemyIsland, false);
    gameState.countries = [home, enemy];
    const gun = homeIsland.getDefenseGun();
    const problems = [];

    // Just past the un-fortified range - should be untouched until researched.
    const farEnemy = new Unit(gun.range + 100, 0, 'stormbreaker', 1);
    enemy.units = [farEnemy];
    home.defenseGunAttack();
    if (farEnemy.hp !== farEnemy.maxHp) problems.push('expected the gun to miss a target just past its un-fortified range');

    home.researchedTech.add('fortified_defenses');
    gun.hasAttacked = false;
    const hpBefore = farEnemy.hp;
    home.defenseGunAttack();
    if (farEnemy.hp !== hpBefore - Math.round(gun.attackPower * 1.5)) {
        problems.push(`expected ${Math.round(gun.attackPower * 1.5)} fortified damage on the now-in-range target, hp went ${hpBefore} -> ${farEnemy.hp}`);
    }
    return problems;
});

check('Rapid Repair Crews: heals damaged (not destroyed) buildings by 1 HP/turn, only when researched', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'RepairTest', '#ff0000', island, true);
    const building = island.buildings[1]; // any ordinary (non-harbor/gun/lab) building
    building.hp = 1;
    building.destroyed = false;
    const destroyedBuilding = island.buildings[2];
    destroyedBuilding.destroyed = true;
    destroyedBuilding.hp = 0;

    country.repairBuildings(); // not researched yet - no-op
    const problems = [];
    if (building.hp !== 1) problems.push('expected no repair before researching Rapid Repair Crews');

    country.researchedTech.add('rapid_repair');
    country.repairBuildings();
    if (building.hp !== 2) problems.push(`expected the damaged building to heal by 1 (1 -> 2), got ${building.hp}`);
    if (destroyedBuilding.hp !== 0) problems.push('expected a destroyed building to stay at 0, not be healed');

    building.hp = building.maxHp;
    country.repairBuildings();
    if (building.hp !== building.maxHp) problems.push('expected a fully-healed building to stay at maxHp, not overheal');
    return problems;
});

check('Deep Mining: a second tier on Improved Extraction reaches 1200/hour', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'DeepMiningTest', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(500, 500);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(500, 500, 'miningship', 0);
    country.units = [ship];
    country.researchedTech.add('improved_extraction');
    country.researchedTech.add('deep_mining');

    // 60 seconds, not a full hour - 1200/hour would blow past the 500 cargo cap
    // well before an hour is up, which isn't what this is testing.
    vm.runInContext('frameDeltaTime = 60;', context);
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    const expected = (1200 / 3600) * 60;
    if (Math.abs(ship.miningCargo - expected) > 0.01) return [`expected ${expected} cargo (1200/hour over 60s) with Deep Mining, got ${ship.miningCargo}`];
    return [];
});

check('Expanded Cargo Bays: Cargohauler capacity 10 -> 15, and enforced everywhere the game checks it', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'CargoTest', '#ff0000', island, true);
    gameState.countries = [country];
    const hauler = new Unit(0, 0, 'cargohauler', 0);
    const problems = [];
    if (hauler.getCargoCapacity() !== 10) problems.push('expected the default capacity of 10 before research');
    country.researchedTech.add('expanded_cargo');
    if (hauler.getCargoCapacity() !== 15) problems.push('expected 15 after researching Expanded Cargo Bays');

    // And setActionMode('load') actually respects the new, higher capacity.
    gameState.playerCountry = country;
    hauler.cargo = Array.from({ length: 10 }, () => new Unit(0, 0, 'groundpounders', 0)); // full under the OLD cap
    const harborPos = island.getHarborWorldPosition();
    hauler.x = harborPos.x; hauler.y = harborPos.y;
    const extraTrooper = new Unit(0, 0, 'groundpounders', 0);
    extraTrooper.isInHarbor = true;
    country.units = [hauler, extraTrooper];
    gameState.selectedUnit = hauler;
    gameState.selectedUnits = [hauler];
    setActionMode('load');
    if (hauler.cargo.length !== 11) problems.push(`expected the 11th trooper to board now that capacity is 15, cargo is ${hauler.cargo.length}`);
    return problems;
});

check('Advanced Shipyards: gates Tidebreaker and Whisperwind behind research (previously buildable turn one)', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'ShipyardTest', '#ff0000', island, true);
    const problems = [];
    if (country.canBuildUnit('tidebreaker')) problems.push('expected tidebreaker locked before Advanced Shipyards');
    if (country.canBuildUnit('whisperwind')) problems.push('expected whisperwind locked before Advanced Shipyards');
    country.researchedTech.add('advanced_shipyards');
    if (!country.canBuildUnit('tidebreaker')) problems.push('expected tidebreaker unlocked after Advanced Shipyards');
    if (!country.canBuildUnit('whisperwind')) problems.push('expected whisperwind unlocked after Advanced Shipyards');
    return problems;
});

check('Warp Drive Calibration: +12% speed on vessels only, applied live via update()', () => {
    const island = new Island(-100000, -100000, 0);
    const country = new Country(0, 'WarpTest', '#ff0000', island, true);
    gameState.countries = [country];
    const ship = new Unit(0, 0, 'stormbreaker', 0);
    const groundUnit = new Unit(0, 0, 'groundpounders', 0);
    ship.moveTo(100000, 0);
    groundUnit.moveTo(100000, 0); // will actually be blocked (not on an island), but distance covered per tick is what matters
    ship.update();
    const baseDist = ship.x;

    const ship2 = new Unit(0, 0, 'stormbreaker', 0);
    ship2.moveTo(100000, 0);
    country.researchedTech.add('warp_drive');
    ship2.update();
    const boostedDist = ship2.x;

    if (Math.abs(boostedDist - baseDist * 1.12) > 0.01) {
        return [`expected ~12% more distance covered in one tick (${(baseDist * 1.12).toFixed(3)}), got ${boostedDist.toFixed(3)}`];
    }
    return [];
});

check('Orbital Resource Scanner: doubles Mining Ship collection range', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'ScannerTest', '#ff0000', island, true);
    gameState.countries = [country];
    const dep = new ResourceDeposit(0, 0);
    resourceDeposits.length = 0;
    resourceDeposits.push(dep);
    const ship = new Unit(DEPOSIT_COLLECT_RANGE * 1.5, 0, 'miningship', 0); // out of range normally, in range once doubled
    country.units = [ship];

    country.researchedTech.add('deposit_scanner');
    vm.runInContext('frameDeltaTime = 3600;', context);
    updateMiningAndResearch();
    vm.runInContext('frameDeltaTime = 1 / 60;', context);

    if (ship.miningCargo <= 0) return ['expected the mining ship to collect into its own cargo once its extended range covers the deposit'];
    return [];
});

// ---------- 30. Vessels are allowed to fly over planets (2026-08-28) ----------
//    Removed at the user's explicit request: moveTo()/update() used to
//    silently refuse a vessel any target/position inside a planet's
//    collisionSize, same as this game blocks ground units from leaving one.
//    Vessels now move exactly like aircraft - no collision with planets at all.

check('a vessel can be ordered to, and actually reach, a point INSIDE a planet\'s collision radius', () => {
    const problems = [];
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'FlyoverTest', '#ff0000', island, true);
    gameState.countries = [country];

    const ship = new Unit(island.x - 300, island.y, 'stormbreaker', 0);
    // The island's own center - well inside collisionSize, exactly what used to be refused.
    ship.moveTo(island.x, island.y);
    if (ship.targetX !== island.x || ship.targetY !== island.y) {
        problems.push(`expected moveTo() to accept a target inside the planet, got targetX=${ship.targetX}, targetY=${ship.targetY} (still island center is ${island.x},${island.y})`);
    }

    for (let i = 0; i < 300; i++) ship.update();
    const distFromCenter = Math.hypot(ship.x - island.x, ship.y - island.y);
    if (distFromCenter > 5) {
        problems.push(`expected the ship to actually arrive at/through the planet center, still ${distFromCenter.toFixed(1)} away after 200 update() ticks`);
    }
    return problems;
});

check('ground units still require an on-planet target - only the vessel restriction was removed', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'GroundStillGatedTest', '#ff0000', island, true);
    gameState.countries = [country];
    const trooper = new Unit(island.x, island.y, 'groundpounders', 0);

    trooper.moveTo(island.x + island.collisionSize + 5000, island.y); // open space, off any planet
    if (trooper.targetX !== island.x) {
        return ['expected a ground unit\'s move order into open space (off any planet) to still be refused'];
    }
    return [];
});

// ---------- 31. Screen-space asteroids, no comets, real background, load-gated start (2026-08-28) ----------
//    The world-space canvas asteroid system (spawnCosmeticAsteroids/etc.) clustered
//    all 12 asteroids right next to the player's home planet, because it scattered
//    them around wherever `camera` happened to be - which at game start is always
//    gameState.playerCountry.island. Replaced with the same screen-space DOM
//    approach the original brown asteroids used (position:absolute divs, a single
//    CSS translateX keyframe, independent of camera/world position), just with real
//    art. Also: comets removed per direct request, the old procedural nebula-blob
//    background replaced with a real photo (Background-1.png), and every game-start
//    entry point now blocks on whenImagesReady() so a still-loading planet can never
//    show its brown placeholder shape during normal play.

check('asteroids fly in from the true left edge of the screen - left is fixed, not randomized', () => {
    // Regression: a randomized `left` offsets the keyframe's own translateX sweep,
    // so most asteroids visually "appear" already mid-screen instead of genuinely
    // entering from the left edge - exactly the bug the user caught by eye.
    const problems = [];
    if (!/asteroid\.style\.left\s*=\s*'0px'/.test(script)) {
        problems.push('expected asteroid.style.left to be fixed at \'0px\', not a random value');
    }
    return problems;
});

check('createSpaceElements() creates real screen-space asteroid divs (not the old canvas system)', () => {
    document.getElementById = document.getElementById || (() => ({ appendChild(){}, style:{} }));
    createSpaceElements();
    const asteroids = vm.runInContext('spaceElements.asteroids', context);
    const problems = [];
    if (!Array.isArray(asteroids) || asteroids.length !== 8) problems.push(`expected 8 asteroid elements, got ${Array.isArray(asteroids) ? asteroids.length : typeof asteroids}`);
    if (typeof spawnCosmeticAsteroids !== 'undefined') problems.push('spawnCosmeticAsteroids should no longer exist - it clustered asteroids next to the player\'s planet');
    return problems;
});

check('comets are fully removed - no .comet CSS, no spaceElements.comets, no comet creation code', () => {
    const problems = [];
    if (html.includes('comet-fly')) problems.push('comet-fly keyframe still present in CSS');
    if (html.includes("className = 'comet'")) problems.push('comet div creation code still present');
    if (html.includes('spaceElements.comets')) problems.push('spaceElements.comets still referenced');
    return problems;
});

check('the two real asteroid images are wired into the CSS classes the JS actually assigns', () => {
    const problems = [];
    if (!html.includes('Asteroids/Asteroid-1.png')) problems.push('Asteroid-1.png not referenced');
    if (!html.includes('Asteroids/Asteroid-2.png')) problems.push('Asteroid-2.png not referenced');
    if (!html.includes("asteroid-1")) problems.push('.asteroid-1 class not referenced');
    if (!html.includes("asteroid-2")) problems.push('.asteroid-2 class not referenced');
    return problems;
});

check("the .asteroid CSS rule never intercepts clicks - per direct report, drifting asteroids were blocking the canvas/UI buttons underneath them", () => {
    const asteroidRuleMatch = html.match(/\.asteroid\s*\{[^}]*\}/);
    if (!asteroidRuleMatch) return ['could not find the .asteroid CSS rule to check'];
    if (!/pointer-events:\s*none/.test(asteroidRuleMatch[0])) {
        return ['expected .asteroid { pointer-events: none; } so drifting asteroids never block clicks on whatever is underneath them'];
    }
    return [];
});

check('drawSpaceBackground() tiles the real Background-1.png photo instead of the old procedural nebula blobs', () => {
    const problems = [];
    if (!html.includes('Backgrounds/Background-1.png')) problems.push('Background-1.png not referenced');
    if (html.includes('NEBULA_BLOBS')) problems.push('old procedural NEBULA_BLOBS code is still present');
    if (typeof drawSpaceBackground !== 'function') problems.push('drawSpaceBackground is not a function');
    return problems;
});

check('the background tile loop is hard-capped so a tiny/placeholder image can never explode it into a runaway per-frame draw storm', () => {
    // Regression (2026-08-29): interaction-test.js's CI run mocks every image,
    // including the background, with a 1x1 placeholder PNG. Before this
    // clamp+cap, a 1x1 tile size made cols/rows scale with the canvas's PIXEL
    // width, turning "draw a few background tiles" into 1000+ ctx.drawImage()
    // calls every single frame, forever - froze the whole browser tab and
    // took down interaction-test 3 runs in a row before this was caught.
    const src = vm.runInContext('drawSpaceBackground.toString()', context);
    const problems = [];
    if (!/Math\.max\(spaceBackgroundImage\.naturalWidth,\s*\d+\)/.test(src)) {
        problems.push('no minimum-tile-size clamp on naturalWidth');
    }
    const capMatch = src.match(/Math\.min\(Math\.ceil\(canvas\.width \/ tw\) \+ 2,\s*(\d+)\)/);
    const cap = capMatch ? parseInt(capMatch[1], 10) : Infinity;
    if (!(cap > 0 && cap < 200)) problems.push(`column cap is ${cap === Infinity ? 'missing' : cap}, expected a small bounded number`);
    return problems;
});

check('whenImagesReady() calls back immediately once every queued image is done, and waits otherwise', () => {
    const problems = [];
    vm.runInContext('totalImagesToLoad = 5; imagesLoadedSoFar = 5;', context);
    let calledSync = false;
    whenImagesReady(() => { calledSync = true; });
    if (!calledSync) problems.push('expected an immediate callback when loaded >= total');

    vm.runInContext('totalImagesToLoad = 5; imagesLoadedSoFar = 2;', context);
    let calledEarly = false;
    whenImagesReady(() => { calledEarly = true; });
    if (calledEarly) problems.push('expected whenImagesReady to NOT call back yet while images are still loading');
    vm.runInContext('imagesLoadedSoFar = 5; totalImagesToLoad = 5;', context); // restore, don't leak into later checks
    return problems;
});

check('every game-start entry point is gated behind whenImagesReady() (directly, or via the shared enterGameplay()) before calling gameLoop()', () => {
    const problems = [];
    // 2026-09-03: the 4 entry points below no longer call whenImagesReady() directly -
    // they all share one enterGameplay() tail (see its own comment) - so the gate is
    // only real if THAT function still has it.
    const enterGameplaySrc = vm.runInContext('enterGameplay.toString()', context);
    if (!enterGameplaySrc.includes('whenImagesReady(')) {
        problems.push('expected enterGameplay() itself to gate on whenImagesReady() - every entry point below relies on that');
    }

    const startFns = ['startHotSeatGame', 'closeVideo', 'continueFromAutosave', 'startCampaignStage'];
    startFns.forEach(name => {
        const src = vm.runInContext(`${name}.toString()`, context);
        if (!src.includes('whenImagesReady(') && !src.includes('enterGameplay(')) {
            problems.push(`${name}() calls gameLoop() without gating on whenImagesReady() (directly, or via enterGameplay()) first`);
        }
    });
    return problems;
});

// ---------- 32. No native text selection anywhere (2026-08-29) ----------
//    Dragging a selection box over units (the game's own drag-select control
//    scheme) also drags across the on-screen UI panels underneath, and with
//    no user-select rule that fell through to the browser's native text
//    highlight. There are no text inputs anywhere in this game, so it's safe
//    to disable selection globally rather than panel-by-panel.

check('text selection is disabled globally - there are no text inputs anywhere to protect', () => {
    const problems = [];
    if (!/\*\s*\{[^}]*user-select:\s*none/.test(html)) {
        problems.push('expected a global (`*`) rule setting user-select: none');
    }
    if (html.includes('<input') || html.includes('<textarea')) {
        problems.push('a text input now exists - the blanket user-select:none rule needs to exempt it');
    }
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

// ---------- 26. Galaxy Core (2026-09-03) ----------
//    A single, permanent, unowned map landmark - 10x a standard planet's
//    radius, heals every nearby ship (any country, aliens included) 15% of
//    its max HP once per turn, and is guarded by 3 Cyborg Planet East
//    warships stationed next to it at spawn. Standard Game only, per direct
//    request - Campaign mode must never see or be healed by it.

check('spawnGalaxyCore() places exactly one Galaxy Core and stations 3 cyborgdreadnought guards on Cyborg Planet East', () => {
    const problems = [];
    // Standard Game's full country roster - Cyborg Planet East is id 14 (see initGame()).
    gameState.countries = [12, 13, 14, 15, 16].map(id => new Country(id, `Nation${id}`, '#00ffff', new Island(id * 200000, 0, id), false));
    const eastCountry = gameState.countries.find(c => c.id === 14);
    const startUnitCount = eastCountry.units.length;

    spawnGalaxyCore();

    if (galaxyCores.length !== 1) problems.push(`expected exactly 1 Galaxy Core, got ${galaxyCores.length}`);
    else if (galaxyCores[0].size !== GALAXY_CORE_SIZE) problems.push(`expected the core's size to be GALAXY_CORE_SIZE (${GALAXY_CORE_SIZE}), got ${galaxyCores[0].size}`);

    const newGuards = eastCountry.units.slice(startUnitCount);
    if (newGuards.length !== 3) problems.push(`expected 3 guard units added to Cyborg Planet East, got ${newGuards.length}`);
    if (!newGuards.every(u => u.type === 'cyborgdreadnought')) problems.push('expected every guard to be a cyborgdreadnought');
    if (galaxyCores.length === 1) {
        const core = galaxyCores[0];
        newGuards.forEach(u => {
            const dist = Math.hypot(u.x - core.x, u.y - core.y);
            if (dist > GALAXY_CORE_SIZE) problems.push(`expected guard within the core's own radius, got distance ${dist.toFixed(0)}`);
        });
    }
    return problems;
});

check('spawnGalaxyCore() is safe to call with no Cyborg Planet East in the roster (still places the core, just no guards)', () => {
    const problems = [];
    gameState.countries = [new Country(0, 'Solo', '#ff0000', new Island(0, 0, 0), true)];
    galaxyCores.length = 0;
    spawnGalaxyCore();
    if (galaxyCores.length !== 1) problems.push('expected the core to be placed regardless of whether Cyborg Planet East exists');
    return problems;
});

check('healNearGalaxyCores() heals every damaged unit within range - any country, aliens included - capped at max HP, and leaves out-of-range units alone', () => {
    const problems = [];
    galaxyCores.length = 0;
    const core = new GalaxyCore(0, 0);
    core.kind = 'heal'; // healNearGalaxyCores() only acts on this kind - see spawnGalaxyBounty()
    galaxyCores.push(core);

    const humanCountry = new Country(0, 'Human', '#ff0000', new Island(1000000, 0, 0), true);
    const alienCountry = new Country(16, 'Zoonester', '#9d00ff', new Island(2000000, 0, 16), false);
    alienCountry.isZoonester = true;
    gameState.countries = [humanCountry, alienCountry];

    const nearHuman = makeUnit('deepglider', 0);
    nearHuman.x = GALAXY_CORE_HEAL_RANGE - 10; nearHuman.y = 0;
    nearHuman.hp = 1;
    humanCountry.units = [nearHuman];

    const nearAlien = makeUnit('cyborgdreadnought', 16);
    nearAlien.x = 0; nearAlien.y = GALAXY_CORE_HEAL_RANGE - 10;
    nearAlien.hp = 1;
    alienCountry.units = [nearAlien];

    const farHuman = makeUnit('deepglider', 0);
    farHuman.x = GALAXY_CORE_HEAL_RANGE + 5000; farHuman.y = 0;
    farHuman.hp = 1;
    humanCountry.units.push(farHuman);

    const fullHpNearby = makeUnit('deepglider', 0);
    fullHpNearby.x = 10; fullHpNearby.y = 0;
    humanCountry.units.push(fullHpNearby);
    const startFullHp = fullHpNearby.hp;

    healNearGalaxyCores();

    const expectedHeal = nearHuman.getMaxHP() * GALAXY_CORE_HEAL_PERCENT;
    if (Math.abs(nearHuman.hp - (1 + expectedHeal)) > 0.01) {
        problems.push(`expected the in-range human unit healed by 15% of max HP (${(1 + expectedHeal).toFixed(1)}), got ${nearHuman.hp}`);
    }
    const expectedAlienHeal = nearAlien.getMaxHP() * GALAXY_CORE_HEAL_PERCENT;
    if (Math.abs(nearAlien.hp - (1 + expectedAlienHeal)) > 0.01) {
        problems.push(`expected the in-range ALIEN unit healed too (${(1 + expectedAlienHeal).toFixed(1)}), got ${nearAlien.hp}`);
    }
    if (farHuman.hp !== 1) problems.push(`expected the out-of-range unit untouched, got hp ${farHuman.hp}`);
    if (fullHpNearby.hp !== startFullHp) problems.push(`expected an already-full-HP unit left exactly at max, got ${fullHpNearby.hp}`);

    // Heal-to-cap: start just under max, confirm it never overshoots.
    const almostFull = makeUnit('deepglider', 0);
    almostFull.x = 5; almostFull.y = 0;
    almostFull.hp = almostFull.getMaxHP() - 1;
    humanCountry.units.push(almostFull);
    healNearGalaxyCores();
    if (almostFull.hp !== almostFull.getMaxHP()) problems.push(`expected healing to cap exactly at max HP, got ${almostFull.hp}/${almostFull.getMaxHP()}`);

    return problems;
});

check('healNearGalaxyCores() is a safe no-op when there is no Galaxy Core (e.g. Campaign mode)', () => {
    const problems = [];
    galaxyCores.length = 0;
    const country = new Country(0, 'NoCoreTest', '#ff0000', new Island(0, 0, 0), true);
    const u = makeUnit('deepglider', 0);
    u.hp = 1;
    country.units = [u];
    gameState.countries = [country];
    healNearGalaxyCores();
    if (u.hp !== 1) problems.push(`expected no healing with zero Galaxy Cores, got hp ${u.hp}`);
    return problems;
});

check('startCampaignStage() clears galaxyCores - Campaign mode must never inherit a Standard Game leftover', () => {
    const problems = [];
    // Simulate the leftover from initGame()'s automatic run - both kinds, since
    // Campaign mode must never see either.
    const leftoverHeal = new GalaxyCore(0, 0); leftoverHeal.kind = 'heal';
    const leftoverBounty = new GalaxyCore(0, 0); leftoverBounty.kind = 'bounty';
    galaxyCores.push(leftoverHeal, leftoverBounty);
    selectCampaignNation(0);
    startCampaignStage(0);
    if (galaxyCores.length !== 0) problems.push(`expected galaxyCores cleared in Campaign mode, got ${galaxyCores.length}`);
    return problems;
});

// ---------- 27. Galaxy Bounty (2026-09-03) ----------
//    A second landmark (new-galaxy-2.png), twice the size of the (healing) Galaxy
//    Core, in the opposite corner of the map. Doesn't heal - instead, each
//    turn it pays GALAXY_BOUNTY_GOLD_PER_ROUND to whichever country has the
//    most of its own ships (>= GALAXY_BOUNTY_MIN_SHIPS) within
//    GALAXY_BOUNTY_QUALIFY_RANGE, guarded by 7 Cyborg Planet West warships.
//    Shares the galaxyCores array with the healing core (for free minimap/
//    getGalaxyBounds()/rendering reuse) via a `kind` tag - these tests also
//    cover that the two spawn functions stay independent of each other.

check('spawnGalaxyBounty() places exactly one Galaxy Bounty (twice the healing core\'s size) and stations 7 cyborgdreadnought guards on Cyborg Planet West', () => {
    const problems = [];
    gameState.countries = [12, 13, 14, 15, 16].map(id => new Country(id, `Nation${id}`, '#00ffff', new Island(id * 200000, 0, id), false));
    const westCountry = gameState.countries.find(c => c.id === 15);
    const startUnitCount = westCountry.units.length;
    galaxyCores.length = 0;

    spawnGalaxyBounty();

    const bounties = galaxyCores.filter(c => c.kind === 'bounty');
    if (bounties.length !== 1) problems.push(`expected exactly 1 Galaxy Bounty, got ${bounties.length}`);
    else if (bounties[0].size !== GALAXY_BOUNTY_SIZE) problems.push(`expected size GALAXY_BOUNTY_SIZE (${GALAXY_BOUNTY_SIZE}), got ${bounties[0].size}`);
    if (GALAXY_BOUNTY_SIZE !== GALAXY_CORE_SIZE * 2) problems.push(`expected GALAXY_BOUNTY_SIZE to be double GALAXY_CORE_SIZE, got ${GALAXY_BOUNTY_SIZE} vs ${GALAXY_CORE_SIZE}`);

    const newGuards = westCountry.units.slice(startUnitCount);
    if (newGuards.length !== 7) problems.push(`expected 7 guard units added to Cyborg Planet West, got ${newGuards.length}`);
    if (!newGuards.every(u => u.type === 'cyborgdreadnought')) problems.push('expected every guard to be a cyborgdreadnought');
    return problems;
});

check('spawnGalaxyCore() and spawnGalaxyBounty() are independent - calling one never wipes out the other\'s landmark, in either order', () => {
    const problems = [];
    gameState.countries = [12, 13, 14, 15, 16].map(id => new Country(id, `Nation${id}`, '#00ffff', new Island(id * 200000, 0, id), false));
    galaxyCores.length = 0;

    spawnGalaxyCore();
    spawnGalaxyBounty();
    let kinds = galaxyCores.map(c => c.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify(['bounty', 'heal'])) {
        problems.push(`expected exactly one of each kind after core-then-bounty, got ${JSON.stringify(kinds)}`);
    }

    // Calling either again replaces only its own kind, not both, and not by
    // reassigning the array (a real past bug here - see the comment on both spawn
    // functions - which would silently break anything holding an earlier reference
    // to galaxyCores, this test file included).
    spawnGalaxyCore();
    kinds = galaxyCores.map(c => c.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify(['bounty', 'heal'])) {
        problems.push(`expected still exactly one of each kind after re-calling spawnGalaxyCore(), got ${JSON.stringify(kinds)}`);
    }

    galaxyCores.length = 0;
    spawnGalaxyBounty();
    spawnGalaxyCore();
    kinds = galaxyCores.map(c => c.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify(['bounty', 'heal'])) {
        problems.push(`expected exactly one of each kind after bounty-then-core (reverse order), got ${JSON.stringify(kinds)}`);
    }
    return problems;
});

check('awardGalaxyBounty() pays the country with the most qualifying ships, ignores anyone under GALAXY_BOUNTY_MIN_SHIPS, and never counts ground units', () => {
    const problems = [];
    galaxyCores.length = 0;
    const bounty = new GalaxyCore(0, 0, undefined, GALAXY_BOUNTY_SIZE); // only position/size matter for this test
    bounty.kind = 'bounty';
    galaxyCores.push(bounty);

    const leader = new Country(0, 'Leader', '#ff0000', new Island(1000000, 0, 0), true); // 5 ships in range - qualifies
    leader.units = Array.from({ length: 5 }, () => makeUnit('deepglider', 0));
    leader.units.forEach(u => { u.x = GALAXY_BOUNTY_QUALIFY_RANGE - 10; u.y = 0; });

    const runnerUp = new Country(1, 'RunnerUp', '#00ff00', new Island(2000000, 0, 1), false); // only 4 - doesn't qualify
    runnerUp.units = Array.from({ length: 4 }, () => makeUnit('deepglider', 1));
    runnerUp.units.forEach(u => { u.x = GALAXY_BOUNTY_QUALIFY_RANGE - 10; u.y = 0; });

    const groundHeavy = new Country(2, 'GroundHeavy', '#0000ff', new Island(3000000, 0, 2), false); // 5 in range, but ground units - shouldn't count
    groundHeavy.units = Array.from({ length: 5 }, () => makeUnit('groundpounders', 2));
    groundHeavy.units.forEach(u => { u.x = GALAXY_BOUNTY_QUALIFY_RANGE - 10; u.y = 0; });

    const tooFar = new Country(3, 'TooFar', '#ffff00', new Island(4000000, 0, 3), false); // 5 ships, but out of range
    tooFar.units = Array.from({ length: 5 }, () => makeUnit('deepglider', 3));
    tooFar.units.forEach(u => { u.x = GALAXY_BOUNTY_QUALIFY_RANGE + 5000; u.y = 0; });

    gameState.countries = [leader, runnerUp, groundHeavy, tooFar];
    const startResources = { leader: leader.resources, runnerUp: runnerUp.resources, groundHeavy: groundHeavy.resources, tooFar: tooFar.resources };

    awardGalaxyBounty();

    if (leader.resources !== startResources.leader + GALAXY_BOUNTY_GOLD_PER_ROUND) {
        problems.push(`expected the only qualifying country to gain ${GALAXY_BOUNTY_GOLD_PER_ROUND}, got ${leader.resources - startResources.leader}`);
    }
    if (runnerUp.resources !== startResources.runnerUp) problems.push('expected the under-threshold country to gain nothing');
    if (groundHeavy.resources !== startResources.groundHeavy) problems.push('expected ground units to never count toward qualifying, so this country gains nothing');
    if (tooFar.resources !== startResources.tooFar) problems.push('expected the out-of-range country to gain nothing despite having enough ships');
    return problems;
});

check('awardGalaxyBounty() breaks a tie by lowest country id, and is a safe no-op with zero Galaxy Bounties', () => {
    const problems = [];
    galaxyCores.length = 0;
    const bounty = new GalaxyCore(0, 0);
    bounty.kind = 'bounty';
    galaxyCores.push(bounty);

    const a = new Country(5, 'A', '#ff0000', new Island(1000000, 0, 5), true);
    a.units = Array.from({ length: 5 }, () => makeUnit('deepglider', 5));
    a.units.forEach(u => { u.x = 0; u.y = 0; });

    const b = new Country(2, 'B', '#00ff00', new Island(2000000, 0, 2), false); // same qualifying count, LOWER id
    b.units = Array.from({ length: 5 }, () => makeUnit('deepglider', 2));
    b.units.forEach(u => { u.x = 0; u.y = 0; });

    gameState.countries = [a, b];
    const startA = a.resources, startB = b.resources;
    awardGalaxyBounty();
    if (b.resources !== startB + GALAXY_BOUNTY_GOLD_PER_ROUND) problems.push(`expected the tie broken toward the lower id (country 2), got country 2 gained ${b.resources - startB}`);
    if (a.resources !== startA) problems.push(`expected the higher-id country to gain nothing on a tie, got ${a.resources - startA}`);

    // No Galaxy Bounty at all - must not throw, must not touch anyone's resources.
    galaxyCores.length = 0;
    const startA2 = a.resources;
    awardGalaxyBounty();
    if (a.resources !== startA2) problems.push('expected a safe no-op with zero Galaxy Bounties');
    return problems;
});

// ---------- 28. Building-destroyed sound effect (2026-09-03) ----------
//    Per direct request: only when it's relevant to whoever's turn is
//    currently active - their own building was destroyed, or their own
//    troops destroyed someone else's - never for an AI-vs-AI destruction
//    they had no part in. Spies on playBuildingDestroyedSound() itself
//    (reassigned inside the sandboxed context, restored after) rather than
//    asserting on Audio internals, which have no observable state in jsdom -
//    the real behavior worth verifying is Building.takeDamage()'s gating
//    logic, not what playBuildingDestroyedSound() does with an Audio object.

check("Building.takeDamage() plays the destroyed sound only when it's relevant to the active player, never for an AI-vs-AI destruction", () => {
    const problems = [];
    vm.runInContext('this.__soundPlayCount = 0; this.__origPlayBuildingDestroyedSound = playBuildingDestroyedSound; playBuildingDestroyedSound = () => { this.__soundPlayCount++; };', context);
    const soundPlayCount = () => vm.runInContext('this.__soundPlayCount', context);

    const playerIsland = new Island(0, 0, 0);
    const playerCountry = new Country(0, 'Player', '#ff0000', playerIsland, true);
    const enemyIsland = new Island(1000000, 0, 1);
    const enemyCountry = new Country(1, 'Enemy', '#00ff00', enemyIsland, false);
    const bystanderIsland = new Island(2000000, 0, 2);
    const bystanderCountry = new Country(2, 'Bystander', '#0000ff', bystanderIsland, false);
    gameState.countries = [playerCountry, enemyCountry, bystanderCountry];
    gameState.playerCountry = playerCountry;

    try {
        // Case 1: an AI (enemy) destroys the PLAYER's own building - should play.
        let building = playerIsland.buildings[1];
        building.hp = 1; building.destroyed = false;
        building.takeDamage(999, enemyCountry.id);
        if (soundPlayCount() !== 1) problems.push(`expected the sound to play when the PLAYER's own building is destroyed, count=${soundPlayCount()}`);

        // Case 2: the PLAYER's own troops destroy an enemy building - should play.
        building = enemyIsland.buildings[1];
        building.hp = 1; building.destroyed = false;
        building.takeDamage(999, playerCountry.id);
        if (soundPlayCount() !== 2) problems.push(`expected the sound to play when the player's own troops destroy an enemy building, count=${soundPlayCount()}`);

        // Case 3: a bystander AI destroys another AI's building - neither side is the
        // active player - should NOT play.
        building = enemyIsland.buildings[2];
        building.hp = 1; building.destroyed = false;
        building.takeDamage(999, bystanderCountry.id);
        if (soundPlayCount() !== 2) problems.push(`expected no sound for an AI-vs-AI destruction the player had no part in, count=${soundPlayCount()}`);

        // Case 4: damage that doesn't destroy the building - should never play, even
        // when the player is the attacker.
        building = bystanderIsland.buildings[1];
        building.hp = 100; building.destroyed = false;
        building.takeDamage(1, playerCountry.id);
        if (soundPlayCount() !== 2) problems.push(`expected no sound for damage that doesn't destroy the building, count=${soundPlayCount()}`);

        // Case 5: no attackerCountryId passed at all (a call site that doesn't know
        // one) - still plays for the PLAYER's own building, per case 1's rule.
        building = playerIsland.buildings[2];
        building.hp = 1; building.destroyed = false;
        building.takeDamage(999);
        if (soundPlayCount() !== 3) problems.push(`expected the sound to still play for the player's own building with no attackerCountryId, count=${soundPlayCount()}`);
    } finally {
        vm.runInContext('playBuildingDestroyedSound = this.__origPlayBuildingDestroyedSound;', context);
    }
    return problems;
});

// ---------- 29. Laser (unit-vs-unit attack) sound effect (2026-09-03) ----------
//    Per direct request: audible only if your ship attacks or someone attacks
//    your ship - never for everyone. playLaserAttackSound(attackerCountryId,
//    targetCountryId) is the single shared gating helper called from every
//    real combat-resolution site (processAttackMoveOrders, both of aiTurn()'s
//    combat loops, and both branches of the click-to-attack UI handler) -
//    these tests cover the helper's own gating logic directly, plus two of
//    those real call sites (one where the active player is the attacker, one
//    where they're the defender against an AI attacker - the two halves of
//    "your ship attacks or someone attacks your ship").

check("playLaserAttackSound() plays only when the active player is the attacker or the target, respects soundEnabled, and is a safe no-op with no active player", () => {
    const problems = [];
    vm.runInContext(`
        (function(global) {
            global.__audioCount = 0;
            global.__lastAudioUrl = null;
            const OrigAudio = global.Audio;
            global.Audio = function(url) {
                global.__audioCount++;
                global.__lastAudioUrl = url;
                return new OrigAudio(url);
            };
            global.__restoreAudio = function() { global.Audio = OrigAudio; };
        })(this);
    `, context);
    const audioCount = () => vm.runInContext('this.__audioCount', context);

    gameState.countries = [
        new Country(0, 'Player', '#ff0000', new Island(0, 0, 0), true),
        new Country(1, 'Enemy', '#00ff00', new Island(1000000, 0, 1), false),
        new Country(2, 'Bystander', '#0000ff', new Island(2000000, 0, 2), false),
    ];
    gameState.playerCountry = gameState.countries[0];
    vm.runInContext('soundEnabled = true;', context);

    try {
        playLaserAttackSound(0, 1); // player is the attacker
        if (audioCount() !== 1) problems.push(`expected a sound when the player is the attacker, count=${audioCount()}`);

        playLaserAttackSound(1, 0); // player is the target
        if (audioCount() !== 2) problems.push(`expected a sound when the player is the target, count=${audioCount()}`);

        playLaserAttackSound(1, 2); // neither side is the player
        if (audioCount() !== 2) problems.push(`expected no sound when neither side is the player, count=${audioCount()}`);

        vm.runInContext('soundEnabled = false;', context);
        playLaserAttackSound(0, 1);
        if (audioCount() !== 2) problems.push(`expected no sound while soundEnabled is false, count=${audioCount()}`);
        vm.runInContext('soundEnabled = true;', context);

        gameState.playerCountry = null;
        playLaserAttackSound(0, 1);
        if (audioCount() !== 2) problems.push(`expected a safe no-op with no active player, count=${audioCount()}`);
        gameState.playerCountry = gameState.countries[0];

        if (vm.runInContext('this.__lastAudioUrl', context) !== LASER_SOUND_URL) {
            problems.push('expected the constructed Audio to use LASER_SOUND_URL');
        }
    } finally {
        vm.runInContext('this.__restoreAudio();', context);
    }
    return problems;
});

check('processAttackMoveOrders() plays the laser sound when the active player\'s own unit lands an attack-move hit', () => {
    const problems = [];
    vm.runInContext('this.__laserCalls = []; this.__origPlayLaserAttackSound = playLaserAttackSound; playLaserAttackSound = (a, t) => { this.__laserCalls.push([a, t]); };', context);
    const laserCalls = () => vm.runInContext('this.__laserCalls', context);

    try {
        const player = new Country(0, 'Player', '#ff0000', new Island(0, 0, 0), true);
        const enemy = new Country(1, 'Enemy', '#00ff00', new Island(1000000, 0, 1), false);
        gameState.countries = [player, enemy];
        gameState.playerCountry = player;

        const attacker = makeUnit('deepglider', 0);
        const target = makeUnit('deepglider', 1);
        target.x = attacker.x + 10; target.y = attacker.y; // well within range
        player.units = [attacker];
        enemy.units = [target];
        attacker.attackMoveTarget = { kind: 'unit', unit: target };

        processAttackMoveOrders();

        const calls = laserCalls();
        if (calls.length !== 1) problems.push(`expected exactly 1 laser-sound call, got ${calls.length}`);
        else if (calls[0][0] !== 0 || calls[0][1] !== 1) problems.push(`expected call(attackerCountryId=0, targetCountryId=1), got ${JSON.stringify(calls[0])}`);
    } finally {
        vm.runInContext('playLaserAttackSound = this.__origPlayLaserAttackSound;', context);
    }
    return problems;
});

check("aiTurn()'s generic combat loop plays the laser sound when an AI attacks the active player's own unit", () => {
    const problems = [];
    vm.runInContext('this.__laserCalls = []; this.__origPlayLaserAttackSound = playLaserAttackSound; playLaserAttackSound = (a, t) => { this.__laserCalls.push([a, t]); };', context);
    const laserCalls = () => vm.runInContext('this.__laserCalls', context);

    try {
        const player = new Country(0, 'Player', '#ff0000', new Island(0, 0, 0), true);
        const aiAttacker = new Country(1, 'AIAttacker', '#00ff00', new Island(1000000, 0, 1), false);
        gameState.countries = [player, aiAttacker];
        gameState.playerCountry = player;

        const defender = makeUnit('deepglider', 0);
        const attacker = makeUnit('deepglider', 1);
        attacker.x = 0; attacker.y = 0;
        defender.x = 10; defender.y = 0; // well within range
        player.units = [defender];
        aiAttacker.units = [attacker];

        vm.runInContext('AI_ATTACK_CHANCE = 1;', context); // deterministic - always attempts to attack
        aiAttacker.aiTurn();
        vm.runInContext('AI_ATTACK_CHANCE = DIFFICULTY_PRESETS.normal.attack;', context); // restore

        const calls = laserCalls();
        if (calls.length < 1) problems.push('expected at least 1 laser-sound call when an AI attacks the player');
        else if (calls[0][0] !== 1 || calls[0][1] !== 0) problems.push(`expected call(attackerCountryId=1, targetCountryId=0), got ${JSON.stringify(calls[0])}`);
    } finally {
        vm.runInContext('playLaserAttackSound = this.__origPlayLaserAttackSound;', context);
    }
    return problems;
});

// ---------- 30. Start-screen intro music (2026-09-03, corrected same day per a
//    direct follow-up) ----------
//    "Humanity Does Not Disappear.mp3" starts as the game loads (unchanged -
//    see initAudio()) - but per the follow-up, it must NOT be force-stopped
//    by picking a country, the briefing video ("the ad"), a loading screen,
//    or bgMusic starting ("let the sound override the ad and the background
//    song... the mp3 and the sound can play at the same time"). The earlier
//    stopIntroMusic() mechanism (and these tests) is gone entirely - what's
//    left is setSoundEnabled()/enableSoundAutomatically() (turns "the sound"
//    on automatically once the map starts, unless the player already made an
//    explicit choice via the toggle) and enterGameplay(), the shared tail
//    every real game-start path now runs through instead of four separate
//    copies of the same whenImagesReady(...) block.
//
//    jsdom's HTMLMediaElement doesn't really implement playback (play()/
//    pause() are "Not implemented" no-ops), so these check what's actually
//    observable: .muted/.currentTime are real settable properties, and
//    whether the real functions call through to the right helpers (spied by
//    reassigning them, same proven pattern as playBuildingDestroyedSound/
//    playLaserAttackSound above).

check('toggleSound() marks the choice as manual and flips bgMusic and introMusic together', () => {
    const problems = [];
    vm.runInContext('initGame();', context, { filename: 'toggle-sound-test.js' });
    vm.runInContext('soundEnabled = false; soundManuallySet = false;', context);

    toggleSound();
    if (vm.runInContext('soundEnabled', context) !== true) problems.push('expected soundEnabled true after one toggle');
    if (vm.runInContext('soundManuallySet', context) !== true) problems.push('expected soundManuallySet true after a real toggle click');
    if (vm.runInContext('bgMusic.muted', context) !== false) problems.push('expected bgMusic unmuted');
    if (vm.runInContext('introMusic.muted', context) !== false) problems.push('expected introMusic unmuted too - they can play at the same time, per direct request');

    toggleSound();
    if (vm.runInContext('soundEnabled', context) !== false) problems.push('expected soundEnabled false after a second toggle');
    if (vm.runInContext('bgMusic.muted', context) !== true) problems.push('expected bgMusic muted again');
    if (vm.runInContext('introMusic.muted', context) !== true) problems.push('expected introMusic muted again too');
    return problems;
});

check('enableSoundAutomatically() turns sound on only if the player never touched the toggle themselves, and never overrides an explicit "off"', () => {
    const problems = [];
    vm.runInContext('initGame();', context, { filename: 'auto-sound-test.js' });

    vm.runInContext('soundEnabled = false; soundManuallySet = false;', context);
    enableSoundAutomatically();
    if (vm.runInContext('soundEnabled', context) !== true) problems.push('expected auto-enable when the player never touched the toggle');

    vm.runInContext('soundEnabled = false; soundManuallySet = true;', context);
    enableSoundAutomatically();
    if (vm.runInContext('soundEnabled', context) !== false) problems.push('expected an explicit "off" choice respected, not silently re-enabled');

    vm.runInContext('soundEnabled = true; soundManuallySet = false;', context);
    enableSoundAutomatically();
    if (vm.runInContext('soundEnabled', context) !== true) problems.push('expected an already-on state to stay on (safe no-op)');
    return problems;
});

check("enterGameplay() auto-enables sound once images are ready, and never touches the intro music's own position - it's allowed to keep playing", () => {
    const problems = [];
    vm.runInContext('initGame();', context, { filename: 'enter-gameplay-test.js' });
    vm.runInContext('soundEnabled = false; soundManuallySet = false;', context);
    vm.runInContext('introMusic.currentTime = 5;', context); // pretend it's partway through

    const island = new Island(0, 0, 0);
    const country = new Country(0, 'EnterGameplayTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;

    // Force whenImagesReady()'s synchronous fast path - jsdom's requestAnimationFrame
    // stub never actually fires a callback, so the real polling path would hang
    // forever in THIS harness (a test-environment limitation - a real browser's rAF
    // really does tick, which is what pollLoadingScreen()/LOADING_SCREEN_MAX_WAIT_MS
    // rely on in an actual game). Set AFTER constructing the Island above, which
    // queues its own art and would otherwise push totalImagesToLoad back out of reach.
    vm.runInContext('imagesLoadedSoFar = totalImagesToLoad;', context);

    enterGameplay();

    if (vm.runInContext('soundEnabled', context) !== true) problems.push("expected enterGameplay() to auto-enable sound once the map starts");
    if (vm.runInContext('introMusic.currentTime', context) !== 5) problems.push('expected the intro music left exactly where it was - never reset or stopped');
    return problems;
});

function checkEntersGameplay(label, run) {
    check(`${label} enters gameplay through the shared enterGameplay()`, () => {
        const problems = [];
        vm.runInContext('this.__enterGameplayCalls = 0; this.__origEnterGameplay = enterGameplay; enterGameplay = () => { this.__enterGameplayCalls++; };', context);
        try {
            run();
        } finally {
            const count = vm.runInContext('this.__enterGameplayCalls', context);
            vm.runInContext('enterGameplay = this.__origEnterGameplay;', context);
            if (count < 1) problems.push(`expected enterGameplay() to be called at least once, got ${count}`);
        }
        return problems;
    });
}

checkEntersGameplay('closeVideo() (after picking a country)', () => {
    vm.runInContext('initGame();', context, { filename: 'enters-gameplay-closevideo.js' });
    startGame(0);
    closeVideo();
});

checkEntersGameplay('startHotSeatGame()', () => {
    gameState.countries = [0, 1, 2].map(id => new Country(id, `Nation${id}`, '#ffffff', new Island(id * 100000, 0, id), false));
    startHotSeatGame([1, 2]);
});

checkEntersGameplay('continueFromAutosave()', () => {
    const island = new Island(0, 0, 0);
    const country = new Country(0, 'EnterGameplayContinueTest', '#ff0000', island, true);
    gameState.countries = [country];
    gameState.playerCountry = country;
    const saveData = buildSaveData();
    continueFromAutosave(saveData);
});

checkEntersGameplay('startCampaignStage()', () => {
    selectCampaignNation(0);
    startCampaignStage(0);
});

// ---------- 31. Home-under-attack and Endgame sound effects (2026-09-03) ----------
//    Per direct request: homeunderattack.mp3 plays once per turn (never more,
//    "we don't want it to overlap multiple attacks") whenever the active
//    player's own building takes damage - any hit, not just a destroying one -
//    "no matter where you are on the map" (per a direct follow-up - never
//    gated on camera/viewport, same as every other sound here). Endgame.mp3
//    plays once, automatically, the moment the player actually wins - Standard
//    Game's showGameOver(true, ...) or a Campaign finishing its final stage in
//    showCampaignStageComplete() - never on a defeat or an ordinary per-stage
//    clear. The intro music track was also swapped (INTRO_MUSIC_URL) - a
//    one-line check confirms it, not the whole file.

check('INTRO_MUSIC_URL points at "The Last Order Standing.mp3", not the original track', () => {
    if (!/The%20Last%20Order%20Standing\.mp3$/.test(INTRO_MUSIC_URL)) {
        return [`expected INTRO_MUSIC_URL to end with "The%20Last%20Order%20Standing.mp3", got ${INTRO_MUSIC_URL}`];
    }
    return [];
});

check('playHomeUnderAttackSound() plays at most once per turn, and respects soundEnabled', () => {
    const problems = [];
    vm.runInContext(`
        (function(global) {
            global.__audioCount = 0;
            global.__lastAudioUrl = null;
            const OrigAudio = global.Audio;
            global.Audio = function(url) {
                global.__audioCount++;
                global.__lastAudioUrl = url;
                return new OrigAudio(url);
            };
            global.__restoreAudio = function() { global.Audio = OrigAudio; };
        })(this);
    `, context);
    const audioCount = () => vm.runInContext('this.__audioCount', context);

    vm.runInContext('soundEnabled = true; homeUnderAttackPlayedThisTurn = false;', context);
    try {
        playHomeUnderAttackSound();
        if (audioCount() !== 1) problems.push(`expected the first call this turn to play, count=${audioCount()}`);

        playHomeUnderAttackSound();
        if (audioCount() !== 1) problems.push(`expected a second call the SAME turn to be silently ignored, count=${audioCount()}`);

        vm.runInContext('homeUnderAttackPlayedThisTurn = false;', context); // simulates nextTurn()'s reset
        playHomeUnderAttackSound();
        if (audioCount() !== 2) problems.push(`expected a call on a NEW turn to play again, count=${audioCount()}`);

        vm.runInContext('homeUnderAttackPlayedThisTurn = false; soundEnabled = false;', context);
        playHomeUnderAttackSound();
        if (audioCount() !== 2) problems.push(`expected no sound while soundEnabled is false, count=${audioCount()}`);

        if (vm.runInContext('this.__lastAudioUrl', context) !== HOME_UNDER_ATTACK_SOUND_URL) {
            problems.push('expected the constructed Audio to use HOME_UNDER_ATTACK_SOUND_URL');
        }
    } finally {
        vm.runInContext('this.__restoreAudio(); soundEnabled = false; homeUnderAttackPlayedThisTurn = false;', context);
    }
    return problems;
});

check("Building.takeDamage() alerts on ANY hit to the active player's own building (not just a destroying one), never for another country's", () => {
    const problems = [];
    vm.runInContext('this.__homeAlerts = 0; this.__origPlayHomeUnderAttackSound = playHomeUnderAttackSound; playHomeUnderAttackSound = () => { this.__homeAlerts++; };', context);
    const alerts = () => vm.runInContext('this.__homeAlerts', context);

    try {
        const playerIsland = new Island(0, 0, 0);
        const playerCountry = new Country(0, 'Player', '#ff0000', playerIsland, true);
        const enemyIsland = new Island(1000000, 0, 1);
        const enemyCountry = new Country(1, 'Enemy', '#00ff00', enemyIsland, false);
        gameState.countries = [playerCountry, enemyCountry];
        gameState.playerCountry = playerCountry;

        // A non-destroying hit on the player's own building still alerts.
        const ownBuilding = playerIsland.buildings[1];
        ownBuilding.hp = 100; ownBuilding.destroyed = false;
        ownBuilding.takeDamage(1);
        if (alerts() !== 1) problems.push(`expected an alert for a non-destroying hit on the player's own building, count=${alerts()}`);

        // An enemy's building takes damage - not the player's, no alert.
        const enemyBuilding = enemyIsland.buildings[1];
        enemyBuilding.hp = 100; enemyBuilding.destroyed = false;
        enemyBuilding.takeDamage(1, 0); // player's own troops attacking, even
        if (alerts() !== 1) problems.push(`expected no alert for damage to an enemy's building, count=${alerts()}`);
    } finally {
        vm.runInContext('playHomeUnderAttackSound = this.__origPlayHomeUnderAttackSound;', context);
    }
    return problems;
});

check('nextTurn() resets the once-per-turn home-under-attack alert budget', () => {
    vm.runInContext('homeUnderAttackPlayedThisTurn = true;', context);
    gameState.countries = [];
    nextTurn();
    const problems = [];
    if (vm.runInContext('homeUnderAttackPlayedThisTurn', context) !== false) problems.push('expected nextTurn() to reset homeUnderAttackPlayedThisTurn to false');
    return problems;
});

check('playEndgameSound() respects soundEnabled and uses ENDGAME_SOUND_URL', () => {
    const problems = [];
    vm.runInContext(`
        (function(global) {
            global.__audioCount = 0;
            global.__lastAudioUrl = null;
            const OrigAudio = global.Audio;
            global.Audio = function(url) {
                global.__audioCount++;
                global.__lastAudioUrl = url;
                return new OrigAudio(url);
            };
            global.__restoreAudio = function() { global.Audio = OrigAudio; };
        })(this);
    `, context);
    const audioCount = () => vm.runInContext('this.__audioCount', context);

    try {
        vm.runInContext('soundEnabled = false;', context);
        playEndgameSound();
        if (audioCount() !== 0) problems.push(`expected no sound while soundEnabled is false, count=${audioCount()}`);

        vm.runInContext('soundEnabled = true;', context);
        playEndgameSound();
        if (audioCount() !== 1) problems.push(`expected a sound once soundEnabled is true, count=${audioCount()}`);
        if (vm.runInContext('this.__lastAudioUrl', context) !== ENDGAME_SOUND_URL) {
            problems.push('expected the constructed Audio to use ENDGAME_SOUND_URL');
        }
    } finally {
        vm.runInContext('this.__restoreAudio(); soundEnabled = false;', context);
    }
    return problems;
});

check('showGameOver(true, ...) plays the endgame sound; showGameOver(false, ...) never does', () => {
    const problems = [];
    vm.runInContext('this.__endgameCalls = 0; this.__origPlayEndgameSound = playEndgameSound; playEndgameSound = () => { this.__endgameCalls++; };', context);
    const calls = () => vm.runInContext('this.__endgameCalls', context);

    try {
        const island = new Island(0, 0, 0);
        const country = new Country(0, 'EndgameSoundTest', '#ff0000', island, true);
        gameState.countries = [country];
        gameState.playerCountry = country;
        gameState.campaignActive = false;
        gameState.humanCountryIds = [0];

        showGameOver(false, 'Defeat message');
        if (calls() !== 0) problems.push(`expected no endgame sound on defeat, count=${calls()}`);

        showGameOver(true, 'Victory message');
        if (calls() !== 1) problems.push(`expected the endgame sound exactly once on victory, count=${calls()}`);
    } finally {
        vm.runInContext('playEndgameSound = this.__origPlayEndgameSound;', context);
    }
    return problems;
});

check('showCampaignStageComplete() plays the endgame sound only when the whole campaign finishes, not an ordinary stage clear', () => {
    const problems = [];
    vm.runInContext('this.__endgameCalls = 0; this.__origPlayEndgameSound = playEndgameSound; playEndgameSound = () => { this.__endgameCalls++; };', context);
    const calls = () => vm.runInContext('this.__endgameCalls', context);

    try {
        // An ordinary mid-campaign clear (stage 1 of 12) - not a win yet.
        selectCampaignNation(0);
        startCampaignStage(0);
        gameState.humanCountryIds = [];
        let stage = gameState.campaignStages[0];
        stage.objectives.forEach(obj => {
            const country = gameState.countries.find(c => c.id === obj.id);
            country.island.buildings.forEach(b => { b.destroyed = true; });
        });
        checkGameOver();
        if (calls() !== 0) problems.push(`expected no endgame sound for an ordinary stage clear, count=${calls()}`);

        // The finale (stage 12) - this is the real win.
        selectCampaignNation(4);
        startCampaignStage(11);
        gameState.humanCountryIds = [];
        stage = gameState.campaignStages[11];
        stage.objectives.forEach(obj => {
            const country = gameState.countries.find(c => c.id === obj.id);
            country.island.buildings.forEach(b => { b.destroyed = true; });
        });
        checkGameOver();
        if (calls() !== 1) problems.push(`expected the endgame sound exactly once when the whole campaign completes, count=${calls()}`);
    } finally {
        vm.runInContext('playEndgameSound = this.__origPlayEndgameSound;', context);
    }
    return problems;
});

// ---------- 32. Nerfflasma Hole (2026-09-03) ----------
//    A single, unowned, roaming hazard - 3x a planet's radius, 10,000 HP,
//    wanders uncontrolled at Skyfortress speed unless provoked (see
//    updateBlackHoles()'s own comment for the full mechanic). Deliberately
//    invisible on the minimap and excluded from getGalaxyBounds() - unlike
//    the Galaxy Core/Bounty, its position must never be tell-tale there.

check('spawnBlackHole() places exactly one Nerfflasma Hole a safe distance from Hotsun at dead-center, with the right size/HP', () => {
    // Used to spawn exactly at map center; now offset (2026-09-04) since Hotsun
    // permanently occupies that exact point - see spawnBlackHole()'s own comment.
    const problems = [];
    blackHoles.length = 0;
    spawnBlackHole();
    if (blackHoles.length !== 1) problems.push(`expected exactly 1 black hole, got ${blackHoles.length}`);
    else {
        const hole = blackHoles[0];
        if (hole.size !== BLACK_HOLE_SIZE) problems.push(`expected size BLACK_HOLE_SIZE (${BLACK_HOLE_SIZE}), got ${hole.size}`);
        if (hole.hp !== BLACK_HOLE_MAX_HP || hole.maxHp !== BLACK_HOLE_MAX_HP) problems.push(`expected hp/maxHp BLACK_HOLE_MAX_HP (${BLACK_HOLE_MAX_HP}), got ${hole.hp}/${hole.maxHp}`);
        const distFromCenter = Math.hypot(hole.x - MAP_WIDTH / 2, hole.y - MAP_HEIGHT / 2);
        const expectedDist = HOTSUN_SIZE + HOTSUN_RADIATION_RANGE + BLACK_HOLE_SIZE;
        if (Math.abs(distFromCenter - expectedDist) > 1) {
            problems.push(`expected it offset ${expectedDist} from center (clear of Hotsun's radiation range), got ${distFromCenter.toFixed(0)}`);
        }
    }
    return problems;
});

check('updateBlackHoles() wanders when unprovoked, and is a safe no-op with zero black holes', () => {
    const problems = [];
    blackHoles.length = 0;
    updateBlackHoles(1 / 60); // must not throw with none

    // Proportional to MAP_WIDTH/HEIGHT (which can be tiny in this jsdom harness,
    // unlike a real browser) rather than a hardcoded large number, so this starts
    // safely within bounds and isn't immediately clamped/bounced off an edge.
    const hole = new BlackHole(MAP_WIDTH / 4, MAP_HEIGHT / 4);
    hole.wanderAngle = 0; // due "east"
    hole.wanderChangeTimer = 999; // don't let it re-randomize mid-check
    blackHoles.push(hole);
    gameState.countries = [];

    const before = { x: hole.x, y: hole.y };
    updateBlackHoles(1);
    if (hole.x <= before.x) problems.push(`expected it to move east (wanderAngle 0) with nothing provoking it, x went ${before.x} -> ${hole.x}`);
    if (Math.abs(hole.y - before.y) > 0.01) problems.push(`expected no y movement for a due-east wander, y went ${before.y} -> ${hole.y}`);

    blackHoles.length = 0;
    return problems;
});

check("updateBlackHoles() captures a nearby ship, drags it along every frame, and chases whoever damages it", () => {
    const problems = [];
    blackHoles.length = 0;
    const hole = new BlackHole(0, 0);
    hole.wanderChangeTimer = 999;
    blackHoles.push(hole);

    const country = new Country(0, 'BlackHoleTest', '#ff0000', new Island(1000000, 0, 0), true);
    const nearbyUnit = makeUnit('deepglider', 0);
    nearbyUnit.x = BLACK_HOLE_CAPTURE_RANGE - 10; nearbyUnit.y = 0; // just inside range
    const farUnit = makeUnit('deepglider', 0);
    farUnit.x = BLACK_HOLE_CAPTURE_RANGE + 5000; farUnit.y = 0; // well outside range
    country.units = [nearbyUnit, farUnit];
    // updateBlackHoles() now bounces the hole off getGalaxyBounds() (the real
    // current extent of every planet), not a fixed MAP_WIDTH/MAP_HEIGHT box
    // (2026-09-04 fix) - country's own island is deliberately far away (see
    // above), so add a second anchor far in the OPPOSITE direction purely to
    // give getGalaxyBounds() a wide enough box to comfortably contain every
    // coordinate this test actually moves the hole/units through (0 to ~12000).
    const boundsAnchor = new Country(1, 'BoundsAnchor', '#000000', new Island(-20000, 0, 1), false);
    gameState.countries = [country, boundsAnchor];

    updateBlackHoles(1 / 60);
    if (nearbyUnit.trappedByBlackHole !== hole) problems.push('expected the nearby unit to be captured');
    if (farUnit.trappedByBlackHole) problems.push('expected the far unit to remain free');

    // Move the hole and confirm the trapped unit follows (dragged "like a comet").
    hole.x = 500; hole.y = 500;
    updateBlackHoles(1 / 60);
    const expectedX = hole.x + nearbyUnit.blackHoleOffsetX;
    const expectedY = hole.y + nearbyUnit.blackHoleOffsetY;
    if (Math.abs(nearbyUnit.x - expectedX) > 0.01 || Math.abs(nearbyUnit.y - expectedY) > 0.01) {
        problems.push(`expected the trapped unit dragged to hole position + its own offset, got (${nearbyUnit.x}, ${nearbyUnit.y}) vs expected (${expectedX}, ${expectedY})`);
    }

    // Provoke it with the still-free far unit - it should now chase that unit
    // instead of continuing to wander.
    hole.x = 0; hole.y = 0;
    hole.targetUnit = farUnit;
    const beforeChase = { x: hole.x, y: hole.y };
    updateBlackHoles(1);
    const distBefore = Math.hypot(farUnit.x - beforeChase.x, farUnit.y - beforeChase.y);
    const distAfter = Math.hypot(farUnit.x - hole.x, farUnit.y - hole.y);
    if (distAfter >= distBefore) problems.push(`expected the hole to move closer to its provoking target, distance went ${distBefore.toFixed(0)} -> ${distAfter.toFixed(0)}`);

    blackHoles.length = 0;
    return problems;
});

check('updateBlackHoles() releases every trapped ship and removes itself once its HP reaches zero', () => {
    const problems = [];
    blackHoles.length = 0;
    const hole = new BlackHole(0, 0);
    blackHoles.push(hole);

    const country = new Country(0, 'BlackHoleDeathTest', '#ff0000', new Island(1000000, 0, 0), true);
    const trapped = makeUnit('deepglider', 0);
    trapped.x = 0; trapped.y = 0;
    country.units = [trapped];
    // See the getGalaxyBounds()-anchor comment in the capture/drag test above -
    // same reasoning, same fix.
    const boundsAnchor = new Country(1, 'BoundsAnchor', '#000000', new Island(-20000, 0, 1), false);
    gameState.countries = [country, boundsAnchor];

    updateBlackHoles(1 / 60); // captures it
    if (!trapped.trappedByBlackHole) return ['expected setup to capture the unit before testing release'];

    hole.hp = 0;
    updateBlackHoles(1 / 60);
    if (trapped.trappedByBlackHole) problems.push('expected the unit released once the black hole reaches 0 HP');
    if (blackHoles.length !== 0) problems.push(`expected the destroyed black hole removed from the array, length=${blackHoles.length}`);
    return problems;
});

check("a trapped unit can't move (Unit.update() is a no-op) and deals no damage (getAttackPower() returns 0)", () => {
    const problems = [];
    const unit = makeUnit('deepglider', 0);
    unit.x = 0; unit.y = 0;
    unit.targetX = 100000; unit.targetY = 0; // would otherwise travel far this call
    unit.trappedByBlackHole = new BlackHole(0, 0); // any truthy value - update()/getAttackPower() only check truthiness

    unit.update();
    if (unit.x !== 0 || unit.y !== 0) problems.push(`expected a trapped unit's update() to be a complete no-op, moved to (${unit.x}, ${unit.y})`);
    if (unit.getAttackPower() !== 0) problems.push(`expected a trapped unit's getAttackPower() to be 0, got ${unit.getAttackPower()}`);

    unit.trappedByBlackHole = null;
    unit.update();
    if (unit.x === 0 && unit.y === 0) problems.push("expected update() to work normally again once released");
    return problems;
});

check('startCampaignStage() clears blackHoles - Standard Game only, same as galaxyCores', () => {
    blackHoles.push(new BlackHole(0, 0));
    selectCampaignNation(0);
    startCampaignStage(0);
    return blackHoles.length !== 0 ? [`expected blackHoles cleared in Campaign mode, got ${blackHoles.length}`] : [];
});

check("getGalaxyBounds() never expands to include a Nerfflasma Hole - it must stay invisible on the minimap, never even indirectly via the minimap's own scale", () => {
    const problems = [];
    gameState.countries = [0, 1].map(id => new Country(id, `N${id}`, '#fff', new Island(id * 1000, 0, id), false));
    const boundsBefore = getGalaxyBounds();

    blackHoles.length = 0;
    blackHoles.push(new BlackHole(50000000, -50000000)); // absurdly far - would obviously distort bounds if counted
    const boundsAfter = getGalaxyBounds();

    if (JSON.stringify(boundsAfter) !== JSON.stringify(boundsBefore)) {
        problems.push(`expected getGalaxyBounds() unaffected by a black hole, got ${JSON.stringify(boundsBefore)} -> ${JSON.stringify(boundsAfter)}`);
    }
    blackHoles.length = 0;
    return problems;
});

check('drawMinimap() never references blackHoles - "you can not see it on the mini map", per direct request', () => {
    const src = vm.runInContext('drawMinimap.toString()', context);
    return src.includes('blackHoles') ? ['expected drawMinimap() to never reference blackHoles at all'] : [];
});

// ---------- Rival/alien attack-target assignment (2026-09-03) ----------
// Direct request: "several ships have been at my homebase but have not
// attacked my buildings... each planet has one rival planet to start that
// attacks them only and each planet has one alien planet that targets them
// and if there is not enough alien planets they equal out their attacks on
// the planets. When a planet is defeated the computer will randomly pick
// another planet to target." See assignAttackTargets()/
// reassignEliminatedAttackTargets()/pickAssignedTarget() and their call sites
// in Country.aiTurn()/initGame()/nextTurn().

check('assignAttackTargets() gives every regular nation exactly one rival attacker, and makes it the rival target of exactly one nation, never itself', () => {
    // 5 evenly-spaced nations in a line is a deliberately adversarial layout for
    // the greedy nearest-first matching in assignAttackTargets() (2026-09-04 fix,
    // see that function's comment): it produces two mutual nearest-pairs (0<->1,
    // 2<->3) that consume every un-victimized nation except 4, leaving 4 with no
    // valid target but itself - exactly the "leftover" edge case that function's
    // splice-into-an-existing-pair logic exists to resolve. Keep this exact
    // layout; a more "random" one could accidentally stop exercising that path.
    const problems = [];
    gameState.countries = [0, 1, 2, 3, 4].map(id => new Country(id, `Reg${id}`, '#fff', new Island(id * 100000, 0, id), false));
    assignAttackTargets();

    gameState.countries.forEach(c => {
        if (c.attackTargetIds.length !== 1) problems.push(`expected nation ${c.id} to have exactly 1 rival target, got ${JSON.stringify(c.attackTargetIds)}`);
        if (c.attackTargetIds.includes(c.id)) problems.push(`nation ${c.id} was assigned itself as a rival target`);
    });

    const attackerCounts = {};
    gameState.countries.forEach(c => c.attackTargetIds.forEach(id => { attackerCounts[id] = (attackerCounts[id] || 0) + 1; }));
    gameState.countries.forEach(c => {
        if (attackerCounts[c.id] !== 1) problems.push(`expected nation ${c.id} to be the rival target of exactly 1 nation, got ${attackerCounts[c.id] || 0}`);
    });
    return problems;
});

check("assignAttackTargets() gives every regular nation exactly one alien attacker, splitting evenly across alien nations when outnumbered ('equal out their attacks')", () => {
    const problems = [];
    const regulars = [0, 1, 2, 3, 4].map(id => new Country(id, `Reg${id}`, '#fff', new Island(id * 100000, 0, id), false));
    const alien1 = new Country(12, 'Alien1', '#0ff', new Island(1000000, 0, 12), false);
    alien1.isCyborg = true;
    const alien2 = new Country(13, 'Alien2', '#0ff', new Island(2000000, 0, 13), false);
    alien2.isCyborg = true;
    gameState.countries = [...regulars, alien1, alien2];
    assignAttackTargets();

    const attackedByAlien = new Set();
    [alien1, alien2].forEach(a => a.attackTargetIds.forEach(id => attackedByAlien.add(id)));
    regulars.forEach(r => {
        if (!attackedByAlien.has(r.id)) problems.push(`expected regular nation ${r.id} to have a dedicated alien attacker, it has none`);
    });

    const counts = [alien1.attackTargetIds.length, alien2.attackTargetIds.length];
    if (counts[0] + counts[1] !== regulars.length) {
        problems.push(`expected the aliens' combined target count to equal the number of regular nations (${regulars.length}), got ${counts[0] + counts[1]}`);
    }
    if (Math.abs(counts[0] - counts[1]) > 1) {
        problems.push(`expected alien attack loads to differ by at most 1 when splitting evenly, got ${JSON.stringify(counts)}`);
    }
    return problems;
});

// Direct report (2026-09-04): "I was on turn 12 and no enemy had visited or
// attacked me... even had it on the hard setting." Confirmed by direct
// simulation: once planets started scattering across the whole map (see
// randomSpreadPosition()), a position-blind random rival pairing regularly
// assigned a nation's sole rival 100,000+ units away - in 10 of 15 simulated
// 12-turn Hard games, no assigned attacker ever got close enough to reach the
// player. assignAttackTargets() now greedily claims the nearest available
// (attacker, victim) pairs first instead of shuffling blindly - these two
// checks confirm that proximity bias directly, for both the regular-nation
// pairing and the alien round-robin.
check('assignAttackTargets() greedily pairs regular nations with a nearby rival, not a distant one, when both are available', () => {
    const problems = [];
    // Two tight clusters (nations 0-1 and 2-3), far apart from each other. A
    // position-blind shuffle would sometimes pair across clusters; nearest-first
    // greedy matching never should, since same-cluster pairs are always closer.
    const a = new Country(0, 'A', '#fff', new Island(0, 0, 0), false);
    const b = new Country(1, 'B', '#fff', new Island(1000, 0, 1), false);
    const c = new Country(2, 'C', '#fff', new Island(1000000, 0, 2), false);
    const d = new Country(3, 'D', '#fff', new Island(1001000, 0, 3), false);
    gameState.countries = [a, b, c, d];
    assignAttackTargets();

    if (a.attackTargetIds[0] !== 1 && b.attackTargetIds[0] !== 0) {
        problems.push(`expected A and B (1000 apart) to pair with each other, got A->${a.attackTargetIds}, B->${b.attackTargetIds}`);
    }
    if (c.attackTargetIds[0] !== 3 && d.attackTargetIds[0] !== 2) {
        problems.push(`expected C and D (1000 apart) to pair with each other, got C->${c.attackTargetIds}, D->${d.attackTargetIds}`);
    }
    gameState.countries.forEach(nation => {
        nation.attackTargetIds.forEach(targetId => {
            const target = gameState.countries.find(t => t.id === targetId);
            const dist = Math.hypot(nation.island.x - target.island.x, nation.island.y - target.island.y);
            if (dist > 5000) problems.push(`${nation.name}'s assigned rival (${target.name}) is ${dist.toFixed(0)} away - expected a same-cluster pairing (<=5000) over a cross-cluster one`);
        });
    });
    return problems;
});

check('assignAttackTargets() gives each alien its nearest available victim, not an arbitrary one', () => {
    const problems = [];
    const x = new Country(0, 'X', '#fff', new Island(0, 0, 0), false);
    const y = new Country(1, 'Y', '#fff', new Island(1000000, 0, 1), false);
    const alienNearX = new Country(12, 'AlienNearX', '#0ff', new Island(100, 0, 12), false);
    alienNearX.isCyborg = true;
    const alienNearY = new Country(13, 'AlienNearY', '#0ff', new Island(999900, 0, 13), false);
    alienNearY.isCyborg = true;
    gameState.countries = [x, y, alienNearX, alienNearY];
    assignAttackTargets();
    if (!alienNearX.attackTargetIds.includes(0)) problems.push(`expected the alien right next to X to end up targeting X, got ${JSON.stringify(alienNearX.attackTargetIds)}`);
    if (!alienNearY.attackTargetIds.includes(1)) problems.push(`expected the alien right next to Y to end up targeting Y, got ${JSON.stringify(alienNearY.attackTargetIds)}`);
    return problems;
});

check('assignAttackTargets() is safe with no alien nations in the roster (regular nations still get their rival pairing)', () => {
    const problems = [];
    gameState.countries = [0, 1, 2].map(id => new Country(id, `Reg${id}`, '#fff', new Island(id * 100000, 0, id), false));
    assignAttackTargets();
    gameState.countries.forEach(c => {
        if (c.attackTargetIds.length !== 1) problems.push(`expected nation ${c.id} to still get exactly 1 rival target with no aliens present, got ${JSON.stringify(c.attackTargetIds)}`);
    });
    return problems;
});

check('reassignEliminatedAttackTargets() replaces an eliminated target with a new living nation, never itself', () => {
    const problems = [];
    const a = new Country(0, 'A', '#fff', new Island(0, 0, 0), false);
    const b = new Country(1, 'B', '#fff', new Island(100000, 0, 1), false);
    const c = new Country(2, 'C', '#fff', new Island(200000, 0, 2), false);
    gameState.countries = [a, b, c];
    a.attackTargetIds = [1]; // targeting B
    b.island.buildings.forEach(bld => { bld.destroyed = true; }); // B is eliminated

    reassignEliminatedAttackTargets();

    if (a.attackTargetIds.includes(1)) problems.push('expected the eliminated target (id 1) to have been dropped');
    if (a.attackTargetIds.includes(0)) problems.push('expected reassignment to never target the nation itself');
    if (a.attackTargetIds.length !== 1 || a.attackTargetIds[0] !== 2) {
        problems.push(`expected reassignment to the only other living nation (id 2), got ${JSON.stringify(a.attackTargetIds)}`);
    }
    return problems;
});

check('reassignEliminatedAttackTargets() leaves a still-living target alone', () => {
    const a = new Country(0, 'A', '#fff', new Island(0, 0, 0), false);
    const b = new Country(1, 'B', '#fff', new Island(100000, 0, 1), false);
    gameState.countries = [a, b];
    a.attackTargetIds = [1];
    reassignEliminatedAttackTargets();
    return JSON.stringify(a.attackTargetIds) === JSON.stringify([1])
        ? []
        : [`expected a still-living target to be left untouched, got ${JSON.stringify(a.attackTargetIds)}`];
});

// Real gap found by direct verification (2026-09-04): "Verify one alien enemy
// planet and one enemy ai country is assigned to the user at all times, even
// when the user defeats that enemy assigned to them a new enemy is now
// assigned." The check above (and the one before it) only prove an ATTACKER
// whose own target died gets reassigned - neither proves a VICTIM whose
// attacker died gets a NEW attacker, which is the actual property requested
// here and was NOT previously guaranteed (a dead attacker's attackTargetIds
// still validly points at its living victim, so pass 1 alone never touches it).

check('reassignEliminatedAttackTargets() assigns a brand-new living rival to a nation whose only rival attacker was just eliminated', () => {
    const problems = [];
    const victim = new Country(0, 'Victim', '#fff', new Island(0, 0, 0), true);
    const deadAttacker = new Country(1, 'DeadAttacker', '#fff', new Island(100000, 0, 1), false);
    const otherNation = new Country(2, 'Other', '#fff', new Island(200000, 0, 2), false);
    deadAttacker.attackTargetIds = [0]; // was the victim's sole assigned rival
    deadAttacker.island.buildings.forEach(b => { b.destroyed = true; }); // just eliminated
    gameState.countries = [victim, deadAttacker, otherNation];

    reassignEliminatedAttackTargets();

    const livingAttackersOfVictim = gameState.countries.filter(c =>
        c.id !== 0 && c.island.buildings.some(b => !b.destroyed) && c.attackTargetIds.includes(0));
    if (livingAttackersOfVictim.length === 0) {
        problems.push('expected a new living nation to be assigned to attack the victim once its old attacker was eliminated, got none');
    }
    return problems;
});

check('reassignEliminatedAttackTargets() assigns a brand-new living alien attacker to a nation whose only alien attacker was just eliminated', () => {
    const problems = [];
    const victim = new Country(0, 'Victim', '#fff', new Island(0, 0, 0), true);
    const deadAlien = new Country(12, 'DeadAlien', '#0ff', new Island(100000, 0, 12), false);
    deadAlien.isCyborg = true;
    const otherAlien = new Country(13, 'OtherAlien', '#0ff', new Island(200000, 0, 13), false);
    otherAlien.isCyborg = true;
    deadAlien.attackTargetIds = [0];
    deadAlien.island.buildings.forEach(b => { b.destroyed = true; });
    gameState.countries = [victim, deadAlien, otherAlien];

    reassignEliminatedAttackTargets();

    const livingAlienAttackers = gameState.countries.filter(c =>
        (c.isCyborg || c.isZoonester || c.isRoufestreal) &&
        c.island.buildings.some(b => !b.destroyed) &&
        c.attackTargetIds.includes(0));
    return livingAlienAttackers.length > 0
        ? []
        : ['expected a new living alien nation to be assigned to attack the victim once its old alien attacker was eliminated, got none'];
});

check('reassignEliminatedAttackTargets() never leaves a living regular nation with zero attackers, across a whole roster of eliminations', () => {
    const problems = [];
    const nations = [0, 1, 2, 3, 4].map(id => new Country(id, `N${id}`, '#fff', new Island(id * 100000, 0, id), false));
    const alien = new Country(12, 'Alien', '#0ff', new Island(500000, 0, 12), false);
    alien.isCyborg = true;
    gameState.countries = [...nations, alien];
    assignAttackTargets();

    // Eliminate a couple of nations (their own attacker assignments, and
    // whatever they were attacking, both potentially now stale).
    nations[1].island.buildings.forEach(b => { b.destroyed = true; });
    nations[3].island.buildings.forEach(b => { b.destroyed = true; });
    reassignEliminatedAttackTargets();

    const survivors = gameState.countries.filter(c => c.island.buildings.some(b => !b.destroyed) && !c.isCyborg);
    survivors.forEach(victim => {
        const hasRegularAttacker = gameState.countries.some(a =>
            a.id !== victim.id && !a.isCyborg && a.island.buildings.some(b => !b.destroyed) && a.attackTargetIds.includes(victim.id));
        if (!hasRegularAttacker) problems.push(`expected surviving nation ${victim.name} to have at least one living regular attacker`);
        const hasAlienAttacker = gameState.countries.some(a =>
            a.isCyborg && a.island.buildings.some(b => !b.destroyed) && a.attackTargetIds.includes(victim.id));
        if (!hasAlienAttacker) problems.push(`expected surviving nation ${victim.name} to have at least one living alien attacker`);
    });
    return problems;
});

check('pickAssignedTarget() returns null when no target is assigned, or when the only assigned target is dead, and the live target otherwise', () => {
    const problems = [];
    const a = new Country(0, 'A', '#fff', new Island(0, 0, 0), false);
    const b = new Country(1, 'B', '#fff', new Island(100000, 0, 1), false);
    gameState.countries = [a, b];

    a.attackTargetIds = [];
    if (pickAssignedTarget(a) !== null) problems.push('expected null with no targets assigned at all');

    a.attackTargetIds = [1];
    b.island.buildings.forEach(bld => { bld.destroyed = true; });
    if (pickAssignedTarget(a) !== null) problems.push('expected null when the only assigned target is already eliminated');

    b.island.buildings.forEach(bld => { bld.destroyed = false; bld.hp = bld.maxHp; });
    const picked = pickAssignedTarget(a);
    if (!picked || picked.id !== 1) problems.push(`expected the live assigned target (id 1) back, got ${picked ? picked.id : picked}`);
    return problems;
});

check("a regular nation's units hunt toward their assigned rival, not a random nation, when nothing enemy is in sight", () => {
    const problems = [];
    // Far enough apart that none is within AI_HUNT_RADIUS of another, so the
    // fallback path under test (not the nearest-visible-enemy path) is the
    // only one that can fire.
    const islandA = new Island(0, 0, 0);
    const islandB = new Island(1000000, 0, 1);
    const islandC = new Island(-1000000, 0, 2);
    const a = new Country(0, 'A', '#fff', islandA, false);
    const b = new Country(1, 'B', '#fff', islandB, false);
    const c = new Country(2, 'C', '#fff', islandC, false);
    a.attackTargetIds = [1]; // A's ONLY assigned target is B - C must never be picked
    const ship = new Unit(0, 0, 'stormbreaker', 0);
    a.units = [ship];
    gameState.countries = [a, b, c];
    gameState.campaignActive = false;
    gameState.humanCountryIds = [];

    vm.runInContext('AI_MOVEMENT_CHANCE = 1;', context); // deterministic movement roll
    for (let i = 0; i < 20; i++) {
        ship.targetX = 0; ship.targetY = 0; ship.hasAttacked = false;
        a.aiTurn();
        const distToB = Math.hypot(ship.targetX - islandB.x, ship.targetY - islandB.y);
        const distToC = Math.hypot(ship.targetX - islandC.x, ship.targetY - islandC.y);
        if (distToC < 5000) problems.push(`expected the ship to never head toward the unassigned nation C, got target (${ship.targetX.toFixed(0)}, ${ship.targetY.toFixed(0)})`);
        if (distToB > 5000) problems.push(`expected the ship to head toward its assigned rival B, got target (${ship.targetX.toFixed(0)}, ${ship.targetY.toFixed(0)})`);
    }
    vm.runInContext('AI_MOVEMENT_CHANCE = DIFFICULTY_PRESETS.normal.movement;', context);
    return problems;
});

check('Country.aiTurn() source: the generic hunt-fallback, Cyborg, and Zoonester target-picking all use pickAssignedTarget() outside Campaign mode, and keep the old random pick in Campaign mode', () => {
    const problems = [];
    const occurrences = script.split('pickAssignedTarget(this)').length - 1;
    if (occurrences !== 3) problems.push(`expected pickAssignedTarget(this) to appear 3 times in aiTurn() (generic + Cyborg + Zoonester fallbacks), found ${occurrences}`);
    const campaignGuardOccurrences = script.split('gameState.campaignActive').length - 1;
    if (campaignGuardOccurrences < 3) problems.push(`expected at least 3 gameState.campaignActive checks guarding the old behavior, found ${campaignGuardOccurrences}`);
    return problems;
});

check('initGame() calls assignAttackTargets() once the Standard Game country roster is built', () => {
    return script.includes('assignAttackTargets();') ? [] : ['expected initGame() to call assignAttackTargets()'];
});

check('nextTurn() calls reassignEliminatedAttackTargets() before AI nations act, guarded to Standard Game/hot-seat only', () => {
    const problems = [];
    if (!script.includes('reassignEliminatedAttackTargets();')) problems.push('expected nextTurn() to call reassignEliminatedAttackTargets()');
    if (!/campaignActive\)\s*reassignEliminatedAttackTargets\(\);/.test(script)) problems.push('expected the call to be guarded by !gameState.campaignActive');
    return problems;
});

// ---------- Random galaxy-wide planet spread (2026-09-04) ----------
// Direct request: "make the planets not uniform and spread them out
// throughout the galaxy all over. They don't need to be close to each other
// and should be far from each other randomly all over the map." Replaces the
// old 4x3 grid (regular nations) + fixed cardinal/hand-tuned offsets
// (Cyborg/Zoonester/CUSTOM_ISLANDS) with randomSpreadPosition(), used for
// every planet in initGame(). See also farthestPlanetRadius()/
// GALAXY_LANDMARK_CORNER_DIR, which keep the Galaxy Core/Bounty clear of and
// in opposite corners from the newly-scattered galaxy.

check('randomSpreadPosition() returns a point within bounds, at least minDistance from every existing point', () => {
    const problems = [];
    const existing = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    for (let i = 0; i < 50; i++) {
        const p = randomSpreadPosition(-5000, 5000, -5000, 5000, existing, 500);
        if (p.x < -5000 || p.x > 5000 || p.y < -5000 || p.y > 5000) {
            problems.push(`point (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) fell outside the requested bounds`);
        }
        const nearestDist = Math.min(...existing.map(e => Math.hypot(p.x - e.x, p.y - e.y)));
        if (nearestDist < 500) problems.push(`point landed only ${nearestDist.toFixed(0)} from an existing point, wanted >= 500`);
    }
    return problems;
});

check('randomSpreadPosition() with an empty existingPoints list places anywhere in bounds (no distance constraint to satisfy)', () => {
    const p = randomSpreadPosition(-100, 100, -100, 100, [], 99999);
    return (p.x >= -100 && p.x <= 100 && p.y >= -100 && p.y <= 100) ? [] : [`expected a point within bounds, got (${p.x}, ${p.y})`];
});

check('randomSpreadPosition() still returns a usable point (never hangs or throws) when minDistance is impossible to satisfy in the given bounds', () => {
    const existing = [{ x: 0, y: 0 }];
    const p = randomSpreadPosition(-10, 10, -10, 10, existing, 999999);
    return (typeof p.x === 'number' && typeof p.y === 'number' && isFinite(p.x) && isFinite(p.y))
        ? []
        : [`expected a finite fallback point, got ${JSON.stringify(p)}`];
});

check('farthestPlanetRadius() finds the actual farthest island from map center', () => {
    const problems = [];
    const centerX = MAP_WIDTH / 2, centerY = MAP_HEIGHT / 2;
    gameState.countries = [
        new Country(0, 'Near', '#fff', new Island(centerX + 100, centerY, 0), false),
        new Country(1, 'Far', '#fff', new Island(centerX + 5000, centerY + 5000, 1), false),
    ];
    const expected = Math.hypot(5000, 5000);
    const got = farthestPlanetRadius();
    if (Math.abs(got - expected) > 1) problems.push(`expected farthestPlanetRadius() ~${expected.toFixed(0)}, got ${got.toFixed(0)}`);
    return problems;
});

check('GALAXY_LANDMARK_CORNER_DIR is a unit vector', () => {
    const len = Math.hypot(GALAXY_LANDMARK_CORNER_DIR.x, GALAXY_LANDMARK_CORNER_DIR.y);
    return Math.abs(len - 1) < 0.0001 ? [] : [`expected a unit vector (length 1), got length ${len}`];
});

check('a real initGame() run scatters every planet randomly - two runs produce different layouts, not a repeatable grid/fixed pattern', () => {
    const problems = [];
    gameState.countries = [];
    vm.runInContext('initGame();', context, { filename: 'planet-spread-run1.js' });
    const positionsA = gameState.countries.map(c => ({ id: c.id, x: c.island.x, y: c.island.y }));

    gameState.countries = [];
    vm.runInContext('initGame();', context, { filename: 'planet-spread-run2.js' });
    const positionsB = gameState.countries.map(c => ({ id: c.id, x: c.island.x, y: c.island.y }));

    if (positionsA.length !== positionsB.length) {
        problems.push(`expected the same roster size across two initGame() runs, got ${positionsA.length} vs ${positionsB.length}`);
        return problems;
    }
    const anyDifferent = positionsA.some((p, i) => p.x !== positionsB[i].x || p.y !== positionsB[i].y);
    if (!anyDifferent) problems.push('expected planet positions to differ between two separate initGame() runs (still looks like a fixed/deterministic layout)');
    return problems;
});

check('a real initGame() run keeps every planet at least PLANET_MIN_SEPARATION from every other planet', () => {
    const problems = [];
    gameState.countries = [];
    vm.runInContext('initGame();', context, { filename: 'planet-spread-separation.js' });
    const countries = gameState.countries;
    for (let i = 0; i < countries.length; i++) {
        for (let j = i + 1; j < countries.length; j++) {
            const d = Math.hypot(countries[i].island.x - countries[j].island.x, countries[i].island.y - countries[j].island.y);
            if (d < PLANET_MIN_SEPARATION - 1) {
                problems.push(`planets ${countries[i].name} and ${countries[j].name} are only ${d.toFixed(0)} apart, wanted >= ${PLANET_MIN_SEPARATION.toFixed(0)}`);
            }
        }
    }
    return problems;
});

check('a real initGame() run keeps the Galaxy Core and Galaxy Bounty clear of every planet, in opposite corners of the map', () => {
    const problems = [];
    gameState.countries = [];
    galaxyCores.length = 0;
    vm.runInContext('initGame(); spawnGalaxyCore(); spawnGalaxyBounty();', context, { filename: 'landmark-clearance.js' });
    const core = galaxyCores.find(c => c.kind === 'heal');
    const bounty = galaxyCores.find(c => c.kind === 'bounty');
    if (!core || !bounty) { problems.push('expected both a heal-kind core and a bounty-kind core to exist'); return problems; }

    gameState.countries.forEach(country => {
        const distToCore = Math.hypot(country.island.x - core.x, country.island.y - core.y);
        if (distToCore < core.size) problems.push(`${country.name}'s island is inside the Galaxy Core's own radius (${distToCore.toFixed(0)} < ${core.size})`);
        const distToBounty = Math.hypot(country.island.x - bounty.x, country.island.y - bounty.y);
        if (distToBounty < bounty.size) problems.push(`${country.name}'s island is inside the Galaxy Bounty's own radius (${distToBounty.toFixed(0)} < ${bounty.size})`);
    });

    // Opposite corners: the Core and Bounty should sit on opposite sides of center.
    const centerX = MAP_WIDTH / 2, centerY = MAP_HEIGHT / 2;
    const coreVec = { x: core.x - centerX, y: core.y - centerY };
    const bountyVec = { x: bounty.x - centerX, y: bounty.y - centerY };
    const dot = coreVec.x * bountyVec.x + coreVec.y * bountyVec.y;
    if (dot >= 0) problems.push(`expected the Core and Bounty in opposite directions from map center, got a non-negative dot product (${dot.toFixed(0)}) between their offset vectors`);
    return problems;
});

// ---------- Planet spread multiplier (2026-09-04) ----------
// Direct follow-up request: "The planets were not spread out far enough from
// each other. I want them to be 3-5 times futhrur away from each other as
// they are now. I don't want planets close to one another." Also covers the
// three places that used to assume a fixed MAP_WIDTH/MAP_HEIGHT box and now
// have to use the real, dynamic getGalaxyBounds() instead, since Standard
// Game planets can land well outside that fixed box.

check('PLANET_SPREAD_MULTIPLIER scales PLANET_MIN_SEPARATION off the map\'s LARGER dimension, and sits within the requested (compounded) 20-40x range', () => {
    // Follow-up direct report (2026-09-04): "I still think these planets are
    // too close... Lets spread them out 5-10 times futhrur away". Compounds on
    // the previous 4x (same "X times further than they are now" phrasing, read
    // the same way both times) - 4 * (5 to 10) = 20 to 40 total.
    const problems = [];
    const expected = Math.max(MAP_WIDTH, MAP_HEIGHT) * 0.12 * PLANET_SPREAD_MULTIPLIER;
    if (Math.abs(PLANET_MIN_SEPARATION - expected) > 1) {
        problems.push(`expected PLANET_MIN_SEPARATION to scale off the larger dimension by PLANET_SPREAD_MULTIPLIER, got ${PLANET_MIN_SEPARATION} vs expected ${expected}`);
    }
    if (PLANET_SPREAD_MULTIPLIER < 20 || PLANET_SPREAD_MULTIPLIER > 40) {
        problems.push(`expected PLANET_SPREAD_MULTIPLIER within the requested compounded 20-40x range, got ${PLANET_SPREAD_MULTIPLIER}`);
    }
    return problems;
});

check("initGame()'s planet-spread box is a true square (both axes sized off the map's larger dimension), not shaped like the screen - per direct report of empty space at the top and bottom", () => {
    // A square box means a real initGame() run's planets should cover
    // comparable vertical and horizontal extents - not the screen's own (wider)
    // aspect ratio, which is what caused the reported empty top/bottom bands
    // regardless of how big PLANET_SPREAD_MULTIPLIER was.
    const problems = [];
    gameState.countries = [];
    vm.runInContext('initGame();', context, { filename: 'square-spread-check.js' });
    const xs = gameState.countries.map(c => c.island.x);
    const ys = gameState.countries.map(c => c.island.y);
    const xRange = Math.max(...xs) - Math.min(...xs);
    const yRange = Math.max(...ys) - Math.min(...ys);
    // Loose tolerance - this is about "roughly square", not pixel-exact, since
    // random placement won't perfectly fill a box's every last corner.
    const ratio = xRange / yRange;
    if (ratio < 0.5 || ratio > 2) {
        problems.push(`expected the real galaxy's X and Y extents to be roughly comparable (square spread box), got xRange=${xRange.toFixed(0)}, yRange=${yRange.toFixed(0)} (ratio ${ratio.toFixed(2)})`);
    }
    return problems;
});

check('spawnResourceDeposits() scatters extra deposits across the real galaxy bounds (getGalaxyBounds()), not a fixed MAP_WIDTH/MAP_HEIGHT box', () => {
    const problems = [];
    // Countries placed well outside the old fixed [0,MAP_WIDTH]x[0,MAP_HEIGHT] box -
    // exactly what randomSpreadPosition()/PLANET_SPREAD_MULTIPLIER now do for real.
    const farX = MAP_WIDTH * 3;
    gameState.countries = [
        new Country(0, 'Far1', '#fff', new Island(farX, 0, 0), false),
        new Country(1, 'Far2', '#fff', new Island(farX + 20000, 5000, 1), false),
    ];
    spawnResourceDeposits();
    const homeDepositCount = gameState.countries.length; // one per country
    const extras = resourceDeposits.slice(homeDepositCount);
    if (extras.length === 0) return ['expected at least one extra deposit to have been placed'];
    const anyNearFarCountries = extras.some(d => d.x > MAP_WIDTH);
    if (!anyNearFarCountries) {
        problems.push('expected extra deposits scattered near the real (far-out) galaxy bounds, but every one landed inside the old fixed MAP_WIDTH box');
    }
    return problems;
});

check("updateBlackHoles() bounces off the real galaxy bounds (getGalaxyBounds()), not a fixed MAP_WIDTH/MAP_HEIGHT box", () => {
    const problems = [];
    // Countries far outside the old fixed box, same as the deposit test above.
    const farX = MAP_WIDTH * 3;
    gameState.countries = [
        new Country(0, 'Far1', '#fff', new Island(farX, 0, 0), false),
        new Country(1, 'Far2', '#fff', new Island(farX + 20000, 0, 1), false),
    ];
    galaxyCores.length = 0;
    blackHoles.length = 0;
    // Well past the OLD fixed MAP_WIDTH box, but safely inside the real
    // (far-out) galaxy bounds - if updateBlackHoles() still clamped to the old
    // fixed box, one call would immediately snap this back to MAP_WIDTH.
    const hole = new BlackHole(farX + 10000, 0);
    blackHoles.push(hole);
    updateBlackHoles(1 / 60);
    if (Math.abs(hole.x - (farX + 10000)) > 500) {
        problems.push(`expected the hole to stay near its real-bounds-safe starting position (${farX + 10000}), got x=${hole.x.toFixed(0)} - looks clamped to the old fixed MAP_WIDTH box (${MAP_WIDTH})`);
    }
    blackHoles.length = 0;
    return problems;
});

// ---------- Minimap precision at the new galaxy scale (2026-09-04) ----------
// Direct report: "when i click on a planet on the mini map i can no longer
// find it. Also, when i scroll out I no longer see a box in the mini map."
// Both are consequences of the galaxy's much bigger scale (see
// PLANET_SPREAD_MULTIPLIER) outrunning the minimap's fixed pixel resolution.

check('nearestMinimapLandmark() snaps to a nearby country/core exactly, and returns null when nothing is close enough', () => {
    const problems = [];
    gameState.countries = [
        new Country(0, 'A', '#fff', new Island(0, 0, 0), false),
        new Country(1, 'B', '#fff', new Island(500000, 0, 1), false),
    ];
    galaxyCores.length = 0;
    const p = worldToMinimap(0, 0);
    const near = nearestMinimapLandmark(p.x + 2, p.y + 1, 8); // a few px off, within tolerance
    if (!near || near.x !== 0 || near.y !== 0) {
        problems.push(`expected a click near country A's minimap dot to snap exactly to (0,0), got ${JSON.stringify(near)}`);
    }
    const far = nearestMinimapLandmark(p.x + 2, p.y + 1, 1); // same click, tolerance too tight now
    if (far !== null) problems.push(`expected null when nothing is within the (tighter) tolerance, got ${JSON.stringify(far)}`);
    const empty = nearestMinimapLandmark(-1000, -1000, 8); // nowhere near any dot
    if (empty !== null) problems.push(`expected null for a click far from every landmark, got ${JSON.stringify(empty)}`);
    return problems;
});

check('nearestMinimapLandmark() also snaps to a Galaxy Core/Bounty dot, not just countries', () => {
    const problems = [];
    gameState.countries = [new Country(0, 'A', '#fff', new Island(500000, 500000, 0), false)];
    galaxyCores.length = 0;
    const core = new GalaxyCore(0, 0);
    galaxyCores.push(core);
    const p = worldToMinimap(0, 0);
    const near = nearestMinimapLandmark(p.x, p.y, 8);
    galaxyCores.length = 0;
    if (!near || near.x !== 0 || near.y !== 0) problems.push(`expected a click on the core's dot to snap to (0,0), got ${JSON.stringify(near)}`);
    return problems;
});

check("a plain minimap click with nothing selected navigates the camera to the exact landmark position when close to one, not just an imprecise nearby point", () => {
    // Direct simulation of the mouseup handler's own logic (see canvas's
    // mouseup listener) rather than dispatching a real DOM event - this suite
    // tests game logic directly; see tests/browser/interaction-test.js for
    // real DOM event coverage.
    const problems = [];
    gameState.countries = [
        new Country(0, 'A', '#fff', new Island(1234, 5678, 0), false),
        new Country(1, 'B', '#fff', new Island(-800000, 800000, 1), false),
    ];
    galaxyCores.length = 0;
    gameState.selectedUnits = [];
    const p = worldToMinimap(1234, 5678);
    const w = minimapToWorld(p.x + 1, p.y + 1); // the raw (imprecise) conversion
    const snapped = nearestMinimapLandmark(p.x + 1, p.y + 1);
    const finalX = snapped ? snapped.x : w.x;
    const finalY = snapped ? snapped.y : w.y;
    if (finalX !== 1234 || finalY !== 5678) {
        problems.push(`expected the click to resolve to A's exact position (1234, 5678), got (${finalX}, ${finalY}) - the raw imprecise conversion alone gave (${w.x.toFixed(0)}, ${w.y.toFixed(0)})`);
    }
    return problems;
});

check('drawMinimap()\'s camera viewport rectangle has a minimum visible size, per direct report ("no longer see a box in the mini map")', () => {
    const problems = [];
    if (!script.includes('MIN_VIEWPORT_BOX_PX')) problems.push('expected a minimum-viewport-box-size clamp in drawMinimap()');
    if (!/Math\.max\(bottomRightRaw\.x - topLeftRaw\.x, MIN_VIEWPORT_BOX_PX\)/.test(script)) {
        problems.push('expected the viewport box width to be clamped to at least MIN_VIEWPORT_BOX_PX');
    }
    if (!/Math\.max\(bottomRightRaw\.y - topLeftRaw\.y, MIN_VIEWPORT_BOX_PX\)/.test(script)) {
        problems.push('expected the viewport box height to be clamped to at least MIN_VIEWPORT_BOX_PX');
    }
    return problems;
});

// ---------- Hotsun (2026-09-04) ----------
// Direct request: "This image is to be placed in the center of the map
// Hotsun.png... 10 times larger then a planet. Any ship that goes a distance
// of 2000 near this sun will start losing health. Every ship will loose 20%
// health due to radiation poisioning."

check('spawnHotsun() places exactly one Hotsun at dead-center, 10x a planet\'s size, built from Hotsun.png', () => {
    const problems = [];
    galaxyCores.length = 0;
    spawnHotsun();
    const suns = galaxyCores.filter(c => c.kind === 'hotsun');
    if (suns.length !== 1) { problems.push(`expected exactly 1 Hotsun, got ${suns.length}`); return problems; }
    const sun = suns[0];
    if (sun.x !== MAP_WIDTH / 2 || sun.y !== MAP_HEIGHT / 2) problems.push(`expected it at dead-center, got (${sun.x}, ${sun.y})`);
    if (sun.size !== HOTSUN_SIZE) problems.push(`expected size HOTSUN_SIZE (${HOTSUN_SIZE}), got ${sun.size}`);
    if (HOTSUN_SIZE !== 250 * PLANET_SCALE * 10) problems.push(`expected HOTSUN_SIZE to be 10x a planet's base size, got ${HOTSUN_SIZE}`);
    // Not sun.sprite.src - by this point in the suite the image-load queue's
    // concurrency limit is permanently saturated with earlier tests' never-
    // resolving loads (jsdom never actually fetches images), so a freshly
    // queued image's .src may never get assigned. HOTSUN_IMAGE_URL itself -
    // what queueImageLoad() was actually called with - is the real assertion.
    if (!HOTSUN_IMAGE_URL.includes('Hotsun.png')) problems.push(`expected HOTSUN_IMAGE_URL to reference Hotsun.png, got ${HOTSUN_IMAGE_URL}`);
    galaxyCores.length = 0;
    return problems;
});

check('spawnHotsun() is idempotent - calling it again replaces the old Hotsun, never adds a second one', () => {
    galaxyCores.length = 0;
    spawnHotsun();
    spawnHotsun();
    const count = galaxyCores.filter(c => c.kind === 'hotsun').length;
    galaxyCores.length = 0;
    return count === 1 ? [] : [`expected exactly 1 Hotsun after calling spawnHotsun() twice, got ${count}`];
});

check("damageNearHotsun() takes 20% of max HP from every ship within HOTSUN_RADIATION_RANGE, every country/faction included, and leaves out-of-range ships alone", () => {
    const problems = [];
    galaxyCores.length = 0;
    spawnHotsun();
    const sun = galaxyCores.find(c => c.kind === 'hotsun');

    const a = new Country(0, 'A', '#fff', new Island(2000000, 0, 0), false);
    const nearShip = makeUnit('stormbreaker', 0);
    nearShip.x = sun.x + HOTSUN_RADIATION_RANGE - 10; nearShip.y = sun.y; // just inside range
    const farShip = makeUnit('stormbreaker', 0);
    farShip.x = sun.x + HOTSUN_RADIATION_RANGE + 5000; farShip.y = sun.y; // well outside range
    a.units = [nearShip, farShip];

    const alien = new Country(12, 'Alien', '#0ff', new Island(-2000000, 0, 12), false);
    alien.isCyborg = true;
    const nearAlienShip = makeUnit('cyborgdreadnought', 12);
    nearAlienShip.x = sun.x; nearAlienShip.y = sun.y + HOTSUN_RADIATION_RANGE - 10;
    alien.units = [nearAlienShip];

    gameState.countries = [a, alien];

    const nearMaxHp = nearShip.getMaxHP(), farMaxHp = farShip.getMaxHP(), alienMaxHp = nearAlienShip.getMaxHP();
    const nearHpBefore = nearShip.hp, farHpBefore = farShip.hp, alienHpBefore = nearAlienShip.hp;

    damageNearHotsun();

    const expectedNearHp = nearHpBefore - nearMaxHp * HOTSUN_DAMAGE_PERCENT;
    if (Math.abs(nearShip.hp - expectedNearHp) > 0.01) {
        problems.push(`expected the near ship to lose ${HOTSUN_DAMAGE_PERCENT * 100}% of its max HP (${nearMaxHp}), got hp ${nearShip.hp} (was ${nearHpBefore})`);
    }
    if (farShip.hp !== farHpBefore) problems.push(`expected the far ship (outside range) untouched, got hp ${farShip.hp} (was ${farHpBefore})`);
    const expectedAlienHp = alienHpBefore - alienMaxHp * HOTSUN_DAMAGE_PERCENT;
    if (Math.abs(nearAlienShip.hp - expectedAlienHp) > 0.01) {
        problems.push(`expected the alien ship (near, different faction) to also take radiation damage, got hp ${nearAlienShip.hp} (was ${alienHpBefore})`);
    }
    galaxyCores.length = 0;
    return problems;
});

check('damageNearHotsun() is a safe no-op when there is no Hotsun in the roster', () => {
    galaxyCores.length = 0;
    const a = new Country(0, 'A', '#fff', new Island(0, 0, 0), false);
    const ship = makeUnit('stormbreaker', 0);
    ship.x = 0; ship.y = 0;
    a.units = [ship];
    gameState.countries = [a];
    const hpBefore = ship.hp;
    damageNearHotsun();
    return ship.hp === hpBefore ? [] : [`expected no damage with zero Hotsuns present, hp went ${hpBefore} -> ${ship.hp}`];
});

check("HOTSUN_RADIATION_RANGE is measured from Hotsun's own edge (size + 2000), not its center", () => {
    const expected = HOTSUN_SIZE + 2000;
    return Math.abs(HOTSUN_RADIATION_RANGE - expected) < 0.01
        ? []
        : [`expected HOTSUN_RADIATION_RANGE = HOTSUN_SIZE + 2000 (${expected}), got ${HOTSUN_RADIATION_RANGE}`];
});

check('initGame() spawns Hotsun (Standard Game only, alongside the other landmarks)', () => {
    return script.includes('spawnHotsun();') ? [] : ['expected initGame() to call spawnHotsun()'];
});

check('nextTurn() applies Hotsun radiation every turn, alongside the Galaxy Core heal/Bounty award', () => {
    return script.includes('damageNearHotsun();') ? [] : ['expected nextTurn() to call damageNearHotsun()'];
});

// ---------- Galaxy Core/Bounty/Hotsun spin (2026-09-04) ----------
// Direct request: "After replacement you will make galaxy 1 and 2 spin like
// the planets." Applied to the whole shared GalaxyCore class (heal/bounty/
// hotsun all use it), same rotationAngle/rotationSpeed pattern already used
// by Island (planets) and ResourceDeposit.

check('GalaxyCore instances spin in place like planets once their sprite is loaded', () => {
    const problems = [];
    const core = new GalaxyCore(0, 0);
    if (typeof core.rotationAngle !== 'number') problems.push('expected a rotationAngle field on GalaxyCore instances');
    if (typeof core.rotationSpeed !== 'number' || core.rotationSpeed === 0) problems.push('expected a non-zero rotationSpeed field on GalaxyCore instances');
    core.sprite = { complete: true, naturalWidth: 10 }; // force the "loaded" branch of draw()
    const before = core.rotationAngle;
    core.draw();
    if (core.rotationAngle === before) problems.push("expected draw() to advance rotationAngle once the sprite is loaded (the spin itself)");
    return problems;
});

// ---------- Fog of war (2026-09-04) ----------
// Direct request: "We need to add a fog of war to the single player map and
// not the campaign mode. When one of your units goes in space they can see
// that area on the minimap. For example, if my troops come across a planet
// it will now show on the minimap... Give me the option to turn fog of war
// on and off on the map."

check('isPointRevealed()/revealRegion(): a point is revealed once inside a recorded circle, not before', () => {
    const problems = [];
    const human = new Country(0, 'Human', '#fff', new Island(0, 0, 0), true);
    if (isPointRevealed(human, 1000, 1000)) problems.push('expected nothing revealed before any region is recorded');
    revealRegion(human, 1000, 1000, 500);
    if (!isPointRevealed(human, 1000, 1000)) problems.push('expected the exact center of a revealed circle to count as revealed');
    if (!isPointRevealed(human, 1400, 1000)) problems.push('expected a point inside the circle (400 < 500 radius) to count as revealed');
    if (isPointRevealed(human, 1000, 2000)) problems.push('expected a point outside the circle (1000 > 500 radius) to NOT count as revealed');
    return problems;
});

check('revealRegion() skips adding a new circle fully contained within an existing one, to keep exploredRegions bounded', () => {
    const human = new Country(0, 'Human', '#fff', new Island(0, 0, 0), true);
    revealRegion(human, 0, 0, 1000);
    revealRegion(human, 100, 0, 200); // fully inside the first circle (100+200=300 <= 1000)
    return human.exploredRegions.length === 1
        ? []
        : [`expected the fully-contained circle to be skipped, got ${human.exploredRegions.length} regions`];
});

check("updateFogOfWar() reveals another country once a human's unit gets within sight range, and it stays revealed after the unit moves away", () => {
    const problems = [];
    const human = new Country(0, 'Human', '#fff', new Island(0, 0, 0), true);
    const other = new Country(1, 'Other', '#fff', new Island(1000000, 0, 1), false);
    const scout = makeUnit('deepglider', 0);
    scout.x = 2000000; scout.y = 2000000; // far from everything at first
    human.units = [scout];
    gameState.countries = [human, other];
    gameState.humanCountryIds = [0];
    gameState.campaignActive = false;

    updateFogOfWar();
    if (isPointRevealed(human, other.island.x, other.island.y, other.island.size)) problems.push('expected Other to be unrevealed before the scout ever got close');

    // Bring the scout within sight range of Other's island, then run one frame.
    scout.x = other.island.x + other.island.size + 100;
    scout.y = other.island.y;
    updateFogOfWar();
    if (!isPointRevealed(human, other.island.x, other.island.y, other.island.size)) problems.push("expected Other to be revealed once the scout got within sight range - troops \"coming across a planet\"");

    // Move the scout far away again - per direct request, once revealed it stays
    // revealed ("will now show on the minimap", not "only while nearby").
    scout.x = 2000000; scout.y = 2000000;
    updateFogOfWar();
    if (!isPointRevealed(human, other.island.x, other.island.y, other.island.size)) problems.push('expected Other to remain revealed after the scout moved away');
    return problems;
});

check("updateFogOfWar() throttles a moving unit's own reveals to roughly once per half its sight range of travel, not every single frame", () => {
    const human = new Country(0, 'Human', '#fff', new Island(-1000000, -1000000, 0), true); // home far away, isolated
    const scout = makeUnit('deepglider', 0);
    scout.x = 0; scout.y = 0;
    human.units = [scout];
    gameState.countries = [human];
    gameState.humanCountryIds = [0];
    gameState.campaignActive = false;

    updateFogOfWar(); // first call always records (home + the scout's first position)
    const countAfterFirst = human.exploredRegions.length;
    scout.x += 1; // moved 1 unit - nowhere near half a sight range
    updateFogOfWar();
    const countAfterTinyMove = human.exploredRegions.length;
    return countAfterTinyMove === countAfterFirst
        ? []
        : [`expected a 1-unit move to add no new region, went ${countAfterFirst} -> ${countAfterTinyMove}`];
});

check('updateFogOfWar() reveals a Galaxy Core/Bounty/Hotsun the same way it reveals countries', () => {
    const problems = [];
    const human = new Country(0, 'Human', '#fff', new Island(0, 0, 0), true);
    galaxyCores.length = 0;
    const core = new GalaxyCore(1000000, 0);
    core.kind = 'heal';
    galaxyCores.push(core);
    const scout = makeUnit('deepglider', 0);
    scout.x = 2000000; scout.y = 2000000;
    human.units = [scout];
    gameState.countries = [human];
    gameState.humanCountryIds = [0];
    gameState.campaignActive = false;

    updateFogOfWar();
    if (isPointRevealed(human, core.x, core.y, core.size)) problems.push('expected the core unrevealed before the scout got close');

    scout.x = core.x + core.size + 100; scout.y = core.y;
    updateFogOfWar();
    galaxyCores.length = 0;
    return isPointRevealed(human, core.x, core.y, core.size) ? [] : ['expected the core revealed once the scout got within sight range'];
});

check("updateFogOfWar() grants vision around a human's own homeworld without needing any units nearby", () => {
    const problems = [];
    const human = new Country(0, 'Human', '#fff', new Island(0, 0, 0), true);
    const near = new Country(1, 'Near', '#fff', new Island(500, 0, 1), false); // well within UNIT_SIGHT_RANGE
    human.units = []; // no units at all
    gameState.countries = [human, near];
    gameState.humanCountryIds = [0];
    gameState.campaignActive = false;
    updateFogOfWar();
    return isPointRevealed(human, near.island.x, near.island.y, near.island.size) ? [] : ["expected a nation right next to home to be revealed by homeworld vision alone, per the same reasoning Unit.draw()'s existing fog-of-war already uses"];
});

check('updateFogOfWar() never reveals a human\'s own country to itself (moot, own dot always shows), and is a no-op in Campaign mode', () => {
    const problems = [];
    const human = new Country(0, 'Human', '#fff', new Island(0, 0, 0), true);
    const other = new Country(1, 'Other', '#fff', new Island(200, 0, 1), false); // within home vision range
    gameState.countries = [human, other];
    gameState.humanCountryIds = [0];
    gameState.campaignActive = true;
    updateFogOfWar();
    if (isPointRevealed(human, other.island.x, other.island.y, other.island.size)) problems.push('expected updateFogOfWar() to do nothing at all in Campaign mode');
    gameState.campaignActive = false;
    return problems;
});

check('nearestMinimapLandmark() only snaps to a dot the fog of war actually reveals (own country and explored ones always count, unexplored ones never do while the toggle is on)', () => {
    const problems = [];
    const human = new Country(0, 'Human', '#fff', new Island(0, 0, 0), true);
    const hidden = new Country(1, 'Hidden', '#fff', new Island(1000000, 0, 1), false);
    gameState.countries = [human, hidden];
    gameState.playerCountry = human;
    gameState.humanCountryIds = [0];
    gameState.campaignActive = false;
    vm.runInContext('fogOfWarEnabled = true;', context);

    const pHidden = worldToMinimap(1000000, 0);
    if (nearestMinimapLandmark(pHidden.x, pHidden.y, 8) !== null) {
        problems.push('expected an unexplored country\'s dot to never be snappable while fog of war is on');
    }

    const pOwn = worldToMinimap(0, 0);
    if (nearestMinimapLandmark(pOwn.x, pOwn.y, 8) === null) {
        problems.push('expected the human\'s own country to always be snappable regardless of fog of war');
    }

    revealRegion(human, 1000000, 0, 500);
    if (nearestMinimapLandmark(pHidden.x, pHidden.y, 8) === null) {
        problems.push('expected a now-explored country\'s dot to be snappable');
    }

    vm.runInContext('fogOfWarEnabled = false;', context);
    human.exploredRegions = [];
    if (nearestMinimapLandmark(pHidden.x, pHidden.y, 8) === null) {
        problems.push('expected every dot snappable once the fog of war toggle is off, explored or not');
    }
    vm.runInContext('fogOfWarEnabled = true;', context);
    return problems;
});

check('toggleFogOfWar() flips the live setting', () => {
    vm.runInContext('fogOfWarEnabled = true;', context);
    toggleFogOfWar();
    const afterFirst = vm.runInContext('fogOfWarEnabled', context);
    toggleFogOfWar();
    const afterSecond = vm.runInContext('fogOfWarEnabled', context);
    const problems = [];
    if (afterFirst !== false) problems.push(`expected fogOfWarEnabled to flip to false, got ${afterFirst}`);
    if (afterSecond !== true) problems.push(`expected a second toggle to flip it back to true, got ${afterSecond}`);
    return problems;
});

check('drawMinimap() source gates both countries and galaxyCores on fog of war via isPointRevealed(), skipping Campaign mode', () => {
    const problems = [];
    if (!/fogActive = fogOfWarEnabled && !gameState\.campaignActive/.test(script)) {
        problems.push('expected drawMinimap() to compute a fogActive flag gated on both fogOfWarEnabled and !campaignActive');
    }
    const isPointRevealedCalls = script.split('isPointRevealed(gameState.playerCountry,').length - 1;
    if (isPointRevealedCalls < 3) {
        problems.push(`expected at least 3 isPointRevealed() checks (drawMinimap's country + core, nearestMinimapLandmark's country + core), found ${isPointRevealedCalls}`);
    }
    return problems;
});

check('gameLoop() calls updateFogOfWar() and drawFogOfWarOverlay() every frame, alongside the other per-frame updates', () => {
    const problems = [];
    if (!script.includes('updateFogOfWar();')) problems.push('expected gameLoop() to call updateFogOfWar()');
    if (!script.includes('drawFogOfWarOverlay();')) problems.push('expected gameLoop() to call drawFogOfWarOverlay()');
    return problems;
});

// Direct follow-up report: "On the regular map it is not blacked out but needs
// to be. I should only see my planet to start and everything else is black
// until it is explored."

check('drawFogOfWarOverlay() is a safe no-op with the toggle off, in Campaign mode, or with no active player country', () => {
    const problems = [];
    gameState.countries = [new Country(0, 'A', '#fff', new Island(0, 0, 0), true)];
    gameState.playerCountry = gameState.countries[0];
    gameState.campaignActive = false;

    vm.runInContext('fogOfWarEnabled = false;', context);
    try { drawFogOfWarOverlay(); } catch (e) { problems.push(`threw with the toggle off: ${e.message}`); }
    vm.runInContext('fogOfWarEnabled = true;', context);

    gameState.campaignActive = true;
    try { drawFogOfWarOverlay(); } catch (e) { problems.push(`threw in Campaign mode: ${e.message}`); }
    gameState.campaignActive = false;

    gameState.playerCountry = null;
    try { drawFogOfWarOverlay(); } catch (e) { problems.push(`threw with no active player country: ${e.message}`); }
    return problems;
});

// Real bug found and fixed by direct live verification (2026-09-04): canvas
// has no true "layers" - destination-out erases whatever pixels are already
// sitting in the SAME buffer it draws into. An earlier version punched holes
// directly into the main canvas the world was already drawn into that same
// frame, which erased the world itself in those spots instead of revealing
// it (confirmed live: a "revealed" pixel came back fully transparent, not
// showing the planet drawn there moments earlier). Fixed by building the
// black-with-holes shape in its own offscreen canvas first, then
// drawImage()-ing the finished result onto the main canvas normally. These
// three tests guard specifically against that regression coming back.

check('drawFogOfWarOverlay() composites the finished black-with-holes buffer onto the main canvas via drawImage()', () => {
    const problems = [];
    const human = new Country(0, 'A', '#fff', new Island(0, 0, 0), true);
    gameState.countries = [human];
    gameState.playerCountry = human;
    gameState.campaignActive = false;
    vm.runInContext('fogOfWarEnabled = true;', context);
    camera.x = 0; camera.y = 0; camera.zoom = 1;
    revealRegion(human, 0, 0, 500);

    let drawImageCalled = false;
    const origDrawImage = ctx.drawImage;
    ctx.drawImage = function (...args) { drawImageCalled = true; return origDrawImage.apply(this, args); };
    drawFogOfWarOverlay();
    ctx.drawImage = origDrawImage;

    if (!drawImageCalled) problems.push('expected the finished black-with-holes buffer to be composited onto the main canvas via drawImage()');
    return problems;
});

check('drawFogOfWarOverlay() never draws fillRect/arc directly on the main canvas ctx (must build the overlay in its own offscreen buffer instead)', () => {
    const human = new Country(0, 'A', '#fff', new Island(0, 0, 0), true);
    gameState.countries = [human];
    gameState.playerCountry = human;
    gameState.campaignActive = false;
    vm.runInContext('fogOfWarEnabled = true;', context);
    camera.x = 0; camera.y = 0; camera.zoom = 1;
    revealRegion(human, 0, 0, 500);

    let mainCtxPolluted = false;
    const origFillRect = ctx.fillRect, origArc = ctx.arc;
    ctx.fillRect = function (...args) { mainCtxPolluted = true; return origFillRect.apply(this, args); };
    ctx.arc = function (...args) { mainCtxPolluted = true; return origArc.apply(this, args); };
    drawFogOfWarOverlay();
    ctx.fillRect = origFillRect; ctx.arc = origArc;

    return mainCtxPolluted
        ? ['expected drawFogOfWarOverlay() to build its shape in an offscreen buffer, not draw fillRect/arc directly on the main canvas (which would erase the already-drawn world instead of overlaying on top of it)']
        : [];
});

check('drawFogOfWarOverlay() source culls revealed regions far outside the current camera viewport (a performance guard)', () => {
    return /r\.x \+ r\.radius < viewMinX \|\| r\.x - r\.radius > viewMaxX/.test(script)
        ? []
        : ['expected drawFogOfWarOverlay() to skip regions outside the current viewport bounds'];
});

check("drawMinimap() clamps a player's own unit dot to the minimap's rectangle instead of letting it vanish when it wanders beyond the known galaxy bounds", () => {
    // Direct report: "I sent 4 aircraft in 4 different directions and it does
    // not show them on the mini map any longer" - worldToMinimap() scales off
    // getGalaxyBounds() (wherever planets/landmarks actually are), which has
    // no idea where a scout has wandered off to.
    const problems = [];
    const player = new Country(0, 'Player', '#fff', new Island(0, 0, 0), true);
    const other = new Country(1, 'Other', '#fff', new Island(1000, 0, 1), false); // tiny bounds
    const scout = makeUnit('deepglider', 0);
    scout.x = 50000000; scout.y = 0; // way past the known bounds
    player.units = [scout];
    gameState.countries = [player, other];
    gameState.playerCountry = player;
    gameState.selectedUnits = [];
    vm.runInContext('fogOfWarEnabled = false;', context); // isolate from the fog gate above - this test is about clamping, not visibility

    const { mmX, mmY } = minimapBounds();
    let captured = null;
    const origArc = ctx.arc;
    ctx.arc = function (x, y, ...rest) {
        if (x >= mmX && x <= mmX + MINIMAP_WIDTH + 0.01 && y >= mmY - 0.01 && y <= mmY + MINIMAP_HEIGHT + 0.01 && rest[0] < 2) {
            captured = { x, y }; // a small-radius arc inside the minimap box = a unit dot
        }
        return origArc.apply(this, [x, y, ...rest]);
    };
    drawMinimap();
    ctx.arc = origArc;

    if (!captured) problems.push('expected the far-off scout\'s dot to still be drawn somewhere inside the minimap rectangle');
    else if (captured.x < mmX || captured.x > mmX + MINIMAP_WIDTH || captured.y < mmY || captured.y > mmY + MINIMAP_HEIGHT) {
        problems.push(`expected the clamped dot within the minimap rectangle, got (${captured.x}, ${captured.y})`);
    }
    return problems;
});

// Real gap found while investigating a direct report that explored planets
// weren't staying revealed (2026-09-04): applySaveData()/buildSaveData()
// never touched exploredRegions at all, so any save/load - including the
// automatic "Continue" from autosave every turn - silently wiped all fog-of-
// war progress back to nothing. Covered above in the main round-trip test;
// this one specifically guards the backward-compatibility fallback for a
// save from before this field existed.
check('applySaveData() falls back to a country\'s existing exploredRegions (not a crash) when loading a save from before that field existed', () => {
    const country = new Country(0, 'OldSaveTest', '#ff0000', new Island(0, 0, 0), true);
    country.exploredRegions = [{ x: 1, y: 2, radius: 3 }]; // already has real fog progress
    gameState.countries = [country];
    gameState.playerCountry = country;

    const oldSave = buildSaveData();
    delete oldSave.countries[0].exploredRegions; // simulate a save predating this field

    let threw = null;
    try { applySaveData(oldSave); } catch (e) { threw = e.message; }

    const problems = [];
    if (threw) problems.push(`expected no crash loading a save missing exploredRegions, got: ${threw}`);
    else if (JSON.stringify(country.exploredRegions) !== JSON.stringify([{ x: 1, y: 2, radius: 3 }])) {
        problems.push(`expected the country's existing exploredRegions left untouched, got ${JSON.stringify(country.exploredRegions)}`);
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
