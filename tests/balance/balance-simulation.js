#!/usr/bin/env node
/**
 * After Earth — balance-stat simulation
 * ----------------------------------------
 * The other suites check "does this work correctly"; this checks "is it
 * fair" - a different, statistical kind of question that only shows up
 * across many games, not one. It runs many full free-for-all AI-vs-AI
 * Standard Games (every nation played by the AI, no player advantage - the
 * same newGame() setup as a real game, just never calling startGame() so
 * nothing gets isPlayer treatment) to completion or a turn cap, and reports
 * which nations/factions systematically win, lose, or dominate more than
 * the others - real signal on balance, even though it can't tell you
 * whether a fight was FUN (that part still needs a human).
 *
 * Usage:
 *   node balance-simulation.js "<path-to-index.html>" [--runs=30] [--turns=40] [--difficulties=easy,normal,hard]
 *
 * Exits 1 only if a run actually crashed (a real bug, not a balance
 * finding) - the balance numbers themselves are printed as a report, not a
 * pass/fail gate, since "nation X wins slightly more often" is something
 * for a human to weigh, not something with an objectively correct answer.
 *
 * ON SAMPLE SIZE - measured, not assumed: two independent 15-run Hard
 * batches produced CONTRADICTORY outlier lists (one flagged Russia as the
 * strongest nation at 100%; the very next batch put Russia at 73%, among
 * the weakest, with nothing about Russia's own numbers having changed).
 * Bumping to 60 runs collapsed the entire regular-nation roster into a
 * tight, unremarkable 82-92% band with no outliers at all. Fewer than
 * ~30 runs is a quick smoke check, not a finding - don't treat a single
 * low-run batch's outlier list as real without at least that much
 * confirmation, and ideally the 60+ used to actually settle this once.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const GAME_PATH = process.argv[2];
const RUNS = parseInt((process.argv.find(a => a.startsWith('--runs=')) || '').split('=')[1]) || 30;
const TURNS = parseInt((process.argv.find(a => a.startsWith('--turns=')) || '').split('=')[1]) || 40;
const FRAMES_PER_TURN = parseInt((process.argv.find(a => a.startsWith('--frames=')) || '').split('=')[1]) || 600;
const DIFFICULTIES = ((process.argv.find(a => a.startsWith('--difficulties=')) || '').split('=')[1] || 'easy,normal,hard').split(',');

if (!GAME_PATH || !fs.existsSync(GAME_PATH)) {
    console.error('Usage: node balance-simulation.js "<path-to-index.html>" [--runs=10] [--turns=40] [--frames=600] [--difficulties=easy,normal,hard]');
    process.exit(1);
}

// ---------- Same headless-DOM harness as regression-test.js ----------

let html = fs.readFileSync(GAME_PATH, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
let script = scriptMatch[1];
script = script.replace('loadLifetimeStats();', '// suppressed for balance simulation');
script = script.replace('initGame();', '// suppressed for balance simulation');
script = script.replace('pollLoadingScreen(Date.now());', '// suppressed for balance simulation');

const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
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
vm.runInContext(script, context, { filename: 'game-script.js' });
// NOTE: newGame() is NOT the galaxy builder - it's just "confirm(), then
// location.reload()", used for the in-game "restart" button. The real
// one-time galaxy setup (all countries, all custom islands) lives in
// initGame(), which normally only ever runs once per real page load and
// never clears gameState.countries first (it assumes it starts empty).
// To run many simulated games in one process we have to reset that
// (and the other top-level mutable arrays it doesn't own) ourselves
// before each call.
vm.runInContext('this.__test = { gameState, setDifficulty, initGame, missiles, spaceMines, laserEffects };', context, { filename: 'grab-refs.js' });
const { gameState, setDifficulty, initGame, missiles, spaceMines, laserEffects } = context.__test;

// ---------- One simulated game ----------

function simulateOneGame(difficulty) {
    setDifficulty(difficulty);

    gameState.countries = [];
    gameState.turn = 1;
    gameState.paused = false;
    gameState.selectedUnits = [];
    gameState.campaignActive = false;
    missiles.length = 0;
    spaceMines.length = 0;
    laserEffects.length = 0;

    initGame(); // builds the full real galaxy - every nation, every custom island, no player advantage since startGame() is never called

    // The real galaxy spaces nations ~12,000-50,000 units apart (by design -
    // it's a big galaxy meant to be explored over a long real game). At that
    // distance, simulating enough real movement-time for fleets to actually
    // reach each other and fight would take many real minutes PER simulated
    // game, which was measured directly: 90 simulated turns still left every
    // nation undefeated. What actually matters for a BALANCE question is
    // each nation's own stats/bonuses/AI behavior relative to the others -
    // not how far apart their homeworlds happen to sit - so every island
    // (still using its own real id, name, bonuses, buildings, unit roster)
    // gets repositioned onto a single tight circle first. This is the same
    // "move the islands closer" idea already used successfully in
    // regression-test.js's own AI-vs-AI behavioral check, just applied to
    // the whole galaxy instead of 2-3 countries.
    // Shuffled seating, not construction order - otherwise the same country
    // would always land next to the same neighbors every single run, and
    // "always seated next to Cyborg" would be indistinguishable from "this
    // nation's own bonuses are weak" in the results.
    const ringRadius = 6000;
    const seatOrder = gameState.countries.slice();
    for (let i = seatOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seatOrder[i], seatOrder[j]] = [seatOrder[j], seatOrder[i]];
    }
    seatOrder.forEach((c, i) => {
        const angle = (i / seatOrder.length) * Math.PI * 2;
        c.island.x = Math.cos(angle) * ringRadius;
        c.island.y = Math.sin(angle) * ringRadius;
    });

    const nations = gameState.countries.map(c => ({
        id: c.id,
        name: c.name,
        faction: c.isCyborg ? 'Cyborg' : c.isZoonester ? 'Zoonester' : c.isRoufestreal ? 'Roufestreal' : 'nation',
    }));
    const eliminatedOnTurn = {}; // id -> turn number

    for (let turn = 1; turn <= TURNS; turn++) {
        gameState.countries.forEach(c => {
            c.collectResources();
            c.resetAttacks();
            c.aiTurn();
        });
        for (let f = 0; f < FRAMES_PER_TURN; f++) {
            gameState.countries.forEach(c => c.units.forEach(u => u.update()));
        }
        gameState.countries.forEach(c => {
            if (eliminatedOnTurn[c.id] === undefined && c.island.buildings.every(b => b.destroyed)) {
                eliminatedOnTurn[c.id] = turn;
            }
        });
    }

    return nations.map(n => {
        const country = gameState.countries.find(c => c.id === n.id);
        const buildingsAlive = country.island.buildings.filter(b => !b.destroyed).length;
        return {
            ...n,
            survived: eliminatedOnTurn[n.id] === undefined,
            eliminatedOnTurn: eliminatedOnTurn[n.id] ?? null,
            finalUnitCount: country.units.length,
            buildingsAlive,
            buildingsTotal: country.island.buildings.length,
        };
    });
}

// ---------- Run many games, aggregate ----------

function newAgg() {
    return { runs: 0, survived: 0, totalEliminatedTurn: 0, eliminatedCount: 0, totalUnits: 0, totalBuildingsAliveFrac: 0, faction: null };
}

function main() {
    let crashes = 0;
    const report = {}; // difficulty -> name -> agg

    DIFFICULTIES.forEach(difficulty => {
        report[difficulty] = {};
        for (let run = 1; run <= RUNS; run++) {
            let result;
            try {
                result = simulateOneGame(difficulty);
            } catch (e) {
                crashes++;
                console.log(`  [CRASH] ${difficulty} run ${run}: ${e.message}`);
                continue;
            }
            result.forEach(r => {
                if (!report[difficulty][r.name]) report[difficulty][r.name] = newAgg();
                const agg = report[difficulty][r.name];
                agg.faction = r.faction;
                agg.runs++;
                if (r.survived) agg.survived++;
                else { agg.eliminatedCount++; agg.totalEliminatedTurn += r.eliminatedOnTurn; }
                agg.totalUnits += r.finalUnitCount;
                agg.totalBuildingsAliveFrac += r.buildingsTotal > 0 ? r.buildingsAlive / r.buildingsTotal : 0;
            });
            process.stdout.write(`\r  Simulating ${difficulty}: run ${run}/${RUNS}...`);
        }
        console.log();
    });

    console.log(`\n${'='.repeat(78)}`);
    console.log(`BALANCE SIMULATION: ${RUNS} run(s) x ${TURNS} turn(s) per difficulty, ${crashes} crash(es)`);
    console.log('='.repeat(78));

    DIFFICULTIES.forEach(difficulty => {
        console.log(`\n--- ${difficulty.toUpperCase()} ---`);
        const rows = Object.entries(report[difficulty]).map(([name, agg]) => ({
            name,
            faction: agg.faction,
            survivalPct: (100 * agg.survived / agg.runs).toFixed(0),
            // Flag a low sample count on the average itself - "eliminated at
            // turn 6" reads very differently when it happened once out of 15
            // runs versus most of the time, and burying that in a single
            // number invites over-reading noise as a finding.
            avgElimTurn: agg.eliminatedCount > 0 ? `${(agg.totalEliminatedTurn / agg.eliminatedCount).toFixed(1)} (n=${agg.eliminatedCount})` : '—',
            avgFinalUnits: (agg.totalUnits / agg.runs).toFixed(1),
            avgBuildingsAlivePct: (100 * agg.totalBuildingsAliveFrac / agg.runs).toFixed(0),
        }));

        const nationRows = rows.filter(r => r.faction === 'nation').sort((a, b) => b.survivalPct - a.survivalPct);
        const specialRows = rows.filter(r => r.faction !== 'nation');
        const nameWidth = Math.max(20, ...rows.map(r => r.name.length + 2));

        const printRow = (name, survivalPct, avgElimTurn, avgFinalUnits, avgBuildingsAlivePct) =>
            console.log('  ' + String(name).padEnd(nameWidth) + String(survivalPct).padEnd(11) + String(avgElimTurn).padEnd(13) + String(avgFinalUnits).padEnd(15) + avgBuildingsAlivePct);

        printRow('Nation', 'Survival%', 'AvgElimTurn', 'AvgFinalUnits', 'AvgBuildings%');
        nationRows.forEach(r => printRow(r.name, r.survivalPct, r.avgElimTurn, r.avgFinalUnits, r.avgBuildingsAlivePct));
        if (specialRows.length) {
            console.log('  -- special factions (expected to be stronger by design) --');
            specialRows.forEach(r => printRow(r.name, r.survivalPct, r.avgElimTurn, r.avgFinalUnits, r.avgBuildingsAlivePct));
        }

        if (nationRows.length > 1 && RUNS < 30) {
            console.log('  (spread analysis skipped - need --runs=30+ for this to mean anything; see the note at the end of this report)');
        } else if (nationRows.length > 1) {
            const survivalVals = nationRows.map(r => Number(r.survivalPct));
            const mean = survivalVals.reduce((a, b) => a + b, 0) / survivalVals.length;
            const spread = Math.max(...survivalVals) - Math.min(...survivalVals);
            // Threshold calibrated against a real 60-run/difficulty report: a
            // properly-balanced roster naturally spreads about 10 points
            // (82-92% observed) even with nothing wrong - a 15-run report
            // showing 33 points turned out to be mostly noise (confirmed by a
            // second independent 15-run batch flipping which nations looked
            // like outliers entirely). 25 leaves real room above the natural
            // ~10-point floor without re-triggering on that same noise.
            if (spread >= 25) {
                console.log(`  ⚠ notable spread: survival ranges from ${Math.min(...survivalVals)}% to ${Math.max(...survivalVals)}% (mean ${mean.toFixed(0)}%)`);
                const laggards = nationRows.filter(r => mean - Number(r.survivalPct) >= 15);
                if (laggards.length) {
                    console.log(`    underperforming the group mean: ${laggards.map(r => `${r.name} (${r.survivalPct}%)`).join(', ')}`);
                }
            }
        }
    });

    const confidenceNote = RUNS < 30
        ? `⚠ ${RUNS} run(s) per difficulty is a quick smoke check, not a reliable read - two independent 15-run batches produced opposite outlier lists during development. Re-run with --runs=60+ before treating any single nation's number here as a finding.`
        : `Sample size is ${RUNS} run(s) per difficulty. Even at this size, treat outliers as a signal to investigate rather than a certainty - re-run to confirm before changing anything based on a single report.`;
    console.log(`\n${confidenceNote}`);

    if (crashes > 0) {
        console.log(`\n❌ ${crashes} run(s) crashed - that's a real bug, not a balance finding.`);
        process.exit(1);
    }
    process.exit(0);
}

main();
