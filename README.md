# After Earth

A single-file, browser-based space strategy game. No build step, no server —
`index.html` is the entire game (HTML/CSS/JS embedded together). Open it
directly in any modern browser to play.

## Playing it

Just open `index.html`. There's no install, no dependencies, nothing to run
first — the vector/canvas rendering, game logic, and UI are all in that one
file.

### Game modes

- **Standard Game** — pick one of 12 named nations (USA, China, Russia, UK,
  France, Japan, Germany, India, Brazil, and others) on a galaxy of up to 27
  planets. Every other nation is AI-controlled. Also present: 4 Cyborg
  planets, a Zoonester planet, and a Roufestreal mine-layer base — special,
  non-selectable hostile factions with their own bespoke AI (not the regular
  economy/build system below).
- **Campaign Mode** — a scripted series of stages against a specific rival,
  with pre-placed garrisons and stage objectives.
- **Hot-seat multiplayer** — 2 to 12 human players sharing one device,
  passing control between seats (`startHotSeatGame()` /
  `switchToNextHumanSeat()`). Built as groundwork for eventual networked
  multiplayer; the UI to actually start a hot-seat game from the menu isn't
  wired up yet.

### Core systems

- **Turn-based combat + real-time economy.** Turns auto-advance every 90
  seconds (AI builds/moves/attacks on its turn), but mining income and
  research both tick continuously in real time (frame-rate independent),
  regardless of whose turn it is.
- **Resource deposits ("mines")** — neutral map objects, 10,000 resources
  each, one guaranteed near every home planet plus more scattered across the
  galaxy. A **Mining Ship** (no weapons, no defense) parked within range of
  one drains it at 100/hour (150/hour with the Improved Extraction tech).
  AI nations use this system too, not just the player.
- **Tech tree** — each nation's Research Lab (always building slot 0, whatever
  its flavor name) can research one node at a time, in real time. Currently:
  *Mining Operations* (unlocks the Mining Ship), *Improved Extraction*
  (mining-rate boost, requires Mining Operations first), and *Vessel Plating*
  (+15% HP on vessel-class ships, independent branch).
- **Per-nation bonuses** (`COUNTRY_BONUSES`) — each of the 12 playable
  nations has exactly 3 stat-multiplier bonuses (HP/attack/speed/range on
  specific unit types), each shown on the country-select screen. This count
  is enforced by CI — see below.
- **Pause** — single-player Standard Game and Campaign only. Not available in
  hot-seat, since mining/research share one real-time clock across every
  human seat; pausing would freeze it for everyone, not just you.
- Vessel-class ships (`isVessel()`) are the ones that fly through open space
  and collide with planets, as opposed to ground units or aircraft — named
  "vessel" rather than "naval" on purpose, since this is a space game.

## Testing & CI

Everything here runs automatically on every push to `main` and on every PR,
via `.github/workflows/regression-tests.yml`. Four jobs on every push:

| Job | What it checks | How |
|---|---|---|
| `regression-test` | Game *logic* — unit stats, combat matchups, AI behavior, the tech tree, the mining economy, pause discipline, `COUNTRY_BONUSES` schema | Headless, via jsdom (`tests/regression-test.js`) — no real rendering |
| `visual-test` | Actual on-screen appearance stays correct | Real headless browsers (Chromium/Firefox/WebKit) via Playwright, pixel-diffed against a committed baseline (`tests/browser/visual-test.js`) |
| `interaction-test` | Real clicks/drags work, cross-browser | Playwright, same 3 engines (`tests/browser/interaction-test.js`) |
| `balance-simulation-smoke` | The balance simulator itself doesn't crash | 1 cheap run, 10 turns (`tests/balance/`) |

Two more, manual-trigger only (`workflow_dispatch` from the Actions tab):

- **`balance-report`** — a full statistical win-rate report across many
  simulated games. Not a pass/fail gate — "nation X wins slightly more often"
  is a finding for a human to read, not a correctness signal.
- **`bootstrap-visual-baseline`** — regenerates the visual-test baseline
  images from CI's own environment. Only run this by hand, only after
  confirming by eye that a `visual-test` failure is an *intended* change
  (new UI, more/less on-screen text, etc.) and not a real regression — it
  must run in CI, not on a developer's own machine, or font substitution
  alone produces false differences.

Run the core logic suite locally:

```
cd tests
npm install
node regression-test.js ../index.html
```

### Two guardrails worth knowing about

- **`COUNTRY_BONUSES` schema check** (`tests/regression-test.js`) — hard-fails
  on malformed bonus data (wrong type, a value like `15` where `1.5` was
  meant) and hard-fails if any playable nation (0-11) doesn't have *exactly*
  3 bonus entries. A separate informational log
  (`tests/country-bonus-count-snapshot.json`) tracks count changes across
  every nation, including the non-playable Cyborg ones, without blocking
  legitimate design changes on its own.
- **Function inventory** (`tests/function-inventory.json`) — auto-discovers
  every top-level function and class method by scanning the source, and
  flags (informationally) anything added/removed/renamed since the last run,
  plus a hard-fail check for dangling calls to functions that no longer
  exist.

## Project structure

```
index.html                    the entire game
tests/
  regression-test.js          logic suite (jsdom, no real rendering)
  function-inventory.json     committed snapshot for the inventory check
  country-bonus-count-snapshot.json   committed snapshot for the bonus-count tracker
  balance/                    balance-simulation.js + its own test runner
  browser/                    visual-test.js, interaction-test.js, committed
                               screenshot baselines (per browser engine)
.github/workflows/
  regression-tests.yml        all 6 CI jobs described above
Ships/, Planets/, Structures/ art assets referenced by index.html
```

## Known gaps / roadmap

- No networked multiplayer yet — hot-seat is local-only groundwork for it.
  Firebase/backend work is tracked separately.
- Hot-seat has no menu entry point yet (`startHotSeatGame()` exists and is
  tested, but nothing in the UI calls it).
- The tech tree has 3 nodes so far; more are expected (new unit unlocks,
  defensive tech, etc.).
- "Naval" terminology has been retired from the vessel-class system
  (`isVessel()`) and its UI labels, but `Harbor`/`isHarbor`/`isInHarbor` is
  still used throughout (touches save-file field names and ~80 call sites) -
  a deliberately deferred, larger rename.
