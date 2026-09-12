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
  France, Japan, Germany, India, Brazil, and others), then a map sector (see
  **Map Select** below), on a galaxy of 27 planets total: 20 ordinary nations
  (the 12 named ones plus 8 unnamed outposts) and 7 alien planets (4 Cyborg,
  2 Zoonester, 1 Roufestreal mine-layer base) — special, non-selectable
  hostile factions with their own bespoke AI (not the regular economy/build
  system below). Every other nation is AI-controlled.
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
- **Tech tree** (`TECH_TREE`) — each nation's Research Lab (always building
  slot 0, whatever its flavor name) can research one node at a time, in real
  time. 13 nodes total: a 3-node prereq chain (*Mining Operations* →
  *Improved Extraction* → *Deep Mining*, each boosting Mining Ship income
  further) plus 10 independent upgrades researchable in any order — combat
  stats (*Vessel Plating*, *Reinforced Hulls*, *Aerial Superiority*),
  sensors/defense (*Extended Sensors*, *Fortified Defenses*, *Orbital
  Resource Scanner*), utility (*Rapid Repair Crews*, *Expanded Cargo Bays*,
  *Warp Drive Calibration*), and one unlock (*Advanced Shipyards* — gates the
  Tidebreaker/Whisperwind vessels).
- **Galaxy landmarks** (Standard Game only, spawned once by `initGame()`) —
  four permanent, unowned map features: the **Galaxy Core** (heals any
  nearby ship 15%/turn, guarded by 3 Cyborg warships) and **Galaxy Bounty**
  (pays 50 gold/turn to whichever nation holds the most ships nearby, guarded
  by 7) sit in opposite corners of the galaxy; **Hotsun** sits at the exact
  center, damaging any ship that lingers nearby instead of healing it; the
  **Nerfflasma Hole** (`updateBlackHoles()`) roams the galaxy in real time,
  10,000 HP, capturing any ship that gets close until it's destroyed (which
  frees everything it's holding) or provoked into chasing whoever last hit
  it. Deliberately absent from the minimap, unlike the Core/Bounty/Hotsun.
- **Per-nation bonuses** (`COUNTRY_BONUSES`) — each of the 12 playable
  nations has exactly 3 stat-multiplier bonuses (HP/attack/speed/range on
  specific unit types), each shown on the country-select screen. This count
  is enforced by CI — see below.
- **Pause** — single-player Standard Game and Campaign only. Not available in
  hot-seat, since mining/research share one real-time clock across every
  human seat; pausing would freeze it for everyone, not just you.
- **AI targeting** (Standard Game/hot-seat; Campaign Mode has its own
  hand-placed rival/objective system instead) — `assignAttackTargets()` pairs
  every regular nation with a nearby rival and a nearby alien attacker via a
  greedy nearest-first match, then `guaranteeNearestAttackersForHumans()`
  layers on top to make sure every human player's own actual nearest regular
  nation and nearest alien are always among their attackers, even if the
  general pairing gave someone else priority. `pickAssignedTarget()` (used
  whenever a hunting unit has nothing in immediate visual range) always
  prefers a live human target over any other assigned rival on the list —
  without that, a nation or alien juggling several assigned victims (aliens
  especially, being fewer in number and each covering multiple regular
  nations) could roll right past the human for turn after turn and never
  actually close the distance, silently defeating the guarantee above. A
  nation already hunting a human also gets a guaranteed (non-probabilistic)
  first build of an independently-mobile attack-capable unit
  (`BUILDING_ATTACKER_TYPES`), and the AI's regular build roll is weighted
  75% toward that same list — most of the 19 buildable unit types can't
  actually damage a building at all, so an unweighted roll could produce a
  fleet that reaches the player and never lands a hit.
  `reassignEliminatedAttackTargets()` keeps all of this valid every turn as
  nations die off, always preferring the nearest living replacement over a
  random one. Ship travel speed itself is intentionally left unscaled in
  Standard Game — if reachability ever feels off again, the fix is elsewhere
  in this system (or `PLANET_SPREAD_MULTIPLIER`), not speed.
- **Map Select** (Standard Game only) — after picking a nation, choose from
  10 numbered sectors (`MAP_CONFIGS`), each showing its nation/alien counts,
  landmark lineup, and a "Full Details" view with the exact numbers behind
  every alien faction and landmark. Every sector currently plays the same
  underlying galaxy except **Sector 2**, which adds three roaming "raider
  pack" factions (`RAIDER_PACK_TYPES`) on top — Vrekthul Raider, Zhanqorr
  Widow, Krallosith Warhulk, 5 ships each at 300 HP, patrolling
  independently and laying permanent siege to whichever Earth nation planet
  they reach until it's destroyed or they are. They're modeled as
  lightweight "countries" (`isRaiderPack`) with an empty buildings array and
  no real homeworld rather than a bespoke parallel system, specifically so
  the existing per-frame movement, other nations' attack loops, Defense Gun
  auto-fire, and the player's own click-to-attack all pick them up for free.
  A chosen sector's own background art (`Maps/`, `applyMapBackground()`) is
  drawn as a real world object sized from its own aspect ratio (never
  cropped, pans with the camera like anything else) — kept in a separate
  `mapBackgroundImage`, deliberately never reusing the default background's
  own `spaceBackgroundImage`, since that one is mid-flight in
  `queueImageLoad()`'s concurrency-limited queue at page load and would
  otherwise get its `.src` overwritten back to default moments later.
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
Maps/                        sector background art (map-2.jpg..map-9.jpg) for Map Select
Map2Enemies/                 ship art for Sector 2's raider pack factions
```

## Known gaps / roadmap

- No networked multiplayer yet — hot-seat is local-only groundwork for it.
  Firebase/backend work is tracked separately.
- Hot-seat has no menu entry point yet (`startHotSeatGame()` exists and is
  tested, but nothing in the UI calls it).
- "Naval" terminology has been retired from the vessel-class system
  (`isVessel()`) and its UI labels, but `Harbor`/`isHarbor`/`isInHarbor` is
  still used throughout (touches save-file field names and ~80 call sites) -
  a deliberately deferred, larger rename.
- 9 of the 10 map-select sectors are still the same placeholder galaxy under
  a different background image - only Sector 2 has its own distinct content
  (the raider packs) so far. Sectors 1 and 10 also don't have background art
  yet.
